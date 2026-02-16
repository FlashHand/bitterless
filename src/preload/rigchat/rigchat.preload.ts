import { contextBridge, ipcRenderer } from 'electron'
import { writeFile, readFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { Rigchat } from './rigchat'
import {
  RIGCHAT_EVENT,
  type RigchatQrcodeDetail,
  type RigchatLoginDetail,
  type RigchatMessageDetail,
  type RigchatErrorDetail,
  type RigchatApi,
} from './rigchat.preload.type'

const SESSION_FILE = 'session.json'

const emit = <T>(eventName: string, detail: T): void => {
  window.dispatchEvent(new CustomEvent(eventName, { detail }))
}

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

const getSessionFilePath = async (): Promise<string> => {
  const dir = await getRigchatPath()
  return join(dir, SESSION_FILE)
}

const saveSession = async (): Promise<void> => {
  const filePath = await getSessionFilePath()
  const data = JSON.stringify(bot.botData, null, 2)
  await writeFile(filePath, data, 'utf-8')
  console.log('[rigchat] session saved')
}

const loadSession = async (): Promise<any | null> => {
  const filePath = await getSessionFilePath()
  if (!existsSync(filePath)) return null
  try {
    const raw = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw)
    console.log('[rigchat] session loaded from disk')
    return data
  } catch {
    console.warn('[rigchat] failed to load session file, starting fresh')
    return null
  }
}

const deleteSession = async (): Promise<void> => {
  const filePath = await getSessionFilePath()
  if (existsSync(filePath)) {
    await unlink(filePath)
    console.log('[rigchat] session deleted')
  }
}

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
  const qrcodeUrl = `https://login.weixin.qq.com/qrcode/${uuid}`
  console.log('[rigchat] scan qrcode:', qrcodeUrl)
  emit<RigchatQrcodeDetail>(RIGCHAT_EVENT.QRCODE, { qrcodeUrl })
})

bot.on('login', () => {
  const nickName = bot.user.NickName || ''
  console.log('[rigchat] logged in:', nickName)
  emit<RigchatLoginDetail>(RIGCHAT_EVENT.LOGIN, { nickName })
  saveSession().catch((err) => console.error('[rigchat] save session failed:', err.message))
})

bot.on('logout', () => {
  console.log('[rigchat] logged out')
  emit(RIGCHAT_EVENT.LOGOUT, {})
  deleteSession().catch((err) => console.error('[rigchat] delete session failed:', err.message))
})

bot.on('message', (msg) => {
  const from = bot.contacts[msg.FromUserName]
  const talker = from?.NickName || from?.RemarkName || msg.FromUserName
  const isImage = msg.MsgType === bot.CONF.MSGTYPE_IMAGE || msg.MsgType === bot.CONF.MSGTYPE_EMOTICON

  console.log(`[rigchat] message from ${talker}: ${isImage ? '[image]' : msg.Content}`)

  emit<RigchatMessageDetail>(RIGCHAT_EVENT.MESSAGE, {
    talker,
    content: msg.Content,
    msgType: msg.MsgType,
    msgId: msg.MsgId,
  })

  if (isImage) {
    bot.getMsgImg(msg.MsgId)
      .then((img) => saveImage(msg.MsgId, img.data, img.type))
      .then((filePath) => {
        emit<RigchatMessageDetail>(RIGCHAT_EVENT.MESSAGE, {
          talker,
          content: filePath,
          msgType: msg.MsgType,
          msgId: msg.MsgId,
          imagePath: filePath,
        })
      })
      .catch((err) => console.error('[rigchat] download image failed:', err.message))
  }
})

bot.on('error', (err) => {
  console.error('[rigchat] error:', err.message)
  emit<RigchatErrorDetail>(RIGCHAT_EVENT.ERROR, { message: err.message })
})

const bootstrap = async (): Promise<void> => {
  const sessionData = await loadSession()
  if (sessionData && sessionData.PROP?.uin) {
    bot.botData = sessionData
    await bot.restart()
  } else {
    await bot.start()
  }
}

const rigchatApi: RigchatApi = {
  init: () => {
    console.log('[rigchat] init called by renderer')
    bootstrap()
      .then(() => console.log('[rigchat] bot bootstrap complete'))
      .catch((e) => console.error('[rigchat] bot bootstrap failed:', e))
  },
}

contextBridge.exposeInMainWorld('rigchatApi', rigchatApi)
