<template>
  <v-row>
    <v-col>
      <v-btn depressed block @click="downloadClass('yaml')">
        <v-icon left> mdi-download </v-icon>
        {{ t('settings.share.downloadYml') }}
      </v-btn>
    </v-col>
    <v-col>
      <v-btn depressed block @click="downloadClass('json')">
        <v-icon left> mdi-download </v-icon>
        {{ t('settings.share.downloadJson') }}
      </v-btn>
    </v-col>
  </v-row>
  <v-row>
    <v-col>
      <v-file-input
        dense
        accept=".yml,.yaml,.json,application/yaml,application/json"
        :label="t('settings.share.restoreFromFile')"
        v-model="selectedFile"
        :append-icon="selectedFileIcon"
        @click:append.self="restoreFile"
        :disabled="writeProtection"
      ></v-file-input>
    </v-col>

    <v-col>
      <v-text-field
        dense
        :label="t('settings.share.restoreFromUrl')"
        v-model="selectedURL"
        prepend-icon="mdi-link"
        :append-icon="selectedURLIcon"
        @click:append.self="restoreURL"
        @mouseover="showTemplate = true"
        @mouseleave="showTemplate = false"
        :disabled="writeProtection"
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
      </v-text-field>
    </v-col>
  </v-row>

  <v-divider class="pb-2"></v-divider>
  <v-btn variant="outlined" href="https://github.com/topics/edrys-lab" target="_blank">
    <v-icon class="mr-2" left> mdi-github </v-icon>
    {{ t('settings.share.explore') }}
  </v-btn>
</template>

<script lang="ts">
import * as yaml from "js-yaml";
import { useI18n } from 'vue-i18n';
import { getPeerID, parseClassroom } from "../../ts/Utils";
import { debug } from "../../api/debugHandler";

export default {
  name: "Settings-Share",

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
    updateConfig(newConfig: any) {
      if (!newConfig.meta) {
        newConfig.meta = {
          logo: "",
          description: "",
          selfAssign: false,
          defaultNumberOfRooms: 0,
        };
      }
      this.config.name = newConfig.name;

      this.config.meta = newConfig.meta;
      this.config.createdBy = getPeerID(false);
      this.config.dateCreated = newConfig.dateCreated;
      this.config.members = newConfig.members;
      this.config.modules = newConfig.modules;
    },

    updateModules() {
      debug.settings.share("updateModules", this.scrapedModules);
    },

    downloadClass(format: "yaml" | "json") {
      const data =
        format === "yaml" ? yaml.dump(this.config) : JSON.stringify(this.config, null, 2);

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
    selectedURLIcon() {
      return this.selectedURL ? "mdi-upload" : "";
    },
    selectedFileIcon() {
      return this.selectedFile !== undefined ? "mdi-upload" : "";
    },
  },
};
</script>