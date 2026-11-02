<script lang="ts">
import { cloneVNode, defineComponent, h } from "vue";

let count = 0;

/**
 * A label above a form field: <FieldLabel :label="…"><v-text-field …/></FieldLabel>.
 * The first element inside is the field; it gets the id the label points to.
 */
export default defineComponent({
  name: "FieldLabel",
  props: { label: { type: String, required: true } },
  data() {
    return { id: `field-${++count}` };
  },
  render() {
    const [field, ...rest] = this.$slots.default?.() ?? [];
    return h("div", { class: "field" }, [
      h("label", { for: this.id, class: "field-label" }, this.label),
      field && cloneVNode(field, { id: this.id }),
      ...rest,
    ]);
  },
});
</script>
