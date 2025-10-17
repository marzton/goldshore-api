import { defineConfig } from 'astro/config';

// Static build; deploy target serves the /dist output.
export default defineConfig({
  site: 'https://goldshore.org',
  output: 'static',
  publicDir: 'public',
  outDir: 'dist',
  server: { port: 4321, host: true },
});
