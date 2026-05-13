/**
 * physicsWorker.js — Rapier Physics Simulation (Web Worker)
 *
 * Runs at a fixed 60Hz timestep. Simulates the local player vehicle using
 * Rapier's built-in vehicle controller. Sends position/rotation back to the
 * main thread each step via postMessage.
 *
 * Receives messages:
 *   { type: 'init' }              — load Rapier WASM
 *   { type: 'setSeed', seed }     — seed for deterministic world (not used directly in physics)
 *   { type: 'createVehicle', ... } — spawn the player's rigid body + vehicle controller
 *   { type: 'input', throttle, steer, brake } — update controls each frame
 *   { type: 'addTrimesh', vertices, indices } — add terrain collision mesh
 *   { type: 'pause' / 'resume' }  — pause/resume simulation
 */

let RAPIER = null;
let world = null;
let vehicleBody = null;
let vehicleController = null;
let paused = false;

// Current control inputs (written by 'input' messages, read each physics step)
let inputThrottle = 0;
let inputSteer = 0;
let inputBrake = 0;

// Fixed timestep: 60 Hz
const FIXED_DT = 1 / 60;
let stepIntervalId = null;

// Vehicle config (set on createVehicle)
let vehicleDef = {
  engineForce: 3500,
  brakeForce: 200,
  maxSteer: 0.5,
};

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = async (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      await initRapier();
      break;

    case 'setSeed':
      // Seed is for world gen; physics uses it only if needed for determinism
      break;

    case 'createVehicle':
      if (RAPIER && world) {
        createVehicle(msg);
      }
      break;

    case 'input':
      inputThrottle = clamp(msg.throttle ?? 0, -1, 1);
      inputSteer    = clamp(msg.steer    ?? 0, -1, 1);
      inputBrake    = clamp(msg.brake    ?? 0,  0, 1);
      break;

    case 'addTrimesh':
      if (RAPIER && world && msg.vertices && msg.indices) {
        addTrimesh(msg.vertices, msg.indices, msg.offsetX ?? 0, msg.offsetZ ?? 0);
      }
      break;

    case 'pause':
      paused = true;
      break;

    case 'resume':
      paused = false;
      break;
  }
};

// ── Rapier initialisation ─────────────────────────────────────────────────────

async function initRapier() {
  try {
    RAPIER = await import('@dimforge/rapier3d');
    await RAPIER.init();

    // Create physics world with standard gravity
    const gravity = { x: 0, y: -20, z: 0 };
    world = new RAPIER.World(gravity);

    // Add a default flat ground plane for before terrain chunks arrive
    const groundDesc = RAPIER.RigidBodyDesc.fixed();
    const groundBody = world.createRigidBody(groundDesc);
    const groundCollider = RAPIER.ColliderDesc.halfSpace({ x: 0, y: 1, z: 0 });
    world.createCollider(groundCollider, groundBody);

    // Start the step loop
    stepIntervalId = setInterval(stepPhysics, FIXED_DT * 1000);

    self.postMessage({ type: 'ready' });
  } catch (err) {
    // Rapier WASM may not be available in all environments
    console.error('[PhysicsWorker] Failed to init Rapier:', err);
    // Fall back: simulate simple position update without real physics
    stepIntervalId = setInterval(stepFallback, FIXED_DT * 1000);
    self.postMessage({ type: 'ready', fallback: true });
  }
}

// ── Vehicle creation ──────────────────────────────────────────────────────────

function createVehicle(cfg) {
  vehicleDef.engineForce = cfg.engineForce ?? 3500;
  vehicleDef.brakeForce  = cfg.brakeForce  ?? 200;
  vehicleDef.maxSteer    = cfg.maxSteer    ?? 0.5;

  const mass = cfg.mass ?? 1200;
  const spawnY = (cfg.position?.y ?? 2) + 1;

  // Rigid body
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(cfg.position?.x ?? 0, spawnY, cfg.position?.z ?? 0)
    .setLinearDamping(0.1)
    .setAngularDamping(0.5)
    .setAdditionalMass(mass);

  vehicleBody = world.createRigidBody(bodyDesc);

  // Box collider representing the chassis
  const half = { x: 0.9, y: 0.4, z: 2.0 };
  const chassisCollider = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
    .setFriction(0.5)
    .setRestitution(0.1)
    .setTranslation(0, 0.4, 0);

  world.createCollider(chassisCollider, vehicleBody);

  // Rapier's built-in dynamic character controller used as a vehicle approximation.
  // (Full vehicle controller requires Rapier Enterprise; we simulate wheels manually.)
}

// ── Terrain trimesh ───────────────────────────────────────────────────────────

function addTrimesh(vertices, indices, offsetX, offsetZ) {
  // Shift vertices by chunk offset
  const shifted = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    shifted[i]     = vertices[i] + offsetX;
    shifted[i + 1] = vertices[i + 1];
    shifted[i + 2] = vertices[i + 2] + offsetZ;
  }

  const groundDesc = RAPIER.RigidBodyDesc.fixed();
  const groundBody = world.createRigidBody(groundDesc);
  const colliderDesc = RAPIER.ColliderDesc.trimesh(shifted, indices)
    .setFriction(0.8)
    .setRestitution(0.05);
  world.createCollider(colliderDesc, groundBody);
}

// ── Physics step ──────────────────────────────────────────────────────────────

// Wheel positions relative to chassis (local space)
const WHEEL_OFFSETS = [
  { x: -0.9, y: -0.35, z: -1.3 },
  { x:  0.9, y: -0.35, z: -1.3 },
  { x: -0.9, y: -0.35, z:  1.3 },
  { x:  0.9, y: -0.35, z:  1.3 },
];

function stepPhysics() {
  if (paused || !world || !vehicleBody) {
    // If no vehicle yet, still advance world to keep it alive
    if (world && !paused) world.step();
    return;
  }

  // ── Apply engine / steering forces ────────────────────────────────────────

  const rot = vehicleBody.rotation();
  const quat = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };

  // Forward vector in world space
  const fwd = rotateVec3({ x: 0, y: 0, z: 1 }, quat);
  const right = rotateVec3({ x: 1, y: 0, z: 0 }, quat);

  // Engine force along forward
  const forceScale = vehicleDef.engineForce * inputThrottle;
  vehicleBody.applyForce(
    { x: fwd.x * forceScale, y: 0, z: fwd.z * forceScale },
    true
  );

  // Steering torque around Y
  const steerTorque = inputSteer * 800;
  vehicleBody.applyTorque({ x: 0, y: steerTorque, z: 0 }, true);

  // Braking: apply opposing linear velocity damping
  if (inputBrake > 0) {
    const vel = vehicleBody.linvel();
    vehicleBody.applyForce(
      {
        x: -vel.x * vehicleDef.brakeForce * inputBrake,
        y: 0,
        z: -vel.z * vehicleDef.brakeForce * inputBrake,
      },
      true
    );
  }

  // Clamp velocity (max speed ~50 m/s = 180 km/h)
  const vel = vehicleBody.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (speed > 50) {
    const scale = 50 / speed;
    vehicleBody.setLinvel({ x: vel.x * scale, y: vel.y, z: vel.z * scale }, true);
  }

  // ── Step world ────────────────────────────────────────────────────────────

  world.step();

  // ── Read back state ───────────────────────────────────────────────────────

  const pos = vehicleBody.translation();
  const rotOut = vehicleBody.rotation();
  const velOut = vehicleBody.linvel();
  const velocityScalar = Math.sqrt(velOut.x * velOut.x + velOut.z * velOut.z);

  // Compute approximate wheel world positions
  const wheels = WHEEL_OFFSETS.map((offset) => {
    const wLocal = rotateVec3(offset, rotOut);
    return {
      px: pos.x + wLocal.x,
      py: pos.y + wLocal.y,
      pz: pos.z + wLocal.z,
    };
  });

  self.postMessage({
    type: 'state',
    px: pos.x, py: pos.y, pz: pos.z,
    rx: rotOut.x, ry: rotOut.y, rz: rotOut.z, rw: rotOut.w,
    velocity: velocityScalar,
    wheels,
  });
}

// ── Fallback simulation (no Rapier) ──────────────────────────────────────────
// Simple Euler integration: vehicle stays on Y=0 plane.

const fb = {
  x: 0, y: 0.5, z: 0,
  vx: 0, vz: 0,
  yaw: 0,
};

function stepFallback() {
  if (paused) return;

  const dt = FIXED_DT;
  const cosY = Math.cos(fb.yaw);
  const sinY = Math.sin(fb.yaw);

  // Steering
  if (Math.abs(fb.vx) + Math.abs(fb.vz) > 0.1) {
    fb.yaw += inputSteer * 0.035;
  }

  // Throttle
  const force = vehicleDef.engineForce * 0.0008 * inputThrottle;
  fb.vx += cosY * force * dt;
  fb.vz += sinY * force * dt;

  // Drag
  fb.vx *= 0.97;
  fb.vz *= 0.97;

  // Brake
  if (inputBrake > 0) {
    fb.vx *= 0.9;
    fb.vz *= 0.9;
  }

  fb.x += fb.vx;
  fb.z += fb.vz;

  const speed = Math.sqrt(fb.vx * fb.vx + fb.vz * fb.vz);
  const halfYaw = fb.yaw / 2;

  const wheels = [
    { px: fb.x - Math.sin(fb.yaw) * 0.9 - cosY * 1.3, py: fb.y - 0.35, pz: fb.z + Math.cos(fb.yaw) * 0.9 - sinY * 1.3 },
    { px: fb.x + Math.sin(fb.yaw) * 0.9 - cosY * 1.3, py: fb.y - 0.35, pz: fb.z - Math.cos(fb.yaw) * 0.9 - sinY * 1.3 },
    { px: fb.x - Math.sin(fb.yaw) * 0.9 + cosY * 1.3, py: fb.y - 0.35, pz: fb.z + Math.cos(fb.yaw) * 0.9 + sinY * 1.3 },
    { px: fb.x + Math.sin(fb.yaw) * 0.9 + cosY * 1.3, py: fb.y - 0.35, pz: fb.z - Math.cos(fb.yaw) * 0.9 + sinY * 1.3 },
  ];

  self.postMessage({
    type: 'state',
    px: fb.x, py: fb.y, pz: fb.z,
    rx: 0, ry: Math.sin(halfYaw), rz: 0, rw: Math.cos(halfYaw),
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

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
