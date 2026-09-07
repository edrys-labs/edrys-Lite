<template>
  <v-list lines="three">
    <draggable
      :list="config.modules"
      item-key="id"
      :move="canMove"
      @end="move"
      class="list-group"
      ghost-class="drag-ghost"
      :disabled="writeProtection"
      :scroll="true"
      :bubbleScroll="true"
      :scrollSensitivity="80"
      :scrollSpeed="12"
      :forceFallback="true"
      :fallbackOnBody="true"
      :fallbackTolerance="0"
    >
      <template #item="{ element, index }">
        <div>
        <div
          v-if="groupHeaderAt[index] !== undefined"
          class="room-group-header"
          :style="{ borderLeftColor: roomColor(element.showInCustom, orderedRooms) }"
        >
          {{ element.showInCustom || "*" }}
        </div>
        <v-list-item
          :key="element.id"
          class="list-group-item"
          :style="borderStyle(element, index)"
        >
          <template v-slot:prepend>
            <v-icon :icon="localScrapedModules[index].icon || 'mdi-package'"></v-icon>
          </template>

          <v-list-item-title>
            {{ localScrapedModules[index].name }}
          </v-list-item-title>

          <v-list-item-subtitle
            v-html="localScrapedModules[index]?.description || t('settings.modules.noDescription')"
            style="white-space: break-spaces"
          >
          </v-list-item-subtitle>

          <template v-slot:append>
            <v-tooltip location="top">
              <template v-slot:activator="{ props }">
                <v-btn
                  icon="mdi-cog"
                  variant="text"
                  v-bind="props"
                  :style="validate_config(index) ? '' : 'color: red'"
                  @click="openModuleDialog(index)"
                ></v-btn>
              </template>
              <span>{{ t('settings.modules.tooltip.config') }}</span>
            </v-tooltip>

            <v-tooltip location="top">
              <template v-slot:activator="{ props: tooltipProps }">
                <v-menu>
                  <template v-slot:activator="{ props: menuProps }">
                    <v-btn
                      v-bind="{ ...tooltipProps, ...menuProps }"
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
              <span>{{ t('settings.modules.tooltip.delete') }}</span>
            </v-tooltip>
          </template>
        </v-list-item>
        </div>
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

  <v-dialog
    v-model="isModuleDialogOpen"
    max-width="800px"
    scrollable
    persistent
  >
    <v-card v-if="moduleDialogIndex !== null" style="display: flex; flex-direction: column; max-height: 90vh">
      <v-toolbar color="grey-darken-4" density="comfortable">
        <v-icon class="ml-4 mr-1">{{ localScrapedModules[moduleDialogIndex]?.icon || 'mdi-package' }}</v-icon>
        <v-toolbar-title class="text-h6 font-weight-medium">
          {{ localScrapedModules[moduleDialogIndex]?.name }}
        </v-toolbar-title>
        <v-btn icon @click="closeModuleDialog">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-card-text style="overflow-y: auto; flex: 1 1 auto; padding: 0">
        <v-expansion-panels variant="accordion" mandatory v-model="activeEditor">
          <!-- Structured, schema-driven form (only when the module declares a schema) -->
          <v-expansion-panel
            v-if="localScrapedModules[moduleDialogIndex]?.moduleConfig"
            value="form"
            elevation="0"
          >
            <v-expansion-panel-title class="editor-panel-title">
              <v-icon size="18" class="mr-2">mdi-form-select</v-icon>
              {{ t('settings.modules.moduleConfig.title') }}
              <template v-slot:actions="{ expanded }">
                <v-icon>{{ expanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
              </template>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <ModuleConfigForm
                ref="moduleConfigForm"
                :standalone="false"
                :moduleName="localScrapedModules[moduleDialogIndex]?.name"
                :moduleConfig="localScrapedModules[moduleDialogIndex]?.moduleConfig"
                :currentConfig="moduleDialogDraft?.config"
                :currentStudentConfig="moduleDialogDraft?.studentConfig"
                :currentTeacherConfig="moduleDialogDraft?.teacherConfig"
                :currentStationConfig="moduleDialogDraft?.stationConfig"
                :writeProtection="writeProtection"
                @update:hasChanges="formHasChanges = $event"
              />
            </v-expansion-panel-text>
          </v-expansion-panel>

          <!-- Raw manual config -->
          <v-expansion-panel value="manual" elevation="0">
            <v-expansion-panel-title class="editor-panel-title">
              <v-icon size="18" class="mr-2">mdi-code-braces</v-icon>
              {{ t('settings.modules.tooltip.manualConfig') }}
              <template v-slot:actions="{ expanded }">
                <v-icon>{{ expanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
              </template>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <Module
                v-model:module="moduleDialogDraft"
                v-model:error="errors[moduleDialogIndex]"
                :writeProtection="writeProtection"
              ></Module>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <v-divider></v-divider>
      <v-card-actions>
        <v-btn variant="outlined" color="grey-darken-4" @click="closeModuleDialog">
          {{ t('settings.modules.moduleConfig.cancel') }}
        </v-btn>
        <v-btn
          variant="flat"
          color="grey-darken-4"
          @click="saveModuleDialog"
          :disabled="writeProtection"
        >
          {{ t('settings.modules.moduleConfig.save') }}
          <v-badge
            v-if="dialogHasChanges"
            color="red"
            dot
            style="position: absolute; top: 0; right: 0"
          ></v-badge>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-divider class="pb-2"></v-divider>
  <v-btn variant="outlined" @click="isOpenModulesExplorer = true">
    <v-icon class="mr-2" left> mdi-compass </v-icon>
    {{ t('settings.modules.explore') }}
  </v-btn>

  <ModulesExplorer
    v-if="isOpenModulesExplorer"
    @close="isOpenModulesExplorer = false"
    @add-module="addModuleFromExplorer"
  ></ModulesExplorer>
</template>

<script lang="ts">
import { scrapeModule, validateUrl, parse, roomColor } from "../../ts/Utils";
import draggable from "vuedraggable";
import Module from "./Module.vue";
import { useI18n } from 'vue-i18n';
import ModulesExplorer from "./ModulesExplorer.vue";
import ModuleConfigForm from "./ModuleConfigForm.vue";

// A module's room key. Missing modules (list edges) get a unique sentinel so
// group-boundary checks treat them as "no neighbour".
const roomOf = (m: any): string => (m ? (m.showInCustom || "*").toLowerCase() : "\0none");

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
    return { t, locale, roomColor };
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
      // Local copy so drag-reorder doesn't mutate the shared scrapedModules
      // prop (which the main classroom view renders from) before saving.
      localScrapedModules: [...(this.scrapedModules as any[])],

      isOpenModulesExplorer: false,
      isModuleDialogOpen: false,
      moduleDialogIndex: null as number | null,
      moduleDialogDraft: null as any,
      formHasChanges: false,
      moduleDialogOriginal: null as any,
      activeEditor: "form" as "form" | "manual",
    };
  },

  watch: {
    // Re-sync the local copy whenever the parent re-scrapes the modules.
    scrapedModules(next: any[]) {
      this.localScrapedModules = [...next];
    },

    // Flush form edits into draft before it unmounts (panel switch).
    activeEditor(next: string, prev: string) {
      if (prev === "form") this.collectFormIntoDraft();
    },
  },

  computed: {
    dialogHasChanges(): boolean {
      if (this.formHasChanges) return true;
      if (!this.moduleDialogDraft || !this.moduleDialogOriginal) return false;
      return JSON.stringify(this.moduleDialogDraft) !== JSON.stringify(this.moduleDialogOriginal);
    },

    orderedRooms(): string[] {
      const seen = new Set<string>(this.config.modules.map(roomOf));

      return Array.from(seen).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
    },

    // Index → room name, only at the first module of each room group.
    groupHeaderAt() {
      const headers: Record<number, string> = {};
      this.config.modules.forEach((mod: any, i: number) => {
        const cur = roomOf(mod);
        if (cur !== (i > 0 ? roomOf(this.config.modules[i - 1]) : null)) headers[i] = cur;
      });
      return headers;
    },
  },

  methods: {
    borderStyle(element: any, index: number) {
      const color = roomColor(element.showInCustom, this.orderedRooms);
      const isFirst = roomOf(element) !== roomOf(this.config.modules[index - 1]);
      const isLast = roomOf(element) !== roomOf(this.config.modules[index + 1]);
      return [
        `border-left: 4px solid ${color}`,
        `background-color: ${color}14`,
        isFirst ? `border-top: 1px solid ${color}40` : '',
        isLast ? `border-bottom: 1px solid ${color}40; margin-bottom: 10px;` : '',
      ].filter(Boolean).join('; ');
    },

    // Only allow reordering within the same room.
    canMove(event: any) {
      const target = event.relatedContext?.element;
      if (!target) return false; // no same-room neighbour here → block
      return roomOf(event.draggedContext?.element) === roomOf(target);
    },

    move(event: any) {
      // draggable already reordered config.modules; mirror the same move in the
      // local metadata + errors arrays so they stay aligned by index.
      const [sm] = this.localScrapedModules.splice(event.oldIndex, 1);
      this.localScrapedModules.splice(event.newIndex, 0, sm);
      const [er] = this.errors.splice(event.oldIndex, 1);
      this.errors.splice(event.newIndex, 0, er);
    },

    // Modules of the same room must sit next to each other for the group
    // headers/borders to render one block per room.
    regroup() {
      const modules = this.config.modules as any[];
      const order: string[] = [];
      modules.forEach((m) => {
        const room = roomOf(m);
        if (!order.includes(room)) order.push(room);
      });

      const indices = modules.map((_, i) => i);
      indices.sort(
        (a, b) =>
          order.indexOf(roomOf(modules[a])) - order.indexOf(roomOf(modules[b])) || a - b
      );

      // Already grouped → don't touch the arrays (keeps reactivity churn down).
      if (indices.every((from, to) => from === to)) return;

      // Splice in place: `config` is a prop object whose `modules` array is
      // bound elsewhere (draggable, parent), so keep the same array instance.
      const reorder = (arr: any[]) => indices.map((i) => arr[i]);
      const sortedScraped = reorder(this.localScrapedModules);
      const sortedErrors = reorder(this.errors);
      modules.splice(0, modules.length, ...reorder(modules));
      this.localScrapedModules = sortedScraped;
      this.errors = sortedErrors;
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
      this.localScrapedModules.splice(index, 1);
      this.errors.splice(index, 1);
    },

    async addModuleFromExplorer(moduleUrl: string) {
      this.moduleImportUrl = moduleUrl;
      await this.loadURL();
      this.isOpenModulesExplorer = false;
    },

    async loadURL() {
      const module = {
        id: crypto.randomUUID(),
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

      module.showInCustom = scrapedModule.showInCustom;

      this.config.modules.push(module);
      this.localScrapedModules.push(scrapedModule);
      this.errors.push({
        config: "",
        studentConfig: "",
        teacherConfig: "",
        stationConfig: "",
        showInCustom: "",
      });

      this.regroup();

      this.moduleImportUrl = "";
    },

    openModuleDialog(index: number) {
      this.moduleDialogIndex = index;
      const base = {
        config: "",
        studentConfig: "",
        teacherConfig: "",
        stationConfig: "",
        showInCustom: "",
        width: "full",
        height: "tall",
      };
      this.moduleDialogDraft = { ...base, ...JSON.parse(JSON.stringify(this.config.modules[index])) };
      this.moduleDialogOriginal = JSON.parse(JSON.stringify(this.moduleDialogDraft));
      this.formHasChanges = false;
      this.activeEditor = this.localScrapedModules[index]?.moduleConfig ? "form" : "manual";
      this.isModuleDialogOpen = true;
    },

    closeModuleDialog() {
      this.isModuleDialogOpen = false;
      this.moduleDialogIndex = null;
      this.moduleDialogDraft = null;
    },

    // Safely turn a config field (YAML/JSON string or object) into a plain object.
    parseConfig(value: any) {
      if (!value) return {};
      if (typeof value === "object") return value;
      if (typeof value === "string") {
        try {
          return value.trim() !== "" ? parse(value) || {} : {};
        } catch (e) {
          console.error("Failed to parse module config value:", e);
          return {};
        }
      }
      return {};
    },

    // Merge the schema form's current values into the draft, so they survive a
    // panel switch or a save. No-op when the form isn't mounted.
    collectFormIntoDraft() {
      const form = this.$refs.moduleConfigForm as any;
      if (!form || !this.moduleDialogDraft) return;

      const formConfig = form.collectConfig();
      Object.entries(formConfig).forEach(([configType, value]) => {
        const existing = this.parseConfig(this.moduleDialogDraft[configType]);
        this.moduleDialogDraft[configType] = { ...existing, ...(value as object) };
      });
    },

    saveModuleDialog() {
      if (this.moduleDialogIndex === null) return;

      if (this.activeEditor === "form") this.collectFormIntoDraft();

      Object.assign(this.config.modules[this.moduleDialogIndex], this.moduleDialogDraft);
      this.closeModuleDialog();
      this.regroup();
    },
  },
  components: { 
    Module, 
    draggable,
    ModulesExplorer,
    ModuleConfigForm
  },
};
</script>

<style scoped>
.editor-panel-title {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  min-height: 48px;
}

.editor-panel-title :deep(.v-icon) {
  opacity: 1;
}

.editor-panel-title,
.editor-panel-title :deep(.v-icon) {
  color: #757575 !important;
}

.editor-panel-title.v-expansion-panel-title--active,
.editor-panel-title.v-expansion-panel-title--active :deep(.v-icon) {
  color: #1565c0 !important;
}

.editor-panel-title.v-expansion-panel-title--active {
  background-color: rgba(21, 101, 192, 0.08);
}

.drag-ghost {
  opacity: 0;
}

.list-group-item {
  transition: box-shadow 0.3s ease, transform 0.3s ease;
  background-color: white;
}

.list-group-item:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2), 0 3px 10px rgba(0, 0, 0, 0.19);
  transform: translateY(-2px);
}

.room-group-header {
  padding: 4px 16px 2px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #555;
  border-left: 4px solid transparent;
  margin-top: 16px;
}

</style>