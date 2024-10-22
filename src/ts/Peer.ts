import { getPeerID, hashJsonObject, getShortPeerID } from './Utils'

import * as Y from 'yjs'
import { TrysteroProvider } from '../../node_modules/y-trystero/src/TrysteroProvider'
import { joinRoom } from '../../node_modules/trystero/src/torrent'

import { selfId } from 'trystero'

function LOG(...args: any[]) {
  console.log(
    '%c🛸 Connection >>>',
    'background-color: #004400; font-weight: bold;',
    ...args
  )
}

const trackersAnnounceURLs = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
  'wss://tracker.openwebtorrent.com:443/announce',
  'wss://tracker.files.fm:7073/announce',
]

const LOBBY = 'Lobby'
const STATION = 'Station'

let heartbeatID

export default class Peer {
  private provider: TrysteroProvider
  private tx: any
  private rx: any

  private y: {
    doc: Y.Doc
    chat: Y.Array<any>
    rooms: Y.Map<any>
    users: Y.Map<any>
    setup: Y.Map<any>
    userSettings: Y.Map<any>
  }
  private isStation: boolean = false

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
      userSettings: new Y.Map(),
    }

    this.lab = setup

    this.peerID = getPeerID()
    if (stationID) {
      this.isStation = true
      this.peerID = STATION + ' ' + stationID
    }

    this.provider = new TrysteroProvider(
      this.lab.id + (this.lab.hash || ''),
      this.y.doc,
      {
        appId: process.env.APP_ID || 'edry-Lite', // optional, but recommended
        password: password,
        joinRoom: joinRoom,
        peerOpts: JSON.parse(process.env.ICE_SERVERS || '{}'),
      }
    )

    this.initSetup()

    this.provider.on('status', (event) => {
      this.connected = event.connected

      LOG('status', event)

      if (event.connected) {
        this.provider.room?.onPeerLeave((id: string) => {
          this.removePeers([id])
        })

        this.initPubSub()

        if (heartbeatID) {
          clearInterval(heartbeatID)
        }

        heartbeatID = setInterval(() => {
          const timeNow = Date.now()
          this.y.userSettings.set('timestamp', timeNow)

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
        }, 1000)

        this.rx((msg: any, peerId: string) => {
          this.update('message', msg)
        })

        this.y.setup.observe((event) => {
          const timestamp = this.y.setup.get('timestamp')

          if (this.lab.timestamp !== timestamp) {
            this.initSetup()
          }
        })
      }

      this.update('connected')
    })

    this.provider.on('synced', (event) => {
      LOG('synced', event)
    })
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

  initUser(role: 'student' | 'teacher' | 'station') {
    this.y.userSettings.set('displayName', getShortPeerID(this.peerID))
    this.y.userSettings.set('room', this.isStation ? this.peerID : LOBBY)
    this.y.userSettings.set('role', role)
    this.y.userSettings.set('dateJoined', Date.now())
    this.y.userSettings.set('timestamp', Date.now())
    this.y.userSettings.set('selfId', selfId)
    this.y.userSettings.set('handRaised', false)
    this.y.userSettings.set('connections', [{ id: '', target: {} }])

    this.y.users.set(this.peerID, this.y.userSettings)

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
      if (this.isStation) {
        console.log('adding station room', this.peerID)
        this.addRoom(this.peerID)
      }
    })

    this.y.rooms.observe((events) => {
      events.keysChanged.forEach((key) => {
        const change = events.changes.keys.get(key)

        if (change?.action === 'delete') {
          // if my room is deleted, move to lobby
          if (this.y.userSettings.get('room') === key) {
            this.y.userSettings.set('room', LOBBY)
          }
        }
      })
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

  update(
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

        if (callback) {
          callback(this.toJSON())
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
      const room = {
        studentPublicState: '',
        teacherPublicState: '',
        teacherPrivateState: '',
      }

      this.y.rooms.set(name, room)
    } else {
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
    this.y.userSettings.set('room', room)
    this.y.userSettings.set('timestamp', Date.now())
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

  join(role: 'student' | 'teacher' | 'station') {
    this.initUser(role)
    this.initRooms()
    this.initChat()
    //this.peerUpdate()

    return this.toJSON()
  }

  toJSON() {
    return {
      rooms: this.y.rooms.toJSON(),
      users: this.y.users.toJSON(),
    }
  }

  setStationName(newName: string) {
    this.y.doc.transact(() => {
      newName = 'Station ' + newName
      const oldName = this.y.userSettings.get('room')

      this.y.userSettings.set('displayName', newName)
      this.y.userSettings.set('room', newName)

      const room = this.y.rooms.get(oldName)
      this.y.rooms.delete(oldName)
      this.y.rooms.set(newName, room)

      const peers = this.y.users.toJSON()

      for (const id in peers) {
        if (peers[id].room === oldName) {
          this.y.users.get(id).set('room', LOBBY)
        }
      }
    })
  }
}
