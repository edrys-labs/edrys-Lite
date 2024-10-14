import { clone, getPeerID, hashJsonObject } from './Utils'
import State from './State'

import * as Y from 'yjs'
import { TrysteroProvider } from '../../node_modules/y-trystero/src/TrysteroProvider'
import { joinRoom } from '../../node_modules/trystero/src/torrent'
import { clone, deepEqual, getShortPeerID } from './Utils'
import * as objectHash from 'object-hash'

function LOG(...args: any[]) {
  console.warn('Connection >>', ...args)
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

export default class Peer {
  private doc: Y.Doc

  private isStation: boolean = false

  private userSettings: any = {
    displayName: '',
    room: LOBBY,
    role: 'student',
    dateJoined: Date.now(),
    handRaised: false,
    connections: [
      {
        id: '',
        target: {},
      },
    ],
    timestamp: Date.now(),
  }

  private state: State

  private action: any

  private id: string
  private hash: string | null
  private data: any
  private connected: boolean = false

  private timestamp: {
    config: number
    join: number
  } = { config: 0, join: 0 }

  private peers: any = {}

  private callback: {} = {}
  private callbackUpdate: {} = {}

  private peerID: string

  constructor(
    setup: { id: string; data: any; timestamp: number; hash: string | null },
    stationID?: string
  ) {
    this.doc = new Y.Doc()
    this.doc.getMap('setup')
    this.doc.getMap('users')
    this.doc.getMap('rooms')
    this.doc.getArray('chat')

    this.id = setup.id
    this.hash = setup.hash
    this.data = clone(setup.data)

    this.timestamp.config = setup.timestamp

    this.peerID = getPeerID()
    if (stationID) {
      this.isStation = true
      this.peerID = 'Station ' + stationID
    }

    this.state = new State(this.peerID)

    const provider = new TrysteroProvider(
      this.id + (this.hash || ''),
      this.doc,
      {
        appId: 'edry-Lite', // optional, but recommended
        joinRoom: joinRoom,
      }
    )

    this.initSetup()
    console.warn('provider', provider)

    provider.on('status', (event) => {
      this.connected = event.connected

      if (event.connected) {
        const setup = this.doc.getMap('setup')

        setup.observe((event) => {
          const timestamp = this.doc.getMap('setup').get('timestamp')

          if (this.timestamp.config !== timestamp) {
            this.initSetup()
          }
        })
      }

      this.update('connected')
    })

    provider.on('synced', (event) => {
      console.warn('sync XXXXXXXXXXXXXXXXXXXXXXXXXXXX', event)
    })
  }

  initSetup() {
    const setup = this.doc.getMap('setup')

    const timestamp: number = (setup.get('timestamp') as number) || 0
    const data = setup.get('config')

    // If my setup is older than the current setup
    if (this.timestamp.config < timestamp) {
      this.data = data
      this.timestamp.config = timestamp
      this.update('setup')
    }
    // if the received setup is not up to date
    else if (this.timestamp.config !== timestamp) {
      this.doc.transact(() => {
        setup.set('config', this.data)
        setup.set('timestamp', this.timestamp.config)
      })
    }
    // equal setups will be ignored
  }

  initUser(role: 'student' | 'teacher' | 'station') {
    const users = this.doc.getMap('users')

    this.userSettings.displayName = getShortPeerID(this.peerID)
    this.userSettings.room = this.isStation ? this.peerID : LOBBY
    this.userSettings.dateJoined = Date.now()
    this.userSettings.timestamp = Date.now()
    this.userSettings.role = role

    users.set(this.peerID, clone(this.userSettings))

    users.observe((event) => {
      this.update('room')
    })
  }

  initRooms() {
    const rooms = this.doc.getMap('rooms')

    if (rooms.size === 0) {
      this.doc.transact(() => {
        this.addRoom(LOBBY)

        if (this.isStation) {
          this.addRoom(this.peerID)
        }

        if (this.data.meta.defaultNumberOfRooms) {
          for (let i = 1; i <= this.data.meta.defaultNumberOfRooms; i++) {
            this.addRoom('Room ' + i)
          }
        }
      })
    }

    rooms.observe((event) => {
      this.update('room')
    })
  }

  initChat() {
    const chat = this.doc.getArray('chat')

    chat.observe((event) => {
      console.warn('WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', chat.toArray())
      this.update('chat')
    })
  }

  newSetup(config: { id: string; data: any; timestamp: number }) {
    if (this.hash) {
      const self = this
      hashJsonObject(config.data).then((hash) => {
        if (hash === self.hash) {
          self.id = config.id
          self.data = config.data
          self.timestamp.config = config.timestamp

          self.publishSetup()
        }
      })
    } else {
      this.id = config.id
      this.data = config.data
      this.timestamp.config = config.timestamp

      this.publishSetup()
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
          callback(message)
        }
        break
      }
      case 'setup': {
        if (callback) {
          callback({
            id: this.id,
            data: this.data,
            timestamp: this.timestamp.config,
          })
          this.callbackUpdate[event] = false
        } else {
          this.callbackUpdate[event] = true
        }
        break
      }
      case 'room': {
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
            messages: this.doc.getArray('chat').toArray(),
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

  updateSetup(data: any, timestamp: number) {
    this.data = data
    this.timestamp.config = timestamp

    this.action['sendSetup']({
      data,
      timestamp,
    })
  }

  broadcast(msg: { topic: string; data: any }) {
    if (!this.connected) {
      return
    }

    // @ts-ignore
    msg.id = this.peerID

    if (msg.topic === 'room') {
      const users = this.state.getUsers()

      msg.data.msg.date = Date.now()

      for (const id in this.peers) {
        if (this.peers[id].id) {
          if (users[this.peers[id].id]?.room === msg.data.room) {
            try {
              this.p2pt.send(this.peers[id].peer, msg)
            } catch (e) {
              console.warn('room', e.message)
              //delete this.peers[id]
            }
          }
        }
      }

      // as in the original Edrys ... messages are send back to the sender
      this.update('message', msg.data.msg)
    } else {
      for (const id in this.peers) {
        try {
          this.p2pt.send(this.peers[id].peer, msg)
        } catch (e) {
          console.warn('message', e.message)
          delete this.peers[id]
        }
      }
    }
  }

  setIdentification(config: { id: string; data: any; timestamp: number }) {
    this.id = config.id
    this.data = config.data
    this.timestamp.config = config.timestamp

    this.p2pt.setIdentifier(this.id)

    this.peers = {}
  }

  stop() {
    this.action = {}
    this.callback = {}
    this.callbackUpdate = {}
    this.peers = {}
  }

  addRoom(name?: string) {
    const rooms = this.doc.getMap('rooms')

    if (name && !rooms.has(name)) {
      const room = {
        studentPublicState: '',
        teacherPublicState: '',
        teacherPrivateState: '',
      }

      rooms.set(name, room)
    } else {
      const roomIDs: number[] = Object.keys(rooms.toJSON())
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
    this.userSettings.room = room
    this.userSettings.timestamp = Date.now()

    const users = this.doc.getMap('users')
    users.set(this.peerID, this.userSettings)
  }

  sendMessage(message: string) {
    this.doc.getArray('chat').push([
      {
        timestamp: Date.now(),
        user: getShortPeerID(this.peerID),
        msg: message,
      },
    ])
  }

  join(role: 'student' | 'teacher' | 'station') {
    this.timestamp.join = Date.now()
    this.state.init(role, this.data.meta.defaultNumberOfRooms)

    this.initUser(role)
    this.initRooms()
    this.initChat()

    return this.toJSON()
  }

  toJSON() {
    return {
      rooms: this.doc.getMap('rooms').toJSON(),
      users: this.doc.getMap('users').toJSON(),
    }
  }
}
