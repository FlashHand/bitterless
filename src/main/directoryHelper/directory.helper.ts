import { app, ipcMain } from 'electron';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const RIGCHAT_DIR = 'rigchat';
const RIGCHAT_IMAGES_DIR = join(RIGCHAT_DIR, 'images');

let rigchatPath = '';
let rigchatImagesPath = '';

const initRigchat = (): void => {
  const userDataPath = app.getPath('userData');
  rigchatPath = join(userDataPath, RIGCHAT_DIR);
  rigchatImagesPath = join(userDataPath, RIGCHAT_IMAGES_DIR);
  if (!existsSync(rigchatImagesPath)) {
    mkdirSync(rigchatImagesPath, { recursive: true });
    console.log('[directory] created rigchat/images:', rigchatImagesPath);
  }
};

const registerIpc = (): void => {
  ipcMain.handle('rigchat:get-path', () => rigchatPath);
  ipcMain.handle('rigchat:get-images-path', () => rigchatImagesPath);
};

export const initDirectory = (): void => {
  initRigchat();
  registerIpc();
};
