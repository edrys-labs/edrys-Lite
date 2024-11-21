import { getPeerID, hashJsonObject, getShortPeerID } from './Utils'

import * as Y from 'yjs'
import { TrysteroProvider } from '../../node_modules/y-trystero/src/TrysteroProvider'
// @ts-ignore
import { joinRoom } from '../../node_modules/trystero/src/torrent'
import * as YP from 'y-protocols/awareness.js'
import { selfId } from 'trystero'

function LOG(...args: any[]) {
  console.log(
    '%c🛸 Connection >>>',
    'background-color: #004400; font-weight: bold;',
    ...args
  )
}

const LOBBY = 'Lobby'
const STATION = 'Station'

let heartbeatID

export default class Peer {
  private provider: TrysteroProvider
  private tx: any
  private rx: any
  private sync: boolean = false

  private y: {
    doc: Y.Doc
    chat: Y.Array<any>
    rooms: Y.Map<any>
    users: Y.Map<any>
    setup: Y.Map<any>
  }

  private role: 'student' | 'teacher' | 'station' = 'student'

  private lab: {
    id: string
    data: any
    timestamp: number
    hash: string | null
  }

  private connected: boolean = false

  private callback: {} = {}
  private callbackUpdate: {} = {}

  private peerID: string

  constructor(
    setup: { id: string; data: any; timestamp: number; hash: string | null },
    stationID?: string,
    password?: string
  ) {
    const doc = new Y.Doc()

    this.y = {
      doc: doc,
      setup: doc.getMap('setup'),
      users: doc.getMap('users'),
      rooms: doc.getMap('rooms'),
      chat: doc.getArray('chat'),
    }

    this.lab = setup

    this.peerID = getPeerID()
    if (stationID) {
      this.role = 'station'
      this.peerID = STATION + ' ' + stationID
    }

    this.provider = new TrysteroProvider(
      this.lab.id + (this.lab.hash || ''),
      this.y.doc,
      {
        appId: process.env.APP_ID || 'edry-Lite', // optional, but recommended
        password: password,
        joinRoom: joinRoom,
        // {"rtcConfig":{"config":{"iceServers":[{"urls":"...."},{"urls":"turn:turn....","username":"XXXX","credential":"XXXXXX"}]}}}
        peerOpts: JSON.parse(process.env.TRYSTERO_PEER_CONFIG || '{}'),
      }
    )

    this.initSetup()

    this.provider.on('status', (event) => {
      LOG('status', event)

      if (!event.connected) {
        this.connected = false
      }

      this.y.setup.observe((event) => {
        const timestamp = this.y.setup.get('timestamp')

        if (this.lab.timestamp !== timestamp) {
          this.initSetup()
        }
      })
    })

    this.provider.on('synced', (event) => {
      this.provider.room?.onPeerLeave((id: string) => {
        this.removePeers([id])
      })

      this.initPubSub()

      this.rx((msg: any, peerId: string) => {
        this.update('message', msg)
      })

      LOG('synced', event)

      setTimeout(() => {
        this.connected = true

        this.update('connected')
      }, 1000)
    })
  }

  user() {
    return this.y.users.get(this.peerID)
  }

  isStation() {
    return this.role === 'station'
  }

  removePeers(selfIds: string[]) {
    const peers = this.y.users.toJSON()

    this.y.doc.transact(() => {
      for (const id in peers) {
        if (selfIds.includes(peers[id].selfId)) {
          this.y.users.delete(id)

          if (peers[id].role === 'station') {
            this.y.rooms.delete(id)
          }

          break
        }
      }
    })
  }

  initPubSub() {
    LOG('initializing pubsub ...')
    if (this.provider.room) {
      const [tx, rx] = this.provider.room.trysteroRoom.makeAction('p2p')
      this.tx = tx
      this.rx = rx

      LOG('... done')
    } else {
      LOG('... failed, retrying in 1s')
      setTimeout(() => {
        this.initPubSub()
      }, 1000)
    }
  }

  initSetup() {
    const timestamp: number = (this.y.setup.get('timestamp') as number) || 0
    const data = this.y.setup.get('config')

    // If my setup is older than the current setup
    if (this.lab.timestamp < timestamp) {
      LOG('receiving initial lab configuration')

      this.lab.data = data
      this.lab.timestamp = timestamp
      this.update('setup')
    }
    // if the received setup is not up to date
    else if (this.lab.timestamp !== timestamp && this.lab.timestamp > 0) {
      LOG('received outdated lab configuration, writing changes back')
      this.y.doc.transact(() => {
        this.y.setup.set('config', this.lab.data)
        this.y.setup.set('timestamp', this.lab.timestamp)
      })
    }

    // equal setups will be ignored
  }

  initUser(
    role: 'student' | 'teacher' | 'station',
    withObserver: boolean = true
  ) {
    this.role = role

    if (heartbeatID) {
      clearInterval(heartbeatID)
      heartbeatID = null
    }

    const userSettings = new Y.Map()
    userSettings.set('displayName', getShortPeerID(this.peerID))
    userSettings.set('room', this.isStation() ? this.peerID : LOBBY)
    userSettings.set('role', this.role)
    userSettings.set('dateJoined', Date.now())
    userSettings.set('timestamp', Date.now())
    userSettings.set('selfId', selfId)
    userSettings.set('handRaised', false)
    userSettings.set('connections', [{ id: '', target: {} }])
    this.y.users.set(this.peerID, userSettings)

    heartbeatID = setInterval(() => {
      if (this.y.users.has(this.peerID)) {
        const timeNow = Date.now()
        this.user().set('timestamp', timeNow)

        const users = this.y.users.toJSON()

        let ids: string[] = []
        for (const id in users) {
          if (users[id].timestamp < timeNow - 5000) {
            ids.push(users[id].selfId)
          }
        }

        if (ids.length > 0) {
          this.removePeers(ids)
        }
      } else {
        LOG('user not found', this.peerID)
      }
    }, 4000)

    if (withObserver) {
      this.y.users.observeDeep((events) => {
        const allEventsHaveOnlyTimestamp = events.every((event) => {
          return (
            event.changes.keys &&
            event.changes.keys.size === 1 &&
            event.changes.keys.has('timestamp')
          )
        })

        if (!allEventsHaveOnlyTimestamp) {
          this.update('room')
        }
      })
    }
  }

  initRooms() {
    this.y.doc.transact(() => {
      if (this.y.rooms.size === 0) {
        LOG('initializing rooms')

        this.addRoom(LOBBY)

        const defaultRooms = this.lab.data.meta.defaultNumberOfRooms

        if (defaultRooms) {
          for (let i = 1; i <= defaultRooms; i++) {
            this.addRoom('Room ' + i)
          }
        }
      }
      if (this.isStation()) {
        this.addRoom(this.peerID)
      }
    })

    this.y.rooms.observeDeep((events) => {
      // Handle room deletions from root-level changes
      events.forEach((event) => {
        if (event.target === this.y.rooms) {
          // This is a root-level change (like deleting a room)
          const keysChanged = Array.from(event.changes.keys.keys())

          keysChanged.forEach((key) => {
            const change = event.changes.keys.get(key)
            if (change?.action === 'delete') {
              // If my room is deleted, move to lobby
              if (this.user() && this.user().get('room') === key) {
                LOG('current room was deleted, moving to lobby')
                this.user().set('room', LOBBY)
              }
            }
          })
        }
      })

      // Only trigger one update per batch of changes
      this.update('room')
    })
  }

  initChat() {
    this.y.chat.observe((event) => {
      this.update('chat')
    })
  }

  newSetup(config: { id: string; data: any; timestamp: number }) {
    if (this.lab.hash) {
      const self = this
      hashJsonObject(config.data).then((hash) => {
        if (hash === self.lab.hash && self.lab.timestamp < config.timestamp) {
          self.lab.id = config.id
          self.lab.data = config.data
          self.lab.timestamp = config.timestamp

          self.initSetup()
        } else {
          LOG('updating failed, hash mismatch')
        }
      })
    } else {
      if (this.lab.timestamp < config.timestamp) {
        this.lab.id = config.id
        this.lab.data = config.data
        this.lab.timestamp = config.timestamp

        this.initSetup()
      }
    }
  }

  async update(
    event: 'setup' | 'room' | 'message' | 'connected' | 'chat',
    message?: any
  ) {
    const callback = this.callback[event]

    switch (event) {
      case 'message': {
        if (callback) {
          message.date = Date.now()
          callback(message)
        }
        break
      }
      case 'setup': {
        if (callback) {
          callback(this.lab)
          this.callbackUpdate[event] = false
        } else {
          this.callbackUpdate[event] = true
        }
        break
      }
      case 'room': {
        //this.peerUpdate()

        if (callback && this.connected) {
          callback(await this.toJSON(message))
          this.callbackUpdate[event] = false
        } else {
          this.callbackUpdate[event] = true
        }
        break
      }

      case 'chat': {
        if (callback) {
          callback({
            messages: this.y.doc.getArray('chat').toArray(),
            truncated: false,
          })
          this.callbackUpdate[event] = false
        } else {
          this.callbackUpdate[event] = true
        }
        break
      }

      case 'connected': {
        if (callback) {
          callback(this.connected)
          this.callbackUpdate[event] = false
        } else {
          this.callbackUpdate[event] = true
        }
        break
      }
    }
  }

  on(event: 'setup' | 'room' | 'connected', callback: any) {
    if (callback) {
      this.callback[event] = callback

      if (this.callbackUpdate[event]) {
        this.update(event)
      }
    } else if (this.callback[event]) {
      delete this.callback[event]
    }
  }

  broadcast(room: string, msg: any) {
    if (!this.connected) {
      return
    }

    const users = this.y.users.toJSON()

    // send to one user only
    if (msg.user) {
      this.tx(msg, users[msg.user].selfId)
      return
    }

    // otherwise broadcast to all users in the room
    for (const id in users) {
      if (users[id].room === room) {
        try {
          this.tx(msg, users[id].selfId)
        } catch (e) {
          LOG('warning', e.message)
        }
      }
    }
    this.update('message', msg)
  }

  stop() {
    LOG('stopping peer')
    clearInterval(heartbeatID)
    heartbeatID = null
    this.y.users.delete(this.peerID)

    this.provider.disconnect()
    this.provider.destroy()

    this.callback = {}
    this.callbackUpdate = {}
  }

  addRoom(name?: string) {
    if (name && !this.y.rooms.has(name)) {
      const room = new Y.Map()
      this.y.rooms.set(name, room)
    } else if (!name) {
      const roomIDs: number[] = Object.keys(this.y.rooms.toJSON())
        .filter((e) => e.match(/Room/))
        .map((e) => e.split(' ')[1])
        .map((e) => parseInt(e))
        .sort((a, b) => a - b)

      let newRoomID = 1
      for (const id of roomIDs) {
        if (id !== newRoomID) {
          break
        }
        newRoomID++
      }

      this.addRoom('Room ' + newRoomID)
    }
  }

  gotoRoom(room: string) {
    this.user().set('room', room)
    this.user().set('timestamp', Date.now())
  }

  sendMessage(message: string) {
    this.y.chat.push([
      {
        timestamp: Date.now(),
        user: getShortPeerID(this.peerID),
        msg: message,
      },
    ])
  }

  updateState(data: Uint8Array) {
    this.y.doc.transact(
      () => {
        Y.applyUpdate(this.y.doc, data)
      },
      { transactionId: 'intern' }
    )
  }

  updateAwareness(data: Uint8Array) {
    YP.applyAwarenessUpdate(this.provider.awareness, data, 'EXTERN')
  }

  async join(role: 'student' | 'teacher' | 'station') {
    this.initUser(role)
    this.initRooms()
    this.initChat()

    this.update('room')

    this.provider.awareness.on(
      'update',
      ({ added, updated, removed }, origin) => {
        const changedClients = added.concat(updated, removed)

        // Encode the awareness update
        const update = YP.encodeAwarenessUpdate(
          this.provider.awareness,
          changedClients
        )

        if (origin !== 'EXTERN') {
          // Broadcast to all iframes
          this.update('room', update)
        }
      }
    )
  }

  async toJSON(awareness?: Uint8Array) {
    // check if station and add station room exist
    if (this.isStation() && !this.y.rooms.has(this.peerID)) {
      this.addRoom(this.peerID)
    }

    if (!this.y.users.has(this.peerID)) {
      await this.awaitTransact(() => {
        this.initUser(this.role, false)
      })
    }

    return {
      rooms: this.y.rooms.toJSON(),
      users: this.y.users.toJSON(),
      doc: awareness ? undefined : Y.encodeStateAsUpdate(this.y.doc),
      awareness: awareness,
    }
  }

  awaitTransact(transactFn): Promise<void> {
    return new Promise((resolve) => {
      // We'll use this to track when the transaction is done
      let isTransactionDone = false

      const observer = () => {
        if (isTransactionDone) {
          this.y.doc.off('afterTransaction', observer)
          resolve()
        }
      }

      this.y.doc.on('afterTransaction', observer)

      this.y.doc.transact(() => {
        try {
          transactFn()
        } catch (e) {
          console.error('Error in transaction', e)
        }
        isTransactionDone = true
      })
    })
  }
}
