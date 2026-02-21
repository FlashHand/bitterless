// Importing xpc/preload auto-exposes xpcRenderer to window
import 'electron-xpc/preload';
import { sqliteManager } from './sqliteHelper/sqlite.manager';
import { initMessageServer } from './messageServer/messageServer';
// Table imports — register table schemas before init
import { sessionTable } from './dao/session.table';
import { messageTable } from './dao/message.table';
import { settingTable } from './dao/setting.table';
// Dao imports trigger singleton creation -> auto-register xpc handlers via BaseDao
import './dao/setting.dao';
import './dao/message.dao';
import './dao/session.dao';
import { initQdrant } from './qdrantHelper/qdrant.helper';

sqliteManager.addTable(sessionTable);
sqliteManager.addTable(messageTable);
sqliteManager.addTable(settingTable);

sqliteManager.addMigration(2026021901, `
  ALTER TABLE session ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE session ADD COLUMN pinned_at TEXT;
  ALTER TABLE session ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
`);

const bootstrap = async (): Promise<void> => {
  await sqliteManager.init();
  initMessageServer();
  await initQdrant();
};

bootstrap().catch((err) => console.error('[sqlite.preload] bootstrap failed:', err));
