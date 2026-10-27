# Render backend and Vercel frontend

Local `.env` files are not deployed through Git. Configure hosting environment variables separately.

## Backend on Render

Build command: `sh build.sh`. Start command: `pnpm start`.

Set these in the backend service's Environment page:

```dotenv
NODE_ENV=production
FRONTEND_ORIGINS=https://project-final-197-fe.vercel.app
```

Also configure `MONGODB_URI`, `JWT_SECRET` and `JWT_REFRESH_SECRET` with real secrets. JWT secrets must differ. MongoDB must support transactions (Atlas or a replica set). Let Render supply `PORT`.

Choose **Save and deploy** after editing variables. Editing a local `.env` or `.env.example` does not update Render. `CLIENT_URL` does not replace `FRONTEND_ORIGINS`.

## Frontend on Vercel

Set this for the Production environment, then rebuild/redeploy the frontend:

```dotenv
VITE_API_BASE_URL=https://project-final-197-be.onrender.com/api/v1
```

Leave `VITE_BASENAME` empty when hosting at `/`. Vite embeds public environment variables at build time. Never put backend secrets in `VITE_*` variables.

## Verification

The backend must log `MongoDB connected successfully` and `Server running`. Visiting the backend root should return `Hello World!`.

From the frontend, check API calls target the Render URL and login responses set an HttpOnly, Secure, SameSite=None cookie. Refresh and reload must preserve the session. Unlisted origins must remain denied. Production cookies use SameSite=None for the Vercel/Render deployment; development uses Strict. Browsers that block third-party cookies may still block this setup; use frontend/API domains under the same site or a same-origin API proxy in that case.
