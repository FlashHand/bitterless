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
    class Contents extends EventEmitter { constructor(){super();this.closed=false;} setWindowOpenHandler(handler){this.openHandler=handler;} setIgnoreMenuShortcuts(value){this.ignore=value;} async loadURL(url){this.url=url;} isDestroyed(){return this.closed;} close(){this.closed=true;} }
    class BrowserWindow extends EventEmitter { constructor(options){super();this.options=options;this.dead=false;this.visible=false;this.contentView={children:[],addChildView:(v)=>this.contentView.children.push(v),removeChildView:(v)=>{this.contentView.children=this.contentView.children.filter(x=>x!==v);}};windows.push(this);} getContentSize(){return [1000,700];} isDestroyed(){return this.dead;} isMinimized(){return false;} show(){this.visible=true;} focus(){} async loadFile(file){this.file=file;} async loadURL(url){this.url=url;} close(){this.dead=true;this.emit('closed');} destroy(){this.close();} }
    class WebContentsView { constructor(options){this.options=options;this.webContents=new Contents();views.push(this);} setBounds(bounds){this.bounds=bounds;} }
    module.exports={BrowserWindow,WebContentsView,app:{getAppPath:()=>'/fixture'},windows,views};`,
  '@electron-toolkit/utils': `exports.is={dev:false};`,
  '@main/windows/windowState.service': `exports.windowStateService={resolve:()=>null,register:()=>({show(){},flushAndDispose(){}})};`,
  './zellijRuntime.service': `let listener;let stopCount=0;let state={enabled:false,status:'idle'};const session={setPermissionRequestHandler(fn){this.request=fn;},setPermissionCheckHandler(fn){this.check=fn;}};
    exports.ZELLIJ_ORIGIN='http://127.0.0.1:12877';exports.zellijTerminalSession=()=>session;exports.subscribeZellijState=fn=>{listener=fn;};exports.getZellijRuntime=()=>({snapshot:()=>state,stop:async()=>{stopCount++;},reportViewFailure:()=>{state={...state,status:'error'};listener(state);}});exports.change=next=>{state=next;listener(next);};exports.stops=()=>stopCount;`
};
await build({
  stdin: {
    contents: `export {zellijWindowService,isZellijNavigationAllowed} from '${process.cwd()}/src/main/zellij/zellijWindow.service.ts'; export {windows,views} from 'electron'; export {change,stops} from './zellijRuntime.service';`,
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
  stops
} = createRequire(import.meta.url)(output);
test.after(() => rmSync(root, { recursive: true, force: true }));

test('singleton local window embeds an isolated no-preload view only after readiness and bounds stay inside content', async () => {
  await Promise.all([service.open(), service.open()]);
  assert.equal(windows.length, 1);
  assert.equal(views.length, 0);
  change({ enabled: true, status: 'ready' });
  assert.equal(views.length, 1);
  const view = views[0];
  assert.equal(view.options.webPreferences.preload, undefined);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.equal(view.options.webPreferences.webSecurity, true);
  assert.equal(view.webContents.ignore, true);
  assert.deepEqual(view.webContents.openHandler(), { action: 'deny' });
  service.setContentBounds({ x: 0, y: 170, width: 4000, height: 2000 });
  assert.deepEqual(view.bounds, { x: 0, y: 170, width: 1000, height: 530 });
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
  assert.equal(isZellijNavigationAllowed('http://127.0.0.1:12877/session/work'), true);
  assert.equal(isZellijNavigationAllowed('http://localhost:12877'), false);
  assert.equal(isZellijNavigationAllowed('file:///etc/passwd'), false);
  change({ enabled: false, status: 'idle' });
  assert.equal(view.webContents.closed, true);
  assert.equal(windows[0].contentView.children.length, 0);
});

test('closing a miniapp closes its web contents while keeping the runtime; auth/quit explicitly stop it', async () => {
  change({ enabled: true, status: 'ready' });
  const view = views.at(-1);
  service.close();
  assert.equal(view.webContents.closed, true);
  assert.equal(stops(), 0);
  await service.open();
  assert.equal(windows.length, 2);
  assert.equal(windows[1].contentView.children.length, 1);
  await service.destroy();
  assert.equal(stops(), 1);
  assert.equal(views.at(-1).webContents.closed, true);
});
