import { Dexie, liveQuery } from 'dexie'

import { hashJsonObject } from './Utils'

export type DatabaseItem = {
  id: string
  timestamp: number
  data: any
  hash: string | null
}

export class Database {
  private db: Dexie
  private observables: any = {}

  constructor() {
    this.db = new Dexie('EdrysLite')

    this.db.version(2).stores({
      data: `
            &id,
            timestamp,
            data,
            hash`,
    })

    this.db
      .open()
      .then(function (db) {
        // Database opened successfully
        console.log('Database opened successfully')
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

  update(config: DatabaseItem) {
    config.timestamp = Date.now()
    return this.put(config)
  }

  drop(id: string) {
    this.db['data'].delete(id)
  }

  async setProtection(id: string, on: boolean = true) {
    const classroom = await this.get(id)

    if (classroom) {
      classroom.hash = on ? await hashJsonObject(classroom.data) : null

      this.update(classroom)
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
}
