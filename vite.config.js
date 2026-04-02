import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  server: {
    port: 0,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
