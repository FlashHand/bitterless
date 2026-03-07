// Disable LangChain from fetching tiktoken vocabulary from external CDN
process.env['LANGCHAIN_CALLBACKS_BACKGROUND'] = 'false';
process.env['TIKTOKEN_CACHE_DIR'] = '';

// Importing xpc/preload auto-exposes xpcRenderer to window
import 'electron-xpc/preload';
import { sqliteManager } from './sqliteHelper/sqlite.manager';
import { initMessageServer } from './messageServer/messageServer';
// Table imports — register table schemas before init
import { sessionTable } from './dao/session.table';
import { messageTable } from './dao/message.table';
import { settingTable } from './dao/setting.table';
import { envTable } from './dao/env.table';
// Dao imports trigger singleton creation -> auto-register xpc handlers via BaseDao
import './dao/setting.dao';
import './dao/message.dao';
import './dao/session.dao';
import './dao/env.dao';
import { initQdrant } from './qdrantHelper/qdrant.helper';
import { pathHelper } from '@shared/pathHelper/preload/pathPreload.helper';
import * as path from 'path';
import * as fs from 'fs';

sqliteManager.addTable(sessionTable);
sqliteManager.addTable(messageTable);
sqliteManager.addTable(settingTable);
sqliteManager.addTable(envTable);

const loadTiktokenLocal = async (): Promise<void> => {
  try {
    const appPath = await pathHelper.getAppPath();
    const tiktokenPath = path.join(appPath, 'external_resources', 'gpt2.json');
    console.log('[sqlite.preload] loading local tiktoken from:', tiktokenPath);
    
    if (fs.existsSync(tiktokenPath)) {
      const tiktokenData = fs.readFileSync(tiktokenPath, 'utf-8');
      const encoding = JSON.parse(tiktokenData);
      (globalThis as any).__tiktoken_gpt2__ = encoding;
      console.log('[sqlite.preload] tiktoken gpt2 loaded from local');
    } else {
      console.warn('[sqlite.preload] tiktoken gpt2.json not found at:', tiktokenPath);
    }
  } catch (err: any) {
    console.error('[sqlite.preload] failed to load local tiktoken:', err.message);
  }
};

const bootstrap = async (): Promise<void> => {
  await loadTiktokenLocal();
  await sqliteManager.init();
  initMessageServer();
  await initQdrant();
};

bootstrap().catch((err) => console.error('[sqlite.preload] bootstrap failed:', err));
