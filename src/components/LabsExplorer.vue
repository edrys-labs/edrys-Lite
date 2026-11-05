<script lang="ts">
import { PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDisplay, useRtl } from 'vuetify';
import { loadLabs, fetchLab, repoInitials, Lab, LabGroup } from '../ts/Labs';
import { activeTheme, roomTile } from '../ts/Theme';

type Filter = 'all' | 'browser' | 'station';
type ShownGroup = LabGroup & { slot: number };

/**
 * The ready-made labs of edrys-labs. In Settings ("settings") a lab replaces
 * the class's setup after a confirm; on the start page ("start") the dialog
 * creates a class, an empty one or one from a lab.
 */
export default {
  name: "LabsExplorer",

  props: {
    mode: {
      type: String as PropType<'settings' | 'start'>,
      default: 'settings',
    },
  },

  emits: ['close', 'use', 'create'],

  setup() {
    const { t } = useI18n();
    const { xs: phone } = useDisplay();
    const { isRtl: rtl } = useRtl();
    return { t, phone, rtl };
  },

  data() {
    return {
      isDialogOpen: true,
      isLoading: true,
      hasError: false,
      groups: [] as LabGroup[],
      search: '',
      filter: 'all' as Filter,
      filters: ['all', 'browser', 'station'] as Filter[],
      // the lab waiting for "Replace" (settings), the one being fetched, the one that failed
      confirming: null as Lab | null,
      busy: null as Lab | null,
      failed: null as Lab | null,
      // start page: first the choice between an empty class and a lab, then the labs
      step: 'choose' as 'choose' | 'labs',
    };
  },

  computed: {
    start(): boolean {
      return this.mode === 'start';
    },

    choosing(): boolean {
      return this.start && this.step === 'choose';
    },

    title(): string {
      if (!this.start) return this.t('labs.browseTitle');
      return this.choosing ? this.t('labs.createTitle') : this.t('labs.pickTitle');
    },

    intro(): string {
      if (!this.start) return this.t('labs.browseIntro');
      return this.choosing ? this.t('labs.createIntro') : this.t('labs.pickIntro');
    },

    // a few repo tiles on the "From a ready-made lab" card, once the labs are in
    previewTiles() {
      return (this.groups as LabGroup[]).slice(0, 4).map((group, index) => ({
        text: repoInitials(group.title),
        ...this.tile(index),
      }));
    },

    // slot: the group's colour, kept when a search hides other groups
    shown(): ShownGroup[] {
      const words: string[] = this.search.toLowerCase().split(/\s+/).filter(Boolean);
      return (this.groups as LabGroup[])
        .map((group, index): ShownGroup => ({
          ...group,
          slot: index,
          labs: group.labs.filter((lab: Lab) => {
            if (this.filter === 'browser' && lab.station) return false;
            if (this.filter === 'station' && !lab.station) return false;
            const text = [group.title, group.repo, lab.name, lab.description, ...lab.modules]
              .join(' ')
              .toLowerCase();
            return words.every((w: string) => text.includes(w));
          }),
        }))
        .filter((group: ShownGroup) => group.labs.length > 0);
    },
  },

  methods: {
    closeDialog() {
      this.isDialogOpen = false;
      this.$emit('close');
    },

    async load(fresh = false) {
      this.isLoading = true;
      this.hasError = false;
      try {
        this.groups = await loadLabs({ fresh });
      } catch (error) {
        console.error(error);
        this.hasError = true;
      } finally {
        this.isLoading = false;
      }
    },

    tile(slot: number) {
      return roomTile(slot, activeTheme.value);
    },

    initials(title: string) {
      return repoInitials(title);
    },

    actionLabel(lab: Lab) {
      return this.start
        ? this.t('labs.createFrom', { name: lab.name })
        : `${this.t('labs.use')}: ${lab.name}`;
    },

    pick(lab: Lab) {
      this.failed = null;
      if (this.start) this.take(lab);
      else this.confirming = lab;
    },

    async take(lab: Lab) {
      this.busy = lab;
      try {
        const data = await fetchLab(lab);
        this.$emit(this.start ? 'create' : 'use', data);
        this.closeDialog();
      } catch (error) {
        console.error(error);
        this.failed = lab;
      } finally {
        this.busy = null;
        this.confirming = null;
      }
    },

    createEmpty() {
      this.$emit('create', null);
      this.closeDialog();
    },

    // focus follows the step: the search field, or back on the lab card
    async goTo(step: 'choose' | 'labs') {
      this.step = step;
      await this.$nextTick();
      const target = step === 'labs' ? this.$refs.search : this.$refs.labCard;
      (target as HTMLElement | undefined)?.focus();
    },
  },

  mounted() {
    this.load();
  },
};
</script>

<template>
  <v-dialog
    v-model="isDialogOpen"
    :max-width="choosing ? '640px' : '800px'"
    :height="choosing ? undefined : '680px'"
    :fullscreen="phone"
    scrollable
    @update:modelValue="(open) => open || $emit('close')"
  >
    <v-card class="labs" role="dialog" aria-labelledby="labs-title">
      <div :class="['labs-head', { 'labs-head--back': start && !choosing }]">
        <v-btn
          v-if="start && !choosing"
          :icon="rtl ? 'mdi-arrow-right' : 'mdi-arrow-left'"
          size="36"
          variant="text"
          class="back-btn"
          :aria-label="t('labs.back')"
          :title="t('labs.back')"
          @click="goTo('choose')"
        ></v-btn>
        <div class="labs-head-text">
          <h2 id="labs-title">{{ title }}</h2>
          <p>{{ intro }}</p>
        </div>
        <v-btn
          icon="mdi-close"
          size="36"
          variant="text"
          class="muted-btn"
          :aria-label="t('classroom.popup.close')"
          @click="closeDialog"
        ></v-btn>
      </div>

      <div v-if="choosing" class="choices">
        <button
          type="button"
          class="choice choice--empty"
          aria-labelledby="choice-empty-title"
          aria-describedby="choice-empty-text"
          @click="createEmpty"
        >
          <span class="choice-icon" aria-hidden="true"><v-icon icon="mdi-plus" size="22"></v-icon></span>
          <span id="choice-empty-title" class="choice-title">{{ t('labs.emptyTitle') }}</span>
          <span id="choice-empty-text" class="choice-text">{{ t('labs.emptyText') }}</span>
          <span class="choice-go" aria-hidden="true">
            {{ t('labs.createNow') }}
            <v-icon :icon="rtl ? 'mdi-arrow-left' : 'mdi-arrow-right'" size="16"></v-icon>
          </span>
        </button>

        <button
          ref="labCard"
          type="button"
          class="choice"
          aria-labelledby="choice-lab-title"
          aria-describedby="choice-lab-text"
          @click="goTo('labs')"
        >
          <span class="choice-icon choice-icon--lab" aria-hidden="true"><v-icon icon="mdi-flask-outline" size="22"></v-icon></span>
          <span id="choice-lab-title" class="choice-title">{{ t('labs.fromLabTitle') }}</span>
          <span id="choice-lab-text" class="choice-text">{{ t('labs.fromLabText') }}</span>
          <span v-if="previewTiles.length" class="choice-tiles" aria-hidden="true">
            <span
              v-for="(tile, index) in previewTiles"
              :key="index"
              :style="{ background: tile.bg, color: tile.fg }"
            >{{ tile.text }}</span>
          </span>
          <span class="choice-go" aria-hidden="true">
            {{ t('labs.chooseLab') }}
            <v-icon :icon="rtl ? 'mdi-arrow-left' : 'mdi-arrow-right'" size="16"></v-icon>
          </span>
        </button>
      </div>

      <template v-else>
      <div class="labs-tools">
        <label class="search">
          <v-icon icon="mdi-magnify" size="18" aria-hidden="true"></v-icon>
          <span class="sr-only">{{ t('labs.search') }}</span>
          <input ref="search" v-model="search" type="search" :placeholder="t('labs.searchPlaceholder')" />
        </label>
        <div role="radiogroup" :aria-label="t('labs.filter.label')" class="segmented">
          <label v-for="f in filters" :key="f" :class="['segment', { selected: filter === f }]">
            <input type="radio" name="labs-filter" :value="f" v-model="filter" />
            {{ t('labs.filter.' + f) }}
          </label>
        </div>
      </div>

      <v-card-text class="labs-body">
        <div v-if="isLoading" class="d-flex justify-center align-center pa-8">
          <v-progress-circular indeterminate color="spinner" size="40"></v-progress-circular>
        </div>

        <div v-else-if="hasError" class="labs-error">
          <div class="error-badge">
            <v-icon icon="mdi-alert-circle-outline" size="22"></v-icon>
          </div>
          <div class="text-error">{{ t('labs.error') }}</div>
          <p>
            {{ t('labs.errorText') }}
            <a href="https://github.com/topics/edrys-lab?q=owner:edrys-labs" target="_blank" rel="noopener noreferrer">
              GitHub <v-icon size="14">mdi-open-in-new</v-icon>
            </a>
          </p>
          <v-btn variant="outlined" height="36" prepend-icon="mdi-refresh" @click="load(true)">
            {{ t('labs.retry') }}
          </v-btn>
        </div>

        <p v-else-if="shown.length === 0" class="no-match">{{ t('labs.noMatch') }}</p>

        <section v-for="group in shown" :key="group.repo" class="lab-group">
          <div class="group-head">
            <h3>{{ group.title }}</h3>
            <a :href="group.html" target="_blank" rel="noopener noreferrer" class="ltr">edrys-labs/{{ group.repo }}</a>
          </div>

          <div
            v-for="lab in group.labs"
            :key="lab.path"
            :class="['lab', { confirming: confirming === lab }]"
          >
            <div class="lab-row">
              <div
                class="repo-tile"
                aria-hidden="true"
                :style="{ background: tile(group.slot).bg, color: tile(group.slot).fg }"
              >{{ initials(group.title) }}</div>
              <div class="lab-text">
                <div class="lab-name">{{ lab.name }}</div>
                <div v-if="lab.description" class="lab-desc" :title="lab.description">{{ lab.description }}</div>
                <div class="lab-meta">
                  <span :class="['tag', lab.station ? 'tag--station' : 'tag--browser']">
                    <v-icon :icon="lab.station ? 'mdi-router-wireless' : 'mdi-application-outline'" size="12"></v-icon>
                    {{ lab.station ? t('labs.tag.station') : t('labs.tag.browser') }}
                  </span>
                  <span class="lab-modules">{{ lab.modules.join(' · ') }}</span>
                </div>
              </div>
              <v-btn
                color="tonal"
                variant="flat"
                height="34"
                :prepend-icon="start ? 'mdi-plus' : 'mdi-tray-arrow-down'"
                :loading="busy === lab"
                :disabled="!!busy && busy !== lab"
                :aria-label="actionLabel(lab)"
                @click="pick(lab)"
              >
                {{ start ? t('labs.create') : t('labs.use') }}
              </v-btn>
              <v-btn
                icon="mdi-information-outline"
                size="34"
                variant="text"
                class="muted-btn"
                :href="lab.html"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="t('labs.github') + ': ' + lab.name"
                :title="t('labs.github')"
              ></v-btn>
            </div>

            <div v-if="confirming === lab" role="alertdialog" :aria-label="t('labs.confirmTitle')" class="lab-confirm">
              <v-icon icon="mdi-sync" size="18"></v-icon>
              <p><strong>{{ t('labs.confirmTitle') }}</strong> {{ t('labs.confirmText') }}</p>
              <v-btn variant="text" height="34" :disabled="!!busy" @click="confirming = null">{{ t('labs.cancel') }}</v-btn>
              <v-btn color="primary" variant="flat" height="34" :loading="busy === lab" @click="take(lab)">
                {{ t('labs.replace') }}
              </v-btn>
            </div>

            <p v-if="failed === lab" role="alert" class="lab-failed">
              <v-icon icon="mdi-alert-circle-outline" size="16"></v-icon>
              {{ t('labs.labFailed') }}
            </p>
          </div>
        </section>
      </v-card-text>

      <div class="labs-foot">
        <p>{{ t('labs.stationNote') }}</p>
        <v-btn
          variant="outlined"
          height="40"
          append-icon="mdi-open-in-new"
          href="https://github.com/topics/edrys-lab?q=owner:edrys-labs"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('labs.more') }}
        </v-btn>
      </div>
      </template>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.labs-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-block: 16px 14px;
  padding-inline: 24px 16px;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}

.labs-head-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.labs-head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.labs-head p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--v-theme-text-2));
}

/* the back arrow sits where the text would start */
.labs-head--back {
  padding-inline-start: 12px;
}

.back-btn {
  margin-top: -4px;
}

.muted-btn {
  color: rgb(var(--v-theme-muted));
}

.choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 24px;
}

.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid rgb(var(--v-theme-row-edge));
  background: rgb(var(--v-theme-row));
  color: rgb(var(--v-theme-on-surface));
  text-align: start;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

/* touch screens keep :hover after a tap, so only for a real pointer */
@media (hover: hover) {
  .choice:hover {
    border-color: rgb(var(--v-theme-primary));
  }

  .choice--empty:hover {
    border-style: solid;
    background: rgba(var(--v-theme-primary), 0.1);
  }
}

.choice:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

/* the empty class looks like the Create card on the start page */
.choice--empty {
  border: 1.5px dashed rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.06);
}

.choice-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.choice-icon--lab {
  background: rgb(var(--v-theme-primary-tint));
  color: rgb(var(--v-theme-primary-text));
}

.choice-title {
  font-size: 15px;
  font-weight: 600;
}

.choice-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--v-theme-text-2));
}

.choice-tiles {
  display: flex;
  gap: 6px;
}

.choice-tiles span {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 700;
}

.choice-go {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary-text));
}

.labs-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding-block: 14px 4px;
  padding-inline: 24px;
}

.search {
  flex: 1;
  min-width: 200px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgb(var(--v-theme-field-line));
  background: rgb(var(--v-theme-field));
  color: rgb(var(--v-theme-muted));
}

.search:focus-within {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.segmented {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border-radius: 10px;
  background: rgb(var(--v-theme-tonal));
}

.segment {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  color: rgb(var(--v-theme-muted));
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.segment.selected {
  background: rgb(var(--v-theme-segment));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.12), 0 0 0 1px rgb(var(--v-theme-row-edge));
  color: rgb(var(--v-theme-on-surface));
  font-weight: 600;
}

.v-theme--dark .segment.selected {
  box-shadow: none;
}

/* the native radio stays for keyboard and screen readers, the label is the look */
.segment input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.segment:has(input:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.labs-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-block: 6px 16px !important;
  padding-inline: 24px !important;
}

.lab-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  padding-block: 12px 2px;
  padding-inline: 2px;
}

.group-head h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-muted));
}

.group-head a {
  font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
  font-size: 12px;
  color: rgb(var(--v-theme-faint));
  text-decoration: none;
}

.group-head a:hover {
  text-decoration: underline;
}

.lab {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  background: rgb(var(--v-theme-row));
  /* a border, not an outer shadow: the list scrolls and would clip it */
  border: 1px solid rgb(var(--v-theme-row-edge));
}

.lab.confirming {
  border-color: rgb(var(--v-theme-primary));
}

.lab-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-block: 10px;
  padding-inline: 12px 8px;
}

.repo-tile {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
}

.lab-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.lab-name {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.lab-desc {
  font-size: 12px;
  line-height: 1.4;
  color: rgb(var(--v-theme-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}


.lab-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 2px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.tag--browser {
  background: rgb(var(--v-theme-success-tint));
  color: rgb(var(--v-theme-success));
}

.tag--station {
  background: rgb(var(--v-theme-warning-tint));
  color: rgb(var(--v-theme-warning));
}

.lab-modules {
  min-width: 0;
  font-size: 11px;
  color: rgb(var(--v-theme-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lab-confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-block: 0 8px;
  margin-inline: 8px;
  padding-block: 10px;
  padding-inline: 12px 8px;
  border-radius: 8px;
  background: rgb(var(--v-theme-primary-tint));
  color: rgb(var(--v-theme-primary-text));
}

.lab-confirm p {
  flex: 1;
  min-width: 220px;
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
}

.lab-confirm strong {
  font-weight: 600;
}

.lab-failed {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-block: 0 10px;
  margin-inline: 12px;
  font-size: 13px;
  color: rgb(var(--v-theme-error));
}

.no-match {
  margin: 0;
  padding: 24px;
  text-align: center;
  font-size: 14px;
  color: rgb(var(--v-theme-muted));
}

.labs-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}

.labs-error p {
  margin: 0;
  font-size: 14px;
  color: rgb(var(--v-theme-text-2));
}

.labs-error a {
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

.labs-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-top: 1px solid rgb(var(--v-theme-panel-line));
}

.labs-foot p {
  flex: 1;
  min-width: 200px;
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgb(var(--v-theme-muted));
}

/* phones: the action buttons go below the text */
@media (max-width: 599px) {
  .labs-head,
  .labs-tools,
  .labs-foot {
    padding-inline: 16px;
  }

  .labs-body {
    padding-inline: 16px !important;
  }

  .lab-row {
    flex-wrap: wrap;
  }

  .lab-row .lab-text {
    flex-basis: calc(100% - 52px);
  }

  .lab-row .v-btn:not(.muted-btn) {
    margin-inline-start: 52px;
  }

  .choices {
    grid-template-columns: 1fr;
    padding: 16px;
  }

  .segmented {
    width: 100%;
  }

  .segment {
    flex: 1;
    justify-content: center;
    padding: 0 8px;
  }
}
</style>
