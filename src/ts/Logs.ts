import Dexie from 'dexie';
import { MemoryData, ConsoleData, NetworkData, IUserInStation } from '../components/Logger.vue';


interface LoggerData {
  memoryData: MemoryData[];
  consoleData: ConsoleData[];
  networkData: NetworkData[];
  usersInStations: IUserInStation[];
}


export const logsDB = new Dexie('LogsDB') as Dexie & {
    logs: Dexie.Table<{ id: string; LoggerData: LoggerData }>;
};

logsDB.version(1).stores({
    logs: 'id'  
});
