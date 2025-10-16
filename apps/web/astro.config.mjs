import { defineConfig } from 'astro/config';

// Static build; Cloudflare Pages serves /dist.
export default defineConfig({
  site: 'https://goldshore.org',
  output: 'static',
  publicDir: 'public',
  outDir: 'dist',
  server: { port: 4321, host: true },
});
