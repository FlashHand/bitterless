import { EventEmitter } from 'node:events';

export const runtime = {
  views: [] as WebContentsView[],
  windows: [] as BaseWindow[],
  loadGate: null as Promise<void> | null
};

class Contents extends EventEmitter {
  destroyed = false;
  mainFrame = {};
  loads = 0;
  focused = false;
  url = '';
  openHandler?: () => { action: string };
  isDestroyed(): boolean {
    return this.destroyed;
  }
  getURL(): string {
    return this.url;
  }
  focus(): void {
    this.focused = true;
  }
  setWindowOpenHandler(handler: () => { action: string }): void {
    this.openHandler = handler;
  }
  close(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      this.emit('destroyed');
    }
  }
  async loadFile(path: string): Promise<void> {
    await this.loadURL(`file://${path}`);
  }
  async loadURL(url: string): Promise<void> {
    this.url = url;
    this.loads += 1;
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('load aborted'));
      this.once('destroyed', abort);
    });
    try {
      await Promise.race([runtime.loadGate ?? Promise.resolve(), cancelled]);
    } finally {
      this.removeListener('destroyed', abort);
    }
  }
}

export class View {
  parent: View | null = null;
  children = new Set<View>();
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  visible = true;
  failAttach = false;
  addChildView(view: View): void {
    if (this.failAttach) throw new Error('attach failed');
    if (view.parent) throw new Error('view already attached');
    this.children.add(view);
    view.parent = this;
  }
  removeChildView(view: View): void {
    this.children.delete(view);
    if (view.parent === this) view.parent = null;
  }
  setBounds(bounds: View['bounds']): void {
    this.bounds = bounds;
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
}

export class WebContentsView extends View {
  webContents = new Contents();
  constructor(readonly options: unknown) {
    super();
    runtime.views.push(this);
  }
}

export class BaseWindow extends EventEmitter {
  contentView = new View();
  destroyed = false;
  shown = false;
  focused = false;
  minimized = false;
  width = 900;
  height = 700;
  constructor(readonly options: unknown = {}) {
    super();
    runtime.windows.push(this);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  isMinimized(): boolean {
    return this.minimized;
  }
  restore(): void {
    this.minimized = false;
  }
  show(): void {
    this.shown = true;
  }
  focus(): void {
    this.focused = true;
  }
  getContentSize(): number[] {
    return [this.width, this.height];
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

export const app = { getPath: () => '/tmp/bitterless-trench-host-unit' };
export const windowStateService = {
  has: () => true,
  resolve: () => null,
  importLegacy: () => undefined,
  register: (_key: string, window: BaseWindow) => ({
    flushAndDispose: () => undefined,
    show: () => window.show()
  })
};
