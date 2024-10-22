import Dexie from 'dexie';


interface ILogEntry {
  id: string;
  consoleData: string;
}


class LogsDB extends Dexie {
  public logs!: Dexie.Table<ILogEntry, number>; 

  constructor() {
    super('LogsDB');
    this.version(1).stores({
      logs: '&id,consoleData',
    });
  }
}

export const logsDB = new LogsDB();
