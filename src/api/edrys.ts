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
// import * as YP from 'y-protocols/awareness.js'
// import { RoomAwarenessManager } from './awarenessManager'
import { unpack, pack } from 'msgpackr'

const EXTERN = 'extern'
// var awareness: any
// var awarenessManager: any
var liveClass = false
var doc: any
var callback = { onReady: false, onUpdate: false }

function LOG(...args) {
  if (window['Edrys'].debug)
    console.log(
      `Edrys (${window['Edrys'].module.name || 'not ready'}):`,
      ...args
    )
}

function WARN(...args) {
  console.warn(`Edrys (${window['Edrys'].module.name}):`, ...args)
}

function encode(value: any): string {
  try {
    // Convert MessagePack binary data to Base64 string
    const packed = pack(value)
    return btoa(String.fromCharCode(...packed))
  } catch (error) {
    throw error
  }
}

function decode(value: string): any {
  try {
    // Convert Base64 string back to binary data then unpack
    const binary = atob(value)
    const bytes = new Uint8Array([...binary].map((c) => c.charCodeAt(0)))
    return unpack(bytes)
  } catch (error) {
    throw error
  }
}

window.addEventListener('unload', () => {
  window.parent.postMessage(
    {
      event: 'reload',
      module: window['Edrys']?.module.url,
    },
    window['Edrys']?.origin || '*'
  )
})

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
  debug: false,

  onReady(handler) {
    callback.onReady = true

    if (window['Edrys'].ready) {
      LOG('READY')
      handler(window['Edrys'])
    } else
      window.addEventListener('$Edrys.ready', (e) => {
        LOG('READY')
        handler(window['Edrys'])
      })
  },
  onUpdate(handler) {
    callback.onUpdate = true
    window.addEventListener('$Edrys.update', (e) => {
      if (window['Edrys'].ready) {
        LOG('UPDATE')
        handler(window['Edrys'])
      }
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

      const message = customEvent.detail

      if (!message?._decoded) {
        try {
          message.body = decode(message.body)
          message._decoded = true
        } catch (e) {
          WARN('Error decoding message =>', message, e)
          return
        }
      }

      LOG('RECEIVED MESSAGE', message.subject, message.body)

      handler(message)
    })
  },
  sendMessage: (subject: any, body: any, user?: string) => {
    if (typeof subject !== 'string') subject = JSON.stringify(subject)

    LOG('SENDING MESSAGE', subject, body)

    try {
      body = encode(body)
    } catch (e) {
      console.warn('Edrys: Error encoding message =>', body, e)
      return
    }

    window.parent.postMessage(
      {
        event: 'message',
        subject,
        body,
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

  updateState(callback: () => void, origin: any) {
    doc.transact(callback, origin)
  },

  getState(
    key?: string,
    type?:
      | 'Map'
      | 'Array'
      | 'Text'
      | 'XmlFragment'
      | 'XmlText'
      | 'XmlElement'
      | 'Value',
    // | 'Awareness',
    value?: any
  ) {
    // if (type === 'Awareness') {
    //   return awarenessManager.getAwareness(
    //     window['Edrys'].liveUser.room + '.' + key
    //   )
    // }

    const map = doc.getMap('rooms').get(window['Edrys'].liveUser.room)

    if (!key) {
      return map
    }

    if (
      map.has(key) &&
      (type !== 'Value' || (type === 'Value' && value === undefined))
    ) {
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

      case 'Value':
        if (value === undefined) {
          return
        }

        const oldState = map.get(key)

        if (JSON.stringify(oldState) === JSON.stringify(value)) {
          return oldState
        }

        state = value
        break

      default:
        WARN('Unknown type =>', type)
        return
    }

    map.set(key, state)

    return state
  },

  // To initialize Google Translate Widget
  initTranslator(config = {
    pageLanguage: 'en',
    includedLanguages: 'en,de,uk,ar,fr,es,de,it,pt,ru,zh-CN,ja,ko',
    layout: 'SIMPLE',
    autoDisplay: true
  }) {
    const div = document.createElement('div');
    div.id = 'google_translate_element';
    document.body.insertBefore(div, document.body.firstChild);

    window['googleTranslateElementInit'] = () => {
      new (window as any).google.translate.TranslateElement({
        pageLanguage: config.pageLanguage,
        includedLanguages: config.includedLanguages,
        layout: (window as any).google.translate.TranslateElement.InlineLayout[config.layout],
        autoDisplay: config.autoDisplay
      }, 'google_translate_element');
    };

    const script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.head.appendChild(script);
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
  //window['Edrys'].liveRoom.name = window['Edrys'].liveUser.room
}

function dispatchUpdate() {
  update()
  dispatchEvent(
    new CustomEvent('$Edrys.update', {
      bubbles: false,
    })
  )
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
          // awareness = new YP.Awareness(doc)

          // awarenessManager = new RoomAwarenessManager(awareness)

          doc.getMap('users')
          doc.getMap('rooms')

          doc.on('update', (state, origin) => {
            update()

            LOG('DOC', state, origin)
            if (origin === EXTERN) {
              // onReady can only be sent if it has been updated by the parent
              if (!window['Edrys'].ready && liveClass) {
                this.setTimeout(() => {
                  window['Edrys'].ready = true

                  if (callback.onReady) {
                    dispatchEvent(
                      new CustomEvent('$Edrys.ready', {
                        bubbles: false,
                        detail: e.data,
                      })
                    )
                  } else if (callback.onUpdate) {
                    dispatchUpdate()
                  }
                }, 1000)

                // onUpdate is called only on changes within the room
                doc
                  .getMap('rooms')
                  //.get(window['Edrys'].liveUser.room)
                  .observeDeep((_event, _transact) => {
                    // console.log('ROOM UPDATE')
                    dispatchUpdate()
                  })

                doc.getMap('users').observeDeep((_event, _transact) => {
                  dispatchUpdate()
                })

                // needs to be called initially
                setTimeout(dispatchUpdate, 500)
              }

              return
            }

            window.parent.postMessage(
              {
                event: 'state',
                data: state,
              },
              window['Edrys'].origin
            )
          })

          // awareness.on('update', ({ added, updated, removed }, origin) => {
          //   LOG('AWARENESS UPDATE', origin, added, updated, removed)
          //   if (origin !== EXTERN) {
          //     const changedClients = added.concat(updated, removed)

          //     // Send the update to the parent window
          //     window.parent.postMessage(
          //       {
          //         event: 'awareness',
          //         data: YP.encodeAwarenessUpdate(awareness, changedClients),
          //       },
          //       window['Edrys'].origin
          //     )
          //   }
          // })
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

        if (e.data.liveClass) {
          liveClass = true
          Y.applyUpdate(doc, e.data.liveClass, EXTERN)
        }

        // if (e.data.awareness) {
        //   YP.applyAwarenessUpdate(awareness, e.data.awareness, EXTERN)
        // }

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

    // update events are only triggered internally, if the state changes.
    if (e.data.event !== 'update') {
      dispatchEvent(
        new CustomEvent('$Edrys.' + e.data.event, {
          bubbles: false,
          detail: e.data,
        })
      )
    }
  },
  false
)

function checkReady() {
  if (!window['Edrys'].ready) {
    WARN('Module not ready yet ...')
    window.parent.postMessage(
      {
        event: 'reload',
        module: window['Edrys']?.module.url || '*',
      },
      window['Edrys']?.origin || '*'
    )

    setTimeout(checkReady, 5000)
  }
}

//setTimeout(() => {
//  checkReady()
//}, 8000)

// add an addEventListener for the onload event if everything has been loaded, included all scripts
window.addEventListener('load', () => {
  setTimeout(checkReady, 2000)
})
