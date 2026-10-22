#!/usr/bin/env bash
#
# Builds the AppSail bundle that `catalyst deploy` uploads.
#
# Catalyst runs no build and no `npm install` on its side: whatever is in the build
# directory is zipped, uploaded and started as-is. So this script has to produce a
# directory that is already runnable — entry point, manifest and real node_modules.
#
# The server's own source is bundled into a single file, but its dependencies are left
# external and installed normally. Bundling them too would be smaller, but firebase-admin
# resolves parts of itself at runtime and does not survive it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$ROOT/server"
OUT="$ROOT/catalyst/api"

# Kept in step with server/package.json by hand. The list is short and changes rarely;
# reading it out of package.json would mean parsing JSON in bash for no real gain.
DEPS=(
  "@hono/node-server"
  "drizzle-orm"
  "firebase-admin"
  "hono"
  "jose"
  "pg"
  "zod"
)

echo "==> Cleaning $OUT"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "==> Bundling the server"
EXTERNALS=()
for dep in "${DEPS[@]}"; do
  EXTERNALS+=(--external:"$dep" --external:"$dep/*")
done

"$SERVER/node_modules/.bin/esbuild" "$SERVER/src/handlers/catalyst.ts" \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=cjs \
  --tsconfig="$SERVER/tsconfig.json" \
  "${EXTERNALS[@]}" \
  --outfile="$OUT/index.js" \
  --log-level=warning

echo "==> Writing the manifest"
# Generated from the dependency list above so the deployed manifest can never drift from
# what was marked external during bundling.
# The dependency list is passed through the environment rather than as arguments: with
# `node -e` there is no script path in process.argv, so the usual slice(2) silently drops
# the first argument. That removed @hono/node-server from the manifest and the deployed
# app died on its first require, with the platform reporting only "check the startup
# command or port".
ZOZAR_DEPS="$(printf '%s\n' "${DEPS[@]}")" \
node -e '
  const fs = require("node:fs");
  const deps = process.env.ZOZAR_DEPS.split("\n").filter(Boolean);
  const server = JSON.parse(fs.readFileSync(process.env.SERVER + "/package.json", "utf8"));
  const dependencies = {};
  for (const name of deps.sort()) {
    const version = server.dependencies[name];
    if (!version) throw new Error(`${name} is not a dependency of server/package.json`);
    dependencies[name] = version;
  }
  fs.writeFileSync(process.env.OUT + "/package.json", JSON.stringify({
    name: "zozar-api",
    version: server.version,
    private: true,
    main: "index.js",
    scripts: { start: "node index.js" },
    dependencies,
  }, null, 2) + "\n");
  // A missing entry here is what shipped a broken bundle once already.
  for (const name of deps) {
    if (!dependencies[name]) throw new Error(`${name} missing from the generated manifest`);
  }
'

echo "==> Writing app-config.json"
# Generated, not hand-edited: this directory is wiped on every build. Secrets are
# deliberately absent — env_variables here would sit in the working tree and in the
# deploy history, so DATABASE_URL, DATABASE_CA_CERT, JWT_SECRET,
# FIREBASE_SERVICE_ACCOUNT and WORKER_TRIGGER_SECRET are set in the Catalyst console
# instead, where console values also take precedence over anything in this file.
cat > "$OUT/app-config.json" <<'CONFIG'
{
	"command": "node index.js",
	"build_path": ".",
	"stack": "node22",
	"env_variables": {
		"NODE_ENV": "production"
	},
	"memory": 512,
	"scripts": {}
}
CONFIG

echo "==> Installing production dependencies"
# --omit=dev and no package-lock: this tree is an artefact, not a project. --ignore-scripts
# because nothing here should run install hooks from the network into a deploy bundle.
(cd "$OUT" && npm install --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null)

echo "==> Verifying the bundle resolves"
# Catalyst runs no install, so a dependency missing here is a dependency missing in
# production — and the platform reports that only as "check the startup command or port",
# with no mention of the module. Resolving each one now turns a silent deploy failure
# into a loud build failure.
ZOZAR_DEPS="$(printf '%s\n' "${DEPS[@]}")" node -e '
  const deps = process.env.ZOZAR_DEPS.split("\n").filter(Boolean);
  const missing = deps.filter((name) => {
    try { require.resolve(name, { paths: [process.env.OUT] }); return false; }
    catch { return true; }
  });
  if (missing.length) {
    console.error("Unresolvable in the bundle: " + missing.join(", "));
    process.exit(1);
  }
'

SIZE="$(du -sh "$OUT" | cut -f1)"
echo "==> Built $OUT ($SIZE)"
