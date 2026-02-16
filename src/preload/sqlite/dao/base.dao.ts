import Database from 'better-sqlite3-multiple-ciphers';
import { getDb } from '../sqliteHelper/sqlite.helper';

export class BaseDao {
  protected get db(): Database.Database {
    return getDb();
  }
}