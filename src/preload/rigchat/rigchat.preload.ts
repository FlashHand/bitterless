import { ipcRenderer } from 'electron';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { XpcPreloadHandler, createXpcPreloadEmitter } from 'electron-xpc/preload';
import { settingDao } from '../sqlite/dao/setting.dao';
import { Rigchat } from './rigchat';
import type {
  RigchatQrcodeDetail,
  RigchatLoginDetail,
  RigchatMessageDetail,
  RigchatErrorDetail,
} from './rigchat.preload.type';

const RIGCHAT_SETTING_KEY = 'RIGCHAT';

interface RigchatSettingValue {
  session: any;
}

const rigchatEmitter = createXpcPreloadEmitter<RigchatHandler>('RigchatHandler');

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

let rigchatPath = ''
let imagesPath = ''

const getRigchatPath = async (): Promise<string> => {
  if (!rigchatPath) {
    rigchatPath = await ipcRenderer.invoke('rigchat:get-path')
  }
  return rigchatPath
}

const getImagesPath = async (): Promise<string> => {
  if (!imagesPath) {
    imagesPath = await ipcRenderer.invoke('rigchat:get-images-path')
  }
  return imagesPath
}

const saveSession = async (): Promise<void> => {
  const value: RigchatSettingValue = {
    session: bot.botData,
  };
  await settingDao.upsert({ key: RIGCHAT_SETTING_KEY, value });
  console.log('[rigchat] session saved to database');
};

const loadSession = async (): Promise<any | null> => {
  try {
    const data = await settingDao.get<RigchatSettingValue>({ key: RIGCHAT_SETTING_KEY });
    if (!data || !data.session) return null;
    console.log('[rigchat] session loaded from database');
    return data.session;
  } catch {
    console.warn('[rigchat] failed to load session from database, starting fresh');
    return null;
  }
};

const deleteSession = async (): Promise<void> => {
  await settingDao.upsert({ key: RIGCHAT_SETTING_KEY, value: { session: null } });
  console.log('[rigchat] session deleted from database');
};

const saveImage = async (msgId: string, data: Buffer, contentType: string): Promise<string> => {
  const dir = await getImagesPath()
  const ext = MIME_EXT[contentType] || '.jpg'
  const filename = `${msgId}${ext}`
  const filePath = join(dir, filename)
  await writeFile(filePath, Buffer.from(data))
  return filePath
}

const bot = new Rigchat()

bot.on('uuid', (uuid) => {
  const qrcodeUrl = `https://login.weixin.qq.com/qrcode/${uuid}`;
  console.log('[rigchat] scan qrcode:', qrcodeUrl);
  rigchatEmitter.onQrcode({ qrcodeUrl }).catch((err) => console.error('[rigchat] emit qrcode failed:', err));
});

bot.on('login', () => {
  const nickName = bot.user.NickName || '';
  console.log('[rigchat] logged in:', nickName);
  rigchatEmitter.onLogin({ nickName }).catch((err) => console.error('[rigchat] emit login failed:', err));
  saveSession().catch((err) => console.error('[rigchat] save session failed:', err.message));
});

bot.on('logout', () => {
  console.log('[rigchat] logged out');
  rigchatEmitter.onLogout({}).catch((err) => console.error('[rigchat] emit logout failed:', err));
  deleteSession().catch((err) => console.error('[rigchat] delete session failed:', err.message));
});

bot.on('message', (msg) => {
  const isImage = msg.MsgType === bot.CONF.MSGTYPE_IMAGE || msg.MsgType === bot.CONF.MSGTYPE_EMOTICON;

  console.log(`[rigchat] message from ${msg.senderDisplayName} (${msg.isGroup ? 'group' : 'private'} ${msg.chatId}): ${isImage ? '[image]' : msg.Content}`);

  const baseDetail = {
    talker: msg.senderDisplayName,
    content: msg.Content,
    msgType: msg.MsgType,
    msgId: msg.MsgId,
    chatId: msg.chatId,
    isGroup: msg.isGroup,
    senderUserName: msg.senderUserName,
    senderDisplayName: msg.senderDisplayName,
    mentionList: msg.mentionList,
    isMentionSelf: msg.isMentionSelf,
    isSendBySelf: msg.isSendBySelf,
  };

  rigchatEmitter.onMessage(baseDetail).catch((err) => console.error('[rigchat] emit message failed:', err));

  if (isImage) {
    bot.getMsgImg(msg.MsgId)
      .then((img) => saveImage(msg.MsgId, img.data, img.type))
      .then((filePath) => {
        rigchatEmitter.onMessage({
          ...baseDetail,
          content: filePath,
          imagePath: filePath,
        }).catch((err) => console.error('[rigchat] emit message with image failed:', err));
      })
      .catch((err) => console.error('[rigchat] download image failed:', err.message));
  }
});

bot.on('error', (err) => {
  console.error('[rigchat] error:', err.message);
  rigchatEmitter.onError({ message: err.message }).catch((e) => console.error('[rigchat] emit error failed:', e));
});

let isInitialized = false;

const startLogin = async (): Promise<void> => {
  console.log('[rigchat] starting login flow');
  await bot.start();
};

const restoreSession = async (): Promise<void> => {
  const sessionData = await loadSession();
  if (sessionData && sessionData.PROP?.uin) {
    console.log('[rigchat] restoring session');
    bot.botData = sessionData;
    await bot.restart();
  }
};

class RigchatHandler extends XpcPreloadHandler {
  async init(): Promise<void> {
    console.log('[rigchat] init called by renderer');
    if (!isInitialized) {
      isInitialized = true;
      console.log('[rigchat] initialized, waiting for login request');
    }
  }

  async checkLogin(): Promise<{ loggedIn: boolean; nickName: string }> {
    const sessionData = await loadSession();
    const loggedIn = !!(sessionData && sessionData.PROP?.uin);
    const nickName = sessionData?.User?.NickName || '';
    console.log('[rigchat] checkLogin:', { loggedIn, nickName });
    return { loggedIn, nickName };
  }

  async startLogin(): Promise<void> {
    console.log('[rigchat] startLogin called');
    const sessionData = await loadSession();
    if (sessionData && sessionData.PROP?.uin) {
      await restoreSession();
    } else {
      await startLogin();
    }
  }

  async onQrcode(params: RigchatQrcodeDetail): Promise<void> {
    return;
  }

  async onLogin(params: RigchatLoginDetail): Promise<void> {
    return;
  }

  async onLogout(params: {}): Promise<void> {
    return;
  }

  async onMessage(params: RigchatMessageDetail): Promise<void> {
    return;
  }

  async onError(params: RigchatErrorDetail): Promise<void> {
    return;
  }
}

const rigchatHandler = new RigchatHandler();
