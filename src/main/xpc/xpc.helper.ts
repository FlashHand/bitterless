import { xpcCenter } from 'electron-xpc/main';
import { initTestHandler } from './test.handler';

export const initXpc = (): void => {
  xpcCenter.init();
  initTestHandler();
};
