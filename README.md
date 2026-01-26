# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Vendor database (Cloud SQL)

The app includes a server route that can fetch vendor sites from `BMCD_TADP_SUPP_SITES_T`.

1. Copy `.env.example` to `.env` and set values:
   - `VENDOR_DB_ENABLED=true`
   - `VENDOR_DB_CONNECTION_URL` for a direct connection, or
   - `VENDOR_DB_INSTANCE_CONNECTION_NAME` + `VENDOR_DB_USER` + `VENDOR_DB_PASS` + `VENDOR_DB_NAME` for the Cloud SQL connector.
2. If using the Cloud SQL connector, set `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON.
3. Fetch data via `GET /api/vendor-sites`.

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
