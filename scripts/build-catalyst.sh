#!/usr/bin/env bash
#
# Builds the AppSail bundle that `catalyst deploy` uploads.
#
# Catalyst runs no build and no `npm install` on its side: whatever is in the build
# directory is zipped, uploaded and started as-is. So this script has to produce a
# directory that is already runnable — entry point, manifest and real node_modules.
#
# The server's own source is bundled into a single file, but its dependencies are left
# external and installed normally. Bundling them too would be smaller, but some packages
# resolve parts of themselves at runtime and do not survive it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Exported, not merely assigned: the `node -e` steps below read these out of the
# environment. As plain shell variables they were invisible to those child processes, and
# the script only ever worked when the caller happened to pass them on the command line.
export SERVER="$ROOT/server"
export OUT="$ROOT/catalyst/api"

# Kept in step with server/package.json by hand. The list is short and changes rarely;
# reading it out of package.json would mean parsing JSON in bash for no real gain.
DEPS=(
  "@hono/node-server"
  "drizzle-orm"
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
# Generated, not hand-edited: this directory is wiped on every build.
#
# Secrets come from server/.env when it exists, and are written into env_variables so a
# deploy carries them. That file is gitignored and $OUT is gitignored, so nothing secret
# enters the repository — but the values do reach Catalyst, which is the point. Setting
# the same names in the Catalyst console overrides whatever is here, so the console
# remains the stronger source if you prefer it.
#
# Only names the server actually reads are forwarded, so an unrelated line in .env cannot
# silently become part of the deployment, and empty values are skipped rather than
# overwriting something already set in the console with a blank.
node -e '
  const fs = require("node:fs");
  const FORWARD = [
    "DATABASE_URL",
    "DATABASE_CA_CERT",
    "JWT_SECRET",
    "WORKER_TRIGGER_SECRET",
    "DB_POOL_MAX",
  ];

  const env = { NODE_ENV: "production" };
  const envFile = process.env.SERVER + "/.env";
  const forwarded = [];
  const hasEnvFile = fs.existsSync(envFile);

  if (hasEnvFile) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const at = line.indexOf("=");
      if (at === -1 || line.trimStart().startsWith("#")) continue;
      const key = line.slice(0, at).trim();
      // Values are taken verbatim apart from surrounding quotes: a base64 certificate or
      // a one-line JSON key must survive byte for byte.
      const value = line.slice(at + 1).trim().replace(/^(["\x27])(.*)\1$/s, "$2");
      if (FORWARD.includes(key) && value) { env[key] = value; forwarded.push(key); }
    }
  }

  fs.writeFileSync(process.env.OUT + "/app-config.json", JSON.stringify({
    command: "node index.js",
    build_path: ".",
    stack: "node22",
    env_variables: env,
    memory: 512,
    scripts: {},
  }, null, 2) + "\n");

  // Names only. Printing a value here would put a database password into a terminal
  // scrollback and into CI logs. The three states are reported separately: no file at
  // all, a file whose values are still blank, and values actually carried.
  if (!hasEnvFile) {
    console.log("    no server/.env — set the variables in the Catalyst console instead");
  } else if (forwarded.length === 0) {
    console.log("    server/.env found but every value is empty — nothing forwarded");
  } else {
    console.log("    forwarded from server/.env: " + forwarded.join(", "));
  }

  const missing = FORWARD.filter((k) => k !== "DB_POOL_MAX" && !env[k]);
  if (missing.length) {
    console.log("    still unset (must be in the Catalyst console): " + missing.join(", "));
  }
'

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
