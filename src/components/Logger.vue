<script lang="ts">

declare global {
    interface Performance {
        memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
        };
    }
}

export default {
    name: "Logger",


    data() {
        return {
            memoryData: [] as {
                date: Date;
                usedJSHeapSize: string;
                totalJSHeapSize: string;
                jsHeapSizeLimit: string;
            }[],

            intervalId: null as number | null,
        };
    },

    methods: {
        startLogger() {
            console.log("Logger started");
            this.intervalId = setInterval(() => {
                this.measureMemory();
            }, 5000);
        },
        stopLogger() {
            console.log("Logger stopped");
            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
        },
        loadLogger() {
            console.log("Logger loaded");
        },
        clearLogger() {
            console.log("Logger cleared");
            this.memoryData = [];
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

        <v-card-text>
            <div v-if="memoryData.length">
                <div v-for="(data, index) in memoryData" :key="index">
                    <p><strong>Date:</strong> {{ data.date.toLocaleTimeString() }}</p>
                    <p><strong>Used JS Heap Size:</strong> {{ data.usedJSHeapSize }} MB</p>
                    <p><strong>Total JS Heap Size:</strong> {{ data.totalJSHeapSize }} MB</p>
                    <p><strong>JS Heap Size Limit:</strong> {{ data.jsHeapSizeLimit }} MB</p>
                </div>
            </div>
            <div v-else>
                <p>Click Start to monitor memory usage, or load existing logs.</p>
            </div>
        </v-card-text>
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
</style>