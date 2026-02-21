import { createI18n } from 'vue-i18n';
import { reactive } from 'vue';
import { en } from './en';
import { zh } from './zh';

type MessageSchema = typeof en;

const detectLocale = (): 'en' | 'zh' => {
  console.log('detectLocale',navigator.language);
  const lang = navigator.language ?? 'en';
  if (lang.startsWith('zh')) {
    return 'zh';
  }
  return 'en';
};

const localeMap: Record<string, MessageSchema> = { en, zh };

export const i18nMessages: MessageSchema = reactive(localeMap[detectLocale()] ?? en) as MessageSchema;

export const i18nHelper: MessageSchema = i18nMessages;

export const i18n = createI18n<[MessageSchema], 'en' | 'zh'>({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    zh,
  },
});
