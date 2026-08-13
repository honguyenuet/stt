# Deploy vbeeaistt.com

## Target topology

- `https://vbeeaistt.com`: frontend TanStack Start on Cloudflare Workers.
- `https://www.vbeeaistt.com`: same frontend Worker.
- `https://api.vbeeaistt.com`: Express backend on a Node host such as Render, Railway, Fly.io, VPS, or another container host.
- PostgreSQL: managed database reachable by the backend.

The backend should not be deployed as-is to Cloudflare Workers because it uses Express, ffmpeg, local upload folders, background workers, and PostgreSQL connections.

## Frontend on Cloudflare Workers

1. In Cloudflare, make sure `vbeeaistt.com` is an active zone.
2. From `frontend`, login once:

   ```powershell
   npx wrangler login
   ```

3. Set production API env before building. Use the real backend URL:

   ```powershell
   $env:VITE_API_URL="https://api.vbeeaistt.com"
   $env:VITE_ADMIN_API_URL="https://api.vbeeaistt.com"
   npm run build
   ```

4. Deploy:

   ```powershell
   npx wrangler deploy
   ```

`frontend/wrangler.jsonc` already attaches the Worker to:

- `vbeeaistt.com`
- `www.vbeeaistt.com`

## Backend on a Node host

Deploy `backend` as a Node service with:

```text
Build command: npm install
Start command: npm start
```

Important production env values:

```env
NODE_ENV=production
PROCESS_ROLE=api
RUN_TRANSCRIPTION_WORKER=false
FRONTEND_URL=https://vbeeaistt.com
CORS_ALLOWED_ORIGINS=https://vbeeaistt.com,https://www.vbeeaistt.com
PUBLIC_BACKEND_URL=https://api.vbeeaistt.com
DB_SSL=true
JWT_SECRET=<random 32+ chars>
AUDIT_HASH_SECRET=<different random 32+ chars>
PROVIDER_FILE_SIGNING_SECRET=<different random 32+ chars>
PROVIDER_SECRET_KEY=<random 32+ chars>
```

Run a separate worker process for queued transcription jobs:

```text
Start command: npm run worker
```

Worker env should include:

```env
NODE_ENV=production
PROCESS_ROLE=worker
RUN_TRANSCRIPTION_WORKER=true
```

Both API and worker must share the same database and, if you keep local upload storage, the same persistent volume. Prefer object storage for production uploads when you add that later.

## DNS

In Cloudflare DNS:

- `vbeeaistt.com` and `www.vbeeaistt.com` are created/managed by the Worker custom domain deploy.
- Add `api.vbeeaistt.com` to point to your backend host.

Typical records:

```text
CNAME api <your-backend-hostname>
CNAME www <managed by Worker custom domain, if Cloudflare does not create it automatically>
```

Keep proxy enabled when your backend host supports Cloudflare proxying. If the host requires direct DNS validation first, temporarily set DNS only, validate, then enable proxy.

## OAuth and payment callback URLs

After the backend is public, update external dashboards:

- Google OAuth callback: `https://api.vbeeaistt.com/api/auth/google/callback`
- Facebook callback: `https://api.vbeeaistt.com/api/auth/facebook/callback`
- Apple callback: `https://api.vbeeaistt.com/api/auth/apple/callback`
- PayOS webhook: `https://api.vbeeaistt.com/api/billing/payos/webhook`

Then set matching backend env values:

```env
GOOGLE_CALLBACK_URL=https://api.vbeeaistt.com/api/auth/google/callback
FACEBOOK_CALLBACK_URL=https://api.vbeeaistt.com/api/auth/facebook/callback
APPLE_CALLBACK_URL=https://api.vbeeaistt.com/api/auth/apple/callback
PAYOS_WEBHOOK_URL=https://api.vbeeaistt.com/api/billing/payos/webhook
```

