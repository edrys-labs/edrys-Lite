<template>
  <v-list lines="three">
    <draggable
      :list="config.modules"
      item-key="id"
      @end="move"
      class="list-group"
      :disabled="writeProtection"
    >
      <template #item="{ element, index }">
        <v-list-item
          :key="index"
          class="list-group-item"
          :style="borderStyle(element, index)"
        >
          <template v-slot:prepend>
            <v-icon :icon="scrapedModules[index].icon || 'mdi-package'"></v-icon>
          </template>

          <v-list-item-title>
            {{ scrapedModules[index].name }}
            <v-chip size="x-small">
              {{ element.showInCustom || "*" }}
            </v-chip>
          </v-list-item-title>

          <v-list-item-subtitle
            v-html="scrapedModules[index]?.description || t('settings.modules.noDescription')"
            style="white-space: break-spaces"
          >
          </v-list-item-subtitle>

          <template v-slot:append>
            <v-menu :close-on-content-click="false">
              <template v-slot:activator="{ props }">
                <v-btn
                  icon="mdi-cog"
                  variant="text"
                  v-bind="props"
                  :style="validate_config(index) ? '' : 'color: red'"
                ></v-btn>
              </template>

              <Module
                v-model:module="config.modules[index]"
                v-model:error="errors[index]"
                :writeProtection="writeProtection"
              ></Module>
            </v-menu>

            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-delete"
                  variant="text"
                  :disabled="writeProtection"
                ></v-btn>
              </template>

              <v-list>
                <v-list-item>
                  <v-list-item-title>
                    {{ t('settings.modules.delete') }}
                  </v-list-item-title>

                  <v-btn
                    color="red"
                    depressed
                    @click="deleteModule(index)"
                    class="float-right"
                    style="margin-top: 10px"
                  >
                    {{ t('settings.modules.deleteConfirm') }}
                  </v-btn>
                </v-list-item>
              </v-list>
            </v-menu>
          </template>
        </v-list-item>
      </template>
    </draggable>
    <v-list-item :disabled="writeProtection">
      <template v-slot:prepend>
        <v-icon icon="mdi-link"></v-icon>
      </template>

      <v-text-field
        v-model="moduleImportUrl"
        :label="t('settings.modules.url')"
        variant="underlined"
        required
        style="width: calc(100% - 40px)"
      ></v-text-field>

      <template v-slot:append>
        <v-btn @click="loadURL" :disabled="!validate_url(moduleImportUrl)">
          <v-icon left> mdi-view-grid-plus </v-icon>
          {{ t('settings.modules.add') }}
        </v-btn>
      </template>
    </v-list-item>
  </v-list>

  <v-divider class="pb-2"></v-divider>
  <v-btn href="https://github.com/topics/edrys-module?q=edrys-lite" target="_blank">
    <v-icon left> mdi-github </v-icon>
    {{ t('settings.modules.explore') }}
  </v-btn>
</template>

<script lang="ts">
import { scrapeModule, validateUrl } from "../../ts/Utils";
import draggable from "vuedraggable";
import Module from "./Module.vue";
import { useI18n } from 'vue-i18n';

export default {
  name: "Settings-Modules",

  props: {
    config: {
      type: Object,
      required: true,
    },

    scrapedModules: {
      type: Object,
      required: true,
    },

    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    const errors: {
      config: string;
      studentConfig: string;
      teacherConfig: string;
      stationConfig: string;
      showInCustom: string;
    }[] = [];

    for (let i = 0; i < this.config.modules.length; i++) {
      errors.push({
        config: "",
        studentConfig: "",
        teacherConfig: "",
        stationConfig: "",
        showInCustom: "",
      });
    }

    return {
      moduleImportUrl: "",
      errors,
      colors: {},
    };
  },

  methods: {
    stringToColor(str: string) {
      str = str || "*";
      str = str.toLowerCase();

      if (this.colors[str]) return this.colors[str];

      const uid = str + str + str;

      // Generate a hash value from the string
      let hash = 0;
      for (let i = 0; i < uid.length; i++) {
        hash = uid.charCodeAt(i) + ((hash << 5) - hash);
      }

      // Convert hash to a valid color code
      let color = "#";
      for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xff;
        color += ("00" + value.toString(16)).slice(-2); // Ensure two hex digits
      }

      this.colors[str] = color;

      return color;
    },

    borderStyle(element, index) {
      const color = this.stringToColor(element.showInCustom);
      let style = `border-left: 5px solid ${color}; border-right: 5px solid ${color};`;

      const prev = this.config.modules[index - 1];
      const next = this.config.modules[index + 1];

      // Determine if module is first in its group
      if (!prev || prev.showInCustom !== element.showInCustom) {
        style += `
        border-top: 5px solid ${color};
        border-top-left-radius: 10px !important;
        border-top-right-radius: 10px !important;
      `;
      }
      // Determine if module is last in its group
      if (!next || next.showInCustom !== element.showInCustom) {
        style += `
        border-bottom: 5px solid ${color};
        border-bottom-left-radius: 10px !important;
        border-bottom-right-radius: 10px !important;
        margin-bottom: 10px;
      `;
      }

      return style;
    },

    async update() {
      this.scrapedModules = [];
      for (let i = 0; i < this.config.modules.length; i++) {
        let module = await scrapeModule(this.config.modules[i]);
        this.scrapedModules.push(module);
      }
    },

    move(event: any) {
      const element = this.scrapedModules[event.oldIndex];

      this.scrapedModules[event.oldIndex] = this.scrapedModules[event.newIndex];
      this.scrapedModules[event.newIndex] = element;

      return true;
    },

    validate_config(i: number) {
      return (
        this.errors[i].config === "" &&
        this.errors[i].studentConfig === "" &&
        this.errors[i].teacherConfig === "" &&
        this.errors[i].stationConfig === ""
      );
    },

    validate_url(url: string) {
      return validateUrl(url);
    },

    deleteModule(index: number) {
      this.config.modules.splice(index, 1);
      this.scrapedModules.splice(index, 1);
      this.errors.splice(index, 1);
    },

    async loadURL() {
      const module = {
        url: this.moduleImportUrl,
        config: "",
        studentConfig: "",
        teacherConfig: "",
        stationConfig: "",
        showInCustom: "",
        width: "full",
        height: "tall",
      };

      const scrapedModule = await scrapeModule(module);

      this.config.modules.push(module);
      this.scrapedModules.push(scrapedModule);
      this.errors.push({
        config: "",
        studentConfig: "",
        teacherConfig: "",
        stationConfig: "",
        showInCustom: "",
      });

      this.moduleImportUrl = "";
    },
  },
  components: { Module, draggable },
};
</script>

<style scoped>
.list-group-item {
  transition: box-shadow 0.3s ease, transform 0.3s ease;
  background-color: white; /* Optional: Default background color */
}

.list-group-item:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2), 0 3px 10px rgba(0, 0, 0, 0.19);
  transform: translateY(-2px);
}
</style>
