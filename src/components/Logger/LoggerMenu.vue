<script lang="ts">

export default {
  name: "LoggerMenu",

  props: {
    showLogger: {
      type: Boolean,
      required: true,
    },
  },

  data() {
    return {
      
    };
  },
  
  methods: {
    startLogger() {
      console.log("Logger started");
      this.$emit("update:showLogger", true);
    },
    stopLogger() {
      console.log("Logger stopped");
    },
    loadLogger() {
      console.log("Logger loaded");
    },
  },
};
</script>


<template>
    <v-menu>
        <template v-slot:activator="{ props }">
            <v-btn
                v-bind="props"
            >
            <v-icon>mdi-console</v-icon>
            <v-tooltip
                activator="parent"
                location="bottom"
            >Logger</v-tooltip>
            </v-btn>
        </template>
        
        <v-list>
            <v-list-item>
                <v-btn 
                    block
                    variant="outlined"
                    @click="startLogger" 
                >
                    Start
                </v-btn>
            </v-list-item>
            <v-list-item>
                <v-btn 
                    block
                    variant="outlined"
                    @click="stopLogger"
                >
                    Stop
                </v-btn>
            </v-list-item>
            <v-list-item>
                <v-btn 
                    block
                    variant="outlined"
                    @click="loadLogger"
                >
                    Load
                </v-btn>
            </v-list-item>
        </v-list>
    </v-menu>
</template>