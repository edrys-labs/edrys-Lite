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
 *  Edrys.onReady(() => { // Called when Edrys is ready })
 */

import * as Y from 'yjs'
import * as YP from 'y-protocols/awareness.js'
import { RoomAwarenessManager } from './awarenessManager'

const EXTERN = 'extern'
var awareness: any
var awarenessManager: any
var doc: any

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
      const customEvent = e as CustomEvent
      if (
        !promiscuous &&
        customEvent.detail.module != window['Edrys'].module?.url
      )
        return
      handler(customEvent.detail)
    })
  },
  sendMessage: (subject: any, body: any, user?: string) => {
    if (typeof subject !== 'string') subject = JSON.stringify(subject)
    if (typeof body !== 'string') body = JSON.stringify(body)
    window.parent.postMessage(
      {
        event: 'message',
        subject: subject,
        body: body,
        module: window['Edrys'].module.url,
        user,
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

  clearState(key: string) {
    doc.getMap('rooms').get(window['Edrys'].liveUser.room).delete(key)
  },

  getState(
    key: string,
    type:
      | 'Map'
      | 'Array'
      | 'Text'
      | 'XmlFragment'
      | 'XmlText'
      | 'XmlElement'
      | 'Value'
      | 'Awareness',
    value?: any
  ) {
    if (type === 'Awareness') {
      return awarenessManager.getAwareness(
        window['Edrys'].liveUser.room + '.' + key
      )
    }

    const map = doc.getMap('rooms').get(window['Edrys'].liveUser.room)

    if (map.has(key)) {
      return map.get(key)
    }

    let state: any

    switch (type) {
      case 'Map':
        state = new Y.Map()
        break
      case 'Array':
        state = new Y.Array()
        break
      case 'Text':
        state = new Y.Text()
        break
      case 'XmlFragment':
        state = new Y.XmlFragment()
        break
      case 'XmlText':
        state = new Y.XmlText()
        break
      case 'XmlElement':
        state = new Y.XmlElement()
        break

      default:
        state = value
        break
    }

    map.set(key, state)

    return state
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

function update() {
  const liveClass = {
    users: doc.getMap('users').toJSON(),
    rooms: doc.getMap('rooms').toJSON(),
  }

  Object.entries(liveClass.rooms).forEach(([name, data]) => {
    return { name, data }
  })

  Object.entries(liveClass.users).forEach(([n, u]) => {
    ;(u as any).name = n
  })

  window['Edrys'].liveClass = new Proxy(liveClass, edrysProxyValidator(''))
  window['Edrys'].liveUser = liveClass.users[window['Edrys'].username]
  window['Edrys'].liveRoom = liveClass.rooms[window['Edrys'].liveUser.room]
}

window.addEventListener(
  'message',
  function (e) {
    switch (e.data.event) {
      case 'update':
        window['Edrys'].origin = e.data.origin
        window['Edrys'].role = e.data.role
        window['Edrys'].username = e.data.username
        window['Edrys'].module = e.data.module

        if (!doc) {
          doc = new Y.Doc()
          awareness = new YP.Awareness(doc)

          awarenessManager = new RoomAwarenessManager(awareness)

          doc.getMap('users')
          doc.getMap('rooms')

          doc.on('update', (state, origin) => {
            update()
            dispatchEvent(
              new CustomEvent('$Edrys.update', {
                bubbles: false,
              })
            )

            if (origin === EXTERN) {
              return // Ignore this transaction
            }

            window.parent.postMessage(
              {
                event: 'state',
                data: state,
              },
              window['Edrys'].origin
            )
          })

          awareness.on('update', ({ added, updated, removed }, origin) => {
            if (origin !== EXTERN) {
              const changedClients = added.concat(updated, removed)

              // Send the update to the parent window
              window.parent.postMessage(
                {
                  event: 'awareness',
                  data: YP.encodeAwarenessUpdate(awareness, changedClients),
                },
                window['Edrys'].origin
              )
            }
          })
        }

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

        Y.applyUpdate(doc, e.data.liveClass, EXTERN)

        if (e.data.awareness) {
          YP.applyAwarenessUpdate(awareness, e.data.awareness, EXTERN)
        }

        update()

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