import { getPeerID, hashJsonObject } from './Utils'
import State from './State'
import { joinRoom, selfID } from '../../node_modules/trystero/src/torrent.js'

import { Room } from 'trystero'
import { send } from 'process'

function LOG(...args: any[]) {
  console.warn('Connection >>', ...args)
}

export default class Peer {
  private room: Room
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
    this.id = setup.id
    this.hash = setup.hash
    this.data = setup.data

    this.timestamp.config = setup.timestamp

    this.peerID = getPeerID()

    if (stationID) {
      this.peerID = 'Station ' + stationID
    }

    this.state = new State(this.peerID)

    const self = this

    this.room = joinRoom({ appId: 'edrys-Lite' }, this.id + (this.hash || ''))

    const [sendSetup, getSetup] = this.room.makeAction('setup')
    const [sendUpdate, getUpdate] = this.room.makeAction('update')
    const [sendConfig, getConfig] = this.room.makeAction('config')
    const [sendRoom, getRoom] = this.room.makeAction('room')

    this.action = { sendSetup, sendUpdate, sendRoom, sendConfig }

    this.room.onPeerJoin((peerId) => {
      LOG('peer joined with id', peerId)

      self.peers[peerId] = null

      sendSetup(
        {
          data: self.data,
          timestamp: self.timestamp.config,
        },
        peerId
      )
    })

    getUpdate((msg, peerID: string) => {
      const { data, timestamp } = msg

      if (!self.hash && timestamp > self.timestamp.config) {
        LOG('applying update from', peerID)

        self.timestamp.config = timestamp
        self.data = data
        self.update('setup')
      } else {
        LOG('ignoring update from', peerID)
      }
    })

    getSetup((msg, peerID: string) => {
      const { data, timestamp } = msg

      LOG('received setup', data, timestamp)

      if (!!self.hash) {
        // answer with the current setup
        if (data === null && self.data !== null) {
          sendUpdate({
            data: self.data,
            timestamp: self.timestamp.config,
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
          sendUpdate({
            data: self.data,
            timestamp: self.timestamp.config,
          })
        } else if (timestamp > self.timestamp.config) {
          self.timestamp.config = timestamp
          self.data = data
          self.update('setup')
        }
      }
    })

    this.room.onPeerLeave((peerId) => {
      LOG(`${peerId} left`)
      self.state.removeUser(peerId, true)
    })

    this.connected = true
    this.update('connected')
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
    this.room.leave()
    this.action = {}
    this.callback = {}
    this.callbackUpdate = {}
    this.peers = {}
  }

  publishSetup(peerID?: string) {
    try {
      this.action['sendSetup'](
        {
          data: this.data,
          timestamp: this.timestamp.config,
        },
        peerID
      )
    } catch (e) {
      console.warn('publishSetup', e.message)
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
