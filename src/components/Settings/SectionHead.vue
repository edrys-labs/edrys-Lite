<template>
  <div class="section-head">
    <span class="section-icon" :style="{ background: tile.bg, color: tile.fg }" aria-hidden="true">
      <v-icon :icon="icon" size="18"></v-icon>
    </span>
    <div class="section-words">
      <h3 class="section-title">{{ title }}</h3>
      <p v-if="text" class="section-text">{{ text }}</p>
    </div>
  </div>
</template>

<script lang="ts">
import { activeTheme, roomTile } from "../../ts/Theme";

/** A Settings section's title and one line of text, after an icon tile in one of the room colors. */
export default {
  name: "SectionHead",

  props: {
    title: { type: String, required: true },
    text: { type: String, default: "" },
    icon: { type: String, required: true },
    // a slot of the room palette (ROOM_COLORS)
    color: { type: Number, default: 1 },
  },

  computed: {
    tile() {
      return roomTile(this.color, activeTheme.value);
    },
  },
};
</script>

<style scoped>
.section-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}

.section-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.section-title {
  margin: 0 0 2px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
}

.section-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--v-theme-text-2));
}
</style>
