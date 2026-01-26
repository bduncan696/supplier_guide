# Vendor Sites Side Panel

SvelteKit app for the EPC tools side panel. It exposes a server route that can fetch vendor sites from the vendor database and renders the UI in the browser.

## Features

- SvelteKit + Vite dev/build workflow
- Server route for vendor sites (`/api/vendor-sites`)
- Optional Cloud SQL connector support for database access

## Getting started

Install dependencies:

```sh
npm install
```

Run the dev server:

```sh
npm run dev
```

## Vendor database (Cloud SQL)

The server route can fetch vendor sites from `BMCD_TADP_SUPP_SITES_T`.

1. Copy `.env.example` to `.env` and set values:
   - `VENDOR_DB_ENABLED=true`
   - `VENDOR_DB_CONNECTION_URL` for a direct connection, or
   - `VENDOR_DB_INSTANCE_CONNECTION_NAME` + `VENDOR_DB_USER` + `VENDOR_DB_PASS` + `VENDOR_DB_NAME` for the Cloud SQL connector.
2. If using the Cloud SQL connector, set `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON.
3. Fetch data via `GET /api/vendor-sites`.

## Building

Create a production build:

```sh
npm run build
```

Preview the production build:

```sh
npm run preview
```
