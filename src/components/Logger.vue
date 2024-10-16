<script lang="ts">

import * as echarts from 'echarts';

declare global {
    interface Performance {
        memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
        };
    }
};

interface ConsoleData {
    date: Date;
    message: string;
    type: string;
};

interface NetworkData {
    date: Date;
    type: string;
    request?: string;
    response?: string;
    status?: number;
    options?: string;
    url?: string;
    eventType?: string;
};

interface IUserInStation {
  user: string;
  station: string;
  date: Date;
  event: string;
};

export default {
    name: "Logger",

    props: ["liveClassProxy"],

    data() {
        return {
            memoryData: [] as {
                date: Date;
                usedJSHeapSize: string;
                totalJSHeapSize: string;
                jsHeapSizeLimit: string;
            }[],

            intervalId: null as number | null,

            consoleData: [] as ConsoleData[],

            networkData: [] as NetworkData[],

            tab: 'memory',

            usersInStations: [] as IUserInStation[],

            isChartOpen: false,
        };
    },

    created() {
        this.overrideConsoleMethods();
        this.overrideFetch();
        this.overrideXHR();
        this.overrideWebSocket();
        this.observeResources();
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
        startLogger() {
            console.log("Logger started");
            if (this.intervalId === null) { 
                this.intervalId = setInterval(() => {
                    this.measureMemory();
                }, 5000);
            } else {
                console.warn("Memory logger is already running!");
            }
        },
        stopLogger() {
            console.log("Logger stopped");
            if (this.intervalId !== null) { 
                clearInterval(this.intervalId);
                this.intervalId = null; 
            } else {
                console.warn("Memory logger is not running.");
            }
        },
        loadLogger() {
            console.log("Logger loaded");

            /*
            // Testing network data
            fetch("https://jsonplaceholder.typicode.com/posts", {
                method: "POST",
                headers: {
                "Content-Type": "application/json;charset=utf-8",
                },
                body: JSON.stringify({ title: "foo", body: "bar", userId: 1 }),
            })

            const xhr = new XMLHttpRequest();
            xhr.open("GET", "https://jsonplaceholder.typicode.com/posts/1");
            xhr.send();

            const ws = new WebSocket("wss://echo.websocket.org");
            ws.onopen = () => {
                ws.send("Hello, World!");
            };
            ws.onclose = () => {
                console.log("WebSocket closed");
            };

            const iframe = document.createElement("iframe");
            iframe.src = "https://example.com";
            document.body.appendChild(iframe);
            */
        },
        clearLogger() {
            console.log("Logger cleared");
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
                    date: new Date(),
                    usedJSHeapSize,
                    totalJSHeapSize,
                    jsHeapSizeLimit,
                });
            } else
                console.warn("Performance memory API is not supported in this browser.");
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
                };
            });

            window.addEventListener("error", (event) => {
                this.consoleData.push({
                    type: "error",
                    date: new Date().toLocaleString(),
                    message: ["Unhandled Error:", event.error.toString()],
                });
            });

            window.addEventListener("unhandledrejection", (event) => {
                this.consoleData.push({
                    type: "error",
                    date: new Date().toLocaleString(),
                    message: ["Unhandled Promise Rejection:", event.reason.toString()],
                });
            });  
        },
        overrideFetch() {
            const originalFetch = window.fetch;

            window.fetch = async (...args) => {
                const response = await originalFetch(...args);

                const data = {
                    date: new Date(),
                    type: "fetch",
                    request: args[0],
                    response: await response.text(),
                    status: response.status,
                    options: args[1] || {},
                };

                this.networkData.push(data);

                return response;
            };
        },
        overrideXHR() {
            const originalOpen = window.XMLHttpRequest.prototype.open;
            const vueInstance = this;

            window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this._url = url;
            this._method = method;

            this.addEventListener("load", function () {
                const data = {
                    date: new Date(),
                    type: "xhr",
                    request: { url: this._url, method: this._method },
                    response: this.responseText,
                    status: this.status,
                    options: this._method,
                };

                vueInstance.networkData.push(data);
            });

            originalOpen.call(this, method, url, ...rest);
            };
        },
        overrideWebSocket() {
            const originalWebSocket = window.WebSocket;
            const vueInstance = this;

            window.WebSocket = function (...args) {
                const ws = new originalWebSocket(...(args as [string, ...any[]]));

                const logWebSocketEvent = (type, response) => {
                    const data = {
                        date: new Date(),
                        type: "ws",
                        request: args[0],
                        response,
                        eventType: type, 
                    };

                    vueInstance.networkData.push(data);
                };

                ws.addEventListener("open", () => logWebSocketEvent("open", "Connection opened"));
                ws.addEventListener("message", (event) => logWebSocketEvent("message", event.data));
                ws.addEventListener("close", () => logWebSocketEvent("close", "Connection closed"));
                ws.addEventListener("error", (event) => logWebSocketEvent("error", event));

                return ws;
            } as any;
        },
        observeResources() {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        switch (node.nodeName) {
                            case "IMG":
                                this.networkData.push({
                                    date: new Date(),
                                    type: "resource",
                                    eventType: "image",
                                    url: (node as HTMLImageElement).src,
                                });
                                break;
                            case "LINK":
                                this.networkData.push({
                                    date: new Date(),
                                    type: "resource",
                                    eventType: "stylesheet",
                                    url: (node as HTMLLinkElement).href,
                                });
                                break;
                            case "SCRIPT":
                                this.networkData.push({
                                    date: new Date(),
                                    type: "resource",
                                    evenType: "script",
                                    url: (node as HTMLScriptElement).src,
                                });
                                break;
                            case "IFRAME":
                                this.networkData.push({
                                    date: new Date(),
                                    type: "resource",
                                    eventType: "iframe",
                                    url: (node as HTMLIFrameElement).src,
                                });
                                break;
                            case "HTML":
                                this.networkData.push({
                                    date: new Date(),
                                    type: "resource",
                                    eventType: "document",
                                    url: node.baseURI,
                                });
                                break;
                            default:
                                break;
                        }
                    });
                });
            });

            observer.observe(document, { childList: true, subtree: true, });
        },
        monitorUsersInStations() {
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
                            date: new Date(),
                            event: "left"
                        });
                    }
                    // User joined a new station
                    this.usersInStations.push({
                        user: key,
                        station: userRoom,
                        date: new Date(),
                        event: "joined"
                    });
                } else if (existingUser) {
                    // User left a station
                    this.usersInStations.push({
                        user: key,
                        station: existingUser.station,
                        date: new Date(),
                        event: "left"
                    });
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
                        memory.date, 
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
    },
};
</script>

<template>
    <v-card>
        <v-toolbar dark flat>
            <v-toolbar-title>Logger</v-toolbar-title>

            <v-spacer></v-spacer>

            <v-btn icon @click="$emit('close')">
                <v-icon>mdi-close</v-icon>
            </v-btn>
        </v-toolbar>


        <div class="btns-container">
            <v-btn variant="outlined" @click="startLogger">
                Start
            </v-btn>

            <v-btn variant="outlined" @click="stopLogger">
                Stop
            </v-btn>

            <v-btn variant="outlined" @click="loadLogger">
                Load
            </v-btn>

            <v-btn variant="outlined" @click="clearLogger">
                Clear
            </v-btn>
        </div>

        <v-tabs
            align-tabs="center"
            v-model="tab"
        >
            <v-tab value="memory">Memory Usage</v-tab>
            <v-tab value="network">Network Data</v-tab>
            <v-tab value="console">Console Logs</v-tab>
            <v-tab value="station">Station Data</v-tab>
        </v-tabs>

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
                            <span id="log-date">{{ data.date.toLocaleString() }}</span> 
                            <span id="log-title"> - Used JS Heap Size:</span> {{ data.usedJSHeapSize }} MB
                            <span id="log-title"> - Total JS Heap Size:</span> {{ data.totalJSHeapSize }} MB
                            <span id="log-title"> - JS Heap Size Limit:</span> {{ data.jsHeapSizeLimit }} MB
                        </div>
                    </div>
                    <div v-else>
                        <p>Click Start to monitor memory usage, or load existing logs.</p>
                    </div>
                </v-tabs-window-item>

                <v-tabs-window-item value="network">
                    <div v-if="networkData.length">
                        <div 
                            v-for="(data, index) in networkData" 
                            :key="index"
                        >
                            <span id="log-date">{{ data.date.toLocaleString() }}</span> 
                            <span id="log-title"> - {{ data.type.toLocaleUpperCase() }}:</span> 
                            <span v-if="data.type === 'fetch'"> 
                                Request: {{ data.request }} 
                                Response: {{ data.response }} 
                                Status: {{ data.status }} 
                                Options: {{ data.options }}
                            </span>
                            <span v-else-if="data.type === 'xhr'"> 
                                Request: {{ data.url }} 
                                Response: {{ data.response }} 
                                Status: {{ data.status }} 
                                Options: {{ data.options }}
                            </span>
                            <span v-else-if="data.type === 'ws'"> 
                                Event: {{ data.eventType }},
                                Request: {{ data.request }},
                                Response: {{ data.response }}
                            </span>
                            <span v-else-if="data.type === 'resource'">
                                Type: {{ data.eventType }}, 
                                Url: {{ data.url }}
                            </span>
                        </div>
                    </div>
                    <div v-else>
                        <p>Click Start to monitor network data, or load existing logs.</p>
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
                        <p>Click Start to monitor console logs, or load existing logs.</p>
                    </div>
                </v-tabs-window-item>

                <v-tabs-window-item value="station">
                    <div v-if="usersInStations.length">
                        <div 
                            v-for="(data, index) in usersInStations" 
                            :key="index"
                        >
                            <span id="log-date">{{ data.date.toLocaleString() }}</span> 
                            <span id="log-title"> - User:</span> {{ data.user }}
                            <span id="log-title"> - Event:</span> {{ data.event }}
                            <span id="log-title"> - Station:</span> {{ data.station }}
                        </div>
                    </div>
                    <div v-else>
                        <p>No users in stations.</p>
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
    </v-card>
</template>

<style>
.btns-container {
    display: flex;
    justify-content: center;
    margin: 20px 0;
}

.btns-container > * {
    margin: 0 10px;
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

#chart {
    width: 100%;
    height: 400px;
    background-color: #fff;
}
</style>