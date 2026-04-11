# Cascade

A Shopify embedded app for promoting store content between dev, staging, and production environments. Built by Steadro.

## Project Documentation

Three documents govern all development. Read them before making changes:

- **`/docs/PROJECT_CONTEXT.md`** — Why we're building this, business decisions, competitive landscape, research findings, App Store requirements.
- **`/docs/SPEC_TECHNICAL.md`** — How to build it. Database schema, sync engine architecture, screen specs, API patterns, compliance handlers, development phases.
- **`/docs/DECISIONS.md`** — Architectural decisions, temporary dev workarounds (with removal conditions), and phase completion status. **Check this before every release milestone.**

When these documents conflict with assumptions or training data, the documents win.

## How to Work

### Plan First, Then Execute

Start every non-trivial task in Plan Mode (Shift+Tab twice). Build the plan, iterate until it's solid, then switch to auto-accept edits and execute. A good plan lets you one-shot the implementation. If something goes sideways mid-execution, stop and re-plan — don't keep pushing.

### Verify Everything

Give yourself a way to verify your work. After every significant change:
- Run `npx prisma migrate dev` and confirm migrations apply cleanly
- Run `npx prisma generate` to confirm the client generates
- Check for TypeScript errors
- Run `shopify app dev` and confirm the app loads without errors
- If you built UI, open the preview URL and confirm it renders correctly

Do not claim a task is complete without verification. Verification 2-3x the quality of the output.

### Update This File After Mistakes

When you make a mistake, add a rule to the Known Gotchas section below so it doesn't happen again. This file should grow over time with project-specific learnings. Claude is excellent at writing rules for itself.

### Commit Often

After each meaningful change, commit with a descriptive message. Don't batch multiple unrelated changes into one commit.

## Documentation Lookup Rules

**Always use Context7 MCP to fetch current documentation before writing or modifying code that uses any external library or API.** This is mandatory, not optional. Do not rely on training data for API signatures, method names, configuration options, or patterns.

Specifically, use Context7 for:
- **Shopify GraphQL Admin API** — mutations, queries, input types, field names
- **Shopify App Bridge** — initialization, session tokens, navigation, modals
- **Shopify Polaris** — component names, props, usage patterns
- **React Router** (formerly Remix) — loaders, actions, routing, data fetching
- **Prisma ORM** — schema syntax, client API, migrations
- **@shopify/shopify-app-js** — authentication, session management, webhook handling, billing

If Context7 doesn't have docs for a specific library, say so and use web search or ask rather than guessing.

## Hard Rules

1. **GraphQL Admin API only.** Zero REST API calls. Shopify mandates GraphQL for all new public apps.
2. **Polaris for all UI.** No custom component libraries. Use Shopify's Polaris design system.
3. **Session token auth.** No third-party cookies, no localStorage for auth. Must work in Chrome incognito.
4. **No billing code.** Billing is handled by Shopify Managed Pricing in the Partner Dashboard. The app only checks subscription status — it does not create charges.
5. **Sync dependency order matters.** Metafield definitions → Products → Collections → Pages → Blog posts → Menus → Redirects. Menus are always last because they reference other resources.
6. **`productSet` deletes omitted variants.** Always include ALL variants when calling `productSet`. Read the full product before updating.
7. **All IDs are store-specific.** Never assume a GID from one store is valid on another. Use the ResourceMap table for cross-store ID lookups.

## Tech Stack

- React Router v7 (Shopify app template — NOT legacy Remix)
- Node.js
- Prisma ORM (PostgreSQL — DigitalOcean managed in production, local or remote for dev)
- Shopify Polaris + App Bridge
- Shopify GraphQL Admin API

## Dev Commands

```bash
shopify app dev                    # Start dev server with tunnel (single-store local dev)
npx prisma migrate dev             # Run database migrations (requires DATABASE_URL)
npx prisma generate                # Regenerate Prisma client
npx prisma studio                  # Browse database
npm run build                      # Production build
npm run start                      # Serve production build (PORT env var, default 8080)
```

## Structure

```
/app                  # React Router app (routes, components, utilities)
/docs                 # Project context and technical spec
/prisma               # Database schema and migrations
/extensions           # Shopify app extensions (if any)
shopify.app.toml      # Shopify app configuration
Dockerfile            # Production container (DigitalOcean App Platform)
.env.example          # Required environment variables
CLAUDE.md             # This file — read automatically every session
```

## Deployment

**Platform:** DigitalOcean App Platform + managed PostgreSQL (steadro-cascade-postgresql-dev, NYC1, PostgreSQL 18).

**Single environment for now.** Until Cascade is ready for App Store submission, there is only one DigitalOcean environment: one App Platform app + one managed Postgres instance + one Shopify Partner app pointing at its URL. Both dev stores install against this same deployment. A separate production environment (second App Platform app, second managed DB, second Partner app config) will be created only at launch time. See DECISIONS.md § AD-006 for the rationale.

**Key facts:**
- PostgreSQL is the only database. SQLite is no longer used anywhere.
- Port 8080 is required by DigitalOcean App Platform.
- `Dockerfile` at repo root handles the production build. It runs `prisma generate` at build time and `prisma migrate deploy` at container start.
- `DATABASE_URL` must be set as an env var pointing to the managed PostgreSQL instance (with `?sslmode=require`).
- Multi-store testing uses the DigitalOcean deployment (permanent URL), not local tunnels. Both dev stores install against the deployed app URL.
- Local single-store dev still uses `shopify app dev` with the default Cloudflare tunnel — no changes to that workflow.

### Current Deployment Status

**As of 2026-04-11:** The DigitalOcean App Platform project has been created and the GitHub main branch is linked, but **no container has been deployed yet**. `application_url` in `shopify.app.toml` is still the placeholder `https://example.com`. The next concrete action is to walk through the First-Time Deploy Runbook below. Until that happens, no live URL exists, multi-store install cannot be validated, and Phase 4 work must stay in code/unit-test territory that doesn't require an end-to-end cross-store sync.

### First-Time Deploy Runbook

Follow these steps in order. Each step depends on the previous one.

**1. Configure the App Platform component**
- Build method: **Dockerfile** (auto-detected from `Dockerfile` at repo root — confirm it's not Buildpacks)
- HTTP port: **8080**
- Region: **NYC1** (same as `steadro-cascade-postgresql-dev` — keeps DB traffic on DO's private VPC)
- Instance size: Basic tier is sufficient for dev

**2. Attach the managed database**
- Add `steadro-cascade-postgresql-dev` as a database component in the App Platform project.
- This creates a binding variable that can be referenced as `${steadro-cascade-postgresql-dev.DATABASE_URL}` in env vars. Prefer this over pasting the raw connection string — DO rotates credentials automatically and traffic stays on the private VPC.
- Fallback: paste the raw `DATABASE_URL` into env vars directly. Must end with `?sslmode=require`.

**3. Set environment variables**

| Key | Value | Encrypted? |
|---|---|---|
| `DATABASE_URL` | `${steadro-cascade-postgresql-dev.DATABASE_URL}` (or raw URL with `?sslmode=require`) | Yes |
| `SHOPIFY_API_KEY` | `03cccdd9479bd45fe02e377e43b8c3b5` (client_id from `shopify.app.toml`) | No — this is public |
| `SHOPIFY_API_SECRET` | From Partner Dashboard → Cascade → Configuration → Client credentials → Client secret | **Yes** |
| `SCOPES` | Full scopes string from `shopify.app.toml` line 9 | No |
| `SHOPIFY_APP_URL` | **Leave blank for the first deploy.** Set in step 5 after DO assigns the URL. | No |

Do **not** set `NODE_ENV` or `PORT` — the Dockerfile already hard-codes these.

**4. First deploy**
- Trigger the deploy. Expect 4–8 minutes for a cold build (npm ci + prisma generate + react-router build).
- Watch build logs for: `prisma generate` succeeds → `react-router build` succeeds → container starts → `prisma migrate deploy` reports either "No pending migrations" or applies them cleanly → app listens on `0.0.0.0:8080`.
- First-deploy failure modes: missing env var at build time, Prisma client generation, a TypeScript error that didn't surface locally, or a node engine mismatch (`package.json` requires `>=20.19 <22 || >=22.12`).

**5. Capture the URL and redeploy with `SHOPIFY_APP_URL` set**
- Once the deploy is green, DO assigns a URL like `https://cascade-xxxxx.ondigitalocean.app`.
- Go back to env vars, paste the URL into `SHOPIFY_APP_URL`, save. DO will redeploy automatically (1–2 min, cached).
- This second deploy is when the Shopify framework actually knows its public URL and can handle OAuth.

**6. Update `shopify.app.toml` and push Partner Dashboard config**
- Edit `shopify.app.toml`:
  - `application_url = "https://cascade-xxxxx.ondigitalocean.app"` (no trailing slash)
  - `redirect_urls = ["https://cascade-xxxxx.ondigitalocean.app/auth/callback", "https://cascade-xxxxx.ondigitalocean.app/auth/shopify/callback", "https://cascade-xxxxx.ondigitalocean.app/api/auth/callback"]` (confirm the exact paths the Shopify framework registers — check `app/shopify.server.ts` if unsure)
- Run `shopify app deploy` from the local machine to push the config to the Partner Dashboard. This is what actually tells Shopify "the app lives here now." OAuth will not work until this step completes.
- Commit the `shopify.app.toml` change so the deployed URL is source-controlled.

**7. Install on the first dev store**
- Partner Dashboard → Apps → Cascade → "Test on development store" → pick the first store.
- Walk through the OAuth consent screen. The embedded app should load inside the store admin.
- Verify a row exists in the Prisma `Session` table for the store (`npx prisma studio` locally, pointing at the same `DATABASE_URL` — or use DO's database console).

**8. Install on the second dev store**
- Visit: `https://admin.shopify.com/store/SECOND-STORE-HANDLE/oauth/install?client_id=03cccdd9479bd45fe02e377e43b8c3b5`
- Complete OAuth. Verify the second `Session` row appears.
- Both stores now have offline access tokens in the same Postgres instance. Cross-store API calls (via `createAdminApiClient` — AD-004) will work server-to-server from this point on.

**9. End-to-end Phase 1–3 validation**
- From Store A's admin, open Cascade. Pair Store A with Store B.
- Run the read + diff pipeline (Phase 3). Confirm the preview UI renders a diff against real Store B data.
- Any issues surfaced here are Phase 3 cleanup, **not** Phase 4 scope (per DECISIONS.md Phase 4 Handoff).

### Deploy Troubleshooting (to be filled in as issues surface)

<!-- When the first deploy hits a wall, document the specific failure and fix here so the next deploy doesn't repeat it. -->

- *(none yet — first deploy hasn't been run)*

## Known Gotchas

<!-- Add entries here as you encounter issues. Format: what went wrong → what to do instead. -->
- The repo was initially scaffolded from the legacy Remix template. It has been corrected to the React Router template. Do not reference Remix patterns — use React Router v7 patterns.
- `SHOPIFY_CLI_PARTNERS_TOKEN` env var works for `shopify app config link` but breaks `shopify app dev` (401 on organization API). Must be unset before running `shopify app dev`.
- Shopify's Google SSO can loop if the connected Google account email doesn't match the Shopify account email. The accounts.shopify.com security settings control this.
- Vitest runs test files in parallel by default. With a shared test database, this can cause constraint failures. `fileParallelism: false` in vitest.config.ts fixes this.
- `npx prisma generate` fails with EPERM on Windows when `query_engine-windows.dll.node` is locked by a running node process. Kill the dev server first.
- `shopify app dev` only overrides the app URL for one store. Multi-store testing now uses the DigitalOcean deployment — both stores install against the deployed app URL. Local dev with `shopify app dev` is for single-store work only.
- ngrok is blocked at the network level (SSL/TLS interception). Do not attempt ngrok-based multi-store testing — use the DigitalOcean deployment instead.
- First-launch onboarding: when a store has no pairings and no subscription, show a dismissible Polaris info banner recommending they install on their production store first for billing purposes.
