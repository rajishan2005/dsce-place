# Campus Claim (DSCE)

**Paper.io-inspired multiplayer** on the Dayananda Sagar College of Engineering campus map.

Walk around campus (GPS) or drag on desktop, leave a **trail**, loop back to your land to **claim territory**, and **cut other players’ trails** to eliminate them.

## How to play

1. Enter a callsign and drop in — you spawn with a small colored base.
2. **Move**
   - **Phone:** tap **GPS** and walk on campus (HTTPS required).
   - **Desktop:** **Walk** mode + drag on the map (for testing).
3. Outside your color = you leave a **trail**.
4. Return to your territory to **close the loop** and claim the enclosed area.
5. Cross another player’s trail → **they die** (you get a kill). They get a “cut your trail” message.
6. Hit **your own** trail → you die.
7. Respawn after a few seconds and fight for campus %.

## Controls (HUD)

| Control | Action |
|--------|--------|
| **GPS** | Enable location + center on you |
| **Walk / Pan** | Walk moves you; Pan only moves the camera |
| **Follow** | Camera sticks to you |
| Leaderboard | Top territory % |
| Feed | Joins, claims, cuts, kills |

## Stack

- Next.js + custom Socket.IO server (`server.ts`)
- Server-authoritative territory grid (200×200)
- GPS → grid via `CAMPUS_BOUNDS` in `src/lib/config.ts`

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy (Railway)

Uses `railway.toml`. Build `npm run build`, start `npm start`.  
Generate a public domain. **HTTPS is required for GPS.**

## Tune map / GPS

Edit `CAMPUS_BOUNDS` in `src/lib/config.ts` so the artwork matches real lat/lng (north-up). The campus image is illustrative — walk known corners and nudge bounds if the blue GPS ring is off.

## Game constants

`src/lib/config.ts`:

- `SPAWN_RADIUS` — starting base size  
- `RESPAWN_SECONDS` — time out after death  
- `MAX_TRAIL_LENGTH` — anti-abuse cap  
- `PLAYER_COLORS` — palette  

## Roadmap ideas

- Share live locations of all players (privacy toggle)
- Power-ups / safe zones / class buildings as landmarks  
- Season leaderboard (Postgres)  
- Multi-point GPS calibration for the art map  
