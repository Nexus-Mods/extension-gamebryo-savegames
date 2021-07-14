let webpack = require('vortex-api/bin/webpack').default;

const res = webpack('gamebryo-savegame-management', __dirname, 4);

res.externals['./GamebryoSave'] = './GamebryoSave';

module.exports = res;
