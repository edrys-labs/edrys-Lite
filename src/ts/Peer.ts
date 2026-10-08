import {
  getPeerID,
  getBasePeerID,
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
  Envelope,
} from './Utils'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
// @ts-ignore
import { GenericWebrtcProviderAdapter } from './GenericProviderAdapter'
import { GenericWebsocketProviderAdapter } from './GenericWebsocketProviderAdapter'
import { SignedPresence } from './Presence'
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

// An empty list or one containing '*' means "everyone allowed" — no allowlist.
function isExplicitAllowlist(students: string[] | undefined): boolean {
  if (!students || students.length === 0) return false
  return !students.includes('*')
}

function isInMembers(
  signer: string,
  ownerPubKey: string,
  teachers: string[],
  students: string[] | undefined
): boolean {
  if (!isExplicitAllowlist(students)) return true
  const s = stripPubKey(signer)
  if (ownerPubKey && s === stripPubKey(ownerPubKey)) return true
  if (teachers.some((t) => stripPubKey(t) === s)) return true
  return (students as string[]).some((u) => stripPubKey(u) === s)
}

/**
 * Authorization rule for presence entries.
 *  - Human peer (id = "<pubkey>_<sessionID>"): signer's pubkey must equal "<pubkey>".
 *  - Station peer (id starts with "Station "): signer must be owner or in teachers.
 *  - When `students` is a finite allowlist, signer must also be in owner∪teachers∪students.
 */
export function isAuthorizedUserSigner(
  id: string,
  signer: string,
  ownerPubKey: string,
  teachers: string[],
  students: string[] = []
): boolean {
  if (!signer) return false
  if (!isInMembers(signer, ownerPubKey, teachers, students)) return false
  if (id.startsWith(STATION + ' ')) {
    if (ownerPubKey && stripPubKey(signer) === stripPubKey(ownerPubKey)) return true
    return teachers.some((t) => stripPubKey(t) === stripPubKey(signer))
  }
  const sep = id.lastIndexOf('_')
  if (sep <= 0) return false
  const pubkeyPart = id.slice(0, sep)
  return stripPubKey(pubkeyPart) === stripPubKey(signer)
}

// Lobby always exists, so any signer may (re)make its state. All other rooms,
// station rooms included, require owner or teacher.
export function isAuthorizedRoomSigner(
  name: string,
  signer: string,
  ownerPubKey: string,
  teachers: string[],
  _students: string[] = []
): boolean {
  if (!signer) return false
  if (name === LOBBY) return true
  if (ownerPubKey && stripPubKey(signer) === stripPubKey(ownerPubKey)) return true
  return teachers.some((t) => stripPubKey(t) === stripPubKey(signer))
}

let heartbeatID: ReturnType<typeof setInterval> | null

// Heartbeat checks a room we haven't seen in the view since connecting may be
// missing before we move to the Lobby (e.g. reloading into a stopped
// station). A room we did see moves us as soon as it drops out: presence
// already holds a vanished station for ABSENT_GRACE.
const MISSING_ROOM_CHECKS = 2

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
  private provider:
    | GenericWebrtcProviderAdapter
    | GenericWebsocketProviderAdapter
  private providerType: 'WebRTC' | 'Websocket' = 'WebRTC'
  private websocketUrl: string = WebSocketServer
  private webrtcConfig: any = RTCConfiguration
  private signalingServer: string[] = SignallingServer
  private _hasSetupObserver: boolean = false
  // The newest setup record (config + timestamp) we verified or signed, as
  // plain JSON. Owners/teachers republish it verbatim when the doc copy is
  // missing, invalid or older.
  private _lastGoodSetup: { config: any; timestamp: number } | null = null
  // Setup checks verify asynchronously; chained so they never interleave.
  private _setupCheck: Promise<void> = Promise.resolve()
  private throttledUpdate: any

  private t: (key: string) => string

  private y: {
    doc: Y.Doc
    chat: Y.Array<any>
    rooms: Y.Map<any>
    roomSigs: Y.Map<Envelope>
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
  private peerID: string

  private expectedOwner: string | null = null
  private ownerMismatch: boolean = false

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

      // Initialize local state now that peerID is known. Rooms are seeded by
      // join() once connected: seeding Lobby into an unsynced doc overwrites
      // the room's existing Lobby, which every other peer then reverts.
      this.y.doc.transact(() => {
        this.initChat()
        this.initSetup()
      }, 'initialization')
      this._observeRooms()

      this._connectProviderWithIdentity(room, password)
      this.initUser(this.role)
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

        const webrtcOptions = {
          signaling: this.signalingServer,
          password: password || 'password',
          userid: this.peerID,
          classroomId: room,
          peerOpts: {
            config: this.webrtcConfig
          }
        }

        this.provider = new GenericWebrtcProviderAdapter(room, this.y.doc, webrtcOptions)

        // Handle provider status events
        this.provider.on('status', this.handleStatus.bind(this))

        // Handle synced events
        this.provider.on('synced', this.handleSynced.bind(this))
      } else if (this.providerType === 'Websocket') {
        LOG('Connecting using WebSocket provider')

        const websocketOptions = {
          serverUrl: this.websocketUrl,
          userid: this.peerID,
          classroomId: room,
        }

        this.provider = new GenericWebsocketProviderAdapter(room, this.y.doc, websocketOptions)

        // Event handlers for WebSocket provider (status and synced)
        this.provider.on('status', this.handleStatus.bind(this))
        this.provider.on('synced', this.handleSynced.bind(this))
      }

      this.presence?.stop()
      // Peers show up again one by one on the new connection; until our
      // room does, it may not be gone.
      this._seenOwnRoom = null
      this.presence = new SignedPresence(
        this.provider.getPresenceAwareness(),
        this.peerID,
        (id, signer) => this._isAuthorizedUserSigner(id, signer),
        () => {
          this._recheckChatSigners()
          this._leaveMissingRoom(false)
          this.throttledUpdate()
        }
      )

      // Register the onLeave callback
      this.provider.onLeave((userid) => {
        if (userid && userid.startsWith(STATION + ' ')) return

        const base = getBasePeerID(userid)
        const stillPresent = Object.keys(this.presence.visible).some(
          (id) => id !== userid && getBasePeerID(id) === base
        )
        if (!stillPresent) {
          debug.ts.peer(`Peer with userid ${userid} has left the room.`)
        }
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

    this._observeSetup()
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

    this._observeSetup()

    if (!this.connected) {
      this.connected = true
      this.update('connected')
      // When synced, check access permissions
      if (!this.allowedToParticipate()) {
        this.update('popup', this.t('peer.feedback.noAccess'))
      }
      // A room with no (valid) setup yet gets ours, if we may publish it.
      this.initSetup()
    }
  }

  /**
   * Observes y.setup once. Status events repeat on every reconnect, and each
   * extra observer would re-verify (and re-sign) every setup change.
   */
  private _observeSetup() {
    if (this._hasSetupObserver) return
    this.y.setup.observe(this.handleSetupChange.bind(this))
    this._hasSetupObserver = true
  }

  /**
   * Observes setup changes and initializes setup if necessary.
   */
  private handleSetupChange(_event: Y.YMapEvent<any>) {
    this.initSetup()
  }

  /** Our own presence payload, or null before it was first published. */
  user(): any | null {
    return this.presence?.own ?? null
  }

  /**
   * Checks if the current role is a station.
   */
  isStation() {
    return this.role === 'station'
  }

  /** Hides peers the transport reported gone, until they publish again. */
  removePeers(peerIds: string[]) {
    for (const id of peerIds) this.presence?.markLeft(id)
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
      }

      if (
        !oldSetup.members.teacher.includes(id) &&
        newSetup.members.teacher.includes(id)
      ) {
        this.update('popup', this.t('peer.feedback.addedTeacher'))
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
   * Publishes our setup (force: a local edit, signed anew) or checks y.setup.
   *
   * y.setup is verified on read: a peer adopts a doc record only if it
   * verifies and is newer than its own, and never writes a reader's
   * correction. Only owners/teachers republish, and only when the doc copy
   * is missing, invalid or older than ours, so late joiners still find a
   * valid one.
   */
  initSetup(force: boolean = false) {
    if (force) {
      LOG('Force update new configuration')
      this._signAndWrite(this._lastGoodSetup?.config ?? this.y.setup.get('config'))
        .catch((e) => console.error('initSetup sign failed:', e))
      return
    }
    this._setupCheck = this._setupCheck
      .then(() => this._checkSetup())
      .catch((e) => console.error('setup check failed:', e))
  }

  private async _checkSetup(): Promise<void> {
    const timestamp: number = (this.y.setup.get('timestamp') as number) || 0
    const raw = this.y.setup.get('config')
    const data = raw ? JSON.parse(JSON.stringify(raw)) : null
    const good = this._lastGoodSetup
    if (data && good && timestamp === good.timestamp && deepEqual(data, good.config)) return

    if (data && timestamp > this.lab.timestamp) {
      if (await this._verifyAndAccept(data, timestamp)) return
    } else if (data && timestamp > 0 && timestamp === this.lab.timestamp) {
      // Our own setup, e.g. published in an earlier session: remember it.
      if (await this._verifySetupRecord(data, timestamp)) {
        this._lastGoodSetup = { config: data, timestamp }
        return
      }
    }

    // The doc copy is missing, invalid or older than ours.
    if (this.lab.timestamp > 0 && this.lab.data) await this._republishSetup()
  }

  private async _republishSetup(): Promise<void> {
    const me = stripPubKey(getPeerID(false))
    const teachers: string[] = this.lab.data?.members?.teacher || []
    if (me !== stripPubKey(this.lab.data?.createdBy || '') &&
        !teachers.some((t) => stripPubKey(t) === me)) return

    const good = this._lastGoodSetup
    if (good && good.timestamp === this.lab.timestamp) {
      LOG('y.setup is missing, invalid or outdated, republishing the last good one')
      this.y.doc.transact(() => {
        this.y.setup.set('config', good.config)
        this.y.setup.set('timestamp', good.timestamp)
      }, 'republishSetup')
    } else {
      LOG('y.setup is missing, invalid or outdated, signing ours')
      await this._signAndWrite(good?.config ?? null)
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
    // Set before the write so our own observer sees it as already good.
    this._lastGoodSetup = { config: JSON.parse(JSON.stringify(dataToWrite)), timestamp: this.lab.timestamp }
    this.y.doc.transact(() => {
      this.y.setup.set('config', dataToWrite)
      this.y.setup.set('timestamp', this.lab.timestamp)
      if (!this.allowedToParticipate()) {
        this.update('popup', this.t('peer.feedback.noAccess'))
      }
    }, 'initSetup')
  }

  // Re-run authz on entries we deferred while lab.data.createdBy was empty.
  private _reverifyAfterSetup(): void {
    // Roles and room authorization are derived from the setup, so the view
    // changes with it; who may republish a room may change too.
    this.presence?.reauthorize()
    this._checkRooms(new Set([...this.y.roomSigs.keys(), ...this.y.rooms.keys()]))
    this._ensureStationRoom()
  }

  private async _verifyAndAccept(data: any, timestamp: number): Promise<boolean> {
    if (!(await this._verifySetupRecord(data, timestamp))) return false

    const localCreatedBy: string | undefined = this.lab.data?.createdBy
    const isLegacyCreatedBy = !!localCreatedBy && localCreatedBy.length < 40

    LOG(`receiving lab configuration`)
    this._lastGoodSetup = { config: JSON.parse(JSON.stringify(data)), timestamp }
    this.logSetupChanges(this.lab.data, data)
    this.lab.data = {
      ...this.lab.data,
      name: data.name,
      meta: data.meta,
      modules: data.modules,
      members: data.members,
      createdBy: isLegacyCreatedBy ? data.createdBy : (localCreatedBy || data.createdBy),
      communicationConfig: data.communicationConfig,
      keepUrlConfig: data.keepUrlConfig,
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

  /** Whether a setup record is signed by someone allowed to make it, against our current setup. */
  private async _verifySetupRecord(data: any, timestamp: number): Promise<boolean> {
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
        this.ownerMismatch = true
        this.update('room')
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
    return true
  }

  private presence!: SignedPresence
  private _stopped: boolean = false

  /** Per-instance wrapper around the pure isAuthorizedUserSigner rule. */
  private _isAuthorizedUserSigner(id: string, signer: string): boolean {
    return isAuthorizedUserSigner(
      id,
      signer,
      this.lab.data?.createdBy || '',
      this.lab.data?.members?.teacher || [],
      this.lab.data?.members?.student || []
    )
  }

  /** Per-instance wrapper around the pure isAuthorizedRoomSigner rule. */
  private _isAuthorizedRoomSigner(name: string, signer: string): boolean {
    return isAuthorizedRoomSigner(
      name,
      signer,
      this.lab.data?.createdBy || '',
      this.lab.data?.members?.teacher || [],
      this.lab.data?.members?.student || []
    )
  }

  /**
   * Verified room records (y.roomSigs) by name. Rooms are never deleted, so
   * a record stays here even if the doc copy is later deleted or overwritten.
   */
  private _roomRecords: Map<string, Envelope> = new Map()

  /**
   * Lobby always exists and station rooms come from presence, so only other
   * names need a record, signed by the owner or a teacher.
   */
  private _isValidRoomRecord(name: string, envelope: Envelope): boolean {
    return name !== LOBBY && !name.startsWith(STATION + ' ') &&
      this._isAuthorizedRoomSigner(name, envelope.signer)
  }

  /** Signs a room record; keeps an existing Y.Map so module state survives. */
  private async _writeAndSignRoom(name: string, origin: string): Promise<void> {
    try {
      const envelope = await signEntry('rooms', name, {})
      this.y.doc.transact(() => {
        if (!(this.y.rooms.get(name) instanceof Y.Map)) {
          this.y.rooms.set(name, new Y.Map())
        }
        this.y.roomSigs.set(name, envelope)
      }, origin)
    } catch (e) {
      LOG('writeAndSignRoom failed', name, e)
    }
  }

  /**
   * Verifies the doc's record for each name and remembers valid ones. Nothing
   * invalid is deleted, the view just ignores it. Only a peer allowed to
   * create a room puts back its record or Y.Map when they go missing.
   */
  private async _checkRooms(names: Iterable<string>): Promise<void> {
    for (const name of names) {
      try {
        const stored = this.y.roomSigs.get(name) as Envelope | undefined
        const envelope = stored && typeof stored === 'object'
          ? { signer: stored.signer, nonce: stored.nonce, signature: stored.signature }
          : undefined
        const valid = !!envelope &&
          await verifyEntry('rooms', name, {}, envelope)
        if ((this.y.roomSigs.get(name) as any)?.signature !== envelope?.signature) {
          continue // changed while verifying; that change is checked on its own
        }
        if (valid) {
          const known = this._roomRecords.get(name)
          if (!known || !this._isValidRoomRecord(name, known)) {
            this._roomRecords.set(name, envelope as Envelope)
          }
        }
        this._republishRoom(name, valid && this._isValidRoomRecord(name, envelope as Envelope))
      } catch (e) {
        LOG('checkRooms failed', name, e)
      }
    }
    this.throttledUpdate()
  }

  private _republishRoom(name: string, docRecordValid: boolean): void {
    if (name === this.peerID) return this._ensureStationRoom()
    if (!this.canManageRooms()) return
    if (name === LOBBY) {
      if (!(this.y.rooms.get(LOBBY) instanceof Y.Map)) {
        LOG('Lobby state is gone, recreating it')
        this.y.doc.transact(() => this.y.rooms.set(LOBBY, new Y.Map()), 'republishRoom')
      }
      return
    }
    const record = this._roomRecords.get(name)
    if (!record || !this._isValidRoomRecord(name, record) ||
        !this._isAuthorizedRoomSigner(name, getPeerID(false))) return
    const missingState = !(this.y.rooms.get(name) instanceof Y.Map)
    if (docRecordValid && !missingState) return
    LOG('room record or state is gone, republishing', name)
    this.y.doc.transact(() => {
      if (missingState) this.y.rooms.set(name, new Y.Map())
      if (!docRecordValid) this.y.roomSigs.set(name, record)
    }, 'republishRoom')
  }

  /** A station's room comes from its presence; this only makes the Y.Map for module state. */
  private _ensureStationRoom(): void {
    if (this.isStation() && !(this.y.rooms.get(this.peerID) instanceof Y.Map) &&
        this._isAuthorizedRoomSigner(this.peerID, getPeerID(false))) {
      this.y.doc.transact(() => this.y.rooms.set(this.peerID, new Y.Map()), 'initRooms')
    }
  }

  /**
   * Publishes our presence for `role`. A re-join (role change) keeps the room
   * we are in.
   */
  initUser(role: 'student' | 'teacher' | 'station') {
    this.role = role

    if (heartbeatID) {
      clearInterval(heartbeatID)
      heartbeatID = null
    }

    const current = this.user()
    this.presence.publish({
      room: this.isStation() ? this.peerID : current?.room || LOBBY,
      dateJoined: current?.dateJoined || Date.now(),
      handRaised: false,
      connections: [{ id: '', target: {} }],
    })

    heartbeatID = setInterval(() => this._leaveMissingRoom(), 5000)
  }

  /** Consecutive heartbeat checks our room has been missing from the view. */
  private _missingRoomChecks = 0
  /** Our room, once it has shown in the view on the current connection. */
  private _seenOwnRoom: string | null = null

  /**
   * Move to the Lobby when our room is gone: at once if we saw it in the
   * view (checked on every presence change), otherwise after a few
   * heartbeat checks.
   */
  private _leaveMissingRoom(heartbeat = true) {
    const room = this.user()?.room
    if (!this.connected || !room || room === LOBBY || this.isStation()) {
      this._missingRoomChecks = 0
      return
    }
    if (room in this._viewRooms()) {
      this._seenOwnRoom = room
      this._missingRoomChecks = 0
      return
    }
    if (this._seenOwnRoom !== room &&
        (!heartbeat || ++this._missingRoomChecks < MISSING_ROOM_CHECKS)) return
    LOG('current room is gone, moving to lobby', room)
    this._missingRoomChecks = 0
    this.gotoRoom(LOBBY)
  }

  private _hasRoomsObserver: boolean = false

  /** Owner (matched by createdBy) and teachers/stations may manage rooms; students may not. */
  private canManageRooms(): boolean {
    return this.role !== 'student' || getPeerID(false) === this.lab.data?.createdBy
  }

  /** Watches room records and room state once, across reconnects. */
  private _observeRooms() {
    if (this._hasRoomsObserver) return
    this._hasRoomsObserver = true
    this.y.roomSigs.observe((event) => this._checkRooms(event.keysChanged))
    this.y.rooms.observe((event) => this._checkRooms(event.keysChanged))
    this._checkRooms(new Set([...this.y.roomSigs.keys(), ...this.y.rooms.keys()]))
  }

  /** Seeds the Lobby state (and default rooms) of a fresh classroom. */
  initRooms() {
    if (this.y.rooms.size === 0) {
      LOG('initializing rooms')

      // Any role may make the Lobby's Y.Map — students may join before the teacher.
      this.y.doc.transact(() => this.y.rooms.set(LOBBY, new Y.Map()), 'initRooms')

      if (this.canManageRooms()) {
        let defaultRooms = 0
        try {
          defaultRooms = this.lab.data.meta.defaultNumberOfRooms
        } catch (e) {}

        for (let i = 1; i <= defaultRooms; i++) {
          this._writeAndSignRoom('Room ' + i, 'initRooms')
        }
      }
    }
    this._ensureStationRoom()
  }

  /** Indices of chat entries that failed signature verification — filtered at render time. */
  private _invalidChatIndices: Set<number> = new Set()

  /**
   * Invalid only because their signer wasn't present when they arrived.
   * Presence comes over awareness, separately from the doc, so a late joiner
   * often gets the chat before the people who wrote it.
   */
  private _unknownSignerChat: Map<number, string> = new Map()

  /** Index where each chat signature first appeared; a copy elsewhere is a replay. */
  private _chatSignatures: Map<string, number> = new Map()

  /** Show held-back chat entries whose signer has since become present. */
  private _recheckChatSigners(): void {
    let changed = false
    for (const [index, signer] of this._unknownSignerChat) {
      if (!this._isKnownChatSigner(signer)) continue
      this._unknownSignerChat.delete(index)
      this._invalidChatIndices.delete(index)
      changed = true
    }
    if (changed) this.update('chat')
  }

  /** Returns true if signer pubkey matches a peer currently present. */
  private _isKnownChatSigner(signer: string): boolean {
    const students = this.lab.data?.members?.student || []
    if (isExplicitAllowlist(students)) {
      const owner = this.lab.data?.createdBy || ''
      const teachers = this.lab.data?.members?.teacher || []
      return isInMembers(signer, owner, teachers, students)
    }
    for (const id of Object.keys(this.presence?.visible || {})) {
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
    // Messages stay valid however old they are; replays are caught below.
    const sigValid = await verifyEntry('chat', String(timestamp), payload, envelope)
    if (!sigValid) {
      LOG('y.chat entry rejected (bad sig)', index)
      this._invalidChatIndices.add(index)
      return
    }
    const firstIndex = this._chatSignatures.get(signature)
    if (firstIndex !== undefined && firstIndex !== index) {
      LOG('y.chat entry rejected (replayed)', index)
      this._invalidChatIndices.add(index)
      return
    }
    this._chatSignatures.set(signature, index)
    if (!this._isKnownChatSigner(signer)) {
      LOG('y.chat entry rejected (unknown signer)', index, signer)
      this._invalidChatIndices.add(index)
      this._unknownSignerChat.set(index, signer)
    }
  }

  private _hasChatObserver: boolean = false

  /** Verifies inserted chat entries; installs its observer once, across reconnects. */
  initChat() {
    if (this._hasChatObserver) return
    this._hasChatObserver = true
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
          self._reverifyAfterSetup()
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
        this._reverifyAfterSetup()
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
        if (this.ownerMismatch) {
          if (callback) callback(null)
          break
        }
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

    const users = this.presence.visible

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
  stop = (): void => {
    LOG('stopping peer')
    this._stopped = true
    if (heartbeatID) {
      clearInterval(heartbeatID)
      heartbeatID = null
    }

    window.removeEventListener('beforeunload', this.stop)

    // Clearing our presence tells peers we left; a station's room goes with it.
    this.presence?.stop()
    this._finishStop()
  }

  private _finishStop(): void {
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
    if (!this.canManageRooms()) return
    if (name) {
      if (!(name in this._viewRooms())) this._writeAndSignRoom(name, 'addRoom')
      return
    }
    const roomIDs: number[] = Object.keys(this._viewRooms())
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
    this.presence.publish({ ...current, room })
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
   * Y.Doc changes as encoded updates, for forwarding to module iframes.
   * `origin` lets the caller drop echoes it just applied ('extern').
   */
  onState(callback: (data: Uint8Array, origin: any) => void): () => void {
    this.y.doc.on('update', callback)
    return () => this.y.doc.off('update', callback)
  }

  /** The app-awareness channel (module cursors/presence), isolated from identity. */
  getAwareness(): any {
    return this.provider.getAwareness()
  }

  /** Applies a module's encoded awareness update into the shared channel. */
  updateAwareness(data: Uint8Array) {
    if (!this.allowedToParticipate()) return
    awarenessProtocol.applyAwarenessUpdate(this.getAwareness(), data, 'extern')
  }

  /**
   * App-awareness changes as encoded updates for the changed clients.
   * `origin` lets the caller drop echoes it just applied ('extern').
   */
  onAwareness(callback: (data: Uint8Array, origin: any) => void): () => void {
    const awareness = this.getAwareness()
    const handler = ({ added, updated, removed }: any, origin: any) => {
      const changed = added.concat(updated).concat(removed)
      if (changed.length === 0) return
      callback(awarenessProtocol.encodeAwarenessUpdate(awareness, changed), origin)
    }
    awareness.on('update', handler)
    return () => awareness.off('update', handler)
  }

  /**
   * Joins a role and initializes necessary components.
   * @param role The role to join as.
   */
  async join(role: 'student' | 'teacher' | 'station') {
    this.initUser(role)
    this.initRooms()

    this.throttledUpdate()
  }

  /**
   * Serializes the current state to JSON.
   * @returns The serialized state.
   */
  async toJSON() {
    return {
      rooms: this._viewRooms(),
      users: this._viewUsers(),
      doc: Y.encodeStateAsUpdate(this.y.doc),
    }
  }

  /**
   * Present peers as the UI and modules see them. Name and role are derived
   * here (from the id and the signed setup), not taken from the peer.
   * Another peer whose room is gone (a stopped station) is shown in the
   * Lobby until it moves there itself, so it never drops out of the room
   * list. Our own room is left as is: modules are keyed on it, and
   * _leaveMissingRoom moves us.
   */
  private _viewUsers(): Record<string, any> {
    const owner = stripPubKey(this.lab.data?.createdBy || '')
    const teachers: string[] = (this.lab.data?.members?.teacher || []).map(stripPubKey)
    const rooms = this._viewRooms()
    const users: Record<string, any> = {}
    for (const [id, payload] of Object.entries(this.presence?.visible || {})) {
      const station = id.startsWith(STATION + ' ')
      const base = stripPubKey(getBasePeerID(id))
      const room = id === this.peerID || payload?.room in rooms ? payload?.room : LOBBY
      users[id] = {
        ...payload,
        room,
        displayName: station ? id : getShortPeerID(id),
        role: station ? 'station' : base === owner || teachers.includes(base) ? 'teacher' : 'student',
      }
    }
    return users
  }

  /**
   * Rooms as the UI and modules see them: the Lobby, rooms with a valid
   * record (oldest first), and the stations that are present. A room's Y.Map
   * in the doc only holds module state.
   */
  private _viewRooms(): Record<string, any> {
    const state = (name: string) => {
      const map = this.y.rooms.get(name)
      return map instanceof Y.Map ? map.toJSON() : {}
    }
    const rooms: Record<string, any> = { [LOBBY]: state(LOBBY) }
    const records = [...this._roomRecords]
      .filter(([name, envelope]) => this._isValidRoomRecord(name, envelope))
      .sort(([a, x], [b, y]) =>
        x.nonce - y.nonce || a.localeCompare(b, undefined, { numeric: true }))
    for (const [name] of records) rooms[name] = state(name)
    for (const id of Object.keys(this.presence?.visible || {})) {
      if (id.startsWith(STATION + ' ')) rooms[id] = state(id)
    }
    return rooms
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
