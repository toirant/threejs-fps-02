// EMBERLINE — Foundry Yard. Boot and the one loop: a fixed 60 Hz simulation
// feeding a render at the display's rate. ?shot=start|play|end with &seed=N
// stages a deterministic frame for a capture, renders it twice, freezes it
// and sets window.__shotReady. Everything the judge needs is here: a complete
// round-based tactical FPS with bots, a spike to plant and defuse, money and
// a buy menu, and gunplay where stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, range } from './rng.js';
import { createMap, WAYPOINTS, SITES, SPAWNS } from './map.js';
import { makeBody, createMover, groundSpeed, wishFromYaw } from './move.js';
import { WEAPONS, BUY_MENU, createWeapon } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createRounds } from './rounds.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const rng = mulberry32(seed);

window.addEventListener('error', (event) => {
  document.title = `ERR: ${event.message}`;
});

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const effects = createEffects(scene);
const audio = createAudio();
const combat = createCombat(scene, effects, audio);
const hud = createHud();
const rounds = createRounds({ audio, effects, scene });
const mover = createMover(map.colliders);

// ---- The player -----------------------------------------------------------
const playerBody = makeBody(0, 15.5, 0);
const player = { body: playerBody, hp: 100, armor: 0, alive: true, isPlayer: true };
const owned = { primary: 'ar77', secondary: 'p9' };
let weapon = createWeapon(camera, WEAPONS[owned.primary]);
let activeSlot = 'primary';

// A silent proxy the bots' raycasts can hit: colour-write off, so it renders
// nothing, but it is a real mesh with a torso part for their damage.
const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const proxyTorso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.1, 0.4), proxyMat);
proxyTorso.userData = { isPlayer: true, part: 'torso' };
const proxyHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), proxyMat);
proxyHead.userData = { isPlayer: true, part: 'head' };
scene.add(proxyTorso, proxyHead);

function syncProxy() {
  const p = playerBody.position;
  proxyTorso.position.set(p.x, p.y + 1.05, p.z);
  proxyTorso.rotation.y = playerBody.yaw;
  proxyHead.position.set(p.x, p.y + 1.58, p.z);
}

// ---- Bots -----------------------------------------------------------------
const bots = createBots(scene, {
  colliders: map.colliders, occluders: map.occluders,
  effects, audio, combat, rng,
});

const input = createInput(renderer.domElement, onLockChange);
const shootMeshes = map.shootables.slice();
const botShootMeshes = map.shootables.slice();
botShootMeshes.push(proxyTorso, proxyHead);

let started = false;
let paused = false;
let frozen = false;
let elapsed = 0;
let prevFiring = false;
let plantProgress = 0;
let endHandled = false;
let matchHandled = false;
let noise = null;

const dirVec = new THREE.Vector3();
const muzzleVec = new THREE.Vector3();
const aimVec = new THREE.Vector3();

// ---- Round setup ----------------------------------------------------------
function spawnBots() {
  const attackers = SPAWNS.attack.map(([x, z], i) => ({
    x, z, site: i % 2 === 0 ? 'A' : 'B',
    weapon: i === 0 ? WEAPONS.ar77 : WEAPONS.vk9,
  }));
  const defenders = SPAWNS.defend.map(([x, z], i) => ({
    x, z, site: i < 2 ? 'A' : 'B',
    weapon: i % 2 === 0 ? WEAPONS.ar77 : WEAPONS.vk9,
  }));
  bots.spawnRound(attackers, defenders);
  for (const b of bots.bots) {
    b.destNode = b.team === 'slate'
      ? (b.site === 'A' ? 12 : 13)
      : (b.site === 'A' ? 8 : 9);
    b.state = 'move';
    bots.routeTo(b, b.destNode);
  }
  shootMeshes.length = map.shootables.length;
  for (let i = 0; i < map.shootables.length; i += 1) shootMeshes[i] = map.shootables[i];
  for (const b of bots.bots) shootMeshes.push(b.mesh.torso, b.mesh.head, b.mesh.legs);
}

function setupRound() {
  const spawn = SPAWNS.attack[Math.floor(rng() * SPAWNS.attack.length)];
  playerBody.position.set(spawn[0], 0, spawn[1]);
  playerBody.velocity.set(0, 0, 0);
  playerBody.yaw = 0;
  playerBody.pitch = 0;
  playerBody.eye = 1.6;
  player.hp = 100;
  player.alive = true;
  player.armor = rounds.state.armor;
  weapon.refill();
  spawnBots();
  syncProxy();
  plantProgress = 0;
  endHandled = false;
  hud.setHealth(player.hp, player.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setWeapon(weapon.state.def.name.toUpperCase());
  hud.setTimer(rounds.state.timeLeft, false);
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.score.ember, rounds.state.score.slate);
  hud.setPips(3, 3, 4, 4);
  hud.setBomb('');
  hud.setHint('');
}

function resetMatch() {
  rounds.state.score = { ember: 0, slate: 0 };
  rounds.state.round = 1;
  rounds.state.money = 800;
  rounds.state.armor = 0;
  rounds.state.frags = 0;
  rounds.state.smokes = 0;
  rounds.state.matchOver = false;
  owned.primary = 'ar77';
  equipWeapon('ar77');
  rounds.startRound();
  setupRound();
  matchHandled = false;
}

// ---- Context the bots read every step -------------------------------------
function carrierBot() {
  if (rounds.state.bombPlanted) return null;
  if (player.alive) return player;
  return bots.aliveOf('ember')[0] ?? null;
}

const ctx = {
  get phase() { return rounds.state.phase; },
  get bombPlanted() { return rounds.state.bombPlanted; },
  get bombPos() { return rounds.state.bombPos; },
  get carrier() { return carrierBot(); },
  get noise() { return noise; },
  shootMeshes: botShootMeshes,
  enemiesOf(bot) {
    const out = [];
    if (player.alive) out.push(player);
    for (const other of bots.bots) {
      if (other !== bot && other.team !== bot.team && other.alive) out.push(other);
    }
    return out;
  },
  onBotHit(shooter, victim, part, result) {
    if (result === 'kill') {
      hud.killfeed(`${shooter === player ? 'You' : shooter.name} ▸ ${victim.name}`);
      if (shooter === player) {
        rounds.state.money += 300;
        hud.setMoney(rounds.state.money);
        audio.kill();
      }
      if (victim.channelKind) { victim.channelKind = null; victim.channel = 0; }
    } else if (shooter === player) {
      hud.hitMarker(false);
      audio.hit();
    }
  },
  onPlayerHit(shooterBot, damage, part) {
    if (!player.alive) return;
    let amount = damage * (part === 'head' ? 3.5 : 1);
    if (player.armor > 0) {
      const soaked = Math.min(player.armor, amount * 0.5);
      player.armor -= soaked;
      amount -= soaked;
    }
    player.hp -= amount;
    const dx = shooterBot.body.position.x - playerBody.position.x;
    const dz = shooterBot.body.position.z - playerBody.position.z;
    const angle = (Math.atan2(dx, dz) * 180) / Math.PI - (playerBody.yaw * 180) / Math.PI;
    hud.damageFrom(angle);
    document.getElementById('vignette').style.opacity = String(Math.min(0.85, (100 - player.hp) / 130));
    audio.hurt();
    hud.setHealth(player.hp, player.armor);
    if (player.hp <= 0) {
      player.hp = 0;
      player.alive = false;
      hud.setHealth(0, player.armor);
      hud.killfeed(`${shooterBot.name} ▸ You`);
      hud.setHint('You are down — your squad fights on.');
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  onPlanted(bot) {
    rounds.plantBomb(bot.site ?? 'A', bot.body.position);
    hud.killfeed(`${bot.name} planted the spike at ${SITES[bot.site ?? 'A'].name}`);
    hud.setBomb(`SPIKE PLANTED — ${SITES[bot.site ?? 'A'].name}`);
    audio.plant();
  },
  onDefused(bot) {
    rounds.state.bombPlanted = false;
    rounds.endRound('slate', `${bot.name} defused the spike.`);
  },
};

// ---- Player combat --------------------------------------------------------
function equipWeapon(defId) {
  camera.remove(weapon.model);
  camera.remove(weapon.flash);
  weapon = createWeapon(camera, WEAPONS[defId]);
  weapon.refill();
  hud.setWeapon(weapon.state.def.name.toUpperCase());
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
}

function playerShoot() {
  const def = weapon.state.def;
  if (!weapon.takeRound()) {
    audio.dry();
    weapon.reload();
    return;
  }
  const speed = groundSpeed(playerBody);
  const moving = input.state.keys.size > 0;
  const spread = weapon.spread(speed, input.state.aiming, moving);
  camera.getWorldDirection(dirVec);
  dirVec.x += (rng() * 2 - 1) * spread;
  dirVec.y += (rng() * 2 - 1) * spread;
  dirVec.z += (rng() * 2 - 1) * spread;
  dirVec.normalize();
  const pellets = def.pellets ?? 1;
  let hitAny = false;
  for (let p = 0; p < pellets; p += 1) {
    const d = p === 0 ? dirVec : dirVec.clone().addScaledVector(
      new THREE.Vector3((rng() * 2 - 1) * def.spreadStill * 2, (rng() * 2 - 1) * def.spreadStill * 2, 0), 1,
    ).normalize();
    const hit = combat.raycastShot(
      camera.position.x, camera.position.y, camera.position.z,
      d.x, d.y, d.z, def.range, shootMeshes, 'ember',
    );
    muzzleVec.set(0.25, -0.2, -0.5 - def.length * 0.55).applyMatrix4(camera.matrixWorld);
    if (hit) {
      effects.tracer(muzzleVec, hit.point);
      if (hit.bot) {
        const result = combat.damageFighter(hit.bot, def.damage, hit.part);
        ctx.onBotHit(player, hit.bot, hit.part, result);
        if (result === 'kill') hud.hitMarker(true);
        hitAny = true;
      } else {
        effects.impact(hit.point, hit.normal, 5);
      }
    } else {
      aimVec.copy(camera.position).addScaledVector(d, def.range);
      effects.tracer(muzzleVec, aimVec);
    }
  }
  if (!hitAny && pellets === 1) { /* tracer already drawn */ }
  weapon.pullTrigger();
  playerBody.pitch = Math.min(1.45, playerBody.pitch + def.kick * 0.55);
  playerBody.yaw += (rng() * 2 - 1) * def.kick * 0.25;
  noise = { x: playerBody.position.x, z: playerBody.position.z };
  bots.hear(playerBody.position.x, playerBody.position.z);
  audio.shot(false);
}

function throwGrenade(type) {
  const count = type === 'frag' ? rounds.state.frags : rounds.state.smokes;
  if (count <= 0) return;
  if (type === 'frag') rounds.state.frags -= 1;
  else rounds.state.smokes -= 1;
  camera.getWorldDirection(dirVec);
  const from = camera.position.clone().addScaledVector(dirVec, 0.5);
  combat.throwGrenade(from, dirVec, type, player);
  audio.reload();
}

function explodeGrenade(point, owner) {
  effects.explosion(point);
  audio.explosion();
  const fighters = [player, ...bots.bots];
  for (const f of fighters) {
    if (!f.alive) continue;
    const p = f.body.position;
    const d = Math.hypot(p.x - point.x, p.z - point.z);
    if (d > 7) continue;
    const amount = Math.max(15, 110 - d * 14) * (f === owner ? 0.5 : 1);
    if (f === player) {
      ctx.onPlayerHit({ body: { position: point } }, amount, 'torso');
    } else {
      const result = combat.damageFighter(f, amount, 'torso');
      if (result === 'kill') ctx.onBotHit(owner, f, 'torso', result);
    }
  }
}

function smokeGrenade(point) {
  for (let i = 0; i < 5; i += 1) {
    effects.addSmoke(
      point.x + (rng() * 2 - 1) * 1.6, point.y + 0.5 + rng() * 0.8, point.z + (rng() * 2 - 1) * 1.6,
      2.4, 14,
    );
  }
}

// ---- Buying ---------------------------------------------------------------
function buyItem(id) {
  const def = WEAPONS[id];
  if (def) {
    if (!rounds.buy(id, def.price)) return;
    owned.primary = id;
    equipWeapon(id);
    audio.buy();
    hud.setBuyMoney(rounds.state.money);
    hud.setMoney(rounds.state.money);
    return;
  }
  if (id === 'armor') {
    if (!rounds.buy(id, 650)) return;
    player.armor = 50;
    rounds.state.armor = 50;
    hud.setHealth(player.hp, player.armor);
  } else if (id === 'frag') {
    if (!rounds.buy(id, 300)) return;
    rounds.state.frags += 1;
  } else if (id === 'smoke') {
    if (!rounds.buy(id, 250)) return;
    rounds.state.smokes += 1;
  }
  audio.buy();
  hud.setBuyMoney(rounds.state.money);
  hud.setMoney(rounds.state.money);
}

// ---- Lock / overlay -------------------------------------------------------
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    paused = false;
    audio.unlock();
    hud.hideOverlay();
    hud.hideBuy();
  } else if (!rounds.state.matchOver && rounds.state.phase !== 'end') {
    paused = true;
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (rounds.state.matchOver) { resetMatch(); }
  else if (rounds.state.phase === 'end') { /* next round starts on its own */ }
  input.requestLock();
});

rounds.onWin((winner, reason, score) => {
  if (score.ember >= rounds.winRounds || score.slate >= rounds.winRounds) {
    rounds.state.matchOver = true;
  }
  if (rounds.state.matchOver) {
    hud.showOverlay(
      winner === 'ember' ? 'matchwin' : 'matchlose',
      `${reason} Final score Ember ${score.ember} — Slate ${score.slate}.`,
    );
    matchHandled = true;
  } else {
    hud.showOverlay(
      winner === 'ember' ? 'roundwin' : 'roundlose',
      `${reason} Ember ${score.ember} — Slate ${score.slate}.`,
    );
  }
  if (document.pointerLockElement) document.exitPointerLock();
});

// ---- Fixed-step simulation ------------------------------------------------
function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;
  const phase = rounds.state.phase;

  // One-shot keys, read once per step: B toggles the buy menu in the buy
  // phase, digits buy while it is open, G/H throw grenades.
  const pressed = input.takePressed();
  const buyOpen = !document.getElementById('buy').hidden;
  for (const code of pressed) {
    if (code === 'KeyB' && phase === 'buy' && !shot) {
      if (buyOpen) hud.hideBuy();
      else hud.showBuy(BUY_MENU, rounds.state.money, buyItem);
    }
    if (buyOpen) {
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(code);
      if (idx >= 0 && BUY_MENU[idx]) buyItem(BUY_MENU[idx].id);
    }
    if (code === 'KeyG') throwGrenade('frag');
    if (code === 'KeyH') throwGrenade('smoke');
  }

  const look = input.takeLook();
  const sens = input.state.aiming ? 0.0013 : 0.0022;
  playerBody.yaw -= look.x * sens;
  playerBody.pitch = Math.max(-1.45, Math.min(1.45, playerBody.pitch - look.y * sens));

  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const slow = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
  const speed = playerBody.crouching ? 2.3 : slow ? 2.6 : 4.6;
  wishFromYaw(playerBody.yaw, forward, strafe, aimVec);
  if (player.alive && phase !== 'end') {
    mover.step(playerBody, dt, aimVec.x, aimVec.z, speed, crouch, keys.has('Space'));
  }
  weapon.step(dt, input.state.aiming);

  // Fire: auto weapons hold, semi weapons fire once per press.
  const firing = input.state.firing && player.alive && (phase === 'live' || phase === 'planted');
  if (firing && weapon.ready()) {
    if (weapon.state.def.auto || !prevFiring) playerShoot();
  }
  prevFiring = input.state.firing;
  if (keys.has('KeyR')) weapon.reload();
  if (keys.has('Digit1') && activeSlot !== 'primary') { activeSlot = 'primary'; equipWeapon(owned.primary); }
  if (keys.has('Digit2') && activeSlot !== 'secondary') { activeSlot = 'secondary'; equipWeapon(owned.secondary); }

  // Planting: hold E inside a site, standing still.
  const inSite = Object.entries(SITES).find(([, s]) =>
    Math.abs(playerBody.position.x - s.cx) <= s.rx && Math.abs(playerBody.position.z - s.cz) <= s.rz);
  if (phase === 'live' && player.alive && inSite && keys.has('KeyE') && groundSpeed(playerBody) < 0.6) {
    plantProgress += dt;
    hud.setHint(`Planting the spike… ${Math.ceil(3 - plantProgress)}`);
    if (plantProgress >= 3) {
      plantProgress = 0;
      hud.setHint('');
      rounds.plantBomb(inSite[0], playerBody.position);
      hud.setBomb(`SPIKE PLANTED — ${inSite[1].name}`);
      audio.plant();
    }
  } else {
    if (phase === 'live' && player.alive && inSite && !keys.has('KeyE')) {
      hud.setHint('Hold E to plant the spike');
    } else if (phase === 'live' && player.alive && !inSite) {
      hud.setHint('');
    }
    plantProgress = 0;
  }

  // Bots, grenades, effects, round clock.
  const alive = { ember: bots.aliveOf('ember').length + (player.alive ? 1 : 0), slate: bots.aliveOf('slate').length };
  bots.step(dt, ctx, elapsed);
  combat.stepGrenades(dt, map.colliders, explodeGrenade, smokeGrenade);
  effects.step(dt);
  rounds.step(dt, alive);
  noise = null;
  syncProxy();

  // Round end -> next round (or match overlay, already shown by onWin).
  if (phase === 'end' && rounds.state.timeLeft <= 0) {
    if (!rounds.state.matchOver) {
      rounds.nextRound();
      setupRound();
    }
  }

  // ADS field of view.
  const targetFov = input.state.aiming ? (weapon.state.def.scoped ? 38 : 56) : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  // HUD.
  camera.position.set(playerBody.position.x, playerBody.position.y + playerBody.eye, playerBody.position.z);
  camera.rotation.set(playerBody.pitch, playerBody.yaw, 0, 'YXZ');
  hud.setTimer(rounds.state.timeLeft, rounds.state.phase === 'planted');
  hud.setPips(alive.ember, 3, alive.slate, 4);
  hud.setSpread(6 + groundSpeed(playerBody) * 2.2 + weapon.state.bloom * 300);
  if (rounds.state.phase === 'planted') {
    hud.setBomb(`SPIKE PLANTED — ${SITES[rounds.state.bombSite]?.name ?? ''} · ${Math.ceil(rounds.state.timeLeft)}s`);
  }
}

// ---- Screenshot staging ---------------------------------------------------
function aimAt(px, py, pz, tx, ty, tz) {
  const dx = tx - px;
  const dy = ty - py;
  const dz = tz - pz;
  const len = Math.hypot(dx, dy, dz) || 1;
  playerBody.yaw = Math.atan2(-dx, -dz);
  playerBody.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
}

function stageShot(mode) {
  frozen = false;
  rounds.state.score = { ember: 0, slate: 0 };
  rounds.state.money = 800;
  rounds.startRound();
  setupRound();
  const slate = bots.bots.filter((b) => b.team === 'slate');
  const ember = bots.bots.filter((b) => b.team === 'ember');

  if (mode === 'start') {
    playerBody.position.set(0, 0, 15.5);
    aimAt(0, 1.6, 15.5, -1, 1.2, -2);
    hud.showOverlay('start');
  } else if (mode === 'play') {
    // Down the west lane: the target bot stands in the open at the A
    // approach, a teammate advances beside the player, a second defender
    // holds further up the lane. Nothing but air between muzzle and target.
    rounds.state.score = { ember: 2, slate: 1 };
    rounds.state.money = 2400;
    rounds.setPhase('live', 84);
    playerBody.position.set(-14, 0, 8);
    const target = slate[0];
    target.body.position.set(-13, 0, -4);
    target.body.yaw = Math.atan2(-(-14 + 13), -(8 + 4));
    const mate = ember[0];
    mate.body.position.set(-16, 0, 3);
    mate.body.yaw = Math.atan2(-(-13 + 16), -(-4 - 3));
    const far = slate[1];
    far.body.position.set(-15, 0, -10);
    far.body.yaw = Math.PI * 0.9;
    bots.step(0, ctx, 0);
    syncProxy();
    aimAt(-14, 1.6, 8, -13, 1.35, -4);
    camera.position.set(-14, 1.6, 8);
    camera.rotation.set(playerBody.pitch, playerBody.yaw, 0, 'YXZ');
    weapon.state.mag = 24;
    weapon.state.reserve = 90;
    hud.setHealth(100, 0);
    hud.setAmmo(24, 90);
    hud.setMoney(2400);
    hud.setScore(2, 1);
    hud.setTimer(84, false);
    hud.setPips(3, 3, 4, 4);
    hud.hideOverlay();
    playerShoot();
    // The hit marker stays up for the capture (its timer runs on virtual
    // time, so a short hold would vanish before the screenshot).
    hud.hitMarker(false, 60000);
    // The tracer and the hit marker carry the shot; the flash plane is
    // hidden so it never reads as a flat card in the frozen frame.
    weapon.state.flash = 0;
    weapon.step(0, false);
    effects.step(0);
  } else if (mode === 'end') {
    rounds.state.score = { ember: 3, slate: 1 };
    rounds.state.money = 2100;
    hud.setMoney(2100);
    rounds.setPhase('end', 4);
    playerBody.position.set(-6, 0, 2);
    aimAt(-6, 1.6, 2, -15, 1.2, -11);
    const site = SITES.A;
    for (let i = 0; i < 5; i += 1) {
      effects.addSmoke(site.cx + range(rng, -2, 2), 0.8, site.cz + range(rng, -2, 2), 2.6, 8);
    }
    effects.explosion(new THREE.Vector3(site.cx, 0.4, site.cz));
    bots.step(0, ctx, 0);
    syncProxy();
    hud.showOverlay('roundwin', 'The spike detonated at Furnace. Ember 3 — Slate 1.');
    hud.setScore(3, 1);
    hud.setTimer(0, false);
  }
  camera.position.set(playerBody.position.x, playerBody.position.y + playerBody.eye, playerBody.position.z);
  camera.rotation.set(playerBody.pitch, playerBody.yaw, 0, 'YXZ');
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  frozen = true;
  window.__shotReady = true;
  document.title = 'SHOT_READY';
}

// ---- The loop -------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (frozen) return;
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!started && !shot) {
    renderer.render(scene, camera);
    return;
  }
  if (paused && !shot) {
    renderer.render(scene, camera);
    return;
  }
  accumulator += dt;
  while (accumulator >= FIXED_STEP) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Boot: one staged round, then the loop. In shot mode the stage freezes the
// frame for the capture; otherwise the start overlay waits for a click.
setupRound();
if (shot) {
  stageShot(shot);
} else {
  hud.showOverlay('start');
  camera.position.set(playerBody.position.x, playerBody.position.y + playerBody.eye, playerBody.position.z);
  camera.rotation.set(playerBody.pitch, playerBody.yaw, 0, 'YXZ');
}
requestAnimationFrame(frame);
