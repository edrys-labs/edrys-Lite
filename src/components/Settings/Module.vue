<template>
  <div class="advanced">
    <AdvancedRow
      :title="t('settings.modules.module.url.title')"
      :summary="module.url"
      icon="mdi-link-variant"
      :color="1"
      mono
      :open="open === 'url'"
      @toggle="toggle('url')"
    >
      <FieldLabel :label="t('settings.modules.module.url.urlLabel')">
        <v-text-field v-model="module.url" hide-details class="mono ltr"></v-text-field>
      </FieldLabel>
    </AdvancedRow>

    <AdvancedRow
      :title="t('settings.modules.module.design.title')"
      :summary="designSummary"
      icon="mdi-page-layout-body"
      :color="3"
      :open="open === 'design'"
      @toggle="toggle('design')"
    >
      <div class="design">
        <div v-for="group in designGroups" :key="group.key" class="design-group">
          <span :id="'design-' + group.key" class="field-label">{{ group.label }}</span>
          <div role="radiogroup" :aria-labelledby="'design-' + group.key" class="segments">
            <label
              v-for="option in group.options"
              :key="option.value"
              :class="['segment', { selected: group.selected === option.value }]"
            >
              <input
                type="radio"
                :name="'design-' + group.key + '-' + uid"
                :value="option.value"
                :checked="group.selected === option.value"
                @change="group.select(option.value)"
              />
              {{ option.label }}
            </label>
          </div>
          <FieldLabel v-if="group.selected === 'custom'" :label="group.customLabel">
            <v-text-field
              v-model.number="group.custom.value"
              type="number"
              min="1"
              hide-details
              class="custom-size"
            ></v-text-field>
          </FieldLabel>
        </div>
      </div>
    </AdvancedRow>

    <AdvancedRow
      v-for="editor in editors"
      :key="editor.key"
      :title="editor.title"
      :summary="configSummary(module[editor.key])"
      :icon="editor.icon"
      :color="editor.color"
      :error="error[editor.key] || ''"
      :open="open === editor.key"
      @toggle="toggle(editor.key)"
    >
      <Editor v-model:config="module[editor.key]" v-model:error="error[editor.key]"></Editor>
    </AdvancedRow>

    <AdvancedRow
      :title="t('settings.modules.module.showIn.title')"
      :summary="showInSummary"
      icon="mdi-eye-outline"
      :color="6"
      mono
      :open="open === 'showIn'"
      @toggle="toggle('showIn')"
    >
      <span id="show-in-places" class="field-label">{{ t('settings.modules.module.showIn.places') }}</span>
      <div class="places" role="group" aria-labelledby="show-in-places">
        <button
          v-for="place in places"
          :key="place.token"
          type="button"
          :class="['place', { on: place.on }]"
          :aria-pressed="place.on ? 'true' : 'false'"
          @click="togglePlace(place.token)"
        >
          <span class="place-mark" :style="{ background: place.tile.bg, color: place.tile.fg }" aria-hidden="true">
            {{ place.mark }}
          </span>
          {{ place.label }}
          <v-icon v-if="place.on" icon="mdi-check" size="15"></v-icon>
        </button>
      </div>
      <FieldLabel :label="t('settings.modules.module.showIn.textLabel')" class="mt-3">
        <v-text-field
          v-model="module.showInCustom"
          :hint="t('settings.modules.module.showIn.label')"
          persistent-hint
          class="mono ltr"
        ></v-text-field>
      </FieldLabel>
    </AdvancedRow>
  </div>
</template>

<script lang="ts">
import Editor from "./Editor.vue";
import AdvancedRow from "./AdvancedRow.vue";
import { activeTheme, roomTile } from "../../ts/Theme";
import { roomLabel, showInWithLabels } from "../../ts/RoomNames";
import { roomSlot } from "../../ts/Utils";
import type { PropType } from "vue";
import FieldLabel from "../FieldLabel.vue";
import { useI18n } from 'vue-i18n';

let moduleCount = 0;

const WIDTHS = ["full", "half", "third", "custom"];
const HEIGHTS = ["huge", "tall", "medium", "short", "custom"];

const tokensOf = (showIn: string) =>
  (showIn || "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
const isRole = (token: string) => token.toLowerCase().endsWith("-only");

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
    // the class's rooms in the drawer's order, for the "Show in" buttons
    rooms: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    roomNames: Object as PropType<Record<string, string>>,
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
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

    return { customWidth, customHeight, open: null as string | null, uid: ++moduleCount };
  },

  computed: {
    editors() {
      return [
        { key: "config", title: this.t("settings.modules.module.generalSettings"), icon: "mdi-tune-variant", color: 4 },
        { key: "studentConfig", title: this.t("settings.modules.module.studentSettings"), icon: "mdi-account-outline", color: 0 },
        { key: "teacherConfig", title: this.t("settings.modules.module.teacherSettings"), icon: "mdi-school-outline", color: 2 },
        { key: "stationConfig", title: this.t("settings.modules.module.stationSettings"), icon: "mdi-router-wireless", color: 5 },
      ];
    },

    designGroups() {
      const d = "settings.modules.module.design.";
      const label = (kind: string, value: string) =>
        this.t(d + kind + "." + (value === "custom" ? "custom.title" : value === "third" ? "quarter" : value));
      const vm = this;
      return [
        {
          key: "width",
          label: this.t(d + "width.title"),
          customLabel: this.t(d + "width.custom.label"),
          selected: this.widthSelection,
          select: (value: string) => (this.widthSelection = value),
          options: WIDTHS.map((value) => ({ value, label: label("width", value) })),
          custom: { get value() { return vm.customWidth; }, set value(v) { vm.customWidth = v; } },
        },
        {
          key: "height",
          label: this.t(d + "height.title"),
          customLabel: this.t(d + "height.custom.label"),
          selected: this.heightSelection,
          select: (value: string) => (this.heightSelection = value),
          options: HEIGHTS.map((value) => ({ value, label: label("height", value) })),
          custom: { get value() { return vm.customHeight; }, set value(v) { vm.customHeight = v; } },
        },
      ];
    },

    designSummary() {
      const [width, height] = this.designGroups.map((group) => {
        const option = group.options.find((o) => o.value === group.selected);
        // isolated, so "600 px" stays in that order in right-to-left text
        return group.selected === "custom" ? `\u2066${group.custom.value} px\u2069` : option?.label;
      });
      return this.t("settings.modules.module.design.summary", { width, height });
    },

    showInSummary(): string {
      return showInWithLabels(this.module.showInCustom, this.roomNames);
    },

    // the buttons above the "Show in" text: everywhere, the Lobby, each room, the stations
    places() {
      const tokens = tokensOf(this.module.showInCustom).map((s) => s.toLowerCase());
      const placeTokens = tokens.filter((token) => !isRole(token));
      const rooms = this.rooms as string[];
      const theme = activeTheme.value;
      const firstStation = rooms.find((room) => room.startsWith("Station "));
      const place = (token: string, label: string, mark: string, slot: number | null) => ({
        token,
        label,
        mark,
        tile: roomTile(slot, theme),
        on:
          token === "*"
            ? !placeTokens.length || placeTokens.includes("*")
            : placeTokens.includes(token.toLowerCase()) || placeTokens.includes(label.toLowerCase()),
      });
      return [
        place("*", this.t("settings.modules.module.showIn.all"), "*", null),
        place("lobby", this.t("classroom.sideMenu.lobby"), this.t("classroom.sideMenu.lobby").charAt(0), null),
        ...rooms
          .filter((room) => room !== "Lobby" && !room.startsWith("Station "))
          .map((room) => {
            const label = roomLabel(this.roomNames, room);
            const mark = label ? label.charAt(0).toUpperCase() : room.split(" ").pop()!.charAt(0);
            // the button shows the label but saves the internal name, which a later rename can't break
            return place(room, label ?? room, mark, roomSlot(room, rooms));
          }),
        place("station", this.t("classroom.sideMenu.station"), this.t("classroom.sideMenu.station").charAt(0),
          firstStation ? roomSlot(firstStation, rooms) : null),
      ];
    },

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

  methods: {
    // one part open at a time
    toggle(key: string) {
      this.open = this.open === key ? null : key;
    },

    configSummary(config: any) {
      const s = "settings.modules.module.summary.";
      if (config && typeof config === "object") {
        const keys = Object.keys(config);
        if (!keys.length) return this.t(s + "empty");
        return this.t(s + "keys", { n: keys.length, keys: keys.join(", ") }, keys.length);
      }
      if (typeof config === "string" && config.trim()) return this.t(s + "text");
      return this.t(s + "empty");
    },

    // "*" stands for every place, so it replaces the others and the others replace it;
    // teacher-only and station-only are kept as they are
    togglePlace(token: string) {
      const tokens = tokensOf(this.module.showInCustom);
      const roles = tokens.filter(isRole);
      let places = tokens.filter((t) => !isRole(t) && t !== "*");
      const names = [token, roomLabel(this.roomNames, token)].map((n) => n?.toLowerCase());
      const isThisPlace = (t: string) => names.includes(t.toLowerCase());
      if (token === "*") {
        places = [];
      } else if (places.some(isThisPlace)) {
        places = places.filter((t) => !isThisPlace(t));
      } else {
        places.push(token);
      }
      this.module.showInCustom = [...(places.length ? places : ["*"]), ...roles].join(", ");
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

  components: { Editor, FieldLabel, AdvancedRow },
};
</script>

<style scoped>
/* the panel around it brings the side padding */
.advanced {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

.mono :deep(input) {
  font-family: "JetBrains Mono Variable", monospace;
  font-size: 13px;
}

.design {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.segments {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  border-radius: 10px;
  background: rgb(var(--v-theme-tonal));
}

.segment {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  color: rgb(var(--v-theme-muted));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.segment.selected {
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.12), 0 0 0 1px rgb(var(--v-theme-row-edge));
  color: rgb(var(--v-theme-on-surface));
  font-weight: 600;
}

/* the native radio stays for keyboard and screen readers, the label is the look */
.segment input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.segment:has(input:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.custom-size {
  max-width: 160px;
  margin-top: 8px;
}

.places {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.place {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding-block: 0;
  padding-inline: 7px 12px;
  border: 1px solid rgb(var(--v-theme-field-line));
  border-radius: 999px;
  background: rgb(var(--v-theme-field));
  color: rgb(var(--v-theme-text-2));
  font-size: 13px;
  font-weight: 500;
}

.place.on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary-tint));
  color: rgb(var(--v-theme-primary-text));
}

.place:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.place-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
}
</style>
