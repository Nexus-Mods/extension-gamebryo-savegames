export interface ISavegame {
  id: string;
  filePath: string;
  attributes: { [id: string]: any };
}
