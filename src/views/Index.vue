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

import Footer from "../components/Footer.vue";
import UserMenu from '../components/UserMenu.vue';
import { useI18n } from 'vue-i18n';

export default {
  name: "Index",

  components: { Footer, UserMenu },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale, sameKey, isMember };
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
            url: "https://edrys-labs.github.io/module-reference/",
            config: "",
            studentConfig: "",
            teacherConfig: "",
            stationConfig: "",
            width: "full",
            height: "tall",
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
    <v-app-bar color="surface-variant" title="edrys-lite">
      <template v-slot:append>
        <UserMenu />
      </template>
    </v-app-bar>

    <v-main class="d-flex">
      <v-container fluid class="align-start">
        <v-row v-if="showMigrationBanner">
          <v-col cols="12">
            <v-alert
              type="info"
              closable
              @click:close="dismissMigrationBanner"
            >
              {{ t('index.migration.title') }}
              <br />
              {{ t('index.migration.body') }}
            </v-alert>
          </v-col>
        </v-row>

        <v-row>
          <v-col
            cols="12"
            sm="6"
            md="4"
            lg="3"
            v-for="classroom in classrooms"
            :key="classroom.id"
          >
            <v-card class="item" color="surface-variant" elevation="4">
              <v-img
                :src="
                  classroom?.data?.meta?.logo ||
                  'https://repository-images.githubusercontent.com/453979926/ab6bf9d7-a4bc-4a47-97b7-c8bc8bb4654d'
                "
                height="200px"
                cover
              ></v-img>
              <v-card-title>{{ classroom.data?.name }}</v-card-title>
              <v-card-subtitle>
                <span v-if="sameKey(classroom?.data?.createdBy, peerID)">{{ t('index.classroom.ownership.owner') }}</span>
                <span v-else-if="isMember(classroom?.data?.members?.teacher, peerID)">{{ t('index.classroom.ownership.teacher') }}</span>
                <span v-else>{{ t('index.classroom.ownership.student') }}</span>
              </v-card-subtitle>

              <v-card-text>
                <span style="white-space: pre-line">{{
                  classroom?.data?.meta?.description || 'No description'
                }}</span>
              </v-card-text>

              <v-card-actions>
                <v-btn icon :title="t('index.classroom.actions.fork')" @click="forkClass(classroom)">
                  <v-icon>mdi-source-fork</v-icon>
                </v-btn>

                <v-menu>
                  <template v-slot:activator="{ props }">
                    <v-btn color="" v-bind="props" icon="mdi-delete" :title="t('index.classroom.actions.delete')"> </v-btn>
                  </template>

                  <v-list>
                    <v-list-item>
                      <v-list-item-title> {{ t('index.classroom.actions.deleteConfirm') }} </v-list-item-title>

                      <v-btn
                        color="red"
                        depressed
                        @click="deleteClass(classroom.id)"
                        class="float-right"
                        style="margin-top: 10px"
                      >
                      {{ t('index.classroom.actions.deleteForever') }}</v-btn
                      >
                    </v-list-item>
                  </v-list>
                </v-menu>

                <v-spacer></v-spacer>
                <a
                  data-link="true"
                  :href="`./?/classroom/${classroom.id}${
                    classroom.ownerHash ? `/${classroom.ownerHash}` : ''
                  }`"
                  style="color: white"
                >
                  <v-btn icon title="open">
                    <v-icon>{{ ['ar', 'he', 'fa', 'ur'].includes(locale) ? 'mdi-arrow-left-bold' : 'mdi-arrow-right-bold' }}</v-icon>
                  </v-btn>
                </a>
              </v-card-actions>
            </v-card>
          </v-col>

          <v-col cols="12" sm="6" md="4" lg="3">
            <v-card
              class="item"
              color="surface-variant"
              elevation="4"
              @click="createClass()"
              variant="elevated"
            >
              <v-card-title>{{ t('index.classroom.create') }}</v-card-title>
              <v-card-subtitle>{{ t('index.classroom.startTeaching') }}</v-card-subtitle>
              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn icon>
                  <v-icon icon="mdi-plus"></v-icon>
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </v-main>

    <Footer></Footer>
  </v-app>
</template>
