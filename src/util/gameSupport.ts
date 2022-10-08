import * as path from 'path';
import * as Redux from 'redux';
import { selectors, types, util } from 'vortex-api';

interface IGameSupport {
  mygamesPath: string;
  iniName: string;
  prefIniName?: string;
  saveFiles: (input: string) => string[];
}

function scriptExtenderFiles(input: string, seext: string): string[] {
  const ext = path.extname(input);
  return [path.basename(input, ext) + '.' + seext];
}

const gameSupportXboxPass: { [key: string]: any } = {
  skyrimse: {
    mygamesPath: 'Skyrim Special Edition MS',
  },
  fallout4: {
    mygamesPath: 'Fallout4 MS',
  },
};

const gameSupportGOG: { [key: string]: any } = {
  skyrimse: {
    mygamesPath: 'Skyrim Special Edition GOG',
  },
};

const gameSupportEpic: { [key: string]: any } = {
  skyrimse: {
    mygamesPath: 'Skyrim Special Edition EPIC',
  },
};

const gameSupport: { [key: string]: IGameSupport } = {
  skyrim: {
    mygamesPath: 'skyrim',
    iniName: 'Skyrim.ini',
    prefIniName: 'SkyrimPrefs.ini',
    saveFiles: (input: string): string[] => {
      return [].concat([input], scriptExtenderFiles(input, 'skse'));
    },
  },
  enderal: {
    mygamesPath: 'enderal',
    iniName: 'Enderal.ini',
    prefIniName: 'EnderalPrefs.ini',
    saveFiles: (input: string): string[] =>
      [].concat([input], scriptExtenderFiles(input, 'skse')),
  },
  skyrimse: {
    mygamesPath: 'Skyrim Special Edition',
    iniName: 'Skyrim.ini',
    prefIniName: 'SkyrimPrefs.ini',
    saveFiles: (input: string): string[] => {
      return [].concat([input], scriptExtenderFiles(input, 'skse'));
    },
  },
  skyrimvr: {
    mygamesPath: 'Skyrim VR',
    iniName: 'SkyrimVR.ini',
    prefIniName: 'SkyrimPrefs.ini',
    saveFiles: (input: string): string[] => {
      return [].concat([input], scriptExtenderFiles(input, 'skse'));
    },
  },
  fallout3: {
    mygamesPath: 'Fallout3',
    iniName: 'Fallout.ini',
    prefIniName: 'FalloutPrefs.ini',
    saveFiles: (input: string): string[] => {
      return [].concat([input], scriptExtenderFiles(input, 'fose'));
    },
  },
  fallout4: {
    mygamesPath: 'Fallout4',
    iniName: 'Fallout4Custom.ini',
    prefIniName: 'Fallout4Prefs.ini',
    saveFiles: (input: string): string[] => {
      return [].concat([input], scriptExtenderFiles(input, 'f4se'));
    },
  },
  fallout4vr: {
    mygamesPath: 'Fallout4VR',
    iniName: 'Fallout4Custom.ini',
    saveFiles: (input: string): string[] => {
      return [].concat([input], scriptExtenderFiles(input, 'f4se'));
    },
  },
  falloutnv: {
    mygamesPath: 'FalloutNV',
    iniName: 'Fallout.ini',
    prefIniName: 'FalloutPrefs.ini',
    saveFiles: (input: string): string[] => {
      return [].concat([input], scriptExtenderFiles(input, 'nvse'));
    },
  },
  oblivion: {
    mygamesPath: 'Oblivion',
    iniName: 'Oblivion.ini',
    saveFiles: (input: string): string[] => {
      return [].concat([input], scriptExtenderFiles(input, 'obse'));
    },
  },
  enderalspecialedition: {
    mygamesPath: 'Enderal Special Edition',
    iniName: 'Enderal.ini',
    prefIniName: 'EnderalPrefs.ini',
    saveFiles: (input: string): string[] =>
      [].concat([input], scriptExtenderFiles(input, 'skse')),
  },
};

function isXboxPath(discoveryPath: string) {
  const hasPathElement = (element) =>
    discoveryPath.toLowerCase().includes(element);
  return ['modifiablewindowsapps', '3275kfvn8vcwc'].find(hasPathElement) !== undefined;
}

let gameStoreForGame: (gameId: string) => string = () => undefined;

export function initGameSupport(store: Redux.Store<types.IState>) {
  gameStoreForGame = (gameId: string) => selectors.discoveryByGame(store.getState(), gameId)['store'];

  const state: types.IState = store.getState();

  const {discovered} = state.settings.gameMode;

  Object.keys(gameSupportXboxPass).forEach(gameMode => {
    if (discovered[gameMode]?.path !== undefined) {
      if (isXboxPath(discovered[gameMode].path)) {
        gameSupport[gameMode].mygamesPath = gameSupportXboxPass[gameMode].mygamesPath;
      }
    }
  });

  if (discovered['enderalspecialedition']?.path !== undefined) {
    if (discovered['enderalspecialedition']?.path.toLowerCase().includes('skyrim')) {
      gameSupport['enderalspecialedition'].mygamesPath = 'Skyrim Special Edition';
      gameSupport['enderalspecialedition'].iniName = 'Skyrim.ini';
      gameSupport['enderalspecialedition'].prefIniName = 'SkyrimPrefs.ini';
    }
  }
}

export function gameSupported(gameMode: string): boolean {
  return gameSupport[gameMode] !== undefined;
}

export function mygamesPath(gameMode: string): string {
  const gameStore = gameStoreForGame(gameMode);

  let relPath;

  switch(gameStore) {
    case 'gog': relPath = gameSupportGOG[gameMode]?.appDataPath || gameSupport[gameMode].appDataPath;
    break;
    case 'epic': relPath = gameSupportEpic[gameMode]?.appDataPath || gameSupport[gameMode].appDataPath;
    break;
    case 'xbox': relPath = gameSupportXboxPass[gameMode]?.appDataPath || gameSupport[gameMode].appDataPath;
    break;
    default: relPath = gameSupport[gameMode].appDataPath;
  }
  
  return path.join(util.getVortexPath('documents'), 'My Games', relPath);
}

export function iniPath(gameMode: string): string {
  const { iniName } = gameSupport[gameMode];
  return path.join(mygamesPath(gameMode), iniName);
}

export function prefIniPath(gameMode: string): string {
  const { prefIniName } = gameSupport[gameMode];
  if (prefIniName === undefined) {
    return undefined;
  }
  return path.join(mygamesPath(gameMode), prefIniName);
}

export function saveFiles(gameMode: string, savePath: string): string[] {
  return gameSupport[gameMode].saveFiles(savePath);
}
