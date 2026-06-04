import {
  getPeerID,
  initCryptoIdentity,
  deepEqual,
  getShortPeerID,
  throttle,
  compareCommunicationConfig,
  updateUrlWithCommConfig,
  cleanUrlAfterCommConfigExtraction,
  decodeCommConfig,
  signSetup,
  verifySetup,
  hashPubKey,
  stripPubKey,
  signEntry,
  verifyEntry,
  REVERT_INVALID_ORIGIN,
  Envelope,
} from './Utils'
import * as Y from 'yjs'
// @ts-ignore
import { EdrysWebrtcProvider } from './EdrysWebrtcProvider'
import { EdrysWebsocketProvider } from './EdrysWebsocketProvider'
import { debug } from '../api/debugHandler'

function LOG(...args: any[]) {
  debug.ts.peer(
    '%c🛸 Connection >>>',
    'background-color: #004400; font-weight: bold;',
    ...args
  )
}

function teacherMembersChangeAllowed(newMembers: any, ownerPubKey: string): boolean {
  if (!newMembers) return false
  const owner = stripPubKey(ownerPubKey)
  // Owner is identified by createdBy, not by presence in teacher list — only block if explicitly moved to students
  const studentList: string[] = newMembers.student || []
  const ownerExplicitlyStudent = !studentList.includes('*') && studentList.some((s: string) => stripPubKey(s) === owner)
  return !ownerExplicitlyStudent
}

const LOBBY = 'Lobby'
const STATION = 'Station'

/**
 * Authorization rule for y.users[id] writes.
 *  - Human peer (id = "<pubkey>_<sessionID>"): signer's pubkey must equal "<pubkey>".
 *  - Station peer (id starts with "Station "): signer must be owner (setup.createdBy)
 *    or in setup.members.teacher.
 */
export function isAuthorizedUserSigner(
  id: string,
  signer: string,
  ownerPubKey: string,
  teachers: string[]
): boolean {
  if (!signer) return false
  if (id.startsWith(STATION + ' ')) {
    if (ownerPubKey && stripPubKey(signer) === stripPubKey(ownerPubKey)) return true
    return teachers.some((t) => stripPubKey(t) === stripPubKey(signer))
  }
  const sep = id.lastIndexOf('_')
  if (sep <= 0) return false
  const pubkeyPart = id.slice(0, sep)
  return stripPubKey(pubkeyPart) === stripPubKey(signer)
}

// Default rooms (Lobby / Room N) accept any signer so a student can bootstrap
// before the owner is online; everything else (Station ..., named rooms) is owner/teacher only.
export function isAuthorizedRoomSigner(
  name: string,
  signer: string,
  ownerPubKey: string,
  teachers: string[]
): boolean {
  if (!signer) return false
  if (name === LOBBY || /^Room \d+$/.test(name)) return true
  if (ownerPubKey && stripPubKey(signer) === stripPubKey(ownerPubKey)) return true
  return teachers.some((t) => stripPubKey(t) === stripPubKey(signer))
}

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
    roomSigs: Y.Map<Envelope>
    users: Y.Map<any>
    userSigs: Y.Map<Envelope>
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

  private expectedOwner: string | null = null

  constructor(
    setup: { id: string; data: any; timestamp: number; hash: string | null },
    stationID?: string,
    t?: (key: string) => string,
    password?: string,
    expectedOwner?: string
  ) {
    const doc = new Y.Doc()
    const clientID = doc.clientID
    doc.clientID = 0

    this.y = {
      doc,
      setup: doc.getMap('setup'),
      users: doc.getMap('users'),
      userSigs: doc.getMap('userSigs'),
      rooms: doc.getMap('rooms'),
      roomSigs: doc.getMap('roomSigs'),
      chat: doc.getArray('chat'),
    }

    doc.clientID = clientID
    this.y.doc = doc

    this.lab = setup
    this.expectedOwner = expectedOwner || null

    this.peerID = ''
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
    initCryptoIdentity().then(() => {
      if (this.role !== 'station') {
        this.peerID = getPeerID()
      }

      // Initialize local state now that peerID is known
      this.y.doc.transact(() => {
        this.initUser(this.role, false)
        this.initRooms()
        this.initChat()
        this.initSetup()
      }, 'initialization')

      this._connectProviderWithIdentity(room, password)
    }).catch((e) => console.error('Crypto identity init failed:', e))
  }

  private _connectProviderWithIdentity(room: string, password?: string) {
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
          classroomId: room,
          peerOpts: {
            config: this.webrtcConfig
          }
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
          classroomId: room,
        })

        // Event handlers for WebSocket provider (status and synced)
        this.provider.on('status', this.handleStatus.bind(this))
        this.provider.on('synced', this.handleSynced.bind(this))
      }

      // Register the onLeave callback
      this.provider.onLeave((userid) => {
        debug.ts.peer(`Peer with userid ${userid} has left the room.`)
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
    }, 2000)
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

      this._ownerAutoHealStaleSigner().catch((e) =>
        console.error('owner auto-heal failed:', e)
      )
    }
  }

  /**
   * Observes setup changes and initializes setup if necessary.
   */
  private handleSetupChange(_event: Y.YMapEvent<any>) {
    const timestamp = this.y.setup.get('timestamp')

    // Skip partial merge states where Y.js delivers config and timestamp in
    // separate observer calls — wait for the event that includes timestamp.
    if (timestamp === undefined) return

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
          this.y.userSigs.delete(id)
          delete this.logicalClocks[id]
        }
      }
    }, 'removePeers')
  }

  logSetupChanges(oldSetup: any, newSetup: any) {
    if (oldSetup === null || !oldSetup || !newSetup) {
      return
    }

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
        const next = this._nextUserPayload(this.peerID, { role: 'student' })
        if (next) this._writeAndSignUser(this.peerID, next, 'roleDemote')
      }

      if (
        !oldSetup.members.teacher.includes(id) &&
        newSetup.members.teacher.includes(id)
      ) {
        this.update('popup', this.t('peer.feedback.addedTeacher'))
        const next = this._nextUserPayload(this.peerID, { role: 'teacher' })
        if (next) this._writeAndSignUser(this.peerID, next, 'rolePromote')
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

    if (force) {
      LOG('Force update new configuration')
      this._signAndWrite(data).catch((e) => console.error('initSetup sign failed:', e))
    } else if (this.lab.timestamp < timestamp) {
      this._verifyAndAccept(data, timestamp).then((accepted) => {
        // If the incoming config was rejected and we have our own valid config, overwrite
        if (!accepted && this.lab.timestamp > 0 && this.lab.data) {
          LOG('Incoming config rejected, reasserting our own signed config')
          this._signAndWrite(data).catch((e) => console.error('initSetup reassert failed:', e))
        }
      }).catch((e) => console.error('initSetup verify failed:', e))
    } else if (
      (this.lab.timestamp !== timestamp && this.lab.timestamp > 0) ||
      (timestamp === 0 && this.lab.timestamp > 0 && this.lab.data)
    ) {
      LOG('received outdated or empty lab configuration, writing changes back')
      this._signAndWrite(data).catch((e) => console.error('initSetup writeback failed:', e))
    }
  }

  private async _signAndWrite(existingCrdt: any): Promise<void> {
    const myPubKey = getPeerID(false)
    const ownerPubKey: string = this.lab.data?.createdBy || ''
    const isOwner = myPubKey === ownerPubKey

    // Deserialize Yjs Proxy to plain object for reliable field access and comparison
    const existingMembers = existingCrdt != null ? JSON.parse(JSON.stringify(existingCrdt)).members ?? null : null
    const establishedTeachers: string[] = existingMembers?.teacher || this.lab.data?.members?.teacher || []
    const isTeacher = establishedTeachers.some((t: string) => stripPubKey(t) === stripPubKey(myPubKey))

    // Only the owner or a current teacher may sign setup updates.
    if (!isOwner && !isTeacher) {
      return
    }

    const membersChangedLocally = existingMembers != null && !deepEqual(this.lab.data?.members, existingMembers)
    if (!isOwner && membersChangedLocally && !teacherMembersChangeAllowed(this.lab.data?.members, ownerPubKey)) {
      this.update('popup', this.t('peer.feedback.noPermission'))
      return
    }

    const dataToWrite = {
      ...this.lab.data,
      createdBy: ownerPubKey,
      setupSigner: myPubKey,
      setupSignature: await signSetup({ ...this.lab.data, createdBy: ownerPubKey, timestamp: this.lab.timestamp }),
    }
    this.logSetupChanges(this.lab.data, dataToWrite)
    this.y.doc.transact(() => {
      this.y.setup.set('config', dataToWrite)
      this.y.setup.set('timestamp', this.lab.timestamp)
      if (!this.allowedToParticipate()) {
        this.update('popup', this.t('peer.feedback.noAccess'))
      }
    }, 'initSetup')
  }

  /**
   * When the owner is online and the CRDT setup is signed by someone no longer
   * authorized, overwrite it with a fresh owner-signed setup.
   */
  private async _ownerAutoHealStaleSigner(): Promise<void> {
    const myPubKey = getPeerID(false)
    const ownerPubKey: string = this.lab.data?.createdBy || ''
    if (myPubKey !== ownerPubKey) return

    const currentConfig: any = this.y.setup.get('config')
    if (!currentConfig || !currentConfig.setupSigner) return

    const signer: string = currentConfig.setupSigner
    const signerIsOwner = stripPubKey(signer) === stripPubKey(ownerPubKey)
    if (signerIsOwner) return

    const currentTeachers: string[] = this.lab.data?.members?.teacher || []
    const signerIsTeacher = currentTeachers.some((t: string) => stripPubKey(t) === stripPubKey(signer))
    if (signerIsTeacher) return

    LOG('y.setup signed by unauthorized signer, owner re-signing to heal')
    await this._signAndWrite(currentConfig)
  }

  // Re-run authz on entries we deferred while lab.data.createdBy was empty.
  private _reverifyAfterSetup(): void {
    const roomKeys = new Set(Object.keys(this.y.rooms.toJSON()))
    if (roomKeys.size > 0) {
      this._verifyAndRevertRoomChange(roomKeys, false).catch((e) => LOG('reverify rooms failed', e))
    }
    const userKeys = new Set(Object.keys(this.y.users.toJSON()))
    if (userKeys.size > 0) {
      this._verifyAndRevertUserChange(userKeys).catch((e) => LOG('reverify users failed', e))
    }
  }

  private async _verifyAndAccept(data: any, timestamp: number): Promise<boolean> {
    if (!data || !data.setupSignature || !data.setupSigner || !data.createdBy) {
      LOG('Setup rejected: missing signature fields')
      return false
    }

    const signerPubKey: string = data.setupSigner
    const localCreatedBy: string | undefined = this.lab.data?.createdBy

    // A student who joined before migration has a legacy createdBy
    // cached and cannot enforce the equality guard against the owner's post-migration
    // self-signed broadcast.
    const isLegacyCreatedBy = !!localCreatedBy && localCreatedBy.length < 40

    if (localCreatedBy && !isLegacyCreatedBy && data.createdBy !== localCreatedBy) {
      LOG('Setup rejected: createdBy mismatch')
      return false
    }

    if (isLegacyCreatedBy && data.setupSigner !== data.createdBy) {
      LOG('Setup rejected: legacy createdBy can only be replaced by self-signed owner broadcast')
      return false
    }

    if (!localCreatedBy && this.expectedOwner) {
      const incomingHash = await hashPubKey(data.createdBy)
      if (incomingHash !== this.expectedOwner) {
        LOG('Setup rejected: createdBy does not match expected owner from URL')
        return false
      }
    }

    const ownerPubKey: string = isLegacyCreatedBy ? data.createdBy : (localCreatedBy || data.createdBy)
    const localTeachers: string[] = this.lab.data?.members?.teacher || []
    const membersChanged = !deepEqual(data.members, this.lab.data?.members)
    const signerIsOwner = stripPubKey(signerPubKey) === stripPubKey(ownerPubKey)
    const signerIsTeacher = localTeachers.some(t => stripPubKey(t) === stripPubKey(signerPubKey))
    const teacherCanChangeMembers = signerIsTeacher && teacherMembersChangeAllowed(data.members, ownerPubKey)
    const signerAuthorized = signerIsOwner || (!membersChanged && signerIsTeacher) || teacherCanChangeMembers

    if (!signerAuthorized) {
      LOG('Setup rejected: signer not authorized for this change')
      return false
    }

    const valid = await verifySetup(
      { name: data.name, meta: data.meta, modules: data.modules, members: data.members, createdBy: data.createdBy, timestamp, communicationConfig: data.communicationConfig },
      data.setupSignature,
      signerPubKey
    )

    if (!valid) {
      LOG('Setup rejected: invalid signature')
      return false
    }

    LOG(`receiving lab configuration`)
    this.logSetupChanges(this.lab.data, data)
    this.lab.data = {
      ...this.lab.data,
      name: data.name,
      meta: data.meta,
      modules: data.modules,
      members: data.members,
      createdBy: isLegacyCreatedBy ? data.createdBy : (localCreatedBy || data.createdBy),
      communicationConfig: data.communicationConfig,
    }
    this.lab.timestamp = timestamp
    this.update('setup')

    if (!this.allowedToParticipate()) {
      this.update('popup', this.t('peer.feedback.noAccess'))
    }

    // Rooms/station-users that we received before knowing the owner pubkey
    // were left in place with integrity verified but authz deferred. Run
    // authz now that lab.data.createdBy is known.
    this._reverifyAfterSetup()

    return true
  }

  /**
   * Write a full user payload AND its signature in a single transaction so the
   * two land atomically on every remote peer. Receivers verify against the
   * exact payload that was signed.
   */
  private async _writeAndSignUser(peerID: string, payload: any, origin: string): Promise<void> {
    try {
      const envelope = await signEntry('users', peerID, payload)
      this.y.doc.transact(() => {
        const m = new Y.Map()
        for (const k of Object.keys(payload)) m.set(k, payload[k])
        this.y.users.set(peerID, m)
        this.y.userSigs.set(peerID, envelope)
      }, origin)
    } catch (e) {
      LOG('writeAndSignUser failed', peerID, e)
    }
  }

  /**
   * Write a full user payload AND its signature in a single transaction so the
   * two land atomically on every remote peer. Receivers verify against the
   * exact payload that was signed.
   */
  private _nextUserPayload(peerID: string, patch: Record<string, any>): any | null {
    const entry = this.y.users.get(peerID)
    if (!entry) return null
    return { ...entry.toJSON(), ...patch }
  }

  /** Per-instance wrapper around the pure isAuthorizedUserSigner rule. */
  private _isAuthorizedUserSigner(id: string, signer: string): boolean {
    return isAuthorizedUserSigner(
      id,
      signer,
      this.lab.data?.createdBy || '',
      this.lab.data?.members?.teacher || []
    )
  }

  /** Last verified (payload, envelope) per user key — used to restore on invalid mutation. */
  private _lastGoodUser: Map<string, { payload: any; envelope: Envelope }> = new Map()

  /** Restore the cached good state for key, or delete if no cache exists. */
  private _restoreOrDelete(key: string): void {
    const cached = this._lastGoodUser.get(key)
    this.y.doc.transact(() => {
      if (cached) {
        const m = new Y.Map()
        for (const k of Object.keys(cached.payload)) m.set(k, cached.payload[k])
        this.y.users.set(key, m)
        this.y.userSigs.set(key, cached.envelope)
      } else {
        this.y.users.delete(key)
        this.y.userSigs.delete(key)
      }
    }, REVERT_INVALID_ORIGIN)
  }

  /**
   * Verify y.users mutations for the given keys. Legit writes via
   * `_writeAndSignUser` always land entry+sig atomically, so an entry without
   * a matching valid envelope can only come from a forged raw write — revert
   * by restoring last-good state (or delete if no prior good state exists).
   */
  private async _verifyAndRevertUserChange(keys: Set<string>): Promise<void> {
    const authzKnown = !!(this.lab.data?.createdBy)
    for (const key of keys) {
      try {
        const value = this.y.users.get(key)
        if (!value) { this._restoreOrDelete(key); continue }
        const envelope = this.y.userSigs.get(key) as Envelope | undefined
        const payload = value.toJSON()
        const sigValid = envelope
          ? await verifyEntry('users', key, payload, envelope)
          : false
        if (!sigValid) {
          LOG('y.users entry rejected (bad sig)', key, { hasEnvelope: !!envelope })
          this._restoreOrDelete(key)
          continue
        }
        // Station authz needs owner/teacher info; defer until setup arrives. Human users authz from id prefix alone.
        if (key.startsWith(STATION + ' ') && !authzKnown) continue
        const authorized = this._isAuthorizedUserSigner(key, (envelope as Envelope).signer)
        if (authorized) {
          this._lastGoodUser.set(key, { payload, envelope: envelope as Envelope })
        } else {
          LOG('y.users entry rejected (unauthorized)', key, { signer: (envelope as Envelope).signer })
          this._restoreOrDelete(key)
        }
      } catch (e) {
        LOG('verifyAndRevertUserChange failed', key, e)
      }
    }
  }

  /** Per-instance wrapper around the pure isAuthorizedRoomSigner rule. */
  private _isAuthorizedRoomSigner(name: string, signer: string): boolean {
    return isAuthorizedRoomSigner(
      name,
      signer,
      this.lab.data?.createdBy || '',
      this.lab.data?.members?.teacher || []
    )
  }

  // Local-origin tags; anything else is treated as remote and verified.
  private static ROOM_LOCAL_ORIGINS = new Set<string>([
    'addRoom',
    'initRooms',
    'initialization',
    'checkForDeadStations',
    REVERT_INVALID_ORIGIN,
  ])

  /** Last verified envelope per room — used to revert invalid writes and heal unauthorized deletes. */
  private _lastGoodRoom: Map<string, Envelope> = new Map()

  /** Atomic sign-and-write. Preserves existing Y.Map to avoid stomping per-room module sub-state. */
  private async _writeAndSignRoom(name: string, origin: string): Promise<void> {
    try {
      const envelope = await signEntry('rooms', name, {})
      this.y.doc.transact(() => {
        if (!this.y.rooms.has(name)) {
          this.y.rooms.set(name, new Y.Map())
        }
        this.y.roomSigs.set(name, envelope)
      }, origin)
      // Local writes skip observer-verify, so seed the heal cache directly.
      this._lastGoodRoom.set(name, envelope)
    } catch (e) {
      LOG('writeAndSignRoom failed', name, e)
    }
  }

  /** Atomic delete of a room and its sidecar envelope. */
  private _deleteAndUnsignRoom(name: string, origin: string): void {
    this.y.doc.transact(() => {
      this.y.rooms.delete(name)
      this.y.roomSigs.delete(name)
    }, origin)
    this._lastGoodRoom.delete(name)
  }

  /** Restore a room (and its cached envelope) after an unauthorized delete. */
  private _restoreRoom(name: string, envelope: Envelope): void {
    this.y.doc.transact(() => {
      if (!this.y.rooms.has(name)) this.y.rooms.set(name, new Y.Map())
      this.y.roomSigs.set(name, envelope)
    }, REVERT_INVALID_ORIGIN)
  }

  /**
   * Verify-and-revert for remote y.rooms mutations.
   *  - Add/update with bad/missing sig → revert (delete).
   *  - Add/update with valid sig but unknown authz (setup not yet synced) → defer.
   *  - Add/update with valid sig + authorized → cache as last-good.
   *  - Delete of a cached room → restore (Exploit 3/5 heal).
   */
  private async _verifyAndRevertRoomChange(
    keys: Set<string>,
    fromLocalOrigin: boolean
  ): Promise<void> {
    if (fromLocalOrigin) return
    const authzKnown = !!(this.lab.data?.createdBy)
    for (const name of keys) {
      try {
        const present = this.y.rooms.has(name)
        if (!present) {
          const cached = this._lastGoodRoom.get(name)
          if (cached) {
            LOG('y.rooms entry deleted by untrusted origin, restoring', name)
            this._restoreRoom(name, cached)
          }
          continue
        }
        const envelope = this.y.roomSigs.get(name) as Envelope | undefined
        // Rooms are long-lived and never re-signed; bypass the freshness window. Replay is harmless (creation is idempotent, sig binds to name+container).
        const sigValid = envelope
          ? await verifyEntry('rooms', name, {}, envelope, Number.POSITIVE_INFINITY)
          : false
        if (!sigValid) {
          LOG('y.rooms entry rejected (bad sig)', name, { hasEnvelope: !!envelope })
          this.y.doc.transact(() => {
            this.y.rooms.delete(name)
            this.y.roomSigs.delete(name)
          }, REVERT_INVALID_ORIGIN)
          continue
        }
        if (!authzKnown) {
          // Integrity is proven; defer authz until setup arrives.
          continue
        }
        const authorized = this._isAuthorizedRoomSigner(name, (envelope as Envelope).signer)
        if (authorized) {
          this._lastGoodRoom.set(name, envelope as Envelope)
        } else {
          LOG('y.rooms entry rejected (unauthorized)', name, { signer: (envelope as Envelope).signer })
          this.y.doc.transact(() => {
            this.y.rooms.delete(name)
            this.y.roomSigs.delete(name)
          }, REVERT_INVALID_ORIGIN)
        }
      } catch (e) {
        LOG('verifyAndRevertRoomChange failed', name, e)
      }
    }
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

    const timeNow = Date.now()
    const initialPayload = {
      displayName: this.isStation() ? this.peerID : getShortPeerID(this.peerID),
      room: this.isStation() ? this.peerID : LOBBY,
      role: this.role,
      dateJoined: timeNow,
      logicalClock: 0,
      handRaised: false,
      connections: [{ id: '', target: {} }],
    }
    this._writeAndSignUser(this.peerID, initialPayload, 'initUser')

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
        const keysAffected = new Set<string>()
        const onlyClockEvents = events.every((event) => {
          return (
            event.changes.keys &&
            event.changes.keys.size === 1 &&
            event.changes.keys.has('logicalClock')
          )
        })

        for (const event of events) {
          // Top-level event: key was added/updated/deleted at the users map level.
          if (event.target === this.y.users) {
            for (const k of event.changes.keys.keys()) keysAffected.add(k)
          } else {
            // Nested event: a field changed inside y.users[id]. Walk the path to find id.
            const path = (event as any).path as Array<string | number>
            if (path && path.length > 0) keysAffected.add(String(path[0]))
          }
        }

        // Verify every key, including our own — foreign mutations of our entry must also revert.
        if (keysAffected.size > 0) {
          this._verifyAndRevertUserChange(keysAffected)
        }

        if (!onlyClockEvents) {
          this.throttledUpdate()
        }
      })
    }
  }

  private _hasRoomsObserver: boolean = false

  /** Initializes rooms; observer install is idempotent via `_hasRoomsObserver`. */
  initRooms() {
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

    if (!this._hasRoomsObserver) {
      this._hasRoomsObserver = true
      this.y.rooms.observe((event) => {
        const keysChanged = Array.from(event.changes.keys.keys())
        const originStr = typeof event.transaction.origin === 'string'
          ? event.transaction.origin
          : ''
        const fromLocal = Peer.ROOM_LOCAL_ORIGINS.has(originStr)

        // Verify-and-revert for non-local origins.
        if (keysChanged.length > 0) {
          this._verifyAndRevertRoomChange(new Set(keysChanged), fromLocal)
        }

        // Move-to-Lobby on local deletes only — remote-origin deletes are healed by _verifyAndRevert (Exploit 5).
        if (fromLocal) {
          keysChanged.forEach((key) => {
            const change = event.changes.keys.get(key)
            if (change?.action !== 'delete') return
            if (this.user() && this.user().get('room') === key) {
              LOG('current room was deleted, moving to lobby')
              const current = this.user()
              const next = this._nextUserPayload(this.peerID, {
                room: LOBBY,
                logicalClock: (current.get('logicalClock') || 0) + 1,
              })
              if (next) this._writeAndSignUser(this.peerID, next, 'moveToLobby')
            }
          })
        }

        this.throttledUpdate()
      })
    }
  }

  /** Indices of chat entries that failed signature verification — filtered at render time. */
  private _invalidChatIndices: Set<number> = new Set()

  /** Returns true if signer pubkey matches a known y.users participant. */
  private _isKnownChatSigner(signer: string): boolean {
    for (const id of this.y.users.keys()) {
      const sep = id.lastIndexOf('_')
      const pub = sep > 0 ? id.slice(0, sep) : id
      if (pub === signer) return true
    }
    return false
  }

  /** Verify a chat entry by absolute array index; marks invalid if sig or authz fails. */
  private async _verifyChatEntry(index: number): Promise<void> {
    const entry = this.y.chat.get(index) as any
    if (!entry) return
    const { timestamp, user, msg, signer, signature } = entry
    if (!signer || !signature) {
      LOG('y.chat entry rejected (unsigned)', index)
      this._invalidChatIndices.add(index)
      return
    }
    const envelope: Envelope = { signer, nonce: timestamp, signature }
    const payload = { msg, timestamp, user }
    const sigValid = await verifyEntry('chat', String(timestamp), payload, envelope)
    if (!sigValid) {
      LOG('y.chat entry rejected (bad sig)', index)
      this._invalidChatIndices.add(index)
      return
    }
    if (!this._isKnownChatSigner(signer)) {
      LOG('y.chat entry rejected (unknown signer)', index, signer)
      this._invalidChatIndices.add(index)
    }
  }

  initChat() {
    this.y.doc.transact(() => {
      this.y.chat.observe(async (event) => {
        let base = 0
        for (const delta of event.changes.delta) {
          if (delta.retain !== undefined) {
            base += delta.retain
          } else if (delta.insert !== undefined) {
            const inserted = delta.insert as any[]
            for (let i = 0; i < inserted.length; i++) {
              await this._verifyChatEntry(base + i)
            }
            base += inserted.length
          }
        }
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
        if (!users[station]) {
          deadStation.push(station)
        }
      }

      if (deadStation.length > 0) {
        for (const station of deadStation) {
          LOG('Removing dead station', station)
          this._deleteAndUnsignRoom(station, 'checkForDeadStations')
        }
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
      hashPubKey(config.data.createdBy).then((hash) => {
        if (hash === self.lab.hash && self.lab.timestamp < config.timestamp) {
          self.logSetupChanges(self.lab.data, config.data)
          self.lab.id = config.id
          self.lab.data = config.data
          self.lab.timestamp = config.timestamp

          self.initSetup(true)
          self.update('setup')
        } else {
          LOG('updating failed, hash mismatch')
        }
      })
    } else {
      if (this.lab.timestamp < config.timestamp) {
        this.logSetupChanges(this.lab.data, config.data)
        this.lab.id = config.id
        this.lab.data = config.data
        this.lab.timestamp = config.timestamp

        this.initSetup(true)
        this.update('setup')
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
          const all = this.y.chat.toArray()
          callback({
            messages: all.filter((_, i) => !this._invalidChatIndices.has(i)),
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
      debug.ts.peer(this.t('peer.feedback.unauthorized'))
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
      this.y.userSigs.delete(this.peerID)
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
    if (name) {
      if (!this.y.rooms.has(name)) this._writeAndSignRoom(name, 'addRoom')
      return
    }
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

  /**
   * Moves the user to a specified room.
   * @param room The room to move to.
   */
  gotoRoom(room: string) {
    const current = this.user()
    if (!current) return
    const next = this._nextUserPayload(this.peerID, {
      room,
      logicalClock: (current.get('logicalClock') || 0) + 1,
    })
    if (next) this._writeAndSignUser(this.peerID, next, 'gotoRoom')
  }

  ticktack() {
    const current = this.user()
    if (!current) return
    const next = this._nextUserPayload(this.peerID, {
      logicalClock: (current.get('logicalClock') || 0) + 1,
    })
    if (next) this._writeAndSignUser(this.peerID, next, 'ticktack')
  }

  /**
   * Sends a chat message.
   * @param message The message to send.
   */
  async sendMessage(message: string) {
    const timestamp = Date.now()
    const user = getShortPeerID(this.peerID)
    const payload = { msg: message, timestamp, user }
    const envelope = await signEntry('chat', String(timestamp), payload, timestamp)
    this.y.doc.transact(() => {
      this.y.chat.push([
        {
          timestamp,
          user,
          msg: message,
          signer: envelope.signer,
          signature: envelope.signature,
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
      debug.ts.peer(this.t('peer.feedback.notPropagated'))
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
