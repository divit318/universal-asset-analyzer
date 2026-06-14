# Universal Asset Analyzer

Inspect and analyze assets of any type — files, images, and data — in one place.
Built on Next.js 16 (App Router, Turbopack, React 19).

## Getting started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `npm run dev`    | Start the dev server (Turbopack)     |
| `npm run build`  | Production build                     |
| `npm run start`  | Serve the production build           |
| `npm run lint`   | Run ESLint                           |

> Note: as of Next.js 16, `next build` no longer runs the linter — run `npm run lint` separately.

## Project structure

```
app/
  _components/        Shared UI (non-routable, underscore-prefixed)
  analyze/            /analyze — demo analysis page
  api/analyze/        POST /api/analyze — analysis route handler
  layout.tsx          Root layout (header, fonts, metadata)
  page.tsx            Landing page
lib/
  types.ts            Domain types (Asset, AnalysisResult)
  analyze.ts          Analysis core (classify, formatBytes, analyze)
```

The `lib/` module is the domain core and is shared by both the page and the API
route. Kind-specific deep analysis hangs off the `kind` switch in `lib/analyze.ts`
as the project grows.

## Conventions (Next.js 16)

This project follows the conventions documented in `node_modules/next/dist/docs/`
(see `AGENTS.md`). Notably:

- `params` and `searchParams` are async (`Promise`) and must be awaited.
- API endpoints use `route.ts` with named method exports (`GET`, `POST`, …).
- Turbopack is the default bundler.
- The `@/*` import alias maps to the project root.
