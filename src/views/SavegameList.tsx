import { removeSavegame, showTransferDialog } from '../actions/session';
import { ISavegame } from '../types/ISavegame';
import { mygamesPath, saveFiles } from '../util/gameSupport';
import { profileSavePath } from '../util/profileSavePath';
import { MAX_SAVEGAMES, refreshSavegames } from '../util/refreshSavegames';
import restoreSavegamePlugins, { MissingPluginsError } from '../util/restoreSavegamePlugins';
import transferSavegames from '../util/transferSavegames';

import getSavegameAttributes from '../savegameAttributes';

import * as Promise from 'bluebird';
import * as path from 'path';
import * as React from 'react';
import { Alert, FormControl, Panel } from 'react-bootstrap';
import { withTranslation } from 'react-i18next';
import { connect } from 'react-redux';
import * as Redux from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import {
  actions, ComponentEx, FlexLayout, fs, IconBar, ITableRowAction,
  log, MainPage, selectors, Spinner, Table, tooltip, types, util,
} from 'vortex-api';

const placeholder: string = '------';

interface IConnectedProps {
  currentProfile: types.IProfile;
  profiles: { [id: string]: types.IProfile };
  saves: { [saveId: string]: ISavegame };
  savesPath: string;
  savesTruncated: boolean;
  showTransfer: boolean;
  gameMode: string;
  discoveredGames: { [id: string]: types.IDiscoveryResult };
  activity: string[];
}

interface IActionProps {
  onRemoveSavegame: (savegameId: string) => void;
  onHideTransfer: () => void;
  onShowDialog: (
    type: types.DialogType,
    title: string,
    content: types.IDialogContent,
    actions: types.DialogActions) => Promise<types.IDialogResult>;
  onShowActivity: (message: string, id?: string) => void;
  onShowError: (message: string, details: any, id?: string, allowReport?: boolean) => void;
  onShowSuccess: (message: string, id?: string) => void;
  onDismissNotification: (id: string) => void;
}

interface IComponentState {
  importProfileId: string;
  importSaves: { [saveId: string]: ISavegame };
}

type Props = IConnectedProps & IActionProps;

/**
 * displays the list of savegames installed for the current game.
 *
 */
class SavegameList extends ComponentEx<Props, IComponentState> {
  private savegameActions: ITableRowAction[];
  private mTransferAttributes: types.ITableAttribute[] = [];
  private mCurrentProfileAttributes: types.ITableAttribute[] = [];

  constructor(props) {
    super(props);
    this.initState({
      importProfileId: undefined,
      importSaves: undefined,
    });

    this.savegameActions = [
      {
        icon: 'delete',
        title: props.t('Delete'),
        action: this.remove,
      },
      {
        icon: 'recover',
        title: props.t('Restore Save Game Plugins'),
        action: this.restore,
        multiRowAction: false,
      },
    ];
  }

  public componentWillMount() {
    this.mTransferAttributes = getSavegameAttributes(this.context.api, false);
    this.mCurrentProfileAttributes = getSavegameAttributes(this.context.api, true);
  }

  public componentWillReceiveProps(newProps: Props) {
    if (this.props.showTransfer !== newProps.showTransfer) {
      this.nextState.importProfileId = undefined;
    }
  }

  public render(): JSX.Element {
    const { t, activity, showTransfer } = this.props;

    let saveActions = this.savegameActions;

    let header: JSX.Element;
    if (showTransfer) {
      header = this.renderTransfer();
      saveActions = [].concat([{
        icon: 'transfer',
        title: t('Import'),
        action: this.importSaves,
      }], this.savegameActions);
    } else {
      header = (
        <IconBar
          group='savegames-icons'
          orientation='vertical'
          className='menubar'
          t={t}
        />
      );
    }

    return (
      <MainPage>
        <MainPage.Header>
          {header}
        </MainPage.Header>
        <MainPage.Body>
          {activity.length > 0 ? this.renderBusy() : this.renderContent(saveActions)}
        </MainPage.Body>
      </MainPage>
    );
  }

  private renderContent(saveActions: ITableRowAction[]) {
    const { t, savesTruncated, showTransfer, saves } = this.props;
    const { importSaves, importProfileId } = this.state;

    let content = null;
    if (!showTransfer || (importSaves !== undefined)) {
      const PanelX: any = Panel;
      content = (
        <Panel>
          <PanelX.Body>
            <FlexLayout type='column'>
              {savesTruncated && !showTransfer ? (<FlexLayout.Fixed>
                <Alert>
                  {t('For performance reasons only the {{count}} most recent '
                    + 'save games were loaded.', { replace: { count: MAX_SAVEGAMES } })}
                </Alert>
              </FlexLayout.Fixed>) : null}
              <FlexLayout.Flex>
                <Table
                  tableId='savegames'
                  data={showTransfer ? importSaves : saves}
                  actions={saveActions}
                  staticElements={showTransfer
                    ? this.mTransferAttributes
                    : this.mCurrentProfileAttributes}
                />
              </FlexLayout.Flex>
            </FlexLayout>
          </PanelX.Body>
        </Panel>
      );
    } else {
      content = (importProfileId === undefined)
        ? <h4>{t('Please select a profile to import from')}</h4>
        : <Spinner />;
    }
    return content;
  }

  private renderBusy() {
    const { t, activity } = this.props;
    if (activity.length > 0) {
      const PanelX: any = Panel;
      return (
        <FlexLayout.Fixed className='savegames-busy-panel'>
          <Panel>
            <PanelX.Body>
              <Spinner />
              {t(activity[0])}
            </PanelX.Body>
          </Panel>
        </FlexLayout.Fixed>
      );
    } else {
      return null;
    }

  }

  private renderTransfer() {
    const { t, currentProfile, profiles } = this.props;

    if (currentProfile === undefined) {
      return null;
    }

    const activeHasLocalSaves = util.getSafe(currentProfile, ['features', 'local_saves'], false);

    const profileOptions = Object.keys(profiles)
      .filter(profileId =>
        // only profiles that use local saves
        util.getSafe(profiles[profileId], ['features', 'local_saves'], false)
        // for the current game
        && (profiles[profileId].gameId === currentProfile.gameId)
        // and don't list the import target itself
        && (profiles[profileId].id !== currentProfile.id));

    return (
      <div style={{ whiteSpace: 'nowrap' }}>
        {t('Import from') + ' '}
        <FormControl
          style={{ display: 'inline-block' }}
          componentClass='select'
          onChange={this.selectProfile}
        >
          <option
            key=''
            value=''
          >
            {placeholder}
          </option>
          {activeHasLocalSaves ? (
            <option
              key='__global'
              value='__global'
            >
              {t('Global')}
            </option>
          ) : null}
          {profileOptions.map(profileId => this.renderProfilesOption(profileId))}
        </FormControl>
        <tooltip.IconButton
          id='btn-transfer-save-cancel'
          tooltip={t('Cancel')}
          icon='input-cancel'
          onClick={this.cancelTransfer}
        />
      </div>
    );
  }

  private renderProfilesOption(profileId: string): JSX.Element {
    const { t, profiles } = this.props;
    const profile = profiles[profileId];
    return (
      <option
        key={profile.id}
        value={profile.id}
      >
        {t('Profile') + ': ' + profile.name}
      </option>
    );
  }

  private cancelTransfer = () => {
    // Transfer has been cancelled, revert all
    //  transfer related state information.
    const { currentProfile } = this.props;
    this.nextState.importProfileId = currentProfile.id;
    this.nextState.importSaves = undefined;
    this.props.onHideTransfer();
  }

  private selectProfile = (evt) => {
    let profileId = evt.currentTarget.value;
    if (profileId === '') {
      profileId = undefined;
    }
    this.nextState.importProfileId = profileId;
    this.loadSaves(profileId);
  }

  private loadSaves(selectedProfileId: string): Promise<void> {
    const { currentProfile, profiles } = this.props;

    if (selectedProfileId === undefined) {
      this.nextState.importSaves = undefined;
      return Promise.resolve();
    }

    const savesPath = path.resolve(mygamesPath(currentProfile.gameId),
      selectedProfileId !== '__global'
      ? profileSavePath(profiles[selectedProfileId])
      : profileSavePath(currentProfile, true));

    const newSavegames: ISavegame[] = [];

    this.nextState.importSaves = undefined;

    return refreshSavegames(savesPath, (save: ISavegame): void => {
      newSavegames.push(save);
    }, false)
      .then(() => {
        const savesDict: { [id: string]: ISavegame } = {};
        newSavegames.forEach(save => savesDict[save.id] = save);

        this.nextState.importSaves = savesDict;
        return Promise.resolve();
      })
      .catch(err => {
        this.nextState.importSaves = {};
        this.props.onShowError('Failed to load savegames',
                               err, undefined,
                               ['ENOENT', 'ENOTFOUND'].indexOf(err.code) === -1);
      });
  }

  private restore = (instanceId: string) => {
    const { t, onDismissNotification, onShowDialog, onShowActivity,
            onShowError, onShowSuccess, saves } = this.props;
    const { discoveredGames, gameMode } = this.props;

    if (saves[instanceId] === undefined) {
      return;
    }

    const game = util.getGame(gameMode);
    const discovery = util.getSafe(discoveredGames, [gameMode], undefined);
    if ((game === undefined)
    || (discovery === undefined)
    || (discovery.path === undefined)) {
      // How is this even possible ?
      onShowError('Failed to restore plugins',
                  'Your active game is no longer discovered by Vortex; '
                + 'please manually add your game, or run the discovery '
                + 'scan on the games page.', undefined, true);
      return;
    }

    const modPath = game.getModPaths(discovery.path)[''];

    const notificationId = 'restore-plugins-id';
    onShowActivity('Restoring plugins', notificationId);

    restoreSavegamePlugins(this.context.api, modPath, saves[instanceId])
      .then(() => {
        onShowSuccess('Restoring plugins complete', notificationId);
      })
      .catch(MissingPluginsError, (err: MissingPluginsError) => {
        let restorePlugins = true;
        onShowDialog('question', t('Restore plugins'), {
          message: t('Some plugins are missing and can\'t be enabled.\n\n{{missingPlugins}}',
            {
              replace: {
                missingPlugins: err.missingPlugins.join('\n'),
              },
            }),
          options: {
            translated: true,
          },
        }, [{ label: 'Cancel' }, { label: 'Continue' }])
          .then((result: types.IDialogResult) => {
            restorePlugins = result.action === 'Continue';
            if (restorePlugins) {
              this.context.api.events.emit('set-plugin-list', saves[instanceId].attributes.plugins);
              onShowSuccess('Restored plugins for savegame', notificationId);
            } else {
              onDismissNotification(notificationId);
            }
          });
      })
      .catch((err: Error) => {
        onShowError('Failed to restore plugins', err, notificationId);
      });
  }

  private remove = (instanceIds: string[]) => {
    const { t, currentProfile, onRemoveSavegame, onShowDialog,
            onShowError, profiles } = this.props;
    const { importProfileId } = this.state;
    let doRemoveSavegame = true;

    onShowDialog('question', t('Confirm Deletion'), {
      message: t('Do you really want to remove these files?\n{{saveIds}}',
        { replace: { saveIds: instanceIds.join('\n') } }),
      options: {
        translated: true,
      },
    }, [ { label: 'Cancel' }, { label: 'Delete' } ])
      .then((result: types.IDialogResult) => {
        doRemoveSavegame = result.action === 'Delete';
        if (doRemoveSavegame) {
          // Use the profileId to resolve the correct sourcePath
          //  for the selected savegames.

          const sourceSavePath = path.resolve(mygamesPath(currentProfile.gameId),
            importProfileId !== '__global'
            ? profileSavePath(profiles[importProfileId || currentProfile.id])
            : profileSavePath(currentProfile, true));

          return Promise.map(instanceIds, id => !!id
            ? Promise.map(saveFiles(currentProfile.gameId, id), filePath =>
              fs.removeAsync(path.join(sourceSavePath, filePath))
                .catch(util.UserCanceled, () => undefined)
                .catch(err => {
                  // We're not checking for 'ENOENT' at this point given that
                  //  fs.removeAsync wrapper will resolve whenever these are
                  //  encountered.
                  if (err.code === 'EPERM') {
                    onShowError('Failed to delete savegame',
                                'The file is write protected.',
                                undefined, false);
                    return Promise.resolve();
                  }
                  return Promise.reject(err);
                })
                .then(() => {
                  onRemoveSavegame(id);
                }))
            : Promise.reject(new Error('invalid savegame id')))
            .then(() => this.refreshImportSaves())
            .catch(err => {
              onShowError('Failed to delete savegame(s), this is probably a permission problem',
                          err, undefined, false);
            });
        } else {
          return Promise.resolve();
        }
      });
  }

  // Should be called to immediately refresh the importSaves object
  private refreshImportSaves() {
    const { currentProfile, onShowError, profiles } = this.props;
    const { importSaves, importProfileId } = this.state;

    if (importProfileId === undefined) {
      return Promise.resolve();
    }

    const sourceSavePath = path.resolve(mygamesPath(currentProfile.gameId),
      importProfileId !== '__global'
      ? profileSavePath(profiles[importProfileId])
      : profileSavePath(currentProfile, true));

    const saves: ISavegame[] = [];
    return refreshSavegames(sourceSavePath, (save: ISavegame): void => {
      saves.push(save);
    }, false)
      .then(() => {
        const savesDict: { [id: string]: ISavegame } = {};
        saves.forEach(save => savesDict[save.id] = save);
        if (importSaves !== savesDict) {
          this.nextState.importSaves = savesDict;
        }
        return Promise.resolve();
      })
      .catch(err => onShowError('Unable to refresh import save list', err));
  }

  private importSaves = (instanceIds: string[]) => {
    const { t, currentProfile, onShowDialog, profiles } = this.props;
    const { importSaves, importProfileId } = this.state;

    const fileNames = instanceIds.map(id => importSaves[id].attributes['filename']);

    if (importProfileId === currentProfile.id) {
      return;
    }

    let allowErrorReport: boolean = true;
    let userCancelled: boolean = false;
    onShowDialog('question', t('Import Savegames'), {
      message: t('The following files will be imported:\n{{saveIds}}\n'
        + 'Do you want to move them or create a copy?',
        { replace: { saveIds: fileNames.join('\n') } }),
      options: {
        translated: true,
      },
    }, [
        { label: 'Cancel' },
        { label: 'Move' },
        { label: 'Copy' },
    ])
      .then((result: types.IDialogResult) => {
        if (result.action === 'Cancel') {
          userCancelled = true;
          return;
        }

        const sourceSavePath = path.resolve(mygamesPath(currentProfile.gameId),
          importProfileId !== '__global'
          ? profileSavePath(profiles[importProfileId])
          : profileSavePath(currentProfile, true));

        const destSavePath = path.resolve(mygamesPath(currentProfile.gameId),
                                          profileSavePath(currentProfile));

        const keepSource = result.action === 'Copy';
        return fs.ensureDirAsync(destSavePath)
          .then(() => transferSavegames(fileNames, sourceSavePath, destSavePath, keepSource))
          .catch(err => {
            allowErrorReport = ['EPERM', 'ENOSPC'].indexOf(err.code) === -1;
            const logLevel = allowErrorReport ? 'error' : 'warn';
            log(logLevel, 'Failed to create save game directory - ', err.code);

            return [t('Unable to create save game directory: {{dest}}\\ (Please ensure you have '
                    + 'enough space and/or full write permissions to the destination folder)',
            { replace: { dest: destSavePath } })];
          });
      })
      .then((failedCopies: string[]) => {
        this.refreshImportSaves();
        if (userCancelled) {
          this.context.api.sendNotification({
            type: 'info',
            message: t('Savegame transfer cancelled'),
            displayMS: 2000,
          });
        } else if ((failedCopies === undefined) || (failedCopies.length === 0)) {
          this.context.api.sendNotification({
            type: 'success',
            message: t('{{ count }} savegame imported', { count: fileNames.length }),
            displayMS: 2000,
          });
        } else {
          this.context.api.showErrorNotification(
            t('Not all savegames could be imported'),
            failedCopies.join('\n'), { allowReport: allowErrorReport });
        }
      })
      .catch(err => {
        this.context.api.showErrorNotification('Failed to import savegames', err);
      });
  }
}

const emptyArray = [];

function mapStateToProps(state: any): IConnectedProps {
  const currentProfile = selectors.activeProfile(state);
  return {
    currentProfile,
    profiles: state.persistent.profiles,
    saves: state.session.saves.saves,
    savesPath: state.session.saves.savegamePath,
    savesTruncated: state.session.saves.savesTruncated,
    showTransfer: state.session.saves.showDialog,
    discoveredGames: state.settings.gameMode.discovered,
    gameMode: selectors.activeGameId(state),
    activity: state.session.base.activity['savegames'] || emptyArray,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onRemoveSavegame: (savegameId: string) => dispatch(removeSavegame(savegameId)),
    onShowDialog: (type, title, content, dialogActions) =>
      dispatch(actions.showDialog(type, title, content, dialogActions)),
    onHideTransfer: () => dispatch(showTransferDialog(false)),
    onShowActivity: (message: string, id?: string) =>
      util.showActivity(dispatch, message, id),
    onShowError: (message: string, details: any, id?: string, allowReport?: boolean) =>
      util.showError(dispatch, message, details, { id, allowReport }),
    onShowSuccess: (message: string, id?: string) =>
      util.showSuccess(dispatch, message, id),
    onDismissNotification: (id: string) => dispatch(actions.dismissNotification(id)),
  };
}

export default
  withTranslation(['common', 'gamebryo-savegames'])(
    connect(mapStateToProps, mapDispatchToProps)(SavegameList) as any,
  ) as React.ComponentClass<{}>;
