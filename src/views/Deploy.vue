<script lang="ts">
import { Database } from "../ts/Database";
import { infoHash, getPeerID, parseClassroom, copyToClipboard, hashPubKey } from "../ts/Utils";

import Footer from "../components/Footer.vue";
import UserMenu from '../components/UserMenu.vue';

import { useI18n } from 'vue-i18n';

export default {
  name: "Deploy",

  props: ["url"],

  components: { Footer, UserMenu },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    const database = new Database();
    const state = [
      this.t('deploy.state.waiting'),
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
    this.state.push(this.t('deploy.state.fetching') + this.url);
    fetch(this.url)
      .then((response) => response.text())
      .then((data) => {
        this.state.push(this.t('deploy.state.fetched'));

        try {
          const classroom = parseClassroom(data);
          if (!classroom) throw new Error("not a classroom: " + this.url);
          this.state.push(this.t('deploy.state.parsed'));
          this.createClass(classroom);
        } catch (error) {
          this.state.push(this.t('deploy.state.parsingError'));
          console.error(error);
        }
      })
      .catch((error) => {
        this.state.push(this.t('deploy.state.fetchingError'));
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

      data.id = id;
      data.createdBy = this.peerID;
      this.database.put({ id, data, timestamp: Date.now() });

      // Include the /:owner segment, as Index.vue does: it is the trust anchor
      // newcomers use to check that the setup comes from the owner.
      const path = `?/classroom/${id}/${await hashPubKey(this.peerID)}`;
      this.classroom = window.location.origin + window.location.pathname + path;

      if (this.checkboxValue) {
        window.location.search = path;
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
          right: 50%;
          transform: translate(-50%, 50%);
          max-width: 800px;
          direction: inherit;
        "
      >
        <v-card-text class="white--text">
          {{ t('deploy.overlay.isReady') }}
        </v-card-text>

        <v-divider></v-divider>

        <v-card-text>
          {{ t('deploy.overlay.redirect') }}
          <br />
          <br />

          <a :href="classroom">{{ classroom }}</a>

          <br />
          <br />

          {{ t('deploy.overlay.info') }}
        </v-card-text>
        <v-divider></v-divider>

        <v-checkbox
          v-model="checkboxValue"
          :label="t('deploy.overlay.checkbox')"
        ></v-checkbox>
        <v-divider></v-divider>
        <v-card-text>
          <v-btn :href="classroom">
            <v-icon left>mdi-export-variant</v-icon>

            {{ t('deploy.overlay.goto') }}
          </v-btn>
        </v-card-text>
      </v-card>
    </v-overlay>
  </v-app>
</template>
