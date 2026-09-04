const base = require('../../../dependency-cruiser.config.cjs');

module.exports = {
  ...base,
  options: {
    ...base.options,
    exclude: {
      path: '^dist',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
};
