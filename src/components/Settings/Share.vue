<template>
  <v-row>
    <v-col>
      <v-btn variant="outlined" height="40" block prepend-icon="mdi-download" @click="downloadClass('yaml')">
        {{ t('settings.share.downloadYml') }}
      </v-btn>
    </v-col>
    <v-col>
      <v-btn variant="outlined" height="40" block prepend-icon="mdi-download" @click="downloadClass('json')">
        {{ t('settings.share.downloadJson') }}
      </v-btn>
    </v-col>
  </v-row>
  <v-row>
    <v-col>
      <FieldLabel :label="t('settings.share.restoreFromFile')">
        <v-file-input
          accept=".yml,.yaml,.json,application/yaml,application/json"
          prepend-icon=""
          prepend-inner-icon="mdi-paperclip"
          v-model="selectedFile"
        >
          <template v-if="selectedFile !== undefined" v-slot:append>
            <v-btn
              icon="mdi-upload"
              variant="text"
              density="comfortable"
              :aria-label="t('settings.share.restore')"
              :title="t('settings.share.restore')"
              @click="restoreFile"
            ></v-btn>
          </template>
        </v-file-input>
      </FieldLabel>
    </v-col>

    <v-col>
      <FieldLabel :label="t('settings.share.restoreFromUrl')">
        <v-text-field
          v-model="selectedURL"
          prepend-inner-icon="mdi-link"
          @mouseover="showTemplate = true"
          @mouseleave="showTemplate = false"
        >
          <template v-slot:append-inner>
            <v-icon
              @mouseover="showTemplate = true"
              @mouseleave="showTemplate = false"
              v-if="selectedURL.length > 0 && showTemplate"
              @click="selectedURL = ''"
              >mdi-close-circle</v-icon
            >
          </template>
          <template v-if="selectedURL" v-slot:append>
            <v-btn
              icon="mdi-upload"
              variant="text"
              density="comfortable"
              :aria-label="t('settings.share.restore')"
              :title="t('settings.share.restore')"
              @click="restoreURL"
            ></v-btn>
          </template>
        </v-text-field>
      </FieldLabel>
    </v-col>
  </v-row>

  <v-divider class="pb-2"></v-divider>
  <v-btn variant="outlined" height="40" prepend-icon="mdi-github" href="https://github.com/topics/edrys-lab" target="_blank">
    {{ t('settings.share.explore') }}
  </v-btn>
</template>

<script lang="ts">
import * as yaml from "js-yaml";
import { useI18n } from 'vue-i18n';
import { getPeerID, parseClassroom } from "../../ts/Utils";
import { debug } from "../../api/debugHandler";
import FieldLabel from "../FieldLabel.vue";

export default {
  name: "Settings-Share",
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

      showTemplate: false,

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
      debug.settings.share("updateModules", this.scrapedModules);
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

      const response = await fetch(this.selectedURL);

      if (response.ok) {
        const text = await response.text();

        const newClass = parseClassroom(text);

        if (newClass) {
          this.updateConfig(newClass);

          this.restoreSuccess = true;
          return;
        }
      }

      this.saveError = true;
      this.errorMessage = `Could not parse the content within the URL: ${this.selectedURL}`;

      debug.settings.share("restoreURL", this.selectedURL, this.errorMessage);
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

          debug.settings.share("restoreFile", this.selectedFile.name, newClass);
        } else {
          this.restoreSuccess = false;
          this.saveError = true;

          this.errorMessage = `Failed to restore classroom configuration from file.`;

          debug.settings.share("restoreFile", this.selectedFile.name, this.errorMessage);
        }
      };
      reader.onerror = (err) => {
        this.restoreSuccess = false;
        this.saveError = true;

        debug.settings.share("restoreFile", this.selectedFile.name, err);
      };
    },
  },

  computed: {
  },
};
</script>