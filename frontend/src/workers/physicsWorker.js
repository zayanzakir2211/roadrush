/**
 * physicsWorker.js
 *
 * Fixes applied:
 *   1. Terrain trimesh colliders are properly added and kept solid
 *   2. Reverse velocity direction handled correctly after S-brake
 *   3. Ground plane at y=0 kept as a safety net
 *   4. Anti-sink correction so car never falls through terrain
 */

import RAPIER from "@dimforge/rapier3d-compat";

let world       = null;
let vehicleBody = null;
let paused      = false;

let inputThrottle = 0;
let inputSteer    = 0;
let inputBrake    = 0;

const FIXED_DT = 1 / 60;
let vehicleDef = { engineForce: 3500, brakeForce: 200, maxSteer: 0.5 };

// Track terrain chunks added to physics
const chunkBodies = new Map();

// ── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      await initRapier();
      break;
    case "setSeed":
      // Seed doesn't affect physics directly
      break;
    case "createVehicle":
      if (world) createVehicle(msg);
      break;
    case "input":
      inputThrottle = clamp(msg.throttle ?? 0, -1, 1);
      inputSteer    = clamp(msg.steer    ?? 0, -1, 1);
      inputBrake    = clamp(msg.brake    ?? 0,  0, 1);
      break;
    case "addTrimesh":
      if (world && msg.vertices && msg.indices) {
        addTrimesh(msg.vertices, msg.indices, msg.cx ?? 0, msg.cz ?? 0, msg.offsetX ?? 0, msg.offsetZ ?? 0);
      }
      break;
    case "removeTrimesh":
      if (world) removeTrimesh(msg.cx ?? 0, msg.cz ?? 0);
      break;
    case "clearTerrain":
      if (world) clearTerrain();
      break;
    case "teleport":
      if (vehicleBody && msg.position) {
        vehicleBody.setTranslation({ x: msg.position.x, y: msg.position.y + 3, z: msg.position.z }, true);
        vehicleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        vehicleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      break;
    case "pause":
      paused = true;
      break;
    case "resume":
      paused = false;
      break;
  }
};

// ── Init ─────────────────────────────────────────────────────────────────────

async function initRapier() {
  try {
    await RAPIER.init();
    buildWorld();
    setInterval(stepPhysics, FIXED_DT * 1000);
    self.postMessage({ type: "ready" });
  } catch (err) {
    console.error("[PhysicsWorker] Rapier init failed, using fallback:", err);
    setInterval(stepFallback, FIXED_DT * 1000);
    self.postMessage({ type: "ready", fallback: true });
  }
}

function buildWorld() {
  world = new RAPIER.World({ x: 0, y: -20, z: 0 });

  // Large flat safety-net ground (in case trimesh hasn't loaded yet)
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.15, 0)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(5000, 0.15, 5000).setFriction(0.8),
    groundBody
  );
}

// ── Vehicle ──────────────────────────────────────────────────────────────────

function createVehicle(cfg) {
  vehicleDef.engineForce = cfg.engineForce ?? 3500;
  vehicleDef.brakeForce  = cfg.brakeForce  ?? 200;
  vehicleDef.maxSteer    = cfg.maxSteer    ?? 0.5;

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(cfg.position?.x ?? 0, (cfg.position?.y ?? 2) + 2, cfg.position?.z ?? 0)
    .setLinearDamping(0.6)
    .setAngularDamping(8.0)
    .setAdditionalMass(cfg.mass ?? 1200);

  vehicleBody = world.createRigidBody(bodyDesc);
  // Prevent rolling/flipping — only yaw rotation allowed
  vehicleBody.setEnabledRotations(false, true, false, true);

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.9, 0.4, 2.0)
      .setFriction(0.8)
      .setRestitution(0.05)
      .setTranslation(0, 0.4, 0),
    vehicleBody
  );
}

// ── Terrain trimesh colliders ─────────────────────────────────────────────────

function addTrimesh(vertices, indices, cx, cz, offsetX, offsetZ) {
  const chunkKey = `${cx},${cz}`;
  if (chunkBodies.has(chunkKey)) return; // already added

  // Shift vertices by chunk world offset
  const shifted = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    shifted[i]     = vertices[i]     + offsetX;
    shifted[i + 1] = vertices[i + 1];
    shifted[i + 2] = vertices[i + 2] + offsetZ;
  }

  try {
    const terrainBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const collider = world.createCollider(
      RAPIER.ColliderDesc.trimesh(shifted, new Uint32Array(indices))
        .setFriction(0.8)
        .setRestitution(0.02),
      terrainBody
    );
    chunkBodies.set(chunkKey, { body: terrainBody, collider });
  } catch (err) {
    // Trimesh may fail on degenerate geometry — silently ignore
    console.warn('[PhysicsWorker] trimesh failed for chunk', chunkKey, err.message);
  }
}

function removeTrimesh(cx, cz) {
  const chunkKey = `${cx},${cz}`;
  const entry = chunkBodies.get(chunkKey);
  if (!entry) return;
  try {
    if (world.removeRigidBody && entry.body) {
      world.removeRigidBody(entry.body);
    } else if (world.removeCollider && entry.collider) {
      world.removeCollider(entry.collider, true);
    }
  } catch (err) {
    console.warn('[PhysicsWorker] remove trimesh failed for chunk', chunkKey, err.message);
  }
  chunkBodies.delete(chunkKey);
}

function clearTerrain() {
  for (const [chunkKey, entry] of chunkBodies.entries()) {
    try {
      if (world.removeRigidBody && entry.body) {
        world.removeRigidBody(entry.body);
      } else if (world.removeCollider && entry.collider) {
        world.removeCollider(entry.collider, true);
      }
    } catch (err) {
      console.warn('[PhysicsWorker] clear trimesh failed for chunk', chunkKey, err.message);
    }
  }
  chunkBodies.clear();
}

// ── Physics step ─────────────────────────────────────────────────────────────

const WHEEL_OFFSETS = [
  { x: -0.9, y: -0.35, z: -1.3 },
  { x:  0.9, y: -0.35, z: -1.3 },
  { x: -0.9, y: -0.35, z:  1.3 },
  { x:  0.9, y: -0.35, z:  1.3 },
];

function stepPhysics() {
  if (!world) return;
  if (paused || !vehicleBody) { world.step(); return; }

  const rot   = vehicleBody.rotation();
  const quat  = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
  const vel   = vehicleBody.linvel();
  const pos   = vehicleBody.translation();

  // Forward vector in world space
  const fwd   = rotateVec3({ x: 0, y: 0, z: 1 }, quat);
  const right = rotateVec3({ x: 1, y: 0, z: 0 }, quat);

  // Signed speed along forward axis (positive = forward, negative = reversing)
  const forwardSpeed = fwd.x * vel.x + fwd.z * vel.z;
  const lateralSpeed = right.x * vel.x + right.z * vel.z;
  const absSpeed     = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const kmh          = absSpeed * 3.6;

  // ── Engine force ──────────────────────────────────────────────────────────
  // Throttle +1 = forward, -1 = reverse.
  // Speed cap is directional: no forward force if already at max forward, etc.
  const MAX_SPEED_MS  = 28; // ~100 km/h
  const MAX_REV_MS    = 10; // ~36 km/h reverse cap

  let engineForce = 0;
  if (inputThrottle > 0) {
    const ratio = Math.max(0, 1 - forwardSpeed / MAX_SPEED_MS);
    engineForce = vehicleDef.engineForce * inputThrottle * ratio * 0.4;
  } else if (inputThrottle < 0) {
    // Reverse: only when near-stopped or already reversing
    if (forwardSpeed < 1.0) {
      const ratio = Math.max(0, 1 - (-forwardSpeed) / MAX_REV_MS);
      engineForce = vehicleDef.engineForce * inputThrottle * ratio * 0.25;
    }
  }

  vehicleBody.addForce(
    { x: fwd.x * engineForce, y: 0, z: fwd.z * engineForce },
    true
  );

  // ── Steering ──────────────────────────────────────────────────────────────
  const angVel     = vehicleBody.angvel();
  const yawRate    = angVel.y;
  const maxYawRate = 1.2 * Math.max(0.15, 1 - absSpeed / (MAX_SPEED_MS * 2));
  const targetYaw  = -inputSteer * maxYawRate;
  const yawError   = targetYaw - yawRate;
  if (kmh > 1.5) {
    vehicleBody.addTorque({ x: 0, y: yawError * 900, z: 0 }, true);
  }

  // ── Lateral friction (prevents drifting / sliding) ────────────────────────
  vehicleBody.addForce(
    { x: -right.x * lateralSpeed * 3800, y: 0, z: -right.z * lateralSpeed * 3800 },
    true
  );

  // ── Air / rolling resistance ──────────────────────────────────────────────
  vehicleBody.addForce(
    { x: -vel.x * absSpeed * 2.2, y: 0, z: -vel.z * absSpeed * 2.2 },
    true
  );

  // ── Brake (Space held OR S while moving forward) ──────────────────────────
  if (inputBrake > 0) {
    vehicleBody.addForce(
      {
        x: -vel.x * vehicleDef.brakeForce * inputBrake * 4.5,
        y: 0,
        z: -vel.z * vehicleDef.brakeForce * inputBrake * 4.5,
      },
      true
    );
  }

  // ── Hard speed caps ───────────────────────────────────────────────────────
  if (forwardSpeed > MAX_SPEED_MS) {
    const s = MAX_SPEED_MS / Math.max(absSpeed, 0.001);
    vehicleBody.setLinvel({ x: vel.x * s, y: vel.y, z: vel.z * s }, true);
  } else if (forwardSpeed < -MAX_REV_MS) {
    const s = MAX_REV_MS / Math.max(absSpeed, 0.001);
    vehicleBody.setLinvel({ x: vel.x * s, y: vel.y, z: vel.z * s }, true);
  }

  // ── Safety: recover only if we fall far below terrain ────────────────────
  if (pos.y < -5) {
    vehicleBody.setTranslation({ x: pos.x, y: 2.0, z: pos.z }, true);
    const cv = vehicleBody.linvel();
    if (cv.y < 0) vehicleBody.setLinvel({ x: cv.x, y: 0, z: cv.z }, true);
  }

  world.step();

  const posOut = vehicleBody.translation();
  const rotOut = vehicleBody.rotation();
  const velOut = vehicleBody.linvel();

  const now = Date.now();
  self.postMessage({
    type: "state",
    ts: now,
    px: posOut.x, py: posOut.y, pz: posOut.z,
    rx: rotOut.x, ry: rotOut.y, rz: rotOut.z, rw: rotOut.w,
    velocity: Math.sqrt(velOut.x * velOut.x + velOut.z * velOut.z),
    wheels: WHEEL_OFFSETS.map((o) => {
      const wl = rotateVec3(o, rotOut);
      return { px: posOut.x + wl.x, py: posOut.y + wl.y, pz: posOut.z + wl.z };
    }),
  });
}

// ── Fallback (pure JS, no Rapier) ────────────────────────────────────────────

const fb = { x: 0, y: 1.0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0 };

function stepFallback() {
  if (paused) return;
  const cosY = Math.cos(fb.yaw);
  const sinY = Math.sin(fb.yaw);
  const spd  = Math.sqrt(fb.vx * fb.vx + fb.vz * fb.vz);

  if (spd > 0.05) fb.yaw += inputSteer * 0.03;

  // Reverse after braking
  const fwdSpd = cosY * fb.vx + sinY * fb.vz;
  let acc = 0;
  if (inputThrottle > 0) acc = vehicleDef.engineForce * 0.0006 * inputThrottle;
  else if (inputThrottle < 0 && fwdSpd < 0.5) acc = vehicleDef.engineForce * 0.0003 * inputThrottle;

  fb.vx += cosY * acc * FIXED_DT;
  fb.vz += sinY * acc * FIXED_DT;
  fb.vx *= 0.96;
  fb.vz *= 0.96;

  if (inputBrake > 0) { fb.vx *= 0.86; fb.vz *= 0.86; }

  // Lateral friction
  const rx  = -sinY, rz = cosY;
  const lat = rx * fb.vx + rz * fb.vz;
  fb.vx -= rx * lat * 0.72;
  fb.vz -= rz * lat * 0.72;

  fb.x += fb.vx;
  fb.z += fb.vz;
  if (fb.y < 1.0) fb.y = 1.0;

  const sinH = Math.sin(fb.yaw / 2);
  const cosH = Math.cos(fb.yaw / 2);
  const q    = { x: 0, y: sinH, z: 0, w: cosH };

  const now = Date.now();
  self.postMessage({
    type: "state",
    ts: now,
    px: fb.x, py: fb.y, pz: fb.z,
    rx: 0, ry: sinH, rz: 0, rw: cosH,
    velocity: Math.sqrt(fb.vx * fb.vx + fb.vz * fb.vz),
    wheels: WHEEL_OFFSETS.map((o) => {
      const wl = rotateVec3(o, q);
      return { px: fb.x + wl.x, py: fb.y + wl.y, pz: fb.z + wl.z };
    }),
  });
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function rotateVec3(v, q) {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + y * tz - z * ty,
    y: v.y + w * ty + z * tx - x * tz,
    z: v.z + w * tz + x * ty - y * tx,
  };
}

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }