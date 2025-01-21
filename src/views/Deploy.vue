<script lang="ts">
import { Database } from "../ts/Database";
import { infoHash, getPeerID, parse, copyToClipboard } from "../ts/Utils";

import Footer from "../components/Footer.vue";
import UserMenu from '../components/UserMenu.vue';

export default {
  name: "Deploy",

  props: ["url"],

  components: { Footer, UserMenu },

  data() {
    const database = new Database();
    const state = [
      "Please wait while your classrooms gets loaded, you will be redirected ...",
    ];

    const checkboxValue = localStorage.getItem("deployed") === "true";

    return {
      database,
      state,
      peerID: getPeerID(false),
      ready: false,
      classroom: "",
      checkboxValue,
    };
  },

  created() {
    this.state.push("Fetching data from " + this.url);
    fetch(this.url)
      .then((response) => response.text())
      .then((data) => {
        this.state.push("Data fetched successfully");

        try {
          const classroom = parse(data);
          this.state.push("Data parsed successfully");
          this.createClass(classroom);
        } catch (error) {
          this.state.push("Error parsing data");
          console.error(error);
        }
      })
      .catch((error) => {
        this.state.push("Error fetching data");
        console.error(error);
      });
  },

  watch: {
    checkboxValue(value) {
      localStorage.setItem("deployed", value);
    },
  },

  methods: {
    copyPeerID() {
      copyToClipboard(this.peerID);
    },
    async createClass(data: any) {
      const id = infoHash(16);

      data.createdBy = this.peerID;
      this.database.put({ id, data, timestamp: Date.now() });

      this.classroom =
        window.location.origin + window.location.pathname + "?/classroom/" + id;

      if (this.checkboxValue) {
        window.location.search = `?/classroom/${id}`;
      } else {
        this.ready = true;
      }
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
        <div v-for="(message, index) in state" :key="index">
          {{ message }}
        </div>
      </v-container>
    </v-main>

    <Footer></Footer>

    <v-overlay v-model="ready" style="width: 100%">
      <v-card
        tile
        width="70%"
        style="
          top: 50%;
          left: 50%;

          transform: translate(-50%, 50%);
          max-width: 800px;
        "
      >
        <v-card-text class="white--text">
          Congratulations, your lab is ready
        </v-card-text>

        <v-divider></v-divider>

        <v-card-text>
          You will be automatically redirected to the new classroom that has been created
          at
          <br />
          <br />

          <a :href="classroom">{{ classroom }}</a>

          <br />
          <br />

          You own this classroom and you are the only one who can modify it and you can
          share the link with your students. The link is unique and recreating or
          reloading this link will create a new room.
        </v-card-text>
        <v-divider></v-divider>

        <v-checkbox
          v-model="checkboxValue"
          label="Don't show this message again"
        ></v-checkbox>
        <v-divider></v-divider>
        <v-card-text>
          <v-btn :href="classroom">
            <v-icon left>mdi-export-variant</v-icon>

            Goto Classroom
          </v-btn>
        </v-card-text>
      </v-card>
    </v-overlay>
  </v-app>
</template>
