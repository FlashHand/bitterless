// Importing xpc/preload auto-exposes xpcRenderer to window
import 'electron-buff/xpc/preload';
import { initSqlite } from './sqliteHelper/sqlite.helper';
import { initMessageServer } from './messageServer/messageServer';

const bootstrap = async (): Promise<void> => {
  await initSqlite();
  initMessageServer();
};

bootstrap().catch((err) => console.error('[sqlite.preload] bootstrap failed:', err));
