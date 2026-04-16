let webpack = require('vortex-api/bin/webpack').default;

const res = webpack('gamebryo-savegame-management', __dirname, 5);

module.exports = res;
