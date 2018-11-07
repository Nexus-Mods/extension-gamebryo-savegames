import { ISavegame } from '../types/ISavegame';

import savegameLibInit, { Dimensions } from 'gamebryo-savegame';
import * as React from 'react';
import { log } from 'vortex-api';

const savegameLib = savegameLibInit('savegameLib');

interface ICanvasProps {
  save: ISavegame;
}

// current typings know neither the function nor the return value
declare const createImageBitmap: (imgData: ImageData) => Promise<any>;

class ScreenshotCanvas extends React.Component<ICanvasProps, {}> {
  private screenshotCanvas: HTMLCanvasElement;

  public componentDidMount() {
    const ctx: CanvasRenderingContext2D = this.screenshotCanvas.getContext('2d');
    const imgData: ImageData = ctx.createImageData(
      Math.max(this.screenshotCanvas.width, 1), Math.max(this.screenshotCanvas.height, 1));

    try {
      const sg = new savegameLib.GamebryoSaveGame(this.props.save.filePath);
      sg.screenshot(imgData.data);
      createImageBitmap(imgData)
        .then((bitmap) => {
          ctx.drawImage(bitmap, 0, 0);
        });
    } catch (err) {
      log('warn', 'failed to read savegame screenshot', { fileName: this.props.save.filePath, error: err.message });
    }
  }

  public render(): JSX.Element {
    const { save } = this.props;
    if (save === undefined) {
      return null;
    }
    const dim: Dimensions = (save.attributes as any).screenshot;
    return (
      <canvas
        className='screenshot-canvas'
        ref={this.refCanvas}
        width={dim.width}
        height={dim.height}
      />);
  }

  private refCanvas = (ref) => {
    this.screenshotCanvas = ref;
  }
}

export default ScreenshotCanvas;
