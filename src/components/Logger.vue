<script lang="ts">

import * as echarts from 'echarts';
import { logsDB } from '../ts/Logs';

declare global {
    interface Performance {
        memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
        };
    }
};

export interface MemoryData {
    date: Date;
    usedJSHeapSize: string;
    totalJSHeapSize: string;
    jsHeapSizeLimit: string;
};

export interface ConsoleData {
    date: Date;
    message: string;
    type: string;
};

export interface NetworkData {
    date: Date;
    type: string;
    request?: string;
    response?: string;
    status?: number;
    options?: string;
    url?: string;
    method?: string;
    eventType?: string;
};

export interface IUserInStation {
  user: string;
  station: string;
  date: Date;
  event: string;
};

export default {
    name: "Logger",

    props: ["liveClassProxy", "classId", "stationName"],

    data() {
        return {
            memoryData: [] as MemoryData[],

            intervalId: null as number | null,

            consoleData: [] as ConsoleData[],

            networkData: [] as NetworkData[],

            usersInStations: [] as IUserInStation[],

            originalConsoleLog: console.log,
            originalConsoleWarn: console.warn,
            originalConsoleError: console.error,
            originalFetch: window.fetch,
            originalXHR: window.XMLHttpRequest.prototype.open,
            originalWebSocket: window.WebSocket,
            resourceObserver: null as MutationObserver | null,

            tab: 'memory',

            isLoggerRunning: false,

            isChartOpen: false,
            isClosingDialogVisible: false,
            isLogsLoaderVisible: false,

            monitorMemory: false,
            monitorNetwork: false,
            monitorConsole: false,
            monitorUsers: false,

            loggerTabsText: [
                "Click Start to monitor memory usage, or load existing logs.",
                "Click Start to monitor network data, or load existing logs.",
                "Click Start to monitor console logs, or load existing logs.",
                "Click Start to monitor users in stations activity.",
            ],

            classIdInput: "",
            stationNameInput: "",
            isLogsLoaderError: false,
        };
    },

    beforeUnmount() {
        this.stopLogger();
    },

    watch: {
        liveClassProxy: {
            handler() {
                this.monitorUsersInStations();
            },
            deep: true,
        },
    },

    methods: {
        startOrStopLogger() {
            if (this.isLoggerRunning) {
                this.stopLogger();
            } else {
                this.startLogger();
            }
        },
        startLogger() {
            this.$emit("logger-started");

            this.isLoggerRunning = true;

            this.clearLogger();

            if (this.monitorConsole) {
                this.loggerTabsText[2] = "Started monitoring console logs...";
                this.overrideConsoleMethods();
            }

            if (this.monitorNetwork) {
                this.loggerTabsText[1] = "Started monitoring network data...";
                this.overrideFetch();
                this.overrideXHR();
                this.overrideWebSocket();
                this.observeResources();
            }

            if (this.monitorUsers) {
                this.loggerTabsText[3] = "Started monitoring users in stations...";
                this.monitorUsers = true;
            }

            if (this.monitorMemory && this.intervalId === null) { 
                this.loggerTabsText[0] = "Started monitoring memory usage...";

                this.intervalId = setInterval(() => {
                    this.measureMemory();
                }, 5000);
            } 
        },
        stopLogger() {
            this.$emit("logger-stopped");

            this.isLoggerRunning = false;

            // Reset console methods to original
            this.monitorConsole = false;
            console.log = this.originalConsoleLog;
            console.warn = this.originalConsoleWarn;
            console.error = this.originalConsoleError;
            this.loggerTabsText[2] = "Stopped monitoring console logs.";

            // Reset fetch, XHR, and WebSocket to original 
            this.monitorNetwork = false;
            window.fetch = this.originalFetch;
            window.XMLHttpRequest.prototype.open = this.originalXHR;
            window.WebSocket = this.originalWebSocket;
            this.loggerTabsText[1] = "Stopped monitoring network data.";

            // Stop resource monitoring
            if (this.resourceObserver) {
                this.resourceObserver.disconnect();
                this.resourceObserver = null;
                this.loggerTabsText[1] = "Stopped monitoring network data.";
            }

            this.monitorUsers = false;
            this.loggerTabsText[3] = "Stopped monitoring users in stations.";

            // Stop memory monitoring
            if (this.intervalId !== null) { 
                this.monitorMemory = false;
                clearInterval(this.intervalId);
                this.intervalId = null; 
                this.loggerTabsText[0] = "Stopped monitoring memory usage.";
            } 
        },
        loadLogs() {
            this.isLogsLoaderVisible = true;
        },
        clearLogger() {
            this.memoryData = [];
            this.consoleData = [];
            this.networkData = [];
            this.usersInStations = [];
        },
        formatMessage(message: object | string) {
            if (typeof message === "object" && message !== null) {
                return JSON.stringify(message, null, 2);
            }
            return message.toString();
        },
        measureMemory() {
            // performance.memory is only available in certain browsers
            if (performance.memory) {
                const usedJSHeapSize = (performance.memory.usedJSHeapSize / 1048576).toFixed(2);
                const totalJSHeapSize = (performance.memory.totalJSHeapSize / 1048576).toFixed(2);
                const jsHeapSizeLimit = (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2);

                this.memoryData.push({
                    date: new Date().toLocaleString(),
                    usedJSHeapSize,
                    totalJSHeapSize,
                    jsHeapSizeLimit,
                });

                this.saveLoggerDataToDB();
            } else {
                console.warn("Performance memory API is not supported in this browser.");
                this.loggerTabsText[0] = "Performance memory API is not supported in this browser.";
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        },
        overrideConsoleMethods() {
            const methodsToOverride = ["log", "warn", "error"];

            methodsToOverride.forEach((method) => {
                const originalMethod = console[method];

                console[method] = (...args: any[]) => {
                    originalMethod(...args);
                    this.consoleData.push({
                        date: new Date().toLocaleString(),
                        message: args.map(this.formatMessage).join(" "),
                        type: method,
                    });

                    this.saveLoggerDataToDB();
                };
            });

            window.addEventListener("error", (event) => {
                this.consoleData.push({
                    type: "error",
                    date: new Date().toLocaleString(),
                    message: event.error.toString(),
                });

                this.saveLoggerDataToDB();
            });

            window.addEventListener("unhandledrejection", (event) => {
                this.consoleData.push({
                    type: "error",
                    date: new Date().toLocaleString(),
                    message: event.reason.toString(),
                });

                this.saveLoggerDataToDB();
            });  
        },
        overrideFetch() {
            const originalFetch = window.fetch;
            this.originalFetch = originalFetch;

            window.fetch = async (...args) => {
                const response = await originalFetch(...args);
                const responseBody = await response.clone().text();

                const data = {
                    date: new Date().toLocaleString(),
                    type: "fetch",
                    request: args[0],
                    response: responseBody,
                    status: response.status,
                    options: JSON.stringify(args[1]) || {},
                };

                this.networkData.push(data);
                this.saveLoggerDataToDB();

                return response;
            };
        },
        overrideXHR() {
            const originalOpen = window.XMLHttpRequest.prototype.open;
            this.originalXHR = originalOpen;
            const vueInstance = this;

            window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this._url = url;
            this._method = method;

            this.addEventListener("load", function () {
                const data = {
                    date: new Date().toLocaleString(),
                    type: "xhr",
                    url: this._url,
                    method: this._method,
                    response: this.responseText,
                    status: this.status,
                    options: this._method,
                };

                vueInstance.networkData.push(data);
                vueInstance.saveLoggerDataToDB();
            });

            originalOpen.call(this, method, url, ...rest);
            };
        },
        overrideWebSocket() {
            const originalWebSocket = window.WebSocket;
            this.originalWebSocket = originalWebSocket;
            const vueInstance = this;

            window.WebSocket = function (...args) {
                const ws = new originalWebSocket(...(args as [string, ...any[]]));

                const logWebSocketEvent = (type, response) => {
                    const data = {
                        date: new Date().toLocaleString(),
                        type: "ws",
                        request: args[0],
                        response,
                        eventType: type, 
                    };

                    vueInstance.networkData.push(data);

                    vueInstance.saveLoggerDataToDB();
                };

                ws.addEventListener("open", () => logWebSocketEvent("open", "Connection opened"));
                ws.addEventListener("message", (event) => logWebSocketEvent("message", event.data));
                ws.addEventListener("close", () => logWebSocketEvent("close", "Connection closed"));
                ws.addEventListener("error", () => logWebSocketEvent("error", "Connection error"));

                return ws;
            } as any;
        },
        observeResources() {
            if (!this.resourceObserver) {
                this.resourceObserver = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        mutation.addedNodes.forEach((node) => {
                            switch (node.nodeName) {
                                case "IMG":
                                    this.networkData.push({
                                        date: new Date().toLocaleString(),
                                        type: "resource",
                                        eventType: "image",
                                        url: (node as HTMLImageElement).src,
                                    });
                                    this.saveLoggerDataToDB();
                                    break;
                                case "LINK":
                                    this.networkData.push({
                                        date: new Date().toLocaleString(),
                                        type: "resource",
                                        eventType: "stylesheet",
                                        url: (node as HTMLLinkElement).href,
                                    });
                                    this.saveLoggerDataToDB();
                                    break;
                                case "SCRIPT":
                                    this.networkData.push({
                                        date: new Date().toLocaleString(),
                                        type: "resource",
                                        eventType: "script",
                                        url: (node as HTMLScriptElement).src,
                                    });
                                    this.saveLoggerDataToDB();
                                    break;
                                case "IFRAME":
                                    this.networkData.push({
                                        date: new Date().toLocaleString(),
                                        type: "resource",
                                        eventType: "iframe",
                                        url: (node as HTMLIFrameElement).src,
                                    });
                                    this.saveLoggerDataToDB();
                                    break;
                                case "HTML":
                                    this.networkData.push({
                                        date: new Date().toLocaleString(),
                                        type: "resource",
                                        eventType: "document",
                                        url: node.baseURI,
                                    });
                                    this.saveLoggerDataToDB();
                                    break;
                                default:
                                    break;
                            }
                        });
                    });
                });

                // Start observing the document for added nodes
                this.resourceObserver.observe(document, { childList: true, subtree: true });
            }
        },
        monitorUsersInStations() {
            if (this.monitorUsers) {
                for (const key in this.liveClassProxy.users) {
                    const userRoom = this.liveClassProxy.users[key].room;
                    const userRole = this.liveClassProxy.users[key].role; // to exclude stations
                    const existingUser = this.usersInStations.find((u) => u.user === key && u.event === 'joined');

                    if (userRoom.includes("Station") && userRole !== "station") {
                        if (existingUser && existingUser.station !== userRoom) {
                            // User left the previous station
                            this.usersInStations.push({
                                user: key,
                                station: existingUser.station,
                                date: new Date().toLocaleString(),
                                event: "left"
                            });

                            this.saveLoggerDataToDB();
                        }
                        // User joined a new station
                        this.usersInStations.push({
                            user: key,
                            station: userRoom,
                            date: new Date().toLocaleString(),
                            event: "joined"
                        });

                        this.saveLoggerDataToDB();
                    } else if (existingUser) {
                        // User left a station
                        this.usersInStations.push({
                            user: key,
                            station: existingUser.station,
                            date: new Date().toLocaleString(),
                            event: "left"
                        });

                        this.saveLoggerDataToDB();
                    }
                }
            }
        },
        generateChart() {
            const memoryDataArray = this.memoryData;
      
            if (memoryDataArray.length > 0) {
                const chartDom = document.getElementById("chart");
                if (!chartDom) {
                    console.warn("Chart DOM element not found.");
                    return;
                }

                const myChart = echarts.init(chartDom);

                const option = {
                xAxis: {
                    type: 'time',
                    name: 'Time',
                    nameLocation: 'middle',
                    nameGap: 25,
                },
                yAxis: {
                    type: 'value',
                    name: 'Memory Usage (MB)',
                    nameLocation: 'middle',
                    nameGap: 30,
                },
                series: [
                    {
                    data: memoryDataArray.map((memory: any) => [
                        new Date(memory.date), 
                        memory.usedJSHeapSize,
                    ]),
                    type: 'line',
                    smooth: true,
                    name: 'Used JS Heap Size',
                    }
                ],
                tooltip: {
                    trigger: 'axis',
                    formatter: function (params: any) {
                        const data = params[0].data;
                        return `Date: ${new Date(data[0]).toLocaleString()}<br/>Memory: ${data[1]} MB`; 
                    },
                },
                };

                myChart.setOption(option);
            } else {
                console.warn("No memory data available to plot the chart.");
            }
        },
        openChartDialog() {
            this.isChartOpen = true;

            // Wait for the dialog to open before generating the chart
            this.$nextTick(() => {
                this.generateChart();
            });
        },
        async saveLoggerDataToDB() {
            try {
                // Convert Date objects to ISO strings before saving to IndexedDB (IndexedDB doesn't support Date objects)
                const serializedData = {
                    consoleData: this.consoleData.map(entry => ({
                        ...entry,
                        date: entry.date instanceof Date ? entry.date.toISOString() : entry.date
                    })),
                    memoryData: this.memoryData.map(entry => ({
                        ...entry,
                        date: entry.date instanceof Date ? entry.date.toISOString() : entry.date
                    })),
                    networkData: this.networkData.map(entry => ({
                        ...entry,
                        date: entry.date instanceof Date ? entry.date.toISOString() : entry.date,
                    })),
                    usersInStations: this.usersInStations.map(entry => ({
                        ...entry,
                        date: entry.date instanceof Date ? entry.date.toISOString() : entry.date
                    }))
                };

                await logsDB.logs.put({ id: (this.classId + '_Station:' + this.stationName), LoggerData: serializedData });
            } catch (error) {
                console.error("Error saving logger data to IndexedDB:", error);
            }
        },
        async loadLoggerDataFromDB(classroomId: string, stationName: string) {
            try {
                const data = await logsDB.logs.get((classroomId + '_Station:' + stationName));

                if (data && data.LoggerData) {
                    this.stopLogger();

                    this.isLogsLoaderError = false;
                    this.isLogsLoaderVisible = false;

                    this.consoleData = data.LoggerData.consoleData;
                    this.memoryData = data.LoggerData.memoryData;
                    this.networkData = data.LoggerData.networkData;
                    this.usersInStations = data.LoggerData.usersInStations;
                } else {
                    this.isLogsLoaderError = true;
                }
            } catch (error) {
                console.error("Error loading logger data from IndexedDB:", error);
            }
        }
    },
};
</script>

<template>
    <v-card>
        <v-toolbar dark flat>
            <v-toolbar-title>Logger</v-toolbar-title>

            <v-spacer></v-spacer>

            <v-menu :close-on-content-click="false">
                <template v-slot:activator="{ props }">
                    <v-btn icon v-bind="props">
                        <v-icon>mdi-format-list-checkbox</v-icon>
                    </v-btn>
                </template>

                <v-list>
                    <v-list-item max-height="1">
                        <v-checkbox v-model="monitorMemory" label="Memory Usage"></v-checkbox>
                    </v-list-item>
                    <v-list-item max-height="1">
                        <v-checkbox v-model="monitorNetwork" label="Network Data"></v-checkbox>
                    </v-list-item>
                    <v-list-item max-height="1">
                        <v-checkbox v-model="monitorConsole" label="Console Logs"></v-checkbox>
                    </v-list-item>
                    <v-list-item max-height="1">
                        <v-checkbox v-model="monitorUsers" label="Users in Stations"></v-checkbox>
                    </v-list-item>
                </v-list>
            </v-menu>

            <v-btn icon @click="$emit('minimize')">
                <v-icon>mdi-minus</v-icon>
            </v-btn>

            <v-btn icon @click="isClosingDialogVisible = true">
                <v-icon>mdi-close</v-icon>
            </v-btn>
        </v-toolbar>

        <div class="btns-container">
            <v-btn variant="outlined" @click="startOrStopLogger">
                {{ isLoggerRunning ? "Stop" : "Start" }}
            </v-btn>

            <v-btn variant="outlined" @click="loadLogs">
                Load
            </v-btn>

            <v-btn variant="outlined" @click="clearLogger">
                Clear
            </v-btn>
        </div>

        <div class="tabs-container">
            <v-tabs
                align-tabs="center"
                v-model="tab"
                bg-color="grey-lighten-4"
                fixed-tabs
            >
                <v-tab value="memory">Memory Usage</v-tab>
                <v-tab value="network">Network Data</v-tab>
                <v-tab value="console">Console Logs</v-tab>
                <v-tab value="station">Station Data</v-tab>
            </v-tabs>
        </div>

        <v-card-text>
            <v-tabs-window v-model="tab">
                <v-tabs-window-item value="memory">
                    <div v-if="memoryData.length">
                        <div class="btns-container">
                            <v-btn variant="tonal" @click="openChartDialog">Generate Chart</v-btn>
                        </div>

                        <v-divider></v-divider>

                        <div 
                            v-for="(data, index) in memoryData" 
                            :key="index"
                        >
                            <span id="log-date">{{ data.date }}</span> 
                            <span id="log-title"> - Used JS Heap Size:</span> {{ data.usedJSHeapSize }} MB
                            <span id="log-title"> - Total JS Heap Size:</span> {{ data.totalJSHeapSize }} MB
                            <span id="log-title"> - JS Heap Size Limit:</span> {{ data.jsHeapSizeLimit }} MB
                        </div>
                    </div>
                    <div v-else>
                        <p>{{ loggerTabsText[0] }}</p>
                    </div>
                </v-tabs-window-item>

                <v-tabs-window-item value="network">
                    <div v-if="networkData.length">
                        <div 
                            v-for="(data, index) in networkData" 
                            :key="index"
                        >
                            <span id="log-date">{{ data.date }}</span> 
                            <span id="log-title"> - {{ data.type.toLocaleUpperCase() }}: </span> 
                            <span v-if="data.type === 'fetch'"> 
                                <span id="log-subtitle">Request:</span> {{ data.request }} -
                                <span id="log-subtitle">Response:</span> {{ data.response }} -
                                <span id="log-subtitle">Status:</span> {{ data.status }} -
                                <span id="log-subtitle">Options:</span> {{ data.options }} 
                            </span>
                            <span v-else-if="data.type === 'xhr'"> 
                                <span id="log-subtitle">Request:</span> {{ data.method }} {{ data.url }} - 
                                <span id="log-subtitle">Response:</span> {{ data.response }} -
                                <span id="log-subtitle">Status:</span> {{ data.status }} -
                                <span id="log-subtitle">Options:</span> {{ data.options }} 
                            </span>
                            <span v-else-if="data.type === 'ws'"> 
                                <span id="log-subtitle">Event:</span> {{ data.eventType }} -
                                <span id="log-subtitle">Request:</span> {{ data.request }} -
                                <span id="log-subtitle">Response:</span> {{ data.response }} 
                            </span>
                            <span v-else-if="data.type === 'resource'">
                                <span id="log-subtitle">Type:</span> {{ data.eventType }} -
                                <span id="log-subtitle">Url:</span> {{ data.url }}
                            </span>
                        </div>
                    </div>
                    <div v-else>
                        <p>{{ loggerTabsText[1] }}</p>
                    </div>
                </v-tabs-window-item>

                <v-tabs-window-item value="console">
                    <div v-if="consoleData.length">
                        <div 
                            v-for="(data, index) in consoleData" 
                            :key="index"
                        >
                            <span id="log-date">{{ data.date }}</span> 
                            <span 
                                id="log-title"
                                :style="{ color: data.type === 'log' ? '#0047AB' : data.type === 'warn' ? '#F4BB44' : data.type === 'error' ? 'red' : 'black' }"
                            > 
                                - {{ data.type.toLocaleUpperCase() }}:
                            </span> 
                                {{ data.message }}
                        </div>
                    </div>
                    <div v-else>
                        <p>{{ loggerTabsText[2] }}</p>
                    </div>
                </v-tabs-window-item>

                <v-tabs-window-item value="station">
                    <div v-if="usersInStations.length">
                        <div 
                            v-for="(data, index) in usersInStations" 
                            :key="index"
                        >
                            <span id="log-date">{{ data.date }}</span> 
                            <span id="log-title"> - User:</span> {{ data.user }}
                            <span id="log-title"> - Event:</span> {{ data.event }}
                            <span id="log-title"> - Station:</span> {{ data.station }}
                        </div>
                    </div>
                    <div v-else>
                        <p>{{ loggerTabsText[3] }}</p>
                    </div>
                </v-tabs-window-item>
            </v-tabs-window>
        </v-card-text>

        <v-dialog 
            v-model="isChartOpen"
            max-width="800"
        >
            <v-card>
                <v-toolbar dark flat>
                    <v-toolbar-title>Memory Usage Chart</v-toolbar-title>
                    <v-spacer></v-spacer>
                    <v-btn icon @click="isChartOpen = false">
                    <v-icon>mdi-close</v-icon>
                    </v-btn>
                </v-toolbar>

                <v-card-text>
                    <!-- Chart Container -->
                    <div id="chart"></div>
                </v-card-text>
            </v-card>
        </v-dialog>


        <v-dialog
            v-model="isClosingDialogVisible"
            max-width="600"
        >
            <v-card>
                <v-toolbar dark flat>
                    <v-toolbar-title>Closing the Logger will stop it from running, are you sure?</v-toolbar-title>
                </v-toolbar>
                <v-card-actions>
                    <v-btn
                        variant="outlined"
                        color="grey-darken-4"
                        @click="isClosingDialogVisible = false"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        variant="flat"
                        color="grey-darken-4"
                        @click="$emit('close')"
                    >
                        Close
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <v-dialog
            v-model="isLogsLoaderVisible"
            max-width="450"
            persistent
        >
            <v-card>
                <v-form @submit.prevent>
                    <v-toolbar dark flat>
                        <v-toolbar-title>Load Logs from IndexedDB</v-toolbar-title>
                    </v-toolbar>
                    <v-card-text>
                        <v-text-field
                            v-model="classIdInput"
                            label="Classroom ID"
                            outlined
                        ></v-text-field>
                        <v-text-field
                            v-model="stationNameInput"
                            label="Station Name"
                            outlined
                        ></v-text-field>
                    </v-card-text>
                    <p id="loader_error">{{ this.isLogsLoaderError ? 'No logs found for the specified Classroom ID and Station Name!!' : '' }}</p>
                    <v-divider></v-divider>
                </v-form>
                    <v-card-actions>
                        <v-btn
                            variant="outlined"
                            color="grey-darken-4"
                            @click="isLogsLoaderVisible = false"
                        >
                            Cancel
                        </v-btn>
                        <v-btn
                            variant="flat"
                            color="grey-darken-4"
                            @click="loadLoggerDataFromDB(classIdInput, stationNameInput)"
                        >
                            Load
                        </v-btn>
                    </v-card-actions>
            </v-card>
        </v-dialog>
    </v-card>
</template>

<style>
.btns-container {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 10px 0;
}

.btns-container > * {
    margin: 0 10px;
}

.tabs-container {
    margin-bottom: 5px;
}

#log-date #log-title {
    font-weight: 600;
}

#log-date {
    color: #088F8F;
}

#log-title {
    color: #0047AB;
}

#log-subtitle {
    color: #186a3b;
}

#chart {
    width: 100%;
    height: 400px;
    background-color: #fff;
}

#loader_error {
    color: red;
    font-size: .9rem;
    text-align: center
}

@keyframes blink {
    0%, 100% {
        color:#74ff5a;
        box-shadow: 1px 1px 0 0 #74ff5a, 0 1px 1px 0 #74ff5a, -1px 1px 0 0 #74ff5a, 0 -1px 1px 0 #74ff5a;
    }
    50% {
        color: #E8F5E9;
        box-shadow: none;
    }
}
</style>