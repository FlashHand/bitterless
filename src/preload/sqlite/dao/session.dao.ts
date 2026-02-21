import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';

export interface SessionRow {
  id: number;
  session_id: string;
  platform: string;
  title: string;
  pinned: number;
  pinned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionInsertParams {
  sessionId: string;
  title?: string;
  platform?: string;
}

class SessionDao extends BaseDao {
  /** Create a new session */
  create(params: SessionInsertParams): SessionRow | undefined {
    sqliteHelper.safeRun(
      'INSERT INTO session (session_id, title, platform) VALUES (?, ?, ?)',
      [params.sessionId, params.title ?? 'New Session', params.platform ?? 'bitterless'],
    );
    return sqliteHelper.safeGet<SessionRow>(
      'SELECT * FROM session WHERE session_id = ?',
      [params.sessionId],
    );
  }

  /** Get all sessions: pinned first (pinned_at DESC), then by updated_at DESC */
  getAll(): SessionRow[] {
    return sqliteHelper.safeAll<SessionRow>(
      'SELECT * FROM session ORDER BY pinned DESC, pinned_at DESC, updated_at DESC',
      [],
    );
  }

  /** Get a session by session_id */
  getBySessionId(params: { sessionId: string }): SessionRow | undefined {
    return sqliteHelper.safeGet<SessionRow>(
      'SELECT * FROM session WHERE session_id = ?',
      [params.sessionId],
    );
  }

  /** Update session title */
  updateTitle(params: { sessionId: string; title: string }): void {
    sqliteHelper.safeRun(
      "UPDATE session SET title = ?, updated_at = datetime('now') WHERE session_id = ?",
      [params.title, params.sessionId],
    );
  }

  /** Touch updated_at timestamp */
  touch(params: { sessionId: string }): void {
    sqliteHelper.safeRun(
      "UPDATE session SET updated_at = datetime('now') WHERE session_id = ?",
      [params.sessionId],
    );
  }

  /** Pin a session */
  pin(params: { sessionId: string }): void {
    sqliteHelper.safeRun(
      "UPDATE session SET pinned = 1, pinned_at = datetime('now'), updated_at = datetime('now') WHERE session_id = ?",
      [params.sessionId],
    );
  }

  /** Unpin a session */
  unpin(params: { sessionId: string }): void {
    sqliteHelper.safeRun(
      "UPDATE session SET pinned = 0, pinned_at = NULL, updated_at = datetime('now') WHERE session_id = ?",
      [params.sessionId],
    );
  }

  /** Delete a session by session_id */
  delete(params: { sessionId: string }): void {
    sqliteHelper.safeRun(
      'DELETE FROM session WHERE session_id = ?',
      [params.sessionId],
    );
  }
}

export const sessionDao = new SessionDao();
