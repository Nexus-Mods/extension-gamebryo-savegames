import * as Promise from 'bluebird';
import * as path from 'path';
import { fs } from 'vortex-api';
import { ISavegame } from '../types/ISavegame';

/**
 * copy or move a list of savegame files
 *
 * @param {string} sourceSavePath
 * @param {string} destSavePath
 * @param {boolean} justCopy
 */
function transferSavegames(savegames: ISavegame[],
                           destSavePath: string,
                           keepSource: boolean): Promise<string[]> {
  const failedCopies: string[] = [];

  const operation = keepSource ? fs.copyAsync : fs.renameAsync;

  return Promise.map(savegames, save => {
    return operation(path.join(save.filePath),
              path.join(destSavePath, save.attributes['filename']))
    .catch(err => {
      failedCopies.push(save + ' - ' + err.message);
    })
  }).then(() => Promise.resolve(failedCopies));
    
}

export default transferSavegames;
