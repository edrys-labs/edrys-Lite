<script lang="ts">
import { Database } from "../ts/Database";
import { infoHash, getPeerID, parseClassroom, copyToClipboard, hashPubKey } from "../ts/Utils";

import AppBrand from "../components/AppBrand.vue";
import Footer from "../components/Footer.vue";
import UserMenu from '../components/UserMenu.vue';

import { useI18n } from 'vue-i18n';

export default {
  name: "Deploy",

  props: ["url"],

  components: { AppBrand, Footer, UserMenu },

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
    <v-app-bar color="surface-variant" height="56" flat class="edrys-bar">
      <div class="d-flex align-center w-100 ps-5 pe-3">
        <AppBrand />
        <v-spacer></v-spacer>
        <UserMenu />
      </div>
    </v-app-bar>

    <v-main>
      <ul class="deploy-log" aria-live="polite">
        <li v-for="(message, index) in state" :key="index">{{ message }}</li>
      </ul>
    </v-main>

    <Footer></Footer>

    <v-overlay v-model="ready" class="align-center justify-center" scrim="rgb(20, 25, 35)">
      <v-card class="ready" role="dialog" aria-labelledby="ready-title">
        <div class="ready-head">
          <div class="ok-badge">
            <v-icon icon="mdi-check" size="20"></v-icon>
          </div>
          <h2 id="ready-title">{{ t('deploy.overlay.isReady') }}</h2>
        </div>

        <p>{{ t('deploy.overlay.redirect') }}</p>
        <a :href="classroom" class="classroom-link">{{ classroom }}</a>
        <p class="info">{{ t('deploy.overlay.info') }}</p>

        <div class="ready-foot">
          <v-checkbox
            v-model="checkboxValue"
            :label="t('deploy.overlay.checkbox')"
            hide-details
            density="compact"
          ></v-checkbox>
          <v-btn :href="classroom" color="primary" variant="flat" append-icon="mdi-arrow-right">
            {{ t('deploy.overlay.goto') }}
          </v-btn>
        </div>
      </v-card>
    </v-overlay>
  </v-app>
</template>

<style scoped>
.deploy-log {
  list-style: none;
  margin: 0;
  padding: 24px 28px;
  font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.8;
  color: rgb(var(--v-theme-muted));
  overflow-wrap: anywhere;
}

.ready {
  width: 560px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
}

.ready-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ready h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.ok-badge {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgb(var(--v-theme-success-tint));
  color: rgb(var(--v-theme-success));
}

.ready p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: rgb(var(--v-theme-text-2));
}

.ready .info {
  font-size: 13px;
  color: rgb(var(--v-theme-muted));
}

.classroom-link {
  font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-link));
  overflow-wrap: anywhere;
}

.ready-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 4px;
}

.ready-foot .v-checkbox {
  flex: 1;
  min-width: 200px;
}
</style>
