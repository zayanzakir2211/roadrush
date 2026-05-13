/**
 * chunkWorker.js — Terrain Chunk Generation (Web Worker)
 *
 * Complete rewrite:
 * - Continuous road network using global noise-based spline (no chunk seams)
 * - Smooth multi-biome terrain (plains, hills, mountains) blended by distance
 * - Proper vertex colors: road asphalt, grass, dirt, rock, snow
 * - Deterministic object placement per chunk
 */

import { createNoise2D } from 'simplex-noise';

const CHUNK_SIZE  = 64;
const SUBDIVISIONS = 48;          // higher = smoother terrain
const CELL_SIZE   = CHUNK_SIZE / SUBDIVISIONS;

let noise2D  = null;   // fine detail
let noise2D2 = null;   // coarse biome
let noise2D3 = null;   // road network
let gameSeed = '0';

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'setSeed') {
    gameSeed = String(msg.seed);
    const rng1 = Alea(gameSeed + '_terrain');
    const rng2 = Alea(gameSeed + '_biome');
    const rng3 = Alea(gameSeed + '_road');
    noise2D  = createNoise2D(rng1);
    noise2D2 = createNoise2D(rng2);
    noise2D3 = createNoise2D(rng3);
  }
  if (msg.type === 'generateChunk') {
    if (!noise2D) {
      const r = Alea('default');
      noise2D  = createNoise2D(r);
      noise2D2 = createNoise2D(Alea('default2'));
      noise2D3 = createNoise2D(Alea('default3'));
    }
    const result = generateChunk(msg.cx, msg.cz);
    self.postMessage(result, [
      result.vertices.buffer,
      result.indices.buffer,
      result.colors.buffer,
    ]);
  }
};

// ── Noise helpers ─────────────────────────────────────────────────────────────

function fbm(nx, nz, octaves, persistence, lacunarity, scale) {
  let v = 0, amp = 1, freq = scale, max = 0;
  for (let i = 0; i < octaves; i++) {
    v   += noise2D(nx * freq, nz * freq) * amp;
    max += amp;
    amp  *= persistence;
    freq *= lacunarity;
  }
  return v / max;
}

// ── Road network ──────────────────────────────────────────────────────────────
// Two global roads: one running roughly E-W, one N-S, both gently curving.
// Road center is a function of world coords only → perfectly continuous.

const ROAD_WIDTH      = 10;   // half-width of driveable surface
const ROAD_SHOULDER   = 5;    // extra flat shoulder each side
const ROAD_TOTAL      = ROAD_WIDTH + ROAD_SHOULDER;

function roadCenterX(worldZ) {
  // East-West road: center X wanders slowly with Z
  return noise2D3(worldZ * 0.003, 0.0) * 40
       + noise2D3(worldZ * 0.007, 10.0) * 15;
}

function roadCenterZ(worldX) {
  // North-South road: center Z wanders slowly with X
  return noise2D3(0.0, worldX * 0.003) * 40
       + noise2D3(10.0, worldX * 0.007) * 15;
}

/**
 * Returns { onRoad, blend, roadY } for a world point.
 * blend = 0 at road center, 1 at road edge (smooth step)
 */
function roadInfo(worldX, worldZ) {
  const distEW = Math.abs(worldX - roadCenterX(worldZ));
  const distNS = Math.abs(worldZ - roadCenterZ(worldX));
  const dist   = Math.min(distEW, distNS);          // take closest road

  if (dist >= ROAD_TOTAL) return { onRoad: false, blend: 1, roadY: 0 };

  const blend = smoothstep(0, ROAD_TOTAL, dist);    // 0=center 1=edge
  return { onRoad: true, blend, roadY: 0 };
}

// ── Biome & height ────────────────────────────────────────────────────────────

function getBiomeWeight(worldX, worldZ) {
  // Returns { plains, hills, mountains } weights summing to 1
  const b = noise2D2(worldX * 0.004, worldZ * 0.004);  // -1..1
  const b2 = noise2D2(worldX * 0.002 + 50, worldZ * 0.002 + 50);
  const plains    = smoothstep( 0.0,  0.4, 1 - Math.abs(b));
  const mountains = smoothstep( 0.3,  0.8, b2);
  const hills     = Math.max(0, 1 - plains - mountains);
  const total     = plains + hills + mountains || 1;
  return { plains: plains/total, hills: hills/total, mountains: mountains/total };
}

function getTerrainHeight(worldX, worldZ) {
  const w = getBiomeWeight(worldX, worldZ);

  const hPlains    = fbm(worldX, worldZ, 3, 0.45, 2.0, 0.006) * 3 + 0.2;
  const hHills     = fbm(worldX, worldZ, 4, 0.55, 2.1, 0.010) * 14 + 1.0;
  const hMountains = fbm(worldX, worldZ, 5, 0.60, 2.2, 0.015) * 40 + 5.0;

  return hPlains * w.plains + hHills * w.hills + hMountains * w.mountains;
}

function getHeight(worldX, worldZ) {
  const terrain = getTerrainHeight(worldX, worldZ);
  const road    = roadInfo(worldX, worldZ);

  if (!road.onRoad) return terrain;

  // Blend road flat surface into terrain using smoothstep
  const roadSurface = 0.05; // flat road at y≈0
  return lerp(roadSurface, terrain, road.blend * road.blend);
}

// ── Vertex colour ─────────────────────────────────────────────────────────────

function getColor(worldX, worldZ, y) {
  const road = roadInfo(worldX, worldZ);
  const w    = getBiomeWeight(worldX, worldZ);

  if (road.onRoad && road.blend < 0.85) {
    // Road surface: asphalt with slight noise
    const n = noise2D(worldX * 0.5, worldZ * 0.5) * 0.03;
    const v = 0.22 + n + (road.blend > 0.7 ? 0.12 : 0); // lighter shoulder
    // White dashed line in center
    const distEW = Math.abs(worldX - roadCenterX(worldZ));
    const distNS = Math.abs(worldZ - roadCenterZ(worldX));
    const onCenter = Math.min(distEW, distNS) < 0.6;
    const dashOn   = (Math.floor(worldX * 0.1 + worldZ * 0.1) % 4) < 2;
    if (onCenter && dashOn) return { r: 0.95, g: 0.92, b: 0.5 }; // yellow line
    return { r: v, g: v, b: v };
  }

  // Terrain color by height + biome blend
  if (y < 0.4) return { r: 0.72, g: 0.58, b: 0.38 };  // dirt/sand
  if (y < 1.5) {
    // grass - slight variation
    const n = noise2D(worldX * 0.3, worldZ * 0.3) * 0.06;
    return { r: 0.22 + n, g: 0.52 + n, b: 0.14 };
  }
  if (y < 8)  return { r: 0.28 + w.mountains*0.1, g: 0.44, b: 0.20 }; // mid grass
  if (y < 18) return { r: 0.45, g: 0.40, b: 0.32 }; // rock
  if (y < 30) return { r: 0.55, g: 0.52, b: 0.50 }; // grey rock
  return { r: 0.90, g: 0.92, b: 0.95 };              // snow
}

// ── Main chunk generation ─────────────────────────────────────────────────────

function generateChunk(cx, cz) {
  const stride = SUBDIVISIONS + 1;
  const verts  = stride * stride;
  const vertices = new Float32Array(verts * 3);
  const colors   = new Float32Array(verts * 3);

  let vi = 0, ci = 0;

  for (let row = 0; row <= SUBDIVISIONS; row++) {
    for (let col = 0; col <= SUBDIVISIONS; col++) {
      const localX = col * CELL_SIZE;
      const localZ = row * CELL_SIZE;
      const worldX = cx * CHUNK_SIZE + localX;
      const worldZ = cz * CHUNK_SIZE + localZ;
      const y      = getHeight(worldX, worldZ);

      vertices[vi++] = localX;
      vertices[vi++] = y;
      vertices[vi++] = localZ;

      const c = getColor(worldX, worldZ, y);
      colors[ci++] = c.r;
      colors[ci++] = c.g;
      colors[ci++] = c.b;
    }
  }

  // Index buffer
  const indices = new Uint32Array(SUBDIVISIONS * SUBDIVISIONS * 6);
  let ii = 0;
  for (let row = 0; row < SUBDIVISIONS; row++) {
    for (let col = 0; col < SUBDIVISIONS; col++) {
      const tl = row * stride + col;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      indices[ii++] = tl; indices[ii++] = bl; indices[ii++] = tr;
      indices[ii++] = tr; indices[ii++] = bl; indices[ii++] = br;
    }
  }

  const objectData = generateObjects(cx, cz);
  return { type: 'chunkReady', cx, cz, vertices, indices, colors, objectData };
}

// ── Object placement ──────────────────────────────────────────────────────────

function generateObjects(cx, cz) {
  const chunkRng = Alea(`${gameSeed}-obj-${cx}-${cz}`);
  const objects  = [];
  const attempts = 18;

  for (let i = 0; i < attempts; i++) {
    const localX = chunkRng() * CHUNK_SIZE;
    const localZ = chunkRng() * CHUNK_SIZE;
    const worldX = cx * CHUNK_SIZE + localX;
    const worldZ = cz * CHUNK_SIZE + localZ;
    const road   = roadInfo(worldX, worldZ);

    // Don't place anything on the driveable road surface
    if (road.onRoad && road.blend < 0.9) {
      // Place road cones/barriers only on shoulder edges
      if (road.blend > 0.7 && chunkRng() > 0.75) {
        const y = getHeight(worldX, worldZ);
        objects.push({ type: 'cone', x: localX, y, z: localZ, rotY: chunkRng() * Math.PI * 2, scale: 0.9 });
      }
      continue;
    }

    const y = getHeight(worldX, worldZ);
    const roll = chunkRng();

    if (y > 0.5 && y < 20) {
      if (roll < 0.5) {
        // Tree with trunk
        const scale = 0.7 + chunkRng() * 0.9;
        objects.push({ type: 'tree',  x: localX, y: y + 2.0 * scale, z: localZ, rotY: 0, scale });
        objects.push({ type: 'trunk', x: localX, y: y + 0.75, z: localZ, rotY: 0, scale: scale * 0.9 });
      } else if (roll < 0.75) {
        // Rock
        objects.push({ type: 'rock', x: localX, y: y + 0.3, z: localZ, rotY: chunkRng() * Math.PI * 2, scale: 0.4 + chunkRng() * 1.2 });
      }
      // else: open space
    }
  }

  return objects;
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ── Alea PRNG ─────────────────────────────────────────────────────────────────

function Alea(seed) {
  let s0, s1, s2, c;
  function mash(data) {
    data = data.toString();
    let n = 0xefc8249d;
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0; h -= n; h *= n; n = h >>> 0; h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  }
  s0 = mash(' '); s1 = mash(' '); s2 = mash(' '); c = 1;
  s0 -= mash(seed); if (s0 < 0) s0 += 1;
  s1 -= mash(seed); if (s1 < 0) s1 += 1;
  s2 -= mash(seed); if (s2 < 0) s2 += 1;
  return function () {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10;
    s0 = s1; s1 = s2;
    return (s2 = t - (c = t | 0));
  };
}