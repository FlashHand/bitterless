import { XpcPreloadHandler } from 'electron-xpc/preload'
import type { TabsApi, SavedTab } from '@maestro-shared/tabs.api'
import { sqliteManager } from './sqliteManager'

interface TabRow {
  url: string
  title: string
  favicon: string
  position: number
  kind: string
  instance_id: string
}

// XpcPreloadHandler subclass: instantiating it (bottom of file) auto-registers
// `xpc:TabsDao/<method>`, callable from main via createXpcMainEmitter<TabsApi>('TabsDao').
export class TabsDao extends XpcPreloadHandler implements TabsApi {
  async listAll(): Promise<SavedTab[]> {
    const rows = sqliteManager.db
      .prepare('SELECT url, title, favicon, position, kind, instance_id FROM tabs ORDER BY position')
      .all() as TabRow[]
    return rows.map((r) => ({
      url: r.url,
      title: r.title,
      favicon: r.favicon,
      position: r.position,
      ...(r.kind ? { kind: r.kind } : {}),
      ...(r.instance_id ? { instanceId: r.instance_id } : {})
    }))
  }

  // Replace the saved set atomically: drop all rows, then insert the new ordered set.
  async replaceAll(params: { tabs: SavedTab[] }): Promise<{ ok: boolean }> {
    const db = sqliteManager.db
    const del = db.prepare('DELETE FROM tabs')
    const ins = db.prepare(
      'INSERT INTO tabs (url, title, favicon, position, kind, instance_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const now = Date.now()
    const run = db.transaction((tabs: SavedTab[]) => {
      del.run()
      for (const t of tabs) {
        const url = (t.url || '').trim()
        const kind = (t.kind || '').trim()
        // A composite mini-app tab is legitimately URL-less — it is restored through its registered
        // spec. Dropping on empty URL alone would silently discard every such row here, one line
        // before the insert, no matter what the caller filtered for.
        if (!url && !kind) continue
        ins.run(url, t.title || '', t.favicon || '', t.position, kind, (t.instanceId || '').trim(), now)
      }
    })
    run(params.tabs || [])
    return { ok: true }
  }
}

export const tabsDao = new TabsDao()
