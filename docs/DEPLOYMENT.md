# Deployment runbook

One-time setup, then deploys happen on every push to `main`. Region is `ap-south-1`.

Nothing here is automated on purpose: creating the account, the database and the
deployment role are the steps that hold real credentials, and they are done once by a
human rather than by a workflow that would need even broader permissions to do them.

## 1. Aiven PostgreSQL

Create a free PostgreSQL service, then collect two things:

- **Connection string** — the "Service URI" from the Aiven console. It already ends in
  `?sslmode=require`; keep that.
- **CA certificate** — "Download CA certificate" on the same page. Aiven signs its
  database certificates with a per-project CA that Node's trust store does not know, so
  without this the server cannot verify the peer and refuses to start in production.

Base64-encode the certificate for transport as a single line:

```bash
base64 -i ca.pem | tr -d '\n'
```

> The free plan allows **20 connections** and has no PgBouncer. The connection budget in
> [ARCHITECTURE.md](ARCHITECTURE.md) depends on that number. If you change plan, revisit
> the reserved concurrency in `infra/lib/zozar-stack.ts` rather than leaving it stale.

## 2. Secrets in SSM Parameter Store

The Lambdas read these at cold start. They are **SecureString** parameters, not Lambda
environment variables: env vars are readable by anyone holding `lambda:GetFunction` and
they land in the CloudFormation template, which would record the database password in the
deployment history. Standard parameters are free; Secrets Manager would be $0.40 per
secret per month.

CloudFormation cannot create a SecureString, so these are created by hand, once:

```bash
REGION=ap-south-1
PREFIX=/zozar/prod

aws ssm put-parameter --region "$REGION" --type SecureString \
  --name "$PREFIX/DATABASE_URL" \
  --value 'postgres://avnadmin:...@pg-zozar.aivencloud.com:12345/defaultdb?sslmode=require'

aws ssm put-parameter --region "$REGION" --type SecureString \
  --name "$PREFIX/DATABASE_CA_CERT" --value "$(base64 -i ca.pem | tr -d '\n')"

# 32 bytes minimum; the server refuses anything shorter.
aws ssm put-parameter --region "$REGION" --type SecureString \
  --name "$PREFIX/JWT_SECRET" --value "$(openssl rand -base64 48)"

# FCM only. Firebase is not used for auth, data or storage.
aws ssm put-parameter --region "$REGION" --type SecureString \
  --name "$PREFIX/FIREBASE_SERVICE_ACCOUNT" --value "$(jq -c . service-account.json)"
```

To rotate any of them, `put-parameter --overwrite`. Running Lambdas keep the old value
until their containers recycle, so force a cold start with a no-op deploy if a rotation
has to take effect immediately.

## 3. GitHub deployment role (OIDC)

GitHub Actions assumes a role using a short-lived OIDC token, so no long-lived AWS access
key is stored in the repository. Create the identity provider once per account:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

Then the role. The trust policy is the security boundary here — `sub` must pin the
repository **and** the exact context, or any workflow in any repository that can reach
this provider could assume the role.

The deploy job declares `environment: production`, and that changes the claim. When a job
references an environment, GitHub issues `sub` as
`repo:<OWNER>/<REPO>:environment:<NAME>`; the `ref:refs/heads/...` form is only used by
jobs with no environment. Pinning the ref form here would be rejected at
`AssumeRoleWithWebIdentity` and the first deploy would fail. Pinning the environment is
also the stronger choice, because an environment can carry required reviewers and a
branch policy, which a bare ref cannot:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:environment:production"
      }
    }
  }]
}
```

Use `StringEquals` on `sub`, not `StringLike` with a wildcard. `repo:<OWNER>/<REPO>:*`
would let a pull-request workflow from a fork assume the deployment role.

`scripts/aws-bootstrap.sh` performs every step in sections 2 and 3 and is safe to re-run.

For permissions, attach the CDK bootstrap roles rather than `AdministratorAccess`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sts:AssumeRole",
    "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-*"
  }]
}
```

Bootstrap the account once, which creates those roles:

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/ap-south-1
```

## 4. GitHub repository secrets

| Secret | Used by | Why it is here as well as in SSM |
| --- | --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | deploy job | The role to assume; not a credential. |
| `DATABASE_URL` | migration step | Migrations run from the runner, before the new Lambda code is live, so the runner needs the database directly. |
| `DATABASE_CA_CERT` | migration step | Same reason; TLS verification applies to the runner too. |

You must also create the `production` environment in the repository settings — the deploy
job references it, and the trust policy above pins it. Adding a required reviewer there
turns every deploy into an approval gate, which is worth having once this is serving
anyone other than you. Restrict it to the `main` branch so the environment claim cannot
be obtained from a side branch.

## 5. Turning deploys on

The deploy job is switched off by default, so merging to `main` before AWS exists runs
the tests and stops there instead of failing. Once sections 1–4 are done, add a repository
**variable** (not a secret) named `AWS_DEPLOY_ENABLED` with the value `true`, under
Settings > Secrets and variables > Actions > Variables.

## 6. Deploying

Push to `main`. The workflow runs typecheck, the full test suite and the migrations
against a throwaway Postgres, then applies migrations to Aiven and deploys the stack.

Migrations run **before** the new code. The previous Lambda version is still serving
traffic at that moment, so a migration must be backward compatible with it: add columns
and tables, never rename or drop in the same release as the code that stops using them.
Dropping something safely takes two deploys.

The stack outputs `ApiUrl`, `WebSocketUrl`, `MediaBucket` and the `ConnectionBudget`, and
they are printed in the workflow summary. The app's `EXPO_PUBLIC_API_URL` comes from
`ApiUrl`.

## Deploying into an AWS Academy Learner Lab

An alternative to sections 1–6, for when there is no ordinary AWS account to deploy into.
Everything about the architecture is unchanged — same stack, same Lambdas, same connection
budget — but the path to getting it there is different, and worse in specific ways.

This section is written from the lab's documented restrictions and a read-only capability
probe (`scripts/probe-learner-lab.sh`). The lab stack has been synthesised and checked —
its template declares no IAM resources and all three functions reference `LabRole` — but
the deploy itself has not been run end to end, so treat the first deploy as the test of
it.

### Why the lab needs its own path

A Learner Lab will not let you create an IAM role. That one restriction removes two things
this runbook otherwise depends on:

- **No CDK bootstrap.** `cdk bootstrap` creates five IAM roles for CloudFormation to
  assume, so section 3 cannot run. In lab mode the stack is synthesised with
  `CliCredentialsStackSynthesizer`, which uses your own CLI credentials for the deploy and
  needs no bootstrap roles at all — only a plain S3 bucket to upload the Lambda bundles
  and the template to, which the script creates.
- **No OIDC, so no GitHub Actions deploys.** The deployment role in section 3 is the first
  thing the lab blocks, and without a role there is nothing for GitHub to assume. Deploys
  are manual, from a laptop that holds live lab credentials.

The Lambdas also do not get roles of their own. They all run as the lab's pre-made
`LabRole`, which is broad — far broader than the per-function policies the normal stack
writes. That is a real loss of least privilege, accepted because the alternative is not
deploying.

Handing `LabRole` to a function needs `iam:PassRole` on your own lab identity. Attaching
`LabRole` is how every Academy lab works, so this is allowed in practice, but it is the
one permission nothing can verify ahead of the deploy: if it were missing, the deploy
would stop at the first function with an `AccessDenied` naming `iam:PassRole`.

### What you give up

| | Normal account | Learner Lab |
| --- | --- | --- |
| Deploys | automatic on push to `main` | manual, one command, from your machine |
| Credentials | OIDC, nothing stored | session credentials that expire every session |
| Lambda identity | one scoped role per function | shared `LabRole` |
| Durability | yours until you delete it | the lab reclaims resources on its own schedule |
| Review gate | `production` environment, optional reviewer | none |

The last row of durability is the one that stings: the stack, the asset bucket and the SSM
parameters can all be gone next week through no fault of yours. Nothing in the lab is
precious, and the deploy script is built to be re-run rather than to be run once.

### Steps

Lab mode is selected by CDK context, so the normal stack is untouched. The lab stack is
`Zozar-lab` in `us-east-1` reading `/zozar/lab/*`; the normal one stays `Zozar-prod` in
`ap-south-1` reading `/zozar/prod/*`. They cannot collide.

1. **Section 1 still applies.** Create the Aiven service and collect the Service URI and
   the CA certificate. Read the latency note below before you create it.

2. **Start the lab and refresh your credentials.** AWS Academy > your course > Start Lab,
   wait for the green dot, then AWS Details > AWS CLI > Show, and replace the whole
   contents of `~/.aws/credentials` with that block:

   ```bash
   open -e ~/.aws/credentials
   ```

   The secret key and session token in that block are live passwords to the lab account
   until the session ends. Do not paste them into a chat, an issue or a commit.

3. **Apply the migrations.** There is no workflow to do this, so it is a manual step, and
   it comes *before* the deploy for the same reason section 6 gives: the migration must be
   compatible with the code that is already running.

   `server/` and `infra/` are separate npm projects from the app, so run `npm ci` in each
   once on this machine; the deploy script refuses to start without `infra/node_modules`.

   ```bash
   cd server
   DATABASE_URL='postgres://avnadmin:...?sslmode=require' \
   DATABASE_CA_CERT="$(base64 -i ../ca.pem | tr -d '\n')" \
   npm run db:migrate
   ```

4. **Deploy.** On the first run, and on any run after the lab has wiped the parameters,
   pass the Aiven secrets; after that the script finds them in SSM and needs nothing:

   ```bash
   AIVEN_DATABASE_URL='postgres://avnadmin:...?sslmode=require' \
   AIVEN_CA_CERT=./ca.pem \
   FIREBASE_SERVICE_ACCOUNT=./service-account.json \
   ./scripts/deploy-learner-lab.sh
   ```

   The script checks the credentials, confirms `LabRole` exists, reports as much of
   `LabRole`'s permissions as read-only IAM allows, creates the private asset bucket
   `zozar-cdk-assets-<ACCOUNT_ID>`, creates any missing SecureString under `/zozar/lab`,
   and then deploys. It never overwrites a secret that already exists — in particular it
   will not regenerate `JWT_SECRET`, because a new signing key signs out every user.

   `FIREBASE_SERVICE_ACCOUNT` is optional. Without it the deploy succeeds and push
   notifications stay off, which means the trusted-person alert does not reach anyone's
   phone.

5. **Point the app at it.** The script prints the stack outputs and writes
   `infra/cdk-outputs.json` (URLs and bucket names, no secrets; it is not in
   `.gitignore`, so leave it untracked). Put `ApiUrl` into `eas.json` under
   `build.preview.env` as `EXPO_PUBLIC_API_URL`, then rebuild — it is baked into the APK
   at build time, so a restart is not enough:

   ```bash
   eas build --profile preview --platform android
   ```

   The URL changes if the lab ever recreates the API, so expect to repeat this.

### The database is on the wrong continent

The lab runs in `us-east-1`. If the Aiven service is in Bangalore, every query crosses the
world and back — roughly 200ms added to each one, and a request that makes three queries
feels broken rather than slow. The Lambdas are outside a VPC and talk to Aiven over the
public internet, so there is nothing to tune here; the distance *is* the latency.

The fix is to move the database, not the lab. While the database is still empty, deleting
the free Aiven service and recreating it in a US region costs nothing but a few minutes.
[ARCHITECTURE.md](ARCHITECTURE.md) records that the free plan cannot pin a region, which
is true of an existing service — but the creation form does offer a short list, so check
whether a US region is on it. If one is, take it. If not, the latency stands and the only
real fix is Aiven's paid tier.

Do this before step 3, so the migrations run against the service you are keeping.

### Tearing down

```bash
cd infra
CDK_DEFAULT_ACCOUNT=<ACCOUNT_ID> CDK_DEFAULT_REGION=us-east-1 \
  npx cdk destroy \
  -c lab=true \
  -c labRoleArn=arn:aws:iam::<ACCOUNT_ID>:role/LabRole \
  -c "assetsBucket=zozar-cdk-assets-<ACCOUNT_ID>"
```

The context must match the deploy exactly. Without `-c lab=true` the app synthesises
`Zozar-prod` instead, and `destroy` then reports that it has nothing to delete rather than
doing what you meant.

Three things survive a destroy on purpose:

- **The media bucket**, which carries `RemovalPolicy.RETAIN` because it holds voice
  messages. Delete it by hand if you actually want it gone.
- **The SSM parameters**, which are not part of the stack. Leaving them means the next
  deploy needs no secrets. Deleting `JWT_SECRET` signs out every user.
- **The asset bucket**, for the same reason — the next deploy reuses it.

Rolling back by reverting a commit, as described below, does not apply in the lab. The
deploy workflow still runs on every push to `main`, but its deploy job is gated on the
`AWS_DEPLOY_ENABLED` variable from section 5; leave that unset, because with no deployment
role to assume the job can only fail at the OIDC step. To roll back, check out the older
commit and re-run the deploy script.

## Rolling back

CloudFormation rolls back automatically if a deploy fails. To undo a deploy that
succeeded, revert the commit and push: that is a normal forward deploy and keeps the
stack and the repository in agreement, which `cdk deploy` from an older checkout does not.

A migration is not rolled back by reverting code. Write a new migration that undoes it.

## Cost

Zero for the first year, then a few cents a month at portfolio traffic. Lambda's 1M
requests and 400,000 GB-seconds per month never expire. API Gateway's HTTP and WebSocket
allowances are 12-month introductory offers, after which they are roughly $1 per million.
Aiven's free plan does not expire.

The single largest cost risk is adding a VPC: a NAT gateway is about $32/month, more than
everything else here combined. The Lambdas are deliberately outside a VPC. See
[ARCHITECTURE.md](ARCHITECTURE.md).
