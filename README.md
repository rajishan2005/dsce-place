# DSCE Place

Collaborative real-time pixel canvas over **Dayananda Sagar College of Engineering** (Kumaraswamy Layout, Bengaluru) — like r/place on a campus satellite map.

## Features

- **Satellite campus background** (DSCE / Kumaraswamy Layout)
- **300×300 pixel grid** anyone can paint
- **Real-time sync** via Socket.IO (all users see pixels instantly)
- **Name only** — no account; name is saved in the browser
- **★ Star bank** — 30 stars per IP; paint costs 1; +1 star every 30s (regen starts the moment you paint)
- **Free + Team modes** — FFA or branch war (ISE, CSE, AIML, …) with live leaderboards
- **Power-ups** — Paint Bomb, Multiplier (20s 2×), Ink Wave; **Eraser** (1★)
- **Paint FX** — splash + floating +1
- **No GPS** — fully online
- **Persistent** — `data/pixels-free.json`, `pixels-team.json`, quotas, scores

## Quick start

```bash
cd dsce-place
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Share your LAN URL so classmates can join the same live canvas:

```text
http://YOUR_IP:3000
```

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Dev server (Next.js + Socket.IO) |
| `npm run build` | Production build |
| `npm start` | Run production server |

## How to use

1. Enter a display name
2. Pick a color from the palette
3. Click the map to place a pixel
4. Scroll to zoom, drag to pan
5. Hover a pixel to see who placed it

## Config

Edit `src/lib/config.ts`:

- `GRID_WIDTH` / `GRID_HEIGHT` — canvas resolution
- `MAX_STARS` — star bank size (default 30)
- `REGEN_SECONDS` — seconds to regenerate +1 star (default 30)
- `COLOR_PALETTE` — allowed colors
- `CAMPUS_BOUNDS` — geographic notes for the map area

Background image: `public/campus-satellite.jpg`  
Replace this file with your own campus map (same filename) to change the backdrop.

**GPS / map sync:** edit `CAMPUS_BOUNDS` in `src/lib/config.ts` so the artwork edges match real lat/lng (north-up). Your map art is not a survey photo — walk to the main gate and a far corner and nudge west/east/north/south until the blue dot sits correctly. HTTPS is required for browser GPS (Railway provides this).

**Limits:** tracked by client **IP** (works behind Railway via `X-Forwarded-For`). Changing display name does not reset free pixels or cooldown.

## Stack

- **Next.js** (React + TypeScript + Tailwind)
- **Socket.IO** for real-time multiplayer
- **Custom Node server** (`server.ts`) serving Next + WebSockets
- **JSON file** persistence (easy to swap for Redis/Postgres later)

## Deploy on Railway (recommended)

This app needs **one always-on Node process** (Next.js + Socket.IO). Railway supports that.

### 1. Push to GitHub

```bash
cd dsce-place
git add .
git commit -m "DSCE Place ready for Railway"
# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USER/dsce-place.git
git push -u origin master
```

### 2. Deploy

1. Go to [railway.app](https://railway.app) → sign in with GitHub  
2. **New Project** → **Deploy from GitHub repo** → pick `dsce-place`  
3. Railway should detect Node and use `railway.toml`:
   - **Build:** `npm run build`
   - **Start:** `npm start`
4. Open the service → **Settings** → **Networking** → **Generate Domain**  
5. Share that `https://….up.railway.app` link with everyone  

No env vars required. Railway sets `PORT` automatically; `server.ts` already uses it.

### 3. Optional: keep pixels across restarts

By default pixels are stored in `data/pixels.json` on the container disk (can reset on redeploy).

To keep them longer:

1. In Railway → your service → **Volumes**  
2. Mount a volume at `/app/data` (or the app’s `data` folder path Railway shows)  
3. Redeploy  

### Notes

- Free/trial limits apply — check Railway pricing if traffic is heavy  
- Serverless hosts (basic Vercel) are **not** a good fit for Socket.IO
