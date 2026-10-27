# Valley Life

An original, standalone multiplayer open-world roleplay game that runs in your browser.
Three.js (3D) + Node.js/Socket.IO (server). No Roblox, no accounts, no paid services.

## What you need
1. **Node.js 20 or newer** (free): https://nodejs.org (choose the "LTS" version).
2. A modern browser (Chrome, Edge or Firefox).

## Install and run (one time setup, then one command)
Open a terminal **inside this folder** and run:

```
npm install
npm start
```

The terminal prints addresses like `http://localhost:3000`. Open that in your browser.

## Play with friends

**Same Wi-Fi / same house or school network:** the terminal also prints a
"Same Wi-Fi/LAN" address (like `http://192.168.1.20:3000`). Friends open *that* address.
`localhost` only works on the computer running the server. If it doesn't connect, allow Node.js
through your firewall when Windows/macOS asks.

**Friends anywhere on the internet (optional, free):** keep `npm start` running, then use a tunnel:
- Cloudflare: install `cloudflared`, then run `cloudflared tunnel --url http://localhost:3000`
- or ngrok: `ngrok http 3000`

Either prints a public `https://…` link. Send that link to your friends. Nothing is published
permanently; closing the tunnel ends access. When you want permanent hosting later, any host that
runs Node.js (Render, Railway, a VPS) works: upload this folder, run `npm install && npm start`,
and keep the `data/` folder on persistent storage.

**Rooms:** type your name, press **Create Room**, and share the 5-letter code.
Friends type the code and press **Join Room**. Everyone presses **Start Playing**. Up to 8 players per room.
Room codes are saved, so you can reuse the same code (and keep the houses people bought) on later days.

## Controls
WASD move · Shift run · Space jump (handbrake in a car) · mouse look · **E** interact / enter / exit
car · **G** garage & properties · **L** headlights · **Tab** player list · **Esc** pause.

## How to play
- You start with **$1,000** and a free Starter Sedan. Press **G**, **Spawn**, walk to it, press **E**.
- **Job Center** (orange building): start Delivery or Taxi. Follow the glowing beam and the minimap
  diamond. Delivery: pick up the package (on foot or by car), then drive to the drop-off. Taxi: do both steps
  in a car. Money is paid by the server only when you really reach the markers.
- **Vehicle Dealership** (blue building): preview, compare and buy cars.
- **Houses** (south side of town): walk to a front door, buy, go inside, and let friends visit.

## Saving
Everything important lives on the server in `data/valley-life.json` (cash, cars, paint, stats, house
ownership per room). It is written safely (temporary file then rename) and a `.bak` copy is made each
start. If the file is ever corrupted the server refuses to start instead of wiping your data.
Your browser only keeps a random sign-in token (this is how the server recognises you); **do not
share your browser profile**. Clearing browser data = new player.

## Troubleshooting
- **"Room not found"**: check the code; rooms exist on the server you are connected to.
- **Friends can't connect**: they must use the LAN address or tunnel link, not `localhost`; check firewall.
- **Black/blank screen**: update your graphics drivers/browser; enable hardware acceleration.
- **Mouse won't turn**: click the game once to capture it (Esc releases it).
- **Port in use**: set another port: `PORT=3001 npm start` (Windows PowerShell: `$env:PORT=3001; npm start`).
- **No sound**: sound starts after you press Start; check the Volume slider in the Pause menu.
- Change settings by copying `.env.example` to `.env`.

## Project layout
`server/index.js` authoritative server (rooms, economy, jobs, houses, saving) ·
`shared/config.js` vehicles, houses, jobs used by both sides · `client/` 3D world, vehicle physics,
UI · `test/protocol.test.js` automated multiplayer test (`npm test`).

## Honest status of this first version
**Verified by automated test (`npm test`, 42 checks, real server + real socket clients):** rooms and
codes, two players seeing each other, vehicle sync, server-side money/purchase/house/job validation,
duplicate-purchase protection, anti-teleport job check, persistence across a server restart.

**Written but NOT verified in a real browser** (I had no browser/GPU in my build environment):
the 3D rendering, camera, character and car handling feel, UI panels, audio, minimap. The code passes
syntax checks and a headless smoke test (the world builds, cars collide with buildings, top speed is
reached), but expect small visual/usability bugs on first run. Tell me what you see and I'll fix it.

**Not implemented yet:** police officer and mechanic jobs, police car, vehicle damage/repair, fuel,
garage as a physical building (use **G** anywhere), passengers, text chat, mobile controls, character
customisation, traffic/pedestrians, full road-sign/crosswalk detail. Vehicle and player positions are
reported by each client (trusted for movement); money, ownership and job rewards are server-authoritative.
