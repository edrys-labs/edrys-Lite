<script lang="ts">
import DateFormat from "date-format-simple";
import { Database, DatabaseItem } from "../ts/Database";
import {
  infoHash,
  getPeerID,
  clone,
  removeKeysStartingWithSecret,
  copyToClipboard,
} from "../ts/Utils";

import Footer from "../components/Footer.vue";

export default {
  name: "Index",

  components: { Footer },

  data() {
    const database = new Database();
    const classrooms: DatabaseItem[] = [];

    database.setObservable("*", (rooms: any) => {
      this.classrooms = rooms;
    });

    return {
      database,
      classrooms,
      peerID: getPeerID(false),
    };
  },

  methods: {
    copyPeerID() {
      copyToClipboard(this.peerID);
    },

    switchClassroomProtection(id: string, on: boolean) {
      this.database.setProtection(id, on);
    },

    deleteClass(id: string) {
      this.database.drop(id);
    },

    forkClass(classroom: any) {
      classroom = clone(classroom);

      const id = infoHash();
      const peerID = getPeerID(false);

      if (classroom.data.createdBy !== peerID) {
        removeKeysStartingWithSecret(classroom);

        classroom.data.members.teacher = [];
        classroom.data.members.student = [];
      }

      classroom.data.createdBy = peerID;
      classroom.id = id;

      this.database.put({ id, data: classroom.data, timestamp: Date.now() });

      window.location.search = `?/classroom/${id}`;
    },

    async createClass() {
      const id = infoHash(16);

      const data = {
        id,
        createdBy: getPeerID(false),
        dateCreated: new Date().getTime(),
        name: "My New Class",
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

      this.database.put({ id, data, timestamp: Date.now() });

      window.location.search = `?/classroom/${id}`;
    },
  },
};
</script>

<template>
  <v-app>
    <v-app-bar color="surface-variant" title="edrys-lite">
      <template v-slot:append>
        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" icon="mdi-dots-vertical"> </v-btn>
          </template>

          <v-list>
            <v-list-item>
              <v-list-item-title> User ID: </v-list-item-title>
              <v-list-item-subtitle>
                {{ peerID }}
                <v-btn
                  icon="mdi-content-copy"
                  size="small"
                  variant="flat"
                  @click="copyPeerID()"
                >
                </v-btn>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-menu>
      </template>
    </v-app-bar>

    <v-main class="d-flex">
      <v-container fluid class="align-start">
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
              <v-chip
                :color="!!classroom.hash ? 'primary' : 'secondary'"
                style="
                  position: absolute;
                  z-index: 100;
                  right: 10px;
                  top: 10px;
                  background-color: white;
                "
                :disabled="
                  classroom?.data.createdBy !== peerID &&
                  !classroom?.data.members.teacher.includes(peerID)
                "
              >
                Write Protection
                <v-switch
                  :model-value="!!classroom.hash"
                  color="primary"
                  :label="!!classroom.hash ? 'on' : 'off'"
                  style="padding-top: 20px; z-index: 200"
                  @change="switchClassroomProtection(classroom.id, !classroom.hash)"
                ></v-switch>
              </v-chip>
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
                <span v-if="classroom?.data.createdBy === peerID"
                  >You own this class</span
                >
                <span v-else-if="classroom?.data.members.teacher.includes(peerID)"
                  >You're a teacher here</span
                >
                <span v-else>You're a student here</span>
              </v-card-subtitle>

              <v-card-text>
                <span
                  v-html="classroom?.data?.meta?.description || 'No description'"
                ></span>
              </v-card-text>

              <v-card-actions>
                <v-btn icon title="fork" @click="forkClass(classroom)">
                  <v-icon>mdi-source-fork</v-icon>
                </v-btn>

                <v-menu>
                  <template v-slot:activator="{ props }">
                    <v-btn color="" v-bind="props" icon="mdi-delete"> </v-btn>
                  </template>

                  <v-list>
                    <v-list-item>
                      <v-list-item-title> Are you sure? </v-list-item-title>

                      <v-btn
                        color="red"
                        depressed
                        @click="deleteClass(classroom.id)"
                        class="float-right"
                        style="margin-top: 10px"
                      >
                        Yes, delete forever</v-btn
                      >
                    </v-list-item>
                  </v-list>
                </v-menu>

                <v-spacer></v-spacer>
                <a
                  data-link="true"
                  :href="`./?/classroom/${classroom.id}${
                    !!classroom.hash ? `/${classroom.hash}` : ''
                  }`"
                  style="color: white"
                >
                  <v-btn icon title="open">
                    <v-icon>mdi-arrow-right-bold</v-icon>
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
              <v-card-title>Create a class</v-card-title>
              <v-card-subtitle>Start teaching now</v-card-subtitle>
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
