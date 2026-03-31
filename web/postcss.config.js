/** @type {import('postcss-load-config').Config} */
module.exports = {
  plugins: {
    cssnano: process.env.NODE_ENV === 'production' ? { preset: 'default' } : false,
  },
};
