// One mover for the player and every bot: acceleration, friction, gravity and
// jump, resolved as a box against the map's colliders one axis at a time, so a
// wall never swallows a walker and a step never teleports one through cover.
// All state lives on the body; this module allocates nothing per step.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const GRAVITY = 20;
const JUMP_SPEED = 6.4;

export function makeBody(x, z, yaw) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw, pitch: 0,
    eye: 1.6, height: STAND_HEIGHT,
    crouching: false, onGround: true,
  };
}

export function createMover(colliders) {
  const probe = new THREE.Box3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  // wishX/wishZ is a unit horizontal direction (or 0,0); speed is the target
  // speed; crouch toggles the low stance. Returns nothing; mutates the body.
  function step(body, dt, wishX, wishZ, speed, crouch, jump) {
    if (crouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouch && body.crouching
      && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? 1.02 : 1.6;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const accel = body.onGround ? 42 : 9;
    const blend = Math.min(1, accel * dt / Math.max(speed, 0.1));
    body.velocity.x += (wishX * speed - body.velocity.x) * blend;
    body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
    if (body.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - 9 * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (jump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  return { step, overlaps };
}

export function groundSpeed(body) {
  return Math.hypot(body.velocity.x, body.velocity.z);
}

// Direction from a yaw and a forward/strafe pair, written into out (no alloc).
export function wishFromYaw(yaw, forward, strafe, out) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  out.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
  if (out.lengthSq() > 0) out.normalize();
  return out;
}
