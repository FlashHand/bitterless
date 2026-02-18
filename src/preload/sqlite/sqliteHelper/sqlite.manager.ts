import { ipcRenderer } from 'electron';
import { join } from 'path';
import Database from 'better-sqlite3-multiple-ciphers';
import { packageHelper } from 'electron-buff/packageHelper/preload';

interface MigrationEntry {
  versionCode: number;
  sql: string;
}

const migrations: MigrationEntry[] = [];

let db: Database.Database | null = null;

const addMigration = (versionCode: number, sql: string): void => {
  migrations.push({ versionCode, sql });
};

// --- Register migrations ---

addMigration(2026021501, `
  CREATE TABLE IF NOT EXISTS message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'bitterless',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_message_conversation ON message(conversation_id);
`);

addMigration(2026021701, `
  CREATE TABLE IF NOT EXISTS setting (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Core functions ---

const runMigrations = (currentVersionCode: number): void => {
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_code INTEGER NOT NULL UNIQUE,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const executed = db
    .prepare('SELECT version_code FROM migration')
    .all()
    .map((row: any) => row.version_code as number);

  const pending = migrations
    .filter((m) => m.versionCode <= currentVersionCode && !executed.includes(m.versionCode))
    .sort((a, b) => a.versionCode - b.versionCode);

  const insertMigration = db.prepare('INSERT INTO migration (version_code) VALUES (?)');

  for (const m of pending) {
    console.log('[sqlite] running migration:', m.versionCode);
    db.exec(m.sql);
    insertMigration.run(m.versionCode);
  }

  if (pending.length > 0) {
    console.log(`[sqlite] executed ${pending.length} migration(s)`);
  }
};

export const initSqlite = async (): Promise<void> => {
  const bitterlessPath = await ipcRenderer.invoke('bitterless:get-userdata-path');
  const dbPath = join(bitterlessPath,'db', 'main.db');

  console.log('[sqlite] opening database:', dbPath);

  db = new Database(dbPath);

  db.pragma("key='123456'");
  db.pragma('cipher_page_size=8192');
  db.pragma('journal_mode=WAL');
  db.pragma('mmap_size=268435456');
  db.pragma('cache_size=2080');
  db.pragma('synchronous=normal');
  db.pragma('optimize(0x10002)');

  const packageInfo = await packageHelper.getPackageInfo();
  const currentVersionCode: number = packageInfo.versionCode || 0;
  console.log('[sqlite] current versionCode:', currentVersionCode);

  runMigrations(currentVersionCode);

  console.log('[sqlite] database initialized');
};

export const getDb = (): Database.Database => {
  if (!db) {
    throw new Error('[sqlite] database not initialized, call initSqlite() first');
  }
  return db;
};
