<template>
  <v-alert outlined dense type="info" :text="t('settings.members.info')">
    <v-container>
      <a :href="url">{{ url }}</a>
    </v-container>

    <template v-slot:append>
      <v-btn icon="mdi-content-copy" @click="copyUrl" variant="text"></v-btn>
    </template>
  </v-alert>
  <v-divider></v-divider>
  <v-textarea
    :label="t('settings.members.teacherIds')"
    auto-grow
    variant="outlined"
    rows="3"
    row-height="25"
    shaped
    style="margin-top: 2rem"
    v-model="teacher"
    :disabled="writeProtection"
  ></v-textarea>

  <v-textarea
    :label="t('settings.members.studentIds')"
    auto-grow
    variant="outlined"
    rows="3"
    row-height="25"
    shaped
    style="margin-top: 0px"
    v-model="student"
    :disabled="writeProtection"
  ></v-textarea>
</template>

<script lang="ts">
import { copyToClipboard } from "../../ts/Utils";
import { useI18n } from 'vue-i18n';

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

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    const teacher = this.members.teacher.join(", ");
    const student = this.members.student.join(", ");

    return {
      url: window.location.toString(),
      teacher,
      student,
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

    student() {
      this.$emit("updateMembers", {
        student: this.student
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        teacher: this.members.teacher,
      });
    },
  },
};
</script>
