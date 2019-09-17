import { clearSavegames, setSavegamePath,
   setSavegames, showTransferDialog } from './actions/session';
import { sessionReducer } from './reducers/session';
import { settingsReducer } from './reducers/settings';
import { ISavegame } from './types/ISavegame';
import {gameSupported, iniPath, mygamesPath} from './util/gameSupport';
import { profileSavePath } from './util/profileSavePath';
import { refreshSavegames } from './util/refreshSavegames';
import SavegameList from './views/SavegameList';
import Settings from './views/Settings';

import * as Promise from 'bluebird';
import { remote } from 'electron';
import * as path from 'path';
import * as Redux from 'redux';
import { actions, fs, log, selectors, types, util } from 'vortex-api';
import {IniFile} from 'vortex-parse-ini';

function applySaveSettings(api: types.IExtensionApi,
                           profile: types.IProfile,
                           iniFile: IniFile<any>) {
  const savePath = profileSavePath(profile);

  if (iniFile.data.General === undefined) {
    iniFile.data.General = {};
  }
  // TODO: we should provide a way for the user to set his own
  //   save path without overwriting it
  iniFile.data.General.SLocalSavePath = savePath;

  const { store } = api;
  store.dispatch(setSavegamePath(savePath));
}

function updateSaves(store: Redux.Store<any>,
                     savesPath: string): Promise<string[]> {
  const newSavegames: ISavegame[] = [];

  return refreshSavegames(savesPath, (save: ISavegame): void => {
    if (store.getState().session.saves[save.id] === undefined) {
      newSavegames.push(save);
    }
  }, true)
  .then(({ failedReads, truncated }) => Promise.resolve({ newSavegames, failedReads, truncated }))
  .then((result: { newSavegames: ISavegame[], failedReads: string[], truncated: boolean }) => {
    const savesDict: { [id: string]: ISavegame } = {};
    result.newSavegames.forEach(
      (save: ISavegame) => { savesDict[save.id] = save; });

    store.dispatch(setSavegames(savesDict, result.truncated));
    return Promise.resolve(result.failedReads);
  });
}

let missedUpdate: { profileId: string, savesPath: string };

function genUpdateSavegameHandler(api: types.IExtensionApi) {
  return (profileId: string, savesPath: string) => {
    if (!remote.getCurrentWindow().isFocused()) {
      missedUpdate = { profileId, savesPath };
      return Promise.resolve();
    }

    api.store.dispatch(actions.startActivity('savegames', 'Loading'));

    missedUpdate = undefined;
    return updateSaves(api.store, savesPath)
      .then((failedReadsInner: string[]) => {
        if (failedReadsInner.length > 0) {
          api.showErrorNotification('Some saves couldn\'t be read',
            failedReadsInner.join('\n'), {
              allowReport: false,
              id: 'saves-not-read',
              isBBCode: true,
            });
        }
      })
      .catch(err => {
        api.showErrorNotification('Failed to read save games', err, {
          id: 'saves-not-read',
        });
      })
      .finally(() => {
        api.store.dispatch(actions.stopActivity('savegames', 'Loading'));
      });
  };
}

function getSavesPath(profile: types.IProfile) {
  const savePath = profileSavePath(profile);

  return path.join(mygamesPath(profile.gameId), savePath);
}

function openSavegamesDirectory(api: types.IExtensionApi, profileId: string) {
  const state: types.IState = api.store.getState();
  const profile = state.persistent.profiles[profileId];
  const hasLocalSaves = util.getSafe(profile, ['features', 'local_saves'], false);
  const profileSavesPath = hasLocalSaves
    ? path.join(mygamesPath(profile.gameId), 'Saves', profile.id)
    : path.join(mygamesPath(profile.gameId), 'Saves');
  fs.ensureDirAsync(profileSavesPath)
    .then(() => util.opn(profileSavesPath))
    .catch(err => api.showErrorNotification(
      'Failed to open savegame directory', err, { allowReport: (err as any).code !== 'ENOENT' }));

}

interface IExtensionContextExt extends types.IExtensionContext {
  registerProfileFeature: (featureId: string, type: string, icon: string,
                           label: string, description: string, supported: () => boolean) => void;
}

function updateSavegames(api: types.IExtensionApi, update: util.Debouncer) {
  const state = api.store.getState();
  const profile = selectors.activeProfile(state);

  if (profile === undefined) {
    return Promise.resolve();
  }

  if (!gameSupported(profile.gameId)) {
    return Promise.resolve();
  }

  const savesPath = getSavesPath(profile);

  update.schedule(undefined, profile.id, savesPath);
}

function onProfileChange(api: types.IExtensionApi, profileId: string, update: util.Debouncer) {
  const {store} = api;
  const state = store.getState();

  if (profileId === undefined) {
    return;
  }

  const prof = selectors.profileById(state, profileId);
  if (!gameSupported(prof.gameId)) {
    return;
  }

  const savePath = profileSavePath(prof);
  store.dispatch(setSavegamePath(savePath));
}

function onProfilesModified(store: Redux.Store<any>,
                            update: util.Debouncer,
                            oldProfiles: { [profileId: string]: types.IProfile },
                            newProfiles: { [profileId: string]: types.IProfile }) {
  const prof = selectors.activeProfile(store.getState());
  if (prof === undefined) {
    return;
  }

  const localSavesBefore =
    util.getSafe(oldProfiles, [prof.id, 'features', 'local_saves'], false);
  const localSavesAfter =
    util.getSafe(newProfiles, [prof.id, 'features', 'local_saves'], false);

  if (localSavesBefore !== localSavesAfter) {
    store.dispatch(clearSavegames());
    const savePath = profileSavePath(prof);
    const savesPath = path.join(mygamesPath(prof.gameId), savePath);
    store.dispatch(setSavegamePath(savePath));
    update.schedule(undefined, prof.id, savesPath);
  }
}

function once(context: types.IExtensionContext, update: util.Debouncer) {
  const store: Redux.Store<any> = context.api.store;

  context.api.setStylesheet('savegame-management',
    path.join(__dirname, 'savegame_management.scss'));

  const onFocus = () => {
    if (missedUpdate !== undefined) {
      update.schedule(undefined, missedUpdate.profileId, missedUpdate.savesPath);
    }
  };

  remote.getCurrentWindow().on('focus', onFocus);

  window.addEventListener('beforeunload', () => {
    remote.getCurrentWindow().removeListener('focus', onFocus);
  });

  context.api.onStateChange(['persistent', 'profiles'],
    (oldProfiles: { [profileId: string]: types.IProfile },
     newProfiles: { [profileId: string]: types.IProfile }) => {
       onProfilesModified(store, update, oldProfiles, newProfiles);
    });

  context.api.onAsync('apply-settings',
    (prof: types.IProfile, filePath: string, ini: IniFile<any>) => {
      log('debug', 'apply savegame settings', { gameId: prof.gameId, filePath });
      if (gameSupported(prof.gameId)
        && (filePath.toLowerCase() === iniPath(prof.gameId).toLowerCase())) {
        applySaveSettings(context.api, prof, ini);
        store.dispatch(clearSavegames());
        const savePath = profileSavePath(prof);
        const savesPath = path.join(mygamesPath(prof.gameId), savePath);
        update.schedule(undefined, prof.id, savesPath);
      }
      return Promise.resolve();
    });

  context.api.events.on('profile-did-change', (profileId: string) =>
    onProfileChange(context.api, profileId, update));

  remote.getCurrentWindow().on('focus', () => {
    updateSavegames(context.api, update);
  });

  {
    const profile = selectors.activeProfile(store.getState());
    if (profile !== undefined) {
      const savePath = profileSavePath(profile);
      store.dispatch(setSavegamePath(savePath));
    }
  }
}

function init(context: IExtensionContextExt): boolean {
  context.registerAction('savegames-icons', 200, 'transfer', {}, 'Transfer Save Games', () => {
    context.api.store.dispatch(showTransferDialog(true));
  });

  context.registerAction('savegames-icons', 100, 'refresh', {}, 'Refresh', () => {
    const profile = selectors.activeProfile(context.api.store.getState());
    update.runNow(undefined, profile.id, getSavesPath(profile));
  });

  context.registerMainPage('savegame', 'Save Games', SavegameList, {
    hotkey: 'A',
    group: 'per-game',
    visible: () => gameSupported(selectors.activeGameId(context.api.store.getState())),
  });

  const update = new util.Debouncer(genUpdateSavegameHandler(context.api), 1000);

  context.registerReducer(['session', 'saves'], sessionReducer);
  context.registerReducer(['settings', 'saves'], settingsReducer);
  context.registerProfileFeature(
    'local_saves', 'boolean', 'savegame', 'Save Games', 'This profile has its own save games',
    () => gameSupported(selectors.activeGameId(context.api.store.getState())));

  context.registerAction('profile-actions', 100, 'open-ext', {},
                         'Open Save Games', (instanceIds: string[]) => {
    openSavegamesDirectory(context.api, instanceIds[0]);
  }, (instanceIds: string[]) => {
    const state: types.IState = context.api.store.getState();
    const profile = state.persistent.profiles[instanceIds[0]];
    return gameSupported(profile.gameId);
  });

  context.once(() => once(context, update));

  return true;
}

export default init;
