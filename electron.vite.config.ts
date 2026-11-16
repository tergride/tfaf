import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    define: {
      // Release builds carry the OAuth client id given at build time instead of reading the user's environment.
      'process.env.TFAF_OAUTH_CLIENT_ID': JSON.stringify(process.env.TFAF_OAUTH_CLIENT_ID ?? ''),
      // Likewise another Discord application for the status; empty keeps TFAF's own.
      'process.env.TFAF_DISCORD_APP_ID': JSON.stringify(process.env.TFAF_DISCORD_APP_ID ?? ''),
      // The releases repository the build updates from, for its version history; electron-builder gets it separately.
      'process.env.TFAF_UPDATE_GITHUB': JSON.stringify(process.env.TFAF_UPDATE_GITHUB ?? ''),
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') },
    },
    plugins: [vue(), tailwindcss()],
    build: {
      minify: true,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          splash: resolve('src/renderer/splash.html'),
        },
      },
    },
  },
});
