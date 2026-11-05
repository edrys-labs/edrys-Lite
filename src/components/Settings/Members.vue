<template>
  <SectionHead :title="t('settings.members.linkTitle')" :text="t('settings.members.linkText')" icon="mdi-link-variant" :color="1" />

  <FieldLabel :label="t('settings.members.linkLabel')">
    <v-text-field :model-value="url" readonly class="class-link ltr" hide-details>
      <template v-slot:append-inner>
        <v-btn
          :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
          variant="text"
          density="comfortable"
          :aria-label="t('general.copyLink')"
          :title="t('general.copyLink')"
          @click="copyUrl"
        ></v-btn>
      </template>
    </v-text-field>
  </FieldLabel>

  <!-- edrys-dev: the link above is on the students' site, this page's only works here -->
  <p v-if="url !== localUrl" class="link-note">
    {{ t('settings.members.devLocalOnly') }}
    <a :href="localUrl" class="link-note-url">{{ localUrl }}</a>
  </p>
  <p v-if="noStudents" class="link-note">{{ t('settings.members.devNoStudents') }}</p>

  <v-divider class="my-5"></v-divider>

  <div class="roles">
    <section>
      <SectionHead :title="t('settings.members.teachersTitle')" :text="t('settings.members.teachersText')" icon="mdi-school-outline" :color="3" />
      <FieldLabel :label="t('settings.members.teacherKeys')">
        <v-textarea
          :hint="t('settings.members.keyHint')"
          persistent-hint
          rows="5"
          no-resize
          class="ids ltr"
          v-model="teacher"
        ></v-textarea>
      </FieldLabel>
    </section>

    <section>
      <SectionHead :title="t('settings.members.studentsTitle')" :text="t('settings.members.studentsText')" icon="mdi-account-outline" :color="0" />
      <FieldLabel :label="t('settings.members.studentKeys')">
        <v-textarea
          :hint="t('settings.members.keyHint')"
          persistent-hint
          rows="5"
          no-resize
          class="ids ltr"
          v-model="student"
        ></v-textarea>
      </FieldLabel>
    </section>
  </div>
</template>

<script lang="ts">
import { copyToClipboard } from "../../ts/Utils";
import { studentLink } from "../../ts/DevBridge";
import { useI18n } from 'vue-i18n';
import FieldLabel from "../FieldLabel.vue";
import SectionHead from "./SectionHead.vue";

export default {
  name: "Settings-Members",
  components: { FieldLabel, SectionHead },

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
      copied: false,
      teacher,
      student,
    };
  },

  methods: {
    copyUrl() {
      copyToClipboard(this.url);
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
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

<style scoped>
.class-link :deep(input),
.ids :deep(textarea) {
  font-family: "JetBrains Mono Variable", monospace;
}

.class-link :deep(input) {
  font-size: 13px;
}

.ids :deep(textarea) {
  font-size: 12px;
  line-height: 1.6;
}

.link-note {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--v-theme-muted));
}

.link-note-url {
  color: inherit;
  font-family: "JetBrains Mono Variable", monospace;
  word-break: break-all;
}

.roles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

/* the text takes the leftover height, so both key fields line up */
.roles section {
  display: flex;
  flex-direction: column;
}

.roles section > :first-child {
  flex: 1;
}

@media (max-width: 599px) {
  .roles {
    grid-template-columns: 1fr;
  }
}
</style>
