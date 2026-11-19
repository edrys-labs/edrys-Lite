<template>
  <SectionHead :title="t('settings.main.classTitle')" :text="t('settings.main.classText')" icon="mdi-book-open-outline" :color="6" />

  <div class="class-fields">
    <div class="fields">
      <FieldLabel :label="t('settings.main.className')">
        <v-text-field v-model="config.name" :counter="20" required></v-text-field>
      </FieldLabel>

      <FieldLabel :label="t('settings.main.description')">
        <v-textarea v-model="config.meta.description" rows="2" max-rows="3" auto-grow hide-details></v-textarea>
      </FieldLabel>

      <FieldLabel :label="t('settings.main.logoUrl')" class="mt-4">
        <v-text-field
          v-model="config.meta.logo"
          class="ltr"
          placeholder="https://…/logo.png"
          :hint="t('settings.main.logoHint')"
          persistent-hint
        ></v-text-field>
      </FieldLabel>
    </div>

    <figure class="preview">
      <figcaption>{{ t('settings.main.preview') }}</figcaption>
      <div class="preview-card" aria-hidden="true">
        <ClassBanner :id="config.id || ''" :logo="config.meta.logo || ''" class="preview-banner" />
        <div class="preview-body">
          <div class="preview-name">{{ config.name }}</div>
          <div v-if="config.meta.description" class="preview-description">{{ config.meta.description }}</div>
        </div>
      </div>
    </figure>
  </div>

  <v-divider class="my-4"></v-divider>

  <SectionHead
    :title="t('settings.main.designTitle')"
    :text="t('settings.main.designText')"
    icon="mdi-palette-outline"
    :color="3"
  />

  <div role="radiogroup" :aria-label="t('settings.main.designTitle')" class="designs">
    <label
      v-for="design in choices"
      :key="design"
      class="design"
      :class="{ 'design--selected': design === selectedDesign }"
    >
      <!-- the class's own design has no theme until it is picked -->
      <div v-if="design === 'custom' && selectedDesign !== 'custom'" class="design-preview design-preview--custom" aria-hidden="true">
        <span class="custom-dot custom-dot--1"></span>
        <span class="custom-dot custom-dot--2"></span>
        <span class="custom-dot custom-dot--3"></span>
        <v-icon icon="mdi-plus" size="18"></v-icon>
      </div>
      <!-- a small classroom in that design's own colors and corners: Vuetify
           sets each theme's variables on its v-theme--<name> class -->
      <div v-else :class="['design-preview', 'v-theme--' + themeName(design, activeTheme)]" aria-hidden="true">
        <div class="design-preview-bar"></div>
        <div class="design-preview-modules">
          <div class="design-preview-module"><span class="design-preview-button"></span></div>
          <div class="design-preview-module design-preview-text">Aa</div>
        </div>
      </div>
      <span class="design-name">
        <input
          type="radio"
          name="design"
          :value="design"
          :checked="design === selectedDesign"
          :aria-describedby="'design-hint-' + design"
          @change="config.meta.design = design"
        />
        {{ t('settings.main.designs.' + design + '.name') }}
      </span>
      <span :id="'design-hint-' + design" class="design-hint">{{ t('settings.main.designs.' + design + '.hint') }}</span>
    </label>
  </div>

  <div v-if="selectedDesign === 'custom'" class="custom-design">
    <p class="custom-note">
      <v-icon icon="mdi-information-outline" size="16"></v-icon>
      {{ t('settings.main.customDesign.note') }}
    </p>

    <p v-if="customCheck" class="custom-current">
      <strong>{{ customCheck.design.name || t('settings.main.designs.custom.name') }}</strong>
      · {{ t('settings.main.customDesign.basedOn', { base: t('settings.main.designs.' + customCheck.design.base + '.name') }) }}
    </p>

    <div class="custom-actions">
      <v-btn variant="outlined" height="36" prepend-icon="mdi-upload" @click="openDesignFile">
        {{ t('settings.main.customDesign.upload') }}
      </v-btn>
      <input
        ref="designFile"
        type="file"
        accept=".yml,.yaml,.json,application/yaml,application/json"
        class="custom-file"
        tabindex="-1"
        aria-hidden="true"
        @change="uploadDesign"
      />
    </div>

    <p v-if="uploadError" class="custom-error" role="alert">
      {{ t('settings.main.customDesign.errors.' + uploadError) }}
    </p>

    <div v-if="customCheck?.ignored.length" class="custom-ignored" role="status">
      <p>{{ t('settings.main.customDesign.ignored') }}</p>
      <ul>
        <li v-for="entry in customCheck.ignored" :key="entry.path">
          <code>{{ entry.path }}</code> — {{ t('settings.main.customDesign.reasons.' + entry.reason) }}
        </li>
      </ul>
    </div>
  </div>

  <v-divider class="my-4"></v-divider>

  <SectionHead :title="t('settings.main.roomsTitle')" :text="t('settings.main.roomsText')" icon="mdi-door-open" :color="0" />

  <FieldLabel :label="t('settings.main.roomsNum')">
    <v-text-field
      v-model.number="config.meta.defaultNumberOfRooms"
      type="number"
      min="0"
      max="50"
      hide-details
      class="rooms-num"
    ></v-text-field>
  </FieldLabel>

  <v-checkbox
    v-model="config.meta.teacherMovesStudents"
    :label="t('settings.main.teacherMoves.label')"
    aria-describedby="teacher-moves-hint"
    hide-details
    density="compact"
    class="teacher-moves"
    color="primary"
  ></v-checkbox>
  <p id="teacher-moves-hint" class="teacher-moves-hint">{{ t('settings.main.teacherMoves.hint') }}</p>

  <!-- selfAssign checkbox hidden until the feature is implemented
  <v-checkbox
    v-model="config.meta.selfAssign"
    :label="t('settings.main.selfAssign')"
    outlined
  ></v-checkbox>
  -->
</template>

<script lang="ts">
import { useI18n } from 'vue-i18n';
import FieldLabel from "../FieldLabel.vue";
import SectionHead from "./SectionHead.vue";
import ClassBanner from "../ClassBanner.vue";
import { DESIGNS, activeTheme, themeName, type DesignChoice } from "../../ts/Theme";
import { checkDesign, readDesignFile, type DesignFileError } from "../../ts/CustomDesign";

const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

export default {
  name: "Settings-Main",
  components: { FieldLabel, SectionHead, ClassBanner },

  props: {
    config: {
      type: Object,
      required: true,
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale, activeTheme, themeName, designs: DESIGNS, choices: [...DESIGNS, "custom"] as DesignChoice[] };
  },

  data() {
    return {
      uploadError: null as DesignFileError | null,
    };
  },

  computed: {
    // classes from before designs, or with an unknown one, show as Standard
    selectedDesign(): string {
      const design = this.config.meta?.design;
      return design === "custom" || DESIGNS.includes(design) ? design : "standard";
    },
    // the class's own design as every peer sees it, with what it leaves out;
    // also for a design written straight into the lab file
    customCheck() {
      const custom = this.config.meta?.customDesign;
      return isRecord(custom) ? checkDesign(custom) : null;
    },
  },

  methods: {
    openDesignFile() {
      (this.$refs.designFile as HTMLInputElement).click();
    },

    async uploadDesign(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = ""; // the same file can be picked again after editing it
      if (!file) return;

      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      }).catch(() => null);
      if (text === null) {
        this.uploadError = "unreadable";
        return;
      }
      const result = readDesignFile(text);
      if ("error" in result) {
        this.uploadError = result.error;
        return;
      }
      this.uploadError = null;
      this.config.meta.customDesign = result.file;
      this.config.meta.design = "custom";
    },
  },
};
</script>

<style scoped>
.class-fields {
  display: grid;
  grid-template-columns: 1fr 220px;
  align-items: start;
  gap: 24px;
}

.preview {
  margin: 0;
}

.preview figcaption {
  margin-bottom: 6px;
  font-size: var(--v-text-12);
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

/* a small copy of the class card on the start page */
.preview-card {
  border-radius: var(--v-radius-card);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.05), 0 0 0 1px rgb(var(--v-theme-module-edge));
}

[data-theme='dark'] .preview-card {
  box-shadow: 0 0 0 1px rgb(var(--v-theme-panel-line));
}

.preview-banner {
  display: block;
  width: 100%;
  height: 110px;
  object-fit: cover;
}

.preview-body {
  padding: 10px 12px 12px;
}

.preview-name {
  font-size: var(--v-text-13);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.preview-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin-top: 2px;
  font-size: var(--v-text-11);
  line-height: 1.4;
  color: rgb(var(--v-theme-muted));
}

.designs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}

.design {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 12px;
  border: 2px solid rgb(var(--v-theme-row-edge));
  border-radius: var(--v-radius-card);
  background: rgb(var(--v-theme-row));
  cursor: pointer;
}

.design--selected {
  border-color: rgb(var(--v-theme-primary));
}

.design:has(input:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

/* everything inside reads the previewed design's variables */
.design-preview {
  display: flex;
  flex-direction: column;
  height: 104px;
  overflow: hidden;
  border-radius: calc(var(--v-radius-card) * 2 / 3);
  background: rgb(var(--v-theme-background));
}

.design-preview-bar {
  flex-shrink: 0;
  height: 12px;
  background: rgb(var(--v-theme-surface-variant));
  border-bottom: 1px solid rgb(var(--v-theme-bar-line));
}

.design-preview-modules {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 6px;
  padding: 6px;
}

.design-preview-module {
  display: flex;
  align-items: flex-end;
  padding: 6px;
  border-radius: calc(var(--v-radius-card) * 0.4);
  background: rgb(var(--v-theme-module));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-module-edge));
}

.design-preview-button {
  width: 34px;
  height: 12px;
  border-radius: calc(var(--v-radius-control) / 2);
  background: rgb(var(--v-theme-primary));
}

.design-preview-text {
  align-items: center;
  justify-content: center;
  font-family: var(--v-font);
  font-size: var(--v-text-20);
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
}

.design-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--v-text-14);
  font-weight: 600;
}

.design-name input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: rgb(var(--v-theme-primary));
}

.design-preview--custom {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1.5px dashed rgb(var(--v-theme-dashed));
  background: transparent;
  color: rgb(var(--v-theme-muted));
}

.custom-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
}

.custom-dot--1 {
  background: rgb(var(--v-theme-primary));
}

.custom-dot--2 {
  background: rgb(var(--v-theme-warning));
}

.custom-dot--3 {
  background: rgb(var(--v-theme-success));
}

.design-hint {
  font-size: var(--v-text-12);
  line-height: 1.45;
  color: rgb(var(--v-theme-muted));
}

.custom-design {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
}

.custom-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--v-radius-row);
  background: rgb(var(--v-theme-info-tint));
  color: rgb(var(--v-theme-info));
  font-size: var(--v-text-13);
  line-height: 1.45;
}

.custom-note .v-icon {
  margin-top: 2px;
}

.custom-current {
  margin: 0;
  font-size: var(--v-text-13);
}

.custom-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.custom-file {
  display: none;
}

.custom-error {
  margin: 0;
  font-size: var(--v-text-13);
  color: rgb(var(--v-theme-error));
}

.custom-ignored {
  padding: 10px 12px;
  border-radius: var(--v-radius-row);
  background: rgb(var(--v-theme-warning-tint));
  color: rgb(var(--v-theme-warning));
  font-size: var(--v-text-12);
  line-height: 1.5;
}

.custom-ignored p {
  margin: 0 0 4px;
  font-weight: 600;
}

.custom-ignored ul {
  margin: 0;
  padding-inline-start: 18px;
}

.custom-ignored code {
  font-family: 'JetBrains Mono Variable', monospace;
  overflow-wrap: anywhere;
}

.rooms-num {
  max-width: 120px;
}

/* the box lines up with the field edge above, the hint with the label */
.teacher-moves {
  margin-top: 12px;
  margin-inline-start: -6px;
}

.teacher-moves :deep(.v-label) {
  font-size: var(--v-text-13);
  font-weight: 500;
  opacity: 1;
}

.teacher-moves-hint {
  margin: -4px 0 0;
  padding-inline-start: 22px;
  font-size: var(--v-text-12);
  line-height: 1.4;
  color: rgb(var(--v-theme-muted));
}

@media (max-width: 599px) {
  .class-fields {
    grid-template-columns: 1fr;
  }
}
</style>
