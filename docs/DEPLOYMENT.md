# Cascade — Deployment Runbook

**Platform:** DigitalOcean App Platform + Managed PostgreSQL
**Region:** NYC1
**Existing DB cluster:** steadro-cascade-postgresql-dev (PostgreSQL 18, NYC1)

---

## Prerequisites

Before deploying, complete these code changes:

### 1. Check Prisma Version

```bash
npm ls prisma
```

- **Prisma 6.x:** Current `?sslmode=require` in `DATABASE_URL` works as-is.
- **Prisma 7.x:** DigitalOcean's self-signed CA will cause `self-signed certificate in certificate chain` errors. Change the connection string to `?sslmode=no-verify` (encrypts traffic, skips cert validation — acceptable within DO's VPC). Alternatively, download the CA cert from the DO database dashboard and bundle it in the Docker image with `?sslmode=verify-full&sslrootcert=/app/ca-certificate.crt`.

### 2. Fix the Dockerfile

Replace the current Alpine-based Dockerfile with:

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
COPY --from=builder /app/build ./build
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

EXPOSE 8080
ENV NODE_ENV=production
ENV PORT=8080

CMD ["npm", "run", "start"]
```

**Key changes from current Dockerfile:**
- `node:20-slim` instead of `node:20-alpine` (avoids Prisma binary target mismatches)
- Multi-stage build (smaller final image)
- `openssl` installed via `apt-get` instead of `apk`
- Migrations removed from CMD (moved to PRE_DEPLOY job — see app spec below)
- `prisma generate` runs during build, not at container start

**Important:** Verify that `npm run build` outputs to `./build`. If the output directory is different (e.g., `./dist`), update the `COPY --from=builder` line accordingly. Check `vite.config.ts` or `react-router.config.ts` for the actual output path.

### 3. Add a Health Check Endpoint

Create a minimal health check route. Add to your routes directory (e.g., `app/routes/health.tsx`):

```typescript
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return new Response("OK", { status: 200 });
}
```

This must be accessible without Shopify authentication. Verify it's not behind the auth middleware.

### 4. Ensure Server Binds to 0.0.0.0

The Node.js server must bind to `0.0.0.0`, not `localhost` or `127.0.0.1`. This is the most common cause of "container started but health check fails" on App Platform. Check the server entry point — React Router's default template typically does this correctly, but verify.

---

## App Spec

Place this at `.do/app.yaml` in the repo root. This is the canonical infrastructure definition.

```yaml
name: cascade
region: nyc
services:
  - name: web
    github:
      repo: Steadro/cascade
      branch: main
      deploy_on_push: true
    dockerfile_path: Dockerfile
    http_port: 8080
    instance_size_slug: apps-s-1vcpu-1gb
    instance_count: 1
    health_check:
      http_path: /health
      initial_delay_seconds: 15
      period_seconds: 10
      failure_threshold: 6
    routes:
      - path: /
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        value: ${db.DATABASE_URL}
        type: SECRET
      - key: SHOPIFY_API_KEY
        scope: RUN_AND_BUILD_TIME
        type: SECRET
      - key: SHOPIFY_API_SECRET
        scope: RUN_AND_BUILD_TIME
        type: SECRET
      - key: SHOPIFY_APP_URL
        scope: RUN_AND_BUILD_TIME
        value: ${APP_URL}
      - key: SCOPES
        scope: RUN_AND_BUILD_TIME
        value: "read_products,write_products,read_inventory,write_inventory,read_content,write_content,read_online_store_navigation,write_online_store_navigation,read_files,write_files"
      - key: NODE_ENV
        scope: RUN_AND_BUILD_TIME
        value: "production"
      - key: PORT
        scope: RUN_TIME
        value: "8080"
databases:
  - engine: PG
    name: db
    cluster_name: steadro-cascade-postgresql-dev
    production: true
jobs:
  - name: migrate
    github:
      repo: Steadro/cascade
      branch: main
    dockerfile_path: Dockerfile
    instance_size_slug: apps-s-1vcpu-0.5gb
    kind: PRE_DEPLOY
    run_command: npx prisma migrate deploy
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        value: ${db.DATABASE_URL}
        type: SECRET
```

**Notes on the app spec:**
- `${db.DATABASE_URL}` is a bindable variable — DO injects the actual connection string at runtime from the attached database component named `db`.
- `${APP_URL}` resolves to the app's auto-assigned `*.ondigitalocean.app` URL. This sets `SHOPIFY_APP_URL` dynamically.
- `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` values are set manually in the DO UI (not committed to the repo). Mark them as secrets.
- The `migrate` job runs `prisma migrate deploy` before each deployment. If migrations fail, the deploy is halted and rolled back.
- `cluster_name` references the existing managed PostgreSQL cluster. If the name doesn't match exactly, the attachment will fail — verify the exact cluster name in the DO dashboard.
- The `.do/app.yaml` file is **not** automatically read by native auto-deploy. It's consumed by `doctl apps create --spec .do/app.yaml` or the DO GitHub Action. For initial setup, you can also configure everything through the UI and the spec will be generated for you.

---

## Deployment Steps (First Time)

### Option A: Via the DO Web UI (Recommended for First Deploy)

1. **Log into DigitalOcean** → Create → App Platform
2. **Select GitHub** as source provider. Authorize the DigitalOcean GitHub App if not already done. Select `Steadro/cascade`, branch `main`.
3. **App Platform auto-detects the Dockerfile.** Confirm:
   - Type: Web Service
   - HTTP Port: `8080`
   - Instance size: Basic ($12/mo, 1 vCPU, 1 GiB RAM) — this is the minimum tier with horizontal scaling capability
4. **Attach the database:**
   - Click "Add Resource" → Database
   - Select "Previously Created DigitalOcean Database" 
   - Choose `steadro-cascade-postgresql-dev`
   - Name the component `db` (this must match the `${db.DATABASE_URL}` reference)
5. **Set environment variables** on the `web` component:
   - `DATABASE_URL` = `${db.DATABASE_URL}` (scope: Run Time, type: Secret) — may be auto-populated when attaching the DB
   - `SHOPIFY_API_KEY` = your key from Partner Dashboard (scope: Run and Build Time, type: Secret)
   - `SHOPIFY_API_SECRET` = your secret from Partner Dashboard (scope: Run and Build Time, type: Secret)
   - `SHOPIFY_APP_URL` = `${APP_URL}` (scope: Run and Build Time)
   - `SCOPES` = the full scopes string (scope: Run and Build Time)
   - `NODE_ENV` = `production` (scope: Run and Build Time)
   - `PORT` = `8080` (scope: Run Time)
6. **Add the PRE_DEPLOY job** (optional for first deploy — can be added after):
   - Add Resource → Job → same GitHub repo
   - Kind: Pre Deploy
   - Run Command: `npx prisma migrate deploy`
   - Add `DATABASE_URL` = `${db.DATABASE_URL}` env var
7. **Select region:** NYC (must match the database cluster region)
8. **Click Create App**

The build takes 3–5 minutes. Once deployed, you'll get a URL like `https://cascade-xxxxx.ondigitalocean.app`.

### Option B: Via doctl CLI

```bash
doctl apps create --spec .do/app.yaml
```

Then set the secret env vars via the UI or:

```bash
doctl apps update <app-id> --spec .do/app.yaml
```

Secret values must be set through the UI — they can't be committed to the spec file.

---

## Post-Deployment: Update Shopify Configuration

### 1. Update Partner Dashboard

- Go to [partners.shopify.com](https://partners.shopify.com) → Apps → Cascade
- **App URL:** `https://cascade-xxxxx.ondigitalocean.app`
- **Allowed redirection URL(s):** `https://cascade-xxxxx.ondigitalocean.app/auth/callback`
- **GDPR webhooks:** Update all three endpoint URLs to use the new domain

### 2. Update shopify.app.toml

```toml
[application_url]
application_url = "https://cascade-xxxxx.ondigitalocean.app"

[auth]
redirect_urls = ["https://cascade-xxxxx.ondigitalocean.app/auth/callback"]
```

Commit and push — this triggers a redeploy.

### 3. Reinstall on Dev Stores

Each dev store needs to reinstall the app against the new URL:
1. Open the store's admin → Apps → Cascade → Remove app
2. Go to Partner Dashboard → Cascade → Test your app → Select the store → Install

Do this for all three stores: steadro-dev, steadro-stage, steadro-prod.

### 4. Verify Multi-Store Connectivity

After reinstalling on all stores:
1. Open Cascade from Store A's admin — confirm the app loads in the iframe
2. Open Cascade from Store B's admin — confirm the app loads (this was previously failing with `example.com`)
3. Create a store pairing between Store A and Store B
4. Run a sync preview — confirm it can read resources from both stores

If the app loads on the primary store but not paired stores, check that the paired store's session is active in the database (the session is created during install/auth).

---

## Ongoing Deployment Workflow

After initial setup, the workflow is:

1. Make code changes locally
2. `git push origin main`
3. DO auto-builds and deploys (zero-downtime rolling deploy)
4. PRE_DEPLOY job runs migrations before the new container starts
5. Health check passes → new container receives traffic
6. If health check fails → rollback to previous version

**To force rebuild:** DO Dashboard → App → Actions → Force Rebuild

**To view logs:** DO Dashboard → App → Runtime Logs (or Build Logs for build failures)

---

## SSL and Custom Domain (Later)

The `*.ondigitalocean.app` domain has automatic SSL. When ready for a custom domain:

1. DO Dashboard → App → Settings → Domains → Add Domain
2. Add a CNAME record pointing to `cascade-xxxxx.ondigitalocean.app`
3. SSL cert is provisioned automatically via Let's Encrypt
4. If using Cloudflare: **disable the proxy** (grey cloud, DNS only) or SSL provisioning fails
5. Update `SHOPIFY_APP_URL`, Partner Dashboard, and `shopify.app.toml` to the custom domain

---

## Cost Summary

| Component | Monthly Cost |
|-----------|-------------|
| App Platform (Basic, 1 vCPU / 1 GiB) | $12 |
| Managed PostgreSQL (Basic, 1 vCPU / 1 GiB) | ~$15 |
| **Total** | **~$27/mo** |

Scale up as needed. Autoscaling requires dedicated CPU plans ($29+/mo for compute).

---

## Troubleshooting

**Build fails with Prisma binary target error:**
Confirm Dockerfile uses `node:20-slim`, not Alpine. Prisma needs `debian-openssl-3.0.x` target.

**Health check fails, container keeps restarting:**
- Verify server binds to `0.0.0.0:8080`
- Verify `/health` route exists and returns 200 without auth
- Check Runtime Logs for the actual error

**Database connection refused:**
- Verify region matches (app and DB must be in the same region)
- Verify `DATABASE_URL` env var is set with scope `RUN_TIME`
- If Prisma 7: check SSL mode (use `?sslmode=no-verify`)

**`prisma migrate deploy` fails in PRE_DEPLOY:**
- Check the job's `DATABASE_URL` env var is set
- Check that the migration job can reach the database (same region, firewall rules)
- View the job's logs in the DO dashboard

**App loads on primary store but not paired store:**
- Paired store may need to reinstall the app
- Check the `Session` table for an active session for the paired store's domain
- Verify the paired store's offline access token hasn't expired
