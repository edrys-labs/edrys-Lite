<template>
  <v-alert outlined dense type="info" text="Invite your users in by sharing this link: ">
    <v-container>
      <a :href="url">{{ url }}</a>
    </v-container>

    <template v-slot:append>
      <v-btn icon="mdi-content-copy" @click="copyUrl" variant="text"></v-btn>
    </template>
  </v-alert>
  <v-divider></v-divider>
  <v-textarea
    label="List of teacher ids"
    auto-grow
    variant="outlined"
    rows="3"
    row-height="25"
    shaped
    style="margin-top: 2rem"
    v-model="teacher"
    :disabled="writeProtection"
  ></v-textarea>
</template>

<script lang="ts">
import { copyToClipboard } from "../../ts/Utils";

export default {
  name: "Settings-Members",

  emits: ["updateMembers"],

  props: {
    members: {
      type: Object,
      required: true,
    },

    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  data() {
    const teacher = this.members.teacher.join(", ");

    return {
      url: window.location.toString(),
      teacher,
    };
  },

  methods: {
    copyUrl() {
      copyToClipboard(this.url);
    },
  },

  watch: {
    teacher() {
      this.$emit("updateMembers", {
        teacher: this.teacher
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        student: this.members.student,
      });
    },
  },
};
</script>
