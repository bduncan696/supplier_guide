# Vendor Sites Side Panel

SvelteKit app for the EPC tools side panel. It exposes server routes for Procore OAuth/proxy and vendor site lookups.

## Setup

Install dependencies:

```sh
npm install
```

Create env file:

```sh
cp .env.example .env.local
```

Run locally:

```sh
npm run dev
```

## Vendor database (Cloud SQL)

The server route can fetch vendor sites from `BMCD_TADP_SUPP_SITES_T`.

1. Set `VENDOR_DB_ENABLED=true`.
2. Configure either:
   - `VENDOR_DB_CONNECTION_URL`, or
   - `VENDOR_DB_INSTANCE_CONNECTION_NAME` + `VENDOR_DB_USER` + `VENDOR_DB_PASS` + `VENDOR_DB_NAME`.
3. Fetch data via `GET /api/vendor-sites`.

## Build and Run (Production)

```sh
npm run build
npm run start
```

## Deploy to Cloud Run

Build and deploy from source:

```sh
gcloud run deploy vendor-app \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

Set secrets/env vars on the service for Procore and database values. Do not deploy with localhost callback URLs.

## Scaling note for OAuth state

OAuth session/token/state currently use in-memory storage. For reliable multi-instance Cloud Run behavior, either:

1. keep instance count at 1, or
2. move auth state/token storage to a shared store (for example Redis/Firestore/SQL).
