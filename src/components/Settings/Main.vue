<template>
  <h3 class="section-title">{{ t('settings.main.classTitle') }}</h3>
  <p class="section-text">{{ t('settings.main.classText') }}</p>

  <div class="class-fields">
    <div class="fields">
      <FieldLabel :label="t('settings.main.className')">
        <v-text-field v-model="config.name" :counter="20" required></v-text-field>
      </FieldLabel>

      <FieldLabel :label="t('settings.main.description')">
        <v-textarea v-model="config.meta.description" rows="2" auto-grow hide-details></v-textarea>
      </FieldLabel>

      <FieldLabel :label="t('settings.main.logoUrl')" class="mt-4">
        <v-text-field
          v-model="config.meta.logo"
          placeholder="https://…/logo.png"
          :hint="t('settings.main.logoHint')"
          persistent-hint
        ></v-text-field>
      </FieldLabel>
    </div>

    <figure class="preview">
      <figcaption>{{ t('settings.main.preview') }}</figcaption>
      <div class="preview-card" aria-hidden="true">
        <ClassBanner :id="config.id || ''" :logo="config.meta.logo || ''" class="preview-banner" />
        <div class="preview-body">
          <div class="preview-name">{{ config.name }}</div>
          <div v-if="config.meta.description" class="preview-description">{{ config.meta.description }}</div>
        </div>
      </div>
    </figure>
  </div>

  <v-divider class="my-4"></v-divider>

  <h3 class="section-title">{{ t('settings.main.roomsTitle') }}</h3>
  <p class="section-text">{{ t('settings.main.roomsText') }}</p>

  <FieldLabel :label="t('settings.main.roomsNum')">
    <v-text-field
      v-model.number="config.meta.defaultNumberOfRooms"
      type="number"
      min="0"
      max="50"
      hide-details
      class="rooms-num"
    ></v-text-field>
  </FieldLabel>

  <!-- selfAssign checkbox hidden until the feature is implemented
  <v-checkbox
    v-model="config.meta.selfAssign"
    :label="t('settings.main.selfAssign')"
    outlined
  ></v-checkbox>
  -->
</template>

<script lang="ts">
import { useI18n } from 'vue-i18n';
import FieldLabel from "../FieldLabel.vue";
import ClassBanner from "../ClassBanner.vue";

export default {
  name: "Settings-Main",
  components: { FieldLabel, ClassBanner },

  props: {
    config: {
      type: Object,
      required: true,
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    return {};
  },
};
</script>

<style scoped>
.class-fields {
  display: grid;
  grid-template-columns: 1fr 220px;
  align-items: start;
  gap: 24px;
}

.preview {
  margin: 0;
}

.preview figcaption {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

/* a small copy of the class card on the start page */
.preview-card {
  border-radius: 12px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.05), 0 0 0 1px rgb(var(--v-theme-module-edge));
}

.v-theme--dark .preview-card {
  box-shadow: 0 0 0 1px rgb(var(--v-theme-panel-line));
}

.preview-banner {
  display: block;
  width: 100%;
  height: 110px;
  object-fit: cover;
}

.preview-body {
  padding: 10px 12px 12px;
}

.preview-name {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.preview-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: rgb(var(--v-theme-muted));
}

.rooms-num {
  max-width: 120px;
}

@media (max-width: 599px) {
  .class-fields {
    grid-template-columns: 1fr;
  }
}
</style>
