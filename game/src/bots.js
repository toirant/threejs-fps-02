// Bot fighters. One state machine per bot, one shared mover, one shared
// raycaster for vision and fire. Bots route over the map's waypoint graph,
// hold angles, react to what they see and hear, strafe and burst-fire when
// they engage, plant the spike when they carry it and defuse when it is
// planted against them. Difficulty is honest: reaction time, aim error and
// burst discipline, never perfect aim.
import * as THREE from 'three';
import { makeBody, createMover, groundSpeed, wishFromYaw } from './move.js';
import { WAYPOINTS, SITES } from './map.js';
import { range } from './rng.js';

const NAMES_EMBER = ['Ash', 'Coal', 'Ember'];
const NAMES_SLATE = ['Rook', 'Vex', 'Hale', 'Moss'];
const VIEW_DIST = 42;
const VIEW_HALF_FOV = 1.05;
const REACT_MIN = 0.4;
const REACT_MAX = 0.9;
// Bots are honest but not lethal: their shots at the player land about a
// third as hard as the weapon's paper damage, and a moving target is harder
// to hit than a still one, so a push up a lane is survivable and stopping
// to aim still decides the fight.
const PLAYER_DAMAGE_SCALE = 0.35;

function bfsPath(fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = new Map([[fromId, -1]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of WAYPOINTS[cur].links) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === toId) {
        const path = [toId];
        let node = toId;
        while (prev.get(node) !== -1) { node = prev.get(node); path.unshift(node); }
        return path;
      }
      queue.push(next);
    }
  }
  return [toId];
}

function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (const w of WAYPOINTS) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

export function createBots(scene, deps) {
  const { colliders, occluders, effects, audio, combat, rng } = deps;
  const mover = createMover(colliders);
  const bots = [];
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const wish = new THREE.Vector3();

  const teamMat = {
    ember: new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff7a1a'), roughness: 0.55, metalness: 0.15 }),
    slate: new THREE.MeshStandardMaterial({ color: new THREE.Color('#5f9cc4'), roughness: 0.55, metalness: 0.15 }),
  };
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#232833'), roughness: 0.7, metalness: 0.2 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.44, 0.62, 0.26);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.62);

  function buildMesh(bot) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, teamMat[bot.team]);
    torso.position.y = 1.05;
    torso.userData = { bot, part: 'torso' };
    const head = new THREE.Mesh(headGeo, teamMat[bot.team]);
    head.position.y = 1.58;
    head.userData = { bot, part: 'head' };
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), darkMat);
    visor.position.set(0, 1.6, -0.14);
    const legs = new THREE.Mesh(legGeo, darkMat);
    legs.position.y = 0.42;
    legs.userData = { bot, part: 'legs' };
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.18, 1.05, -0.4);
    group.add(torso, head, visor, legs, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    scene.add(group);
    return { group, torso, head, legs, gun };
  }

  function makeBot(id, name, team, x, z, weaponDef) {
    const bot = {
      id, name, team, weaponDef,
      body: makeBody(x, z, team === 'ember' ? Math.PI : 0),
      hp: 100, armor: 0, alive: true,
      state: 'stage', path: [], pathIndex: 0, destNode: -1,
      target: null, reactLeft: 0, burstLeft: 0, burstPause: 0,
      scanLeft: 0, hearAt: null, channel: 0, channelKind: null,
      site: null, holdUntil: 0, strafeDir: 1, strafeLeft: 0,
      fall: 0, speed: 4.4, skill: range(rng, 0.85, 1.1),
    };
    bot.mesh = buildMesh(bot);
    bots.push(bot);
    return bot;
  }

  function spawnRound(attackers, defenders) {
    for (const b of bots) { scene.remove(b.mesh.group); }
    bots.length = 0;
    attackers.forEach((a, i) => {
      const bot = makeBot(i, NAMES_EMBER[i] ?? `Ember${i}`, 'ember', a.x, a.z, a.weapon);
      bot.site = a.site;
    });
    defenders.forEach((d, i) => {
      const bot = makeBot(10 + i, NAMES_SLATE[i] ?? `Slate${i}`, 'slate', d.x, d.z, d.weapon);
      bot.site = d.site;
    });
  }

  function canSee(bot, enemy, enemyEyeY) {
    const bp = bot.body.position;
    const ep = enemy.body ? enemy.body.position : enemy.position;
    const dx = ep.x - bp.x;
    const dz = ep.z - bp.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VIEW_DIST) return false;
    const eyeY = bp.y + bot.body.eye;
    const dy = (ep.y + enemyEyeY) - eyeY;
    const dirX = -Math.sin(bot.body.yaw);
    const dirZ = -Math.cos(bot.body.yaw);
    const dot = (dx * dirX + dz * dirZ) / (dist || 1);
    if (dot < Math.cos(VIEW_HALF_FOV) && dist > 2) return false;
    tmp.set(bp.x, eyeY, bp.z);
    tmp2.set(dx / (dist || 1), dy / (Math.hypot(dist, dy) || 1), dz / (dist || 1));
    raycaster.set(tmp, tmp2);
    raycaster.far = dist + 1;
    const hits = raycaster.intersectObjects(occluders, false);
    if (hits.length && hits[0].distance < dist - 0.3) return false;
    // Smoke between the eyes blocks the sightline, like a wall does.
    const chest = new THREE.Vector3(ep.x, ep.y + enemyEyeY, ep.z);
    if (effects.smokeBlocks(tmp, chest)) return false;
    return true;
  }

  function routeTo(bot, nodeId) {
    const from = nearestWaypoint(bot.body.position.x, bot.body.position.z);
    bot.path = bfsPath(from, nodeId);
    bot.pathIndex = 0;
    bot.destNode = nodeId;
  }

  function followPath(bot, dt, speed) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = WAYPOINTS[bot.path[bot.pathIndex]];
    const dx = node.x - bot.body.position.x;
    const dz = node.z - bot.body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) { bot.pathIndex += 1; return bot.pathIndex >= bot.path.length; }
    const targetYaw = Math.atan2(-dx, -dz);
    let dyaw = targetYaw - bot.body.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.body.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
    wishFromYaw(bot.body.yaw, 1, 0, wish);
    mover.step(bot.body, dt, wish.x, wish.z, speed, false, false);
    return false;
  }

  function aimError(bot, dist, targetSpeed) {
    return (0.028 + dist * 0.0018 + targetSpeed * 0.004) / bot.skill;
  }

  // One bot shot: aim with error, raycast, damage the player or a bot.
  function botShoot(bot, ctx) {
    const target = bot.target;
    const bp = bot.body.position;
    const eyeY = bp.y + bot.body.eye;
    const tp = target.body ? target.body.position : target.position;
    const aimY = tp.y + (target.body ? target.body.eye * 0.9 : 1.3);
    const dx = tp.x - bp.x;
    const dy = aimY - eyeY;
    const dz = tp.z - bp.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const err = aimError(bot, dist, target.body ? groundSpeed(target.body) : 0);
    const dirX = dx / dist + (rng() * 2 - 1) * err;
    const dirY = dy / dist + (rng() * 2 - 1) * err * 0.7;
    const dirZ = dz / dist + (rng() * 2 - 1) * err;
    const hit = combat.raycastShot(bp.x, eyeY, bp.z, dirX, dirY, dirZ, bot.weaponDef.range, ctx.shootMeshes, bot.team);
    const muzzle = tmp.set(bp.x, eyeY - 0.1, bp.z);
    if (hit) {
      effects.tracer(muzzle, hit.point);
      if (hit.bot) {
        const result = combat.damageFighter(hit.bot, bot.weaponDef.damage, hit.part);
        ctx.onBotHit(bot, hit.bot, hit.part, result);
      } else if (hit.mesh.userData.isPlayer) {
        ctx.onPlayerHit(bot, bot.weaponDef.damage * PLAYER_DAMAGE_SCALE, hit.part);
        effects.impact(hit.point, hit.normal, 3);
      } else {
        effects.impact(hit.point, hit.normal, 4);
      }
    } else {
      tmp2.set(bp.x + dirX * bot.weaponDef.range, eyeY + dirY * bot.weaponDef.range, bp.z + dirZ * bot.weaponDef.range);
      effects.tracer(muzzle, tmp2);
    }
    audio.shot(true);
    bot.mesh.gun.rotation.x = -0.25;
  }

  function stepBot(bot, dt, ctx, time) {
    const mesh = bot.mesh.group;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      mesh.rotation.x = -bot.fall * 1.45;
      mesh.position.y = -bot.fall * 0.1;
      return;
    }
    mesh.rotation.x = 0;
    mesh.position.y = 0;
    bot.mesh.gun.rotation.x += (0 - bot.mesh.gun.rotation.x) * Math.min(1, dt * 10);

    // Periodic vision scan, staggered by id.
    bot.scanLeft -= dt;
    if (bot.scanLeft <= 0) {
      bot.scanLeft = 0.15 + (bot.id % 5) * 0.02;
      const enemies = ctx.enemiesOf(bot);
      let seen = null;
      let seenD = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(
          (e.body ? e.body.position.x : e.position.x) - bot.body.position.x,
          (e.body ? e.body.position.z : e.position.z) - bot.body.position.z,
        );
        if (d < seenD && canSee(bot, e, e.body ? 1.3 : 1.3)) { seen = e; seenD = d; }
      }
      if (seen) {
        if (bot.target !== seen) { bot.target = seen; bot.reactLeft = range(rng, REACT_MIN, REACT_MAX); }
      } else if (bot.state === 'engage') {
        bot.target = null;
        bot.state = bot.hearAt ? 'investigate' : 'move';
        if (bot.hearAt) routeTo(bot, nearestWaypoint(bot.hearAt.x, bot.hearAt.z));
        else if (bot.destNode >= 0) routeTo(bot, bot.destNode);
      }
    }

    // Hearing: a shot nearby pulls the bot toward the noise.
    if (ctx.noise && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
      const n = ctx.noise;
      const d = Math.hypot(n.x - bot.body.position.x, n.z - bot.body.position.z);
      if (d < 26) {
        bot.hearAt = { x: n.x, z: n.z };
        if (bot.state !== 'investigate') { bot.state = 'investigate'; routeTo(bot, nearestWaypoint(n.x, n.z)); }
      }
    }

    const phase = ctx.phase;
    if (phase === 'buy' || phase === 'end') {
      bot.target = null;
      return;
    }

    // Planting / defusing channels.
    if (bot.channelKind) {
      bot.channel += dt;
      const need = bot.channelKind === 'plant' ? 3 : 5;
      if (bot.channel >= need) {
        if (bot.channelKind === 'plant') ctx.onPlanted(bot);
        else ctx.onDefused(bot);
        bot.channel = 0;
        bot.channelKind = null;
      }
      return;
    }

    // The carrier heads for its site and plants.
    if (ctx.carrier === bot && phase === 'live' && !ctx.bombPlanted) {
      const site = SITES[bot.site ?? 'A'];
      const d = Math.hypot(site.cx - bot.body.position.x, site.cz - bot.body.position.z);
      if (d < 2.2) {
        bot.channelKind = 'plant';
        bot.channel = 0;
        audio.beep();
        return;
      }
      if (bot.state !== 'move' || bot.destNode !== (bot.site === 'B' ? 11 : 10)) routeTo(bot, bot.site === 'B' ? 11 : 10);
      followPath(bot, dt, bot.speed);
      return;
    }

    // Bomb planted: defenders rush the site and defuse.
    if (ctx.bombPlanted && bot.team === 'slate') {
      const bp = ctx.bombPos;
      const d = Math.hypot(bp.x - bot.body.position.x, bp.z - bot.body.position.z);
      if (d < 1.6) {
        bot.channelKind = 'defuse';
        bot.channel = 0;
        audio.defuse();
        return;
      }
      if (bot.state !== 'move') routeTo(bot, nearestWaypoint(bp.x, bp.z));
      followPath(bot, dt, bot.speed + 0.4);
      return;
    }

    // Engage: strafe, face the target, burst fire.
    if (bot.target && bot.state !== 'engage') bot.state = 'engage';
    if (bot.state === 'engage' && bot.target) {
      const target = bot.target;
      const tp = target.body ? target.body.position : target.position;
      const dx = tp.x - bot.body.position.x;
      const dz = tp.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      const targetYaw = Math.atan2(-dx, -dz);
      let dyaw = targetYaw - bot.body.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.body.yaw += Math.max(-4 * dt, Math.min(4 * dt, dyaw));
      bot.strafeLeft -= dt;
      if (bot.strafeLeft <= 0) { bot.strafeDir *= -1; bot.strafeLeft = range(rng, 0.5, 1.4); }
      const wantDist = dist > 18 ? 1 : dist < 6 ? -1 : 0;
      wishFromYaw(bot.body.yaw, wantDist, bot.strafeDir, wish);
      mover.step(bot.body, dt, wish.x, wish.z, bot.speed * 0.55, false, false);
      if (bot.reactLeft > 0) { bot.reactLeft -= dt; return; }
      bot.burstPause -= dt;
      if (bot.burstLeft > 0) {
        if (bot.burstPause <= 0) {
          botShoot(bot, ctx);
          bot.burstLeft -= 1;
          bot.burstPause = bot.weaponDef.gap;
        }
      } else if (bot.burstPause <= -range(rng, 0.8, 1.6)) {
        bot.burstLeft = 3 + Math.floor(rng() * 3);
        bot.burstPause = 0;
      }
      return;
    }

    // Move / investigate / hold: follow the route, then scan the angles.
    if (bot.state === 'move' || bot.state === 'investigate' || bot.state === 'hold') {
      const arrived = followPath(bot, dt, bot.speed);
      if (arrived) {
        if (bot.state === 'investigate') {
          bot.hearAt = null;
          bot.state = 'hold';
          bot.holdUntil = time + range(rng, 1.5, 3);
          routeTo(bot, bot.destNode >= 0 ? bot.destNode : nearestWaypoint(bot.body.position.x, bot.body.position.z));
        } else {
          bot.state = 'hold';
          bot.holdUntil = time + range(rng, 2, 5);
        }
      }
      return;
    }
    if (bot.state === 'hold') {
      if (time > bot.holdUntil) {
        bot.state = 'move';
        routeTo(bot, bot.destNode >= 0 ? bot.destNode : nearestWaypoint(bot.body.position.x, bot.body.position.z));
      }
      // Slow scan: sweep the yaw across the lane.
      bot.body.yaw += Math.sin(time * 0.5 + bot.id) * 0.35 * dt;
    }
  }

  function step(dt, ctx, time) {
    for (const bot of bots) {
      stepBot(bot, dt, ctx, time);
      const p = bot.body.position;
      bot.mesh.group.position.set(p.x, p.y, p.z);
      bot.mesh.group.rotation.y = bot.body.yaw;
    }
  }

  function aliveOf(team) {
    return bots.filter((b) => b.team === team && b.alive);
  }

  function hear(x, z) {
    for (const b of bots) {
      if (b.state === 'engage' || !b.alive) continue;
      const d = Math.hypot(x - b.body.position.x, z - b.body.position.z);
      if (d < 26) {
        b.hearAt = { x, z };
        if (b.state !== 'investigate' && b.state !== 'plant' && b.state !== 'defuse') {
          b.state = 'investigate';
          routeTo(b, nearestWaypoint(x, z));
        }
      }
    }
  }

  return {
    bots, spawnRound, step, aliveOf, hear, routeTo, nearestWaypoint,
    hitMeshes() {
      const out = [];
      for (const b of bots) {
        if (!b.alive) continue;
        out.push(b.mesh.torso, b.mesh.head, b.mesh.legs);
      }
      return out;
    },
  };
}
