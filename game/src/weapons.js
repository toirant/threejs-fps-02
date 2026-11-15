// The armoury. One table, one job: every weapon's numbers live here, and the
// view model is built from them, so a buy-menu price and a bullet's damage can
// never drift apart. Spread and recoil punish firing on the move; stopping to
// aim is what lands shots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, auto: false, mag: 12, reserve: 48,
    damage: 26, headMult: 3.5, gap: 0.16, reload: 1.4, spreadStill: 0.004,
    spreadMove: 0.03, kick: 0.012, range: 60, length: 0.3, ads: 0.35,
  },
  vk9: {
    id: 'vk9', name: 'VK-9 SMG', price: 800, auto: true, mag: 28, reserve: 112,
    damage: 22, headMult: 3.2, gap: 0.082, reload: 1.9, spreadStill: 0.009,
    spreadMove: 0.038, kick: 0.009, range: 55, length: 0.55, ads: 0.5,
  },
  ar77: {
    id: 'ar77', name: 'AR-77 Rifle', price: 2700, auto: true, mag: 30, reserve: 90,
    damage: 33, headMult: 3.5, gap: 0.1, reload: 2.2, spreadStill: 0.003,
    spreadMove: 0.03, kick: 0.014, range: 80, length: 0.72, ads: 0.7,
  },
  dm7: {
    id: 'dm7', name: 'DM-7 Marksman', price: 4200, auto: false, mag: 8, reserve: 32,
    damage: 88, headMult: 3.5, gap: 0.85, reload: 2.8, spreadStill: 0.0008,
    spreadMove: 0.05, kick: 0.05, range: 100, length: 0.95, ads: 1.0, scoped: true,
  },
  m590: {
    id: 'm590', name: 'M590 Breacher', price: 1400, auto: false, mag: 6, reserve: 24,
    damage: 13, headMult: 2.5, gap: 0.8, reload: 2.6, spreadStill: 0.02,
    spreadMove: 0.045, kick: 0.038, range: 26, pellets: 8, length: 0.7, ads: 0.4,
  },
};

export const BUY_MENU = [
  { id: 'vk9', label: 'VK-9 SMG — $800' },
  { id: 'm590', label: 'M590 Breacher — $1,400' },
  { id: 'ar77', label: 'AR-77 Rifle — $2,700' },
  { id: 'dm7', label: 'DM-7 Marksman — $4,200' },
  { id: 'armor', label: 'Plate carrier — $650' },
  { id: 'frag', label: 'Frag grenade — $300' },
  { id: 'smoke', label: 'Smoke grenade — $250' },
];

// A weapon instance: ammo state, cooldown, reload and the view model. The
// caller owns the ray and the damage; this owns the numbers and the model.
export function createWeapon(camera, def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#15171c'), roughness: 0.5, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, def.length * 0.55), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.length * 0.55), grip);
  barrel.position.set(0, 0.02, -def.length * 0.5);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), grip);
  stock.position.set(0, -0.02, def.length * 0.28);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), dark);
  sight.position.set(0, 0.075, -def.length * 0.1);
  model.add(receiver, barrel, stock, sight);
  if (def.scoped) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -def.length * 0.15);
    model.add(scope);
  }
  // Kept small and low in the frame: a view model should read as a gun in
  // the hands, not a slab across the screen.
  model.scale.setScalar(0.8);
  model.position.set(0.25, -0.22, -0.5);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lamp), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  flash.position.set(0.25, -0.2, -0.5 - def.length * 0.55);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.lamp), 0, 6);
  flashLight.position.set(0.25, -0.18, -0.75);
  camera.add(flashLight);

  const state = {
    def, mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0,
  };

  function step(dt, aiming) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.9);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const aim = aiming ? 0.55 : 1;
    model.position.x = 0.25 * aim;
    model.position.y = -0.22 + (aiming ? 0.045 : 0);
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.4;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 28;
    flashLight.intensity = state.flash > 0 ? 8 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const t = 1 - state.reloadLeft / def.reload;
      model.rotation.x = -0.6 * Math.sin(t * Math.PI);
      model.position.y -= 0.06 * Math.sin(t * Math.PI);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state, model, flash,
    step,
    ready() { return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0; },
    pullTrigger() {
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.05 + def.kick;
      state.bloom = Math.min(0.05, state.bloom + def.kick * 0.9);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed, aiming, moving) {
      const move = Math.min(1, speed / 4.6);
      let s = def.spreadStill + move * def.spreadMove + state.bloom;
      if (aiming) s *= 1 - def.ads * 0.6;
      if (!moving) s *= 0.7;
      return s;
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
