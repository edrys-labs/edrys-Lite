<template>
  <v-expansion-panels variant="accordion" style="min-width: 400px">
    <!-- URL Panel -->
    <v-expansion-panel>
      <v-expansion-panel-title>
        URL
        <template v-slot:actions>
          <v-icon> mdi-link </v-icon>
        </template>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-text-field
          variant="underlined"
          label="Module URL"
          v-model="module.url"
          :disabled="writeProtection"
        ></v-text-field>
      </v-expansion-panel-text>
    </v-expansion-panel>

    <!-- Design Panel -->
    <v-expansion-panel>
      <v-expansion-panel-title>
        Design
        <template v-slot:actions>
          <v-icon> mdi-pencil-ruler </v-icon>
        </template>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-row>
          <!-- Width Configuration -->
          <v-col cols="6">
            <v-container fluid>
              <p>Width</p>
              <v-radio-group v-model="widthSelection" :disabled="writeProtection">
                <v-radio label="Full (1000px)" value="full"></v-radio>
                <v-radio label="Half (500px)" value="half"></v-radio>
                <v-radio label="Quarter (250px)" value="third"></v-radio>
                <v-radio label="Custom (px)" value="custom"></v-radio>
              </v-radio-group>
              <!-- Conditional Input for Custom Width -->
              <v-text-field
                v-if="widthSelection === 'custom'"
                variant="underlined"
                label="Custom Width (px)"
                v-model.number="customWidth"
                :disabled="writeProtection"
                type="number"
                min="1"
                hint="Enter custom width in pixels"
                persistent-hint
              ></v-text-field>
            </v-container>
          </v-col>

          <!-- Height Configuration -->
          <v-col cols="6">
            <v-container fluid>
              <p>Height</p>
              <v-radio-group v-model="heightSelection" :disabled="writeProtection">
                <v-radio label="HUGE (830px)" value="huge"></v-radio>
                <v-radio label="Tall (720px)" value="tall"></v-radio>
                <v-radio label="Medium (410px)" value="medium"></v-radio>
                <v-radio label="Short (200px)" value="short"></v-radio>
                <v-radio label="Custom (px)" value="custom"></v-radio>
              </v-radio-group>
              <!-- Conditional Input for Custom Height -->
              <v-text-field
                v-if="heightSelection === 'custom'"
                variant="underlined"
                label="Custom Height (px)"
                v-model.number="customHeight"
                :disabled="writeProtection"
                type="number"
                min="1"
                hint="Enter custom height in pixels"
                persistent-hint
              ></v-text-field>
            </v-container>
          </v-col>
        </v-row>
      </v-expansion-panel-text>
    </v-expansion-panel>

    <!-- Editor Components -->
    <Editor
      title="General settings"
      icon="mdi-script-text"
      v-model:config="module.config"
      v-model:error="error.config"
      :writeProtection="writeProtection"
    ></Editor>

    <Editor
      title="Student settings"
      icon="mdi-account-circle-outline"
      v-model:config="module.studentConfig"
      v-model:error="error.studentConfig"
      :writeProtection="writeProtection"
    ></Editor>

    <Editor
      title="Teacher settings"
      icon="mdi-clipboard-account-outline"
      v-model:config="module.teacherConfig"
      v-model:error="error.teacherConfig"
      :writeProtection="writeProtection"
    ></Editor>

    <Editor
      title="Station settings"
      icon="mdi-router-wireless"
      v-model:config="module.stationConfig"
      v-model:error="error.stationConfig"
      :writeProtection="writeProtection"
    ></Editor>

    <!-- Show In Panel -->
    <v-expansion-panel>
      <v-expansion-panel-title>
        Show in
        <template v-slot:actions>
          <v-icon> mdi-eye </v-icon>
        </template>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-text-field
          variant="underlined"
          label="Comma separated list of rooms, or: lobby, * for all, teacher-only, station"
          v-model="module.showInCustom"
          :disabled="writeProtection"
        ></v-text-field>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script lang="ts">
import Editor from "./Editor.vue";

export default {
  name: "Settings-Module",

  props: {
    module: {
      type: Object,
      required: true,
    },
    error: {
      type: Object,
      required: true,
    },
    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  data() {
    // Initialize customWidth based on module.width
    let customWidth: number | null = null;
    let customHeight: number | null = null;

    if (!["full", "half", "third"].includes(this.module.width)) {
      customWidth = typeof this.module.width === "number" ? this.module.width : 100; // Default custom width
    }

    if (!["huge", "tall", "medium", "short"].includes(this.module.height)) {
      customHeight = typeof this.module.height === "number" ? this.module.height : 100; // Default custom height
    }

    if (!this.module.showInCustom) {
      this.module.showInCustom = "*";
    }

    return { customWidth, customHeight };
  },

  computed: {
    // Computed property for Width Selection
    widthSelection: {
      get() {
        if (["full", "half", "third"].includes(this.module.width)) {
          return this.module.width;
        } else if (
          typeof this.module.width === "number" ||
          this.module.width === "custom"
        ) {
          return "custom";
        } else {
          // Fallback to 'full' if module.width has an unexpected value
          return "full";
        }
      },
      set(value: string) {
        if (value === "custom") {
          // Set module.width to the current customWidth or default
          this.module.width = this.customWidth || 100;
        } else {
          this.module.width = value;
        }
      },
    },

    // Computed property for Height Selection
    heightSelection: {
      get() {
        if (["huge", "tall", "medium", "short"].includes(this.module.height)) {
          return this.module.height;
        } else if (
          typeof this.module.height === "number" ||
          this.module.height === "custom"
        ) {
          return "custom";
        } else {
          // Fallback to 'tall' if module.height has an unexpected value
          return "tall";
        }
      },
      set(value: string) {
        if (value === "custom") {
          // Set module.height to the current customHeight or default
          this.module.height = this.customHeight || 100;
        } else {
          this.module.height = value;
        }
      },
    },
  },

  watch: {
    error: {
      handler() {
        this.$emit("update:error", this.error);
      },
      deep: true,
    },

    // Watcher for customWidth
    customWidth(newVal: number | null) {
      if (this.widthSelection === "custom" && newVal !== null) {
        this.module.width = newVal;
      }
    },

    // Watcher for module.width
    "module.width"(newVal: any) {
      if (["full", "half", "third"].includes(newVal)) {
        // Clear customWidth when a predefined option is selected
        this.customWidth = null;
      } else if (typeof newVal === "number") {
        // Update customWidth when a number is set programmatically
        this.customWidth = newVal;
      }
    },

    // Watcher for customHeight
    customHeight(newVal: number | null) {
      if (this.heightSelection === "custom" && newVal !== null) {
        this.module.height = newVal;
      }
    },

    // Watcher for module.height
    "module.height"(newVal: any) {
      if (["huge", "tall", "medium", "short"].includes(newVal)) {
        // Clear customHeight when a predefined option is selected
        this.customHeight = null;
      } else if (typeof newVal === "number") {
        // Update customHeight when a number is set programmatically
        this.customHeight = newVal;
      }
    },
  },

  mounted() {
    // Ensure customWidth is set if module.width is a number
    if (typeof this.module.width === "number") {
      this.customWidth = this.module.width;
    }

    // Ensure customHeight is set if module.height is a number
    if (typeof this.module.height === "number") {
      this.customHeight = this.module.height;
    }
  },

  components: { Editor },
};
</script>
