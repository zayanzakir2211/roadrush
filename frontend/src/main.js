/**
 * main.js — Game Entry Point
 *
 * Boot sequence:
 *   1. Show loading screen
 *   2. Detect device / GPU tier
 *   3. Set up Three.js renderer (graphics.js)
 *   4. Launch physics worker (physicsWorker.js)
 *   5. Launch chunk worker (chunkWorker.js)
 *   6. Show main menu (ui.js)
 *   7. On Play → join session, connect WebSocket (network.js)
 *   8. Spawn local vehicle (vehicle.js) and start game loop
 */

import * as THREE from 'three';
import { setupRenderer, setQualityPreset, detectGPUTier } from './graphics.js';
import { createUI, showMainMenu, hideMainMenu, updateHUD, showSettings, setTeleportCallback } from './ui.js';
import { SeedManager } from './seed.js';
import { NetworkManager } from './network.js';
import { LocalVehicle } from './vehicle.js';
import { RemotePlayerManager } from './remotePlayer.js';
import { WorldManager } from './world.js';
import { AudioManager } from './audio.js';

// ── Progress reporter used during init ──────────────────────────────────────

function setLoadingProgress(pct, status) {
  const bar = document.getElementById('loading-bar');
  const txt = document.getElementById('loading-status');
  if (bar) bar.style.width = `${pct}%`;
  if (txt) txt.textContent = status;
}

function hideLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (el) {
    el.style.transition = 'opacity 0.5s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 600);
  }
}

// ── Game state ──────────────────────────────────────────────────────────────

const gameState = {
  running: false,
  paused: false,
  seed: null,
  vehicleType: 0,
  playerName: 'Driver',
  localPlayerId: null,
  playerCount: 1,
  score: 0,
  startTime: 0,
};

let renderer, scene, camera;
let worldManager, localVehicle, remotePlayerManager, networkManager, audioManager;
let clock;
let physicsWorker = null;
// Latest physics state received from worker
let physicsState = null;

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  setLoadingProgress(5, 'Detecting GPU…');

  // Step 1: Renderer + scene
  const { renderer: r, scene: s, camera: c } = setupRenderer();
  renderer = r; scene = s; camera = c;
  clock = new THREE.Clock();

  setLoadingProgress(15, 'Detecting GPU tier…');
  const gpuTier = detectGPUTier(renderer);
  const preset = gpuTier >= 3 ? 'high' : gpuTier === 2 ? 'medium' : 'low';
  setQualityPreset(preset, renderer, scene);

  setLoadingProgress(25, 'Building UI…');
  createUI(gameState, {
    onPlay: startGame,
    onSettings: () => showSettings(gameState, renderer, scene),
    onQuality: (p) => setQualityPreset(p, renderer, scene),
  });

  setLoadingProgress(35, 'Launching physics worker…');
  physicsWorker = new Worker(new URL('./workers/physicsWorker.js', import.meta.url), {
    type: 'module',
  });
  physicsWorker.onmessage = onPhysicsMessage;
  physicsWorker.postMessage({ type: 'init' });

  setLoadingProgress(55, 'Starting world generator…');
  worldManager = new WorldManager(scene);

  setLoadingProgress(70, 'Setting up audio…');
  audioManager = new AudioManager(camera);

  setLoadingProgress(85, 'Setting up remote players…');
  remotePlayerManager = new RemotePlayerManager(scene);

  setLoadingProgress(100, 'Ready!');
  setTimeout(() => {
    hideLoadingScreen();
    showMainMenu(gameState, {
      onPlay: startGame,
      onRandomSeed: fetchRandomSeed,
    });
  }, 300);
}

// ── Fetch random seed from backend ──────────────────────────────────────────

async function fetchRandomSeed() {
  try {
   const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://roadrush.zayanzakir.workers.dev';
    const res = await fetch(`${workerUrl}/seed/random`);
    const data = await res.json();
    return data.seed;
  } catch {
    // Fallback: generate locally
    const len = 12 + Math.floor(Math.random() * 5);
    let s = String(1 + Math.floor(Math.random() * 9));
    while (s.length < len) s += String(Math.floor(Math.random() * 10));
    return s;
  }
}

// ── Start game ───────────────────────────────────────────────────────────────

async function startGame({ seed, vehicleType, playerName }) {
  gameState.seed = seed;
  gameState.vehicleType = vehicleType;
  gameState.playerName = playerName || 'Driver';
  gameState.running = true;
  gameState.startTime = Date.now();
  gameState.score = 0;

  hideMainMenu();

  // Wire physics worker into world manager so terrain collision works
  worldManager.setPhysicsWorker(physicsWorker);

  // Set teleport callback for ui.js minimap teleport
  setTeleportCallback((targetPosition) => {
    physicsWorker.postMessage({ type: 'teleport', position: targetPosition });
  });

  // Start world generation with this seed
  worldManager.init(seed);

  // Create local vehicle
  localVehicle = new LocalVehicle(scene, vehicleType, physicsWorker);
  await localVehicle.load();

  // Connect to backend WebSocket
  const workerUrl = import.meta.env.VITE_WORKER_URL || 'https://roadrush.zayanzakir.workers.dev';
  networkManager = new NetworkManager(workerUrl, seed, vehicleType);
  networkManager.onPlayerJoined = (playerData) => {
    remotePlayerManager.addPlayer(playerData);
    gameState.playerCount = networkManager.playerCount;
  };
  networkManager.onPlayerLeft = (playerId) => {
    remotePlayerManager.removePlayer(playerId);
    gameState.playerCount = networkManager.playerCount;
  };
  networkManager.onPlayerState = (stateData) => {
    remotePlayerManager.updatePlayer(stateData);
  };
  networkManager.onInit = (initData) => {
    gameState.localPlayerId = initData.playerId;
    gameState.playerCount = initData.playerCount;
    // Add any players already in the room
    for (const p of initData.players || []) {
      remotePlayerManager.addPlayer(p);
    }
  };
  networkManager.connect();

  // Tell physics worker the seed (for deterministic world)
  physicsWorker.postMessage({ type: 'setSeed', seed });

  // Start audio
  audioManager.start();

  // Kick off the main game loop
  requestAnimationFrame(gameLoop);
}

// ── Physics worker messages ──────────────────────────────────────────────────

function onPhysicsMessage(e) {
  const msg = e.data;
  if (msg.type === 'state') {
    // Store latest physics state; applied in game loop
    physicsState = msg;
  }
}

// ── Main game loop ────────────────────────────────────────────────────────────

let lastNetworkSend = 0;
const NETWORK_SEND_INTERVAL = 50; // ms

function gameLoop(timestamp) {
  if (!gameState.running) return;

  const delta = Math.min(clock.getDelta(), 0.1); // cap delta at 100ms

  // Apply physics state to local vehicle
  if (physicsState && localVehicle) {
    localVehicle.applyPhysicsState(physicsState);
  }

  // Update local vehicle (input handling)
  if (localVehicle) {
    localVehicle.update(delta);

    // Send state to server at 20Hz
    if (timestamp - lastNetworkSend >= NETWORK_SEND_INTERVAL) {
      if (networkManager && networkManager.connected) {
        networkManager.sendState(localVehicle.getNetworkState());
      }
      lastNetworkSend = timestamp;
    }
  }

  // Update remote player interpolation
  remotePlayerManager.update(delta);

  // Update world (chunk loading/unloading)
  if (localVehicle) {
    worldManager.update(localVehicle.getPosition(), localVehicle.getSpeed());
  }

  // Update camera to follow vehicle
  if (localVehicle) {
    updateCamera(localVehicle, delta);
  }

  // Update HUD
  const elapsed = gameState.running ? (Date.now() - gameState.startTime) / 1000 : 0;
  updateHUD({
    speed: localVehicle ? Math.abs(localVehicle.getSpeed()) : 0,
    playerCount: gameState.playerCount,
    seed: gameState.seed,
    time: elapsed,
    localPosition: localVehicle ? localVehicle.getPosition() : null,
    remotePlayers: remotePlayerManager.getPositions(gameState.playerName),
  });

  // Update audio
  audioManager.update(localVehicle ? localVehicle.getSpeed() : 0, delta);

  // Render frame
  renderer.render(scene, camera);

  requestAnimationFrame(gameLoop);
}

// ── Camera follow ─────────────────────────────────────────────────────────────

const cameraOffset = new THREE.Vector3(0, 4, -10);
const cameraTarget = new THREE.Vector3();
const smoothedCamPos = new THREE.Vector3();

function updateCamera(vehicle, delta) {
  const vPos = vehicle.getPosition();
  const vQuat = vehicle.getRotation();

  // Offset behind the vehicle in vehicle-local space
  const offset = cameraOffset.clone().applyQuaternion(vQuat);
  const desiredPos = vPos.clone().add(offset);

  // Smooth camera position (lerp)
  const lerpFactor = 1 - Math.pow(0.01, delta);
  smoothedCamPos.lerp(desiredPos, lerpFactor);
  camera.position.copy(smoothedCamPos);

  // Look at a point slightly above the vehicle
  cameraTarget.copy(vPos).add(new THREE.Vector3(0, 1.5, 0));
  camera.lookAt(cameraTarget);
}

// ── Handle window resize ──────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  if (!renderer || !camera) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// ── Start ─────────────────────────────────────────────────────────────────────

boot().catch((err) => {
  console.error('Boot failed:', err);
  const status = document.getElementById('loading-status');
  if (status) status.textContent = 'Error: ' + err.message;
});