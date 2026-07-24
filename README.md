# ConLangLab (CLL)

A tool that generates complete, internally-consistent constructed languages — phonology, lexicon, morphology, syntax, and orthography — from real linguistic typology rather than random word-soup or templates. Every generated feature is deterministic, seedable, and traceable to an explicit rule. See [`conlang-generator-design-doc.md`](./conlang-generator-design-doc.md) for the full design rationale.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Backend/DB**: Convex
- **Auth**: Clerk
- **Language**: TypeScript
- **Audio synthesis**: Pink Trombone (articulatory voice synth, used to preview generated phonemes/words)
- **Testing**: Vitest

## Getting Started

### Prerequisites

- Node.js
- pnpm
- A [Convex](https://convex.dev) project and a [Clerk](https://clerk.com) application

### Installation

```bash
pnpm install
```

### Environment Variables

Set these in `.env.local`:

| Variable | Description |
| --- | --- |
| `CONVEX_DEPLOYMENT` | Convex deployment identifier (set by `npx convex dev`) |
| `NEXT_PUBLIC_CONVEX_URL` | Convex client URL |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex site URL (HTTP actions) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk JWT issuer domain, used by `convex/auth.config.ts` to validate Convex auth |

### Running Locally

Run the Convex dev server and the Next.js dev server in parallel (two terminals):

```bash
npx convex dev
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Generation Pipeline

Each language moves through five stages, generated and steered independently. A stage can be locked to protect it from later regeneration, and downstream stages are flagged **stale** (not auto-regenerated) when an upstream stage they depend on changes:

```
Phonology ──┬──▶ Lexicon ──▶ Morphology ──▶ Syntax
            └──▶ Orthography ◀── Morphology
```

**Status**: Phonology and Lexicon are implemented end-to-end (generation, steering UI, audio preview, history/undo). Morphology's generation engine and Convex schema exist; its UI is not yet wired up. Syntax and Orthography are not yet started.

## Project Structure

```
convex/
  languages.ts        # language CRUD (list/get/create/rename/remove)
  auth.config.ts       # Clerk JWT config for Convex auth
  lib/                 # shared auth helper, seeded RNG, stage-history diffing
  phonology/            # sound inventory + phonotactics generation, mutations, queries
  lexicon/              # root-word generation (~500 roots), mutations, queries
  morphology/           # affix/category generation (backend only — no UI yet)
  schema.ts            # Convex tables: languages, phonology, lexicon, morphology(+Items), syntax, orthography, stageHistory, languageShares, languageRelations

src/
  app/
    page.tsx                          # language library (home)
    language/[id]/page.tsx            # language detail
    language/[id]/phonology/page.tsx  # phonology stage UI
    language/[id]/lexicon/page.tsx    # lexicon stage UI
    sign-in/, sign-up/                # Clerk auth pages
  components/
    phonology/, lexicon/              # per-stage steering UI (param controls, live preview, history sidebar)
  lib/
    phonology/, lexicon/              # client-side engine helpers, audio playback, draft state
    themes.ts, theme-context.tsx      # multi-theme support

tests/
  phonology.generate.test.ts
  lexicon.generate.test.ts
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Start the production server |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the Vitest suite (`tests/**/*.test.ts`) |

Convex functions are run separately via `npx convex dev` (local) or deployed via `npx convex deploy`.
