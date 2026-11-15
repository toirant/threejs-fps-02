// Pooled effects: tracers, impact sparks, explosions and smoke. Everything is
// allocated once at boot and reused, so a firefight never allocates per frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 24;
const SPARKS = 160;
const SMOKES = 14;

export function createEffects(scene) {
  const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.lamp), transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.lamp), size: 0.07, transparent: true, opacity: 0.95, sizeAttenuation: true,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkNext = 0;

  const smokeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9aa2ad'), transparent: true, opacity: 0.55, depthWrite: false });
  const smokes = [];
  for (let i = 0; i < SMOKES; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), smokeMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, life: 0, max: 1, x: 0, y: 0, z: 0 });
  }
  let smokeNext = 0;

  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 26);
  scene.add(boomLight);
  let boomLife = 0;
  const boomPos = new THREE.Vector3();

  function tracer(from, to) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACERS;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.09;
  }

  function impact(point, normal, count = 6) {
    for (let n = 0; n < count; n += 1) {
      const i = sparkNext;
      sparkNext = (sparkNext + 1) % SPARKS;
      sparkPos[i * 3] = point.x;
      sparkPos[i * 3 + 1] = point.y;
      sparkPos[i * 3 + 2] = point.z;
      sparkVel[i * 3] = normal.x * 2 + (Math.random() - 0.5) * 4;
      sparkVel[i * 3 + 1] = Math.abs(normal.y) * 2 + Math.random() * 3;
      sparkVel[i * 3 + 2] = normal.z * 2 + (Math.random() - 0.5) * 4;
      sparkLife[i] = 0.35 + Math.random() * 0.25;
    }
  }

  function explosion(point) {
    boomPos.copy(point);
    boomPos.y += 0.5;
    boomLight.position.copy(boomPos);
    boomLife = 0.5;
    impact(point, new THREE.Vector3(0, 1, 0), 40);
    for (let n = 0; n < 5; n += 1) addSmoke(point.x, point.y + 0.6, point.z, 2.2, 5);
  }

  function addSmoke(x, y, z, radius, life) {
    const s = smokes[smokeNext];
    smokeNext = (smokeNext + 1) % SMOKES;
    s.x = x; s.y = y; s.z = z;
    s.mesh.position.set(x, y, z);
    s.mesh.scale.setScalar(radius);
    s.mesh.visible = true;
    s.life = life;
    s.max = life;
  }

  // Smoke blocks a bot's line of sight when the segment passes near a puff.
  // Reused vectors only: this runs inside every bot's vision check.
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  function smokeBlocks(from, to) {
    for (const s of smokes) {
      if (!s.mesh.visible || s.life <= 0) continue;
      tmpA.set(s.x, s.y, s.z);
      tmpB.copy(to).sub(from);
      const len = tmpB.length();
      if (len === 0) continue;
      tmpB.divideScalar(len);
      tmpC.copy(tmpA).sub(from);
      const t = Math.max(0, Math.min(len, tmpC.dot(tmpB)));
      tmpC.addScaledVector(tmpB, t);
      if (tmpC.distanceTo(tmpA) < 1.6) return true;
    }
    return false;
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.line.visible = false;
    }
    let any = false;
    for (let i = 0; i < SPARKS; i += 1) {
      if (sparkLife[i] <= 0) continue;
      any = true;
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 9 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      if (sparkPos[i * 3 + 1] < 0.02) sparkPos[i * 3 + 1] = 0.02;
    }
    if (any) sparkGeo.attributes.position.needsUpdate = true;
    for (const s of smokes) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      const grow = 1 + (1 - s.life / s.max) * 0.8;
      s.mesh.scale.setScalar(2.2 * grow * 0.5 + 1.1);
      s.mesh.material.opacity = 0.55 * Math.min(1, s.life / 2);
    }
    if (boomLife > 0) {
      boomLife -= dt;
      boomLight.intensity = Math.max(0, boomLife / 0.5) * 90;
    } else {
      boomLight.intensity = 0;
    }
  }

  return { tracer, impact, explosion, addSmoke, smokeBlocks, step };
}
