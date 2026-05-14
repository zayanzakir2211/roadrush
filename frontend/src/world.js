/**
 * world.js — Chunk Manager
 *
 * Fixes:
 *   1. Sends trimesh collision data to physicsWorker so terrain is solid
 *   2. Tracks physicsWorker reference set from main.js
 *   3. New object geometries: bush, cactus, lamppost, post
 *   4. Instanced mesh cleanup properly removes from scene
 */

import * as THREE from 'three';
import { QUALITY_PRESETS } from './graphics.js';

export const CHUNK_SIZE = 64;

export class WorldManager {
  constructor(scene) {
    this.scene = scene;
    this.seed = null;
    this.renderDistanceChunks = 5;
    this.physicsWorker = null; // set via setPhysicsWorker()

    this.chunks = new Map();

    this.chunkWorker = new Worker(
      new URL('./workers/chunkWorker.js', import.meta.url),
      { type: 'module' }
    );
    this.chunkWorker.onmessage = (e) => this._onWorkerMessage(e);

    window.addEventListener('qualityChanged', (e) => {
      const preset = QUALITY_PRESETS[e.detail.preset];
      if (preset) {
        this.renderDistanceChunks = preset.renderDistanceChunks;
        this._lastUpdateChunk = null;
      }
    });
  }

  /** Set the physics worker reference so terrain can be made solid */
  setPhysicsWorker(worker) {
    this.physicsWorker = worker;
  }

  init(seed) {
    this.seed = seed;
    this.chunks.clear();
    if (this.physicsWorker) {
      this.physicsWorker.postMessage({ type: 'clearTerrain' });
    }
    this.chunkWorker.postMessage({ type: 'setSeed', seed });
  }

  update(playerPos, speed = 0) {
    if (!this.seed) return;

    const cx = Math.floor(playerPos.x / CHUNK_SIZE);
    const cz = Math.floor(playerPos.z / CHUNK_SIZE);
    const key = `${cx},${cz}`;

    if (key === this._lastUpdateChunk) return;
    this._lastUpdateChunk = key;

    const dist = this.renderDistanceChunks;
    const desired = new Set();
    for (let dx = -dist; dx <= dist; dx++) {
      for (let dz = -dist; dz <= dist; dz++) {
        if (dx * dx + dz * dz <= dist * dist) {
          desired.add(`${cx + dx},${cz + dz}`);
        }
      }
    }

    for (const ck of desired) {
      if (!this.chunks.has(ck)) {
        const [ncx, ncz] = ck.split(',').map(Number);
        this.chunks.set(ck, { mesh: null, requested: true, loaded: false, instancedMeshes: [] });
        this.chunkWorker.postMessage({ type: 'generateChunk', cx: ncx, cz: ncz });
      }
    }

    for (const [ck, chunk] of this.chunks) {
      if (!desired.has(ck)) {
        const [rcx, rcz] = ck.split(',').map(Number);
        if (this.physicsWorker) {
          this.physicsWorker.postMessage({ type: 'removeTrimesh', cx: rcx, cz: rcz });
        }
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
        this.chunks.delete(ck);
      }
    }
  }

  // ── Worker message handler ────────────────────────────────────────────────

  _onWorkerMessage(e) {
    const msg = e.data;

    if (msg.type === 'chunkReady') {
      const { cx, cz, vertices, indices, colors, objectData, physicsVertices, physicsIndices } = msg;
      const key = `${cx},${cz}`;
      const entry = this.chunks.get(key);
      if (!entry) return;

      // Build Three.js mesh
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0.0,
        envMapIntensity: 0.25,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.scene.add(mesh);

      entry.mesh = mesh;
      entry.loaded = true;

      // ── Send trimesh to physics worker for solid collision ────────────────
      if (this.physicsWorker) {
        let vData = physicsVertices;
        let iData = physicsIndices;
        let transfer = [];

        if (vData && iData) {
          transfer = [vData.buffer, iData.buffer];
        } else {
          // Fallback if physics mesh is not provided
          vData = new Float32Array(vertices);
          iData = new Uint32Array(indices);
          transfer = [vData.buffer, iData.buffer];
        }

        this.physicsWorker.postMessage({
          type: 'addTrimesh',
          vertices: vData,
          indices: iData,
          cx,
          cz,
          offsetX: cx * CHUNK_SIZE,
          offsetZ: cz * CHUNK_SIZE,
        }, transfer);
      }

      if (objectData && objectData.length > 0) {
        this._placeObjects(objectData, cx, cz, entry);
      }
    }
  }

  // ── Object placement ──────────────────────────────────────────────────────

  _placeObjects(objectData, cx, cz, entry) {
    const groups = {};
    for (const obj of objectData) {
      if (!groups[obj.type]) groups[obj.type] = [];
      groups[obj.type].push(obj);
    }

    for (const [type, objs] of Object.entries(groups)) {
      const geo  = this._getObjectGeo(type);
      const mat  = this._getObjectMat(type);
      const iMesh = new THREE.InstancedMesh(geo, mat, objs.length);
      iMesh.castShadow    = true;
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
      entry.instancedMeshes.push(iMesh);
    }
  }

  _getObjectGeo(type) {
    if (!this._geoCache) this._geoCache = {};
    if (this._geoCache[type]) return this._geoCache[type];

    let geo;
    switch (type) {
      case 'tree':
        geo = new THREE.ConeGeometry(1.3, 4.5, 8);
        break;
      case 'trunk':
        geo = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 7);
        break;
      case 'rock':
        geo = new THREE.DodecahedronGeometry(0.9, 0);
        break;
      case 'bush': {
        // Icosahedron looks like a bush blob
        geo = new THREE.IcosahedronGeometry(0.8, 1);
        break;
      }
      case 'cactus': {
        // Simple cylinder with smaller arms
        geo = new THREE.CylinderGeometry(0.18, 0.22, 2.2, 8);
        break;
      }
      case 'lamppost': {
        geo = new THREE.CylinderGeometry(0.06, 0.09, 4.0, 6);
        break;
      }
      case 'post': {
        geo = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 5);
        break;
      }
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
      tree:     0x2d6a2d,
      trunk:    0x6b4423,
      rock:     0x7a7a72,
      bush:     0x3a7a25,
      cactus:   0x2d7a3a,
      lamppost: 0x555555,
      post:     0x8a6633,
      cone:     0xff6200,
    };

    const roughness = {
      tree:     0.9,
      trunk:    0.95,
      rock:     0.85,
      bush:     0.92,
      cactus:   0.85,
      lamppost: 0.4,
      post:     0.8,
      cone:     0.6,
    };

    const mat = new THREE.MeshStandardMaterial({
      color: colors[type] ?? 0xaaaaaa,
      roughness: roughness[type] ?? 0.8,
      metalness: type === 'lamppost' ? 0.5 : 0.0,
    });
    this._matCache[type] = mat;
    return mat;
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  _disposeMesh(mesh) {
    if (!mesh) return;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material?.dispose();
  }

  dispose() {
    for (const [, chunk] of this.chunks) {
      if (chunk.mesh) { this.scene.remove(chunk.mesh); this._disposeMesh(chunk.mesh); }
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