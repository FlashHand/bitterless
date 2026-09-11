import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = mkdtempSync(join(tmpdir(), 'zellij-window-test-'));
const output = join(root, 'window.cjs');
const modules = {
  electron: `const {EventEmitter}=require('node:events');
    const windows=[]; const views=[];
    class Contents extends EventEmitter { constructor(){super();this.closed=false;} setWindowOpenHandler(handler){this.openHandler=handler;} setIgnoreMenuShortcuts(value){this.ignore=value;} focus(){this.focused=true;} async loadURL(url){this.url=url;} async loadFile(file,options){this.file=file;this.query=options&&options.query;} isDevToolsOpened(){return false;} openDevTools(){} isDestroyed(){return this.closed;} close(){this.closed=true;} }
    class BrowserWindow extends EventEmitter { constructor(options){super();this.options=options;this.dead=false;this.visible=false;this.contentView={children:[],addChildView:(v)=>this.contentView.children.push(v),removeChildView:(v)=>{this.contentView.children=this.contentView.children.filter(x=>x!==v);}};windows.push(this);} getContentSize(){return [1000,700];} isDestroyed(){return this.dead;} isMinimized(){return false;} show(){this.visible=true;} focus(){} async loadFile(file){this.file=file;} async loadURL(url){this.url=url;} close(){this.dead=true;this.emit('closed');} destroy(){this.close();} }
    class View { constructor(){this.children=[];this.visible=true;} addChildView(v){this.children.push(v);} removeChildView(v){this.children=this.children.filter(x=>x!==v);} setBounds(b){this.bounds=b;} setVisible(v){this.visible=v;} }
    class WebContentsView extends View { constructor(options){super();this.options=options;this.webContents=new Contents();views.push(this);} }
    module.exports={BrowserWindow,WebContentsView,View,app:{getAppPath:()=>'/fixture'},windows,views};`,
  '@electron-toolkit/utils': `exports.is={dev:false};`,
  '@shared/zellij/zellij.type': `exports.ZELLIJ_SURFACE_QUERY='surface';`,
  './zellijDevTools.helper': `exports.bindZellijDevTools=()=>{};exports.autoOpenZellijDevTools=()=>{};`,
  './zellijKeyBridge': `exports.bindZellijKeyBridge=()=>{};`,
  '@maestro-main/common/shortcutsHelper/shortcuts.helper': `exports.setTerminalKeyboardOwner=()=>{};exports.guardWindowCloseShortcut=()=>{};`,
  '@main/windows/windowState.service': `exports.windowStateService={resolve:()=>null,register:()=>({show(){},flushAndDispose(){}})};`,
  './zellijRuntime.service': `const listeners=new Set();let stopCount=0;let state={enabled:false,status:'idle'};const session={setPermissionRequestHandler(fn){this.request=fn;},setPermissionCheckHandler(fn){this.check=fn;}};
    const emit=(s)=>{for(const l of [...listeners]) l(s);};
    exports.zellijOrigin=()=>'http://127.0.0.1:12902';exports.zellijTerminalUrl=(id)=>'http://127.0.0.1:12902/bitterless-'+id;exports.zellijTerminalSession=()=>session;
    // Faithful to the real contract: a Set plus a disposer. A single-slot stub would hide exactly
    // the bug this shape exists to prevent.
    exports.subscribeZellijState=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
    exports.listenerCount=()=>listeners.size;
    exports.getZellijRuntime=()=>({snapshot:()=>state,stop:async()=>{stopCount++;},reportViewFailure:()=>{state={...state,status:'error'};emit(state);}});exports.change=next=>{state=next;emit(next);};exports.stops=()=>stopCount;`
};
await build({
  stdin: {
    contents: `export {zellijWindowService,isZellijNavigationAllowed} from '${process.cwd()}/src/main/zellij/zellijWindow.service.ts'; export {windows,views} from 'electron'; export {change,stops,listenerCount} from './zellijRuntime.service';`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output,
  plugins: [
    {
      name: 'fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          args.path in modules ? { path: args.path, namespace: 'fixture' } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: modules[args.path],
          loader: 'js'
        }));
      }
    }
  ]
});
const {
  zellijWindowService: service,
  isZellijNavigationAllowed,
  windows,
  views,
  change,
  stops,
  listenerCount
} = createRequire(import.meta.url)(output);
test.after(() => rmSync(root, { recursive: true, force: true }));

test('singleton local window embeds an isolated no-preload view only after readiness and bounds stay inside content', async () => {
  await Promise.all([service.open(), service.open()]);
  assert.equal(windows.length, 1);
  // The chrome is now a VIEW inside a container, not the window's own page — that is what makes the
  // same surface carryable into a Maestro tab. So one view exists before readiness: the chrome.
  assert.equal(views.length, 1, 'the chrome view exists immediately');
  const controls = views[0];
  assert.match(String(controls.options.webPreferences.preload), /zellij\.js$/);
  change({ enabled: true, status: 'ready' });
  assert.equal(views.length, 2, 'the terminal is added only after readiness');
  const view = views[1];
  assert.equal(view.options.webPreferences.preload, undefined);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.equal(view.options.webPreferences.webSecurity, true);
  assert.equal(view.webContents.ignore, true);
  assert.deepEqual(view.webContents.openHandler(), { action: 'deny' });
  // The standalone window's surface answers to a fixed id; an unknown one must move nothing —
  // mis-laying-out a stranger's terminal is worse than ignoring the message.
  const untouched = { ...view.bounds };
  service.setContentBounds('not-a-surface', { x: 0, y: 10, width: 10, height: 10 });
  assert.deepEqual(view.bounds, untouched, 'an unknown surface id lays out nothing at all');
  service.setContentBounds('window', { x: 0, y: 170, width: 4000, height: 2000 });
  assert.deepEqual(view.bounds, { x: 0, y: 170, width: 1000, height: 530 });
  assert.equal(controls.webContents.query.surface, 'window', 'the chrome is told which surface it is');
  let prevented = false;
  view.webContents.emit(
    'will-navigate',
    {
      preventDefault: () => {
        prevented = true;
      }
    },
    'https://example.test'
  );
  assert.equal(prevented, true);
  assert.equal(isZellijNavigationAllowed('http://127.0.0.1:12902/session/work'), true);
  assert.equal(isZellijNavigationAllowed('http://localhost:12902'), false);
  assert.equal(isZellijNavigationAllowed('file:///etc/passwd'), false);
  change({ enabled: false, status: 'idle' });
  assert.equal(view.webContents.closed, true);
  // The window still carries the container; only the terminal child went away.
  assert.equal(windows[0].contentView.children.length, 1, 'the container survives');
  assert.equal(controls.webContents.closed, false, 'the chrome survives a runtime going idle');
});

test('closing a miniapp closes its web contents while keeping the runtime; auth/quit explicitly stop it', async () => {
  change({ enabled: true, status: 'ready' });
  const view = views.at(-1);
  service.close();
  assert.equal(view.webContents.closed, true);
  assert.equal(stops(), 0);
  await service.open();
  assert.equal(windows.length, 2);
  assert.equal(windows[1].contentView.children.length, 1, 'one container per window');
  await service.destroy();
  assert.equal(stops(), 1);
  assert.equal(views.at(-1).webContents.closed, true);
});

/** A stand-in Maestro composite-tab host, one per tab, with its own `instanceId`. */
const makeTabHost = (instanceId, rect = { x: 0, y: 0, width: 900, height: 600 }) => {
  const container = { attached: false };
  const host = {
    instanceId,
    window: () => windows.at(-1) ?? null,
    contentRect: () => rect,
    attach: (view) => {
      container.attached = true;
      container.view = view;
    },
    detach: () => {
      container.attached = false;
    },
    activate: () => {
      container.activated = true;
    },
    close: () => {
      container.closed = true;
    },
    setTitle: () => {},
    setDisplayUrl: () => {},
    isOpen: () => true
  };
  return { host, container };
};

test('two tabs are two surfaces on two sessions — not two views onto one', async () => {
  // The defect Ral hit: one surface for the whole app meant the second tab MOVED the live terminal
  // out of the first, and "Initialize and open" reattached to the previous session.
  await service.open(); // a window must exist for host.window() to resolve
  change({ enabled: true, status: 'ready' });
  const before = views.length;
  const a = makeTabHost('aaaaaaaaaaaa');
  const b = makeTabHost('bbbbbbbbbbbb');
  await service.openOnTab(a.host);
  await service.openOnTab(b.host);

  assert.equal(a.container.attached, true, 'the first tab keeps its own surface');
  assert.equal(b.container.attached, true);
  assert.notEqual(a.container.view, b.container.view, 'each tab carries its OWN container');
  // Chrome + terminal per surface, and the standalone one is NOT recycled into the first tab: a tab
  // carries the surface named by its own `instanceId`, so two tabs mean two new pairs.
  assert.equal(views.length, before + 4, 'each tab builds its own chrome + terminal');

  const terminalOf = (id) => views.find((v) => v.webContents.url?.endsWith('/bitterless-' + id));
  assert.ok(terminalOf('bbbbbbbbbbbb'), 'tab B loads its OWN session URL');

  // Geometry is addressed per surface: measuring B must not move A.
  service.setContentBounds('bbbbbbbbbbbb', { x: 0, y: 50, width: 800, height: 400 });
  const movedA = terminalOf('aaaaaaaaaaaa')?.bounds;
  assert.notDeepEqual(terminalOf('bbbbbbbbbbbb').bounds, movedA ?? null);

  // Closing one tab takes only its own surface down.
  service.closeTab(b.host);
  assert.equal(b.container.attached, false);
  assert.equal(a.container.attached, true, 'closing tab B leaves tab A running');
  service.closeTab(a.host);
  await service.destroy();
});

test('a surface unsubscribes on teardown, so listeners do not accumulate across window lifetimes', async () => {
  // The registry is a Set now, so a missed disposal ACCUMULATES a dead listener that still drives a
  // destroyed view — where the old single-slot design hid the same mistake by overwriting. That is
  // why the disposer has to be pinned, not just the subscribe.
  const baseline = listenerCount();
  await service.open();
  assert.equal(listenerCount(), baseline + 1, 'opening registers exactly one listener');
  await service.open();
  assert.equal(listenerCount(), baseline + 1, 'reopening an already-open window does not double-subscribe');
  service.close();
  assert.equal(listenerCount(), baseline, 'closing removes it again');
  await service.open();
  await service.destroy();
  assert.equal(listenerCount(), baseline, 'destroy leaves nothing behind');
});
