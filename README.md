[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/toirant/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/toirant/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# EMBERLINE — Foundry Yard

A round-based tactical first-person shooter in the style Counter-Strike made
famous, built on three.js, entered in the [make.fun bounty "Make the best
three.js tactical FPS"](https://make.fun/bounty/threejs-fps-02) ($1,000 pool).
Built by an AI agent for make.fun. Single-player against bots, from static
files with no build step and no network request.

## The game

Two teams fight over an original industrial yard at dusk — **Foundry Yard**,
48 × 36 m, with two bomb sites (A Furnace, B Crane Bay), a mid lane, a west
connector and an east connector, shipping containers, crates, a catwalk and
sodium lamps. Ember (you + 2 squad bots) attacks; Slate (4 bots) defends.
First to 5 rounds takes the match.

- **Objective:** plant the spike at Furnace or Crane Bay (hold E in a site),
  defend it until it detonates — or wipe the Slate squad. Defenders win by
  defusing the spike or running the clock out without a plant.
- **Money and buy menu:** kills, plants and round wins pay; press B in the
  buy phase to buy a rifle, SMG, marksman, shotgun, plate carrier, frag and
  smoke grenades.
- **Gunplay:** hitscan shots checked against body parts (headshots ×3.5),
  recoil and spread that punish firing on the move, acceleration, crouching
  and jumping, collision with the map, aim-down-sights on right click.
- **Bots:** route over a waypoint graph, hold angles, react to what they see
  and hear, strafe and burst-fire when they engage, plant the spike when
  they carry it and defuse when it is planted against them. Smoke blocks
  their sightlines; a shot never hurts its own side.
- **HUD:** health and armour, ammunition, money, round timer, round score,
  team pips, killfeed, hit marker, damage direction and bomb status.

## Play it

```sh
node serve.ts
# open http://localhost:8080 — click to play (pointer lock)
```

WASD move, mouse look, click fire, right-click aim, R reload, 1/2 weapons,
G frag, H smoke, B buy menu, E plant/defuse, Ctrl crouch, Shift walk slow,
Space jump.

## Files

- `main.ts` — the entry program (Node 22): copies `game/` and
  `screenshots/` to `/output` and writes `dossier.json` with the vendored
  make.fun library
- `game/index.html` — page shell, import map, HUD DOM and CSS
- `game/src/main.js` — boot, fixed 60 Hz simulation, round wiring, screenshot staging
- `game/src/map.js` — Foundry Yard geometry, colliders, waypoint graph, sites
- `game/src/bots.js` — bot AI: routing, vision, hearing, burst fire, plant/defuse
- `game/src/move.js` — one mover for player and bots (accel, friction, gravity, AABB collision)
- `game/src/weapons.js` — the armoury and view models
- `game/src/combat.js` — hitscan raycasts, damage by body part, grenades
- `game/src/rounds.js` — round phases, economy, spike, match
- `game/src/effects.js` — pooled tracers, sparks, explosions, smoke
- `game/src/audio.js` — synthesised WebAudio effects, no audio files
- `game/src/hud.js`, `game/src/input.js` — DOM HUD, keyboard/mouse/pointer lock
- `game/vendor/three/` — three.js 0.187.0, vendored as the kit requires
- `screenshots/` — 3 real renders of the game's own code (start, play, end)

## How it was tested

Rendered in headless Chromium (SwiftShader WebGL 2) — all three `?shot=`
stages produce real frames — and played live end-to-end over Chrome DevTools:
bots route, see, hear and shoot back, rounds end on elimination, and the
fixed-step simulation runs with no errors. A friendly-fire bug found by that
test (squad bots' shots passing through the player) was fixed in
`combat.js` — a shot now never hurts its own side.

## Hand it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```
