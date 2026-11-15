# AmoraLock

Real-time 1:1 chat app — messages, media, voice notes, calls, per-chat settings (block, mute, wallpaper, clear chat) and browser push notifications.

- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express + Socket.IO + MongoDB (Mongoose)
- **Calls:** WebRTC (peer-to-peer, DTLS-SRTP encrypted)

## Requirements

- Node.js 18+
- A MongoDB database (local or MongoDB Atlas)

## Setup

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env        # then fill MONGO_URI and JWT_SECRET
npm run build
npm start                   # http://localhost:5000

# 2. Frontend (new terminal)
cd frontend
npm install
cp .env.example .env        # VITE_API_URL -> your backend origin
npm run dev                 # http://localhost:5173
```

Open `http://localhost:5173`, create an account and you are in.

### Required env (backend)

| Key | Meaning |
| --- | --- |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | long random string (`openssl rand -hex 32`) |
| `CORS_ORIGIN` | comma-separated frontend origins allowed to call the API |
| `PUBLIC_BASE_URL` | public backend origin used to build media links |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | optional, enables browser push |
| `STORAGE_DRIVER` | `local` (default) / `s3` / `cloudinary` |

Generate push keys with:

```bash
node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log(k.publicKey);console.log(k.privateKey)"
```

## Same-WiFi access (testing on a phone)

1. Set `VITE_API_URL` to `http://<your-PC-IP>:5000` and `CORS_ORIGIN` / `APP_URL` / `PUBLIC_BASE_URL` to that IP.
2. Start the frontend with `npm run dev -- --host 0.0.0.0`.
3. Allow inbound TCP 5173 and 5000 in your firewall.
4. Open `http://<your-PC-IP>:5173` on the other device.

Browsers block camera/microphone on plain-HTTP non-localhost origins, so voice notes and calls need HTTPS (or a Chrome "unsafe origin" flag) when testing over LAN.

## Before real users

- Serve everything over **HTTPS**.
- Set `NODE_ENV=production` (the API refuses to expose password-reset tokens in production).
- Use `STORAGE_DRIVER=s3` or `cloudinary` — the local driver stores media inside `backend/uploads`, which is lost when a hosted disk is recycled.
- Enable database backups on your MongoDB plan.
- Add a TURN server (`VITE_TURN_*`) so calls work on mobile data.
- Configure a mail provider for password resets; until then the reset link is printed only in the server log (development).

## Scripts

| Where | Command | What it does |
| --- | --- | --- |
| backend | `npm run dev` | tsx watch server |
| backend | `npm run build` / `npm start` | compile / run compiled server |
| frontend | `npm run dev` | Vite dev server |
| frontend | `npm run build` | typecheck + production build |
