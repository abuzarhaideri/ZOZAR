const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

/**
 * Keep the backend out of the app bundle.
 *
 * `server/` is an independent npm project that lives in this repository but never ships to
 * the device, and `catalyst/` holds its built deployment bundle — 64 MB of generated code
 * and `node_modules`. Metro watches the project root, so without this it would crawl both
 * — slowing every rebuild and, worse, letting an accidental import of server code resolve
 * and bundle the backend into the APK.
 */
const excluded = [path.resolve(__dirname, 'server'), path.resolve(__dirname, 'catalyst')];

config.resolver.blockList = excluded.map(
  (dir) => new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.*$`),
);

module.exports = config;
