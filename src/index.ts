import { createApp } from 'vue'
import Index from './views/Index.vue'
import Classroom from './views/Classroom.vue'
import Deploy from './views/Deploy.vue'

// Vuetify
import { createVuetify } from 'vuetify'
import { mdi } from '../node_modules/vuetify/lib/iconsets/mdi.mjs'
import * as components from '../node_modules/vuetify/lib/components/index.mjs'
import * as directives from '../node_modules/vuetify/lib/directives/index.mjs'

// import highlighting library (you can use any library you want just return html string)
// @ts-ignore
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

const vuetify = createVuetify({
  components: { ...components, PrismEditor },
  directives: { ...directives },
  icons: {
    defaultSet: 'mdi',
    sets: {
      mdi,
    },
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
