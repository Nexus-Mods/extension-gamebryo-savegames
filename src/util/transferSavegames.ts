import { saveFiles } from './gameSupport';

import * as Promise from 'bluebird';
import * as path from 'path';
import { fs, log } from 'vortex-api';

/**
 * copy or move a list of savegame files
 *
 * @param {string} sourceSavePath
 * @param {string} destSavePath
 * @param {boolean} justCopy
 */
function transferSavegames(gameId: string,
                           savegames: string[],
                           sourceSavePath: string,
                           destSavePath: string,
                           keepSource: boolean): Promise<string[]> {
  const failedCopies: string[] = [];

  const operation = keepSource ? fs.copyAsync : fs.renameAsync;

  savegames = savegames.reduce((prev, name) => {
    return prev.concat(saveFiles(gameId, name));
  }, []);

  return Promise.map(savegames, save =>
    operation(path.join(sourceSavePath, save),
              path.join(destSavePath, save))
    .catch(err => {
      if (err.message.indexOf('are the same file') !== -1) {
        // User attempted to copy the same file onto itself;
        //  no point to highlight this as an error given that the save
        //  file is already there. We are going to log this though.
        log('warn', 'file already exists', err.message);
      } else {
        failedCopies.push(save + ' - ' + err.message);
      }
    }))
    .then(() => Promise.resolve(failedCopies));
}

export default transferSavegames;
