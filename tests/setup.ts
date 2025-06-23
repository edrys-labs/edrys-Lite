import { createVuetify } from 'vuetify'
import { createI18n } from 'vue-i18n'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { config } from '@vue/test-utils'
import { en, de, uk, ar, es } from '../node_modules/vuetify/lib/locale/index'
import enTranslations from '@/locales/en.yaml'
import deTranslations from '@/locales/de.yaml'
import ukTranslations from '@/locales/uk.yaml'
import arTranslations from '@/locales/ar.yaml'
import esTranslations from '@/locales/es.yaml'

// Add ResizeObserver mock
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Add to global
global.ResizeObserver = ResizeObserver;

const vuetify = createVuetify({
  components,
  directives
})

type MessageSchema = typeof enTranslations & {
  $vuetify: typeof en
}

const messages: Record<string, MessageSchema> = {
  en: { $vuetify: { ...en }, ...enTranslations } as MessageSchema,
  de: { $vuetify: { ...de }, ...deTranslations } as MessageSchema,
  uk: { $vuetify: { ...uk }, ...ukTranslations } as MessageSchema,
  ar: { $vuetify: { ...ar }, ...arTranslations } as MessageSchema,
  es: { $vuetify: { ...es }, ...esTranslations } as MessageSchema
}

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages
})

config.global.plugins = [vuetify, i18n]

// Export i18n and messages for use in tests
export { i18n, messages }
