import { ISavegame } from './types/ISavegame';
import CharacterFilter from './util/CharacterFilter';
import { loadSaveGame } from './util/refreshSavegames';
import PluginList from './views/PluginList';
import ScreenshotCanvas from './views/ScreenshotCanvas';

import * as React from 'react';
import { TableDateTimeFilter, TableNumericFilter, TableTextFilter, types, util } from 'vortex-api';
import { IExtensionApi } from 'vortex-api/lib/types/api';
import { updateSavegame } from './actions/session';

let language: string;
let collator: Intl.Collator;

function getSavegameAttributes(api: IExtensionApi): types.ITableAttribute[] {
  const loading: Set<string> = new Set();
  const ensureLoaded = (savegame: ISavegame, attrId: string, fallback: () => any) => {
    if (savegame.attributes.screenshot === undefined) {
      if (!loading.has(savegame.id)) {
        loading.add(savegame.id);
        loadSaveGame(savegame.filePath, (save: ISavegame) => {
          api.store.dispatch(updateSavegame(save.id, save));
        })
          .then(() => {
            loading.delete(savegame.id);
          });
      }
      return fallback();
    } else {
      return savegame.attributes[attrId];
    }
  }

  return [
    {
      id: 'screenshot',
      name: 'Screenshot',
      description: 'Savegame screenshot',
      icon: ' file-picture-o',
      customRenderer: (savegame: ISavegame) => {
        console.log('render screenshot');
        return <ScreenshotCanvas save={savegame} />;
      },
      calc: (savegame: ISavegame) => ensureLoaded(savegame, 'screenshot', () => null),
      placement: 'both',
      isToggleable: false,
      edit: {},
    },
    {
      id: 'id',
      name: 'Save Game ID',
      description: 'Id of the savegame',
      icon: 'id-badge',
      calc: (savegame: ISavegame) => ensureLoaded(savegame, 'id', () => ''),
      placement: 'both',
      isToggleable: true,
      isSortable: true,
      isDefaultVisible: false,
      edit: {},
    },
    {
      id: 'name',
      name: 'Character Name',
      description: 'Name of the character',
      icon: 'quote-left',
      calc: (savegame: ISavegame) => ensureLoaded(savegame, 'name', () => ''),
      placement: 'both',
      isToggleable: true,
      isSortable: true,
      filter: new CharacterFilter(),
      edit: {},
      sortFunc: (lhs: string, rhs: string, locale: string): number => {
        if ((collator === undefined) || (locale !== language)) {
          language = locale;
          collator = new Intl.Collator(locale, { sensitivity: 'base' });
        }
        return collator.compare(lhs, rhs);
      },
    },
    {
      id: 'level',
      name: 'Character Level',
      description: 'Level of the character',
      icon: 'level-up',
      calc: (savegame: ISavegame) => ensureLoaded(savegame, 'level', () => 0),
      placement: 'both',
      isToggleable: true,
      isSortable: true,
      filter: new TableNumericFilter(),
      sortFunc: (lhs: number, rhs: number): number => lhs - rhs,
      edit: {},
    },
    {
      id: 'location',
      name: 'Ingame Location',
      description: 'Location during the save',
      icon: 'map-marker',
      calc: (savegame: ISavegame) => ensureLoaded(savegame, 'location', () => ''),
      placement: 'both',
      isToggleable: true,
      isSortable: true,
      filter: new TableTextFilter(true),
      sortFunc: (lhs: string, rhs: string, locale: string): number => {
        if ((collator === undefined) || (locale !== language)) {
          language = locale;
          collator = new Intl.Collator(locale, { sensitivity: 'base' });
        }
        return collator.compare(lhs, rhs);
      },
      edit: {},
    },
    {
      id: 'filename',
      name: 'Filename',
      description: 'Name of the file',
      icon: 'file-picture-o',
      calc: (savegame: ISavegame) => ensureLoaded(savegame, 'filename', () => ''),
      placement: 'both',
      isToggleable: true,
      isSortable: true,
      isDefaultVisible: false,
      filter: new TableTextFilter(true),
      edit: {},
    },
    {
      id: 'creationtime',
      name: 'Creation Time',
      description: 'File creation time',
      icon: 'calendar-plus-o',
      customRenderer: (savegame: ISavegame, detail: boolean, t) => {
        if (detail) {
          const lang = util.getCurrentLanguage();
          return (
            <p>
              {new Date(ensureLoaded(savegame, 'creationtime', () => 0)).toLocaleString(lang)}
            </p>
          );
        } else {
          return <p>{util.relativeTime(new Date(ensureLoaded(savegame, 'creationtime', () => 0)), t)}</p>;
        }
      },
      calc: (savegame: ISavegame) => new Date(ensureLoaded(savegame, 'creationtime', () => '')),
      placement: 'both',
      isToggleable: true,
      isSortable: true,
      filter: new TableDateTimeFilter(),
      edit: {},
    },
    {
      id: 'plugins',
      name: 'Plugins',
      description: 'Savegame plugins',
      icon: 'file-picture-o',
      customRenderer: (savegame: ISavegame) =>
        <PluginList plugins={ensureLoaded(savegame, 'plugins', () => [])} />,
      calc: (savegame: ISavegame) => ensureLoaded(savegame, 'plugins', () => []),
      placement: 'detail',
      isToggleable: false,
      edit: {},
    },
  ];
}

export default getSavegameAttributes;
