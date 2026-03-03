import { reactive } from 'vue';
import moment from 'moment';
import { XpcRendererHandler, createXpcRendererEmitter } from 'electron-xpc/renderer';
import type {
  RigchatQrcodeDetail,
  RigchatLoginDetail,
  RigchatMessageDetail,
  RigchatErrorDetail,
} from '@preload/rigchat/rigchat.preload.type';
interface EnvDao {
  get(params: { key: string }): Promise<Record<string, string> | null>;
  upsert(params: { key: string; values: Record<string, string> }): Promise<string>;
  delete(params: { key: string }): Promise<string>;
}

const envEmitter = createXpcRendererEmitter<EnvDao>('EnvDao');

interface RigchatHandler {
  init(): Promise<void>;
  checkLogin(): Promise<{ loggedIn: boolean; nickName: string }>;
  startLogin(): Promise<void>;
}

const rigchatEmitter = createXpcRendererEmitter<RigchatHandler>('RigchatHandler');

class WechatStore {
  drawerVisible = false;
  qrcodeUrl: string | null = null;
  loggedIn = false;
  nickName = '';
  error: string | null = null;
  loggingIn = false;
  env: Record<string, string> = {};

  async init(): Promise<void> {
    console.log('[wechat] initializing connector...');
    try {
      await rigchatEmitter.init();
      const result = await rigchatEmitter.checkLogin();
      this.loggedIn = result.loggedIn;
      this.nickName = result.nickName;

      if (result.loggedIn) {
        console.log('[wechat] session restored:', result.nickName);
        await rigchatEmitter.startLogin();
      } else {
        console.log('[wechat] no saved session found');
      }
    } catch (err) {
      console.error('[wechat] init failed:', err);
    }
  }

  async openDrawer(): Promise<void> {
    this.drawerVisible = true;
    try {
      const result = await rigchatEmitter.checkLogin();
      this.loggedIn = result.loggedIn;
      this.nickName = result.nickName;
      await this.loadEnv();
    } catch (err) {
      console.error('[wechat] openDrawer checkLogin failed:', err);
    }
  }

  async loadEnv(): Promise<void> {
    try {
      const env = await envEmitter.get({ key: 'wechat' });
      this.env = env || {};
    } catch (err) {
      console.error('[wechat] loadEnv failed:', err);
      this.env = {};
    }
  }

  async saveEnv(env: Record<string, string>): Promise<void> {
    try {
      await envEmitter.upsert({ key: 'wechat', values: env });
      this.env = env;
    } catch (err) {
      console.error('[wechat] saveEnv failed:', err);
      throw err;
    }
  }

  closeDrawer(): void {
    this.drawerVisible = false;
  }

  async startLoginFlow(): Promise<void> {
    this.error = null;
    this.qrcodeUrl = null;
    this.loggingIn = true;
    try {
      await rigchatEmitter.startLogin();
    } catch (err: any) {
      console.error('[wechat] startLoginFlow failed:', err);
      this.error = err?.message || 'Login failed';
      this.loggingIn = false;
    }
  }
}

export const wechatStore = reactive<WechatStore>(new WechatStore());

class RigchatHandler extends XpcRendererHandler {
  async onQrcode(params: RigchatQrcodeDetail): Promise<void> {
    wechatStore.qrcodeUrl = params.qrcodeUrl;
    wechatStore.loggedIn = false;
    wechatStore.loggingIn = false;
  }

  async onLogin(params: RigchatLoginDetail): Promise<void> {
    wechatStore.loggedIn = true;
    wechatStore.nickName = params.nickName;
    wechatStore.qrcodeUrl = null;
    wechatStore.loggingIn = false;
  }

  async onLogout(): Promise<void> {
    wechatStore.loggedIn = false;
    wechatStore.nickName = '';
  }

  async onMessage(params: RigchatMessageDetail): Promise<void> {
    const { talker, content, msgType, msgId, imagePath } = params;
    const time = moment().format('HH:mm:ss');
    console.log('[WeChat Message]', { time, talker, content, msgType, msgId, imagePath });
  }

  async onError(params: RigchatErrorDetail): Promise<void> {
    wechatStore.error = params.message;
    wechatStore.loggingIn = false;
    wechatStore.qrcodeUrl = null;
  }
}

new RigchatHandler();
