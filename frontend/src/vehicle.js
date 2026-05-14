/**
 * vehicle.js — Local Player Vehicle
 *
 * Fixes applied:
 *   1. A = steer left, D = steer right (was inverted before)
 *   2. S key: brakes first when moving forward, then reverses when near-stopped
 *   3. GLB models loaded from /cars-model/ folder
 *   4. window.__vehicleInput.mobileLeft/mobileRight for arrow buttons in ui.js
 *
 * Vehicle types:
 *   0 = Sports Car  (sports-car.glb)
 *   1 = Truck       (truck.glb)
 *   2 = SUV         (suv.glb)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ── Vehicle definitions ───────────────────────────────────────────────────────
// GLB models are expected in frontend/public/cars-model/
// Vite serves public/ at root so /cars-model/sports-car.glb works at runtime.

const VEHICLE_DEFS = [
  {
    name: 'Sports Car',
    modelUrl: new URL('../cars-model/sports-car.glb', import.meta.url).href,
    mass: 1200,
    engineForce: 3500,
    brakeForce: 200,
    maxSteer: 0.5,
    suspensionStiffness: 30,
    color: 0xff3333,
    scale: 1.0,
    rideHeight: 0.35,
  },
  {
    name: 'Truck',
    modelUrl: new URL('../cars-model/truck.glb', import.meta.url).href,
    mass: 3500,
    engineForce: 6000,
    brakeForce: 350,
    maxSteer: 0.38,
    suspensionStiffness: 20,
    color: 0x3366ff,
    scale: 1.4,
    rideHeight: 0.6,
  },
  {
    name: 'SUV',
    modelUrl: new URL('../cars-model/suv.glb', import.meta.url).href,
    mass: 2000,
    engineForce: 4500,
    brakeForce: 250,
    maxSteer: 0.44,
    suspensionStiffness: 25,
    color: 0x33cc66,
    scale: 1.2,
    rideHeight: 0.5,
  },
];

// ── Input state ───────────────────────────────────────────────────────────────

class InputState {
  constructor() {
    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;
    this.brake = false;

    // Mobile joystick axis (-1..1)
    this.steerAxis = 0;
    this.throttleAxis = 0;
    // Mobile arrow buttons (set by ui.js)
    this.mobileLeft = false;
    this.mobileRight = false;

    // Updated each frame from LocalVehicle so S-logic knows speed
    this._currentSpeedKmh = 0;

    this._bindKeyboard();
  }

  _reset() {
    this.forward = false;
    this.backward = false;
    this.left = false;
    this.right = false;
    this.brake = false;
    this.steerAxis = 0;
    this.throttleAxis = 0;
    this.mobileLeft = false;
    this.mobileRight = false;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'ArrowUp':    case 'KeyW': this.forward  = true; break;
        case 'ArrowDown':  case 'KeyS': this.backward = true; break;
        // FIX: A → left (-1), D → right (+1)
        case 'ArrowLeft':  case 'KeyA': this.left  = true; break;
        case 'ArrowRight': case 'KeyD': this.right = true; break;
        case 'Space': this.brake = true; break;
      }
    });
    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'ArrowUp':    case 'KeyW': this.forward  = false; break;
        case 'ArrowDown':  case 'KeyS': this.backward = false; break;
        case 'ArrowLeft':  case 'KeyA': this.left  = false; break;
        case 'ArrowRight': case 'KeyD': this.right = false; break;
        case 'Space': this.brake = false; break;
      }
    });

    window.addEventListener('blur', () => this._reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._reset();
    });
  }

  /**
   * Effective throttle -1..1
   * S: brakes first (returns 0 + brakeActive=true) while moving forward,
   *    then reverses once speed drops below 2 km/h.
   */
  get throttle() {
    if (this.throttleAxis !== 0) return this.throttleAxis;
    if (this.forward) return 1;
    if (this.backward) {
      return this._currentSpeedKmh > 2 ? 0 : -1;
    }
    return 0;
  }

  /**
   * Whether brake force should be applied.
   * True when Space is held OR S is held while still rolling forward.
   */
  get brakeActive() {
    if (this.brake) return true;
    if (this.backward && this._currentSpeedKmh > 2) return true;
    return false;
  }

  /**
   * Effective steering -1..1  (left = -1, right = +1)
   * Priority: joystick → mobile arrows → keyboard
   */
  get steer() {
    if (this.steerAxis !== 0) return this.steerAxis;
    if (this.mobileLeft)  return -1;
    if (this.mobileRight) return  1;
    if (this.left)  return -1;
    if (this.right) return  1;
    return 0;
  }
}

// ── LocalVehicle ──────────────────────────────────────────────────────────────

export class LocalVehicle {
  constructor(scene, vehicleType, physicsWorker) {
    this.scene = scene;
    this.vehicleType = vehicleType;
    this.def = VEHICLE_DEFS[vehicleType] || VEHICLE_DEFS[0];
    this.physicsWorker = physicsWorker;

    this.mesh = null;
    this.wheelMeshes = [];
    this._usesGLB = false;

    this.position = new THREE.Vector3(0, 2, 0);
    this.rotation = new THREE.Quaternion();
    this.velocity = 0;
    this.speed = 0;
    this.inputSpeedKmh = null;

    this.input = new InputState();
    window.__vehicleInput = this.input;
  }

  // ── Load model ─────────────────────────────────────────────────────────────

  async load() {
    const def = this.def;
    const loader = new GLTFLoader();

    if (def.modelUrl) {
      try {
        const gltf = await loader.loadAsync(def.modelUrl);
        this.mesh = gltf.scene;

        // Auto-scale so longest axis ≈ 4.5 units
        const box = new THREE.Box3().setFromObject(this.mesh);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const autoScale = (4.5 * def.scale) / maxDim;
        this.mesh.scale.setScalar(autoScale);

        this.mesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = false;
            if (child.material) {
              child.material = child.material.clone();
              child.material.envMapIntensity = 1.5;
            }
          }
        });

        // Collect wheel meshes by name
        this.wheelMeshes = [];
        this.mesh.traverse((child) => {
          if (child.isMesh && /wheel/i.test(child.name)) {
            this.wheelMeshes.push(child);
          }
        });

        this._usesGLB = true;
        console.log(`[Vehicle] GLB loaded: ${def.modelUrl}, wheels: ${this.wheelMeshes.length}`);
      } catch (err) {
        console.warn('[Vehicle] GLB load failed, using placeholder:', err.message);
        this.mesh = this._buildPlaceholder();
      }
    } else {
      this.mesh = this._buildPlaceholder();
    }

    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);

    this.physicsWorker.postMessage({
      type: 'createVehicle',
      vehicleType: this.vehicleType,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      mass: def.mass,
      engineForce: def.engineForce,
      brakeForce: def.brakeForce,
      maxSteer: def.maxSteer,
      rideHeight: def.rideHeight,
    });
  }

  // ── Placeholder geometry ───────────────────────────────────────────────────

  _buildPlaceholder() {
    const def = this.def;
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(1.8 * def.scale, 0.7 * def.scale, 4.0 * def.scale);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: def.color, roughness: 0.2, metalness: 0.8, envMapIntensity: 1.5,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5 * def.scale;
    body.castShadow = true;
    group.add(body);

    const cabinGeo = new THREE.BoxGeometry(1.5 * def.scale, 0.55 * def.scale, 2.0 * def.scale);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.1, metalness: 0.3 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.0 * def.scale, 0.2 * def.scale);
    cabin.castShadow = true;
    group.add(cabin);

    const wheelGeo = new THREE.CylinderGeometry(0.35 * def.scale, 0.35 * def.scale, 0.25 * def.scale, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const wps = [
      new THREE.Vector3(-1.0 * def.scale, 0, -1.3 * def.scale),
      new THREE.Vector3( 1.0 * def.scale, 0, -1.3 * def.scale),
      new THREE.Vector3(-1.0 * def.scale, 0,  1.3 * def.scale),
      new THREE.Vector3( 1.0 * def.scale, 0,  1.3 * def.scale),
    ];
    this.wheelMeshes = [];
    for (const wp of wps) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.copy(wp);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      group.add(wheel);
      this.wheelMeshes.push(wheel);
    }
    return group;
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta) {
    // Update speed for S-brake logic
    const speedForInput = this.inputSpeedKmh !== null ? this.inputSpeedKmh : this.speed;
    this.input._currentSpeedKmh = speedForInput;

    this.physicsWorker.postMessage({
      type: 'input',
      throttle: this.input.throttle,
      steer: this.input.steer,
      brake: this.input.brakeActive ? 1 : 0,
    });

    // Animate wheels for placeholder models
    if (!this._usesGLB) {
      const spin = this.velocity * 2.0 * delta;
      for (const wm of this.wheelMeshes) {
        if (wm) wm.rotation.x += spin;
      }
      const maxS = this.def.maxSteer || 0.45;
      if (this.wheelMeshes[0]) this.wheelMeshes[0].rotation.y = this.input.steer * maxS;
      if (this.wheelMeshes[1]) this.wheelMeshes[1].rotation.y = this.input.steer * maxS;
    }
  }

  // ── Apply physics state from worker ───────────────────────────────────────

  applyPhysicsState(state) {
    if (!this.mesh) return;

    this.position.set(state.px, state.py, state.pz);
    this.mesh.position.copy(this.position);

    this.rotation.set(state.rx, state.ry, state.rz, state.rw);
    this.mesh.quaternion.copy(this.rotation);

    this.velocity = state.velocity || 0;
    this.speed = Math.abs(this.velocity) * 3.6;

    if (!this._usesGLB && state.wheels && this.wheelMeshes.length) {
      for (let i = 0; i < Math.min(state.wheels.length, this.wheelMeshes.length); i++) {
        const w = state.wheels[i];
        if (w && this.wheelMeshes[i]) {
          this.wheelMeshes[i].position.set(
            w.px - this.position.x,
            w.py - this.position.y,
            w.pz - this.position.z
          );
        }
      }
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  getPosition() { return this.position; }
  getRotation() { return this.rotation; }
  getSpeed()    { return this.speed; }

  getNetworkState() {
    return {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z, w: this.rotation.w },
      velocity: this.velocity,
      vehicleType: this.vehicleType,
    };
  }

  setInputSpeedKmh(speedKmh) {
    this.inputSpeedKmh = speedKmh;
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
    }
  }
}