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

## Supplier API (APIGEE)

Vendor and project-site endpoints use APIGEE with OAuth client credentials.

1. Set:
   - `APIGEE_CONSUMER_KEY`
   - `APIGEE_CONSUMER_SECRET`
2. Optionally configure:
   - `APIGEE_BASE_URL` (defaults to nonprod)
   - `APIGEE_ENV` (`nonprod`, `dev`, `test`, `prod`)
   - `APIGEE_TIMEOUT_MS`, `APIGEE_RETRY_COUNT`, `APIGEE_TOKEN_REFRESH_WINDOW_MS`
3. Use:
   - `GET /api/vendor-sites?vendor_id=123` or `GET /api/vendor-sites?vendor_name=Acme`
   - `GET /api/vendor-sites/search?q=acme&limit=5`
   - `GET /api/project-sites?project_name=176136%20AECC%20Naples%20Power%20Plant`

Notes:
- Vendor search suggestions come from APIGEE supplier search.
- Supplier site lookups come from the supplier detail response and preserve supplier status information.
- Project site lookup derives `project_number` from the leading token in `project_name` and calls APIGEE ship-to-location search.
- APIGEE responses are cached in memory as last-successful fallback snapshots for transient failures.

## Supplier UI behavior

- If a supplier is resolved, the link under the Supplier search box opens the registration page with `activeSupplierId=<supplier_id>`.
- If the user types a supplier name but does not resolve/select a supplier, the same under-input link falls back to the generic Supplier Intelligence request page.
- The generic fallback link is only shown after the vendor lookup has completed.

## Vendor database (Cloud SQL, legacy optional)

The legacy server path can fetch vendor sites from `BMCD_TADP_SUPP_SITES_T`.

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
