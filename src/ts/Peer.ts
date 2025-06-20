import {
  getPeerID,
  hashJsonObject,
  deepEqual,
  getShortPeerID,
  throttle,
  compareCommunicationConfig,
  updateUrlWithCommConfig,
  cleanUrlAfterCommConfigExtraction,
  decodeCommConfig,
} from './Utils'
import * as Y from 'yjs'
// @ts-ignore
import { EdrysWebrtcProvider } from './EdrysWebrtcProvider'
import { EdrysWebsocketProvider } from './EdrysWebsocketProvider'

function LOG(...args: any[]) {
  console.log(
    '%c🛸 Connection >>>',
    'background-color: #004400; font-weight: bold;',
    ...args
  )
}

const LOBBY = 'Lobby'
const STATION = 'Station'

let heartbeatID: ReturnType<typeof setInterval> | null

const backupConfig = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302',
    },
    {
      urls: 'stun:stun1.l.google.com:19302',
    },
    {
      urls: 'stun:stun2.l.google.com:19302',
    },
    {
      urls: 'stun:stun3.l.google.com:19302',
    },
    {
      urls: 'stun:stun4.l.google.com:19302',
    },
  ],
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
}

const RTCConfiguration = process.env.WEBRTC_CONFIG
  ? JSON.parse(process.env.WEBRTC_CONFIG).config
  : backupConfig
const SignallingServer = JSON.parse(
  process.env.WEBRTC_SIGNALING || '["wss://rooms.deno.dev"]'
)

const WebSocketServer = process.env.WEBSOCKET_SERVER || 'wss://demos.yjs.dev'

export default class Peer {
  private provider: EdrysWebrtcProvider | EdrysWebsocketProvider
  private providerType: 'WebRTC' | 'Websocket' = 'WebRTC'
  private websocketUrl: string = WebSocketServer
  private webrtcConfig: any = RTCConfiguration
  private signalingServer: string[] = SignallingServer
  private _hasSetupObserver: boolean = false
  private throttledUpdate: any

  private t: (key: string) => string

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

  private callback: { [key: string]: any } = {}
  private callbackUpdate: { [key: string]: boolean } = {}
  private logicalClocks: {
    [key: string]: {
      clock: number
      lastModified: number
    }
  } = {}

  private peerID: string

  constructor(
    setup: { id: string; data: any; timestamp: number; hash: string | null },
    stationID?: string,
    t?: (key: string) => string,
    password?: string
  ) {
    const doc = new Y.Doc()
    const clientID = doc.clientID
    doc.clientID = 0

    this.y = {
      doc,
      setup: doc.getMap('setup'),
      users: doc.getMap('users'),
      rooms: doc.getMap('rooms'),
      chat: doc.getArray('chat'),
    }

    doc.clientID = clientID
    this.y.doc = doc

    this.lab = setup

    this.peerID = getPeerID()
    if (stationID) {
      this.role = 'station'
      this.peerID = STATION + ' ' + stationID
    }

    this.t = t || ((key: string) => key)

    this.throttledUpdate = throttle(() => {
      if (this.connected) {
        this.update('room')
      } else {
        // Queue the update to be processed after connection is established
        setTimeout(() => this.update('room'), 500)
      }
    }, 500)

    // Apply communication configuration from setup.data if it exists
    if (setup.data && setup.data.communicationConfig) {
      const encodedConfig = setup.data.communicationConfig
      const commConfig = decodeCommConfig(encodedConfig)

      if (commConfig) {
        if (commConfig.communicationMethod) {
          this.providerType = commConfig.communicationMethod
        }

        if (commConfig.websocketUrl && this.providerType === 'Websocket') {
          this.websocketUrl = commConfig.websocketUrl
        }

        if (commConfig.signalingServer && this.providerType === 'WebRTC') {
          this.signalingServer = Array.isArray(commConfig.signalingServer)
            ? commConfig.signalingServer
            : [commConfig.signalingServer]
        }

        if (commConfig.webrtcConfig && this.providerType === 'WebRTC') {
          try {
            this.webrtcConfig =
              typeof commConfig.webrtcConfig === 'string'
                ? JSON.parse(commConfig.webrtcConfig)
                : commConfig.webrtcConfig
          } catch (e) {
            console.error('Invalid WebRTC config JSON:', e)
          }
        }
      }
    }

    // Initialize local state within a transaction
    this.y.doc.transact(() => {
      this.initUser(this.role, false)
      this.initRooms()
      this.initChat()
      this.initSetup()
    }, 'initialization')

    // Set up persistence before connecting
    const room = this.lab.id + (this.lab.hash || '')

    this.connectProvider(room, password)

    // Ensure cleanup on page unload
    window.addEventListener('beforeunload', this.stop)
  }

  /**
   * Establishes the provider connection based on the selected type (WebRTC or Websocket).
   * @param room The room identifier.
   * @param password The password for the room.
   */
  private connectProvider(room: string, password?: string) {
    try {
      // Disconnect existing provider if it exists
      if (this.provider) {
        this.provider.disconnect()
        this.provider.destroy()
      }

      if (this.providerType === 'WebRTC') {
        LOG('Connecting using WebRTC provider')

        this.provider = new EdrysWebrtcProvider(room, this.y.doc, {
          signaling: this.signalingServer,
          password: password || 'password',
          userid: this.peerID,
          peerOpts: this.webrtcConfig,
        })

        // Handle provider status events
        this.provider.on('status', this.handleStatus.bind(this))

        // Handle synced events
        this.provider.on('synced', this.handleSynced.bind(this))
      } else if (this.providerType === 'Websocket') {
        LOG('Connecting using WebSocket provider')

        this.provider = new EdrysWebsocketProvider(room, this.y.doc, {
          serverUrl: this.websocketUrl,
          userid: this.peerID,
        })

        // Event handlers for WebSocket provider (status and synced)
        this.provider.on('status', this.handleStatus.bind(this))
        this.provider.on('synced', this.handleSynced.bind(this))
      }

      // Register the onLeave callback
      this.provider.onLeave((userid) => {
        console.log(`Peer with userid ${userid} has left the room.`)
        this.removePeers([userid])
      })

      // Listen for messages
      this.provider.onMessage((msg) => {
        this.update('message', msg)
      })
    } catch (error) {
      console.error('Error connecting provider:', error)
      // Implement retry logic or other recovery mechanisms if necessary
    }
  }

  /**
   * Switches the communication provider at runtime.
   * @param config The new communication configuration.
   */
  switchProvider(config: {
    communicationMethod: 'WebRTC' | 'Websocket'
    websocketUrl?: string
    webrtcConfig?: string | object
  }) {
    if (
      config.communicationMethod === this.providerType &&
      (config.communicationMethod !== 'Websocket' ||
        config.websocketUrl === this.websocketUrl) &&
      (config.communicationMethod !== 'WebRTC' ||
        deepEqual(
          typeof config.webrtcConfig === 'string'
            ? JSON.parse(config.webrtcConfig as string)
            : config.webrtcConfig,
          this.webrtcConfig
        ))
    ) {
      LOG('Provider configuration unchanged')
      return
    }

    this.providerType = config.communicationMethod

    if (config.websocketUrl) {
      this.websocketUrl = config.websocketUrl
    }

    if (config.webrtcConfig) {
      if (typeof config.webrtcConfig === 'string') {
        try {
          this.webrtcConfig = JSON.parse(config.webrtcConfig)
        } catch (e) {
          console.error('Invalid WebRTC config JSON:', e)
        }
      } else {
        this.webrtcConfig = config.webrtcConfig
      }
    }

    // Reconnect with new provider
    this.connected = false
    this.update('connected')
    const room = this.lab.id + (this.lab.hash || '')
    this.connectProvider(room)
  }

  /**
   * Handles provider status changes.
   */
  private handleStatus(event: { status: string }) {
    LOG('status', event)

    // Observe setup changes
    this.y.setup.observe(this.handleSetupChange.bind(this))

    // Delay setting connected to true to ensure synchronization
    setTimeout(() => {
      if (!this.connected) {
        this.connected = true

        if (!this.allowedToParticipate()) {
          this.update('popup', this.t('peer.feedback.noAccess'))
        }
        LOG('synced', event)
        this.update('connected')
      }
    }, 5000)
  }

  /**
   * Handles synced events from the provider.
   */
  private handleSynced(event: any) {
    LOG('Synced event received', event)

    // Observe setup changes if not already observing
    if (!this._hasSetupObserver) {
      this.y.setup.observe(this.handleSetupChange.bind(this))
      this._hasSetupObserver = true
    }

    // Ensure that synchronization is complete before updating state
    setTimeout(() => {
      if (!this.connected) {
        this.connected = true
        this.update('connected')

        // When synced, check access permissions
        if (!this.allowedToParticipate()) {
          this.update('popup', this.t('peer.feedback.noAccess'))
        }

        // If the setup is empty or doesn't match our lab data, initialize it
        const timestamp = this.y.setup.get('timestamp') as number
        if (!timestamp && this.lab.timestamp > 0 && this.lab.data) {
          LOG('Initializing setup from local data during sync')
          this.initSetup(true)
        }
      }
    }, 5000)
  }

  /**
   * Observes setup changes and initializes setup if necessary.
   */
  private handleSetupChange(event: Y.YMapEvent<any>) {
    const timestamp = this.y.setup.get('timestamp')

    if (this.lab.timestamp !== timestamp) {
      this.initSetup()
    }
  }

  /**
   * Returns the current user data.
   */
  user() {
    return this.y.users.get(this.peerID)
  }

  /**
   * Checks if the current role is a station.
   */
  isStation() {
    return this.role === 'station'
  }

  /**
   * Removes peers by their peerIDs.
   * @param peerIds Array of peerIDs to remove.
   */
  removePeers(peerIds: string[]) {
    const peers = this.y.users.toJSON()

    this.y.doc.transact(() => {
      for (const id in peers) {
        if (peerIds.includes(id)) {
          this.y.users.delete(id)

          if (peers[id].role === 'station') {
            this.y.rooms.delete(id)
          }

          delete this.logicalClocks[id]
        }
      }
    }, 'removePeers')
  }

  logSetupChanges(oldSetup: any, newSetup: any) {
    if (oldSetup === null || !oldSetup || !newSetup) {
      return
    }

    // Skip showing the module changes popup for initial setup when joining a new session
    const isJoiningSession =
      oldSetup.modules === undefined || oldSetup.modules?.length === 0

    const oldEncodedConfig = oldSetup.communicationConfig || null
    const newEncodedConfig = newSetup.communicationConfig || null

    // Decode configs for comparison
    const oldCommConfig = oldEncodedConfig
      ? decodeCommConfig(oldEncodedConfig)
      : null
    const newCommConfig = newEncodedConfig
      ? decodeCommConfig(newEncodedConfig)
      : null

    if (!compareCommunicationConfig(oldCommConfig, newCommConfig)) {
      // Update URL based on new communication config
      if (newCommConfig) {
        updateUrlWithCommConfig(newCommConfig)
      } else {
        // Clean URL if new config results in no encoding (default WebRTC)
        cleanUrlAfterCommConfigExtraction(true);
      }

      this.update('popup', this.t('peer.feedback.communicationChanges'))

      setTimeout(() => {
        window.location.reload()
      }, 3000)

      return
    }

    // Only show module changes popup if this isn't initial setup and modules have actually changed
    if (!isJoiningSession && !deepEqual(oldSetup.modules, newSetup.modules)) {
      this.update('popup', this.t('peer.feedback.moduleChanges'))
    }

    if (!deepEqual(oldSetup.members, newSetup.members)) {
      const id = getPeerID(false)

      if (newSetup.createdBy === id || this.isStation()) {
        return
      }

      if (
        oldSetup.members.teacher.includes(id) &&
        !newSetup.members.teacher.includes(id)
      ) {
        this.update('popup', this.t('peer.feedback.removedTeacher'))
        this.user().set('role', 'student')
      }

      if (
        !oldSetup.members.teacher.includes(id) &&
        newSetup.members.teacher.includes(id)
      ) {
        this.update('popup', this.t('peer.feedback.addedTeacher'))
        this.user().set('role', 'teacher')
        return
      }

      if (
        oldSetup.members.teacher.includes(id) &&
        newSetup.members.teacher.includes(id)
      ) {
        return
      }

      const isInOldSetup = oldSetup.members.student.includes(id)
      const oldOpen =
        oldSetup.members.student.length === 0 ||
        oldSetup.members.student.includes('*')

      const isInNewSetup = newSetup.members.student.includes(id)
      const newOpen =
        newSetup.members.student.length === 0 ||
        newSetup.members.student.includes('*')

      if ((oldOpen || !isInOldSetup) && isInNewSetup) {
        this.update('popup', this.t('peer.feedback.addedStudent'))

        return
      }

      if (!oldOpen && newOpen) {
        this.update('popup', this.t('peer.feedback.addedStudent'))
        return
      }

      if (!oldOpen && isInOldSetup && !isInNewSetup) {
        this.update('popup', this.t('peer.feedback.removedStudent'))
        return
      }

      if (oldOpen && !newOpen && !isInNewSetup) {
        this.update('popup', this.t('peer.feedback.removedStudent'))
      }
    }
  }

  /**
   * Initializes the setup map with proper conflict resolution.
   */
  initSetup(force: boolean = false) {
    const timestamp: number = (this.y.setup.get('timestamp') as number) || 0
    const data = this.y.setup.get('config')

    this.y.doc.transact(() => {
      if (force) {
        LOG('Force update new configuration')

        this.logSetupChanges(data, this.lab.data)

        this.y.setup.set('config', this.lab.data)
        this.y.setup.set('timestamp', this.lab.timestamp)

        if (!this.allowedToParticipate()) {
          this.update('popup', this.t('peer.feedback.noAccess'))
        }
      }
      // If my setup is older than the current setup
      else if (this.lab.timestamp < timestamp) {
        LOG('receiving initial lab configuration')

        this.logSetupChanges(this.lab.data, data)

        this.lab.data = data
        this.lab.timestamp = timestamp
        this.update('setup')

        if (!this.allowedToParticipate()) {
          this.update('popup', this.t('peer.feedback.noAccess'))
        }
      }
      // If the received setup is not up to date or empty
      else if (
        (this.lab.timestamp !== timestamp && this.lab.timestamp > 0) ||
        (timestamp === 0 && this.lab.timestamp > 0 && this.lab.data)
      ) {
        LOG(
          'received outdated or empty lab configuration, writing changes back'
        )
        this.y.setup.set('config', this.lab.data)
        this.y.setup.set('timestamp', this.lab.timestamp)
      }
    }, 'initSetup')
  }

  /**
   * Initializes a user within a transaction.
   * @param role The role of the user.
   * @param withObserver Whether to set up observers.
   */
  initUser(
    role: 'student' | 'teacher' | 'station',
    withObserver: boolean = true
  ) {
    this.role = role

    if (heartbeatID) {
      clearInterval(heartbeatID)
      heartbeatID = null
    }

    this.y.doc.transact(() => {
      const userSettings = new Y.Map()
      const timeNow = Date.now()
      userSettings.set('displayName', getShortPeerID(this.peerID))
      userSettings.set('room', this.isStation() ? this.peerID : LOBBY)
      userSettings.set('role', this.role)
      userSettings.set('dateJoined', timeNow)
      userSettings.set('logicalClock', 0)
      userSettings.set('handRaised', false)
      userSettings.set('connections', [{ id: '', target: {} }])
      this.y.users.set(this.peerID, userSettings)
    }, 'initUser')

    heartbeatID = setInterval(() => {
      if (this.y.users.has(this.peerID)) {
        this.ticktack()
        this.checkLogicalClocks()
      } else {
        LOG('user not found', this.peerID)
      }
    }, 5000)

    if (withObserver) {
      this.y.users.observeDeep((events) => {
        const onlyClockEvents = events.every((event) => {
          return (
            event.changes.keys &&
            event.changes.keys.size === 1 &&
            event.changes.keys.has('logicalClock')
          )
        })

        if (!onlyClockEvents) {
          this.throttledUpdate()
        }
      })
    }
  }

  /**
   * Initializes rooms within a transaction.
   */
  initRooms() {
    this.y.doc.transact(() => {
      if (this.y.rooms.size === 0) {
        LOG('initializing rooms')

        this.addRoom(LOBBY)

        let defaultRooms = 0
        try {
          defaultRooms = this.lab.data.meta.defaultNumberOfRooms
        } catch (e) {}

        if (defaultRooms) {
          for (let i = 1; i <= defaultRooms; i++) {
            this.addRoom('Room ' + i)
          }
        }
      }
      if (this.isStation() && !this.y.rooms.has(this.peerID)) {
        this.addRoom(this.peerID)
      }
    }, 'initRooms')

    this.y.rooms.observeDeep((events) => {
      events.forEach((event) => {
        if (event.target === this.y.rooms) {
          const keysChanged = Array.from(event.changes.keys.keys())

          keysChanged.forEach((key) => {
            const change = event.changes.keys.get(key)
            if (change?.action === 'delete') {
              if (this.user() && this.user().get('room') === key) {
                LOG('current room was deleted, moving to lobby')
                this.y.doc.transact(() => {
                  this.ticktack()
                  this.user().set('room', LOBBY)
                }, 'moveToLobby')
              }
            }
          })
        }
      })

      this.throttledUpdate()
    })
  }

  /**
   * Initializes chat within a transaction.
   */
  initChat() {
    this.y.doc.transact(() => {
      this.y.chat.observe((event) => {
        this.update('chat')
      })
    }, 'initChat')
  }

  checkLogicalClocks() {
    const timeNow = Date.now()
    const users = this.y.users.toJSON()
    const deadPeers: string[] = []
    const timeout = 15000

    for (const id in users) {
      if (id === this.peerID) continue

      const user = users[id]

      if (this.logicalClocks[id] === undefined) {
        this.logicalClocks[id] = {
          clock: user.logicalClock,
          lastModified: timeNow,
        }
      } else {
        if (user.logicalClock != this.logicalClocks[id].clock) {
          this.logicalClocks[id].clock = user.logicalClock
          this.logicalClocks[id].lastModified = timeNow
        } else if (timeNow - this.logicalClocks[id].lastModified > timeout) {
          deadPeers.push(id)
        }
      }
    }

    if (deadPeers.length > 0) {
      this.removePeers(deadPeers)
    } else {
      this.checkForDeadStations()
    }
  }

  checkForDeadStations() {
    const rooms = this.y.rooms.toJSON()
    const stations = Object.keys(rooms).filter((id) =>
      id.toLocaleLowerCase().startsWith('station')
    )

    if (stations.length > 0) {
      const deadStation: string[] = []
      const users = this.y.users.toJSON()

      for (const station of stations) {
        let found = false
        for (const id in users) {
          if (users[id].room === station) {
            found = true
            break
          }
        }

        if (!found) {
          deadStation.push(station)
        }
      }

      if (deadStation.length > 0) {
        this.y.doc.transact(() => {
          for (const station of deadStation) {
            LOG('Removing dead station', station)
            this.y.rooms.delete(station)
          }
        }, 'checkForDeadStations')
      }
    }
  }

  /**
   * Handles new setup configurations.
   * @param config The new configuration.
   */
  newSetup(config: { id: string; data: any; timestamp: number }) {
    if (this.lab.hash) {
      const self = this
      hashJsonObject(config.data).then((hash) => {
        if (hash === self.lab.hash && self.lab.timestamp < config.timestamp) {
          self.lab.id = config.id
          self.lab.data = config.data
          self.lab.timestamp = config.timestamp

          self.initSetup(true)
        } else {
          LOG('updating failed, hash mismatch')
        }
      })
    } else {
      if (this.lab.timestamp < config.timestamp) {
        this.lab.id = config.id
        this.lab.data = config.data
        this.lab.timestamp = config.timestamp

        this.initSetup(true)
      }
    }
  }

  /**
   * Updates different parts of the state based on events.
   * @param event The event type.
   * @param message Optional message data.
   */
  async update(
    event:
      | 'setup'
      | 'room'
      | 'message'
      | 'connected'
      | 'chat'
      | 'popup'
      | 'commChanged',
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
        if (callback && this.connected) {
          callback(await this.toJSON())
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

      case 'popup': {
        if (callback) {
          callback(message)
          this.callbackUpdate[event] = false
        } else {
          this.callbackUpdate[event] = true
        }
        break
      }

      case 'commChanged': {
        if (callback) {
          callback(message)
          this.callbackUpdate[event] = false
        } else {
          this.callbackUpdate[event] = true
        }
        break
      }
    }
  }

  /**
   * Registers event callbacks.
   * @param event The event type.
   * @param callback The callback function.
   */
  on(
    event: 'setup' | 'room' | 'connected' | 'popup' | 'commChanged',
    callback: any
  ) {
    if (callback) {
      this.callback[event] = callback

      if (this.callbackUpdate[event]) {
        this.update(event)
      }
    } else if (this.callback[event]) {
      delete this.callback[event]
    }
  }

  allowedToParticipate(id?: string) {
    if (id === undefined) id = getPeerID(false)

    if (
      this.lab.data.members.student.length === 0 ||
      this.lab.data.members.student.includes('*')
    ) {
      return true
    }

    if (
      this.lab.data.members.teacher.includes(id) ||
      this.lab.data.members.student.includes(id)
    ) {
      return true
    }

    if (this.lab.data.createdBy === id) {
      return true
    }

    if (this.isStation()) {
      return true
    }

    return false
  }

  /**
   * Broadcasts a message to a room or specific user.
   * @param room The room to broadcast to.
   * @param msg The message to send.
   */
  broadcast(room: string, msg: any) {
    if (!this.connected) {
      return
    }

    if (!this.allowedToParticipate()) {
      console.warn(this.t('peer.feedback.unauthorized'))
      return
    }

    const users = this.y.users.toJSON()

    if (msg.user) {
      if (msg.user === this.peerID) {
        this.update('message', msg)
      } else {
        this.provider.sendMessage(msg, msg.user)
      }
      return
    }

    for (const id in users) {
      if (users[id].room === room && id !== this.peerID) {
        try {
          this.provider.sendMessage(msg, id)
        } catch (e: any) {
          LOG('warning', e.message)
        }
      }
    }
    this.update('message', msg)
  }

  /**
   * Stops the peer, cleans up resources.
   */
  stop() {
    LOG('stopping peer')
    if (heartbeatID) {
      clearInterval(heartbeatID)
      heartbeatID = null
    }

    window.removeEventListener('beforeunload', this.stop)

    this.y.doc.transact(() => {
      this.y.users.delete(this.peerID)
    }, 'stop')

    if (this.provider) {
      this.provider.disconnect()
      this.provider.destroy()
    }

    this.callback = {}
    this.callbackUpdate = {}

    this.y.doc.destroy()
  }

  /**
   * Adds a new room.
   * @param name Optional name of the room.
   */
  addRoom(name?: string) {
    this.y.doc.transact(() => {
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
    }, 'addRoom')
  }

  /**
   * Moves the user to a specified room.
   * @param room The room to move to.
   */
  gotoRoom(room: string) {
    this.y.doc.transact(() => {
      this.user().set('room', room)
      this.ticktack()
    }, 'gotoRoom')
  }

  ticktack() {
    this.user().set('logicalClock', (this.user().get('logicalClock') || 0) + 1)
  }

  /**
   * Sends a chat message.
   * @param message The message to send.
   */
  sendMessage(message: string) {
    this.y.doc.transact(() => {
      this.y.chat.push([
        {
          timestamp: Date.now(),
          user: getShortPeerID(this.peerID),
          msg: message,
        },
      ])
    }, 'sendMessage')
  }

  /**
   * Applies an update to the Y.Doc.
   * @param data The update data.
   */
  updateState(data: Uint8Array) {
    if (!this.allowedToParticipate()) {
      console.warn(this.t('peer.feedback.notPropagated'))
      return
    }

    Y.applyUpdate(this.y.doc, data, { transactionId: 'extern' })
  }

  /**
   * Joins a role and initializes necessary components.
   * @param role The role to join as.
   */
  async join(role: 'student' | 'teacher' | 'station') {
    this.initUser(role)
    this.initRooms()
    this.initChat()

    this.throttledUpdate()
  }

  /**
   * Serializes the current state to JSON.
   * @returns The serialized state.
   */
  async toJSON() {
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
      doc: Y.encodeStateAsUpdate(this.y.doc),
    }
  }

  /**
   * Executes a function within a Yjs transaction and waits for it to complete.
   * @param transactFn The function to execute within the transaction.
   */
  awaitTransact(transactFn: () => void): Promise<void> {
    return new Promise((resolve) => {
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
      }, 'awaitTransact')
    })
  }

  /**
   * Gets the WebRTC configuration.
   */
  async getWebRTCConfig(): Promise<RTCConfiguration> {
    return RTCConfiguration
  }
}
