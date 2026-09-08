/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const nodeRequire = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents: `
      export { OnlyPreviewPreviewViewService } from './src/main/miniapps/onlypreview/views/onlyPreviewPreviewView.service';
      export { onlyPreviewViewLayerService } from './src/main/miniapps/onlypreview/views/onlyPreviewViewLayer.service';
    `,
    resolveDir: root,
    loader: 'ts'
  },
  tsconfig: resolve(root, 'tsconfig.node.json'),
  bundle: true,
  write: false,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron', '@main/miniapps/onlypreview/onlyPreviewProtocol.service']
});

// Run the real preview-view service, contract and layer ordering. Only native Electron and file
// protocol registration are substituted; focus is application-wide, not limited to child views.
export const createPreviewFocusHarness = () => {
  const state = {
    focused: null,
    focusClaims: [],
    focusQueries: 0,
    alive: true,
    activeSurface: 'vue',
    views: [],
    onFocus: null
  };
  class NativeWebContents extends EventEmitter {
    destroyed = false;
    mainFrame = {
      isDestroyed: () => this.destroyed,
      framesInSubtree: [{
        url: 'bitterless-preview://asset/test.pdf',
        isDestroyed: () => this.destroyed
      }]
    };
    session = Object.assign(new EventEmitter(), {
      webRequest: { onBeforeRequest: () => undefined },
      setPermissionCheckHandler: () => undefined,
      setPermissionRequestHandler: () => undefined,
      setProxy: async () => undefined,
      closeAllConnections: async () => undefined,
      clearStorageData: async () => undefined,
      clearCache: async () => undefined
    });
    isDestroyed() { return this.destroyed; }
    isFocused() { return state.focused === this; }
    focus() {
      const previous = state.focused;
      state.focused = this;
      state.focusClaims.push(this);
      state.onFocus?.(this, previous);
    }
    close() {
      this.destroyed = true;
      if (state.focused === this) state.focused = null;
    }
    setWebRTCIPHandlingPolicy() { return undefined; }
    setWindowOpenHandler() { return undefined; }
    async loadURL(url) { this.url = url; }
  }
  class NativeView {
    children = [];
    visible = true;
    bounds = { x: 0, y: 0, width: 1000, height: 600 };
    getVisible() { return this.visible; }
    setVisible(value) { this.visible = value; }
    getBounds() { return this.bounds; }
    setBounds(value) { this.bounds = { ...value }; }
    addChildView(view) {
      this.removeChildView(view);
      this.children.push(view);
    }
    removeChildView(view) { this.children = this.children.filter((child) => child !== view); }
  }
  class NativeWebContentsView extends NativeView {
    webContents = new NativeWebContents();
    constructor() {
      super();
      state.views.push(this);
    }
  }
  const electron = {
    WebContentsView: NativeWebContentsView,
    webContents: {
      getFocusedWebContents: () => {
        state.focusQueries += 1;
        return state.focused;
      }
    }
  };
  const loaded = { exports: {} };
  const require = (specifier) => {
    if (specifier === 'electron') return electron;
    if (specifier === '@main/miniapps/onlypreview/onlyPreviewProtocol.service') {
      return { installOnlyPreviewSessionProtocol: () => () => undefined };
    }
    return nodeRequire(specifier);
  };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
    require, loaded, loaded.exports
  );
  const { OnlyPreviewPreviewViewService, onlyPreviewViewLayerService } = loaded.exports;
  const container = new NativeView();
  const runtime = {
    isHostLive: () => state.alive,
    container,
    host: { hostId: 'focus-host', hostToken: 'focus-test-token' },
    createVuePreviewView: () => new NativeWebContentsView(),
    loadVuePreviewView: async () => undefined,
    bindChromeShortcuts: (contents) => { contents.shortcutsBound = true; }
  };
  const service = new OnlyPreviewPreviewViewService({
    getActiveSurface: () => state.activeSurface,
    canAttachVue: () => true,
    getDocumentLoadingRevision: () => null,
    isCurrent: (candidate) => candidate === runtime,
    bindFindWebContents: () => undefined,
    unbindFindWebContents: () => undefined,
    onVueUnavailable: (_runtime, error) => { throw error; },
    onChromeReady: () => undefined,
    onChromeUnavailable: (_runtime, _view, _revision, error) => { throw error; }
  });
  service.start(runtime);
  onlyPreviewViewLayerService.start(container);
  return {
    state, service, runtime, container,
    newContents: () => new NativeWebContents(),
    newView: () => new NativeWebContentsView(),
    layers: onlyPreviewViewLayerService,
    updateWidth: (width) => service.updateBounds({ x: 250, y: 40, width, height: 550 }),
    replacePdf: async () => {
      state.activeSurface = 'chrome';
      service.destroyChromePreviewView();
      await service.stageChromeSelection(runtime, 1, 'bitterless-preview://asset/test.pdf', true);
      return service.getChromePreviewView();
    }
  };
};
