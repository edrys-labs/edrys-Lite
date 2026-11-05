<template>
  <img v-if="logo && !broken" :src="logo" alt="" @error="broken = true" />
  <!-- the whole picture fits in the box and the ground fills the rest, so no
       peer is cut off whatever the card's width; `cover` fills a small
       square instead, where a fitted picture would be tiny -->
  <svg
    v-else
    class="class-art"
    viewBox="0 0 200 100"
    :preserveAspectRatio="cover ? 'xMidYMid slice' : 'xMidYMid meet'"
    aria-hidden="true"
  >
    <rect x="-1000" y="-1000" width="2200" height="2100" :fill="art.background" />
    <line
      v-for="(line, i) in art.lines"
      :key="'l' + i"
      :x1="line.x1"
      :y1="line.y1"
      :x2="line.x2"
      :y2="line.y2"
      :stroke="line.color"
      stroke-width="1.6"
      stroke-linecap="round"
    />
    <circle
      v-for="(dot, i) in art.dots"
      :key="'d' + i"
      :cx="dot.cx"
      :cy="dot.cy"
      :r="dot.r"
      :fill="dot.fill"
    />
  </svg>
</template>

<script lang="ts">
import { classArt } from "../ts/ClassArt";
import { activeTheme } from "../ts/Theme";

/** A class's logo, or its picture from the class id when there is none or it fails to load. */
export default {
  name: "ClassBanner",

  props: {
    id: { type: String, default: "" },
    logo: { type: String, default: "" },
    cover: { type: Boolean, default: false },
  },

  data() {
    return { broken: false };
  },

  computed: {
    art() {
      return classArt(this.id, activeTheme.value);
    },
  },

  watch: {
    // a new address gets a new try
    logo() {
      this.broken = false;
    },
  },
};
</script>
