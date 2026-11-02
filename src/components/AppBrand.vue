<template>
  <a href="./" title="Back to index-page" class="app-brand">
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="12.5" rx="10.5" ry="4.2" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(14 12 12.5)"></ellipse>
      <circle cx="7.8" cy="7.4" r="3.5" fill="currentColor"></circle>
      <circle cx="15.2" cy="15.6" r="5" fill="currentColor"></circle>
    </svg>
    edrys-lite
  </a>
</template>

<script lang="ts">
// The logo mark and name in the app bar, a link to the classroom list.
export default {
  name: "AppBrand",
};
</script>

<style scoped>
.app-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.app-brand:focus-visible {
  outline: 2px solid rgb(var(--v-theme-bar-icon));
  outline-offset: 2px;
}
</style>
