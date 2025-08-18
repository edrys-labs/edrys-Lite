<script lang="ts">
import { onMounted } from "vue";
import { useI18n } from 'vue-i18n';
import { debug } from "../api/debugHandler";

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

type WebSocketInstance = {
  ws: WebSocket; 
  listeners: Array<{ type: string; listener: EventListener }>; 
};

export default {
  name: "Logger",

  props: ["liveClassProxy", "classId", "stationName", "database"],

  setup() {
    const { t, locale } = useI18n();

    return {
      t, 
      locale,
    };
  },

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
      consoleData: [] as ConsoleData[],
      networkData: [] as NetworkData[],
      usersInStations: [] as IUserInStation[],

      memoryChart: null as echarts.EChartsType | null,

      intervalId: null as number | null,

      originalConsoleLog: console.log,
      originalConsoleWarn: console.warn,
      originalConsoleError: console.error,
      originalFetch: window.fetch,
      originalXHR: window.XMLHttpRequest.prototype.open,
      originalWebSocket: window.WebSocket,
      resourceObserver: null as MutationObserver | null,

      webSocketInstances: new Set<WebSocketInstance>(),

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
          ? this.t('logger.tabs.memory.noData')
          : this.t('logger.tabs.memory.notSupported'),
        this.t('logger.tabs.network.noData'),
        this.t('logger.tabs.console.noData'),
        this.t('logger.tabs.station.noData'),
      ],

      stationLogsInput: null as string | null,
      classroomPastStations: [] as string[],

      logsDate: null as Date | null,

      // Data to be displayed (for infinite scroll)
      visibleConsoleData: [] as ConsoleData[],
      visibleMemoryData: [] as MemoryData[],
      visibleNetworkData: [] as NetworkData[],
      visibleUsersInStations: [] as IUserInStation[],

      isSavingEnabled: false,
    };
  },

  mounted() {
    this.$nextTick(() => {
      this.initializeObserverForTab(this.tab);
    });
  },

  beforeUnmount() {
    this.stopLogger();
  },

  computed: {
    activeTabs() {
      // Return a list of active monitoring options
      const tabs: string[] = [];

      if (this.monitorMemory) tabs.push("memory");
      if (this.monitorNetwork) tabs.push("network");
      if (this.monitorConsole) tabs.push("console");
      if (this.monitorUsers) tabs.push("station");
      
      return tabs;
    },
  },

  watch: {
    'liveClassProxy.users': {
      handler(newUsers, oldUsers) {
        if (!this.isLoggerRunning) return;

        // Compare new and old users to detect changes
        const hasChanged = Object.keys(newUsers).some((key) => {
          const newUser = newUsers[key];
          const oldUser = oldUsers ? oldUsers[key] : null;

          // Check if the room or role has changed
          return (
            !oldUser ||
            newUser.room !== oldUser.room
          );
        });

        if (hasChanged) {
          this.monitorUsersInStations();
        }
      },
    },

    tab(newTab) {
      this.initializeObserverForTab(newTab);
    },

    activeTabs(newTabs) {
      // Update the `tab` variable to the first available tab if it becomes inactive
      if (!newTabs.includes(this.tab)) {
        this.tab = newTabs[0] || null; 
      }
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
      this.isSavingEnabled = true;
      this.logsDate = new Date().toLocaleString();

      this.clearLogger();

      if (this.monitorConsole) {
        this.loggerTabsText[2] = this.t('logger.tabs.console.start');
        this.overrideConsoleMethods();
      }

      if (this.monitorNetwork) {
        this.loggerTabsText[1] = this.t('logger.tabs.network.start');
        this.overrideFetch();
        this.overrideXHR();
        this.overrideWebSocket();
        this.observeResources();
      }

      if (this.monitorUsers) {
        this.loggerTabsText[3] = this.t('logger.tabs.station.start');
        this.monitorUsers = true;
      }

      if (this.monitorMemory && this.intervalId === null && performance.memory) {
        this.loggerTabsText[0] = this.t('logger.tabs.memory.start');

        // generate one initial data point
        this.measureMemory();
        this.intervalId = setInterval(() => {
          this.measureMemory();
        }, 5000);
      }
    },

    stopLogger() {
      this.isLoggerRunning = false;
      this.isSavingEnabled = false;

      this.$emit("logger-stopped");

      // Reset console methods to original
      console.log = this.originalConsoleLog;
      console.warn = this.originalConsoleWarn;
      console.error = this.originalConsoleError;
      this.loggerTabsText[2] = this.t('logger.tabs.console.stop');

      // Reset fetch, XHR, and WebSocket to original
      if (this.originalFetch) {
        window.fetch = this.originalFetch;
      }
      if (this.originalXHR) {
        window.XMLHttpRequest.prototype.open = this.originalXHR;
      }
      if (this.originalWebSocket) {
        window.WebSocket = this.originalWebSocket;

        // Remove WebSocket listeners
        this.webSocketInstances.forEach(({ ws, listeners }) => {
          listeners.forEach(({ type, listener }) => {
            ws.removeEventListener(type, listener);
          });
        });
        this.webSocketInstances.clear();
      }
      this.loggerTabsText[1] = this.t('logger.tabs.network.stop');

      // Stop resource monitoring
      if (this.resourceObserver) {
        this.resourceObserver.disconnect();
        this.resourceObserver = null;
        this.loggerTabsText[1] = this.t('logger.tabs.network.stop');
      }

      this.loggerTabsText[3] = this.t('logger.tabs.station.stop');

      // Stop memory monitoring
      if (this.intervalId !== null) {
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.loggerTabsText[0] = this.t('logger.tabs.memory.stop');
      }

      // Keep focus on the active tab
      this.$nextTick(() => {
        if (this.tab !== null) {
          this.initializeObserverForTab(this.tab); 
        } 
      });
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

      this.visibleMemoryData = [];
      this.visibleConsoleData = [];
      this.visibleNetworkData = [];
      this.visibleUsersInStations = [];

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
        const listeners: { type: string; listener: (event: any) => void }[] = []; // To track listeners for this instance

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

        // Add event listeners to track WebSocket events
        const openListener = () => logWebSocketEvent("open", "Connection opened.");
        const messageListener = (event) => logWebSocketEvent("message", event.data);
        const closeListener = () => logWebSocketEvent("close", "Connection closed.");
        const errorListener = () => logWebSocketEvent("error", "Connection error.");

        ws.addEventListener("open", openListener);
        ws.addEventListener("message", messageListener);
        ws.addEventListener("close", closeListener);
        ws.addEventListener("error", errorListener);

        // Save listeners to remove them later
        listeners.push({ type: "open", listener: openListener });
        listeners.push({ type: "message", listener: messageListener });
        listeners.push({ type: "close", listener: closeListener });
        listeners.push({ type: "error", listener: errorListener });

        vueInstance.webSocketInstances.add({ ws, listeners });

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
      if (!this.monitorUsers) return;

      for (const key in this.liveClassProxy.users) {
        const user = this.liveClassProxy.users[key];
        const userRoom = user.room;
        const userRole = user.role; // Exclude stations
        const existingUser = this.usersInStations.find(
          (u) => u.user === key && u.event === "joined"
        );

        if (userRoom.includes("Station") && userRole !== "station") {
          if (existingUser) {
            // User switched stations
            if (existingUser.station !== userRoom) {
              // User left the previous station
              this.usersInStations.push({
                user: key,
                station: existingUser.station,
                date: new Date().toLocaleString(),
                event: "left",
              });
            } else {
              // User is already in the station, no action needed
              continue;
            }
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
          // User left the station
          this.usersInStations.push({
            user: key,
            station: existingUser.station,
            date: new Date().toLocaleString(),
            event: "left",
          });
          this.saveLoggerDataToDB();
        }
      }
    },

    generateChart() {
      const chartDom = document.getElementById("chart");

      if (!chartDom || !chartDom.clientWidth || !chartDom.clientHeight) {
        //debug.components.logger("Chart DOM element not found or has no dimensions.");
        return;
      }

      // Plot the chart based on the visible memory data
      const memoryDataArray = this.isLoggerRunning ? this.memoryData : this.visibleMemoryData;

      if (memoryDataArray.length > 0) {
        const option = {
          xAxis: {
            type: "time",
            name: this.t('logger.tabs.memory.chart.x'),
            nameLocation: "middle",
            nameGap: 25,
            axisLabel: {
              formatter: (value: number) => {
                return new Date(value).toLocaleTimeString();
              },
            },
          },
          yAxis: {
            type: "value",
            name: this.t('logger.tabs.memory.chart.y'),
            nameLocation: "middle",
            nameGap: 55,
            axisLabel: {
              formatter: (value: number) => `${value.toFixed(0)} MB`,
            },
          },
          series: [
            {
              data: memoryDataArray.map((memory: any) => [
                new Date(memory.date),
                memory.usedJSHeapSize,
              ]),
              type: "line",
              smooth: true,
              name: "Used JS Heap Size",
              // Add animation effects
              animation: true,
              animationDuration: 1000,
              animationEasing: "cubicInOut",
              // Add visual enhancement
              lineStyle: {
                width: 3,
                shadowColor: "rgba(0,0,0,0.3)",
                shadowBlur: 10,
              },
              // Add area under the line
              areaStyle: {
                opacity: 0.3,
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: "rgb(116, 21, 219)" },
                  { offset: 1, color: "rgb(55, 162, 255)" },
                ]),
              },
              symbolSize: 8,
            },
          ],
          tooltip: {
            trigger: "axis",
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            borderColor: "#777",
            borderWidth: 1,
            padding: [10, 15],
            textStyle: {
              color: "#333",
            },
            formatter: function (params: any) {
              const data = params[0].data;
              const date = new Date(data[0]);
              const memory = data[1];

              return `
        <div style="font-weight: bold; margin-bottom: 5px;">
          ${date.toLocaleDateString()} ${date.toLocaleTimeString()}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: ${params[0].color};">● </span>
          <span>Memory Usage:</span>
          <span style="font-weight: bold; margin-left: 5px;">
            ${memory.toFixed(1)} MB
          </span>
        </div>
      `;
            },
            axisPointer: {
              type: "cross",
              label: {
                backgroundColor: "#6a7985",
              },
            },
          },
          // Add global animation configuration
          animation: true,
          animationThreshold: 2000,
          animationDuration: 1000,
          animationEasing: "cubicInOut",
          animationDelay: function (idx: number) {
            return idx * 100;
          },
        };

        this.memoryChart?.setOption(option);
        this.memoryChart?.resize();
      } else {
        debug.components.logger("No memory data available to plot the chart.");
      }
    },

    async saveLoggerDataToDB() {
      if (this.isSavingEnabled) {
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
      }
    },

    async loadLoggerDataFromDB() {
      try {
        const stationName = this.stationLogsInput.split(' - ')[0].split(': ')[1];
        const stationDate = this.stationLogsInput.split(' - ')[1].split(': ')[1];

        const data = await this.database.getLogById(
          this.classId + "_Station:" + stationName + "_Date:" + stationDate
        );

        if (data && data.LoggerData) {
          this.clearLogger();

          this.isLogsLoaderVisible = false;
          this.isShowingPrevLogs = true;

          const { consoleData = [], memoryData = [], networkData = [], usersInStations = [] } = data.LoggerData;

          this.consoleData = consoleData;
          this.memoryData = memoryData;
          this.networkData = networkData;
          this.usersInStations = usersInStations;

          // If no data was recorded
          this.loggerTabsText[2] = consoleData.length ? "" : this.t('logger.tabs.console.norecords');
          this.loggerTabsText[0] = memoryData.length ? "" : this.t('logger.tabs.memory.norecords');
          this.loggerTabsText[1] = networkData.length ? "" : this.t('logger.tabs.network.norecords');
          this.loggerTabsText[3] = usersInStations.length ? "" : this.t('logger.tabs.station.norecords');

          // Keep focus on the active tab and generate chart
          this.$nextTick(() => {
            if (this.tab !== null) {
              this.initializeObserverForTab(this.tab); 
            } 

            this.generateChart();
          });
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
    
    // Load more data for infinite scroll
    loadMoreData(arrayName: string) {
      const visibleArrayName = `visible${arrayName.charAt(0).toUpperCase() + arrayName.slice(1)}`;
      const array = this[arrayName];
      const visibleArray = this[visibleArrayName];

      const nextItems = array.slice(visibleArray.length, visibleArray.length + 20); // Load 20 items at a time
      this[visibleArrayName].push(...nextItems);

      // Regenerate chart if memory data is being loaded
      if (visibleArrayName === "visibleMemoryData") {
        this.$nextTick(this.generateChart);
      }
    },

    // Initialize IntersectionObserver for infinite scroll
    initializeObserverForTab(activeTab) {
      const sentinelRefMap = {
        memory: "memorySentinel",
        network: "networkSentinel",
        console: "consoleSentinel",
        station: "usersSentinel",
      };

      const arrayMap = {
        memory: "memoryData",
        network: "networkData",
        console: "consoleData",
        station: "usersInStations",
      };

      const sentinelRef = sentinelRefMap[activeTab];
      const arrayName = arrayMap[activeTab];

      if (sentinelRef && arrayName) {
        this.$nextTick(() => {
          const sentinel = this.$refs[sentinelRef];

          if (sentinel) {
            const observer = new IntersectionObserver(
              ([entry]) => {
                if (entry.isIntersecting) {
                  this.loadMoreData(arrayName);
                }
              },
              { threshold: 1.0 }
            );
            observer.observe(sentinel);
          } else {
            debug.components.logger(`Sentinel '${sentinelRef}' is not yet available.`);
          }
        });
      }
    },
  },
};
</script>

<template>
  <v-card>
    <v-toolbar dark flat>
      <v-toolbar-title>{{ t('logger.title') }}</v-toolbar-title>

      <div id="header_text_container">
        <div id="recording_text" v-if="isLoggerRunning">
          {{ t('logger.recording') }}
          <div class="circles">
            <div class="circle1"></div>
            <div class="circle2"></div>
            <div class="circle3"></div>
          </div>
        </div>

        <div v-if="isShowingPrevLogs">
          {{ !isLogsLoaderVisible ? t('logger.showingLogs') + ' ' + stationLogsInput : '' }}
        </div>
      </div>

      <v-spacer></v-spacer>

      <v-menu :close-on-content-click="false">
        <template v-slot:activator="{ props }">
          <v-btn icon v-bind="props" :disabled="isLoggerRunning">
            <v-icon>mdi-format-list-checkbox</v-icon>
            <v-tooltip activator="parent" location="bottom">{{ t('logger.dataOptions') }}</v-tooltip>
          </v-btn>
        </template>

        <v-list>
          <v-list-item max-height="1">
            <v-checkbox v-model="monitorMemory" :label="t('logger.options.memory')"></v-checkbox>
          </v-list-item>
          <v-list-item max-height="1">
            <v-checkbox v-model="monitorNetwork" :label="t('logger.options.network')"></v-checkbox>
          </v-list-item>
          <v-list-item max-height="1">
            <v-checkbox v-model="monitorConsole" :label="t('logger.options.console')"></v-checkbox>
          </v-list-item>
          <v-list-item max-height="1">
            <v-checkbox v-model="monitorUsers" :label="t('logger.options.station')"></v-checkbox>
          </v-list-item>
        </v-list>
      </v-menu>

      <v-tooltip :text="t('logger.minimize')" location="bottom">
        <template v-slot:activator="{ props }">
          <v-btn v-bind="props" icon="mdi-minus" @click="$emit('minimize')"></v-btn>
        </template>
      </v-tooltip>

      <v-tooltip :text="t('logger.close')" location="bottom">
        <template v-slot:activator="{ props }">
          <v-btn v-bind="props" icon="mdi-close" @click="isClosingDialogVisible = true"></v-btn>
        </template>
      </v-tooltip>
    </v-toolbar>

    <div class="btns-container">
      <v-btn variant="flat" @click="startOrStopLogger" :style="{ backgroundColor: isLoggerRunning ? '#cd202c' : '#5ccc48' }">
        {{ isLoggerRunning ? t('logger.actions.stop') : t('logger.actions.start') }}
      </v-btn>

      <v-btn variant="outlined" @click="loadLogs" :disabled="isLoggerRunning">
        {{ t('logger.actions.load') }}
      </v-btn>

      <v-btn variant="outlined" @click="clearLogger" :disabled="isLoggerRunning">
        {{ t('logger.actions.clear') }}
      </v-btn>
    </div>

    <div class="tabs-container">
      <v-tabs align-tabs="center" v-model="tab" bg-color="grey-lighten-4" fixed-tabs>
        <v-tab value="memory" v-if="monitorMemory">{{ t('logger.tabs.memory.title') }}</v-tab>
        <v-tab value="network" v-if="monitorNetwork">{{ t('logger.tabs.network.title') }}</v-tab>
        <v-tab value="console" v-if="monitorConsole">{{ t('logger.tabs.console.title') }}</v-tab>
        <v-tab value="station" v-if="monitorUsers">{{ t('logger.tabs.station.title') }}</v-tab>
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
                  <v-toolbar-title>{{ t('logger.tabs.memory.chartTitle') }}</v-toolbar-title>

                  <v-spacer></v-spacer>

                  <v-btn icon @click="generateChart">
                    <v-icon>mdi-refresh</v-icon>
                    <v-tooltip activator="parent" location="bottom"
                      >{{ t('logger.tabs.memory.refreshChart') }}</v-tooltip
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

            <div v-for="(data, index) in isLoggerRunning ? memoryData : visibleMemoryData" :key="index">
              <span id="log-date">{{ data.date }}</span>
              <span id="log-title"> - {{ t('logger.tabs.memory.usedJSHeapSize') }}:</span>
              {{ data.usedJSHeapSize }} MB
              <span id="log-title"> - {{ t('logger.tabs.memory.totalJSHeapSize') }}:</span>
              {{ data.totalJSHeapSize }} MB
              <span id="log-title"> - {{ t('logger.tabs.memory.jsHeapSizeLimit') }}:</span>
              {{ data.jsHeapSizeLimit }} MB
            </div>
            <div ref="memorySentinel"></div>
          </div>
        </v-tabs-window-item>

        <v-tabs-window-item value="network" v-if="monitorNetwork">
          <div v-if="networkData.length">
            <div v-for="(data, index) in isLoggerRunning ? networkData : visibleNetworkData" :key="index">
              <span id="log-date">{{ data.date }}</span>
              <span id="log-title"> - {{ data.type.toLocaleUpperCase() }}: </span>
              <span v-if="data.type === 'fetch'">
                <span id="log-subtitle">{{ t('logger.tabs.network.request') }}:</span> {{ data.request }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.response') }}:</span> {{ data.response }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.status') }}:</span> {{ data.status }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.options') }}:</span> {{ data.options }}
              </span>
              <span v-else-if="data.type === 'xhr'">
                <span id="log-subtitle">{{ t('logger.tabs.network.request') }}:</span> {{ data.method }} {{ data.url }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.response') }}:</span> {{ data.response }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.status') }}:</span> {{ data.status }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.options') }}:</span> {{ data.options }}
              </span>
              <span v-else-if="data.type === 'ws'">
                <span id="log-subtitle">{{ t('logger.tabs.network.event') }}:</span> {{ data.eventType }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.request') }}:</span> {{ data.request }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.response') }}:</span> {{ data.response }}
              </span>
              <span v-else-if="data.type === 'resource'">
                <span id="log-subtitle">{{ t('logger.tabs.network.type') }}:</span> {{ data.eventType }} -
                <span id="log-subtitle">{{ t('logger.tabs.network.url') }}:</span> {{ data.url }}
              </span>
            </div>
          </div>
          <div v-else>
            <p>{{ loggerTabsText[1] }}</p>
          </div>
          <div ref="networkSentinel"></div>
        </v-tabs-window-item>

        <v-tabs-window-item value="console" v-if="monitorConsole">
          <div v-if="consoleData.length">
            <div v-for="(data, index) in isLoggerRunning ? consoleData : visibleConsoleData" :key="index">
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
          <div ref="consoleSentinel"></div>
        </v-tabs-window-item>

        <v-tabs-window-item value="station" v-if="monitorUsers">
          <div v-if="usersInStations.length">
            <div v-for="(data, index) in isLoggerRunning ? usersInStations : visibleUsersInStations" :key="index">
              <span id="log-date">{{ data.date }}</span>
              <span id="log-title"> - {{ t('logger.tabs.station.user') }}:</span> {{ data.user }}
              <span id="log-title"> - {{ t('logger.tabs.station.event') }}:</span> {{ data.event }}
              <span id="log-title"> - {{ t('logger.tabs.station.station') }}:</span> {{ data.station }}
            </div>
          </div>
          <div v-else>
            <p>{{ loggerTabsText[3] }}</p>
          </div>
          <div ref="usersSentinel"></div>
        </v-tabs-window-item>
      </v-tabs-window>
    </v-card-text>

    <v-dialog v-model="isClosingDialogVisible" max-width="800">
      <v-card>
        <v-toolbar dark flat>
          <v-toolbar-title>{{ t('logger.closeDialog.title') }}</v-toolbar-title>
        </v-toolbar>
        <v-card-actions>
          <v-btn variant="outlined" color="grey-darken-4" @click="isClosingDialogVisible = false">
            {{ t('logger.closeDialog.cancel') }}
          </v-btn>
          <v-btn variant="flat" color="grey-darken-4" @click="$emit('close')">
            {{ t('logger.closeDialog.confirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="isLogsLoaderVisible" max-width="450" persistent>
      <v-card>
        <v-toolbar dark flat>
          <v-toolbar-title>{{ t('logger.loadPrevious') }}</v-toolbar-title>
        </v-toolbar>

        <v-card-text>
          <v-select
            v-model="stationLogsInput"
            :items="classroomPastStations"
            :label="t('logger.stationName')"
          ></v-select>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions>
          <v-btn variant="outlined" color="grey-darken-4" @click="isLogsLoaderVisible = false">
            {{ t('logger.closeDialog.cancel') }}
          </v-btn>
          <v-btn variant="flat" color="grey-darken-4" @click="stationLogsInput && loadLoggerDataFromDB()">
            {{ t('logger.actions.load') }}
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
      0 -1px 1px 0 0 #5ccc48;
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
