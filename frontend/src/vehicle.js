/**
 * vehicle.js — Local Player Vehicle
 *
 * Handles input, physics communication, model loading, and camera-follow data.
 * Physics simulation runs in physicsWorker.js; this file communicates with it
 * via postMessage and applies the resulting transform to the Three.js mesh.
 *
 * Vehicle types:
 *   0 = Sports Car  — light, fast, sharp steering
 *   1 = Truck       — heavy, slow, wide turns
 *   2 = SUV         — medium all-rounder, higher ride height
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ── Vehicle definitions ───────────────────────────────────────────────────────

const VEHICLE_DEFS = [
  {
    name: 'Sports Car',
    modelUrl: null, // placeholder geometry used if no model
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
    modelUrl: null,
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
    modelUrl: null,
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
    // Mobile joystick axis values (-1 to 1)
    this.steerAxis = 0;
    this.throttleAxis = 0;

    this._bindKeyboard();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'ArrowUp':    case 'KeyW': this.forward = true; break;
        case 'ArrowDown':  case 'KeyS': this.backward = true; break;
        case 'ArrowLeft':  case 'KeyA': this.left = true; break;
        case 'ArrowRight': case 'KeyD': this.right = true; break;
        case 'Space': this.brake = true; break;
      }
    });
    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'ArrowUp':    case 'KeyW': this.forward = false; break;
        case 'ArrowDown':  case 'KeyS': this.backward = false; break;
        case 'ArrowLeft':  case 'KeyA': this.left = false; break;
        case 'ArrowRight': case 'KeyD': this.right = false; break;
        case 'Space': this.brake = false; break;
      }
    });
  }

  /** Effective throttle -1..1 */
  get throttle() {
    if (this.throttleAxis !== 0) return this.throttleAxis;
    if (this.forward) return 1;
    if (this.backward) return -1;
    return 0;
  }

  /** Effective steering -1..1 */
  get steer() {
    if (this.steerAxis !== 0) return this.steerAxis;
    if (this.left) return -1;
    if (this.right) return 1;
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

    // State (updated from physics worker)
    this.position = new THREE.Vector3(0, 2, 0);
    this.rotation = new THREE.Quaternion();
    this.velocity = 0; // m/s scalar
    this.speed = 0;    // km/h

    // Wheel state
    this.wheelRotation = [0, 0, 0, 0];
    this.wheelSteering = 0;

    this.input = new InputState();

    // Expose steerAxis / throttleAxis for mobile controls to write
    window.__vehicleInput = this.input;
  }

  // ── Load model ─────────────────────────────────────────────────────────────

  async load() {
    const def = this.def;

    if (def.modelUrl) {
      const loader = new GLTFLoader();
      try {
        const gltf = await loader.loadAsync(def.modelUrl);
        this.mesh = gltf.scene;
        this.mesh.scale.setScalar(def.scale);
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
      } catch (err) {
        console.warn('[Vehicle] Failed to load model, using placeholder:', err.message);
        this.mesh = this._buildPlaceholder();
      }
    } else {
      this.mesh = this._buildPlaceholder();
    }

    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);

    // Tell physics worker to create this vehicle
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

    // Body
    const bodyGeo = new THREE.BoxGeometry(1.8 * def.scale, 0.7 * def.scale, 4.0 * def.scale);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: 0.2,
      metalness: 0.8,
      envMapIntensity: 1.5,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5 * def.scale;
    body.castShadow = true;
    group.add(body);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.5 * def.scale, 0.55 * def.scale, 2.0 * def.scale);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.1, metalness: 0.3 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.0 * def.scale, 0.2 * def.scale);
    cabin.castShadow = true;
    group.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.35 * def.scale, 0.35 * def.scale, 0.25 * def.scale, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const wheelPositions = [
      new THREE.Vector3(-1.0 * def.scale,  0, -1.3 * def.scale), // FL
      new THREE.Vector3( 1.0 * def.scale,  0, -1.3 * def.scale), // FR
      new THREE.Vector3(-1.0 * def.scale,  0,  1.3 * def.scale), // RL
      new THREE.Vector3( 1.0 * def.scale,  0,  1.3 * def.scale), // RR
    ];

    this.wheelMeshes = [];
    for (const wPos of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.copy(wPos);
      wheel.rotation.z = Math.PI / 2; // lay flat
      wheel.castShadow = true;
      group.add(wheel);
      this.wheelMeshes.push(wheel);
    }

    return group;
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(delta) {
    // Send current input to physics worker every frame
    this.physicsWorker.postMessage({
      type: 'input',
      throttle: this.input.throttle,
      steer: this.input.steer,
      brake: this.input.brake ? 1 : 0,
    });

    // Spin wheels based on speed
    const spinSpeed = this.velocity * 2.0 * delta;
    for (let i = 0; i < this.wheelMeshes.length; i++) {
      if (this.wheelMeshes[i]) {
        this.wheelMeshes[i].rotation.x += spinSpeed;
      }
    }
    // Steer front wheels
    if (this.wheelMeshes[0]) this.wheelMeshes[0].rotation.y = -this.input.steer * (VEHICLE_DEFS[this.vehicleType]?.maxSteer || 0.45);
    if (this.wheelMeshes[1]) this.wheelMeshes[1].rotation.y = -this.input.steer * (VEHICLE_DEFS[this.vehicleType]?.maxSteer || 0.45);
  }

  // ── Apply physics state from worker ───────────────────────────────────────

  applyPhysicsState(state) {
    if (!this.mesh) return;

    // Position
    this.position.set(state.px, state.py, state.pz);
    this.mesh.position.copy(this.position);

    // Rotation (quaternion)
    this.rotation.set(state.rx, state.ry, state.rz, state.rw);
    this.mesh.quaternion.copy(this.rotation);

    // Velocity
    this.velocity = state.velocity || 0;
    this.speed = Math.abs(this.velocity) * 3.6; // m/s → km/h

    // Wheel positions from physics
    if (state.wheels && this.wheelMeshes.length) {
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

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
    }
  }
}
