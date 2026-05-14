/**
 * chunkWorker.js — Terrain Chunk Generation (Web Worker)
 *
 * Improvements:
 *   - SUBDIVISIONS raised to 96 for much denser, smoother terrain (slowroads-style)
 *   - More object types: bushes, fence posts, lamp posts, road markings
 *   - Richer biome blending and height variation
 *   - Road has center line + edge markings
 *   - Grass blade variation, rock strata color
 */

import { createNoise2D } from 'simplex-noise';

const CHUNK_SIZE   = 64;
const SUBDIVISIONS = 64;          // denser terrain without heavy CPU/GPU cost
const CELL_SIZE    = CHUNK_SIZE / SUBDIVISIONS;
const PHYSICS_SUBDIVISIONS = 24;  // lower-res mesh for physics colliders
const PHYSICS_CELL_SIZE    = CHUNK_SIZE / PHYSICS_SUBDIVISIONS;

let noise2D  = null;   // fine detail / terrain
let noise2D2 = null;   // coarse biome
let noise2D3 = null;   // road network
let noise2D4 = null;   // micro detail / color variation
let gameSeed = '0';

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'setSeed') {
    gameSeed = String(msg.seed);
    const rng1 = Alea(gameSeed + '_terrain');
    const rng2 = Alea(gameSeed + '_biome');
    const rng3 = Alea(gameSeed + '_road');
    const rng4 = Alea(gameSeed + '_micro');
    noise2D  = createNoise2D(rng1);
    noise2D2 = createNoise2D(rng2);
    noise2D3 = createNoise2D(rng3);
    noise2D4 = createNoise2D(rng4);
  }
  if (msg.type === 'generateChunk') {
    if (!noise2D) {
      noise2D  = createNoise2D(Alea('default1'));
      noise2D2 = createNoise2D(Alea('default2'));
      noise2D3 = createNoise2D(Alea('default3'));
      noise2D4 = createNoise2D(Alea('default4'));
    }
    const result = generateChunk(msg.cx, msg.cz);
    self.postMessage(result, [
      result.vertices.buffer,
      result.indices.buffer,
      result.colors.buffer,
      result.physicsVertices.buffer,
      result.physicsIndices.buffer,
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

function fbmDetail(nx, nz, octaves, persistence, lacunarity, scale) {
  let v = 0, amp = 1, freq = scale, max = 0;
  for (let i = 0; i < octaves; i++) {
    v   += noise2D4(nx * freq, nz * freq) * amp;
    max += amp;
    amp  *= persistence;
    freq *= lacunarity;
  }
  return v / max;
}

// ── Road network ──────────────────────────────────────────────────────────────

const ROAD_WIDTH    = 10;   // half-width driveable
const ROAD_SHOULDER = 4;    // flat shoulder
const ROAD_TOTAL    = ROAD_WIDTH + ROAD_SHOULDER;

const PALETTE = {
  roadDark:  { r: 0.19, g: 0.20, b: 0.22 },
  roadLight: { r: 0.26, g: 0.26, b: 0.27 },
  roadLine:  { r: 0.94, g: 0.86, b: 0.66 },
  roadEdge:  { r: 0.90, g: 0.90, b: 0.90 },
  grassLow:  { r: 0.36, g: 0.58, b: 0.36 },
  grassHigh: { r: 0.25, g: 0.48, b: 0.34 },
  soil:      { r: 0.56, g: 0.50, b: 0.40 },
  sand:      { r: 0.82, g: 0.73, b: 0.55 },
  rock:      { r: 0.60, g: 0.58, b: 0.54 },
  snow:      { r: 0.92, g: 0.93, b: 0.95 },
};

function roadCenterX(worldZ) {
  return noise2D3(worldZ * 0.003, 0.0) * 40
       + noise2D3(worldZ * 0.007, 10.0) * 15;
}
function roadCenterZ(worldX) {
  return noise2D3(0.0, worldX * 0.003) * 40
       + noise2D3(10.0, worldX * 0.007) * 15;
}

function roadInfo(worldX, worldZ) {
  const distEW = Math.abs(worldX - roadCenterX(worldZ));
  const distNS = Math.abs(worldZ - roadCenterZ(worldX));
  const dist   = Math.min(distEW, distNS);
  if (dist >= ROAD_TOTAL) return { onRoad: false, blend: 1, dist };
  const blend = smoothstep(0, ROAD_TOTAL, dist);
  return { onRoad: true, blend, dist };
}

// ── Biome & height ────────────────────────────────────────────────────────────

function getBiomeWeight(worldX, worldZ) {
  const b  = noise2D2(worldX * 0.004, worldZ * 0.004);
  const b2 = noise2D2(worldX * 0.002 + 50, worldZ * 0.002 + 50);
  const b3 = noise2D2(worldX * 0.003 + 100, worldZ * 0.003 - 100);
  const plains    = smoothstep(0.0, 0.4, 1 - Math.abs(b));
  const mountains = smoothstep(0.3, 0.8, b2);
  const desert    = smoothstep(0.4, 0.9, b3) * (1 - mountains);
  const hills     = Math.max(0, 1 - plains - mountains - desert);
  const total     = plains + hills + mountains + desert || 1;
  return { plains: plains/total, hills: hills/total, mountains: mountains/total, desert: desert/total };
}

function getTerrainHeight(worldX, worldZ) {
  const w = getBiomeWeight(worldX, worldZ);

  const hPlains    = fbm(worldX, worldZ, 4, 0.45, 2.0, 0.006) * 3  + 0.2;
  const hHills     = fbm(worldX, worldZ, 5, 0.55, 2.1, 0.010) * 16 + 1.0;
  const hMountains = fbm(worldX, worldZ, 6, 0.62, 2.2, 0.015) * 48 + 5.0;
  const hDesert    = fbm(worldX, worldZ, 3, 0.40, 2.0, 0.008) * 4  + 0.1;

  // Add micro-detail ripples for richness
  const micro = fbmDetail(worldX, worldZ, 3, 0.5, 2.0, 0.04) * 0.4;

  return hPlains * w.plains + hHills * w.hills + hMountains * w.mountains + hDesert * w.desert + micro;
}

function getTerrainHeightPhysics(worldX, worldZ) {
  const w = getBiomeWeight(worldX, worldZ);

  const hPlains    = fbm(worldX, worldZ, 4, 0.45, 2.0, 0.006) * 3  + 0.2;
  const hHills     = fbm(worldX, worldZ, 5, 0.55, 2.1, 0.010) * 16 + 1.0;
  const hMountains = fbm(worldX, worldZ, 6, 0.62, 2.2, 0.015) * 48 + 5.0;
  const hDesert    = fbm(worldX, worldZ, 3, 0.40, 2.0, 0.008) * 4  + 0.1;

  // Damp micro detail for smoother physics surface
  const micro = fbmDetail(worldX, worldZ, 3, 0.5, 2.0, 0.04) * 0.1;

  return hPlains * w.plains + hHills * w.hills + hMountains * w.mountains + hDesert * w.desert + micro;
}

function getHeight(worldX, worldZ) {
  const terrain = getTerrainHeight(worldX, worldZ);
  const road    = roadInfo(worldX, worldZ);
  if (!road.onRoad) return terrain;
  const roadSurface = 0.05;
  return lerp(roadSurface, terrain, road.blend * road.blend);
}

function getHeightPhysics(worldX, worldZ) {
  const terrain = getTerrainHeightPhysics(worldX, worldZ);
  const road    = roadInfo(worldX, worldZ);
  if (!road.onRoad) return terrain;
  const roadSurface = 0.05;
  return lerp(roadSurface, terrain, road.blend * road.blend);
}

// ── Vertex colour ─────────────────────────────────────────────────────────────

function getColor(worldX, worldZ, y) {
  const road = roadInfo(worldX, worldZ);
  const w    = getBiomeWeight(worldX, worldZ);
  const micro = noise2D4(worldX * 0.25, worldZ * 0.25) * 0.03;

  if (road.onRoad && road.blend < 0.9) {
    const edgeT = smoothstep(0, ROAD_TOTAL, road.dist);
    let base = mixColor(PALETTE.roadDark, PALETTE.roadLight, edgeT);
    base = addNoise(base, micro);

    // Center dividing line: subtle warm dash
    const distEW = Math.abs(worldX - roadCenterX(worldZ));
    const distNS = Math.abs(worldZ - roadCenterZ(worldX));
    const centerDist = Math.min(distEW, distNS);
    if (centerDist < 0.55) {
      const dashOn = (Math.floor((worldX + worldZ) * 0.14) % 6) < 3;
      if (dashOn) return PALETTE.roadLine;
    }

    // Edge dashes
    if (road.dist > ROAD_WIDTH - 1.0 && road.dist < ROAD_WIDTH + 0.35) {
      const dashOn2 = (Math.floor((worldX + worldZ) * 0.12) % 4) < 2;
      if (dashOn2) return PALETTE.roadEdge;
    }

    return base;
  }

  // Terrain
  let base;
  if (w.desert > 0.55) {
    const toRock = smoothstep(6, 18, y);
    base = mixColor(PALETTE.sand, PALETTE.rock, toRock);
  } else {
    const grass = mixColor(PALETTE.grassLow, PALETTE.grassHigh, smoothstep(0.8, 6, y));
    base = mixColor(PALETTE.soil, grass, smoothstep(0.2, 1.2, y));
    base = mixColor(base, PALETTE.rock, smoothstep(8, 18, y));
  }

  base = mixColor(base, PALETTE.snow, smoothstep(22, 32, y));
  base = addNoise(base, micro * 0.8);
  return base;
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
  const physics = generatePhysicsMesh(cx, cz);
  return {
    type: 'chunkReady',
    cx,
    cz,
    vertices,
    indices,
    colors,
    objectData,
    physicsVertices: physics.vertices,
    physicsIndices: physics.indices,
  };
}

// ── Physics mesh (low-res) ───────────────────────────────────────────────────

function generatePhysicsMesh(cx, cz) {
  const stride = PHYSICS_SUBDIVISIONS + 1;
  const verts  = stride * stride;
  const vertices = new Float32Array(verts * 3);

  let vi = 0;
  for (let row = 0; row <= PHYSICS_SUBDIVISIONS; row++) {
    for (let col = 0; col <= PHYSICS_SUBDIVISIONS; col++) {
      const localX = col * PHYSICS_CELL_SIZE;
      const localZ = row * PHYSICS_CELL_SIZE;
      const worldX = cx * CHUNK_SIZE + localX;
      const worldZ = cz * CHUNK_SIZE + localZ;
      const y      = getHeightPhysics(worldX, worldZ);

      vertices[vi++] = localX;
      vertices[vi++] = y;
      vertices[vi++] = localZ;
    }
  }

  const indices = new Uint32Array(PHYSICS_SUBDIVISIONS * PHYSICS_SUBDIVISIONS * 6);
  let ii = 0;
  for (let row = 0; row < PHYSICS_SUBDIVISIONS; row++) {
    for (let col = 0; col < PHYSICS_SUBDIVISIONS; col++) {
      const tl = row * stride + col;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      indices[ii++] = tl; indices[ii++] = bl; indices[ii++] = tr;
      indices[ii++] = tr; indices[ii++] = bl; indices[ii++] = br;
    }
  }

  return { vertices, indices };
}

// ── Object placement ──────────────────────────────────────────────────────────

function generateObjects(cx, cz) {
  const chunkRng = Alea(`${gameSeed}-obj-${cx}-${cz}`);
  const objects  = [];
  const attempts = 24; // lower object count for smoother frame pacing

  for (let i = 0; i < attempts; i++) {
    const localX = chunkRng() * CHUNK_SIZE;
    const localZ = chunkRng() * CHUNK_SIZE;
    const worldX = cx * CHUNK_SIZE + localX;
    const worldZ = cz * CHUNK_SIZE + localZ;
    const road   = roadInfo(worldX, worldZ);

    if (road.onRoad && road.blend < 0.92) {
      // Road-side: lamp posts, cones, guardrail posts
      if (road.dist > ROAD_WIDTH + 0.5 && road.dist < ROAD_TOTAL - 0.5) {
        if (chunkRng() > 0.65) {
          const y = getHeight(worldX, worldZ);
          const type = chunkRng() > 0.6 ? 'lamppost' : 'cone';
          objects.push({ type, x: localX, y, z: localZ, rotY: 0, scale: 1.0 });
        }
      }
      continue;
    }

    const y = getHeight(worldX, worldZ);
    const biome = getBiomeWeight(worldX, worldZ);
    const roll = chunkRng();

    if (y > 0.5 && y < 22) {
      if (biome.desert > 0.4) {
        // Desert: cacti, rocks
        if (roll < 0.3) objects.push({ type: 'cactus', x: localX, y: y + 1.5, z: localZ, rotY: chunkRng() * Math.PI * 2, scale: 0.6 + chunkRng() * 0.8 });
        else if (roll < 0.6) objects.push({ type: 'rock', x: localX, y: y + 0.3, z: localZ, rotY: chunkRng() * Math.PI * 2, scale: 0.5 + chunkRng() * 1.5 });
      } else if (roll < 0.40) {
        // Tree cluster (cone + trunk)
        const scale = 0.6 + chunkRng() * 1.1;
        objects.push({ type: 'tree',  x: localX, y: y + 2.0 * scale, z: localZ, rotY: 0, scale });
        objects.push({ type: 'trunk', x: localX, y: y + 0.9,         z: localZ, rotY: 0, scale: scale * 0.85 });
        // Occasional second smaller tree nearby
        if (chunkRng() > 0.6) {
          const dx2 = (chunkRng() - 0.5) * 5;
          const dz2 = (chunkRng() - 0.5) * 5;
          const s2  = 0.5 + chunkRng() * 0.7;
          const x2  = localX + dx2, z2 = localZ + dz2;
          const y2  = getHeight(worldX + dx2, worldZ + dz2);
          objects.push({ type: 'tree',  x: x2, y: y2 + 2.0 * s2, z: z2, rotY: 0, scale: s2 });
          objects.push({ type: 'trunk', x: x2, y: y2 + 0.9,      z: z2, rotY: 0, scale: s2 * 0.85 });
        }
      } else if (roll < 0.60) {
        // Rock
        objects.push({ type: 'rock', x: localX, y: y + 0.3, z: localZ, rotY: chunkRng() * Math.PI * 2, scale: 0.4 + chunkRng() * 1.4 });
      } else if (roll < 0.72 && y < 5) {
        // Bush
        objects.push({ type: 'bush', x: localX, y: y + 0.5, z: localZ, rotY: chunkRng() * Math.PI * 2, scale: 0.4 + chunkRng() * 0.6 });
      }
      // else: open space
    }
  }

  // Fence posts along road shoulders (deterministic per chunk)
  const fenceRng = Alea(`${gameSeed}-fence-${cx}-${cz}`);
  for (let fi = 0; fi < 6; fi++) {
    const t    = fenceRng();
    const side = fenceRng() > 0.5 ? 1 : -1;
    const localX = t * CHUNK_SIZE;
    const localZ = fenceRng() * CHUNK_SIZE;
    const worldX = cx * CHUNK_SIZE + localX;
    const worldZ = cz * CHUNK_SIZE + localZ;
    const road   = roadInfo(worldX, worldZ);
    if (road.onRoad && road.dist > ROAD_WIDTH + 1.5 && road.dist < ROAD_TOTAL - 0.3) {
      const y = getHeight(worldX, worldZ);
      objects.push({ type: 'post', x: localX, y: y + 0.5, z: localZ, rotY: 0, scale: 0.9 });
    }
  }

  return objects;
}

function mixColor(a, b, t) {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

function addNoise(c, n) {
  return { r: c.r + n, g: c.g + n, b: c.b + n };
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