#!/usr/bin/env bash
#
# Deploy ZO-ZAR into an AWS Academy Learner Lab.
#
# The lab is not a normal AWS account: it forbids creating IAM roles. That single
# restriction is why this script exists instead of `scripts/aws-bootstrap.sh` plus a push
# to main:
#
#   - No CDK bootstrap. `cdk bootstrap` creates five IAM roles, so it cannot run. The
#     stack is synthesised with CliCredentialsStackSynthesizer instead, which uses these
#     credentials directly and needs no bootstrap roles — only a bucket to put assets in,
#     which this script creates.
#   - No OIDC, so no GitHub Actions deploys. Creating the deployment role is the first
#     thing the lab blocks. Deploys are therefore manual, from here.
#   - The Lambdas run as the lab's pre-made LabRole rather than roles of their own.
#
# Safe to re-run, and expected to be: lab credentials expire with the session and the lab
# reclaims resources, so this is the normal way to get back to a working backend. Every
# step checks for what it creates before creating it, and no step overwrites a secret.
#
# Usage:
#   # first run, or after the lab has wiped the parameters:
#   AIVEN_DATABASE_URL='postgres://avnadmin:...@....aivencloud.com:12345/defaultdb?sslmode=require' \
#   AIVEN_CA_CERT=./ca.pem \
#   [FIREBASE_SERVICE_ACCOUNT=./service-account.json] \
#   ./scripts/deploy-learner-lab.sh
#
#   # later runs, once the secrets are already in SSM:
#   ./scripts/deploy-learner-lab.sh
#
# Env override: REGION (default us-east-1). Nothing else is configurable — see below.

set -euo pipefail

# us-east-1 is where the lab runs. It is not where the users are, and it is probably not
# where Aiven is either; see the latency note in docs/DEPLOYMENT.md before blaming the app
# for feeling slow.
REGION="${REGION:-us-east-1}"

# Deliberately constants, not env overrides. `infra/bin/zozar.ts` hardcodes both for lab
# mode, and they only work as a matched pair: secrets written under a different prefix
# would sit somewhere the Lambdas never look, and the only symptom would be every request
# failing once the stack was live. REGION stays overridable because it is passed on to CDK
# as CDK_DEFAULT_REGION, so the stack follows it.
PREFIX="/zozar/lab"
STACK="Zozar-lab"
LAB_ROLE_NAME="LabRole"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die()  { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

command -v aws >/dev/null || die "aws CLI is not installed."

# Checked here, before anything touches AWS, because the alternative is discovering it at
# the last step: with no local install, `npx cdk` either stops to ask whether it may fetch
# the CLI from npm or quietly fetches a version this stack was never built against.
# infra/ is its own npm project, so it needs its own install.
[[ -d "$repo_root/infra/node_modules" ]] \
  || die "infra/node_modules is missing. Install it first:  (cd infra && npm ci)"

# ------------------------------------------------------------------- credentials

step "Checking lab credentials"
if ! IDENT="$(aws sts get-caller-identity --output json 2>&1)"; then
  cat >&2 <<'REFRESH'

    The lab's credentials are not valid. They are session credentials and they expire,
    so this is the usual state at the start of a working session. To refresh them:

      1. AWS Academy > your course > Start Lab, and wait for the dot to turn green.
      2. Click "AWS Details" (top right), then "Show" next to "AWS CLI".
      3. Copy the whole block — it starts with [default] and has three keys.
      4. Replace the entire contents of ~/.aws/credentials with it, and save:
             open -e ~/.aws/credentials
      5. Run this script again.

    Keep that block out of chat logs and commits: the secret key and session token are
    live passwords to the lab account until the session ends.

REFRESH
  printf '    aws said: %s\n\n' "$IDENT" >&2
  exit 1
fi

# Parsed with sed rather than jq so the happy path has no dependency beyond the AWS CLI.
ACCOUNT_ID="$(printf '%s' "$IDENT" | sed -n 's/.*"Account": *"\([0-9]*\)".*/\1/p')"
CALLER_ARN="$(printf '%s' "$IDENT" | sed -n 's/.*"Arn": *"\([^"]*\)".*/\1/p')"
[[ -n "$ACCOUNT_ID" ]] || die "Could not read the account id out of sts get-caller-identity."

ok "account $ACCOUNT_ID, region $REGION"
ok "identity ${CALLER_ARN##*/}"

# A normal account would succeed at everything this script skips, and would be better
# served by scripts/aws-bootstrap.sh. Warn rather than stop: the deploy still works, it
# just leaves the account configured as if it were a lab.
case "$CALLER_ARN" in
  *voclabs*|*LabRole*) ok "this is an AWS Academy Learner Lab" ;;
  *)
    warn "this identity does not look like a Learner Lab (no 'voclabs', no 'LabRole')."
    warn "If this is a normal AWS account, use scripts/aws-bootstrap.sh and GitHub"
    warn "Actions instead — lab mode gives up per-function IAM roles for no reason here."
    ;;
esac

LAB_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${LAB_ROLE_NAME}"
ASSETS_BUCKET="zozar-cdk-assets-${ACCOUNT_ID}"

# ---------------------------------------------------------------------- lab role

step "The role the Lambdas will run as"
if ! aws iam get-role --role-name "$LAB_ROLE_NAME" >/dev/null 2>&1; then
  die "$(cat <<MSG
$LAB_ROLE_ARN does not exist, or this identity cannot read it.

    Every Lambda in lab mode runs as LabRole because the lab will not let us create a
    role. Without it there is nothing to deploy to. Check that the lab is started, then
    run scripts/probe-learner-lab.sh to see which roles this account can see.
MSG
)"
fi
ok "$LAB_ROLE_ARN"

# ---------------------------------------------------------- preflight: permissions
#
# Advisory only, never a gate. Labs usually deny iam:GetPolicyVersion, so most of the
# time we can list the policy *names* attached to LabRole but not read what they allow.
# A missing permission therefore shows up at runtime as an AccessDenied in CloudWatch
# Logs, not here — which is worth knowing before spending an hour on a 500.

step "Preflight: what LabRole is allowed to do"

attached="$(aws iam list-attached-role-policies --role-name "$LAB_ROLE_NAME" \
  --query 'AttachedPolicies[].[PolicyName,PolicyArn]' --output text 2>/dev/null || true)"
inline="$(aws iam list-role-policies --role-name "$LAB_ROLE_NAME" \
  --query 'PolicyNames[]' --output text 2>/dev/null || true)"

if [[ -z "$attached" && -z "$inline" ]]; then
  warn "IAM policy reads are denied (or LabRole has no policies listed)."
  warn "Skipping the permission check. If the API returns 500s after deploying, read"
  warn "the Lambda's CloudWatch log group first — a denied ssm:GetParameter looks like"
  warn "a crash at cold start, not like a permissions problem."
else
  # Collected policy text, so one grep can answer each question below.
  docs=""

  if [[ -n "$attached" ]]; then
    while IFS=$'\t' read -r name arn; do
      [[ -n "$name" ]] || continue
      info "attached: $name"
      # </dev/null so the CLI cannot swallow the loop's remaining input.
      version="$(aws iam get-policy --policy-arn "$arn" \
        --query 'Policy.DefaultVersionId' --output text 2>/dev/null </dev/null || true)"
      if [[ -n "$version" && "$version" != "None" ]]; then
        docs+="$(aws iam get-policy-version --policy-arn "$arn" --version-id "$version" \
          --query 'PolicyVersion.Document' --output json 2>/dev/null </dev/null || true)"
      fi
    done <<<"$attached"
  fi

  if [[ -n "$inline" ]]; then
    for name in $inline; do
      info "inline: $name"
      docs+="$(aws iam get-role-policy --role-name "$LAB_ROLE_NAME" --policy-name "$name" \
        --query 'PolicyDocument' --output json 2>/dev/null || true)"
    done
  fi

  if [[ -z "$docs" ]]; then
    warn "could not read any policy document (iam:GetPolicyVersion is usually denied in"
    warn "the lab). The policy names above are all we can see."
  else
    # Matches the specific action, the service wildcard, or a bare "*" — the AWS Academy
    # LabRole is broad, so the wildcard forms are the likely hits.
    grants() { # label, egrep pattern
      if printf '%s' "$docs" | grep -Eq "$2"; then ok "$1"; else warn "$1 — NOT found"; fi
    }
    grants "ssm:GetParameter (secrets at cold start)" 'ssm:GetParameter|ssm:\*|"\*"'
    grants "s3 (presigned media upload and download)" 's3:[A-Za-z]|s3:\*|"\*"'
    grants "execute-api (WebSocket posts back to clients)" 'execute-api|"\*"'
    info "This reads the policy text, not the effective permissions: an explicit Deny,"
    info "an SCP or a permissions boundary elsewhere can still override a match above."
  fi
fi

# One permission this cannot check is the one the deploy itself needs: handing LabRole to
# a function requires iam:PassRole on *your* identity, not on LabRole, and there is no
# read-only way to test it. Attaching LabRole is the whole point of a Learner Lab, so it
# is allowed in practice; if it were not, the deploy would stop at the first function with
# an AccessDenied naming iam:PassRole.
warn "iam:PassRole on LabRole cannot be checked from here; a failure would appear in the"
warn "deploy output below, not in this preflight."

# ------------------------------------------------------------------ asset bucket
#
# CliCredentialsStackSynthesizer needs somewhere to upload the Lambda bundles, and it
# will not create that bucket itself — bootstrap is what normally makes it. A plain,
# private bucket is all it has to be.

# Every call carries --region explicitly. S3 answers these two without one, falling back
# to us-east-1, which would silently look at the wrong place if the operator's
# ~/.aws/config ever points elsewhere or REGION is overridden.
step "CDK asset bucket"
if aws s3api head-bucket --bucket "$ASSETS_BUCKET" --region "$REGION" >/dev/null 2>&1; then
  ok "$ASSETS_BUCKET already exists"
else
  # us-east-1 is the one region where create-bucket must NOT be given a
  # LocationConstraint: it is the API's default, and passing it is rejected with
  # InvalidLocationConstraint. Every other region requires it.
  location=()
  [[ "$REGION" == "us-east-1" ]] \
    || location=(--create-bucket-configuration "LocationConstraint=$REGION")

  create_out="$(aws s3api create-bucket --bucket "$ASSETS_BUCKET" --region "$REGION" \
    "${location[@]+"${location[@]}"}" 2>&1)" || die "$(cat <<MSG
could not create $ASSETS_BUCKET

    aws said: $create_out

    Bucket names are global and this one is derived from the account id, so the usual
    cause is that you already own it in another region. Check with:

        aws s3api get-bucket-location --bucket $ASSETS_BUCKET
MSG
)"
  ok "created $ASSETS_BUCKET"
fi

# Idempotent, so it is applied on every run rather than only on creation: the bucket holds
# the server's compiled code, and nothing about it should ever be publicly readable.
aws s3api put-public-access-block --bucket "$ASSETS_BUCKET" --region "$REGION" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' \
  >/dev/null 2>&1 && ok "public access blocked" \
  || warn "could not set the public access block (the lab may deny it); the bucket is still private by default"

# --------------------------------------------------------------------------- ssm
#
# SecureString parameters, not Lambda environment variables: env vars are readable by
# anyone holding lambda:GetFunction and they are recorded in the CloudFormation template,
# which would put the database password in the deployment history permanently.
#
# CloudFormation cannot create a SecureString, which is why they are created here.

step "Secrets in SSM under $PREFIX"

# True if the parameter exists, false only if Parameter Store says it does not. Anything
# else — expired credentials, a denied ssm:GetParameter — stops the script instead of
# being read as "missing". Treating an error as absence is how a run would ask for the
# Aiven secrets that are already stored, and worse, how it would mint a second JWT_SECRET
# over the top of a perfectly good one and sign out every user.
have_param() { # name
  local out
  out="$(aws ssm get-parameter --region "$REGION" --name "${PREFIX}/$1" 2>&1)" && return 0
  case "$out" in
    *ParameterNotFound*) return 1 ;;
    *) die "could not read ${PREFIX}/$1 — this is not the same as it being missing, so nothing was written.

    aws said: $out" ;;
  esac
}

put_secret() { # name, value
  aws ssm put-parameter --region "$REGION" --type SecureString \
    --name "${PREFIX}/$1" --value "$2" >/dev/null
  ok "${PREFIX}/$1 created"
}

# Which of the two Aiven secrets are missing is decided before anything is written, so a
# bad certificate path cannot leave the database URL stored and the run half-done. An
# existing parameter is never touched: re-running after the lab wipes the stack must not
# demand secrets that are already safely in SSM.
need_url=false;  have_param DATABASE_URL     || need_url=true
need_cert=false; have_param DATABASE_CA_CERT || need_cert=true

if [[ "$need_url" == true ]]; then
  [[ -n "${AIVEN_DATABASE_URL:-}" ]] || die "$(cat <<MSG
${PREFIX}/DATABASE_URL does not exist and AIVEN_DATABASE_URL is not set.

    Copy the "Service URI" from the Aiven console and re-run:

      AIVEN_DATABASE_URL='postgres://avnadmin:...@....aivencloud.com:12345/defaultdb?sslmode=require' \\
      AIVEN_CA_CERT=./ca.pem \\
      ./scripts/deploy-learner-lab.sh
MSG
)"
  # Aiven's URI already carries sslmode=require. Dropping it would make the client fall
  # back to an unverified connection without any error, which is the worst of both worlds.
  case "$AIVEN_DATABASE_URL" in
    *sslmode=require*|*sslmode=verify-full*) ;;
    *) die "AIVEN_DATABASE_URL must keep its sslmode parameter. Copy the Service URI from Aiven verbatim." ;;
  esac
fi

if [[ "$need_cert" == true ]]; then
  [[ -n "${AIVEN_CA_CERT:-}" ]] || die "$(cat <<MSG
${PREFIX}/DATABASE_CA_CERT does not exist and AIVEN_CA_CERT is not set.

    Aiven signs its database certificates with a per-project CA that the Node trust
    store does not know, so without this the server cannot verify the peer and refuses
    to start in production. Use "Download CA certificate" in the Aiven console, then
    pass the path:

      AIVEN_CA_CERT=./ca.pem ./scripts/deploy-learner-lab.sh
MSG
)"
  [[ -f "$AIVEN_CA_CERT" ]] || die "No such file: $AIVEN_CA_CERT"
  grep -q "BEGIN CERTIFICATE" "$AIVEN_CA_CERT" \
    || die "$AIVEN_CA_CERT does not look like a PEM certificate."
fi

# Both inputs are known good by here, so the writes cannot fail halfway.
if [[ "$need_url" == true ]]; then
  put_secret DATABASE_URL "$AIVEN_DATABASE_URL"
else
  ok "${PREFIX}/DATABASE_URL exists (left alone; rotate with put-parameter --overwrite)"
fi

if [[ "$need_cert" == true ]]; then
  # Base64 on one line so the certificate survives being a parameter value; the server
  # decodes it at cold start.
  put_secret DATABASE_CA_CERT "$(base64 -i "$AIVEN_CA_CERT" | tr -d '\n')"
else
  ok "${PREFIX}/DATABASE_CA_CERT exists (left alone)"
fi

# JWT_SECRET -------------------------------------------------------------------
# Generated here rather than asked for, because there is nothing to copy it from. Never
# regenerated: a new signing key invalidates every live access and refresh token, which
# signs out every user on the next request. Rotate deliberately, not by re-running this.
if have_param JWT_SECRET; then
  ok "${PREFIX}/JWT_SECRET exists (kept; regenerating would sign out every user)"
else
  command -v openssl >/dev/null || die "openssl is required to generate JWT_SECRET."
  put_secret JWT_SECRET "$(openssl rand -base64 48)"
fi

# FIREBASE_SERVICE_ACCOUNT -----------------------------------------------------
# Optional, and the only secret the backend can start without. Firebase is FCM-only here.
if have_param FIREBASE_SERVICE_ACCOUNT; then
  ok "${PREFIX}/FIREBASE_SERVICE_ACCOUNT exists (left alone)"
elif [[ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ]]; then
  [[ -f "$FIREBASE_SERVICE_ACCOUNT" ]] || die "No such file: $FIREBASE_SERVICE_ACCOUNT"
  command -v jq >/dev/null || die "jq is required to compact the service account JSON."
  put_secret FIREBASE_SERVICE_ACCOUNT "$(jq -c . "$FIREBASE_SERVICE_ACCOUNT")"
else
  warn "${PREFIX}/FIREBASE_SERVICE_ACCOUNT is not set."
  warn "Push notifications stay DISABLED until it is, which means the trusted-person"
  warn "alert will not reach anyone's phone. Everything else works. To enable it:"
  warn "  FIREBASE_SERVICE_ACCOUNT=./service-account.json ./scripts/deploy-learner-lab.sh"
fi

# ------------------------------------------------------------------------ deploy

# Migrations are not run here on purpose. They are a database change, they need the
# Aiven URL in this shell rather than in SSM, and they must land before the new code:
# see "Deploying into an AWS Academy Learner Lab" in docs/DEPLOYMENT.md.
step "Deploying $STACK"
info "stack        $STACK"
info "synthesis    CliCredentialsStackSynthesizer (no bootstrap roles)"
info "lambda role  $LAB_ROLE_ARN"
info "assets       s3://$ASSETS_BUCKET"
info "migrations   NOT run by this script — apply them first if the schema has changed"

cd "$repo_root/infra"
CDK_DEFAULT_ACCOUNT="$ACCOUNT_ID" CDK_DEFAULT_REGION="$REGION" \
  npx cdk deploy \
  --require-approval never \
  -c lab=true \
  -c "labRoleArn=$LAB_ROLE_ARN" \
  -c "assetsBucket=$ASSETS_BUCKET" \
  --outputs-file cdk-outputs.json

# -------------------------------------------------------------------- next steps

step "Stack outputs"
if [[ -f cdk-outputs.json ]]; then
  if command -v jq >/dev/null; then
    jq -r --arg s "$STACK" '.[$s] // . | to_entries[] | "    \(.key) = \(.value)"' cdk-outputs.json
  else
    cat cdk-outputs.json
  fi
else
  warn "cdk-outputs.json was not written; read the outputs from the deploy log above."
fi

API_URL=""
if [[ -f cdk-outputs.json ]] && command -v jq >/dev/null; then
  API_URL="$(jq -r --arg s "$STACK" '.[$s].ApiUrl // empty' cdk-outputs.json)"
fi

cat <<NEXT

$(printf '\033[1m==> Next: point the app at this backend\033[0m')

    1. Put the ApiUrl into eas.json, under build.preview.env:

           "EXPO_PUBLIC_API_URL": "${API_URL:-<the ApiUrl above>}"

       It is EXPO_PUBLIC_*, so it is baked into the APK at build time. Changing it
       needs a new build, not a restart.

    2. Rebuild and install:

           eas build --profile preview --platform android

$(printf '\033[1m==> Expect to run this again\033[0m')

    Lab credentials expire with the session, and the lab reclaims resources on its own
    schedule — the stack, the bucket and the SSM parameters can all be gone next week
    through no fault of yours. Nothing here is precious. Re-run this script; it will
    recreate what is missing, keep what is still there, and leave your JWT_SECRET alone
    if it survived.

    If the lab did wipe the parameters, you will need AIVEN_DATABASE_URL and
    AIVEN_CA_CERT in hand again, and the ApiUrl will change, so step 1 above repeats.

NEXT
