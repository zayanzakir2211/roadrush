/**
 * physicsWorker.js — Rapier Physics Simulation (Web Worker)
 *
 * Uses @dimforge/rapier3d-compat which self-initializes its WASM
 * and works correctly inside Web Workers without any bundler magic.
 *
 * Install: npm install @dimforge/rapier3d-compat
 */

// ── IMPORTANT: use the -compat build, NOT rapier3d ───────────────────────────
import RAPIER from '@dimforge/rapier3d-compat';

let world        = null;
let vehicleBody  = null;
let paused       = false;

let inputThrottle = 0;
let inputSteer    = 0;
let inputBrake    = 0;

const FIXED_DT = 1 / 60;
let stepIntervalId = null;

let vehicleDef = {
  engineForce: 3500,
  brakeForce:  200,
  maxSteer:    0.5,
};

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':          await initRapier();                              break;
    case 'setSeed':       /* used by world gen only */                     break;
    case 'createVehicle': if (world) createVehicle(msg);                  break;
    case 'input':
      inputThrottle = clamp(msg.throttle ?? 0, -1, 1);
      inputSteer    = clamp(msg.steer    ?? 0, -1, 1);
      inputBrake    = clamp(msg.brake    ?? 0,  0, 1);
      break;
    case 'addTrimesh':
      if (world && msg.vertices && msg.indices)
        addTrimesh(msg.vertices, msg.indices, msg.offsetX ?? 0, msg.offsetZ ?? 0);
      break;
    case 'pause':  paused = true;  break;
    case 'resume': paused = false; break;
  }
};

// ── Rapier init ───────────────────────────────────────────────────────────────
// rapier3d-compat exposes an async init() on its default export.
// We await it once before touching any RAPIER classes.

async function initRapier() {
  try {
    await RAPIER.init();   // ← correct call for rapier3d-compat
    buildWorld();
    stepIntervalId = setInterval(stepPhysics, FIXED_DT * 1000);
    self.postMessage({ type: 'ready' });
  } catch (err) {
    console.error('[PhysicsWorker] Rapier init failed, using fallback:', err);
    stepIntervalId = setInterval(stepFallback, FIXED_DT * 1000);
    self.postMessage({ type: 'ready', fallback: true });
  }
}

function buildWorld() {
  world = new RAPIER.World({ x: 0, y: -20, z: 0 });

  // Default flat ground so vehicle lands somewhere before chunks arrive
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.halfSpace({ x: 0, y: 1, z: 0 }),
    groundBody
  );
}

// ── Vehicle creation ──────────────────────────────────────────────────────────

function createVehicle(cfg) {
  vehicleDef.engineForce = cfg.engineForce ?? 3500;
  vehicleDef.brakeForce  = cfg.brakeForce  ?? 200;
  vehicleDef.maxSteer    = cfg.maxSteer    ?? 0.5;

  const spawnX = cfg.position?.x ?? 0;
  const spawnY = (cfg.position?.y ?? 2) + 1;
  const spawnZ = cfg.position?.z ?? 0;

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnX, spawnY, spawnZ)
    .setLinearDamping(0.3)
    .setAngularDamping(2.5)
    .setAdditionalMass(cfg.mass ?? 1200);

  vehicleBody = world.createRigidBody(bodyDesc);

  // Lock X/Z rotation → car won't flip or roll uncontrollably
  vehicleBody.setEnabledRotations(false, true, false, true);

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.9, 0.4, 2.0)
      .setFriction(0.8)
      .setRestitution(0.05)
      .setTranslation(0, 0.4, 0),
    vehicleBody
  );
}

// ── Terrain trimesh ───────────────────────────────────────────────────────────

function addTrimesh(vertices, indices, offsetX, offsetZ) {
  const shifted = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    shifted[i]     = vertices[i]     + offsetX;
    shifted[i + 1] = vertices[i + 1];
    shifted[i + 2] = vertices[i + 2] + offsetZ;
  }
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(shifted, indices)
      .setFriction(0.8)
      .setRestitution(0.05),
    groundBody
  );
}

// ── Physics step ──────────────────────────────────────────────────────────────

const WHEEL_OFFSETS = [
  { x: -0.9, y: -0.35, z: -1.3 }, // front-left
  { x:  0.9, y: -0.35, z: -1.3 }, // front-right
  { x: -0.9, y: -0.35, z:  1.3 }, // rear-left
  { x:  0.9, y: -0.35, z:  1.3 }, // rear-right
];

function stepPhysics() {
  if (!world) return;
  if (paused || !vehicleBody) { world.step(); return; }

  const rot  = vehicleBody.rotation();
  const quat = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
  const vel  = vehicleBody.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  // Forward vector (vehicle local +Z in world space)
  const fwd   = rotateVec3({ x: 0, y: 0, z: 1 }, quat);
  // Right vector
  const right = rotateVec3({ x: 1, y: 0, z: 0 }, quat);

  // ── Engine ────────────────────────────────────────────────────────────────
  const forceScale = vehicleDef.engineForce * inputThrottle;
  vehicleBody.applyForce({ x: fwd.x * forceScale, y: 0, z: fwd.z * forceScale }, true);

  // ── Steering torque (speed-scaled so no spin-outs from standing start) ───
  const steerTorque = inputSteer * clamp(speed * 120 + 200, 200, 900);
  vehicleBody.applyTorque({ x: 0, y: steerTorque, z: 0 }, true);

  // ── Lateral friction (prevents ice-rink sliding) ──────────────────────────
  const lateralVel = right.x * vel.x + right.z * vel.z;
  vehicleBody.applyForce(
    { x: -right.x * lateralVel * 2400, y: 0, z: -right.z * lateralVel * 2400 },
    true
  );

  // ── Brake ─────────────────────────────────────────────────────────────────
  if (inputBrake > 0) {
    vehicleBody.applyForce(
      { x: -vel.x * vehicleDef.brakeForce * inputBrake * 3, y: 0, z: -vel.z * vehicleDef.brakeForce * inputBrake * 3 },
      true
    );
  }

  // ── Speed cap (~180 km/h) ─────────────────────────────────────────────────
  if (speed > 50) {
    const s = 50 / speed;
    vehicleBody.setLinvel({ x: vel.x * s, y: vel.y, z: vel.z * s }, true);
  }

  world.step();

  const pos    = vehicleBody.translation();
  const rotOut = vehicleBody.rotation();
  const velOut = vehicleBody.linvel();
  const velScalar = Math.sqrt(velOut.x * velOut.x + velOut.z * velOut.z);

  const wheels = WHEEL_OFFSETS.map((o) => {
    const wl = rotateVec3(o, rotOut);
    return { px: pos.x + wl.x, py: pos.y + wl.y, pz: pos.z + wl.z };
  });

  self.postMessage({
    type: 'state',
    px: pos.x, py: pos.y, pz: pos.z,
    rx: rotOut.x, ry: rotOut.y, rz: rotOut.z, rw: rotOut.w,
    velocity: velScalar,
    wheels,
  });
}

// ── Fallback simulation (no Rapier) ──────────────────────────────────────────

const fb = { x: 0, y: 0.5, z: 0, vx: 0, vz: 0, yaw: 0 };

function stepFallback() {
  if (paused) return;

  const cosY = Math.cos(fb.yaw);
  const sinY = Math.sin(fb.yaw);
  const spd  = Math.sqrt(fb.vx * fb.vx + fb.vz * fb.vz);

  if (spd > 0.05) fb.yaw += inputSteer * 0.03;

  const acc = vehicleDef.engineForce * 0.0006 * inputThrottle;
  fb.vx += cosY * acc * FIXED_DT;
  fb.vz += sinY * acc * FIXED_DT;
  fb.vx *= 0.96;
  fb.vz *= 0.96;

  if (inputBrake > 0) { fb.vx *= 0.88; fb.vz *= 0.88; }

  // Lateral friction
  const rx  = -sinY, rz = cosY;
  const lat = rx * fb.vx + rz * fb.vz;
  fb.vx -= rx * lat * 0.7;
  fb.vz -= rz * lat * 0.7;

  fb.x += fb.vx;
  fb.z += fb.vz;

  const speed   = Math.sqrt(fb.vx * fb.vx + fb.vz * fb.vz);
  const halfYaw = fb.yaw / 2;
  const sinH    = Math.sin(halfYaw);
  const cosH    = Math.cos(halfYaw);
  const q       = { x: 0, y: sinH, z: 0, w: cosH };

  const wheels = WHEEL_OFFSETS.map((o) => {
    const wl = rotateVec3(o, q);
    return { px: fb.x + wl.x, py: fb.y + wl.y, pz: fb.z + wl.z };
  });

  self.postMessage({
    type: 'state',
    px: fb.x, py: fb.y, pz: fb.z,
    rx: 0, ry: sinH, rz: 0, rw: cosH,
    velocity: speed,
    wheels,
  });
}

// ── Math helpers ──────────────────────────────────────────────────────────────

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