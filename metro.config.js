const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

/**
 * Keep the backend out of the app bundle.
 *
 * `server/` and `infra/` are independent npm projects that live in this repository but
 * never ship to the device. Metro watches the project root, so without this it would
 * crawl their `node_modules` — slowing every rebuild and, worse, letting an accidental
 * import of server code resolve and bundle AWS SDKs into the APK.
 */
const excluded = [path.resolve(__dirname, 'server'), path.resolve(__dirname, 'infra')];

config.resolver.blockList = excluded.map(
  (dir) => new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.*$`),
);

module.exports = config;
