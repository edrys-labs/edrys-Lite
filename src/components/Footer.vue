<script lang="ts">
export default {
  name: "Footer",
  data() {
    return {};
  },
};
</script>

<template>
  <v-footer color="surface-variant" :app="true" elevation="15">
    <v-row justify="center" no-gutters>
      <v-tooltip text="edrys-Lite on GitHub" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            density="compact"
            icon="mdi-github"
            href="https://github.com/edrys-labs/edrys-Lite/"
            target="_"
            class="mx-2"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>

      <v-tooltip text="View the Documentation" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            density="compact"
            icon="mdi-information"
            href="https://github.com/edrys-labs/documentation"
            target="_"
            class="mx-2"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>

      <v-tooltip text="Explore Classrooms" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            density="compact"
            icon="mdi-share-circle"
            href="https://github.com/topics/edrys-classroom"
            target="_"
            class="mx-2"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>
    </v-row>
  </v-footer>
</template>
