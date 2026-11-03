<template>
  <div class="code-field ltr" dir="ltr">
    <prism-editor v-model="code" :highlight="highlighter" line-numbers></prism-editor>
  </div>
  <p :class="['code-note', { failed: !!errorMessage }]" role="status">
    {{ errorMessage || t('settings.modules.editor.info') }}
  </p>
</template>

<script lang="ts">
import { inject } from "vue";
import { parse, stringify } from "../../ts/Utils";
import { useI18n } from 'vue-i18n';

export default {
  name: "Editor",

  props: {
    config: {
      type: [Object, String],
      required: true,
    },

    error: {
      type: String,
      default: "",
    },
  },

  setup() {
    const prismHighlight = inject("prismHighlight");
    const prismLanguages = inject("prismLanguages");

    const { t, locale } = useI18n();

    return {
      prismHighlight,
      prismLanguages,
      t,
      locale,
    };
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
    highlighter(code) {
      // Use fallback-safe values
      if (!this.prismHighlight || !this.prismLanguages.yaml) {
        console.error("Prism not properly injected.");
        return code;
      }
      return this.prismHighlight(code, this.prismLanguages.yaml, "yaml");
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
};
</script>

<style scoped>
.code-field {
  max-height: 40vh;
  overflow: auto;
  border: 1px solid rgb(var(--v-theme-field-line));
  border-radius: 8px;
  background: rgb(var(--v-theme-field));
}

.code-field:focus-within {
  outline: 1px solid rgb(var(--v-theme-focus));
  border-color: rgb(var(--v-theme-focus));
}

.code-field :deep(.prism-editor__container) {
  min-height: 96px;
  font-family: "JetBrains Mono Variable", monospace;
  font-size: 13px;
}

.code-note {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgb(var(--v-theme-muted));
}

.code-note.failed {
  color: rgb(var(--v-theme-error));
}
</style>
