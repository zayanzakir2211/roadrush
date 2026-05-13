/**
 * remotePlayer.js — Remote Player Rendering + Interpolation
 *
 * Each remote player has a Three.js mesh (same placeholder geometry as the
 * local player but with a unique color tint). Positions are smoothly
 * interpolated between received network states so movement is seamless
 * even at low update rates (~20Hz).
 */

import * as THREE from 'three';

// Distinct hues for remote player tints
const PLAYER_TINTS = [
  0xff6600, 0x00ccff, 0xff00cc, 0xffff00, 0x00ff88,
  0xcc00ff, 0xff3333, 0x33ff33, 0x0066ff, 0xff9900,
];
let tintIndex = 0;

// ── Vehicle placeholder factory (same as in vehicle.js) ──────────────────────

function buildVehicleMesh(vehicleType, tint) {
  const scales = [1.0, 1.4, 1.2];
  const scale = scales[vehicleType] || 1.0;
  const group = new THREE.Group();

  const bodyGeo = new THREE.BoxGeometry(1.8 * scale, 0.7 * scale, 4.0 * scale);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: tint,
    roughness: 0.2,
    metalness: 0.7,
    envMapIntensity: 1.2,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.5 * scale;
  body.castShadow = true;
  group.add(body);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(1.5 * scale, 0.55 * scale, 2.0 * scale);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.1 });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 1.0 * scale, 0.2 * scale);
  group.add(cabin);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.35 * scale, 0.35 * scale, 0.25 * scale, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const wheelPositions = [
    [-1.0 * scale, 0, -1.3 * scale],
    [ 1.0 * scale, 0, -1.3 * scale],
    [-1.0 * scale, 0,  1.3 * scale],
    [ 1.0 * scale, 0,  1.3 * scale],
  ];
  for (const [wx, wy, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    wheel.rotation.z = Math.PI / 2;
    group.add(wheel);
  }

  // Player name label (canvas sprite)
  group.userData.tint = tint;
  return group;
}

// ── RemotePlayer class ────────────────────────────────────────────────────────

class RemotePlayer {
  constructor(scene, playerData) {
    this.id = playerData.id;
    this.vehicleType = playerData.vehicleType || 0;
    this.tint = PLAYER_TINTS[tintIndex % PLAYER_TINTS.length];
    tintIndex++;

    // Current interpolated transform
    this.position = new THREE.Vector3(
      playerData.position?.x || 0,
      playerData.position?.y || 2,
      playerData.position?.z || 0
    );
    this.rotation = new THREE.Quaternion(
      playerData.rotation?.x || 0,
      playerData.rotation?.y || 0,
      playerData.rotation?.z || 0,
      playerData.rotation?.w || 1
    );

    // Interpolation buffers: store last two received states
    this.prevState = {
      position: this.position.clone(),
      rotation: this.rotation.clone(),
      ts: performance.now(),
    };
    this.nextState = {
      position: this.position.clone(),
      rotation: this.rotation.clone(),
      ts: performance.now() + 100,
    };

    this.velocity = 0;

    // Three.js mesh
    this.mesh = buildVehicleMesh(this.vehicleType, this.tint);
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.rotation);
    scene.add(this.mesh);

    this.scene = scene;
  }

  /**
   * Receive a new network state. Store as nextState for interpolation.
   * @param {{ position, rotation, velocity, ts }} state
   */
  receiveState(state) {
    // Shift buffers
    this.prevState = { ...this.nextState };
    this.nextState = {
      position: new THREE.Vector3(
        state.position?.x ?? this.position.x,
        state.position?.y ?? this.position.y,
        state.position?.z ?? this.position.z
      ),
      rotation: new THREE.Quaternion(
        state.rotation?.x ?? 0,
        state.rotation?.y ?? 0,
        state.rotation?.z ?? 0,
        state.rotation?.w ?? 1
      ),
      ts: state.ts || performance.now(),
    };
    this.velocity = state.velocity || 0;
  }

  /**
   * Interpolate position/rotation toward nextState.
   * Called each frame from RemotePlayerManager.update().
   * @param {number} delta - seconds since last frame
   */
  update(delta) {
    const now = performance.now();
    const duration = this.nextState.ts - this.prevState.ts;
    const elapsed  = now - this.prevState.ts;

    // Clamp t to [0, 1.2] — slight extrapolation allowed
    const t = duration > 0 ? Math.min(elapsed / duration, 1.2) : 1;

    // Lerp position
    this.position.lerpVectors(this.prevState.position, this.nextState.position, t);
    // Slerp rotation
    this.rotation.slerpQuaternions(this.prevState.rotation, this.nextState.rotation, Math.min(t, 1));

    // Apply to mesh
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.rotation);
  }

  dispose() {
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

// ── RemotePlayerManager ───────────────────────────────────────────────────────

export class RemotePlayerManager {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map(); // id → RemotePlayer
  }

  addPlayer(playerData) {
    if (this.players.has(playerData.id)) return;
    const rp = new RemotePlayer(this.scene, playerData);
    this.players.set(playerData.id, rp);
  }

  removePlayer(playerId) {
    const rp = this.players.get(playerId);
    if (rp) {
      rp.dispose();
      this.players.delete(playerId);
    }
  }

  updatePlayer(stateData) {
    const rp = this.players.get(stateData.id);
    if (rp) {
      rp.receiveState(stateData);
    } else {
      // First time seeing this player — create them
      this.addPlayer({
        id: stateData.id,
        vehicleType: stateData.vehicleType || 0,
        position: stateData.position,
        rotation: stateData.rotation,
      });
    }
  }

  update(delta) {
    for (const [, rp] of this.players) {
      rp.update(delta);
    }
  }

  /** Returns array of { id, position } for minimap */
  getPositions() {
    const out = [];
    for (const [id, rp] of this.players) {
      out.push({ id, position: rp.position.clone(), tint: rp.tint });
    }
    return out;
  }

  dispose() {
    for (const [, rp] of this.players) rp.dispose();
    this.players.clear();
  }
}
