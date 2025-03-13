<script lang="ts">
import { useI18n } from 'vue-i18n';

interface Module {
  id: string;
  name: string;
  description: string;
  html_url: string;
}

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
        this.fetchedModules = data.items;
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
    <v-card>
      <v-toolbar>
        <v-toolbar-title>{{ t('settings.modules.modulesExplorer.title') }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon @click="closeDialog">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-card-text>
        <!-- Loading State -->
        <div v-if="isLoading" class="d-flex justify-center align-center pa-4">
          <v-progress-circular
            indeterminate
            size="50"
          ></v-progress-circular>
        </div>

        <!-- Error State -->
        <div v-else-if="hasError" class="text-center pa-4">
          <v-icon icon="mdi-alert-circle" color="error"></v-icon>
          <div class="text-error">{{ t('settings.modules.modulesExplorer.error') }}</div>
          <div class="text-body-1">
            {{ t('settings.modules.modulesExplorer.text') }}
            <v-btn
              variant="text"
              href="https://github.com/topics/edrys-module?q=owner:edrys-labs"
              target="_blank"
              class="pa-0 text-none font-weight-bold"
            >
              Github <v-icon size="small">mdi-open-in-new</v-icon>
            </v-btn>
          </div>
        </div>

        <!-- Modules Content -->
        <v-list v-else lines="three">
          <v-list-item
            v-for="module in fetchedModules" 
            :key="module.id"
            class="module-item mb-2"
          >
            <div class="d-flex align-center w-100" style="cursor: default">
              <div class="flex-grow-1">
                <v-list-item-title class="font-weight-bold">{{ module.name }}</v-list-item-title>
                <v-list-item-subtitle>{{ module.description }}</v-list-item-subtitle>
              </div>
              
              <div class="d-flex">
                <v-tooltip location="top">
                  <template v-slot:activator="{ props }">
                    <v-btn 
                      icon="mdi-plus-circle"
                      variant="text"
                      v-bind="props"
                      @click="addModule(module.name)"
                    ></v-btn>
                  </template>
                  <span>{{ t('settings.modules.modulesExplorer.tooltip.add') }}</span>
                </v-tooltip>
                
                <v-tooltip location="top">
                  <template v-slot:activator="{ props }">
                    <v-btn 
                      icon="mdi-information"
                      variant="text"
                      v-bind="props"
                      @click="openModuleUrl(module.html_url)"
                    ></v-btn>
                  </template>
                  <span>{{ t('settings.modules.modulesExplorer.tooltip.info') }}</span>
                </v-tooltip>
              </div>
            </div>
          </v-list-item>
          <div class="d-flex justify-end mt-5">
            <v-btn 
                variant="outlined"
                href="https://github.com/topics/edrys-module?q=edrys-lite" 
                target="_blank"
            >
              <v-icon class="mr-1" left> mdi-github </v-icon>
              {{ t('settings.modules.modulesExplorer.more') }}
            </v-btn>
          </div>
        </v-list>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.module-item {
  border: 2px solid #272727;
  border-radius: 8px !important;
  transition: all 0.3s ease;
}

.module-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5);
}
</style>