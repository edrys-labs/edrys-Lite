<template>
  <div class="module-list">
    <draggable
      :list="config.modules"
      item-key="id"
      :move="canMove"
      @end="move"
      class="list-group"
      ghost-class="drag-ghost"
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
          :class="['room-group-header', { first: index === 0 }]"
        >
          <span
            v-for="dot in groupDots(element.showInCustom)"
            :key="dot.key"
            :class="['group-dot', { hollow: !dot.color }]"
            :style="dot.color ? { background: dot.color } : {}"
          ></span>
          <h3>
            {{ t('settings.modules.module.showIn.title') }}:
            <span class="group-name">{{ element.showInCustom || "*" }}</span>
          </h3>
          <span class="group-rule" aria-hidden="true"></span>
        </div>
        <div
          :key="element.id"
          class="list-group-item"
          :style="{ '--room': groupColor(element.showInCustom) }"
        >
          <svg class="drag-handle" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.6"></circle><circle cx="15" cy="6" r="1.6"></circle>
            <circle cx="9" cy="12" r="1.6"></circle><circle cx="15" cy="12" r="1.6"></circle>
            <circle cx="9" cy="18" r="1.6"></circle><circle cx="15" cy="18" r="1.6"></circle>
          </svg>

          <div class="icon-tile">
            <v-icon :icon="localScrapedModules[index].icon" size="18"></v-icon>
          </div>

          <div class="module-text">
            <div class="module-name">{{ localScrapedModules[index].name }}</div>
            <div class="module-description">
              <LinkedText :text="localScrapedModules[index]?.description || t('settings.modules.noDescription')" />
            </div>
          </div>

          <div v-if="!validate_config(index)" class="error-pill">
            <v-icon icon="mdi-alert-circle-outline" size="14"></v-icon>
            {{ t('settings.modules.tooltip.invalidConfig') }}
          </div>

          <v-btn
            icon="mdi-tune-variant"
            size="34"
            variant="text"
            class="row-btn"
            :aria-label="configLabel(index)"
            :title="configLabel(index)"
            @click="openModuleDialog(index)"
          ></v-btn>

          <v-menu location="top end">
            <template v-slot:activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-delete-outline"
                size="34"
                variant="text"
                class="row-btn"
                :aria-label="t('settings.modules.tooltip.delete')"
                :title="t('settings.modules.tooltip.delete')"
              ></v-btn>
            </template>

            <v-card class="confirm">
              <p>{{ t('settings.modules.delete') }}</p>
              <div class="confirm-actions">
                <v-btn variant="text" height="34">{{ t('settings.modules.moduleConfig.cancel') }}</v-btn>
                <v-btn color="danger-fill" variant="flat" height="34" @click="deleteModule(index)">
                  {{ t('settings.modules.deleteConfirm') }}
                </v-btn>
              </div>
            </v-card>
          </v-menu>
        </div>
        </div>
      </template>
    </draggable>

    <div class="add-row">
      <FieldLabel :label="t('settings.modules.url')" class="add-url">
        <v-text-field
          v-model="moduleImportUrl"
          placeholder="https://edrys-labs.github.io/module-…"
          class="ltr"
          hide-details
        ></v-text-field>
      </FieldLabel>
      <v-btn variant="outlined" height="40" :disabled="!validate_url(moduleImportUrl)" @click="loadURL">
        {{ t('settings.modules.add') }}
      </v-btn>
      <v-btn color="tonal" variant="flat" height="40" prepend-icon="mdi-magnify" @click="isOpenModulesExplorer = true">
        {{ t('settings.modules.explore') }}
      </v-btn>
    </div>
  </div>

  <v-dialog
    v-model="isModuleDialogOpen"
    max-width="800px"
    scrollable
    persistent
  >
    <v-card v-if="moduleDialogIndex !== null" style="display: flex; flex-direction: column; max-height: 90vh">
      <div class="dialog-head">
        <div class="icon-tile">
          <v-icon :icon="localScrapedModules[moduleDialogIndex]?.icon" size="18"></v-icon>
        </div>
        <h2>{{ localScrapedModules[moduleDialogIndex]?.name }}</h2>
        <v-btn
          icon="mdi-close"
          size="36"
          variant="text"
          class="row-btn"
          :aria-label="t('classroom.popup.close')"
          @click="closeModuleDialog"
        ></v-btn>
      </div>

      <v-card-text style="overflow-y: auto; flex: 1 1 auto; padding: 0">
        <v-expansion-panels variant="accordion" mandatory v-model="activeEditor">
          <!-- Structured, schema-driven form (only when the module declares a schema) -->
          <v-expansion-panel
            v-if="localScrapedModules[moduleDialogIndex]?.moduleConfig"
            value="form"
            elevation="0"
          >
            <v-expansion-panel-title class="editor-panel-title">
              <v-icon size="18" class="me-2">mdi-form-select</v-icon>
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
                @update:hasChanges="formHasChanges = $event"
              />
            </v-expansion-panel-text>
          </v-expansion-panel>

          <!-- Raw manual config -->
          <v-expansion-panel value="manual" elevation="0">
            <v-expansion-panel-title class="editor-panel-title">
              <v-icon size="18" class="me-2">mdi-code-braces</v-icon>
              {{ t('settings.modules.tooltip.manualConfig') }}
              <template v-slot:actions="{ expanded }">
                <v-icon>{{ expanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
              </template>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <Module
                v-model:module="moduleDialogDraft"
                v-model:error="errors[moduleDialogIndex]"
                :rooms="rooms"
              ></Module>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <div class="dialog-foot">
        <v-btn variant="outlined" @click="closeModuleDialog">
          {{ t('settings.modules.moduleConfig.cancel') }}
        </v-btn>
        <v-btn color="primary" variant="flat" class="save" @click="saveModuleDialog">
          {{ t('settings.modules.moduleConfig.save') }}
          <span v-if="dialogHasChanges" class="save-dot" aria-hidden="true"></span>
        </v-btn>
      </div>
    </v-card>
  </v-dialog>

  <ModulesExplorer
    v-if="isOpenModulesExplorer"
    @close="isOpenModulesExplorer = false"
    @add-module="addModuleFromExplorer"
  ></ModulesExplorer>
</template>

<script lang="ts">
import { scrapeModule, validateUrl, parse, roomSlot } from "../../ts/Utils";
import { activeTheme, roomTile } from "../../ts/Theme";
import draggable from "vuedraggable";
import Module from "./Module.vue";
import { useI18n } from 'vue-i18n';
import ModulesExplorer from "./ModulesExplorer.vue";
import ModuleConfigForm from "./ModuleConfigForm.vue";
import LinkedText from "../LinkedText.vue";
import FieldLabel from "../FieldLabel.vue";
import type { PropType } from "vue";

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

    // the class's rooms, in the drawer's order, so a room has the same color here
    rooms: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale, activeTheme };
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
    // One dot per room a "Show in" value names, in that room's drawer color;
    // "station" names every station that is online. "*", stations that are
    // offline and rooms that don't exist yet get a hollow ring. Role values
    // (teacher-only, station-only) narrow who sees a module, so add no dot.
    groupDots(showIn: string) {
      const rooms = this.rooms as string[];
      const dots: { key: string; color: string | null }[] = [];
      const add = (room: string | undefined) => {
        const key = room ?? "other";
        if (dots.some((dot) => dot.key === key)) return;
        const color = room ? roomTile(roomSlot(room, rooms), this.activeTheme).dot : null;
        dots.push({ key, color });
      };

      for (const token of (showIn || "*").split(",").map((r) => r.trim().toLowerCase())) {
        if (token.endsWith("-only")) continue;
        if (token === "station") {
          const stations = rooms.filter((r) => r.startsWith("Station "));
          stations.forEach(add);
          if (!stations.length) add(undefined);
          continue;
        }
        add(rooms.find((r) => r.toLowerCase() === token));
      }
      if (!dots.length) add(undefined);
      return dots;
    },

    // The stripe on a group's rows: its room's color when it names one room,
    // a neutral line for "*" and for several rooms.
    groupColor(showIn: string) {
      const dots = this.groupDots(showIn);
      return dots.length === 1 && dots[0].color
        ? dots[0].color
        : "rgb(var(--v-theme-line))";
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

    configLabel(i: number) {
      return this.validate_config(i)
        ? this.t("settings.modules.tooltip.config")
        : this.t("settings.modules.tooltip.invalidConfig");
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
      // an untouched form would write its default values into configs that were empty
      if (!form || !this.moduleDialogDraft || !this.formHasChanges) return;

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
    ModuleConfigForm,
    LinkedText,
    FieldLabel
  },
};
</script>

<style scoped>
.room-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  margin: 28px 0 8px;
}

.group-rule {
  flex: 1;
  height: 1px;
  background: rgb(var(--v-theme-line));
}

.room-group-header.first {
  margin-top: 0;
}

.group-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

.group-dot + .group-dot {
  margin-inline-start: -4px;
}

.group-dot.hollow {
  border: 1.5px solid rgb(var(--v-theme-muted));
}

.room-group-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-muted));
}

.group-name {
  font-family: "JetBrains Mono Variable", monospace;
  font-weight: 500;
  color: rgb(var(--v-theme-text-2));
}

.list-group-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
  padding-block: 8px;
  padding-inline: 10px 8px;
  border-radius: 10px;
  background: rgb(var(--v-theme-row));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-row-edge));
  cursor: grab;
  position: relative;
  overflow: hidden;
}

/* the group's room color down the row's start edge */
.list-group-item::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 4px;
  background: var(--room, transparent);
}

.list-group-item:hover {
  box-shadow: 0 0 0 1px rgb(var(--v-theme-line));
}

.drag-ghost {
  opacity: 0;
}

.drag-handle {
  width: 16px;
  flex-shrink: 0;
  color: rgb(var(--v-theme-faint));
}

.icon-tile {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgb(var(--v-theme-icon-tile));
  color: rgb(var(--v-theme-text-2));
}

.module-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.module-name {
  font-size: 14px;
  font-weight: 600;
}

.module-description {
  font-size: 12px;
  line-height: 1.4;
  color: rgb(var(--v-theme-muted));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.module-description :deep(a) {
  color: rgb(var(--v-theme-link));
}

.error-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgb(var(--v-theme-danger-tint));
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  font-weight: 600;
}

.row-btn {
  color: rgb(var(--v-theme-muted));
}

.add-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding-top: 12px;
}

.add-url {
  flex: 1;
}

/* on a phone the address gets the whole width, the buttons go below it */
@media (max-width: 599px) {
  .add-row {
    flex-wrap: wrap;
  }

  .add-url {
    flex-basis: 100%;
  }
}

.dialog-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-block: 16px 12px;
  padding-inline: 24px 16px;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}

.dialog-head h2 {
  flex: 1;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid rgb(var(--v-theme-panel-line));
}

.editor-panel-title {
  font-size: 13px;
  font-weight: 600;
  min-height: 48px;
}

.editor-panel-title,
.editor-panel-title :deep(.v-icon) {
  color: rgb(var(--v-theme-muted)) !important;
  opacity: 1;
}

.editor-panel-title.v-expansion-panel-title--active,
.editor-panel-title.v-expansion-panel-title--active :deep(.v-icon) {
  color: rgb(var(--v-theme-primary)) !important;
}

.editor-panel-title.v-expansion-panel-title--active {
  background-color: rgba(var(--v-theme-primary), 0.08);
}
</style>
