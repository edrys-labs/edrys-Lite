<template>
  <v-card>
    <v-toolbar>
      <v-toolbar-title>
        {{ t("settings.modules.moduleConfig.title") }} - {{ moduleName }}
      </v-toolbar-title>
      <v-btn icon @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </v-toolbar>

    <v-card-text v-if="!hasAnySchema">
      <v-alert type="info" variant="tonal" color="red-darken-1">
        {{ t("settings.modules.moduleConfig.noSchema") }}
      </v-alert>
    </v-card-text>

    <template v-else>
      <v-tabs
        v-model="activeTab"
        bg-color="surface-variant"
        align-tabs="center"
      >
        <v-tab v-if="configSchemas.config" value="config">
          {{ t("settings.modules.module.generalSettings") }}
        </v-tab>
        <v-tab v-if="configSchemas.teacherConfig" value="teacherConfig">
          {{ t("settings.modules.module.teacherSettings") }}
        </v-tab>
        <v-tab v-if="configSchemas.studentConfig" value="studentConfig">
          {{ t("settings.modules.module.studentSettings") }}
        </v-tab>
        <v-tab v-if="configSchemas.stationConfig" value="stationConfig">
          {{ t("settings.modules.module.stationSettings") }}
        </v-tab>
      </v-tabs>

      <v-card-text class="mt-2">
        <v-window v-model="activeTab">
          <v-window-item
            v-for="(schema, configType) in configSchemas"
            :key="configType"
            :value="configType"
          >
            <v-form @submit.prevent>
              <div v-for="(fieldConfig, field) in schema" :key="field">
                <!-- Boolean fields (checkboxes) -->
                <v-checkbox
                  v-if="fieldConfig.type === 'boolean'"
                  v-model="formValues[configType][field]"
                  :label="field"
                  :disabled="writeProtection"
                  :hint="fieldConfig.hint"
                  color="primary"
                  density="compact"
                  class="config-checkbox"
                ></v-checkbox>

                <!-- Radio Button fields -->
                <div v-else-if="fieldConfig.type === 'radio-button'">
                  <v-radio-group
                    v-model="formValues[configType][field]"
                    :label="field"
                    :disabled="writeProtection"
                    :hint="fieldConfig.hint"
                    density="compact"
                    inline
                  >
                    <v-radio
                      v-for="option in fieldConfig.options"
                      :key="option"
                      :label="option"
                      :value="option"
                      color="primary"
                      density="compact"
                      class="mr-3"
                    ></v-radio>
                  </v-radio-group>
                </div>

                <!-- Number fields -->
                <v-text-field
                  v-else-if="fieldConfig.type === 'number'"
                  v-model.number="formValues[configType][field]"
                  :label="field"
                  type="number"
                  variant="outlined"
                  :disabled="writeProtection"
                  :hint="fieldConfig.hint"
                  density="compact"
                  class="mt-3"
                  max-width="200px"
                ></v-text-field>

                <!-- Text area fields -->
                <v-textarea
                  v-else-if="fieldConfig.type === 'text-area'"
                  v-model="formValues[configType][field]"
                  :label="field"
                  variant="outlined"
                  :disabled="writeProtection"
                  :hint="fieldConfig.hint"
                  rows="5"
                  no-resize
                  class="mt-3"
                ></v-textarea>

                <!-- Date fields -->
                <v-text-field
                  v-else-if="fieldConfig.type === 'date'"
                  v-model="formValues[configType][field]"
                  :label="field"
                  type="date"
                  variant="outlined"
                  :disabled="writeProtection"
                  :hint="fieldConfig.hint"
                  density="compact"
                  class="mt-3"
                  max-width="200px"
                ></v-text-field>

                <!-- Color picker fields -->
                <div v-else-if="fieldConfig.type === 'color'" class="pl-1">
                  <div class="mb-2 custom-label">{{ field }}</div>
                  <div class="d-flex align-center">
                    <v-color-picker
                      v-model="formValues[configType][field]"
                      :disabled="writeProtection"
                      hide-inputs
                      mode="hex"
                      canvas-height="50%"
                      class="color-picker-compact"
                    ></v-color-picker>
                    <div class="ml-4">
                      <div class="color-value mb-1">
                        {{ formValues[configType][field] || "#000000" }}
                      </div>
                      <div
                        v-if="fieldConfig.hint"
                        class="text-caption text-grey"
                      >
                        {{ fieldConfig.hint }}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- String fields -->
                <v-text-field
                  v-else
                  v-model="formValues[configType][field]"
                  :label="field"
                  variant="outlined"
                  :disabled="writeProtection"
                  :hint="fieldConfig.hint"
                  density="compact"
                  class="mt-3"
                ></v-text-field>
              </div>
            </v-form>
          </v-window-item>
        </v-window>
      </v-card-text>
    </template>

    <v-divider></v-divider>
    <v-card-actions>
      <v-btn variant="outlined" color="grey-darken-4" @click="$emit('close')">
        {{ t("settings.modules.moduleConfig.cancel") }}
      </v-btn>
      <v-btn
        variant="flat"
        color="grey-darken-4"
        @click="saveConfig"
        :disabled="writeProtection"
      >
        {{ t("settings.modules.moduleConfig.save") }}
        <v-badge
          v-if="hasChanges"
          color="red"
          dot
          style="position: absolute; top: 0; right: 0"
        ></v-badge>
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts">
import { useI18n } from "vue-i18n";
import { parse } from "../../ts/Utils";

export default {
  name: "ModuleConfigForm",

  props: {
    moduleName: {
      type: String,
      required: true,
    },
    moduleConfig: {
      type: String,
      required: false,
      default: "",
    },

    currentConfig: {
      type: [String, Object],
      required: false,
      default: "",
    },

    currentStudentConfig: {
      type: [String, Object],
      required: false,
      default: "",
    },

    currentTeacherConfig: {
      type: [String, Object],
      required: false,
      default: "",
    },

    currentStationConfig: {
      type: [String, Object],
      required: false,
      default: "",
    },

    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  setup() {
    const { t } = useI18n();
    return { t };
  },

  data() {
    return {
      configSchemas: {
        config: null,
        studentConfig: null,
        teacherConfig: null,
        stationConfig: null,
      },
      formValues: {
        config: {},
        studentConfig: {},
        teacherConfig: {},
        stationConfig: {},
      },
      activeTab: null,
      originalValues: {
        config: {},
        studentConfig: {},
        teacherConfig: {},
        stationConfig: {},
      },
    };
  },

  computed: {
    hasAnySchema() {
      return Object.values(this.configSchemas).some(
        (schema) => schema !== null
      );
    },

    hasChanges() {
      for (const configType in this.formValues) {
        if (!this.configSchemas[configType]) continue;

        const formObj = this.formValues[configType];
        const origObj = this.originalValues[configType];

        // Check if there are any differences
        for (const key in formObj) {
          if (JSON.stringify(formObj[key]) !== JSON.stringify(origObj[key])) {
            return true;
          }
        }
      }
      return false;
    },
  },

  created() {
    this.parseModuleConfig();

    // Set the initial active tab to the first available tab
    const firstAvailableTab = Object.keys(this.configSchemas).find(
      (key) => this.configSchemas[key] !== null
    );
    if (firstAvailableTab) {
      this.activeTab = firstAvailableTab;
    }
  },

  methods: {
    // Helper method to safely parse configuration values
    parseConfigValue(value) {
      try {
        if (!value) return {};

        // Handle different types of values
        if (typeof value === "string") {
          return value.trim() !== "" ? parse(value) : {};
        } else if (typeof value === "object") {
          return value;
        }
        return {};
      } catch (e) {
        console.error("Failed to parse configuration value:", e);
        return {};
      }
    },

    parseModuleConfig() {
      try {
        if (this.moduleConfig && this.moduleConfig.trim() !== "") {
          // Parse schema from module metadata
          const parsedConfig = parse(this.moduleConfig);

          const configTypes = [
            "config",
            "studentConfig",
            "teacherConfig",
            "stationConfig",
          ];

          configTypes.forEach((configType) => {
            if (parsedConfig[configType]) {
              this.configSchemas[configType] = parsedConfig[configType];

              // Initialize form values for this config type
              const initialValues = {};
              for (const key in parsedConfig[configType]) {
                const fieldConfig = parsedConfig[configType][key];

                // Set default values based on type
                switch (fieldConfig.type) {
                  case "boolean":
                    initialValues[key] = false;
                    break;
                  case "number":
                    initialValues[key] = 0;
                    break;
                  case "text-area":
                    initialValues[key] = "";
                    break;
                  case "radio-button":
                    initialValues[key] =
                      Array.isArray(fieldConfig.options) &&
                      fieldConfig.options.length > 0
                        ? fieldConfig.options[0]
                        : "";
                    break;
                  case "date":
                    initialValues[key] = new Date().toISOString().split("T")[0];
                    break;
                  case "color":
                    initialValues[key] = "#000000";
                    break;
                  default:
                    initialValues[key] = "";
                    break;
                }
              }

              // Get the current configuration value
              let currentConfigValue;
              if (configType === "config") {
                currentConfigValue = this.currentConfig;
              } else if (configType === "studentConfig") {
                currentConfigValue = this.currentStudentConfig;
              } else if (configType === "teacherConfig") {
                currentConfigValue = this.currentTeacherConfig;
              } else if (configType === "stationConfig") {
                currentConfigValue = this.currentStationConfig;
              }

              // Parse the current configuration and merge with initial values
              const parsedValues = this.parseConfigValue(currentConfigValue);
              this.formValues[configType] = {
                ...initialValues,
                ...parsedValues,
              };

              // Store a deep copy of the initial values for comparison
              this.originalValues[configType] = JSON.parse(
                JSON.stringify(this.formValues[configType])
              );
            }
          });
        }
      } catch (e) {
        console.error("Failed to parse module configuration schema:", e);
        this.configSchemas = {
          config: null,
          studentConfig: null,
          teacherConfig: null,
          stationConfig: null,
        };
      }
    },

    saveConfig() {
      // Emit events for each config type that has values 
      const configResult = {};

      Object.keys(this.configSchemas).forEach((configType) => {
        if (
          this.configSchemas[configType] &&
          Object.keys(this.formValues[configType]).length > 0
        ) {
          configResult[configType] = this.formValues[configType];
        }
      });

      this.$emit("save", configResult);
      this.$emit("close");
    },
  },
};
</script>

<style scoped>
.config-checkbox {
  margin-top: 0;
  padding-top: 0;
  margin-bottom: 0;
}

.config-checkbox :deep(.v-selection-control) {
  margin-bottom: -12px;
}

.config-checkbox :deep(.v-label) {
  opacity: 1;
}

.config-checkbox :deep(.v-messages) {
  min-height: 14px;
  padding-top: 0;
  margin-top: -4px;
}

.v-radio-group :deep(.v-selection-control) {
  margin-bottom: -8px;
}

.v-radio :deep(.v-label) {
  opacity: 1;
}

.color-picker-compact :deep(.v-color-picker__controls) {
  padding: 5px;
}

.color-value {
  font-family: monospace;
  font-size: 14px;
}

.custom-label {
  font-size: 14px;
  opacity: 0.7;
}
</style>
