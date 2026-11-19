<template>
  <SectionHead
    :title="t('settings.design.title')"
    :text="t('settings.design.text')"
    icon="mdi-palette-outline"
    :color="3"
  />

  <div role="radiogroup" :aria-label="t('settings.design.title')" class="designs">
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
        {{ t('settings.design.designs.' + design + '.name') }}
      </span>
      <span :id="'design-hint-' + design" class="design-hint">{{ t('settings.design.designs.' + design + '.hint') }}</span>
    </label>
  </div>

  <div v-if="selectedDesign === 'custom'" class="custom-design">
    <p class="custom-note">
      <v-icon icon="mdi-information-outline" size="16"></v-icon>
      {{ t('settings.design.custom.note') }}
    </p>

    <p v-if="customCheck" class="custom-current">
      <strong>{{ customCheck.design.name || t('settings.design.designs.custom.name') }}</strong>
      · {{ t('settings.design.custom.basedOn', { base: t('settings.design.designs.' + customCheck.design.base + '.name') }) }}
    </p>

    <div class="custom-form">
      <FieldLabel :label="t('settings.design.custom.form.base')">
        <v-btn-toggle
          :model-value="form.design.base"
          mandatory
          divided
          variant="outlined"
          class="custom-toggle custom-base"
          @update:model-value="setBase"
        >
          <v-btn v-for="design in designs" :key="design" :value="design">
            {{ t('settings.design.designs.' + design + '.name') }}
          </v-btn>
        </v-btn-toggle>
      </FieldLabel>

      <FieldLabel :label="t('settings.design.custom.form.font')">
        <v-btn-toggle
          :model-value="formFont"
          mandatory
          divided
          variant="outlined"
          class="custom-toggle custom-font"
          @update:model-value="setFont"
        >
          <!-- each name in its own font -->
          <v-btn v-for="(stack, font) in fonts" :key="font" :value="font" :style="{ fontFamily: stack }">
            {{ fontNames[font] }}
          </v-btn>
        </v-btn-toggle>
      </FieldLabel>

      <FieldLabel :label="t('settings.design.custom.form.colors')">
        <v-btn-toggle
          :model-value="activeTheme"
          mandatory
          divided
          variant="outlined"
          class="custom-toggle custom-half"
          @update:model-value="setHalf"
        >
          <v-btn value="light" prepend-icon="mdi-white-balance-sunny">{{ t('general.theme.light') }}</v-btn>
          <v-btn value="dark" prepend-icon="mdi-weather-night">{{ t('general.theme.dark') }}</v-btn>
        </v-btn-toggle>
      </FieldLabel>

      <div class="custom-colors">
        <div v-for="field in colorFields" :key="field.key" :class="['custom-color', 'custom-color--' + field.key]">
          <input
            :id="'custom-color-' + field.key"
            type="color"
            :value="formColor(field.key)"
            @input="onColorInput(field.key, $event)"
          />
          <label :for="'custom-color-' + field.key">
            {{ t('settings.design.custom.form.' + field.label) }}
            <span class="custom-hex">{{ formColor(field.key) }}</span>
          </label>
          <v-btn
            v-if="form.design.colors[activeTheme][field.key]"
            icon="mdi-restore"
            size="small"
            variant="text"
            class="custom-reset"
            :aria-label="t('settings.design.custom.form.reset', { base: t('settings.design.designs.' + form.design.base + '.name') })"
            :title="t('settings.design.custom.form.reset', { base: t('settings.design.designs.' + form.design.base + '.name') })"
            @click="resetColor(field.key)"
          ></v-btn>
        </div>
      </div>

      <FieldLabel :label="t('settings.design.custom.form.corners')" class="custom-wide">
        <v-btn-toggle
          :model-value="cornerStep"
          divided
          variant="outlined"
          class="custom-toggle custom-corners"
          @update:model-value="setStep('corners', $event)"
        >
          <v-btn v-for="(name, i) in cornerSteps" :key="name" :value="i">
            {{ t('settings.design.custom.form.cornerSteps.' + name) }}
          </v-btn>
        </v-btn-toggle>
      </FieldLabel>

      <FieldLabel :label="t('settings.design.custom.form.text')" class="custom-wide">
        <v-btn-toggle
          :model-value="textStep"
          divided
          variant="outlined"
          class="custom-toggle custom-text"
          @update:model-value="setStep('text', $event)"
        >
          <v-btn v-for="(name, i) in textSteps" :key="name" :value="i">
            {{ t('settings.design.custom.form.textSteps.' + name) }}
          </v-btn>
        </v-btn-toggle>
      </FieldLabel>
    </div>

    <p class="custom-more">{{ t('settings.design.custom.more') }}</p>

    <div class="custom-actions">
      <v-btn variant="outlined" height="36" prepend-icon="mdi-upload" @click="openDesignFile">
        {{ t('settings.design.custom.upload') }}
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
      {{ t('settings.design.custom.errors.' + uploadError) }}
    </p>

    <div v-if="customCheck?.ignored.length" class="custom-ignored" role="status">
      <p>{{ t('settings.design.custom.ignored') }}</p>
      <ul>
        <li v-for="entry in customCheck.ignored" :key="entry.path">
          <code>{{ entry.path }}</code> — {{ t('settings.design.custom.reasons.' + entry.reason) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import { useI18n } from 'vue-i18n';
import FieldLabel from "../FieldLabel.vue";
import SectionHead from "./SectionHead.vue";
import { DESIGNS, FONTS, activeTheme, designs, previewTheme, themeName, type Design, type DesignChoice } from "../../ts/Theme";
import {
  NORMAL_STEP,
  checkDesign,
  currentStep,
  readDesignFile,
  readableOn,
  steppedCorners,
  steppedText,
  type DesignFileError,
} from "../../ts/CustomDesign";

const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

// the colors the form changes; the text on them follows (black or white)
const COLOR_FIELDS = [
  { key: "primary", label: "primary", textOn: ["on-primary"] },
  { key: "background", label: "background", textOn: ["on-background"] },
  { key: "surface-variant", label: "bar", textOn: ["on-surface-variant", "bar-icon"] },
];

// a font's own name, the same in every language
const FONT_NAMES: Record<keyof typeof FONTS, string> = {
  "noto-sans": "Noto Sans",
  "ibm-plex-sans": "IBM Plex Sans",
  fredoka: "Fredoka",
};

/** `obj[key]` as an object, made one if it isn't. */
function section(obj: Record<string, any>, key: string): Record<string, any> {
  if (!isRecord(obj[key])) obj[key] = {};
  return obj[key];
}

export default {
  name: "Settings-Design",
  components: { FieldLabel, SectionHead },

  props: {
    config: {
      type: Object,
      required: true,
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return {
      t,
      locale,
      activeTheme,
      themeName,
      designs: DESIGNS,
      choices: [...DESIGNS, "custom"] as DesignChoice[],
      fonts: FONTS,
      fontNames: FONT_NAMES,
      colorFields: COLOR_FIELDS,
      cornerSteps: ["square", "less", "normal", "more", "round"],
      textSteps: ["smaller", "small", "normal", "large", "larger"],
    };
  },

  beforeUnmount() {
    previewTheme.value = null;
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
    // what the form shows: the class's own design, or plain Standard before anything is set
    form() {
      return this.customCheck ?? checkDesign({});
    },
    formFont(): string {
      const font = this.form.design.variables.font ?? designs[this.form.design.base as Design].light.variables?.font;
      return Object.keys(FONTS).find((key) => FONTS[key as keyof typeof FONTS] === font) ?? "noto-sans";
    },
    cornerStep(): number | null {
      return currentStep(this.form.design, "corners");
    },
    textStep(): number | null {
      return currentStep(this.form.design, "text");
    },
  },

  methods: {
    // the class's own design as written, made an empty one if there is none
    custom(): Record<string, any> {
      return section(this.config.meta, "customDesign");
    },

    setBase(base: Design) {
      // corners and text stay at their step, now of the new base
      const corners = this.cornerStep;
      const text = this.textStep;
      this.custom().base = base;
      if (corners !== null && corners !== NORMAL_STEP) this.setStep("corners", corners);
      if (text !== null && text !== NORMAL_STEP) this.setStep("text", text);
    },

    setFont(font: string) {
      this.custom().font = font;
    },

    setHalf(half: "light" | "dark") {
      previewTheme.value = half;
    },

    formColor(key: string): string {
      const half = activeTheme.value;
      return this.form.design.colors[half][key] ?? designs[this.form.design.base as Design][half].colors![key];
    },

    setColor(key: string, color: string) {
      const field = COLOR_FIELDS.find((f) => f.key === key)!;
      const colors = section(section(this.custom(), activeTheme.value), "colors");
      colors[key] = color;
      for (const on of field.textOn) colors[on] = readableOn(color);
    },

    onColorInput(key: string, event: Event) {
      this.setColor(key, (event.target as HTMLInputElement).value);
    },

    resetColor(key: string) {
      const field = COLOR_FIELDS.find((f) => f.key === key)!;
      const colors = section(section(this.custom(), activeTheme.value), "colors");
      for (const name of [key, ...field.textOn]) delete colors[name];
    },

    // a step writes all corner radii or text sizes; Normal leaves the base's
    setStep(kind: "corners" | "text", step: number | undefined) {
      const group = section(this.custom(), kind === "corners" ? "shape" : "text");
      const base = this.form.design.base as Design;
      const values = (kind === "corners" ? steppedCorners : steppedText)(base, step ?? NORMAL_STEP);
      for (const [key, value] of Object.entries(values)) {
        if (step === undefined || step === NORMAL_STEP) delete group[key];
        else group[key] = value;
      }
    },

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

.custom-form {
  display: grid;
  gap: 4px 24px;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
}

.custom-toggle {
  flex-wrap: wrap;
  row-gap: 4px;
  /* Vuetify's group has a fixed height and clips, which hides wrapped rows */
  height: auto !important;
  overflow: visible;
  max-width: 100%;
}

/* a fixed height, so the buttons wrap into clean rows on narrow screens */
.custom-toggle .v-btn {
  height: 36px !important;
  font-size: var(--v-text-13);
  letter-spacing: normal;
  text-transform: none;
}

.custom-wide {
  grid-column: 1 / -1;
}

.custom-colors {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.custom-color {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 6px 6px 8px;
  border: 1px solid rgb(var(--v-theme-row-edge));
  border-radius: var(--v-radius-row);
  background: rgb(var(--v-theme-row));
}

.custom-color input[type='color'] {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid rgb(var(--v-theme-line));
  border-radius: var(--v-radius-control);
  background: none;
  cursor: pointer;
}

.custom-color input[type='color']:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.custom-color label {
  flex: 1;
  display: flex;
  flex-direction: column;
  font-size: var(--v-text-13);
  font-weight: 500;
  cursor: pointer;
}

.custom-hex {
  font-family: 'JetBrains Mono Variable', monospace;
  font-size: var(--v-text-11);
  font-weight: 400;
  color: rgb(var(--v-theme-muted));
}

.custom-more {
  margin: 0;
  font-size: var(--v-text-12);
  line-height: 1.45;
  color: rgb(var(--v-theme-muted));
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
</style>
