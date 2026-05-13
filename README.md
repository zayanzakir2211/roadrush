# RoadRush — Multiplayer Car Game

A seed-based multiplayer open-world car game built with Three.js, Rapier physics, and Cloudflare Workers + Pages.

---

## Architecture

```
/
├── backend/    — Cloudflare Workers (WebSocket relay + REST API + Firebase)
└── frontend/   — Cloudflare Pages (Three.js + Rapier + Vite)
```

### Backend (Cloudflare Workers)

| Endpoint | Description |
|---|---|
| `POST /session` | Create/join session by seed |
| `GET /seed/random` | Get a random 12-16 digit seed |
| `GET /leaderboard` | Fetch top scores from Firebase |
| `POST /leaderboard` | Submit a score |
| `WS /ws/:seed` | Real-time WebSocket room per seed |

**Durable Objects** — one `GameRoom` instance per seed. Players sharing a seed connect to the same room and see each other.

**KV** — chunk data cached by `seed+chunkX+chunkZ` key.

### Frontend (Cloudflare Pages + Vite)

| Module | Responsibility |
|---|---|
| `main.js` | Boot sequence, game loop, camera |
| `graphics.js` | Three.js renderer, quality presets, day/night |
| `vehicle.js` | Local player input + physics communication |
| `remotePlayer.js` | Remote player interpolation + rendering |
| `world.js` | Chunk loading/unloading, instanced objects |
| `network.js` | WebSocket connection, state sync |
| `ui.js` | HUD, menus, settings, mobile controls |
| `seed.js` | Seed validation, random fetch, URL sharing |
| `audio.js` | Engine/wind/collision sounds via Web Audio API |
| `workers/chunkWorker.js` | Off-thread terrain generation (simplex-noise) |
| `workers/physicsWorker.js` | Off-thread Rapier physics at 60 Hz |

---

## Prerequisites

- Node.js 18+
- npm 9+
- A [Cloudflare account](https://dash.cloudflare.com/) (free tier works)
- *(Optional)* A [Firebase](https://console.firebase.google.com/) project with Realtime Database for leaderboards

---

## Local Development

### Backend

```bash
cd backend
npm install
# For local dev without real secrets, create a .dev.vars file:
echo 'FIREBASE_API_KEY=placeholder' >> .dev.vars
echo 'FIREBASE_URL=https://placeholder.firebaseio.com' >> .dev.vars
echo 'FIREBASE_PROJECT_ID=placeholder' >> .dev.vars
npm run dev
# Worker runs at http://localhost:8787
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local:
#   VITE_WORKER_URL=http://localhost:8787
npm run dev
# Dev server at http://localhost:3000
```

---

## Deployment

### Step 1 — Install Wrangler globally

```bash
npm install -g wrangler
wrangler login
```

### Step 2 — Create KV namespace

```bash
cd backend
wrangler kv:namespace create CHUNK_CACHE
# Copy the id from the output into wrangler.toml → kv_namespaces[0].id

wrangler kv:namespace create CHUNK_CACHE --preview
# Copy the preview_id into wrangler.toml → kv_namespaces[0].preview_id
```

### Step 3 — Set Firebase secrets

```bash
wrangler secret put FIREBASE_API_KEY
wrangler secret put FIREBASE_URL       # e.g. https://my-project-default-rtdb.firebaseio.com
wrangler secret put FIREBASE_PROJECT_ID
```

> **Note:** If you don't have Firebase set up yet, the leaderboard endpoints will return empty results gracefully. The game still works without Firebase.

### Step 4 — Deploy backend

```bash
cd backend
wrangler deploy
# Note your worker URL: https://multiplayer-car-game-backend.<subdomain>.workers.dev
```

### Step 5 — Deploy frontend

```bash
cd frontend
npm run build
wrangler pages deploy dist
```

### Step 6 — Set VITE_WORKER_URL in Cloudflare Pages dashboard

1. Go to Cloudflare Dashboard → Pages → your project → Settings → Environment Variables
2. Add: `VITE_WORKER_URL` = `https://multiplayer-car-game-backend.<subdomain>.workers.dev`
3. Re-deploy the frontend (or it will pick up on next deploy)

---

## Firebase Setup (Optional — Leaderboards)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com/)
2. Enable **Realtime Database**
3. Set database rules to allow authenticated writes:
   ```json
   {
     "rules": {
       "leaderboard": {
         ".read": true,
         ".write": "auth != null"
       }
     }
   }
   ```
4. Copy your **Web API Key** from Project Settings → General
5. Set the three Wrangler secrets as described in Step 3 above

---

## Gameplay

### Controls

| Action | Keyboard | Mobile |
|---|---|---|
| Accelerate | W / ↑ | GAS button |
| Reverse | S / ↓ | GAS button (hold brake) |
| Steer left | A / ← | Left joystick |
| Steer right | D / → | Left joystick |
| Brake | Space | BRK button |

### Seed System

- Each world is generated deterministically from a **numeric seed** (12-16 digits)
- Players who enter the **same seed** are placed in the **same world and room**
- Share a seed via the COPY button on the HUD, or share the URL (seed is encoded as `?seed=`)
- Click 🎲 **Random** in the main menu to get a fresh seed from the server

### Vehicles

| Vehicle | Speed | Mass | Handling |
|---|---|---|---|
| Sports Car | ★★★★★ | 1200 kg | Sharp |
| Truck | ★★ | 3500 kg | Wide turns |
| SUV | ★★★ | 2000 kg | Balanced |

### Graphics Presets

| Preset | Render Distance | Shadows | AA | Bloom |
|---|---|---|---|---|
| Low | 2 chunks | Off | Off | Off |
| Medium | 4 chunks | 512px | FXAA | Off |
| High | 6 chunks | 2048px | FXAA | ✓ |
| Ultra | 8 chunks | 4096px | MSAA 4× | ✓ |

---

## Project Structure

```
game/
├── README.md
├── backend/
│   ├── package.json
│   ├── wrangler.toml
│   ├── .gitignore
│   └── src/
│       ├── index.js          — Worker entry, routing
│       ├── room.js           — Durable Object (WebSocket room)
│       ├── firebase.js       — Firebase REST helpers
│       └── routes/
│           ├── session.js
│           ├── seed.js
│           └── leaderboard.js
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── wrangler.toml
    ├── .env.example
    ├── .gitignore
    ├── index.html
    └── src/
        ├── main.js
        ├── graphics.js
        ├── vehicle.js
        ├── remotePlayer.js
        ├── world.js
        ├── network.js
        ├── ui.js
        ├── seed.js
        ├── audio.js
        └── workers/
            ├── chunkWorker.js
            └── physicsWorker.js
```

---

## Performance Notes

- **Chunk generation** runs in a Web Worker — zero main-thread stutter
- **Physics** runs in a separate Web Worker at 60 Hz fixed timestep
- **Instanced meshes** used for all repeated world objects (trees, rocks, cones, barrels)
- **LOD** — Three.js frustum culling enabled by default; chunk unloading frees GPU memory
- **Physics sleep** — objects >60 units from player are paused
- On mobile, default quality is **Medium** and touch controls activate automatically

---

## Troubleshooting

**WebSocket connection fails in local dev**
> Make sure your backend `npm run dev` is running on port 8787 and `VITE_WORKER_URL` in `.env.local` points to `http://localhost:8787`.

**WASM/SharedArrayBuffer errors**
> The Vite dev server sets the required COOP/COEP headers. If deploying to a custom host, ensure `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers are set. Cloudflare Pages sets these automatically when configured.

**Physics fallback active (no Rapier)**
> Rapier WASM requires `SharedArrayBuffer`. If the headers above are not set, physics falls back to a simple Euler integrator. The game still works, just without full collision physics.

**Leaderboard returns empty**
> Check that the three Firebase secrets are set (`wrangler secret list`) and that your Firebase Realtime Database rules allow reads.

---

## License

MIT — build, fork, and ship freely.
