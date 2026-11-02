<template>
  <v-alert color="info" icon="mdi-information-outline" :text="t('settings.members.info')">
    <a :href="url" class="alert-link">{{ url }}</a>
    <!-- edrys-dev: the link above is on the students' site, this page's only works here -->
    <div v-if="url !== localUrl" class="alert-more">
      {{ t('settings.members.devLocalOnly') }}
      <a :href="localUrl" class="alert-link">{{ localUrl }}</a>
    </div>
    <div v-if="noStudents" class="alert-more">{{ t('settings.members.devNoStudents') }}</div>

    <template v-slot:append>
      <v-btn
        icon="mdi-content-copy"
        size="30"
        variant="text"
        class="alert-copy"
        :aria-label="t('general.copyLink')"
        @click="copyUrl"
      ></v-btn>
    </template>
  </v-alert>
  <FieldLabel :label="t('settings.members.teacherIds')" class="mt-6">
    <v-textarea
      :hint="t('settings.members.fullKeyHint')"
      auto-grow
      rows="3"
      row-height="25"
      class="ids"
      v-model="teacher"
    ></v-textarea>
  </FieldLabel>

  <FieldLabel :label="t('settings.members.studentIds')" class="mt-2">
    <v-textarea
      :hint="t('settings.members.fullKeyHint')"
      auto-grow
      rows="3"
      row-height="25"
      class="ids"
      v-model="student"
    ></v-textarea>
  </FieldLabel>
</template>

<script lang="ts">
import { copyToClipboard } from "../../ts/Utils";
import { studentLink } from "../../ts/DevBridge";
import { useI18n } from 'vue-i18n';
import FieldLabel from "../FieldLabel.vue";

export default {
  name: "Settings-Members",
  components: { FieldLabel },

  emits: ["updateMembers"],

  props: {
    members: {
      type: Object,
      required: true,
    },
    classId: {
      type: String,
      default: "",
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    const teacher = this.members.teacher.join(", ");
    const student = this.members.student.join(", ");
    const localUrl = window.location.toString();
    const forStudents = studentLink(localUrl, this.classId);

    return {
      url: forStudents ?? localUrl,
      localUrl,
      // edrys-dev --local: nobody on another machine can join
      noStudents: forStudents === null,
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
