// Importing xpc/preload auto-exposes xpcRenderer to window
import 'electron-buff/xpc/preload';
import { sqliteManager } from './sqliteHelper/sqlite.manager';
import { initMessageServer } from './messageServer/messageServer';
// Table imports — register table schemas before init
import { messageTable } from './dao/message.table';
import { settingTable } from './dao/setting.table';
import { keychainTable } from './dao/keychain.table';
// Dao imports trigger singleton creation -> auto-register xpc handlers via BaseDao
import './dao/setting.dao';
import './dao/message.dao';
import './dao/keychain.dao';
import { initQdrant } from './qdrantHelper/qdrant.helper';

sqliteManager.addTable(messageTable);
sqliteManager.addTable(settingTable);
sqliteManager.addTable(keychainTable);

const bootstrap = async (): Promise<void> => {
  await sqliteManager.init();
  initMessageServer();
  await initQdrant();
};

bootstrap().catch((err) => console.error('[sqlite.preload] bootstrap failed:', err));
