# Gluten-Free Recipes (Phase 1)

A gluten-free recipe magazine built with Next.js (App Router), TypeScript, Tailwind CSS and Supabase, ready to deploy on Vercel.

Phase 1 contains the public website, database, admin dashboard, SEO infrastructure and server-side publishing services. **No AI generation, Pinterest API publishing or scheduled jobs are active.** The automation architecture exists as interfaces only and refuses to run.

## What's included

- **Public site**: homepage (hero, 8 category cards, latest 12 recipes, most-viewed recipes from real view counts), category landing pages with pagination, recipe pages, search, About, Contact, Privacy Policy, Editorial Policy and Recipe Disclaimer.
- **Recipe pages** (`/recipes/[slug]`): H1, featured image, introduction, prep/cook/total time, servings, exact ingredients (US + metric), numbered steps, tips, substitutions, storage, optional nutrition estimates, FAQ, related recipes, Jump to Recipe, Pinterest Save link, print-friendly recipe card, recipe disclaimer link and gluten-free label/cross-contact notes.
- **SEO**: server-rendered static pages, unique titles and descriptions, canonical URLs, Open Graph and Twitter cards, Recipe and Breadcrumb JSON-LD (no ratings or reviews), XML sitemap (published recipes only), robots.txt, clean slugs, optimized images via `next/image`.
- **Database**: Supabase migrations for `categories`, `recipes`, `recipe_views`, `keywords`, `publishing_jobs`, `pinterest_posts` and `admin_users`, with Row Level Security, unique constraints and idempotency keys.
- **Admin** (`/admin`): Supabase email/password login restricted to users in `admin_users`; recipe list, editor with publish-readiness checks, publish/unpublish, draft preview, image upload to Supabase Storage, categories, keyword import (CSV), publishing jobs, Pinterest status and errors.
- **Gluten-free safety**: ingredient checks block wheat, barley, rye and unqualified wheat products; oats, sauces, broth, baking powder and similar items are flagged for a gluten-free label on the page; copy is checked for medical-safety claims, invented testing and fake ratings.
- **Example content**: five recipe drafts (pancakes, banana bread, brownies, chicken Alfredo, blueberry muffins) in `supabase/seed.sql`. They stay drafts until reviewed, photographed and published.

## Quick start (local)

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and publishable key
npm run dev                  # http://localhost:3000
```

The site builds and runs without Supabase configured (it shows empty states), but you need a Supabase project to see content or use the admin.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates route types and runs `tsc` |
| `npm test` | Unit tests (Vitest) |
| `npm run check` | Lint, type check and tests |
| `npm run seed:generate` | Regenerates `supabase/seed.sql` from `src/content/example-recipes.ts` |

Database policy tests live in `supabase/tests/rls_test.sql` (see the setup guide).

## Documentation

- [Setup and deployment (Supabase + Vercel)](docs/SETUP.md)
- [Architecture and future automation](docs/ARCHITECTURE.md)

## Project structure

```
src/
  app/(site)/          public pages (home, recipes, categories, search, policies)
  app/admin/           admin dashboard, login and Server Actions
  app/api/views/       records real recipe page views
  app/sitemap.ts       XML sitemap (published recipes only)
  app/robots.ts        robots.txt
  components/          site, recipe and admin UI
  content/             navigation, hero image setting, example recipe drafts
  lib/data/            cached public queries and admin queries
  lib/recipes/         types, validation, gluten checks, formatting
  lib/seo/             metadata, JSON-LD, sitemap builder
  lib/services/        publishing services (recipes, keywords, jobs, Pinterest, automation skeleton)
  lib/supabase/        public, session, browser and service-role clients
  proxy.ts             admin session refresh and redirect
supabase/
  migrations/          schema, RLS, storage bucket, categories
  seed.sql             five example drafts
  tests/rls_test.sql   database security checks
tests/                 Vitest unit tests
```
