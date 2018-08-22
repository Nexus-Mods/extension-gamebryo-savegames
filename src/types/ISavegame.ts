export type SavegameState =
  'available';

export interface ISavegame {
  id: string;
  filePath: string;
  attributes: { [id: string]: any };
}
