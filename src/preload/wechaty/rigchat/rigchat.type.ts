export interface RigchatProp {
  uuid: string
  uin: string
  sid: string
  skey: string
  passTicket: string
  formatedSyncKey: string
  webwxDataTicket: string
  syncKey: { List: SyncKeyItem[] }
}

export interface SyncKeyItem {
  Key: number
  Val: number
}

export interface RigchatConf {
  origin: string
  baseUri: string
  API_jsLogin: string
  API_login: string
  API_synccheck: string
  API_webwxdownloadmedia: string
  API_webwxuploadmedia: string
  API_webwxinit: string
  API_webwxgetcontact: string
  API_webwxsync: string
  API_webwxbatchgetcontact: string
  API_webwxsendmsg: string
  API_webwxsendmsgimg: string
  API_webwxsendemoticon: string
  API_webwxsendappmsg: string
  API_webwxsendvideomsg: string
  API_webwxstatusnotify: string
  API_webwxlogout: string
  API_webwxgetmsgimg: string
  API_webwxgetvideo: string
  API_webwxgetvoice: string
  API_webwxgetheadimg: string
  API_webwxoplog: string
  API_webwxverifyuser: string
  API_webwxupdatechatroom: string
  API_webwxcreatechatroom: string
  API_webwxreport: string
  API_webwxrevokemsg: string
  SYNCCHECK_RET_SUCCESS: number
  SYNCCHECK_RET_LOGOUT: number
  SYNCCHECK_SELECTOR_NORMAL: number
  SYNCCHECK_SELECTOR_MSG: number
  MSGTYPE_TEXT: number
  MSGTYPE_IMAGE: number
  MSGTYPE_VOICE: number
  MSGTYPE_VIDEO: number
  MSGTYPE_MICROVIDEO: number
  MSGTYPE_EMOTICON: number
  MSGTYPE_APP: number
  MSGTYPE_LOCATION: number
  MSGTYPE_STATUSNOTIFY: number
  MSGTYPE_SYS: number
  MSGTYPE_RECALLED: number
  MSGTYPE_POSSIBLEFRIEND_MSG: number
  MSGTYPE_VERIFYMSG: number
  MSGTYPE_SHARECARD: number
  STATE: {
    init: string
    uuid: string
    login: string
    logout: string
  }
  [key: string]: unknown
}

export interface RigchatUser {
  UserName: string
  NickName: string
  HeadImgUrl: string
  Sex: number
  Signature: string
  [key: string]: unknown
}

export interface RigchatContact {
  UserName: string
  NickName: string
  RemarkName: string
  HeadImgUrl: string
  Sex: number
  Signature: string
  VerifyFlag: number
  ContactFlag: number
  MemberCount: number
  MemberList: RigchatContact[]
  DisplayName: string
  PYQuanPin: string
  RemarkPYQuanPin: string
  [key: string]: unknown
}

export interface RigchatMessage {
  MsgId: string
  MsgType: number
  Content: string
  FromUserName: string
  ToUserName: string
  CreateTime: number
  StatusNotifyUserName: string
  StatusNotifyCode: number
  FileName: string
  FileSize: string
  MediaId: string
  Url: string
  AppMsgType: number
  SubMsgType: number
  isSendBySelf: boolean
  OriginalContent: string
  [key: string]: unknown
}

export interface RigchatBaseRequest {
  Uin: number
  Sid: string
  Skey: string
  DeviceID: string
}

export interface RigchatSyncData {
  BaseResponse: { Ret: number }
  AddMsgCount: number
  AddMsgList: RigchatMessage[]
  ModContactCount: number
  ModContactList: RigchatContact[]
  SKey: string
  SyncKey: { List: SyncKeyItem[] }
  SyncCheckKey: { List: SyncKeyItem[] }
}

export interface RigchatInitData {
  BaseResponse: { Ret: number }
  User: RigchatUser
  SKey: string
  SyncKey: { List: SyncKeyItem[] }
  SyncCheckKey: { List: SyncKeyItem[] }
  ContactList: RigchatContact[]
}

export type RigchatEventMap = {
  uuid: (uuid: string) => void
  'user-avatar': (avatar: string) => void
  login: () => void
  logout: () => void
  message: (msg: RigchatMessage) => void
  'contacts-updated': (contacts: RigchatContact[]) => void
  error: (err: Error) => void
}
