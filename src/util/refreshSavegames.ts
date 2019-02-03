import { ISavegame } from '../types/ISavegame';
import { buf2hex } from './buf2hex';

import * as Promise from 'bluebird';
import savegameLibInit from 'gamebryo-savegame';
import * as path from 'path';
import { fs, log, util } from 'vortex-api';

const savegameLib = savegameLibInit('savegameLib');

class Dimensions {
  public width: number;
  public height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

/**
 * reads the savegame dir and adds savegames missing in our database
 *
 * @param {string} savesPath
 * @param {(save: ISavegame) => void} onAddSavegame
 */
export function refreshSavegames(savesPath: string,
                                 onAddSavegame: (save: ISavegame) => void): Promise<string[]> {
  const failedReads: string[] = [];
  return fs.readdirAsync(savesPath)
    .catch(err => (err.code === 'ENOENT')
      ? Promise.resolve([])
      : Promise.reject(err))
    .filter((savePath: string) =>
      ['.ess', '.fos'].indexOf(path.extname(savePath).toLowerCase()) !== -1)
    .then((savegameNames: string[]) =>
      Promise.each(savegameNames, (savegameName: string) => {
        const savegamePath = path.join(savesPath, savegameName);
        const fileName = path.basename(savegamePath);
        onAddSavegame({ id: fileName, filePath: savegamePath, attributes: { name: fileName } });
      }))
    .then(() => Promise.resolve(failedReads));
}

function timestampFormat(timestamp: number) {
  const date: Date = new Date(timestamp * 1000);
  return date;
}

export function loadSaveGame(filePath: string, onAddSavegame: (save: ISavegame) => void,
                             tries: number = 2): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      savegameLib.create(filePath, (err, sg) => {
        if (err !== null) {
          return reject(err);
        }
        const save: ISavegame = {
          id: path.basename(filePath),
          filePath,
          attributes: {
            id: sg.saveNumber,
            name: sg.characterName,
            level: sg.characterLevel,
            filename: path.basename(filePath),
            location: sg.location,
            plugins: sg.plugins,
            screenshot: {
              width: sg.screenshotSize.width,
              height: sg.screenshotSize.height,
            },
            screenshotData: buf2hex(sg.screenshot),
            isToggleable: true,
            creationtime: timestampFormat(sg.creationTime),
          },
        };

        onAddSavegame(save);
        resolve();
      });
    } catch (err) {
      if (err.message.startsWith('failed to open')) {
        // error messages from the lib aren't very enlightening unfortunately.
        // it could be a temporary problem (i.e. the game currently writing the
        // save and thus it would be locked so try again).
        // this opens the file with a js function, if that fails too we get a
        // better error message we may be able to handle
        fs.openAsync(filePath, 'r')
          .then(() => reject(err))
          .catch(fserr => reject(fserr));
      } else {
        reject(err);
      }
    }
  })
    .catch(err => (tries > 0)
      ? loadSaveGame(filePath, onAddSavegame, tries - 1)
      : Promise.reject(err));
}
