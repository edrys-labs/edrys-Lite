<template>
  <v-text-field
    v-model="config.name"
    :counter="20"
    label="Class Name"
    outlined
    required
    :disabled="writeProtection"
  ></v-text-field>

  <v-text-field
    v-model="config.meta.logo"
    label="Logo URL"
    outlined
    required
    :disabled="writeProtection"
  ></v-text-field>

  <v-textarea
    v-model="config.meta.description"
    filled
    label="Description"
    auto-grow
    :disabled="writeProtection"
  ></v-textarea>

  <v-text-field
    v-model="config.meta.defaultNumberOfRooms"
    label="Default number of rooms (optional)"
    type="number"
    outlined
    :disabled="writeProtection"
  ></v-text-field>

  <v-checkbox
    v-model="config.meta.selfAssign"
    label="Enable self-assignment"
    outlined
    :disabled="writeProtection"
  ></v-checkbox>
</template>

<script lang="ts">
export default {
  name: "Settings-Main",

  props: {
    config: {
      type: Object,
      required: true,
    },

    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  data() {
    return {};
  },
};
</script>
