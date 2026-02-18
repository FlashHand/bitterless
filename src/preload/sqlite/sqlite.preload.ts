// Importing xpc/preload auto-exposes xpcRenderer to window
import 'electron-buff/xpc/preload';
import { initSqlite } from './sqliteHelper/sqlite.manager';
import { initMessageServer } from './messageServer/messageServer';
import { SettingHandler } from './handler/setting.handler';
import { MessageHandler } from './handler/message.handler';
import { initQdrant } from './qdrantHelper/qdrant.helper';

const bootstrap = async (): Promise<void> => {
  await initSqlite();
  new SettingHandler();
  new MessageHandler();
  initMessageServer();
  await initQdrant();
};

bootstrap().catch((err) => console.error('[sqlite.preload] bootstrap failed:', err));
