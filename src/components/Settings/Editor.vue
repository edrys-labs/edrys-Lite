<template>
  <v-expansion-panel>
    <v-expansion-panel-title>
      {{ title }}

      <template v-slot:actions>
        <v-icon :style="errorMessage ? 'color: red;' : ''"> {{ icon }} </v-icon>
      </template>
    </v-expansion-panel-title>
    <v-expansion-panel-text style="max-height: 60vh">
      <div
        style="font-size: small; margin-bottom: 0.25rem"
        :style="errorMessage ? 'color: red;' : 'color: gray;'"
      >
        {{ errorMessage || "Valid YAML or JSON configuration" }}
      </div>

      <v-divider style="margin-bottom: 0.5rem"></v-divider>
      <prism-editor
        v-model="code"
        :highlight="highlighter"
        line-numbers
        :readonly="writeProtection"
      ></prism-editor>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<script lang="ts">
// @ts-ignore
import { PrismEditor } from "vue-prism-editor";
import "vue-prism-editor/dist/prismeditor.min.css"; // import the styles somewhere

// import highlighting library (you can use any library you want just return html string)
// @ts-ignore
import { highlight, languages } from "prismjs/components/prism-core";

import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/themes/prism-tomorrow.css"; // import syntax highlighting styles

import { parse, stringify } from "../../ts/Utils";

export default {
  name: "Editor",

  props: {
    config: {
      type: [Object, String],
      required: true,
    },

    error: {
      type: String,
      default: false,
    },

    title: {
      type: String,
      required: true,
    },

    icon: {
      type: String,
      required: true,
    },

    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  data() {
    let input = "";

    if (typeof this.config === "string" && this.config.trim() !== "") {
      input = "|-\n  " + this.config.split("\n").join("\n  ");
    } else {
      input = stringify(this.config);
    }

    return {
      code: input === "''\n" ? "" : input,
      errorMessage: this.error,
    };
  },

  watch: {
    code() {
      this.check();
    },

    errorMessage() {
      this.$emit("update:error", this.errorMessage);
    },
  },

  methods: {
    highlighter(code: string) {
      // js highlight example
      return highlight(code, languages.yaml, "yaml");
    },

    check() {
      try {
        const config = parse(this.code) || "";
        this.errorMessage = "";
        this.$emit("update:config", config);
      } catch (e) {
        this.errorMessage = e.message;
        this.$emit("update:config", this.code);
      }
    },
  },

  components: { PrismEditor },
};
</script>
