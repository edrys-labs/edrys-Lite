import { createApp } from 'vue'
import Index from './views/Index.vue'
import Classroom from './views/Classroom.vue'
import Deploy from './views/Deploy.vue'

// Vuetify
import { createVuetify } from 'vuetify'
import { mdi } from '../node_modules/vuetify/lib/iconsets/mdi'
import {
  VApp,
  VAppBar,
  VAppBarNavIcon,
  VAppBarTitle,
  VAlert,
  VBadge,
  VBtn,
  VCard,
  VCardActions,
  VCardSubtitle,
  VCardText,
  VCardTitle,
  VChip,
  VCheckbox,
  VCol,
  VContainer,
  VDialog,
  VDivider,
  VExpansionPanel,
  VExpansionPanels,
  VExpansionPanelText,
  VExpansionPanelTitle,
  VFileInput,
  VFooter,
  VForm,
  VIcon,
  VImg,
  VLayout,
  VList,
  VListItem,
  VListItemSubtitle,
  VListItemTitle,
  VMain,
  VMenu,
  VNavigationDrawer,
  VOverlay,
  VProgressCircular,
  VRadio,
  VRadioGroup,
  VRow,
  VSelect,
  VSpacer,
  VSwitch,
  VTab,
  VTabs,
  VTabsWindow,
  VTabsWindowItem,
  VToolbar,
  VToolbarTitle,
  VTooltip,
  VTextarea,
  VTextField,
  VWindow,
  VWindowItem,
  VSnackbar,
  VColorPicker,
} from '../node_modules/vuetify/lib/components/index'
import * as directives from '../node_modules/vuetify/lib/directives/index'
import { createVueI18nAdapter } from '../node_modules/vuetify/lib/locale/adapters/vue-i18n'
import { createI18n, useI18n } from 'vue-i18n'
import { en, de, uk, ar, es } from '../node_modules/vuetify/lib/locale/index'
import enTranslations from '@/locales/en.yaml'
import deTranslations from '@/locales/de.yaml'
import ukTranslations from '@/locales/uk.yaml'
import arTranslations from '@/locales/ar.yaml'
import esTranslations from '@/locales/es.yaml'

// import highlighting library (you can use any library you want just return html string)
// Extend Window interface to include Prism
declare global {
  interface Window {
    Prism: any
  }
}

import Prism from 'prismjs/prism'
window.Prism = Prism

import { PrismEditor } from 'vue-prism-editor'
import 'vue-prism-editor/dist/prismeditor.min.css'

import { highlight, languages } from 'prismjs/components/prism-core'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-haskell'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-markup' // Required for inline HTML
import 'prismjs/components/prism-markdown'
import 'prismjs/themes/prism-tomorrow.css' // import syntax highlighting styles

var app

// Get browser language and set it as default if supported
const getBrowserLocale = () => {
  const browserLang = navigator.language.split('-')[0]
  const supportedLocales = ['en', 'de', 'uk', 'ar', 'es']
  return supportedLocales.includes(browserLang) ? browserLang : 'en'
}

// Get the saved language from localStorage or use the browser language
const getSavedLocale = () => {
  const savedLang = localStorage.getItem('locale')
  return savedLang || getBrowserLocale()
}

const i18n = createI18n({
  legacy: false,
  locale: getSavedLocale(),
  fallbackLocale: 'en',
  messages: {
    en: { $vuetify: { ...en }, ...enTranslations },
    de: { $vuetify: { ...de }, ...deTranslations },
    uk: { $vuetify: { ...uk }, ...ukTranslations },
    ar: { $vuetify: { ...ar }, ...arTranslations },
    es: { $vuetify: { ...es }, ...esTranslations },
  },
})

const vuetify = createVuetify({
  components: {
    VApp,
    VAppBar,
    VAppBarNavIcon,
    VAppBarTitle,
    VAlert,
    VBadge,
    VBtn,
    VCard,
    VCardActions,
    VCardSubtitle,
    VCardText,
    VCardTitle,
    VCheckbox,
    VChip,
    VCol,
    VContainer,
    VDialog,
    VDivider,
    VExpansionPanel,
    VExpansionPanels,
    VExpansionPanelText,
    VExpansionPanelTitle,
    VFileInput,
    VFooter,
    VForm,
    VIcon,
    VImg,
    VLayout,
    VList,
    VListItem,
    VListItemSubtitle,
    VListItemTitle,
    VMain,
    VMenu,
    VNavigationDrawer,
    VOverlay,
    VProgressCircular,
    VRadio,
    VRadioGroup,
    VRow,
    VSelect,
    VSnackbar,
    VSpacer,
    VSwitch,
    VTab,
    VTabs,
    VTabsWindow,
    VTabsWindowItem,
    VToolbar,
    VToolbarTitle,
    VTooltip,
    VTextarea,
    VTextField,
    VWindow,
    VWindowItem,
    // others
    PrismEditor,
    VColorPicker,
  },
  directives: { ...directives },
  icons: {
    defaultSet: 'mdi',
    sets: {
      mdi,
    },
  },
  locale: {
    adapter: createVueI18nAdapter({ i18n, useI18n }),
  },
})

const pathToRegex = (path) =>
  new RegExp('^' + path.replace(/\//g, '\\/').replace(/:\w+/g, '(.+)') + '$')

const getParams = (match) => {
  const values = match.result.slice(1)
  const keys = Array.from(match.route.path.matchAll(/:(\w+)/g)).map(
    (result: unknown) => (result as RegExpMatchArray)[1]
  )

  let params = Object.fromEntries(
    keys.map((key, i) => {
      return [key, values[i]]
    })
  )

  if (match.params) {
    params = { ...params, ...match.params }
  }

  return params
}

export const navigateTo = (url: string, replace?: boolean) => {
  if (replace) {
    history.replaceState(null, '', url)
  } else {
    history.pushState(null, '', url)
  }
  router()
}

const router = async () => {
  const routes = [
    { path: '/', view: Index },
    {
      path: '/classroom/:id/:hash',
      view: Classroom,
      params: { station: false },
    },
    {
      path: '/classroom/:id',
      view: Classroom,
      params: { station: false },
    },
    {
      path: '/station/:id/:hash',
      view: Classroom,
      params: { station: true },
    },
    {
      path: '/station/:id',
      view: Classroom,
      params: { station: true },
    },
    {
      path: '/deploy/:url',
      view: Deploy,
      params: { station: false },
    },
  ]

  const potentialMatches = routes.map((route) => {
    return {
      route: route,
      result: location.search.slice(1).match(pathToRegex(route.path)),
      params: route.params,
    }
  })

  let match = potentialMatches.find(
    (potentialMatches) => potentialMatches.result !== null
  )

  if (!match) {
    match = {
      route: routes[0],
      result: [location.search],
      params: { station: false },
    }
  }

  const params = getParams(match)
  const view = match.route.view

  app?.unmount()
  app = createApp(view, params)

  // Provide Prism functionality globally
  app.provide('prismHighlight', highlight)
  app.provide('prismLanguages', languages)

  app.use(vuetify)
  app.use(i18n)
  app.mount(document.body)
}

window.addEventListener('popstate', router)

document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('click', (e) => {
    if (e.target && (e.target as Element).matches('[data-link]')) {
      e.preventDefault()
      navigateTo((e.target as HTMLAnchorElement).href)
    }
  })

  router()
})
