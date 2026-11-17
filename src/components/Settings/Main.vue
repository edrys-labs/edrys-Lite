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
      v-for="design in designs"
      :key="design"
      class="design"
      :class="{ 'design--selected': design === selectedDesign }"
    >
      <!-- a small classroom in that design's own colors and corners: Vuetify
           sets each theme's variables on its v-theme--<name> class -->
      <div :class="['design-preview', 'v-theme--' + themeName(design, activeTheme)]" aria-hidden="true">
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
import { DESIGNS, activeTheme, themeName } from "../../ts/Theme";

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
    return { t, locale, activeTheme, themeName, designs: DESIGNS };
  },

  computed: {
    // classes from before designs, or with an unknown one, show as Standard
    selectedDesign(): string {
      const design = this.config.meta?.design;
      return DESIGNS.includes(design) ? design : "standard";
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

.design-hint {
  font-size: var(--v-text-12);
  line-height: 1.45;
  color: rgb(var(--v-theme-muted));
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
