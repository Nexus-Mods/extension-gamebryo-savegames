import { clearSavegames, setSavegamePath,
   setSavegames, showTransferDialog } from './actions/session';
import { sessionReducer } from './reducers/session';
import { ISavegame } from './types/ISavegame';
import {gameSupported, iniPath, mygamesPath, prefIniPath} from './util/gameSupport';
import refreshSavegames from './util/refreshSavegames';
import SavegameList from './views/SavegameList';

import * as Promise from 'bluebird';
import { remote } from 'electron';
import * as path from 'path';
import * as Redux from 'redux';
import { fs, log, selectors, types, util } from 'vortex-api';
import {IniFile} from 'vortex-parse-ini';

let fsWatcher: fs.FSWatcher;

function profileSavePath(profile: types.IProfile) {
  const localSaves = util.getSafe(profile, ['features', 'local_saves'], false);
  return localSaves
    ? path.join('Saves', profile.id) + path.sep
    : 'Saves' + path.sep;
}

function applySaveSettings(api: types.IExtensionApi, profile: types.IProfile, iniFile: IniFile<any>) {
  const savePath = profileSavePath(profile);

  if (iniFile.data.General === undefined) {
    iniFile.data.General = {};
  }
  // TODO: we should provide a way for the user to set his own
  //   save path without overwriting it
  iniFile.data.General.SLocalSavePath = savePath;

  const { store } = api;
  store.dispatch(setSavegamePath(savePath));
  store.dispatch(clearSavegames());
}

function updateSaves(store: Redux.Store<any>,
                     savesPath: string): Promise<string[]> {
  const newSavegames: ISavegame[] = [];

  return refreshSavegames(savesPath, (save: ISavegame): void => {
    if (store.getState().session.saves[save.id] === undefined) {
      newSavegames.push(save);
    }
  })
  .then((failedReads: string[]) => Promise.resolve({ newSavegames, failedReads }))
  .then((result: { newSavegames: ISavegame[], failedReads: string[] }) => {
    const savesDict: { [id: string]: ISavegame } = {};
    result.newSavegames.forEach(
      (save: ISavegame) => { savesDict[save.id] = save; });

    store.dispatch(setSavegames(savesDict));
    return Promise.resolve(result.failedReads);
  });
}

interface IExtensionContextExt extends types.IExtensionContext {
  registerProfileFeature: (featureId: string, type: string, icon: string, label: string, description: string,
       supported: () => boolean) => void;
}

function init(context: IExtensionContextExt): boolean {
  context.registerAction('savegames-icons', 200, 'transfer', {}, 'Transfer Save Games', () => {
    context.api.store.dispatch(showTransferDialog(true));
  });

  context.registerMainPage('savegame', 'Save Games', SavegameList, {
    hotkey: 'A',
    group: 'per-game',
    visible: () => gameSupported(selectors.activeGameId(context.api.store.getState())),
  });

  context.registerReducer(['session', 'saves'], sessionReducer);
  context.registerProfileFeature(
      'local_saves', 'boolean', 'savegame', 'Save Games', 'This profile has its own save games',
      () => gameSupported(selectors.activeGameId(context.api.store.getState())));
  context.registerAction('profile-actions', 100, 'open-ext', {}, 'Open Save Games', (instanceIds: string[]) => {
    const state: types.IState = context.api.store.getState();
    const profile = state.persistent.profiles[instanceIds[0]];
    const hasLocalSaves = util.getSafe(profile, ['features', 'local_saves'], false);
    const profileSavesPath = hasLocalSaves
        ? path.join(mygamesPath(profile.gameId), 'Saves', profile.id)
        : path.join(mygamesPath(profile.gameId), 'Saves');
    fs.ensureDirAsync(profileSavesPath)
      .then(() => (util as any).opn(profileSavesPath))
      .catch(err => context.api.showErrorNotification('Failed to open savegame directory', err));
  }, (instanceIds: string[]) => {
    const state: types.IState = context.api.store.getState();
    const profile = state.persistent.profiles[instanceIds[0]];
    return gameSupported(profile.gameId);
  });

  context.once(() => {
    const store: Redux.Store<any> = context.api.store;
    let missedUpdate: { profileId: string, savesPath: string };

    context.api.setStylesheet('savegame-management',
                              path.join(__dirname, 'savegame_management.scss'));

    const update = new util.Debouncer((profileId: string, savesPath: string) => {
      if (!remote.getCurrentWindow().isFocused()) {
        missedUpdate = { profileId, savesPath };
        return Promise.resolve();
      }

      missedUpdate = undefined;
      return updateSaves(store, savesPath)
        .then((failedReadsInner: string[]) => {
          if (failedReadsInner.length > 0) {
            context.api.showErrorNotification('Some saves couldn\'t be read',
              failedReadsInner.join('\n'), { allowReport: false });
          }
        });
    }, 1000);

    remote.getCurrentWindow().on('focus', () => {
      if (missedUpdate !== undefined) {
        update.schedule(undefined, missedUpdate.profileId, missedUpdate.savesPath);
      }
    });

    context.api.onAsync('apply-settings', (profile: types.IProfile, filePath: string, ini: IniFile<any>) => {
      if (gameSupported(profile.gameId) && (filePath.toLowerCase() === iniPath(profile.gameId).toLowerCase())) {
        applySaveSettings(context.api, profile, ini);
      }
      return Promise.resolve();
    });

    context.api.events.on('profile-did-change', (profileId: string) => {
      const state = context.api.store.getState();
      const profile = selectors.profileById(state, profileId);
      const savesPath = path.join(mygamesPath(profile.gameId), profileSavePath(profile));
      if (fsWatcher !== undefined) {
        fsWatcher.close();
      }
      try {
        fsWatcher =
          fs.watch(savesPath, {}, (evt: string, filename: string) => {
            update.schedule(undefined, profileId, savesPath);
          });
        fsWatcher.on('error', error => {
          // going by the amount of feedback on this it appears like it's a very common thing to
          // delete your savegame directory...
          log('warn', 'failed to watch savegame directory', { savesPath, error });
          fsWatcher.close();
          fsWatcher = undefined;
        });
      } catch (err) {
        context.api.showErrorNotification('Can\'t watch saves directory for changes', {
          path: savesPath, error: err.message,
        });
      }
    });
  });

  return true;
}

export default init;
