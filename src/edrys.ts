/**
 * This the Edrys javascript client library.
 * Properties:
 *  Edrys.ready
 *  Edrys.role
 *  Edrys.username
 *  Edrys.module
 *  Edrys.liveClass (this is reactive, meaning setting a property on it will also update it in real time)
 *  Edrys.liveRoom (also reactive)
 *  Edrys.liveUser (also reactive)
 * Functions:
 *  Edrys.sendMessage(subject, body)
 *  Edrys.onMessage(({from, subject, body}) => { // Called when a message is received in your room })
 *  Edrys.onUpdate(() => { // Called when any Edrys properties change })
 */

import * as Y from 'yjs'

window['Edrys'] = {
  origin: '*',
  ready: false,
  role: undefined,
  username: undefined,
  liveClass: undefined,
  liveRoom: undefined,
  liveUser: undefined,
  module: undefined,
  class_id: undefined,
  onReady(handler) {
    if (window['Edrys'].ready) handler(window['Edrys'])
    else
      window.addEventListener('$Edrys.ready', (e) => {
        handler(window['Edrys'])
      })
  },
  onUpdate(handler) {
    window.addEventListener('$Edrys.update', (e) => {
      handler(window['Edrys'])
    })
  },
  onMessage(handler, promiscuous = false) {
    window.addEventListener('$Edrys.message', (e) => {
      if (!promiscuous && e.detail.module != window['Edrys'].module?.url) return
      handler(e.detail)
    })
  },
  sendMessage: (subject, body) => {
    if (typeof subject !== 'string') subject = JSON.stringify(subject)
    if (typeof body !== 'string') body = JSON.stringify(body)
    window.parent.postMessage(
      {
        event: 'message',
        subject: subject,
        body: body,
        module: window['Edrys'].module.url,
      },
      window['Edrys'].origin
    )
  },
  setItem(key, value) {
    localStorage.setItem(
      `${window['Edrys'].class_id}.${window['Edrys'].liveUser.room}.${key}`,
      value
    )
  },
  getItem(key) {
    return localStorage.getItem(
      `${window['Edrys'].class_id}.${window['Edrys'].liveUser.room}.${key}`
    )
  },
}

const edrysProxyValidator = (path) => ({
  get(target, key) {
    if (key == 'isProxy') return true
    const prop = target[key]
    if (typeof prop == 'undefined') return
    if (!prop.isProxy && typeof prop === 'object')
      target[key] = new Proxy(prop, edrysProxyValidator([...path, key]))
    return target[key]
  },
  set(target, key, value) {
    if (!path.includes('__ob__')) {
      const path_ = [...path, key]
      window.parent.postMessage(
        {
          event: 'update',
          path: path_,
          value: value,
        },
        window['Edrys'].origin
      )
    }
    target[key] = value
    return true
  },
})

window.addEventListener(
  'message',
  function (e) {
    switch (e.data.event) {
      case 'update':
        window['Edrys'].origin = e.data.origin
        window['Edrys'].role = e.data.role
        window['Edrys'].username = e.data.username
        window['Edrys'].module = e.data.module

        try {
          window['Edrys'].module.config = JSON.parse(e.data.module.config)
        } catch (e) {}
        try {
          window['Edrys'].module.studentConfig = JSON.parse(
            e.data.module.studentConfig
          )
        } catch (e) {}
        try {
          window['Edrys'].module.teacherConfig = JSON.parse(
            e.data.module.teacherConfig
          )
        } catch (e) {}
        try {
          window['Edrys'].module.stationConfig = JSON.parse(
            e.data.module.stationConfig
          )
        } catch (e) {}

        window['Edrys'].class_id = e.data.class_id
        Object.entries(e.data.liveClass.rooms).forEach(([n, r]) => {
          return { name: n, data: r }
        })

        Object.entries(e.data.liveClass.users).forEach(([n, u]) => {
          u.name = n
        })
        window['Edrys'].liveClass = new Proxy(
          e.data.liveClass,
          edrysProxyValidator('')
        )
        window['Edrys'].liveUser =
          window['Edrys'].liveClass.users[window['Edrys'].username]
        window['Edrys'].liveRoom =
          window['Edrys'].liveClass.rooms[window['Edrys'].liveUser.room]

        if (!window['Edrys'].ready) {
          window['Edrys'].ready = true
          dispatchEvent(
            new CustomEvent('$Edrys.ready', { bubbles: false, detail: e.data })
          )
        }

        break
      case 'message':
        // available: e.data.from, e.data.subject, e.data.body
        break
      case 'echo':
        console.log('ECHO:', e.data)
        break
      default:
        break
    }
    dispatchEvent(
      new CustomEvent('$Edrys.' + e.data.event, {
        bubbles: false,
        detail: e.data,
      })
    )
  },
  false
)