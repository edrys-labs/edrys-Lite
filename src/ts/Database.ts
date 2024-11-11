import { Dexie, liveQuery } from 'dexie'

import { hashJsonObject } from './Utils'

import { MemoryData, ConsoleData, NetworkData, IUserInStation } from '../components/Logger.vue'

export type DatabaseItem = {
  id: string
  timestamp: number
  data: any
  hash: string | null
}

interface LoggerData {
  memoryData: MemoryData[];
  consoleData: ConsoleData[];
  networkData: NetworkData[];
  usersInStations: IUserInStation[];
}

function open(name: string, version?: number) {
  console.warn('indexedDB is disabled')
}

function deleteDatabase(name: string) {
  console.warn('indexedDB is disabled')
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

    this.db
      .open()
      .then(function (db) {
        // Database opened successfully
        console.log('Database opened successfully')

        // Disable indexedDB for others
        // @ts-ignore
        window.indexedDB.open = open
        // @ts-ignore
        window.indexedDB.deleteDatabase = deleteDatabase
      })
      .catch(function (err) {
        console.warn('Database error: ' + err.message)
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
      error: (err) => console.warn(err),
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
}
