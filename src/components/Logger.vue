<script lang="ts">
import { onMounted } from "vue";

var echarts: any = null;

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

export interface MemoryData {
  date: Date;
  usedJSHeapSize: string;
  totalJSHeapSize: string;
  jsHeapSizeLimit: string;
}

export interface ConsoleData {
  date: Date;
  message: string;
  type: string;
}

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
}

export interface IUserInStation {
  user: string;
  station: string;
  date: Date;
  event: string;
}

export default {
  name: "Logger",

  props: ["liveClassProxy", "classId", "stationName", "database"],

  data() {
    onMounted(async () => {
      const chartDom = document.getElementById("chart");
      if (chartDom) {
        // Dynamically import ECharts and its components
        echarts = await import("echarts/core");
        const { LineChart } = await import("echarts/charts");
        const { TooltipComponent, GridComponent } = await import("echarts/components");
        const { CanvasRenderer } = await import("echarts/renderers");

        // Register the required components
        echarts.use([LineChart, TooltipComponent, GridComponent, CanvasRenderer]);

        // Initialize the chart instance
        this.memoryChart = echarts.init(chartDom);
        window.addEventListener("resize", () => {
          ((this.memoryChart as unknown) as echarts.EChartsType)?.resize();
        });

        this.generateChart();
      }
    });
    return {
      memoryData: [] as MemoryData[],
      memoryChart: null as echarts.EChartsType | null,

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

      tab: "memory",

      isLoggerRunning: false,
      isShowingPrevLogs: false,

      isClosingDialogVisible: false,
      isLogsLoaderVisible: false,

      monitorMemory: true,
      monitorNetwork: true,
      monitorConsole: true,
      monitorUsers: true,

      loggerTabsText: [
        performance.memory
          ? "Click Start to monitor memory usage, or load existing logs."
          : "Performance memory API is not supported in this browser!!",
        "Click Start to monitor network data, or load existing logs.",
        "Click Start to monitor console logs, or load existing logs.",
        "Click Start to monitor users in stations activity.",
      ],

      stationLogsInput: null as string | null,
      classroomPastStations: [] as string[],

      logsDate: null as Date | null,
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
      this.logsDate = new Date().toLocaleString();

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

      if (this.monitorMemory && this.intervalId === null && performance.memory) {
        this.loggerTabsText[0] = "Started monitoring memory usage...";

        // generate one initial data point
        this.measureMemory();
        this.intervalId = setInterval(() => {
          this.measureMemory();
        }, 5000);
      }
    },
    stopLogger() {
      this.$emit("logger-stopped");

      this.isLoggerRunning = false;

      // Reset console methods to original
      console.log = this.originalConsoleLog;
      console.warn = this.originalConsoleWarn;
      console.error = this.originalConsoleError;
      this.loggerTabsText[2] = "Stopped monitoring console logs.";

      // Reset fetch, XHR, and WebSocket to original
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

      this.loggerTabsText[3] = "Stopped monitoring users in stations.";

      // Stop memory monitoring
      if (this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.loggerTabsText[0] = "Stopped monitoring memory usage.";
      }
    },
    loadLogs() {
      this.getClassroomPastStations();
      this.isLogsLoaderVisible = true;
    },
    clearLogger() {
      this.memoryData = [];
      this.consoleData = [];
      this.networkData = [];
      this.usersInStations = [];

      this.isShowingPrevLogs = false;
    },
    formatMessage(message: object | string) {
      if (typeof message === "object" && message !== null) {
        return JSON.stringify(message, null, 2);
      }
      return message.toString();
    },
    measureMemory() {
      if (!performance.memory) {
        return;
      }

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
      this.$nextTick(this.generateChart);
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
        ws.addEventListener("message", (event) =>
          logWebSocketEvent("message", event.data)
        );
        ws.addEventListener("close", () =>
          logWebSocketEvent("close", "Connection closed")
        );
        ws.addEventListener("error", () =>
          logWebSocketEvent("error", "Connection error")
        );

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
          const existingUser = this.usersInStations.find(
            (u) => u.user === key && u.event === "joined"
          );

          if (userRoom.includes("Station") && userRole !== "station") {
            if (existingUser && existingUser.station !== userRoom) {
              // User left the previous station
              this.usersInStations.push({
                user: key,
                station: existingUser.station,
                date: new Date().toLocaleString(),
                event: "left",
              });

              this.saveLoggerDataToDB();
            }
            // User joined a new station
            this.usersInStations.push({
              user: key,
              station: userRoom,
              date: new Date().toLocaleString(),
              event: "joined",
            });

            this.saveLoggerDataToDB();
          } else if (existingUser) {
            // User left a station
            this.usersInStations.push({
              user: key,
              station: existingUser.station,
              date: new Date().toLocaleString(),
              event: "left",
            });

            this.saveLoggerDataToDB();
          }
        }
      }
    },
    generateChart() {
      const chartDom = document.getElementById("chart");

      if (!chartDom || !chartDom.clientWidth || !chartDom.clientHeight) {
        //console.warn("Chart DOM element not found or has no dimensions.");
        return;
      }

      const memoryDataArray = this.memoryData;

      if (memoryDataArray.length > 0) {
        const option = {
          xAxis: {
            type: "time",
            name: "Time",
            nameLocation: "middle",
            nameGap: 25,
            axisLabel: {
              formatter: (value) => new Date(value).toLocaleTimeString(),
            },
          },
          yAxis: {
            type: "value",
            name: "Memory Usage (MB)",
            nameLocation: "middle",
            nameGap: 55,
            axisLabel: {
              formatter: (value) => `${value.toFixed(0)} MB`,
            },
          },
          series: [
            {
              data: this.memoryData.map((memory) => [
                new Date(memory.date),
                parseFloat(memory.usedJSHeapSize),
              ]),
              type: "line", // Ensure this matches the imported chart type
              smooth: true,
              name: "Used JS Heap Size",
            },
          ],
          tooltip: {
            trigger: "axis",
          },
        };
        this.memoryChart.setOption(option);
        this.memoryChart.resize();
      } else {
        console.warn("No memory data available to plot the chart.");
      }
    },
    async saveLoggerDataToDB() {
      try {
        // Convert Date objects to ISO strings before saving to IndexedDB (IndexedDB doesn't support Date objects)
        const serializedData = {
          consoleData: this.consoleData.map((entry) => ({
            ...entry,
            date: entry.date instanceof Date ? entry.date.toISOString() : entry.date,
          })),
          memoryData: this.memoryData.map((entry) => ({
            ...entry,
            date: entry.date instanceof Date ? entry.date.toISOString() : entry.date,
          })),
          networkData: this.networkData.map((entry) => ({
            ...entry,
            date: entry.date instanceof Date ? entry.date.toISOString() : entry.date,
          })),
          usersInStations: this.usersInStations.map((entry) => ({
            ...entry,
            date: entry.date instanceof Date ? entry.date.toISOString() : entry.date,
          })),
        };

        await this.database.putLog(
          this.classId + "_Station:" + this.stationName + "_Date:" + this.logsDate,
          serializedData
        );
      } catch (error) {
        console.error("Error saving logger data to IndexedDB:", error);
      }
    },
    async loadLoggerDataFromDB() {
      try {
        const stationName = this.stationLogsInput.split(" - ")[0].split(": ")[1];
        const stationDate = this.stationLogsInput.split(" - ")[1].split(": ")[1];

        const data = await this.database.getLogById(
          this.classId + "_Station:" + stationName + "_Date:" + stationDate
        );

        if (data && data.LoggerData) {
          this.stopLogger();

          this.isLogsLoaderVisible = false;
          this.isShowingPrevLogs = true;

          this.consoleData = data.LoggerData.consoleData;
          this.memoryData = data.LoggerData.memoryData;
          this.networkData = data.LoggerData.networkData;
          this.usersInStations = data.LoggerData.usersInStations;

          this.$nextTick(this.generateChart);
        }
      } catch (error) {
        console.error("Error loading logger data from IndexedDB:", error);
      }
    },
    async getClassroomPastStations() {
      try {
        const allIds = await this.database.getLogsIds();

        if (allIds) {
          this.classroomPastStations = allIds
            .filter((id: string) => id.includes(this.classId))
            .map((id: string) => {
              const stationName = id.split("_Station:")[1].split("_Date:")[0];
              const date = new Date(id.split("_Date:")[1]).toLocaleString();

              return `Station: ${stationName} - Date: ${date}`;
            });
        }
      } catch (error) {
        console.error("Error getting classroom past stations from IndexedDB:", error);
      }
    },
  },
};
</script>

<template>
  <v-card>
    <v-toolbar dark flat>
      <v-toolbar-title>Logger</v-toolbar-title>

      <div id="header_text_container">
        <div id="recording_text" v-if="isLoggerRunning">
          Recording
          <div class="circles">
            <div class="circle1"></div>
            <div class="circle2"></div>
            <div class="circle3"></div>
          </div>
        </div>

        <div v-if="isShowingPrevLogs">
          {{ !isLogsLoaderVisible ? "Showing Logs from " + stationLogsInput : "" }}
        </div>
      </div>

      <v-spacer></v-spacer>

      <v-menu :close-on-content-click="false">
        <template v-slot:activator="{ props }">
          <v-btn icon v-bind="props" :disabled="isLoggerRunning">
            <v-icon>mdi-format-list-checkbox</v-icon>
            <v-tooltip activator="parent" location="bottom">Data Options</v-tooltip>
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

      <v-tooltip text="Minimize (keeps running in background)" location="bottom">
        <template v-slot:activator="{ props }">
          <v-btn v-bind="props" icon="mdi-minus" @click="$emit('minimize')"></v-btn>
        </template>
      </v-tooltip>

      <v-tooltip text="Close" location="bottom">
        <template v-slot:activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-close"
            @click="isClosingDialogVisible = true"
          ></v-btn>
        </template>
      </v-tooltip>
    </v-toolbar>

    <div class="btns-container">
      <v-btn
        variant="flat"
        @click="startOrStopLogger"
        :style="{ backgroundColor: isLoggerRunning ? '#cd202c' : '#5ccc48' }"
      >
        {{ isLoggerRunning ? "Stop" : "Start" }}
      </v-btn>

      <v-btn variant="outlined" @click="loadLogs" :disabled="isLoggerRunning">
        Load
      </v-btn>

      <v-btn variant="outlined" @click="clearLogger"> Clear </v-btn>
    </div>

    <div class="tabs-container">
      <v-tabs align-tabs="center" v-model="tab" bg-color="grey-lighten-4" fixed-tabs>
        <v-tab value="memory" v-if="monitorMemory">Memory Usage</v-tab>
        <v-tab value="network" v-if="monitorNetwork">Network Data</v-tab>
        <v-tab value="console" v-if="monitorConsole">Console Logs</v-tab>
        <v-tab value="station" v-if="monitorUsers">Station Data</v-tab>
      </v-tabs>
    </div>

    <v-card-text>
      <v-tabs-window v-model="tab">
        <v-tabs-window-item value="memory" v-show="monitorMemory">
          <div v-show="!memoryData.length">
            <p>{{ loggerTabsText[0] }}</p>
          </div>
          <div v-show="memoryData.length">
            <div class="chart-container">
              <v-card>
                <v-toolbar dark flat>
                  <v-toolbar-title>Memory Usage Chart</v-toolbar-title>

                  <v-spacer></v-spacer>

                  <v-btn icon @click="generateChart">
                    <v-icon>mdi-refresh</v-icon>
                    <v-tooltip activator="parent" location="bottom"
                      >Refresh Chart</v-tooltip
                    >
                  </v-btn>
                </v-toolbar>

                <v-card-text>
                  <!-- Chart Container -->
                  <div id="chart"></div>
                </v-card-text>
              </v-card>
            </div>

            <v-divider></v-divider>

            <div v-for="(data, index) in memoryData" :key="index">
              <span id="log-date">{{ data.date }}</span>
              <span id="log-title"> - Used JS Heap Size:</span>
              {{ data.usedJSHeapSize }} MB
              <span id="log-title"> - Total JS Heap Size:</span>
              {{ data.totalJSHeapSize }} MB
              <span id="log-title"> - JS Heap Size Limit:</span>
              {{ data.jsHeapSizeLimit }} MB
            </div>
          </div>
        </v-tabs-window-item>

        <v-tabs-window-item value="network" v-if="monitorNetwork">
          <div v-if="networkData.length">
            <div v-for="(data, index) in networkData" :key="index">
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

        <v-tabs-window-item value="console" v-if="monitorConsole">
          <div v-if="consoleData.length">
            <div v-for="(data, index) in consoleData" :key="index">
              <span id="log-date">{{ data.date }}</span>
              <span
                id="log-title"
                :style="{
                  color:
                    data.type === 'log'
                      ? '#0047AB'
                      : data.type === 'warn'
                      ? '#F4BB44'
                      : data.type === 'error'
                      ? 'red'
                      : 'black',
                }"
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

        <v-tabs-window-item value="station" v-if="monitorUsers">
          <div v-if="usersInStations.length">
            <div v-for="(data, index) in usersInStations" :key="index">
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

    <v-dialog v-model="isClosingDialogVisible" max-width="600">
      <v-card>
        <v-toolbar dark flat>
          <v-toolbar-title
            >Closing the Logger will stop it from running, are you sure?</v-toolbar-title
          >
        </v-toolbar>
        <v-card-actions>
          <v-btn
            variant="outlined"
            color="grey-darken-4"
            @click="isClosingDialogVisible = false"
          >
            Cancel
          </v-btn>
          <v-btn variant="flat" color="grey-darken-4" @click="$emit('close')">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="isLogsLoaderVisible" max-width="450" persistent>
      <v-card>
        <v-toolbar dark flat>
          <v-toolbar-title>Load previous Logs</v-toolbar-title>
        </v-toolbar>

        <v-card-text>
          <v-select
            v-model="stationLogsInput"
            :items="classroomPastStations"
            label="Station Name"
          ></v-select>
        </v-card-text>
        <v-divider></v-divider>
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
            @click="stationLogsInput && loadLoggerDataFromDB()"
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
  color: #088f8f;
}

#log-title {
  color: #0047ab;
}

#log-subtitle {
  color: #186a3b;
}

.chart-container {
  width: 80%;
  margin: 10px auto;
}

#chart {
  min-width: 100%;
  height: 400px;
  background-color: #fff;
}

#loader_error {
  color: red;
  font-size: 0.9rem;
  text-align: center;
}

@keyframes blink {
  0%,
  100% {
    color: #5ccc48;
    box-shadow: 1px 1px 0 0 #5ccc48, 0 1px 1px 0 #5ccc48, -1px 1px 0 0 #5ccc48,
      0 -1px 1px 0 #5ccc48;
  }
  50% {
    color: #e8f5e9;
    box-shadow: none;
  }
}

#header_text_container {
  color: #5ccc48;
  font-weight: 600;
}

#recording_text {
  display: flex;
  justify-content: center;
  align-items: center;
}

.circles {
  width: 25px;
  height: 25px;
  position: relative;

  > div {
    animation: growAndFade 1.5s infinite ease-out;
    background-color: #5ccc48;
    border-radius: 50%;
    opacity: 0;
    position: absolute;
    width: 100%;
    height: 100%;
  }

  .circle1 {
    animation-delay: 0.5s;
  }
  .circle2 {
    animation-delay: 1s;
  }
  .circle3 {
    animation-delay: 1.5s;
  }
}

@keyframes growAndFade {
  0% {
    opacity: 1;
    transform: scale(0);
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}
</style>
