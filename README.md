# pulse-chat

Pulse Chat

A WhatsApp-inspired, responsive chat application. It has a React client, Express/Socket.IO API, MongoDB persistence, JWT authentication, encrypted message payloads, uploads, presence, typing, receipts, search and installable web-push plumbing.

## Run locally

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
2. Run `npm install`, then `npm run dev`.
3. Open `http://localhost:5173`. MongoDB must be available at `MONGODB_URI`; `docker compose up --build` starts the full stack.

## Deploy

- Deploy `server/` to Render using `render.yaml`, Railway using `railway.toml`, or any container runtime. Configure `MONGODB_URI`, `JWT_SECRET`, and `CLIENT_URL`.
- Deploy the client to Vercel. Set `VITE_API_URL` to the API URL and `VITE_SOCKET_URL` to the same URL. Configure the API’s `CLIENT_URL` to the Vercel origin.
- Use MongoDB Atlas in production and an object store/CDN (S3, Cloudinary, or R2) in place of local uploads.

## Encryption note

Messages are encrypted in the browser using AES-GCM before they are sent; the server only stores ciphertext. This starter creates a chat key on the originating device. For multi-device, verifiable WhatsApp-grade E2EE, replace this bootstrap with audited Signal Protocol sessions (X3DH + Double Ratchet), device-key verification and server-hosted encrypted key bundles. Never claim encryption is secure until that migration and independent review are complete.

## Included API and socket events

REST routes include registration/login, profile retrieval/editing, user lookup, chat creation/listing, paginated message retrieval, uploads, and push subscriptions. Socket events are `message:send`, `message:new`, `message:read`, `typing`, and `presence`. Every socket connection is authenticated with a JWT and every chat action is membership-checked server-side.

## Production checklist

Use HTTPS, a managed MongoDB replica set, object storage, rate limits/WAF, secret manager, monitoring, database backups, virus scanning of uploads, Content Security Policy, and a dedicated Socket.IO-compatible host (Vercel is frontend-only—use Render/Railway for sockets).
