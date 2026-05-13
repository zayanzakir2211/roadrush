/**
 * world.js — Chunk Manager
 *
 * Manages which terrain chunks are loaded. Delegates actual chunk mesh
 * generation to chunkWorker.js (off main thread). Caches built meshes in
 * memory and unloads chunks outside the render distance.
 *
 * Chunk coordinate (cx, cz): world X/Z divided by CHUNK_SIZE, floored.
 * Chunk world origin: cx * CHUNK_SIZE, cz * CHUNK_SIZE.
 */

import * as THREE from 'three';
import { QUALITY_PRESETS } from './graphics.js';

export const CHUNK_SIZE = 64; // world units per chunk edge

// ── WorldManager ─────────────────────────────────────────────────────────────

export class WorldManager {
  constructor(scene) {
    this.scene = scene;
    this.seed = null;
    this.renderDistanceChunks = 4; // default; updated by quality preset

    // Map of "cx,cz" → { mesh, requested, loaded }
    this.chunks = new Map();

    // Web worker for chunk generation
    this.chunkWorker = new Worker(
      new URL('./workers/chunkWorker.js', import.meta.url),
      { type: 'module' }
    );
    this.chunkWorker.onmessage = (e) => this._onWorkerMessage(e);

    // Listen for quality preset changes
    window.addEventListener('qualityChanged', (e) => {
      const preset = QUALITY_PRESETS[e.detail.preset];
      if (preset) {
        this.renderDistanceChunks = preset.renderDistanceChunks;
        // Force chunk update on next update() call
        this._lastUpdateChunk = null;
      }
    });
  }

  /** Call once when a game session starts with a seed. */
  init(seed) {
    this.seed = seed;
    this.chunks.clear();
    // Let chunk worker know the seed
    this.chunkWorker.postMessage({ type: 'setSeed', seed });
  }

  /**
   * Called each frame. Loads chunks near the player, unloads far ones.
   * @param {THREE.Vector3} playerPos
   * @param {number} speed - km/h (used to increase lookahead at high speed)
   */
  update(playerPos, speed = 0) {
    if (!this.seed) return;

    const cx = Math.floor(playerPos.x / CHUNK_SIZE);
    const cz = Math.floor(playerPos.z / CHUNK_SIZE);
    const key = `${cx},${cz}`;

    // Only recalculate if player moved to a new chunk (or first call)
    if (key === this._lastUpdateChunk) return;
    this._lastUpdateChunk = key;

    const dist = this.renderDistanceChunks;

    // Collect desired chunk coords
    const desired = new Set();
    for (let dx = -dist; dx <= dist; dx++) {
      for (let dz = -dist; dz <= dist; dz++) {
        if (dx * dx + dz * dz <= dist * dist) {
          desired.add(`${cx + dx},${cz + dz}`);
        }
      }
    }

    // Request any new chunks
    for (const ck of desired) {
      if (!this.chunks.has(ck)) {
        const [ncx, ncz] = ck.split(',').map(Number);
        this.chunks.set(ck, { mesh: null, requested: true, loaded: false });
        this.chunkWorker.postMessage({ type: 'generateChunk', cx: ncx, cz: ncz });
      }
    }

    // Unload chunks outside render distance
    for (const [ck, chunk] of this.chunks) {
      if (!desired.has(ck)) {
        if (chunk.mesh) {
          this.scene.remove(chunk.mesh);
          this._disposeMesh(chunk.mesh);
        }
        this.chunks.delete(ck);
      }
    }
  }

  // ── Worker message handler ────────────────────────────────────────────────

  _onWorkerMessage(e) {
    const msg = e.data;

    if (msg.type === 'chunkReady') {
      const { cx, cz, vertices, indices, colors, objectData } = msg;
      const key = `${cx},${cz}`;
      const entry = this.chunks.get(key);
      if (!entry) return; // chunk was unloaded before it arrived

      // Build Three.js BufferGeometry from transferable arrays
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0.0,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      mesh.receiveShadow = true;
      mesh.castShadow = false;

      this.scene.add(mesh);
      entry.mesh = mesh;
      entry.loaded = true;

      // Add instanced objects (trees, rocks, etc.) from objectData
      if (objectData && objectData.length > 0) {
        this._placeObjects(objectData, cx, cz);
      }
    }
  }

  // ── Instanced object placement ────────────────────────────────────────────

  // Cache for instanced mesh factories
  _instancedCache = new Map();

  _placeObjects(objectData, cx, cz) {
    // objectData: [{ type, x, y, z, rotY, scale }, ...]
    // Group by type for instancing
    const groups = {};
    for (const obj of objectData) {
      if (!groups[obj.type]) groups[obj.type] = [];
      groups[obj.type].push(obj);
    }

    for (const [type, objs] of Object.entries(groups)) {
      const geo = this._getObjectGeo(type);
      const mat = this._getObjectMat(type);
      const iMesh = new THREE.InstancedMesh(geo, mat, objs.length);
      iMesh.castShadow = true;
      iMesh.receiveShadow = true;

      const dummy = new THREE.Object3D();
      objs.forEach((obj, i) => {
        dummy.position.set(
          cx * CHUNK_SIZE + obj.x,
          obj.y,
          cz * CHUNK_SIZE + obj.z
        );
        dummy.rotation.y = obj.rotY || 0;
        dummy.scale.setScalar(obj.scale || 1);
        dummy.updateMatrix();
        iMesh.setMatrixAt(i, dummy.matrix);
      });
      iMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(iMesh);

      // Track for cleanup when chunk unloads
      const key = `${cx},${cz}`;
      const entry = this.chunks.get(key);
      if (entry) {
        entry.instancedMeshes = entry.instancedMeshes || [];
        entry.instancedMeshes.push(iMesh);
      }
    }
  }

  _getObjectGeo(type) {
    if (!this._geoCache) this._geoCache = {};
    if (this._geoCache[type]) return this._geoCache[type];

    let geo;
    switch (type) {
      case 'tree':
        geo = new THREE.ConeGeometry(1.2, 4, 7);
        break;
      case 'trunk':
        geo = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 6);
        break;
      case 'rock':
        geo = new THREE.DodecahedronGeometry(0.8);
        break;
      case 'barrel':
        geo = new THREE.CylinderGeometry(0.4, 0.4, 1.0, 10);
        break;
      case 'cone':
        geo = new THREE.ConeGeometry(0.3, 0.8, 8);
        break;
      default:
        geo = new THREE.BoxGeometry(1, 1, 1);
    }
    this._geoCache[type] = geo;
    return geo;
  }

  _getObjectMat(type) {
    if (!this._matCache) this._matCache = {};
    if (this._matCache[type]) return this._matCache[type];

    const colors = {
      tree: 0x2d6a2d,
      trunk: 0x6b4423,
      rock: 0x888888,
      barrel: 0x885522,
      cone: 0xff6600,
    };
    const mat = new THREE.MeshStandardMaterial({
      color: colors[type] ?? 0xaaaaaa,
      roughness: 0.8,
    });
    this._matCache[type] = mat;
    return mat;
  }

  // ── Disposal helpers ──────────────────────────────────────────────────────

  _disposeMesh(mesh) {
    if (!mesh) return;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material?.dispose();

    if (mesh.userData?.instancedMeshes) {
      for (const im of mesh.userData.instancedMeshes) {
        im.geometry?.dispose();
        im.material?.dispose();
        this.scene.remove(im);
      }
    }
  }

  dispose() {
    for (const [, chunk] of this.chunks) {
      if (chunk.mesh) {
        this.scene.remove(chunk.mesh);
        this._disposeMesh(chunk.mesh);
      }
      if (chunk.instancedMeshes) {
        for (const im of chunk.instancedMeshes) {
          this.scene.remove(im);
          im.geometry?.dispose();
          im.material?.dispose();
        }
      }
    }
    this.chunks.clear();
    this.chunkWorker.terminate();
  }
}
