<script lang="ts">
import { Database, DatabaseItem } from "../ts/Database";
import {
  infoHash,
  getPeerID,
  hashPubKey,
  isPubKey,
  clone,
  normalizeClassroom,
  removeKeysStartingWithSecret,
  copyToClipboard,
  sameKey,
  isMember,
} from "../ts/Utils";
import { classArt } from "../ts/ClassArt";
import { activeTheme } from "../ts/Theme";

import AppBrand from "../components/AppBrand.vue";
import Footer from "../components/Footer.vue";
import UserMenu from '../components/UserMenu.vue';
import LinkedText from '../components/LinkedText.vue';
import { useI18n } from 'vue-i18n';
import { useDisplay } from 'vuetify';

export default {
  name: "Index",

  components: { AppBrand, Footer, UserMenu, LinkedText },

  setup() {
    const { t, locale } = useI18n();
    // phones list the classes as compact rows
    const { xs: phone } = useDisplay();
    return { t, locale, sameKey, isMember, classArt, activeTheme, phone };
  },

  data() {
    const database = new Database();
    const classrooms: DatabaseItem[] = [];

    database.setObservable("*", async (rooms: any) => {
      // Classrooms from before the crypto migration keep a legacy createdBy,
      // which has no owner hash. One of them must not hide the whole list.
      await Promise.all(rooms.map(async (c: any) => {
        const createdBy = c?.data?.createdBy;
        if (!createdBy || !isPubKey(createdBy)) return;
        try {
          c.ownerHash = await hashPubKey(createdBy);
        } catch {}
      }));
      this.classrooms = rooms;
    });

    return {
      database,
      classrooms,
      peerID: getPeerID(false),
      showMigrationBanner: sessionStorage.getItem('showMigrationBanner') === '1',
      // classroom id -> its logo failed to load, show its drawn picture instead
      brokenLogos: {} as Record<string, boolean>,
      // phones: the class whose "More actions" menu asks before deleting
      confirmDelete: null as string | null,
    };
  },

  methods: {
    dismissMigrationBanner() {
      this.showMigrationBanner = false;
      sessionStorage.removeItem('showMigrationBanner');
    },

    copyPeerID() {
      copyToClipboard(this.peerID);
    },

    deleteClass(id: string) {
      this.database.drop(id);
    },

    async forkClass(classroom: any) {
      classroom = clone(classroom);
      normalizeClassroom(classroom.data);

      const id = infoHash();
      const peerID = getPeerID(false);

      if (classroom.data.createdBy !== peerID) {
        removeKeysStartingWithSecret(classroom);

        classroom.data.members.teacher = [];
        classroom.data.members.student = [];
      }

      classroom.data.createdBy = peerID;
      classroom.id = id;

      await this.database.put({ id, data: classroom.data, timestamp: Date.now() });

      // Small delay to ensure the database write is fully committed
      await new Promise(resolve => setTimeout(resolve, 50));

      window.location.search = `?/classroom/${id}/${await hashPubKey(peerID)}`;
    },

    async createClass() {
      const id = infoHash(16);

      const data = {
        id,
        createdBy: getPeerID(false),
        dateCreated: new Date().getTime(),
        name: this.t('index.classroom.newClass'),
        meta: {
          logo: "",
          description: "",
          selfAssign: false,
          defaultNumberOfRooms: 0,
        },
        members: {
          teacher: [],
          student: [],
        },
        modules: [
          {
            url: "https://edrys-labs.github.io/module-markdown-it/",
            config: "",
            studentConfig: { content: this.t('index.classroom.welcome.student') },
            teacherConfig: { content: this.t('index.classroom.welcome.teacher') },
            stationConfig: "",
            showInCustom: "lobby",
            width: "full",
            height: 600,
          },
        ],
      };

      await this.database.put({ id, data, timestamp: Date.now() });
      
      // Small delay to ensure the database write is fully committed
      await new Promise(resolve => setTimeout(resolve, 50));

      window.location.search = `?/classroom/${id}/${await hashPubKey(getPeerID(false))}`;
    },
  },
};
</script>

<template>
  <v-app>
    <v-app-bar color="surface-variant" height="56" flat class="edrys-bar">
      <div class="d-flex align-center w-100 ps-5 pe-3">
        <AppBrand />
        <v-spacer></v-spacer>
        <UserMenu />
      </div>
    </v-app-bar>

    <v-main>
      <div class="class-list" :class="{ 'class-list--phone': phone }">
        <div v-if="showMigrationBanner" role="status" class="migration">
          <v-icon icon="mdi-information-outline" size="20"></v-icon>
          <div class="migration-text">
            <strong>{{ t('index.migration.title') }}</strong>
            <span>{{ t('index.migration.body') }}</span>
          </div>
          <v-btn
            icon="mdi-close"
            size="28"
            variant="text"
            :aria-label="t('index.migration.dismiss')"
            @click="dismissMigrationBanner"
          ></v-btn>
        </div>

        <div class="list-heading">
          <h1>{{ t('index.classroom.title') }}</h1>
          <span v-if="classrooms.length">{{ t('index.classroom.saved', { n: classrooms.length }) }}</span>
        </div>

        <div v-if="classrooms.length" class="storage-note">
          <v-icon icon="mdi-harddisk" size="20"></v-icon>
          <p>
            <strong>{{ t('index.storage.title') }}</strong>
            {{ t('index.storage.body') }}
          </p>
        </div>

        <div class="class-grid">
          <button type="button" class="create-card" @click="createClass()">
            <span class="create-icon"><v-icon icon="mdi-plus" size="26"></v-icon></span>
            <span class="create-title">{{ t('index.classroom.create') }}</span>
            <span class="create-sub">{{ t('index.classroom.createHint') }}</span>
          </button>

          <article v-for="classroom in classrooms" :key="classroom.id" class="class-card">
            <img
              v-if="classroom?.data?.meta?.logo && !brokenLogos[classroom.id]"
              class="banner"
              :src="classroom.data.meta.logo"
              alt=""
              @error="brokenLogos[classroom.id] = true"
            />
            <svg
              v-else
              class="banner class-art"
              viewBox="0 0 200 100"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              <rect
                x="-100"
                y="-100"
                width="400"
                height="300"
                :fill="classArt(classroom.id, activeTheme).background"
              />
              <line
                v-for="(line, i) in classArt(classroom.id, activeTheme).lines"
                :key="'l' + i"
                :x1="line.x1"
                :y1="line.y1"
                :x2="line.x2"
                :y2="line.y2"
                :stroke="line.color"
                stroke-width="1.4"
                stroke-linecap="round"
              />
              <circle
                v-for="(dot, i) in classArt(classroom.id, activeTheme).dots"
                :key="'d' + i"
                :cx="dot.cx"
                :cy="dot.cy"
                :r="dot.r"
                :fill="dot.fill"
                :stroke="classArt(classroom.id, activeTheme).background"
                :stroke-width="dot.ring"
              />
            </svg>

            <div class="class-body">
              <h2>{{ classroom.data?.name }}</h2>
              <div class="class-role">
                <span v-if="sameKey(classroom?.data?.createdBy, peerID)">{{ t('index.classroom.ownership.owner') }}</span>
                <span v-else-if="isMember(classroom?.data?.members?.teacher, peerID)">{{ t('index.classroom.ownership.teacher') }}</span>
                <span v-else>{{ t('index.classroom.ownership.student') }}</span>
              </div>
              <p v-if="classroom?.data?.meta?.description" :title="classroom.data.meta.description">
                <LinkedText :text="classroom.data.meta.description" />
              </p>
            </div>

            <div class="class-actions">
              <v-menu
                v-if="phone"
                location="bottom end"
                @update:modelValue="(open) => open || (confirmDelete = null)"
              >
                <template v-slot:activator="{ props }">
                  <v-btn
                    v-bind="props"
                    icon="mdi-dots-horizontal"
                    size="44"
                    rounded="lg"
                    variant="text"
                    class="card-icon-btn"
                    :aria-label="t('index.classroom.actions.more')"
                  ></v-btn>
                </template>

                <v-card v-if="confirmDelete === classroom.id" class="confirm">
                  <p>{{ t('index.classroom.actions.deleteConfirm') }}</p>
                  <div class="confirm-actions">
                    <v-btn variant="text" height="40">{{ t('index.classroom.actions.cancel') }}</v-btn>
                    <v-btn color="danger-fill" variant="flat" height="40" @click="deleteClass(classroom.id)">
                      {{ t('index.classroom.actions.deleteForever') }}
                    </v-btn>
                  </div>
                </v-card>
                <v-list v-else>
                  <v-list-item
                    prepend-icon="mdi-source-fork"
                    :title="t('index.classroom.actions.fork')"
                    @click="forkClass(classroom)"
                  ></v-list-item>
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    :title="t('index.classroom.actions.delete')"
                    @click.stop="confirmDelete = classroom.id"
                  ></v-list-item>
                </v-list>
              </v-menu>

              <template v-else>
                <v-btn
                  icon="mdi-source-fork"
                  size="36"
                  variant="text"
                  class="card-icon-btn"
                  :aria-label="t('index.classroom.actions.fork')"
                  :title="t('index.classroom.actions.fork')"
                  @click="forkClass(classroom)"
                ></v-btn>

                <v-menu location="top start">
                  <template v-slot:activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon="mdi-delete-outline"
                      size="36"
                      variant="text"
                      class="card-icon-btn"
                      :aria-label="t('index.classroom.actions.delete')"
                      :title="t('index.classroom.actions.delete')"
                    ></v-btn>
                  </template>

                  <v-card class="confirm">
                    <p>{{ t('index.classroom.actions.deleteConfirm') }}</p>
                    <div class="confirm-actions">
                      <v-btn variant="text" height="34">{{ t('index.classroom.actions.cancel') }}</v-btn>
                      <v-btn color="danger-fill" variant="flat" height="34" @click="deleteClass(classroom.id)">
                        {{ t('index.classroom.actions.deleteForever') }}
                      </v-btn>
                    </div>
                  </v-card>
                </v-menu>

                <v-spacer></v-spacer>
              </template>
              <v-btn
                color="primary"
                variant="flat"
                :size="phone ? 40 : 36"
                rounded="circle"
                data-link="true"
                :icon="['ar', 'he', 'fa', 'ur'].includes(locale) ? 'mdi-arrow-left' : 'mdi-arrow-right'"
                :href="`./?/classroom/${classroom.id}${
                  classroom.ownerHash ? `/${classroom.ownerHash}` : ''
                }`"
                :aria-label="t('index.classroom.actions.open')"
                :title="t('index.classroom.actions.open')"
              ></v-btn>
            </div>
          </article>
        </div>
      </div>
    </v-main>

    <Footer></Footer>
  </v-app>
</template>

<style scoped>
.class-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 28px;
}

.migration {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 12px 12px 16px;
  border-radius: 10px;
  background: rgb(var(--v-theme-info-tint));
  color: rgb(var(--v-theme-info));
}

.migration .v-icon {
  margin-top: 1px;
}

.migration-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  line-height: 1.5;
}

.migration-text strong {
  font-size: 14px;
  font-weight: 600;
}

.storage-note {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid rgb(var(--v-theme-warning-tint));
  border-radius: 10px;
  /* a softer yellow than the tint itself, which also colours status pills */
  background: color-mix(in srgb, rgb(var(--v-theme-warning-tint)) 45%, rgb(var(--v-theme-surface)));
  color: rgb(var(--v-theme-on-background));
}

.storage-note .v-icon {
  margin-top: 1px;
}

.storage-note p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.storage-note strong {
  font-weight: 600;
}

.list-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.list-heading h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.list-heading span {
  font-size: 13px;
  color: rgb(var(--v-theme-muted));
}

.class-grid {
  display: grid;
  /* four to a row at most, fewer once a card would get narrower than 260px */
  grid-template-columns: repeat(auto-fill, minmax(max(260px, calc((100% - 60px) / 4)), 1fr));
  gap: 20px;
}

.class-card {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.05), 0 0 0 1px rgb(var(--v-theme-module-edge));
}

.v-theme--dark .class-card {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25), 0 0 0 1px rgb(var(--v-theme-panel-line));
}

.banner {
  display: block;
  width: 100%;
  /* the logo height of the cards before the restyle, so logos aren't cropped harder */
  height: 200px;
  object-fit: cover;
}

.class-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px 4px;
}

.class-body h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.class-role {
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

.class-body p {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: rgb(var(--v-theme-text-2));
  white-space: pre-line;
  overflow-wrap: anywhere;
  /* long descriptions stop after four lines (the whole text is the tooltip) */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  overflow: hidden;
}

.class-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 12px 12px;
}

.card-icon-btn {
  color: rgb(var(--v-theme-muted));
}

.card-icon-btn :deep(.v-icon) {
  font-size: 20px;
}

.create-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 320px;
  padding: 24px;
  border: 1.5px dashed rgba(var(--v-theme-primary), 0.5);
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-on-background));
  text-align: center;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.create-card:hover {
  border-style: solid;
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}

.create-card:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.create-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 2px 6px rgba(var(--v-theme-primary), 0.35);
}

.create-title {
  font-size: 16px;
  font-weight: 600;
}

.create-sub {
  max-width: 240px;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--v-theme-text-2));
}

/* phones: one compact row per class */
.class-list--phone {
  gap: 12px;
  padding: 16px;
}

.class-list--phone .list-heading h1 {
  font-size: 20px;
}

.class-list--phone .class-grid {
  grid-template-columns: 1fr;
  gap: 12px;
}

.class-list--phone .class-card {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 12px;
}

.class-list--phone .banner {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 10px;
}

.class-list--phone .class-body {
  gap: 2px;
  min-width: 0;
  padding: 0;
}

.class-list--phone .class-body h2 {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 15px;
}

.class-list--phone .class-body p {
  display: none;
}

.class-list--phone .class-actions {
  gap: 0;
  padding: 0;
}

.class-list--phone .create-card {
  flex-direction: row;
  justify-content: flex-start;
  gap: 12px;
  min-height: 56px;
  padding: 12px;
}

.class-list--phone .create-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  box-shadow: none;
}

.class-list--phone .create-title {
  font-size: 14px;
}

.class-list--phone .create-sub {
  display: none;
}
</style>
