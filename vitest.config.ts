import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import yaml from '@rollup/plugin-yaml';

export default defineConfig({
  plugins: [
    vue(),
    yaml(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    deps: {
      inline: ['vuetify', 'markdown-it', 'echarts', 'muuri'],
    },
    include: ['./tests/unit tests/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  }
});
