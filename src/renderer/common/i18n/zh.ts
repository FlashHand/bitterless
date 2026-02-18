import type { en } from './en';

export const zh: typeof en = {
  chat: {
    inputPlaceHolder: '输入消息，Enter 发送，Shift+Enter 换行',
  },
  setting: {
    title: '设置',
    database: {
      tabTitle: '数据库',
      sqlitePassword: 'SQLite 密码',
      sqlitePasswordPlaceholder: '请输入 SQLite 加密密码',
      qdrantApiKey: 'Qdrant API 密钥',
      qdrantApiKeyPlaceholder: '请输入 Qdrant API 密钥',
      save: '保存',
      saveSuccess: '保存成功',
      saveFailed: '保存失败',
    },
  },
};
