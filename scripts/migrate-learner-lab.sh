#!/usr/bin/env bash
#
# Creates (or updates) the database schema on Aiven, for a Learner Lab deployment.
#
# Deliberately separate from deploy-learner-lab.sh. A deploy is safe to repeat; a
# migration changes data and deserves its own deliberate run. Keeping them apart also
# means a failed migration never leaves half a stack behind.
#
# The connection details are read from SSM Parameter Store using your lab credentials, so
# the database password never appears in your shell history, in a file, or on screen.
#
# Usage: start the lab, refresh ~/.aws/credentials, then:
#   ./scripts/migrate-learner-lab.sh

set -euo pipefail

REGION="${REGION:-us-east-1}"
PREFIX=/zozar/lab
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

command -v aws >/dev/null || die "aws CLI is not installed."
[ -d "$root/server/node_modules" ] || die "Run 'npm install' in server/ first."

step "Checking lab credentials"
aws sts get-caller-identity >/dev/null 2>&1 \
  || die "Lab credentials are not valid. Start the lab and refresh ~/.aws/credentials."
printf '    ok\n'

step "Reading the connection details from Parameter Store"
# --with-decryption is why this needs the lab session: the values are SecureStrings.
get() {
  aws ssm get-parameter --region "$REGION" --name "$PREFIX/$1" --with-decryption \
    --query 'Parameter.Value' --output text 2>/dev/null
}
DATABASE_URL="$(get DATABASE_URL)" || true
DATABASE_CA_CERT="$(get DATABASE_CA_CERT)" || true
[ -n "${DATABASE_URL:-}" ] && [ "$DATABASE_URL" != "None" ] \
  || die "$PREFIX/DATABASE_URL is missing. Run ./scripts/deploy-learner-lab.sh first."
[ -n "${DATABASE_CA_CERT:-}" ] && [ "$DATABASE_CA_CERT" != "None" ] \
  || die "$PREFIX/DATABASE_CA_CERT is missing. Run ./scripts/deploy-learner-lab.sh first."
# Print the host only. The password stays unprinted.
printf '    database host: %s\n' "${DATABASE_URL##*@}"

step "Applying migrations"
# The same committed SQL that CI proves against a throwaway Postgres on every pull
# request, so what runs here is what was tested. Migrations are idempotent: re-running
# this on an up-to-date database does nothing.
cd "$root/server"
DATABASE_URL="$DATABASE_URL" DATABASE_CA_CERT="$DATABASE_CA_CERT" NODE_ENV=production \
  npm run db:migrate

step "Done"
cat <<'NEXT'
    The schema is in place. Sign-up and every other route should now work.

    Re-run this after any deploy that ships a new migration, and again if the lab ever
    wipes the database. It is safe to run when nothing has changed.
NEXT
