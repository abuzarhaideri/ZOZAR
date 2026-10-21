#!/usr/bin/env bash
#
# One-time AWS setup for ZO-ZAR: OIDC provider, deployment role, CDK bootstrap and the
# four SecureString parameters the Lambdas read at cold start.
#
# Safe to re-run. Every step checks for what it creates and updates in place rather than
# failing, so a partial run can simply be run again.
#
# This is the one part of deployment that is deliberately not in a workflow: it holds the
# real credentials, and automating it would need a workflow with broader permissions than
# the thing it is setting up.
#
# Usage:
#   GITHUB_REPO=owner/repo \
#   AIVEN_DATABASE_URL='postgres://avnadmin:...@....aivencloud.com:12345/defaultdb?sslmode=require' \
#   AIVEN_CA_CERT=./ca.pem \
#   [FIREBASE_SERVICE_ACCOUNT=./service-account.json] \
#   ./scripts/aws-bootstrap.sh

set -euo pipefail

REGION="${REGION:-ap-south-1}"
PREFIX="${PREFIX:-/zozar/prod}"
ROLE_NAME="${ROLE_NAME:-ZozarGithubDeploy}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-production}"
PROVIDER_HOST="token.actions.githubusercontent.com"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok() { printf '    %s\n' "$*"; }

# ---------------------------------------------------------------------------- inputs

[[ -n "${GITHUB_REPO:-}" ]] || die "GITHUB_REPO is not set (expected owner/repo)."
[[ "$GITHUB_REPO" == */* ]] || die "GITHUB_REPO must look like owner/repo, got '$GITHUB_REPO'."
[[ -n "${AIVEN_DATABASE_URL:-}" ]] || die "AIVEN_DATABASE_URL is not set."
[[ -n "${AIVEN_CA_CERT:-}" ]] || die "AIVEN_CA_CERT is not set (path to the CA certificate)."
[[ -f "$AIVEN_CA_CERT" ]] || die "No such file: $AIVEN_CA_CERT"

# Aiven's URI already carries sslmode=require. Dropping it would make the client fall
# back to an unverified connection without any error, which is the worst of both worlds.
case "$AIVEN_DATABASE_URL" in
  *sslmode=require*|*sslmode=verify-full*) ;;
  *) die "AIVEN_DATABASE_URL must keep its sslmode parameter. Copy the Service URI from Aiven verbatim." ;;
esac

grep -q "BEGIN CERTIFICATE" "$AIVEN_CA_CERT" \
  || die "$AIVEN_CA_CERT does not look like a PEM certificate."

command -v aws >/dev/null || die "aws CLI is not installed."

# ---------------------------------------------------------------------------- account

step "Checking AWS credentials"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "AWS credentials are not valid. Run 'aws configure' or 'aws sso login' first."
ok "account $ACCOUNT_ID, region $REGION"

PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${PROVIDER_HOST}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# ----------------------------------------------------------------- oidc provider

step "GitHub OIDC provider"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1; then
  ok "already exists"
else
  aws iam create-open-id-connect-provider \
    --url "https://${PROVIDER_HOST}" \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
  ok "created"
fi

# ------------------------------------------------------------------------- role

# The subject claim is the environment, not the ref.
#
# GitHub issues `repo:<owner>/<repo>:environment:<name>` for any job that declares an
# `environment:`, which the deploy job does. A trust policy pinned to
# `ref:refs/heads/main` is rejected at AssumeRoleWithWebIdentity and the deploy fails
# with a message that does not mention the environment at all.
SUBJECT="repo:${GITHUB_REPO}:environment:${ENVIRONMENT_NAME}"

trust_policy="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${PROVIDER_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "${PROVIDER_HOST}:aud": "sts.amazonaws.com",
        "${PROVIDER_HOST}:sub": "${SUBJECT}"
      }
    }
  }]
}
JSON
)"

# StringEquals, never StringLike with a wildcard: `repo:owner/repo:*` would let a
# pull-request workflow from a fork assume this role.
step "Deployment role ${ROLE_NAME}"
ok "trusting sub = ${SUBJECT}"
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$trust_policy"
  ok "trust policy updated"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --description "GitHub Actions deploys for ZO-ZAR" \
    --assume-role-policy-document "$trust_policy" >/dev/null
  ok "created"
fi

# Permission to assume the CDK bootstrap roles, rather than AdministratorAccess. The
# bootstrap roles are themselves scoped to what CloudFormation needs.
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name AssumeCdkRoles \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "sts:AssumeRole",
    "Resource": "arn:aws:iam::${ACCOUNT_ID}:role/cdk-*"
  }]
}
JSON
)"
ok "inline policy AssumeCdkRoles attached"

# -------------------------------------------------------------------- bootstrap

step "CDK bootstrap"
if aws cloudformation describe-stacks --region "$REGION" --stack-name CDKToolkit >/dev/null 2>&1; then
  ok "already bootstrapped"
else
  ( cd "$repo_root/infra" && npx cdk bootstrap "aws://${ACCOUNT_ID}/${REGION}" )
  ok "bootstrapped"
fi

# ------------------------------------------------------------------------- ssm

# SecureString, not Lambda environment variables: env vars are readable by anyone with
# lambda:GetFunction and they are recorded in the CloudFormation template, which would
# put the database password in the deployment history permanently.
put_secret() {
  local name="$1" value="$2"
  aws ssm put-parameter --region "$REGION" --type SecureString \
    --name "${PREFIX}/${name}" --value "$value" --overwrite >/dev/null
  ok "${PREFIX}/${name}"
}

step "SSM SecureString parameters"
put_secret DATABASE_URL "$AIVEN_DATABASE_URL"
put_secret DATABASE_CA_CERT "$(base64 -i "$AIVEN_CA_CERT" | tr -d '\n')"

# Regenerating the signing key invalidates every live access token, so an existing one is
# left alone. Rotate deliberately with put-parameter --overwrite, not by re-running this.
if aws ssm get-parameter --region "$REGION" --name "${PREFIX}/JWT_SECRET" >/dev/null 2>&1; then
  ok "${PREFIX}/JWT_SECRET (kept; rotating would sign out every user)"
else
  put_secret JWT_SECRET "$(openssl rand -base64 48)"
fi

if [[ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ]]; then
  [[ -f "$FIREBASE_SERVICE_ACCOUNT" ]] || die "No such file: $FIREBASE_SERVICE_ACCOUNT"
  command -v jq >/dev/null || die "jq is required to compact the service account JSON."
  put_secret FIREBASE_SERVICE_ACCOUNT "$(jq -c . "$FIREBASE_SERVICE_ACCOUNT")"
else
  ok "FIREBASE_SERVICE_ACCOUNT skipped — push notifications stay disabled until it is set"
fi

# ------------------------------------------------------------------------ next

cat <<NEXT

$(printf '\033[1m==> Done. Three things left, all in GitHub.\033[0m')

1. Settings > Environments > create "production", and limit it to the main branch.
   The deploy job references it and the trust policy above pins it, so the deploy
   cannot authenticate until it exists.

2. Settings > Secrets and variables > Actions, add:

     AWS_DEPLOY_ROLE_ARN   ${ROLE_ARN}
     DATABASE_URL          (the same Aiven URI you passed here)
     DATABASE_CA_CERT      (run: base64 -i ${AIVEN_CA_CERT} | tr -d '\\n')

   The last two are duplicated from SSM on purpose: migrations run on the Actions
   runner before the new Lambda code is live, so the runner needs the database
   directly and cannot read the Lambda's parameters.

3. Merge to main. The workflow runs the tests, applies migrations to Aiven, deploys,
   and prints ApiUrl in the run summary. Put that into EXPO_PUBLIC_API_URL to point
   the app at the real backend.
NEXT
