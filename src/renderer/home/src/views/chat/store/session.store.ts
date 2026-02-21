import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';

export interface SessionItem {
  sessionId: string;
  title: string;
  pinned: boolean;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

class SessionStore {
  sessionList: SessionItem[] = [];
  currentSessionId = '';
  loading = false;
}

export const sessionStore = reactive<SessionStore>(new SessionStore());

/** Load all sessions from DB */
export const loadSessions = async (): Promise<void> => {
  sessionStore.loading = true;
  const result = await xpcRenderer.send('SessionDao/getAll', {});
  if (Array.isArray(result)) {
    sessionStore.sessionList = result.map((row: any) => ({
      sessionId: row.session_id,
      title: row.title,
      pinned: row.pinned === 1,
      pinnedAt: row.pinned_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  sessionStore.loading = false;
};

/** Create a new session and select it */
export const createSession = async (): Promise<string> => {
  const sessionId = `session_${Date.now()}`;
  await xpcRenderer.send('SessionDao/create', { sessionId });
  await loadSessions();
  sessionStore.currentSessionId = sessionId;
  return sessionId;
};

/** Select a session */
export const selectSession = (sessionId: string): void => {
  sessionStore.currentSessionId = sessionId;
};

/** Delete a session */
export const deleteSession = async (sessionId: string): Promise<void> => {
  await xpcRenderer.send('SessionDao/delete', { sessionId });
  if (sessionStore.currentSessionId === sessionId) {
    sessionStore.currentSessionId = '';
  }
  await loadSessions();
};

/** Rename a session */
export const renameSession = async (sessionId: string, title: string): Promise<void> => {
  await xpcRenderer.send('SessionDao/updateTitle', { sessionId, title });
  await loadSessions();
};

/** Pin a session */
export const pinSession = async (sessionId: string): Promise<void> => {
  await xpcRenderer.send('SessionDao/pin', { sessionId });
  await loadSessions();
};

/** Unpin a session */
export const unpinSession = async (sessionId: string): Promise<void> => {
  await xpcRenderer.send('SessionDao/unpin', { sessionId });
  await loadSessions();
};

/** Touch session updated_at (e.g. after sending a message) */
export const touchSession = async (sessionId: string): Promise<void> => {
  await xpcRenderer.send('SessionDao/touch', { sessionId });
};
