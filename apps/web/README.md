# GoldShore Marketing Site

This package contains the public marketing site that powers [https://goldshore.org](https://goldshore.org).

## Commands

Install dependencies and build locally without affecting the Worker bundle produced in the repository root:

```bash
cd apps/web
npm install
npm run dev
npm run build
```

`npm run build` writes the static site to `apps/web/dist/` for Cloudflare Pages and does not modify the Worker build output in `dist/` at the repository root.
