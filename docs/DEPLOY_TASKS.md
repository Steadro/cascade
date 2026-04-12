# Cascade — Deployment Fix Tasks for Claude Code

**Context:** Cascade is deployed on DigitalOcean App Platform (app name: `cascade-app`). The first build failed because the codebase hasn't been updated for production deployment yet. These tasks fix that. Execute them in order. Do not skip steps. Verify after each step.

**Read first:** `docs/CLAUDE.md`, `docs/DEPLOYMENT.md` (new file being added in Task 1).

---

## Task 1: Add new documentation files

Copy these files into the repo exactly as provided. Do not modify them.

### 1a. Create `docs/DEPLOYMENT.md`

This is the full deployment runbook. Kyle will provide this file — copy it to `docs/DEPLOYMENT.md`.

### 1b. Update `docs/CLAUDE.md`

**Replace the entire "Deployment" section** (everything under `## Deployment` until the next `##` heading) with:

```
## Deployment

**Platform:** DigitalOcean App Platform (app: cascade-app) + managed PostgreSQL (steadro-cascade-postgresql-dev, NYC1, PostgreSQL 18).

**Key facts:**
- PostgreSQL is the only database. SQLite is no longer used anywhere.
- Port 8080 is required by DigitalOcean App Platform. Server must bind to `0.0.0.0`.
- Dockerfile uses `node:20-slim` (not Alpine — Prisma has binary target issues on Alpine).
- Migrations run via a `PRE_DEPLOY` job in the app spec, NOT in the Dockerfile CMD.
- `prisma generate` runs at Docker build time. `prisma migrate deploy` runs as a PRE_DEPLOY job before each deployment.
- `DATABASE_URL` is set as an env var in the DO dashboard. It is not available at build time.
- `SHOPIFY_APP_URL` will be set to the `*.ondigitalocean.app` domain after first successful deploy.
- Multi-store testing uses the DigitalOcean deployment (permanent URL), not local tunnels. Both dev stores install against the deployed app URL.
- Local single-store dev still uses `shopify app dev` with the default Cloudflare tunnel — no changes to that workflow.
- See `docs/DEPLOYMENT.md` for the full runbook.

**Deployment workflow:**
1. Make changes locally, verify with `shopify app dev`
2. `git push origin main`
3. DO auto-builds from Dockerfile, then starts new container
4. Zero-downtime rolling deploy — old container serves until new one passes health check
5. If health check fails, automatic rollback

**Health check:** `/health` endpoint must return 200 without Shopify auth.
```

**Add these to the "Known Gotchas" section** (append, do not replace existing entries):

```
- Dockerfile must use `node:20-slim`, not `node:20-alpine`. Prisma has binary target mismatches on Alpine that cause runtime crashes.
- Server must bind to `0.0.0.0:8080`, not `localhost:8080`. App Platform routes traffic to `0.0.0.0` — binding to localhost makes the container unreachable.
- If using Prisma 7: `?sslmode=require` fails with DigitalOcean's self-signed CA. Use `?sslmode=no-verify` or bundle the CA cert.
```

### 1c. Update `docs/DECISIONS.md`

**Add after AD-005:**

```
### AD-006: Early deployment to DigitalOcean App Platform (Phase 3.5)
**Date:** 2026-04-11
**Decision:** Deploy to DigitalOcean App Platform during development rather than after feature completion.
**Why:** `shopify app dev` can only override the app URL for one store at a time. The second paired store loads against `example.com`, making multi-store testing impossible locally. ngrok is blocked at the network level. Rather than accumulating local workarounds, we deploy to production infrastructure early so all dev stores install against a permanent URL.
**Trade-off:** Every code change requires a push-and-deploy cycle (~3-5 min) instead of instant local hot reload. Mitigated by continuing to use `shopify app dev` for single-store UI development and only deploying for multi-store integration testing.

### AD-007: PRE_DEPLOY job for Prisma migrations (Phase 3.5)
**Date:** 2026-04-11
**Decision:** Run `prisma migrate deploy` as a DigitalOcean PRE_DEPLOY job instead of in the Dockerfile CMD.
**Why:** Running migrations in CMD creates race conditions if the app scales to multiple container instances. PRE_DEPLOY runs once before any containers start, and if it fails, the deployment is rolled back automatically.
**Trade-off:** Adds a job component to the app spec. Negligible cost — uses the smallest instance size and runs for seconds.

### AD-008: node:20-slim over node:20-alpine for Docker (Phase 3.5)
**Date:** 2026-04-11
**Decision:** Use `node:20-slim` (Debian-based) instead of `node:20-alpine` for the production Docker image.
**Why:** Prisma ORM has known binary target mismatches on Alpine Linux. The Prisma query engine expects `debian-openssl-3.0.x` targets. Alpine uses musl libc instead of glibc, which can cause silent runtime failures.
**Trade-off:** Slightly larger image (~50MB more). Acceptable — image size is not a bottleneck on App Platform.
```

**Update the Phase Completion Status table** — add this row after Phase 3.5:

```
| 3.6: DigitalOcean deployment + multi-store unblock | In progress | — | — |
```

### 1d. Update `docs/PROJECT_CONTEXT.md`

**Replace the Status line** near the top of the file. Find:
```
**Status:** Scaffolded, app running on dev store, ready for development
```
Replace with:
```
**Status:** Phases 1–3 complete (foundation, store pairing, sync read & diff). Deploying to DigitalOcean App Platform to unblock multi-store testing. Phase 4 (sync transform & execute) begins after deployment is verified.
```

**Verification:** `git diff` should show changes in all four files. Commit: `git commit -am "docs: add deployment runbook, update docs for DO deployment"`

---

## Task 2: Check Prisma version and SSL compatibility

Run:
```bash
npm ls prisma
```

- If Prisma **6.x**: No SSL changes needed. The `?sslmode=require` in the DATABASE_URL works fine.
- If Prisma **7.x**: Kyle needs to update the DATABASE_URL in the DigitalOcean dashboard. Change `?sslmode=require` to `?sslmode=no-verify` at the end of the connection string. Tell Kyle this is needed and why (Prisma 7 treats `require` as `verify-full`, which fails with DigitalOcean's self-signed certificates).

**Verification:** Note the Prisma version for later reference. If Prisma 7, tell Kyle to update the env var before the next deploy.

---

## Task 3: Determine the build output directory

Check what directory `npm run build` outputs to. Look in:
- `vite.config.ts` — look for `build.outDir` or `ssrBuild`
- `react-router.config.ts` — look for `buildDirectory`
- `package.json` — look at the `start` script to see what path it serves from

The default for the Shopify React Router template is usually `build/`. Note the exact directory name — it's needed for the Dockerfile in the next step.

**Verification:** Run `npm run build` and confirm which directory is created.

---

## Task 4: Replace the Dockerfile

Replace the entire `Dockerfile` at the repo root. Use the build output directory from Task 3 (shown as `BUILD_DIR` below — replace with actual value, e.g., `build`):

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci
COPY prisma ./prisma/
RUN npx prisma generate
COPY . .
RUN npm run build
RUN npm prune --production

FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/BUILD_DIR ./BUILD_DIR
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

EXPOSE 8080
ENV NODE_ENV=production
ENV PORT=8080

CMD ["npm", "run", "start"]
```

**Key differences from the old Dockerfile:**
- `node:20-slim` instead of `node:20-alpine`
- Multi-stage build (smaller final image)
- `openssl` installed via `apt-get` instead of `apk`
- NO migrations in CMD — migrations are handled by DigitalOcean's PRE_DEPLOY job
- `prisma generate` runs during build stage

**Verification:** `docker build .` should succeed locally (if Docker is available). If not, at minimum verify the Dockerfile has no syntax errors and the BUILD_DIR replacement is correct.

Commit: `git commit -am "chore: update Dockerfile for DO App Platform deployment"`

---

## Task 5: Add a health check endpoint

Create `app/routes/health.tsx`:

```typescript
export async function loader() {
  return new Response("OK", { status: 200 });
}
```

**Important:** This route must NOT be behind Shopify authentication. Check how routes are structured:
- If routes under `app.` prefix go through auth (e.g., `app/routes/app.tsx` wraps them), then `health.tsx` at the routes root should be outside auth. Verify by checking `app/routes/app.tsx` for an authentication wrapper.
- The health check URL will be `/health` based on React Router file-based routing.

**Verification:**
1. Run `shopify app dev`
2. In a separate terminal: `curl http://localhost:PORT/health` (replace PORT with the dev server port)
3. Should return `OK` with status 200
4. If it returns a redirect or 401, the route is behind auth — move it or adjust routing.

Commit: `git commit -am "feat: add health check endpoint for DO App Platform"`

---

## Task 6: Verify server binds to 0.0.0.0

Check the server entry point. For React Router apps, this is typically in `server.ts` or wherever the HTTP server is created.

The server MUST listen on `0.0.0.0`, not `localhost` or `127.0.0.1`. DigitalOcean App Platform routes traffic to `0.0.0.0` — if the server only listens on localhost, the container appears healthy to Node but unreachable to the load balancer.

For the Shopify React Router template, the default server typically binds to `0.0.0.0` already. Verify this by searching for:
```bash
grep -r "listen" app/ server.* --include="*.ts" --include="*.tsx" --include="*.js"
```

If it's binding to `localhost` or `127.0.0.1`, change it to `0.0.0.0`.

**Verification:** Note what you found. No commit needed if no changes.

---

## Task 7: Push and trigger deploy

```bash
git push origin main
```

DigitalOcean will auto-detect the push and start a new build. The build takes 3-5 minutes.

**Tell Kyle:**
1. "Code changes pushed. DigitalOcean should start building automatically."
2. "Go to the DO dashboard → cascade-app → Activity tab to watch the build."
3. "If build succeeds, go to the Networking tab — your app domain will appear there."
4. If Prisma 7 was detected in Task 2: "You need to update DATABASE_URL in the DO env vars — change `?sslmode=require` to `?sslmode=no-verify`."

---

## Task 8: Post-deploy checklist (after build succeeds)

Once Kyle confirms the build succeeded and provides the DO domain:

1. Update `SHOPIFY_APP_URL` in DO dashboard env vars to the new domain (Kyle does this)
2. Update `shopify.app.toml`:
   - `application_url` → the DO domain
   - `redirect_urls` → `["https://DOMAIN/auth/callback"]`
3. Update Shopify Partner Dashboard app URL and redirect URLs (Kyle does this)
4. Commit and push the `shopify.app.toml` changes

**Do not proceed to Phase 4 until multi-store connectivity is verified.**
