export const RIGCHAT_EVENT = {
  QRCODE: 'rigchat:qrcode',
  LOGIN: 'rigchat:login',
  LOGOUT: 'rigchat:logout',
  MESSAGE: 'rigchat:message',
  ERROR: 'rigchat:error',
} as const;

export interface RigchatQrcodeDetail {
  qrcodeUrl: string;
}

export interface RigchatLoginDetail {
  nickName: string;
}

export interface RigchatMessageDetail {
  talker: string;
  content: string;
  msgType: number;
  msgId: string;
  imagePath?: string;
  chatId: string;
  isGroup: boolean;
  senderUserName: string;
  senderDisplayName: string;
  mentionList: string[];
  isMentionSelf: boolean;
  isSendBySelf: boolean;
}

export interface RigchatErrorDetail {
  message: string;
}

export interface RigchatApi {
  init: () => void;
}
