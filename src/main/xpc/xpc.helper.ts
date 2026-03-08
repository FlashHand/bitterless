import { xpcCenter } from 'electron-xpc/main';
import { initTestHandler } from './test.handler';
import { ptyManager } from '../ptyHelper/ptyManager';
import { PtyService } from '../ptyHelper/ptyXpc';

export const initXpc = (): void => {
  xpcCenter.init();
  initTestHandler();
  
  ptyManager.init().catch((err) => {
    console.error('[xpc] ptyManager init failed:', err);
  });
  
  new PtyService();
};
