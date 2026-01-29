import { createI18n } from 'vue-i18n'
import en from './en.json'
import zh from './zh.json'

// Define schema for type safety
type MessageSchema = typeof zh

const i18n = createI18n<[MessageSchema], 'en' | 'zh'>({
  legacy: false,
  locale: localStorage.getItem('locale') || (navigator.language.startsWith('zh') ? 'zh' : 'en'),
  fallbackLocale: 'en',
  messages: {
    en,
    zh
  }
})

export default i18n
