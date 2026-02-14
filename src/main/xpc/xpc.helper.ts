import { xpcCenter } from 'electron-buff/xpc/main';

export const initXpc = (): void => {
  xpcCenter.init();
};
