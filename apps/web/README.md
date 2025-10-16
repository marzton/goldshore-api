# GoldShore Marketing Site

This package contains the public marketing site that powers [https://goldshore.org](https://goldshore.org).

## Commands

Install dependencies and build locally without affecting the Worker code in the repository root:

```bash
cd apps/web
npm install
npm run dev
npm run build
```

`npm run build` should finish without touching the Worker `dist/` output; it writes the static site to `apps/web/dist/` for Cloudflare Pages.
