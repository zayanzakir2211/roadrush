/**
 * chunkWorker.js — Terrain Chunk Generation (Web Worker)
 *
 * Runs entirely off the main thread. Uses simplex-noise for deterministic,
 * seed-based terrain. Sends back transferable Float32Array / Uint32Array
 * buffers to avoid copying overhead.
 *
 * Chunk coordinate (cx, cz) → world origin (cx * 64, cz * 64).
 * Chunk size: 64 × 64 world units, subdivided into 32 × 32 quads.
 */


import { createNoise2D } from 'simplex-noise';

const CHUNK_SIZE = 64;
const SUBDIVISIONS = 32; // grid cells per chunk edge
const CELL_SIZE = CHUNK_SIZE / SUBDIVISIONS;

let noise2D = null;
let gameSeed = '0';
let rng = null;

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (e) => {
  const msg = e.data;

  if (msg.type === 'setSeed') {
    gameSeed = String(msg.seed);
    // Seed the PRNG and noise function from the game seed
    rng = Alea(gameSeed);
    noise2D = createNoise2D(rng);
    return;
  }

  if (msg.type === 'generateChunk') {
    if (!noise2D) {
      // Fallback: unseeded noise
      noise2D = createNoise2D();
    }
    const result = generateChunk(msg.cx, msg.cz);
    // Transfer buffers to avoid copy
    self.postMessage(result, [
      result.vertices.buffer,
      result.indices.buffer,
      result.colors.buffer,
    ]);
  }
};

// ── Noise helpers ─────────────────────────────────────────────────────────────

/** Multi-octave (fractal) noise. Returns -1..1 */
function fbm(x, z, octaves = 4, persistence = 0.5, lacunarity = 2.0, scale = 1.0) {
  let value = 0;
  let amplitude = 1;
  let frequency = scale;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += noise2D(x * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

/** Determine chunk biome type based on chunk coords */
function getChunkBiome(cx, cz) {
  // Use coarse noise to determine region type
  const biomeNoise = noise2D(cx * 0.15, cz * 0.15);
  if (biomeNoise > 0.5) return 'hills';
  if (biomeNoise > 0.1) return 'plains';
  if (biomeNoise > -0.2) return 'road';
  if (biomeNoise > -0.5) return 'ramps';
  return 'plains';
}

// ── Main chunk generation ─────────────────────────────────────────────────────

function generateChunk(cx, cz) {
  const biome = getChunkBiome(cx, cz);
  const verts = (SUBDIVISIONS + 1) * (SUBDIVISIONS + 1);
  const vertices = new Float32Array(verts * 3);
  const colors   = new Float32Array(verts * 3);

  let vi = 0;
  let ci = 0;

  for (let row = 0; row <= SUBDIVISIONS; row++) {
    for (let col = 0; col <= SUBDIVISIONS; col++) {
      const localX = col * CELL_SIZE;
      const localZ = row * CELL_SIZE;
      const worldX = cx * CHUNK_SIZE + localX;
      const worldZ = cz * CHUNK_SIZE + localZ;

      const y = getHeight(worldX, worldZ, biome);

      vertices[vi++] = localX;
      vertices[vi++] = y;
      vertices[vi++] = localZ;

      // Vertex colour based on height / biome
      const c = getVertexColor(y, biome);
      colors[ci++] = c.r;
      colors[ci++] = c.g;
      colors[ci++] = c.b;
    }
  }

  // Build index buffer (two triangles per quad)
  const quadCount = SUBDIVISIONS * SUBDIVISIONS;
  const indices = new Uint32Array(quadCount * 6);
  let ii = 0;
  const stride = SUBDIVISIONS + 1;

  for (let row = 0; row < SUBDIVISIONS; row++) {
    for (let col = 0; col < SUBDIVISIONS; col++) {
      const tl = row * stride + col;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      // Upper-left triangle
      indices[ii++] = tl; indices[ii++] = bl; indices[ii++] = tr;
      // Lower-right triangle
      indices[ii++] = tr; indices[ii++] = bl; indices[ii++] = br;
    }
  }

  // Generate scenery objects (trees, rocks, etc.)
  const objectData = generateObjects(cx, cz, biome);

  return { type: 'chunkReady', cx, cz, vertices, indices, colors, objectData };
}

// ── Height function ───────────────────────────────────────────────────────────

function getHeight(worldX, worldZ, biome) {
  switch (biome) {
    case 'hills':
      return fbm(worldX, worldZ, 4, 0.55, 2.1, 0.01) * 18 + 0.2;

    case 'road': {
      // Flat road along Z axis with gentle curve using noise
      const roadX = noise2D(worldZ * 0.005, 0) * 20; // road centerline wanders
      const distFromRoad = Math.abs(worldX - roadX);
      const roadWidth = 8;
      if (distFromRoad < roadWidth) {
        // Flat road surface with slight camber
        return 0.05 * (distFromRoad / roadWidth);
      }
      // Shoulder with gentle rise
      return Math.pow((distFromRoad - roadWidth) * 0.04, 1.5) + 0.1;
    }

    case 'ramps': {
      // Occasional ramps
      const base = fbm(worldX, worldZ, 2, 0.4, 2.0, 0.02) * 3;
      const rampFreq = 0.03;
      const rampNoise = noise2D(worldX * rampFreq, worldZ * rampFreq);
      if (rampNoise > 0.6) {
        return base + (rampNoise - 0.6) * 25; // steep ramp
      }
      return base;
    }

    case 'plains':
    default:
      return fbm(worldX, worldZ, 3, 0.45, 2.0, 0.008) * 4 + 0.1;
  }
}

// ── Vertex colour ─────────────────────────────────────────────────────────────

function getVertexColor(y, biome) {
  if (biome === 'road') {
    // Asphalt grey
    const g = 0.35 + Math.random() * 0.04;
    return { r: g, g: g, b: g };
  }
  if (y < 0.3) {
    // Dirt / sand
    return { r: 0.76, g: 0.60, b: 0.42 };
  }
  if (y < 3) {
    // Grass
    return { r: 0.25 + Math.random() * 0.05, g: 0.52 + Math.random() * 0.08, b: 0.15 };
  }
  if (y < 10) {
    // Sparse grass / rocky
    return { r: 0.38, g: 0.45, b: 0.28 };
  }
  // Rock / snow at peaks
  return { r: 0.7, g: 0.7, b: 0.72 };
}

// ── Object placement ──────────────────────────────────────────────────────────

function generateObjects(cx, cz, biome) {
  // Use chunk-specific seed for deterministic placement
  const chunkRng = Alea(`${gameSeed}-${cx}-${cz}`);

  const objects = [];
  const density = biome === 'road' ? 0.05 : biome === 'hills' ? 0.25 : 0.15;

  // Number of attempts
  const attempts = Math.floor(CHUNK_SIZE * CHUNK_SIZE * density * 0.01);

  for (let i = 0; i < attempts; i++) {
    const localX = chunkRng() * CHUNK_SIZE;
    const localZ = chunkRng() * CHUNK_SIZE;
    const worldX = cx * CHUNK_SIZE + localX;
    const worldZ = cz * CHUNK_SIZE + localZ;
    const y = getHeight(worldX, worldZ, biome);

    if (biome === 'road') {
      // Cones and barrels along road shoulders
      const type = chunkRng() > 0.5 ? 'cone' : 'barrel';
      objects.push({ type, x: localX, y, z: localZ, rotY: chunkRng() * Math.PI * 2, scale: 0.8 + chunkRng() * 0.4 });
    } else {
      // Trees (with separate trunk) and rocks
      const roll = chunkRng();
      if (roll < 0.55) {
        // Tree canopy
        objects.push({ type: 'tree', x: localX, y: y + 2, z: localZ, rotY: 0, scale: 0.8 + chunkRng() * 0.6 });
        objects.push({ type: 'trunk', x: localX, y: y + 0.75, z: localZ, rotY: 0, scale: 0.9 });
      } else {
        objects.push({ type: 'rock', x: localX, y: y + 0.2, z: localZ, rotY: chunkRng() * Math.PI * 2, scale: 0.5 + chunkRng() * 1.2 });
      }
    }
  }

  return objects;
}

// ── Alea PRNG (inline, no extra import needed) ────────────────────────────────
// Alea by Johannes Baagøe — MIT license
function Alea(seed) {
  let s0, s1, s2, c;
  function mash(data) {
    data = data.toString();
    let n = 0xefc8249d;
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  }
  s0 = mash(' ');
  s1 = mash(' ');
  s2 = mash(' ');
  c = 1;
  s0 -= mash(seed);
  if (s0 < 0) s0 += 1;
  s1 -= mash(seed);
  if (s1 < 0) s1 += 1;
  s2 -= mash(seed);
  if (s2 < 0) s2 += 1;

  return function () {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10;
    s0 = s1;
    s1 = s2;
    return (s2 = t - (c = t | 0));
  };
}
