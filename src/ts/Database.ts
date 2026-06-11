import { Dexie, liveQuery } from 'dexie'

import { hashJsonObject } from './Utils'

import { MemoryData, ConsoleData, NetworkData, IUserInStation } from '../components/Logger.vue'

import { debug } from '../api/debugHandler'

export type DatabaseItem = {
  id: string
  timestamp: number
  data: any
  hash: string | null
  ownerHash?: string
}

interface LoggerData {
  memoryData: MemoryData[];
  consoleData: ConsoleData[];
  networkData: NetworkData[];
  usersInStations: IUserInStation[];
}

export class Database {
  private db: Dexie
  private observables: any = {}

  constructor() {
    this.db = new Dexie('EdrysLite')

    this.db.version(3).stores({
      data: `
            &id,
            timestamp,
            data,
            hash`,

      logs: `id`,
    })

    this.db.version(4).stores({
      data: `
            &id,
            timestamp,
            data,
            hash`,

      logs: `id`,

      keys: `&name, value`,
    })

    this.db
      .open()
      .then(function (db) {
        // Database opened successfully
        debug.ts.database('Database opened successfully')
      })
      .catch(function (err) {
        console.error('Database error: ' + err.message)
      })
  }

  getAll(): Promise<DatabaseItem[]> {
    return this.db['data'].orderBy('timestamp').desc().toArray()
  }

  async exists(id: string): Promise<boolean> {
    const item = await this.get(id)
    return item ? true : false
  }

  async get(id: string): Promise<DatabaseItem | null> {
    return await this.db['data'].get(id)
  }

  put(config: DatabaseItem) {
    return this.db['data'].put(config)
  }

  update(config: DatabaseItem, withTimestamp: boolean = true) {
    if (withTimestamp) {
      config.timestamp = Date.now()
    }
    return this.put(config)
  }

  drop(id: string) {
    this.db['data'].delete(id)
  }

  async setProtection(id: string, on: boolean = true) {
    const classroom = await this.get(id)

    if (classroom) {
      classroom.hash = on ? await hashJsonObject(classroom.data) : null

      this.update(classroom, false)
    }
  }

  setObservable(id: string, callback: (result: any) => void) {
    if (this.observables[id]) {
      this.observables[id].unsubscribe()
      delete this.observables[id]
    }

    const db = this.db['data']
    const observable =
      id === '*'
        ? liveQuery(() => db.orderBy('timestamp').desc().toArray())
        : liveQuery(() => db.where('id').equals(id).first())

    this.observables[id] = observable.subscribe({
      next: (result) => callback(result),
      error: (err) => console.error(err),
    })
  }

  deleteObservable(id: string) {
    if (this.observables[id]) {
      this.observables[id].unsubscribe()
      delete this.observables[id]
    }
  }

  // Methods for `logs` table operations
  getAllLogs(): Promise<LoggerData[]> {
    return this.db['logs'].toArray();
  }

  async getLogById(id: string): Promise<LoggerData | null> {
    return await this.db['logs'].get(id);
  }

  putLog(id: string, logData: LoggerData) {
    return this.db['logs'].put({ id, LoggerData: { ...logData } });
  }

  deleteLog(id: string) {
    this.db['logs'].delete(id);
  }

  getLogsIds(): Promise<string[]> {
    return this.db['logs'].toCollection().primaryKeys();
  }

  async getPrivateKey(): Promise<CryptoKey | null> {
    const row = await this.db['keys'].get('privateKey')
    return row ? row.value : null
  }

  async setPrivateKey(key: CryptoKey): Promise<void> {
    await this.db['keys'].put({ name: 'privateKey', value: key })
  }

  async getPublicKeyRaw(): Promise<string | null> {
    const row = await this.db['keys'].get('publicKeyRaw')
    return row ? row.value : null
  }

  async setPublicKeyRaw(raw: string): Promise<void> {
    await this.db['keys'].put({ name: 'publicKeyRaw', value: raw })
  }

  async getMigrationDone(): Promise<boolean> {
    const row = await this.db['keys'].get('migrationV2Done')
    return row ? row.value === true : false
  }

  async setMigrationDone(): Promise<void> {
    await this.db['keys'].put({ name: 'migrationV2Done', value: true })
  }
}
