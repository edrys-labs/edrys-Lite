<script lang="ts">
import { defineComponent } from 'vue';

type Part = { text: string; href?: string };

function webLink(href: string | null): string | undefined {
  try {
    const url = new URL(href || '');
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch (e) {}
}

// Descriptions (module <meta>, classroom meta) may contain HTML such as
// links. Keep only text, line breaks and http(s) links, and let Vue render
// them, so nothing in the description can run code. DOMParser is inert: it
// runs no scripts and loads no images.
export function linkedParts(html: string): Part[] {
  const parts: Part[] = [];
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push({ text: child.textContent || '' });
      } else if (child.nodeName === 'BR') {
        parts.push({ text: '\n' });
      } else if (child.nodeName === 'A' && webLink((child as Element).getAttribute('href'))) {
        const href = webLink((child as Element).getAttribute('href'))!;
        parts.push({ text: child.textContent || href, href });
      } else {
        walk(child);
      }
    });
  };
  walk(new DOMParser().parseFromString(html || '', 'text/html').body);
  return parts;
}

export default defineComponent({
  name: 'LinkedText',
  props: {
    text: { type: String, default: '' },
  },
  computed: {
    parts(): Part[] {
      return linkedParts(this.text);
    },
  },
});
</script>

<template>
  <template v-for="(part, i) in parts" :key="i"><a
      v-if="part.href"
      :href="part.href"
      target="_blank"
      rel="noopener noreferrer"
    >{{ part.text }}</a><template v-else>{{ part.text }}</template></template>
</template>
