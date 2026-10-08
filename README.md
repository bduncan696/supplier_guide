# Vendor Sites Side Panel Demo

SvelteKit app for the EPC tools side panel. It exposes server routes for Procore OAuth/proxy and demo vendor/project site lookups backed by local seed data.

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

## Demo Seed Data

Vendor and project-site endpoints use local seed data from:

- `src/lib/server/sample-vendor-sites.js`
- `src/lib/server/sample-project-sites.js`

Available endpoints:

- `GET /api/vendor-sites?vendor_id=123` or `GET /api/vendor-sites?vendor_name=Acme`
- `GET /api/vendor-sites/search?q=acme&limit=5`
- `GET /api/project-sites?project_name=106354%20Ameren`

## Supplier UI behavior

- If a supplier is resolved, the link under the Supplier search box uses a demo placeholder link.
- If the user types a supplier name but does not resolve/select a supplier, the same under-input link falls back to a demo placeholder link.
- The generic fallback link is only shown after the vendor lookup has completed.

## Build and Run (Production)

```sh
npm run build
npm run start
```

## Deploy to Azure

Use a Linux Azure App Service configured for Node.js 22 LTS.

Recommended App Service settings:

- `SCM_DO_BUILD_DURING_DEPLOYMENT=false`
- `PROCORE_ENV=production`
- `PROCORE_CLIENT_ID=<Avicado Procore client id>`
- `PROCORE_CLIENT_SECRET=<Avicado Procore client secret>`
- `PROCORE_OAUTH_SCOPES=<optional scopes>`
- `PROCORE_REDIRECT_URI=https://<azure-app-name>.azurewebsites.net/api/procore/oauth/callback`

Startup command:

```sh
npm run start
```

Build and package locally before publishing:

```sh
npm run build
rm -rf /tmp/supplier-guide-appservice
mkdir -p /tmp/supplier-guide-appservice
cp package.json package-lock.json /tmp/supplier-guide-appservice/
cp -R build /tmp/supplier-guide-appservice/build
npm ci --omit=dev --prefix /tmp/supplier-guide-appservice
cd /tmp/supplier-guide-appservice
zip -qr /tmp/supplier-guide-appservice.zip .
az webapp deployment source config-zip \
  --resource-group rg-project-horizon \
  --name avicado-supplier-guide \
  --src /tmp/supplier-guide-appservice.zip
```

Do not deploy with localhost callback URLs. Register the exact deployed callback URL in the Procore app configuration.

## Scaling note for OAuth state

OAuth session/token/state currently use in-memory storage. For reliable multi-instance hosting behavior, either:

1. keep instance count at 1, or
2. move auth state/token storage to a shared store (for example Redis/Firestore/SQL).
