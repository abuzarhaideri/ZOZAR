/**
 * Explicit Babel config.
 *
 * Reanimated's worklet transform ships inside `babel-preset-expo` and is applied
 * automatically when the library is installed. Expo falls back to this preset when no
 * config file is present, so animations may happen to work without this file — but
 * "happens to work" is a poor foundation for code that runs on the UI thread, and a
 * missing worklet transform fails at runtime rather than at build time. Declaring the
 * preset makes the dependency visible.
 */
module.exports = (api) => {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
