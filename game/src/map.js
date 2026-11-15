// Foundry Yard: an original 48 x 36 m industrial yard at dusk. Two bomb sites
// (A Furnace, north-west; B Crane Bay, north-east), a mid lane, a west connector
// and an east connector, shipping containers and crates for cover, a low catwalk
// along the west wall. Every box is a collider for walkers and a surface a
// bullet stops on. Waypoints are the graph the bots route over.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph: id -> { x, z, links: [ids] }. Routes run spawn -> mid /
// connectors -> sites; defenders hold the site and lane nodes.
export const WAYPOINTS = [
  { id: 0, x: 0, z: 15, links: [1, 2, 3] }, // attacker spawn
  { id: 1, x: -8, z: 12, links: [0, 4, 6] }, // west connector
  { id: 2, x: 0, z: 8, links: [0, 5, 6, 7] }, // mid low
  { id: 3, x: 8, z: 12, links: [0, 5, 7] }, // east connector
  { id: 4, x: -14, z: 6, links: [1, 8, 10] }, // west lane
  { id: 5, x: 8, z: 4, links: [2, 3, 9, 11] }, // east lane
  { id: 6, x: -2, z: 0, links: [1, 2, 8, 9] }, // mid
  { id: 7, x: 6, z: -2, links: [2, 3, 5, 11] }, // mid high
  { id: 8, x: -12, z: -6, links: [4, 6, 10, 12] }, // A approach
  { id: 9, x: 12, z: -6, links: [5, 7, 11, 13] }, // B approach
  { id: 10, x: -15, z: -11, links: [4, 8, 12] }, // A site
  { id: 11, x: 15, z: -11, links: [5, 9, 13] }, // B site
  { id: 12, x: -8, z: -14, links: [8, 10, 13] }, // defender back A
  { id: 13, x: 8, z: -14, links: [9, 11, 12] }, // defender back B
  { id: 14, x: 0, z: -15, links: [12, 13] }, // defender spawn
];

export const SITES = {
  A: { name: 'Furnace', cx: -15, cz: -11, rx: 4.5, rz: 4.5 },
  B: { name: 'Crane Bay', cx: 15, cz: -11, rx: 4.5, rz: 4.5 },
};

export const SPAWNS = {
  attack: [[-4, 15], [0, 16], [4, 15]],
  defend: [[-8, -14], [-2, -15], [3, -15], [9, -14]],
};

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = {};
  const defs = {
    ground: { color: PALETTE.surface, roughness: 0.95 },
    wall: { color: PALETTE.hairline, roughness: 0.9 },
    containerA: { color: PALETTE.rust, roughness: 0.75, metalness: 0.25 },
    containerB: { color: PALETTE.slate, roughness: 0.7, metalness: 0.3 },
    crate: { color: '#6b543a', roughness: 0.9 },
    steel: { color: '#4a505c', roughness: 0.5, metalness: 0.55 },
    dark: { color: '#20242d', roughness: 0.9 },
    lamp: { color: PALETTE.lamp, roughness: 0.4, emissive: PALETTE.lamp, emissiveIntensity: 1.6 },
    siteA: { color: PALETTE.accent, roughness: 0.5, emissive: PALETTE.accent, emissiveIntensity: 0.9 },
    siteB: { color: PALETTE.slate, roughness: 0.5, emissive: '#5f9cc4', emissiveIntensity: 0.9 },
  };
  for (const [name, d] of Object.entries(defs)) {
    mat[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(d.color), roughness: d.roughness,
      metalness: d.metalness ?? 0.05,
      emissive: d.emissive ? new THREE.Color(d.emissive) : new THREE.Color(0),
      emissiveIntensity: d.emissiveIntensity ?? 0,
    });
  }

  const colliders = [];
  const shootables = [];
  const occluders = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      const b = new THREE.Box3().setFromObject(mesh);
      colliders.push(b);
      shootables.push(mesh);
      occluders.push(mesh);
    }
    return mesh;
  }

  function cyl(rt, rb, h, x, y, z, material, seg = 14) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    occluders.push(mesh);
    return mesh;
  }

  // Ground and perimeter walls, open to a dusk sky.
  box(48.8, 0.4, 36.8, 0, -0.2, 0, 'ground');
  box(0.6, 5.2, 36.8, -24.2, 2.6, 0, 'wall');
  box(0.6, 5.2, 36.8, 24.2, 2.6, 0, 'wall');
  box(48.8, 5.2, 0.6, 0, 2.6, -18.2, 'wall');
  box(48.8, 5.2, 0.6, 0, 2.6, 18.2, 'wall');

  // Site A — Furnace: a rusted furnace block, pipes and a container wall.
  box(6, 3.4, 1.2, -19, 1.7, -14, 'containerA');
  box(1.4, 4.6, 1.4, -20.5, 2.3, -10, 'steel');
  cyl(0.55, 0.55, 5.2, -21.5, 2.6, -13, 'steel');
  box(4.4, 1.1, 1.1, -13, 0.55, -15.5, 'crate');
  box(1.1, 1.1, 1.1, -11.5, 0.55, -13.5, 'crate');
  box(2.2, 1.1, 2.2, -17, 0.55, -7.5, 'crate');

  // Site B — Crane Bay: a gantry crane leg pair, containers, barrels.
  box(1.2, 5.0, 1.2, 12, 2.5, -15.5, 'steel');
  box(1.2, 5.0, 1.2, 19, 2.5, -15.5, 'steel');
  box(8.4, 0.8, 1.0, 15.5, 5.1, -15.5, 'steel');
  box(5.6, 2.6, 2.4, 19.5, 1.3, -9.5, 'containerB');
  cyl(0.7, 0.7, 1.5, 11, 0.75, -9, 'containerA');
  cyl(0.7, 0.7, 1.5, 12.6, 0.75, -8.2, 'dark');
  box(1.1, 1.1, 1.1, 13.5, 0.55, -13, 'crate');

  // Mid: a furnace pillar, a container spine and crate cover on both lanes.
  box(1.6, 3.6, 1.6, -1, 1.8, -1, 'containerA');
  box(6.4, 2.6, 2.4, -7, 1.3, 2, 'containerB');
  box(6.4, 2.6, 2.4, 7, 1.3, 2, 'containerB');
  box(2.4, 1.1, 1.2, -4.5, 0.55, 7.5, 'crate');
  box(2.4, 1.1, 1.2, 4.5, 0.55, 7.5, 'crate');
  box(1.2, 1.1, 2.4, -9, 0.55, -3, 'crate');
  box(1.2, 1.1, 2.4, 9, 0.55, -3, 'crate');

  // West connector: stacked containers and a low catwalk you can jump onto.
  box(5.2, 2.6, 2.4, -20.5, 1.3, 4, 'containerA');
  box(5.2, 2.6, 2.4, -20.5, 3.9, 4, 'containerB');
  box(8, 0.35, 2.2, -20.5, 1.25, 10.5, 'steel');
  box(1.1, 1.1, 1.1, -18, 0.55, 9, 'crate');
  box(1.1, 1.1, 1.1, -17, 0.55, 11.5, 'crate');

  // East connector: barrels, a low wall and a crate stack.
  cyl(0.7, 0.7, 1.5, 20, 0.75, 6, 'containerB');
  cyl(0.7, 0.7, 1.5, 21.5, 0.75, 7.5, 'dark');
  box(4, 1.2, 0.8, 20.5, 0.6, 0, 'crate');
  box(1.1, 1.1, 1.1, 16, 0.55, 4.5, 'crate');
  box(1.1, 1.1, 1.1, 17.2, 0.55, 4.5, 'crate');
  box(1.1, 1.1, 1.1, 16.6, 1.65, 4.5, 'crate');

  // Attacker spawn cover and defender back cover.
  box(2.4, 1.1, 1.2, -5, 0.55, 13.5, 'crate');
  box(2.4, 1.1, 1.2, 5, 0.55, 13.5, 'crate');
  box(3, 1.1, 1.2, 0, 0.55, -12.5, 'crate');

  // Site floor markers: glowing rings that read at a glance from across the yard.
  function siteMarker(site, material) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 3.9, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.cx, 0.03, site.cz);
    group.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.07, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.cx, 0.025, site.cz);
    group.add(disc);
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12), mat[material]);
    label.position.set(site.cx, 3.1, site.cz - 3.4);
    group.add(label);
    return ring;
  }
  const ringA = siteMarker(SITES.A, 'siteA');
  const ringB = siteMarker(SITES.B, 'siteB');
  ringB.material = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5f9cc4'), transparent: true, opacity: 0.55, side: THREE.DoubleSide });

  // Sodium lamps on poles, with real point lights at the two sites and mid.
  function lamp(x, z, withLight) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 8), mat.steel);
    pole.position.set(x, 2.2, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), mat.lamp);
    head.position.set(x, 4.45, z);
    group.add(head);
    if (withLight) {
      const light = new THREE.PointLight(new THREE.Color(PALETTE.lamp), 26, 22, 1.8);
      light.position.set(x, 4.2, z);
      scene.add(light);
    }
  }
  lamp(-15, -11, true);
  lamp(15, -11, true);
  lamp(0, 2, true);
  lamp(-20, 12, false);
  lamp(20, 12, false);

  // Dusk sky: a cool hemisphere, a low warm sun and a cool fill.
  const sky = new THREE.HemisphereLight(new THREE.Color('#7d90b5'), new THREE.Color('#2a2019'), 1.35);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb37a'), 3.2);
  sun.position.set(-14, 10, 18);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d90b5'), 0.75);
  fill.position.set(16, 12, -10);
  scene.add(fill);

  scene.fog = new THREE.Fog(new THREE.Color('#2b3242'), 34, 78);
  scene.background = new THREE.Color('#232936');

  return { colliders, shootables, occluders, group, ringA, ringB };
}
