import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { CoachXpcContract, WorkbenchPane, WorkbenchTabState } from '@maestro-shared/coach.api'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

class WorkbenchStore {
  open = false
  visible = false
  initialized = false

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    xpcRenderer.subscribe('coach/workbench-visibility', (payload) => {
      this.apply(payload.params as WorkbenchTabState)
    })
    this.apply(await coach.getWorkbenchTab())
  }

  async openTab(): Promise<void> {
    this.apply(await coach.openWorkbenchTab())
  }

  async background(): Promise<void> {
    this.apply(await coach.backgroundWorkbenchTab())
  }

  async close(): Promise<void> {
    this.apply(await coach.closeWorkbenchTab())
  }

  async openPane(pane: WorkbenchPane): Promise<void> {
    await this.openTab()
    xpcRenderer.broadcast('coach/workbench-pane', { pane })
  }

  private apply(state: WorkbenchTabState): void {
    this.open = state.open
    this.visible = state.visible
  }
}

export const workbenchStore = reactive<WorkbenchStore>(new WorkbenchStore())
