<template>
  <div :class="['advanced-row', { open, failed: !!error }]">
    <button
      type="button"
      class="row-head"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="bodyId"
      @click="$emit('toggle')"
    >
      <span class="row-icon" :style="{ background: tile.bg, color: tile.fg }" aria-hidden="true">
        <v-icon :icon="icon" size="18"></v-icon>
      </span>
      <span class="row-words">
        <span class="row-title">{{ title }}</span>
        <!-- bdi: a URL or a list keeps its own order inside right-to-left text -->
        <span :class="['row-summary', { mono }]"><bdi>{{ summary }}</bdi></span>
      </span>
      <span v-if="error" class="error-pill">
        <v-icon icon="mdi-alert-circle-outline" size="14"></v-icon>
        {{ t('settings.modules.tooltip.invalidConfig') }}
      </span>
      <v-icon :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="18" class="row-chevron"></v-icon>
    </button>
    <!-- v-show: the editors keep what was typed, even text that is not valid yet -->
    <div v-show="open" :id="bodyId" class="row-body">
      <slot></slot>
    </div>
  </div>
</template>

<script lang="ts">
import { useI18n } from "vue-i18n";
import { activeTheme, roomTile } from "../../ts/Theme";

let rowCount = 0;

/** One part of a module's raw settings: a head with a summary of its value, opening to the editor below. */
export default {
  name: "AdvancedRow",

  emits: ["toggle"],

  props: {
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    icon: { type: String, required: true },
    // a slot of the room palette (ROOM_COLORS)
    color: { type: Number, default: 1 },
    open: { type: Boolean, default: false },
    error: { type: String, default: "" },
    mono: { type: Boolean, default: false },
  },

  setup() {
    const { t } = useI18n();
    return { t };
  },

  data() {
    return { bodyId: `advanced-row-${++rowCount}` };
  },

  computed: {
    tile() {
      return roomTile(this.color, activeTheme.value);
    },
  },
};
</script>

<style scoped>
.advanced-row {
  border-radius: 10px;
  background: rgb(var(--v-theme-row));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-row-edge));
}

.advanced-row.failed {
  box-shadow: 0 0 0 1px rgb(var(--v-theme-danger-line));
}

.row-head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding-block: 8px;
  padding-inline: 8px 12px;
  border-radius: 10px;
  text-align: start;
  color: rgb(var(--v-theme-on-surface));
}

.row-head:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.row-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.row-words {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.row-title {
  font-size: 14px;
  font-weight: 600;
}

.row-summary {
  overflow: hidden;
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
  white-space: nowrap;
  text-overflow: ellipsis;
}

.row-summary.mono {
  font-family: "JetBrains Mono Variable", monospace;
}

.error-pill {
  display: inline-flex;
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

.row-chevron {
  flex-shrink: 0;
  color: rgb(var(--v-theme-muted));
}

/* in line with the title, past the icon tile */
.row-body {
  padding-block: 4px 16px;
  padding-inline: 52px 16px;
}

/* a phone has no width to spare for the indent */
@media (max-width: 599px) {
  .row-body {
    padding-inline: 12px;
  }
}
</style>
