<script lang="ts">
import { useI18n } from 'vue-i18n';

interface Module {
  id: string;
  name: string;
  description: string;
  html_url: string;
}

// Shown first, in this order; all other modules follow in GitHub's order.
const PINNED_MODULES = [
  "module-markdown-it",
  "module-monaco-editor",
  "module-pyxtermjs",
  "module-streaming",
  "module-serial",
  "module-liascript",
];

const pinRank = (name: string) => {
  const i = PINNED_MODULES.indexOf(name);
  return i === -1 ? PINNED_MODULES.length : i;
};

export default {
  name: "ModulesExplorer",

  data() {
    return {
      fetchedModules: [] as Module[],

      isDialogOpen: true,
      isLoading: true,
      hasError: false
    };
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  methods: {
    closeDialog() {
      this.isDialogOpen = false;
      this.$emit('close');
    },

    openModuleUrl(url: string) {
      window.open(url, '_blank');
    },
    
    addModule(moduleName: string) {
      const modulePagesURL = `https://edrys-labs.github.io/${moduleName}/index.html`;
      
      this.$emit('add-module', modulePagesURL);
    },

    async fetchModules() {
      try {
        const response = await fetch('https://api.github.com/search/repositories?q=topic:edrys-module+fork:true+owner:edrys-labs');
        const data = await response.json();
        this.fetchedModules = data.items
          .slice()
          .sort((a: Module, b: Module) => pinRank(a.name) - pinRank(b.name));
        this.hasError = false;
      } catch (error) {
        console.error(error);
        this.hasError = true;
      } finally {
        this.isLoading = false;
      }
    },
  },

  mounted() {
    this.fetchModules();
  },
};
</script>

<template>
  <v-dialog
    v-model="isDialogOpen"
    max-width="800px"
    max-height="600px"
    scrollable
    persistent
  >
    <v-card class="explorer">
      <div class="explorer-head">
        <h2>{{ t('settings.modules.modulesExplorer.title') }}</h2>
        <v-btn
          icon="mdi-close"
          size="36"
          variant="text"
          class="muted-btn"
          :aria-label="t('classroom.popup.close')"
          @click="closeDialog"
        ></v-btn>
      </div>

      <v-card-text class="explorer-body">
        <!-- Loading State -->
        <div v-if="isLoading" class="d-flex justify-center align-center pa-8">
          <v-progress-circular indeterminate color="spinner" size="40"></v-progress-circular>
        </div>

        <!-- Error State -->
        <div v-else-if="hasError" class="explorer-error">
          <div class="error-badge">
            <v-icon icon="mdi-alert-circle-outline" size="22"></v-icon>
          </div>
          <div class="text-error">{{ t('settings.modules.modulesExplorer.error') }}</div>
          <p>
            {{ t('settings.modules.modulesExplorer.text') }}
            <a href="https://github.com/topics/edrys-module?q=owner:edrys-labs" target="_blank" rel="noopener noreferrer">
              GitHub <v-icon size="14">mdi-open-in-new</v-icon>
            </a>
          </p>
        </div>

        <!-- Modules Content -->
        <v-list v-else class="explorer-list">
          <v-list-item
            v-for="module in fetchedModules"
            :key="module.id"
            class="module-item"
          >
            <div class="module-row">
              <div class="module-text">
                <v-list-item-title class="module-name">{{ module.name }}</v-list-item-title>
                <v-list-item-subtitle class="module-description">{{ module.description }}</v-list-item-subtitle>
              </div>

              <v-btn
                color="tonal"
                variant="flat"
                height="34"
                prepend-icon="mdi-plus"
                :aria-label="t('settings.modules.modulesExplorer.tooltip.add')"
                :title="t('settings.modules.modulesExplorer.tooltip.add')"
                @click="addModule(module.name)"
              >
                {{ t('settings.modules.add') }}
              </v-btn>

              <v-btn
                icon="mdi-information-outline"
                size="34"
                variant="text"
                class="muted-btn"
                :aria-label="t('settings.modules.modulesExplorer.tooltip.info')"
                :title="t('settings.modules.modulesExplorer.tooltip.info')"
                @click="openModuleUrl(module.html_url)"
              ></v-btn>
            </div>
          </v-list-item>
        </v-list>
      </v-card-text>

      <div v-if="!isLoading && !hasError" class="explorer-foot">
        <v-btn
          variant="outlined"
          prepend-icon="mdi-github"
          href="https://github.com/topics/edrys-module?q=edrys-lite"
          target="_blank"
        >
          {{ t('settings.modules.modulesExplorer.more') }}
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.explorer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 12px 24px;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}

.explorer-head h2 {
  flex: 1;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.muted-btn {
  color: rgb(var(--v-theme-muted));
}

.explorer-body {
  padding: 16px 24px !important;
}

.explorer-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  background: transparent;
}

.module-item {
  padding: 10px 8px 10px 14px !important;
  border-radius: 10px !important;
  background: rgb(var(--v-theme-row));
  /* a border, not an outer shadow: the list scrolls and would clip it */
  border: 1px solid rgb(var(--v-theme-row-edge)) !important;
}

.module-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.module-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.module-name {
  font-size: 14px;
  font-weight: 600;
}

.module-description {
  font-size: 12px;
  line-height: 1.4;
  white-space: normal;
  color: rgb(var(--v-theme-muted));
  opacity: 1;
  -webkit-line-clamp: 2;
}

.explorer-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}

.explorer-error p {
  margin: 0;
  font-size: 14px;
  color: rgb(var(--v-theme-text-2));
}

.explorer-error a {
  color: rgb(var(--v-theme-link));
  font-weight: 600;
}

.error-badge {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgb(var(--v-theme-danger-tint));
  color: rgb(var(--v-theme-error));
}

.explorer-foot {
  display: flex;
  justify-content: flex-end;
  padding: 14px 24px;
  border-top: 1px solid rgb(var(--v-theme-panel-line));
}
</style>
