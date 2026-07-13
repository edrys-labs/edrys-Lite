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
      inline: ['vuetify', 'markdown-it', 'echarts', 'muuri', 'y-webrtc'],
    },
    include: ['./tests/unit/**'],
  },
  resolve: {
    // Yjs and its protocol/lib0 helpers must be singletons — genericprovider
    // ships its own copies, so force everything onto edrys's instance.
    dedupe: ['yjs', 'lib0', 'y-protocols'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      'y-webrtc': path.resolve(__dirname, './node_modules/y-webrtc/src/y-webrtc.js'),
    },
  }
});
