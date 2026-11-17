# gta6

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/sandiawan-kielo-dale/gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/sandiawan-kielo-dale/gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Solmarina — Sunset Streets**: an original open-world crime game set in a sun-soaked coastal city. You are Dario Cruz, a driver who owes $5,000 to loan shark Vince Kroll. Work for fixer Mara Solano, run five story jobs across the city, pay off the debt — or just steal a sports car and outrun the police until the sun goes down.

## The city

- A full 3D city to explore on foot and by car: a road grid with traffic, sidewalks full of pedestrians, a beachfront boulevard, a pier, a plaza with a fountain, a bank, a hospital, a showroom, a garage, a hotel, and the 88-metre Solmarina Tower.
- Traffic AI follows the roads, stops and turns at intersections, and slows for the car ahead. Pedestrians stroll the sidewalks, flee gunshots and speeding cars, and can be knocked down (the police notice).
- Day turns to sunset over the sea as you play.

## What you can do

- **On foot**: WASD to move (camera-relative), Shift to sprint, Space to jump. Punch with F, shoot a pistol with a mouse click (12-round magazine, automatic reload).
- **Driving**: W/S to accelerate and brake/reverse, A/D to steer, Space for the handbrake. Steal any parked car or carjack a driver with E; get out with E. Sports cars are fast, taxis are everywhere, trucks are slow.
- **Wanted level**: 0–5 stars. Stealing, carjacking, assault and shooting raise the heat; police cruisers chase and ram you, foot cops chase, shoot and try to bust you. Break line of sight and the heat cools down.
- **Missions and story**: five jobs — meet Mara, drive a first fare, steal the red Comet S, run a package off Pier 9 under a police chase, and the Vault Job at the Bank of Solmarina. Each pays cash toward the $5,000 debt. After the story, random side jobs (taxi fares, courier runs) keep coming.
- **HUD**: health bar, cash, wanted stars, speed, a live minimap with roads, cars, police and the mission marker, an objective tracker and an edge arrow that points at your target.
- **Save**: progress (cash, health, story step, position) autosaves after every mission and every minute, and persists in the browser. Continue from the start screen.
- **Sound**: fully synthesised WebAudio — engine hum, sirens, gunshots, crashes, pickups and a mission jingle. M mutes.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move / drive |
| Mouse drag | Orbit camera, wheel zooms |
| Shift | Sprint |
| Space | Jump (on foot) / handbrake (driving) |
| E | Enter / exit car, steal car, hold to grab pickups |
| F | Punch |
| Mouse click | Shoot pistol |
| P / Esc | Pause |
| M | Mute |

## Run it

No build step, no network. Serve the `game/` folder with any static server and open `index.html` in desktop Chrome:

```sh
cd game
python3 -m http.server 8080
# open http://localhost:8080
```

Or open `game/index.html` directly from disk — the game runs fully offline (three.js is vendored under `game/vendor/`).

## Layout

- `game/index.html` — page, HUD, menus
- `game/src/util.js` — helpers, seeded RNG, canvas textures
- `game/src/audio.js` — synthesised WebAudio sound
- `game/src/city.js` — the city: roads, buildings, beach, pier, landmarks
- `game/src/vehicles.js` — cars, driving physics, traffic AI, police AI
- `game/src/people.js` — the player, pedestrians, foot police, shooting
- `game/src/missions.js` — story jobs and side jobs
- `game/src/hud.js` — HUD, minimap, menus
- `game/src/save.js` — localStorage save/load
- `game/src/game.js` — bootstrap, main loop, camera, wanted system
- `game/vendor/three.min.js` — three.js r158 (vendored, minified)
- `main.ts` — copies `game/` + `screenshots/` to `/output` and writes `dossier.json`

All content is original: no Rockstar / GTA names, characters, art, music or maps. Built with three.js (MIT) for the make.fun gta6-01 bounty.

<sub>Entered on [make.fun](https://make.fun/?ref=y5hkb35z&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
