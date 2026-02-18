import { createI18n } from 'vue-i18n';
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

export const i18nMessages: MessageSchema = localeMap[detectLocale()] ?? en;

export const i18n = createI18n<[MessageSchema], 'en' | 'zh'>({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    zh,
  },
});
