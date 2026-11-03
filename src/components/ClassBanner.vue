<template>
  <img v-if="logo && !broken" :src="logo" alt="" @error="broken = true" />
  <svg v-else class="class-art" viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect x="-100" y="-100" width="400" height="300" :fill="art.background" />
    <line
      v-for="(line, i) in art.lines"
      :key="'l' + i"
      :x1="line.x1"
      :y1="line.y1"
      :x2="line.x2"
      :y2="line.y2"
      :stroke="line.color"
      stroke-width="1.4"
      stroke-linecap="round"
    />
    <circle
      v-for="(dot, i) in art.dots"
      :key="'d' + i"
      :cx="dot.cx"
      :cy="dot.cy"
      :r="dot.r"
      :fill="dot.fill"
      :stroke="art.background"
      :stroke-width="dot.ring"
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
