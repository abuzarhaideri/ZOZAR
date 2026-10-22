#!/usr/bin/env bash
#
# Read-only capability probe for an AWS Academy Learner Lab.
#
# The lab forbids creating IAM roles, which is what both CDK's bootstrap and this
# project's stack normally do. Before reworking the stack to fit, this reports what the
# lab actually permits, so the rework is based on facts rather than assumptions.
#
# Creates nothing, deletes nothing, prints no credentials. Safe to run and re-run.
#
# Usage: start your Learner Lab, copy its credentials into ~/.aws/credentials, then:
#   ./scripts/probe-learner-lab.sh

set -uo pipefail

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no()   { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v aws >/dev/null || { echo "aws CLI is not installed."; exit 1; }

head_ "Identity"
IDENT=$(aws sts get-caller-identity --output json 2>&1) || {
  echo "  Could not authenticate. Start the lab and refresh ~/.aws/credentials."
  echo "  $IDENT"; exit 1; }
ACCOUNT=$(echo "$IDENT" | sed -n 's/.*"Account": "\([0-9]*\)".*/\1/p')
ARN=$(echo "$IDENT" | sed -n 's/.*"Arn": "\([^"]*\)".*/\1/p')
ok "account $ACCOUNT"
ok "identity ${ARN##*/}"
case "$ARN" in
  *voclabs*|*LabRole*) ok "this is an AWS Academy Learner Lab" ;;
  *) warn "does not look like a Learner Lab; it may be a normal account" ;;
esac
REGION=$(aws configure get region 2>/dev/null || echo "")
ok "configured region: ${REGION:-<unset, will default to us-east-1>}"

head_ "The role the Lambdas would use"
LABROLE=$(aws iam get-role --role-name LabRole --query 'Role.Arn' --output text 2>/dev/null)
if [ -n "$LABROLE" ] && [ "$LABROLE" != "None" ]; then
  ok "LabRole exists: $LABROLE"
else
  no "LabRole not found. Listing roles this account can see:"
  aws iam list-roles --query 'Roles[].RoleName' --output text 2>/dev/null | tr '\t' '\n' | sed 's/^/      /' | head -20 \
    || no "cannot list roles either"
fi

head_ "Can we create IAM roles? (expected: no)"
if aws iam create-role --role-name zozar-probe-should-fail \
     --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
     >/dev/null 2>&1; then
  warn "role creation SUCCEEDED — unexpected. Deleting it again."
  aws iam delete-role --role-name zozar-probe-should-fail >/dev/null 2>&1
  ok "standard CDK deploy may work after all"
else
  ok "blocked, as expected. The stack must reuse LabRole and skip CDK bootstrap."
fi

head_ "Services the stack needs (read-only checks)"
probe() { # label, command...
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$label"; else no "$label"; fi
}
probe "Lambda: can list functions"        aws lambda list-functions --max-items 1
probe "API Gateway v2: can list APIs"     aws apigatewayv2 get-apis --max-results 1
probe "S3: can list buckets"              aws s3api list-buckets
probe "EventBridge: can list rules"       aws events list-rules --limit 1
probe "CloudWatch Logs: can list groups"  aws logs describe-log-groups --limit 1
probe "SSM: can list parameters"          aws ssm describe-parameters --max-results 1
probe "CloudFormation: can list stacks"   aws cloudformation list-stacks --max-items 1

head_ "Lambda concurrency (the stack reserves 13)"
CONC=$(aws lambda get-account-settings --query 'AccountLimit.ConcurrentExecutions' --output text 2>/dev/null)
if [ -n "$CONC" ] && [ "$CONC" != "None" ]; then
  ok "account concurrency limit: $CONC"
  if [ "$CONC" -lt 113 ] 2>/dev/null; then
    warn "AWS keeps 100 unreserved, so reserving 13 needs a limit of at least 113."
    warn "The connection budget would have to drop, or reservations be removed."
  else
    ok "enough headroom to reserve 8 + 4 + 1"
  fi
else
  warn "could not read the concurrency limit"
fi

head_ "Existing CDK bootstrap"
if aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
  ok "CDKToolkit already exists — someone bootstrapped this account"
else
  ok "not bootstrapped (expected). We will deploy without it."
fi

head_ "Summary"
echo "  Send me this whole output. It contains no credentials."
echo "  From it I will adapt infra/ to deploy inside the lab."
