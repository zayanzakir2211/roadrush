/**
 * physicsWorker.js — Rapier Physics Simulation (Web Worker)
 * FIXED: Correct Rapier WASM init + stable vehicle physics
 */

let RAPIER = null;
let world = null;
let vehicleBody = null;
let paused = false;

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
    case 'init':
      await initRapier();
      break;
    case 'setSeed':
      break;
    case 'createVehicle':
      if (world) createVehicle(msg);
      break;
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

// ── Rapier init (THE FIX) ─────────────────────────────────────────────────────
// @dimforge/rapier3d exports a default async init, not RAPIER.init()
// We must dynamic-import and await the default export.

async function initRapier() {
  try {
    // ✅ Correct import pattern for rapier3d in a module worker
    const rapierModule = await import('@dimforge/rapier3d');

    // The package exports an `init` as the default OR as a named export depending
    // on the bundler. Try both patterns:
    if (typeof rapierModule.default === 'function') {
      await rapierModule.default();           // default export is the init fn
    } else if (typeof rapierModule.init === 'function') {
      await rapierModule.init();              // named export
    }
    // After awaiting init, all RAPIER classes are available on the module
    RAPIER = rapierModule;

    buildWorld();
    stepIntervalId = setInterval(stepPhysics, FIXED_DT * 1000);
    self.postMessage({ type: 'ready' });

  } catch (err) {
    console.error('[PhysicsWorker] Rapier init failed, using fallback:', err);
    // Fallback: pure JS simulation so the game still works
    stepIntervalId = setInterval(stepFallback, FIXED_DT * 1000);
    self.postMessage({ type: 'ready', fallback: true });
  }
}

function buildWorld() {
  const gravity = { x: 0, y: -20, z: 0 };
  world = new RAPIER.World(gravity);

  // Default ground plane
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

  const mass   = cfg.mass ?? 1200;
  const spawnX = cfg.position?.x ?? 0;
  const spawnY = (cfg.position?.y ?? 2) + 1;
  const spawnZ = cfg.position?.z ?? 0;

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnX, spawnY, spawnZ)
    .setLinearDamping(0.3)      // more damping = less sliding
    .setAngularDamping(2.0)     // more damping = less spinning
    .setAdditionalMass(mass);

  vehicleBody = world.createRigidBody(bodyDesc);

  // Lock rotation on X and Z so the car doesn't flip easily
  vehicleBody.setEnabledRotations(false, true, false, true);

  const chassisCollider = RAPIER.ColliderDesc
    .cuboid(0.9, 0.4, 2.0)
    .setFriction(0.8)
    .setRestitution(0.05)
    .setTranslation(0, 0.4, 0);

  world.createCollider(chassisCollider, vehicleBody);
}

// ── Trimesh terrain ───────────────────────────────────────────────────────────

function addTrimesh(vertices, indices, offsetX, offsetZ) {
  const shifted = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    shifted[i]     = vertices[i]     + offsetX;
    shifted[i + 1] = vertices[i + 1];
    shifted[i + 2] = vertices[i + 2] + offsetZ;
  }
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(shifted, indices).setFriction(0.8).setRestitution(0.05),
    groundBody
  );
}

// ── Physics step ──────────────────────────────────────────────────────────────

const WHEEL_OFFSETS = [
  { x: -0.9, y: -0.35, z: -1.3 },
  { x:  0.9, y: -0.35, z: -1.3 },
  { x: -0.9, y: -0.35, z:  1.3 },
  { x:  0.9, y: -0.35, z:  1.3 },
];

function stepPhysics() {
  if (!world) return;

  if (paused) {
    world.step();
    return;
  }

  if (!vehicleBody) {
    world.step();
    return;
  }

  const rot = vehicleBody.rotation();
  const quat = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };

  // Forward vector in world space (vehicle's +Z)
  const fwd = rotateVec3({ x: 0, y: 0, z: 1 }, quat);

  // ── Engine force ─────────────────────────────────────────────────────────
  const forceScale = vehicleDef.engineForce * inputThrottle;
  vehicleBody.applyForce(
    { x: fwd.x * forceScale, y: 0, z: fwd.z * forceScale },
    true
  );

  // ── Steering torque ───────────────────────────────────────────────────────
  // Scale torque by current speed so steering feels consistent
  const vel   = vehicleBody.linvel();
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const steerTorque = inputSteer * Math.min(speed * 120 + 200, 900);
  vehicleBody.applyTorque({ x: 0, y: steerTorque, z: 0 }, true);

  // ── Lateral friction (stops sideways sliding) ─────────────────────────────
  const right = rotateVec3({ x: 1, y: 0, z: 0 }, quat);
  const lateralVel = right.x * vel.x + right.z * vel.z;
  const lateralFriction = 2200;
  vehicleBody.applyForce(
    {
      x: -right.x * lateralVel * lateralFriction,
      y: 0,
      z: -right.z * lateralVel * lateralFriction,
    },
    true
  );

  // ── Braking ───────────────────────────────────────────────────────────────
  if (inputBrake > 0) {
    vehicleBody.applyForce(
      {
        x: -vel.x * vehicleDef.brakeForce * inputBrake * 3,
        y: 0,
        z: -vel.z * vehicleDef.brakeForce * inputBrake * 3,
      },
      true
    );
  }

  // ── Speed cap (≈ 180 km/h) ────────────────────────────────────────────────
  if (speed > 50) {
    const s = 50 / speed;
    vehicleBody.setLinvel({ x: vel.x * s, y: vel.y, z: vel.z * s }, true);
  }

  // ── Step world ────────────────────────────────────────────────────────────
  world.step();

  // ── Read back & post ──────────────────────────────────────────────────────
  const pos    = vehicleBody.translation();
  const rotOut = vehicleBody.rotation();
  const velOut = vehicleBody.linvel();
  const velScalar = Math.sqrt(velOut.x * velOut.x + velOut.z * velOut.z);

  const wheels = WHEEL_OFFSETS.map((offset) => {
    const wl = rotateVec3(offset, rotOut);
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

// ── Fallback simulation ───────────────────────────────────────────────────────

const fb = { x: 0, y: 0.5, z: 0, vx: 0, vz: 0, yaw: 0 };

function stepFallback() {
  if (paused) return;

  const dt   = FIXED_DT;
  const cosY = Math.cos(fb.yaw);
  const sinY = Math.sin(fb.yaw);

  const spd = Math.sqrt(fb.vx * fb.vx + fb.vz * fb.vz);

  // Steer only when moving
  if (spd > 0.05) fb.yaw += inputSteer * 0.03;

  // Throttle
  const acc = vehicleDef.engineForce * 0.0006 * inputThrottle;
  fb.vx += cosY * acc * dt;
  fb.vz += sinY * acc * dt;

  // Drag
  fb.vx *= 0.96;
  fb.vz *= 0.96;

  // Brake
  if (inputBrake > 0) { fb.vx *= 0.88; fb.vz *= 0.88; }

  // Lateral friction (stop sliding)
  const rx = -sinY, rz = cosY;
  const lat = rx * fb.vx + rz * fb.vz;
  fb.vx -= rx * lat * 0.7;
  fb.vz -= rz * lat * 0.7;

  fb.x += fb.vx;
  fb.z += fb.vz;

  const speed   = Math.sqrt(fb.vx * fb.vx + fb.vz * fb.vz);
  const halfYaw = fb.yaw / 2;
  const sinH    = Math.sin(halfYaw);
  const cosH    = Math.cos(halfYaw);

  const wheels = WHEEL_OFFSETS.map((o) => {
    const wl = rotateVec3(o, { x: 0, y: sinH, z: 0, w: cosH });
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

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}