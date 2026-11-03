<template>
  <v-card :flat="!standalone" :elevation="standalone ? undefined : 0">
    <v-toolbar v-if="standalone">
      <v-toolbar-title>
        {{ t("settings.modules.moduleConfig.title") }} - {{ moduleName }}
      </v-toolbar-title>
      <v-btn icon @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </v-toolbar>

    <v-card-text v-if="!hasAnySchema">
      <v-alert color="info" icon="mdi-information-outline">
        {{ t("settings.modules.moduleConfig.noSchema") }}
      </v-alert>
    </v-card-text>

    <template v-else>
      <!-- A single config type is a heading, not a one-tab bar -->
      <div v-if="configTypes.length === 1" class="config-heading">
        <v-icon :icon="tabIcon(configTypes[0])" size="17"></v-icon>
        <span>{{ tabLabel(configTypes[0]) }}</span>
      </div>
      <div v-else class="config-tabs">
        <v-tabs v-model="activeTab" slider-color="primary" height="40" show-arrows>
          <v-tab
            v-for="configType in configTypes"
            :key="configType"
            :value="configType"
            :prepend-icon="tabIcon(configType)"
          >
            {{ tabLabel(configType) }}
          </v-tab>
        </v-tabs>
      </div>

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
                  :label="fieldLabel(field, fieldConfig)"
                  :hint="fieldConfig.hint"
                  :hide-details="!fieldConfig.hint"
                  persistent-hint
                  color="primary"
                  density="compact"
                  class="config-checkbox"
                ></v-checkbox>

                <!-- Checkbox group fields -->
                <div v-else-if="fieldConfig.type === 'checkboxes'" class="mt-3">
                  <div class="mb-1 field-label">{{ fieldLabel(field, fieldConfig) }}</div>
                  <div>
                    <v-checkbox
                      v-for="option in fieldConfig.options"
                      :key="option"
                      v-model="formValues[configType][field][option]"
                      :label="option"
                      hide-details
                      color="primary"
                      density="compact"
                      class="config-checkbox"
                    ></v-checkbox>
                  </div>
                  <div v-if="fieldConfig.hint" class="text-caption text-grey mt-1">
                    {{ fieldConfig.hint }}
                  </div>
                </div>

                <!-- Radio Button fields -->
                <div v-else-if="fieldConfig.type === 'radio-button'" class="mt-3">
                  <div class="mb-1 field-label">{{ fieldLabel(field, fieldConfig) }}</div>
                  <v-radio-group
                    v-model="formValues[configType][field]"
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
                      class="me-3"
                    ></v-radio>
                  </v-radio-group>
                </div>

                <!-- Select fields (fixed list of options) -->
                <FieldLabel
                  v-else-if="fieldConfig.type === 'select'"
                  :label="fieldLabel(field, fieldConfig)"
                  class="mt-3"
                >
                  <v-select
                    v-model="formValues[configType][field]"
                    :items="fieldConfig.options || []"
                    :hint="fieldConfig.hint"
                    persistent-hint
                    clearable
                    density="compact"
                    @update:modelValue="
                      applyPreset(configType, field, fieldConfig, $event)
                    "
                  ></v-select>
                  <div v-if="fieldConfig.presets" class="preset-note mt-1">
                    <v-icon size="14">mdi-alert-circle-outline</v-icon>
                    {{ t("settings.modules.moduleConfig.presetHint") }}
                  </div>
                </FieldLabel>

                <!-- Combobox fields (suggestions, but free text is allowed) -->
                <FieldLabel
                  v-else-if="fieldConfig.type === 'combobox'"
                  :label="fieldLabel(field, fieldConfig)"
                  class="mt-3"
                >
                  <v-combobox
                    v-model="formValues[configType][field]"
                    :items="fieldOptions(configType, field, fieldConfig)"
                    :hint="fieldConfig.hint"
                    persistent-hint
                    clearable
                  ></v-combobox>
                </FieldLabel>

                <!-- Number fields -->
                <FieldLabel
                  v-else-if="fieldConfig.type === 'number'"
                  :label="fieldLabel(field, fieldConfig)"
                  class="mt-3"
                >
                  <v-text-field
                    v-model.number="formValues[configType][field]"
                    type="number"
                    :hint="fieldConfig.hint"
                    max-width="200px"
                  ></v-text-field>
                </FieldLabel>

                <!-- Text area fields -->
                <FieldLabel
                  v-else-if="fieldConfig.type === 'text-area'"
                  :label="fieldLabel(field, fieldConfig)"
                  class="mt-3"
                >
                  <v-textarea
                    v-model="formValues[configType][field]"
                    :hint="fieldConfig.hint"
                    rows="5"
                  ></v-textarea>
                </FieldLabel>

                <!-- Date fields -->
                <FieldLabel
                  v-else-if="fieldConfig.type === 'date'"
                  :label="fieldLabel(field, fieldConfig)"
                  class="mt-3"
                >
                  <v-text-field
                    v-model="formValues[configType][field]"
                    type="date"
                    :hint="fieldConfig.hint"
                    max-width="200px"
                  ></v-text-field>
                </FieldLabel>

                <!-- Color picker fields -->
                <div v-else-if="fieldConfig.type === 'color'" class="pl-1">
                  <div class="mb-2 field-label">{{ fieldLabel(field, fieldConfig) }}</div>
                  <div class="d-flex align-center">
                    <v-color-picker
                      v-model="formValues[configType][field]"
                      hide-inputs
                      mode="hex"
                      canvas-height="50%"
                      class="color-picker-compact"
                    ></v-color-picker>
                    <div class="ms-4">
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

                <!-- Code editor fields -->
                <div v-else-if="fieldConfig.type === 'code-area'" class="mt-3">
                  <div class="mb-2 field-label">{{ fieldLabel(field, fieldConfig) }}</div>
                  <div class="code-editor-container">
                    <prism-editor
                      v-model="formValues[configType][field]"
                      :highlight="highlighter"
                    ></prism-editor>
                  </div>
                  <div
                    v-if="fieldConfig.hint"
                    class="text-caption text-grey"
                    style="margin-top: 5px"
                  >
                    {{ fieldConfig.hint }}
                  </div>
                </div>

                <!-- String fields -->
                <FieldLabel v-else :label="fieldLabel(field, fieldConfig)" class="mt-3">
                  <v-text-field
                    v-model="formValues[configType][field]"
                    :hint="fieldConfig.hint"
                  ></v-text-field>
                </FieldLabel>
              </div>
            </v-form>
          </v-window-item>
        </v-window>
      </v-card-text>
    </template>

    <template v-if="standalone">
      <v-divider></v-divider>
      <v-card-actions>
        <v-btn variant="outlined" color="grey-darken-4" @click="$emit('close')">
          {{ t("settings.modules.moduleConfig.cancel") }}
        </v-btn>
        <v-btn
          variant="flat"
          color="grey-darken-4"
          @click="saveConfig"
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
    </template>
  </v-card>
</template>

<script lang="ts">
import { useI18n } from "vue-i18n";
import { parse } from "../../ts/Utils";
import { inject } from "vue";
import FieldLabel from "../FieldLabel.vue";

const TAB_ICONS: Record<string, string> = {
  config: "mdi-tune-variant",
  studentConfig: "mdi-account-outline",
  teacherConfig: "mdi-school-outline",
  stationConfig: "mdi-router-wireless",
};

export default {
  name: "ModuleConfigForm",
  components: { FieldLabel },

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

    standalone: {
      type: Boolean,
      default: true,
    },
  },

  setup() {
    const { t } = useI18n();
    const prismHighlight = inject("prismHighlight");
    const prismLanguages = inject("prismLanguages");
    
    return { t, prismHighlight, prismLanguages };
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
      presetOptions: {},
      originalValues: {
        config: {},
        studentConfig: {},
        teacherConfig: {},
        stationConfig: {},
      },
    };
  },

  computed: {
    // Config types this module declares, in the order of the rows under Advanced
    configTypes() {
      return ["config", "studentConfig", "teacherConfig", "stationConfig"].filter(
        (configType) => this.configSchemas[configType]
      );
    },

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

  watch: {
    hasChanges(val: boolean) {
      if (!this.standalone) this.$emit('update:hasChanges', val);
    },
  },

  created() {
    this.parseModuleConfig();

    // Set the initial active tab to the first available tab
    const firstAvailableTab = this.configTypes[0];
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

    // the same icons as the rows under Advanced
    tabIcon(configType: string) {
      return TAB_ICONS[configType] || "mdi-tune-variant";
    },

    tabLabel(configType) {
      const key = {
        config: "generalSettings",
        teacherConfig: "teacherSettings",
        studentConfig: "studentSettings",
        stationConfig: "stationSettings",
      }[configType];
      return this.t(`settings.modules.module.${key}`);
    },

    // A schema `label` if given, else the config key in words:
    // streamName -> "Stream name", websocketUrl -> "Websocket URL"
    fieldLabel(field, fieldConfig) {
      if (fieldConfig?.label) return fieldConfig.label;

      const acronyms = ["url", "id", "ip", "api", "fqbn", "mcu", "http", "mqtt", "html", "json"];
      const words = String(field)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-zA-Z])(\d)/g, "$1 $2")
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((word, i) => {
          if (acronyms.includes(word.toLowerCase())) return word.toUpperCase();
          // keep what the author wrote in capitals (mirrorX -> "Mirror X")
          if (word === word.toUpperCase()) return word;
          word = word.toLowerCase();
          return i === 0 ? word[0].toUpperCase() + word.slice(1) : word;
        });

      return words.join(" ") || String(field);
    },

    highlighter(code) {
      if (!this.prismHighlight || !this.prismLanguages.markdown) {
        console.error("Prism not properly injected.");
        return code;
      }
      return this.prismHighlight(code, this.prismLanguages.markdown, "markdown");
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

                // The module's own default wins, so the form never saves a
                // value the module would not use by itself (e.g. a boolean
                // that is on unless set to false)
                if (fieldConfig.default !== undefined) {
                  initialValues[key] = JSON.parse(
                    JSON.stringify(fieldConfig.default)
                  );
                  continue;
                }

                // Set default values based on type
                switch (fieldConfig.type) {
                  case "boolean":
                    initialValues[key] = false;
                    break;
                  case "checkboxes":
                    initialValues[key] = {};
                    if (Array.isArray(fieldConfig.options)) {
                      fieldConfig.options.forEach((option) => {
                        initialValues[key][option] = false;
                      });
                    }
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
                  case "code-area":
                    initialValues[key] = "";
                    break;
                  // select/combobox fall through: they start empty, unlike
                  // radio-button, so no option is chosen on the author's behalf
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

              this.restorePresetOptions(configType);

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

    // Suggestions for a field: the active preset's list, else the schema's.
    fieldOptions(configType, field, fieldConfig) {
      return (
        this.presetOptions[`${configType}.${field}`] ||
        fieldConfig.options ||
        []
      );
    },

    // A `select` field may carry `presets`: option -> values for sibling fields
    // of the same config type. Each entry is a plain value, or
    // `{ value, options }` to also narrow that sibling's suggestions (a
    // combobox still accepts any typed value). Last action wins: a preset
    // overwrites siblings even if hand-edited.
    applyPreset(configType, field, fieldConfig, option, valuesToo = true) {
      const preset = fieldConfig?.presets?.[option];

      if (!preset) return;

      for (const key in preset) {
        // ignore keys the module never declared
        if (key === field || !this.configSchemas[configType]?.[key]) continue;

        const entry = preset[key];
        const scoped = !!entry && typeof entry === "object";

        if (valuesToo) {
          this.formValues[configType][key] = scoped ? entry.value : entry;
        }

        // kept out of formValues so option lists are never saved
        if (scoped && Array.isArray(entry.options)) {
          this.presetOptions[`${configType}.${key}`] = entry.options;
        } else {
          delete this.presetOptions[`${configType}.${key}`];
        }
      }
    },

    // On load, restore the suggestions implied by the already-saved values.
    restorePresetOptions(configType) {
      const schema = this.configSchemas[configType];

      for (const field in schema) {
        const option = this.formValues[configType][field];

        this.applyPreset(configType, field, schema[field], option, false);
      }
    },

    // Current form values, keyed by config type.
    collectConfig() {
      const configResult = {};

      Object.keys(this.configSchemas).forEach((configType) => {
        if (
          this.configSchemas[configType] &&
          Object.keys(this.formValues[configType]).length > 0
        ) {
          configResult[configType] = this.formValues[configType];
        }
      });

      return configResult;
    },

    saveConfig() {
      const configResult = this.collectConfig();

      this.$emit("save", configResult);
      if (this.standalone) this.$emit("close");
      return configResult;
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

.config-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 0;
  font-weight: 600;
}

/* the look of the Settings tabs */
.config-tabs {
  padding: 4px 16px 0;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}

.config-tabs :deep(.v-tab) {
  min-width: 0;
  padding: 0 12px;
  border-radius: 8px 8px 0 0;
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

.config-tabs :deep(.v-tab.v-tab--selected) {
  background: rgb(var(--v-theme-primary-tint));
  font-weight: 600;
  color: rgb(var(--v-theme-primary-text));
}

.config-tabs :deep(.v-tab .v-icon) {
  font-size: 16px;
}

.preset-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
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

.code-editor-container {
  border: 1px solid rgb(var(--v-theme-field-line));
  border-radius: 8px;
  background: rgb(var(--v-theme-field));
  max-height: 300px;
  overflow: auto;
}

.code-editor-container:focus-within {
  outline: 1px solid rgb(var(--v-theme-focus));
  border-color: rgb(var(--v-theme-focus));
}

.code-editor-container :deep(.prism-editor__container) {
  min-height: 100px;
  font-family: monospace;
  font-size: 14px;
}
</style>
