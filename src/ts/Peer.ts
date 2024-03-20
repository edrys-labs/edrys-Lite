import P2PT from 'p2pt'
import { getPeerID, hashJsonObject } from './Utils'
import State from './State'

var trackersAnnounceURLs = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
  'wss://tracker.openwebtorrent.com:443/announce',
  'wss://tracker.files.fm:7073/announce',
]

export default class Peer {
  private p2pt: P2PT
  private state: State

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
    config: { id: string; data: any; timestamp: number; hash: string | null },
    stationID?: string
  ) {
    this.id = config.id
    this.hash = config.hash
    this.data = config.data
    this.timestamp.config = config.timestamp

    this.peerID = getPeerID()
    if (stationID) {
      this.peerID = 'Station ' + stationID
    }

    this.state = new State(this.peerID)

    this.p2pt = new P2PT(trackersAnnounceURLs, this.id + (this.hash || ''))

    const self = this
    this.p2pt.on('trackerconnect', (tracker, stats) => {
      //console.log('Connected to tracker : ' + tracker.announceUrl)
      //console.log('Tracker stats : ' + JSON.stringify(stats))
      self.connected = true
      self.update('connected')
    })

    this.p2pt.on('peerconnect', (peer) => {
      //console.warn('Peer connected : ' + peer.id, peer)
      self.peers[peer.id] = { peer, id: null }

      self.publishSetup(peer.id)
    })

    this.p2pt.on('peerclose', (peer) => {
      //console.warn('Peer disconnected : ' + peer)
      const peerID = this.peers[peer.id]?.id

      delete self.peers[peer.id]
      if (peerID) {
        self.state.removeUser(peerID, true)
      }
    })

    this.p2pt.on('msg', (peer, msg) => {
      // console.log(`Got message from ${peer.id} : ${JSON.stringify(msg, null, 2)}`)

      switch (msg.topic) {
        case 'setup': {
          const { data, timestamp } = msg.data

          if (!!self.hash) {
            // answer with the current setup
            if (data === null && self.data !== null) {
              self.broadcast({
                topic: 'setup-update',
                data: {
                  data: self.data,
                  timestamp: self.timestamp.config,
                },
              })
            } else if (data !== null && self.data === null) {
              hashJsonObject(data).then((hash) => {
                if (hash === self.hash) {
                  self.timestamp.config = timestamp
                  self.data = data
                  self.update('setup')
                }
              })
            }
          } else {
            if (timestamp < self.timestamp.config) {
              self.broadcast({
                topic: 'setup-update',
                data: {
                  data: self.data,
                  timestamp: self.timestamp.config,
                },
              })
            } else if (timestamp > self.timestamp.config) {
              self.timestamp.config = timestamp
              self.data = data
              self.update('setup')
            }
          }
          break
        }
        case 'setup-update': {
          const { data, timestamp } = msg.data

          if (!self.hash && timestamp > self.timestamp.config) {
            self.timestamp.config = timestamp
            self.data = data
            self.update('setup')
          }

          break
        }

        case 'room': {
          self.update('message', msg.data.msg)
          break
        }

        case 'room-update':
          if (msg.id === self.peerID) {
            break
          }

          if (!self.peers[peer.id]) {
            self.peers[peer.id] = { peer, id: msg.id }
          } else {
            self.peers[peer.id].id = msg.id
          }

          self.state.merge(msg.data)

          break
        default:
          console.warn('unknown command', msg.topic)
      }
    })

    this.p2pt.start()
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
          callback(this.state.toJSON())
          this.callbackUpdate[event] = false
        } else {
          this.callbackUpdate[event] = true
        }
        break
      }

      case 'chat': {
        if (callback) {
          callback(this.state.getChat())
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

    this.broadcast({
      topic: 'update-setup',
      data: {
        data,
        timestamp,
      },
    })
  }

  broadcast(msg: { topic: string; data: any }) {
    if (!this.p2pt) {
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
    this.p2pt?.destroy()
    this.callback = {}
    this.callbackUpdate = {}
    this.peers = {}
  }

  publishSetup(peerID?: string) {
    const message = {
      topic: 'setup',
      data: {
        data: this.data,
        timestamp: this.timestamp.config,
      },
    }

    if (peerID && this.peers[peerID]) {
      try {
        this.p2pt.send(this.peers[peerID].peer, message)
      } catch (e) {
        console.warn('publishSetup', e.message)
        // delete this.peers[peerID]
      }
    } else {
      this.broadcast(message)
    }
  }

  addRoom() {
    this.state.addRoom(true)
  }

  gotoRoom(room: string) {
    this.state.gotoRoom(room)
  }

  sendMessage(message: string) {
    this.state.addMessage(message)
  }

  join(role: 'student' | 'teacher' | 'station') {
    this.timestamp.join = Date.now()

    this.state.init(role, this.data.meta.defaultNumberOfRooms)

    const self = this
    this.state.on('update', (config: { room?: boolean; chat?: boolean }) => {
      if (config.room || config.chat) {
        this.updateClassroom(!!config.chat)
      }

      if (config.room !== undefined) this.update('room')

      if (config.chat !== undefined) this.update('chat')
    })

    setTimeout(() => {
      self.updateClassroom(true)
    }, 1000)

    return this.state.toJSON()
  }

  updateClassroom(chat: boolean) {
    this.broadcast({
      topic: 'room-update',
      data: this.state.encode(chat),
    })
  }
}
