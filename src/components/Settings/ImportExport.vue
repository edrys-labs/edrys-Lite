<template>
  <h3 class="section-title">{{ t('settings.importExport.downloadTitle') }}</h3>
  <p class="section-text">{{ t('settings.importExport.downloadText') }}</p>
  <div class="downloads">
    <v-btn variant="outlined" height="40" prepend-icon="mdi-download" @click="downloadClass('yaml')">
      {{ t('settings.importExport.downloadYml') }}
    </v-btn>
    <v-btn variant="outlined" height="40" prepend-icon="mdi-download" @click="downloadClass('json')">
      {{ t('settings.importExport.downloadJson') }}
    </v-btn>
  </div>

  <v-divider class="my-5"></v-divider>

  <h3 class="section-title">{{ t('settings.importExport.restoreTitle') }}</h3>
  <p class="section-text">{{ t('settings.importExport.restoreText') }}</p>
  <div class="restore">
    <FieldLabel :label="t('settings.importExport.restoreFromFile')">
      <v-file-input
        accept=".yml,.yaml,.json,application/yaml,application/json"
        prepend-icon=""
        prepend-inner-icon="mdi-paperclip"
        hide-details
        v-model="selectedFile"
      >
        <template v-slot:append-inner>
          <!-- .stop: a click anywhere in the field opens the file picker -->
          <v-btn
            color="primary"
            variant="flat"
            height="32"
            class="restore-btn"
            :disabled="!selectedFile"
            :aria-label="t('settings.importExport.restoreFile')"
            @click.stop="restoreFile"
          >
            {{ t('settings.importExport.restore') }}
          </v-btn>
        </template>
      </v-file-input>
    </FieldLabel>

    <FieldLabel :label="t('settings.importExport.restoreFromUrl')">
      <v-text-field
        v-model="selectedURL"
        prepend-inner-icon="mdi-link"
        placeholder="https://…/lab.yml"
        hide-details
        @keydown.enter="selectedURL && restoreURL()"
      >
        <template v-slot:append-inner>
          <v-btn
            color="primary"
            variant="flat"
            height="32"
            class="restore-btn"
            :disabled="!selectedURL"
            :aria-label="t('settings.importExport.restoreUrl')"
            @click.stop="restoreURL"
          >
            {{ t('settings.importExport.restore') }}
          </v-btn>
        </template>
      </v-text-field>
    </FieldLabel>
  </div>
  <p v-if="restoreSuccess || saveError" role="status" :class="['restore-status', { failed: saveError }]">
    <v-icon :icon="saveError ? 'mdi-alert-circle-outline' : 'mdi-check-circle-outline'" size="16"></v-icon>
    {{ saveError ? errorMessage : t('settings.importExport.restored') }}
  </p>

  <v-divider class="my-5"></v-divider>

  <h3 class="section-title">{{ t('settings.importExport.findTitle') }}</h3>
  <p class="section-text">{{ t('settings.importExport.findText') }}</p>
  <v-btn
    variant="tonal"
    height="40"
    append-icon="mdi-open-in-new"
    href="https://github.com/topics/edrys-lab"
    target="_blank"
  >
    {{ t('settings.importExport.explore') }}
  </v-btn>
</template>

<script lang="ts">
import * as yaml from "js-yaml";
import { useI18n } from 'vue-i18n';
import { getPeerID, parseClassroom } from "../../ts/Utils";
import { debug } from "../../api/debugHandler";
import FieldLabel from "../FieldLabel.vue";

export default {
  name: "Settings-ImportExport",
  components: { FieldLabel },

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
    return {
      url: window.location.toString(),
      selectedURL: "",
      selectedFile: undefined,

      restoreSuccess: false,
      saveError: false,
      errorMessage: "",
      restoreFileRules: [
        (value) => !value || value.size < 2000000 || "File should be less than 2 MB!",
      ],
    };
  },

  methods: {
    // newConfig comes from parseClassroom, so meta/members/modules exist.
    updateConfig(newConfig: any) {
      this.config.name = newConfig.name;

      this.config.meta = newConfig.meta;
      this.config.createdBy = getPeerID(false);
      this.config.dateCreated = newConfig.dateCreated;
      this.config.members = newConfig.members;
      // Settings.vue only backfills ids when it opens, and the drag list keys
      // on them, so files without ids need them here.
      for (const module of newConfig.modules) {
        if (!module.id) module.id = crypto.randomUUID();
      }
      this.config.modules = newConfig.modules;
    },

    updateModules() {
      debug.settings.importExport("updateModules", this.scrapedModules);
    },

    downloadClass(format: "yaml" | "json") {
      // Identity and signature fields are dropped: import replaces createdBy
      // with the importer's key and the next save re-signs the setup.
      const { createdBy, setupSigner, setupSignature, ...config } = this.config;
      const data =
        format === "yaml" ? yaml.dump(config) : JSON.stringify(config, null, 2);

      const name = "class-" + this.config.id + (format === "yaml" ? ".yml" : ".json");

      const blob = new Blob([data], { type: "text/" + format });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    async restoreURL() {
      this.restoreSuccess = false;
      this.saveError = false;

      try {
        const response = await fetch(this.selectedURL);

        if (response.ok) {
          const newClass = parseClassroom(await response.text());

          if (newClass) {
            this.updateConfig(newClass);

            this.restoreSuccess = true;
            return;
          }
        }
      } catch (e) {
        // network error or blocked by CORS: same message as a page that isn't a class
      }

      this.saveError = true;
      this.errorMessage = this.t("settings.importExport.urlFailed");

      debug.settings.importExport("restoreURL", this.selectedURL, this.errorMessage);
    },
    restoreFile() {
      this.restoreSuccess = false;
      this.saveError = false;
      const reader = new FileReader();

      reader.readAsText(this.selectedFile);
      reader.onload = (res) => {
        // will load yaml and json as well

        const newClass = parseClassroom(reader.result?.toString() || "");

        if (newClass) {
          //this.updateState(newClass);
          this.updateConfig(newClass);
          this.restoreSuccess = true;

          debug.settings.importExport("restoreFile", this.selectedFile.name, newClass);
        } else {
          this.restoreSuccess = false;
          this.saveError = true;

          this.errorMessage = this.t("settings.importExport.fileFailed");

          debug.settings.importExport("restoreFile", this.selectedFile.name, this.errorMessage);
        }
      };
      reader.onerror = (err) => {
        this.restoreSuccess = false;
        this.saveError = true;
        this.errorMessage = this.t("settings.importExport.fileFailed");

        debug.settings.importExport("restoreFile", this.selectedFile.name, err);
      };
    },
  },

  computed: {
  },
};
</script>

<style scoped>
.downloads {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.restore {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.restore-btn {
  font-size: 12px;
}

/* a faded primary button still reads as clickable, in dark especially */
.restore-btn.v-btn--disabled {
  opacity: 1;
  background: rgb(var(--v-theme-tonal)) !important;
  color: rgb(var(--v-theme-faint)) !important;
}

.restore-btn.v-btn--disabled :deep(.v-btn__overlay) {
  opacity: 0;
}

.restore-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-success));
}

.restore-status.failed {
  color: rgb(var(--v-theme-error));
}

@media (max-width: 599px) {
  .restore {
    grid-template-columns: 1fr;
  }
}
</style>
