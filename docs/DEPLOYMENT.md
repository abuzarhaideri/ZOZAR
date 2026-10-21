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

## 5. Deploying

Push to `main`. The workflow runs typecheck, the full test suite and the migrations
against a throwaway Postgres, then applies migrations to Aiven and deploys the stack.

Migrations run **before** the new code. The previous Lambda version is still serving
traffic at that moment, so a migration must be backward compatible with it: add columns
and tables, never rename or drop in the same release as the code that stops using them.
Dropping something safely takes two deploys.

The stack outputs `ApiUrl`, `WebSocketUrl`, `MediaBucket` and the `ConnectionBudget`, and
they are printed in the workflow summary. The app's `EXPO_PUBLIC_API_URL` comes from
`ApiUrl`.

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
