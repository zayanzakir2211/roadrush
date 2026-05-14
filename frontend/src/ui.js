/**
 * ui.js — All UI Elements
 *
 * Fixes applied:
 *   1. Mobile controls: LEFT / RIGHT arrow buttons added alongside joystick
 *   2. Minimap: shows player labels + road outlines + north indicator
 *   3. Teleport panel: click a remote player on the minimap or list to teleport
 *   4. Teleport triggered via physicsWorker message from main.js
 */

import { QUALITY_PRESETS } from './graphics.js';

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --hud-bg: rgba(0,0,0,0.55);
  --hud-border: rgba(255,255,255,0.12);
  --accent: #ff6b35;
  --accent2: #f7c59f;
  --text: #ffffff;
  --text-dim: rgba(255,255,255,0.55);
  --radius: 10px;
  --font: 'Segoe UI', system-ui, sans-serif;
}

/* ── Main Menu ── */
#main-menu {
  position: fixed; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: linear-gradient(160deg, #0a0a1a 0%, #1a0a00 100%);
  z-index: 500; gap: 20px; padding: 24px;
}
#main-menu.hidden { display: none; }

.menu-title {
  font-size: clamp(2.5rem, 8vw, 5rem); font-weight: 900; letter-spacing: -3px;
  background: linear-gradient(135deg, #ff6b35, #f7c59f, #ff6b35);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  margin-bottom: 8px; animation: titlePulse 3s ease-in-out infinite;
}
@keyframes titlePulse { 0%,100%{ filter:brightness(1); } 50%{ filter:brightness(1.3); } }
.menu-subtitle { color: var(--text-dim); font-size: 0.95rem; margin-bottom: 16px; letter-spacing: 2px; text-transform: uppercase; }

.vehicle-selector { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
.vehicle-card {
  background: var(--hud-bg); border: 2px solid var(--hud-border);
  border-radius: var(--radius); padding: 14px 20px; cursor: pointer;
  transition: all 0.2s; min-width: 100px; text-align: center; color: var(--text);
}
.vehicle-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.vehicle-card.active { border-color: var(--accent); background: rgba(255,107,53,0.2); }
.vehicle-icon { font-size: 2rem; margin-bottom: 4px; }
.vehicle-name { font-size: 0.8rem; font-weight: 600; }
.vehicle-stats { font-size: 0.65rem; color: var(--text-dim); margin-top: 2px; }

.seed-section { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; max-width: 380px; }
.seed-row { display: flex; gap: 8px; width: 100%; }
.seed-input {
  flex: 1; background: var(--hud-bg); border: 1px solid var(--hud-border);
  border-radius: var(--radius); padding: 10px 14px; color: var(--text);
  font-size: 0.9rem; font-family: monospace; outline: none; transition: border-color 0.2s;
}
.seed-input:focus { border-color: var(--accent); }
.seed-input::placeholder { color: var(--text-dim); }

.btn {
  background: var(--hud-bg); border: 1px solid var(--hud-border); border-radius: var(--radius);
  color: var(--text); padding: 10px 16px; cursor: pointer; font-size: 0.85rem;
  transition: all 0.2s; white-space: nowrap;
}
.btn:hover { background: rgba(255,255,255,0.1); border-color: var(--accent); }
.btn-primary {
  background: linear-gradient(135deg, #ff6b35, #e85520); border-color: transparent;
  font-weight: 700; font-size: 1rem; padding: 14px 40px; border-radius: 30px; letter-spacing: 1px;
}
.btn-primary:hover { transform: scale(1.04); box-shadow: 0 4px 20px rgba(255,107,53,0.4); }
.btn-primary:active { transform: scale(0.98); }

.name-input {
  width: 100%; max-width: 380px; background: var(--hud-bg); border: 1px solid var(--hud-border);
  border-radius: var(--radius); padding: 10px 14px; color: var(--text);
  font-size: 0.9rem; outline: none; transition: border-color 0.2s;
}
.name-input:focus { border-color: var(--accent); }

/* ── HUD ── */
#hud { position: fixed; inset: 0; pointer-events: none; z-index: 100; }
#hud.hidden { display: none; }

.hud-panel {
  position: absolute; background: var(--hud-bg); border: 1px solid var(--hud-border);
  border-radius: var(--radius); backdrop-filter: blur(8px); padding: 10px 14px; color: var(--text);
}

.hud-players { top: 16px; left: 16px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; }
.hud-players .dot { width: 8px; height: 8px; border-radius: 50%; background: #4caf50; animation: blink 2s infinite; }
@keyframes blink { 0%,100%{ opacity:1; } 50%{ opacity:0.4; } }

.hud-seed { top: 16px; right: 16px; font-size: 0.75rem; pointer-events: all; cursor: default; display: flex; align-items: center; gap: 8px; }
.hud-seed .seed-val { font-family: monospace; color: var(--accent2); font-size: 0.8rem; }
.hud-seed .copy-btn {
  background: none; border: 1px solid var(--hud-border); border-radius: 6px; color: var(--text-dim);
  padding: 2px 6px; font-size: 0.65rem; cursor: pointer; pointer-events: all; transition: all 0.15s;
}
.hud-seed .copy-btn:hover { color: var(--accent); border-color: var(--accent); }

.hud-speed { bottom: 24px; right: 24px; text-align: center; min-width: 80px; }
.hud-speed .speed-val { font-size: 2.4rem; font-weight: 800; line-height: 1; color: var(--accent2); }
.hud-speed .speed-unit { font-size: 0.65rem; color: var(--text-dim); letter-spacing: 2px; }

.hud-timer { top: 16px; left: 50%; transform: translateX(-50%); font-size: 0.85rem; font-family: monospace; min-width: 80px; text-align: center; }

/* Minimap */
.hud-minimap {
  bottom: 24px; left: 24px; width: 150px; height: 150px;
  padding: 0; overflow: hidden; border-radius: var(--radius); pointer-events: all; cursor: pointer;
}
.hud-minimap canvas { display: block; width: 100%; height: 100%; }
.minimap-label { position: absolute; bottom: 28px; left: 28px; font-size: 0.6rem; color: var(--text-dim); pointer-events: none; }

.hud-settings-btn { top: 16px; right: 180px; pointer-events: all; cursor: pointer; padding: 8px 12px; font-size: 1.1rem; transition: transform 0.2s; }
.hud-settings-btn:hover { transform: rotate(45deg); }

/* Teleport panel */
#teleport-panel {
  position: fixed; bottom: 190px; left: 24px;
  background: rgba(10,10,20,0.92); border: 1px solid var(--hud-border);
  border-radius: 12px; padding: 12px; z-index: 300; min-width: 160px;
  display: none; backdrop-filter: blur(10px); pointer-events: all;
}
#teleport-panel.visible { display: block; }
.teleport-title { font-size: 0.75rem; color: var(--text-dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
.teleport-player-btn {
  display: block; width: 100%; background: var(--hud-bg); border: 1px solid var(--hud-border);
  border-radius: 8px; color: var(--text); padding: 6px 10px; font-size: 0.8rem;
  cursor: pointer; text-align: left; margin-bottom: 5px; transition: all 0.15s;
}
.teleport-player-btn:hover { border-color: var(--accent); background: rgba(255,107,53,0.15); }
.teleport-player-btn .tp-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px;
}
.teleport-no-players { font-size: 0.75rem; color: var(--text-dim); font-style: italic; }

/* ── Settings Panel ── */
#settings-panel {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  background: rgba(10,10,20,0.96); border: 1px solid var(--hud-border); border-radius: 16px;
  padding: 28px; z-index: 600; min-width: 300px; max-width: 420px; width: 90%;
  display: none; backdrop-filter: blur(12px); color: var(--text);
}
#settings-panel.visible { display: block; }
.settings-title { font-size: 1.2rem; font-weight: 700; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
.settings-close { background: none; border: none; color: var(--text-dim); font-size: 1.2rem; cursor: pointer; }
.settings-close:hover { color: var(--text); }
.settings-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.settings-label { font-size: 0.85rem; color: var(--text-dim); }
.quality-btns { display: flex; gap: 4px; }
.quality-btn {
  background: var(--hud-bg); border: 1px solid var(--hud-border); border-radius: 6px;
  color: var(--text-dim); padding: 4px 8px; font-size: 0.75rem; cursor: pointer; transition: all 0.15s;
}
.quality-btn:hover { border-color: var(--accent); color: var(--text); }
.quality-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }

/* ── Mobile Controls ── */
#mobile-controls { position: fixed; bottom: 0; left: 0; right: 0; z-index: 200; pointer-events: none; }
#mobile-controls.hidden { display: none; }

/* Left side: joystick + arrow row */
.mobile-left-cluster { position: absolute; bottom: 20px; left: 20px; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: all; }

.joystick-zone {
  width: 120px; height: 120px; background: rgba(255,255,255,0.07);
  border: 2px solid rgba(255,255,255,0.15); border-radius: 50%; touch-action: none;
}
.joystick-knob {
  position: absolute; width: 46px; height: 46px; background: rgba(255,107,53,0.7);
  border-radius: 50%; top: 50%; left: 50%; transform: translate(-50%, -50%);
  pointer-events: none; box-shadow: 0 0 12px rgba(255,107,53,0.4);
}

/* Arrow steering row */
.steer-arrows { display: flex; gap: 10px; }
.steer-btn {
  width: 56px; height: 56px; border-radius: 14px;
  border: 2px solid rgba(255,255,255,0.25); background: rgba(0,0,0,0.45);
  color: #fff; font-size: 1.5rem; display: flex; align-items: center; justify-content: center;
  cursor: pointer; user-select: none; touch-action: none; transition: background 0.1s;
}
.steer-btn.active { background: rgba(255,107,53,0.55); border-color: var(--accent); }

/* Right side: gas + brake */
.mobile-buttons {
  position: absolute; bottom: 20px; right: 20px;
  display: flex; flex-direction: column; gap: 12px; pointer-events: all;
}
.mobile-btn {
  width: 72px; height: 72px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.4);
  color: #fff; font-size: 1.1rem; font-weight: 700;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  user-select: none; touch-action: none; transition: background 0.1s;
}
.mobile-btn.gas { border-color: rgba(76,175,80,0.5); }
.mobile-btn.gas.active { background: rgba(76,175,80,0.5); }
.mobile-btn.brake { border-color: rgba(244,67,54,0.5); }
.mobile-btn.brake.active { background: rgba(244,67,54,0.5); }
`;

function injectCSS() {
  if (document.getElementById('game-ui-css')) return;
  const style = document.createElement('style');
  style.id = 'game-ui-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ── State ──────────────────────────────────────────────────────────────────────

let callbacks = {};
let currentQuality = 'medium';
let minimapCanvas = null;
let minimapCtx = null;
let _remotePlayers = [];
let _localPos = null;
let _onTeleport = null; // callback(playerId) set from main.js

// ── createUI ───────────────────────────────────────────────────────────────────

export function createUI(gameState, cbs) {
  injectCSS();
  callbacks = cbs || {};
  buildMobileControls();
}

/** Set teleport callback so main.js can teleport local vehicle */
export function setTeleportCallback(fn) {
  _onTeleport = fn;
}

// ── Main Menu ─────────────────────────────────────────────────────────────────

export function showMainMenu(gameState, { onPlay, onRandomSeed }) {
  const container = document.getElementById('main-menu');
  container.innerHTML = '';
  container.classList.remove('hidden');

  let selectedVehicle = gameState.vehicleType ?? 0;
  let seedValue = gameState.seed || '';
  let playerName = gameState.playerName || 'Driver';

  const vehicles = [
    { name: 'Sports',  icon: '🏎️',  stats: 'Fast · Agile' },
    { name: 'Truck',   icon: '🚛',  stats: 'Slow · Powerful' },
    { name: 'SUV',     icon: '🚙',  stats: 'Balanced' },
  ];

  container.innerHTML = `
    <div class="menu-title">ROADRUSH</div>
    <div class="menu-subtitle">Multiplayer Open World</div>

    <div class="vehicle-selector">
      ${vehicles.map((v, i) => `
        <div class="vehicle-card ${i === selectedVehicle ? 'active' : ''}" data-type="${i}">
          <div class="vehicle-icon">${v.icon}</div>
          <div class="vehicle-name">${v.name}</div>
          <div class="vehicle-stats">${v.stats}</div>
        </div>
      `).join('')}
    </div>

    <input class="name-input" id="player-name-input" type="text"
      placeholder="Your name" maxlength="32" value="${playerName}" />

    <div class="seed-section">
      <div class="seed-row">
        <input class="seed-input" id="seed-input" type="text"
          placeholder="Enter seed (12-16 digits) or randomize →"
          maxlength="16" value="${seedValue}" />
        <button class="btn" id="random-seed-btn">🎲 Random</button>
      </div>
    </div>

    <button class="btn btn-primary" id="play-btn">PLAY</button>
  `;

  container.querySelectorAll('.vehicle-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedVehicle = parseInt(card.dataset.type);
      container.querySelectorAll('.vehicle-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });
  });

  container.querySelector('#random-seed-btn').addEventListener('click', async () => {
    const btn = container.querySelector('#random-seed-btn');
    btn.textContent = '⌛'; btn.disabled = true;
    try {
      const seed = await onRandomSeed();
      container.querySelector('#seed-input').value = seed;
      seedValue = seed;
    } catch (_) {}
    btn.textContent = '🎲 Random'; btn.disabled = false;
  });

  container.querySelector('#play-btn').addEventListener('click', () => {
    const rawSeed = container.querySelector('#seed-input').value.trim();
    const name = container.querySelector('#player-name-input').value.trim() || 'Driver';
    seedValue = rawSeed || generateLocalSeed();
    onPlay({ seed: seedValue, vehicleType: selectedVehicle, playerName: name });
  });
}

export function hideMainMenu() {
  const container = document.getElementById('main-menu');
  if (container) container.classList.add('hidden');
}

// ── HUD ───────────────────────────────────────────────────────────────────────

let hudBuilt = false;

function buildHUD() {
  if (hudBuilt) return;
  hudBuilt = true;

  const hud = document.getElementById('hud');
  hud.innerHTML = `
    <div class="hud-panel hud-players" id="hud-players">
      <span class="dot"></span>
      <span id="player-count-val">1 player</span>
    </div>

    <div class="hud-panel hud-timer" id="hud-timer">00:00</div>

    <div class="hud-panel hud-seed" id="hud-seed">
      <span>SEED</span>
      <span class="seed-val" id="seed-display">—</span>
      <button class="copy-btn" id="copy-seed-btn">COPY</button>
    </div>

    <div class="hud-panel hud-settings-btn" id="hud-settings-btn" title="Settings">⚙️</div>

    <div class="hud-panel hud-speed" id="hud-speed">
      <div class="speed-val" id="speed-val">0</div>
      <div class="speed-unit">KM/H</div>
    </div>

    <div class="hud-panel hud-minimap" id="hud-minimap" title="Click to teleport to a player">
      <canvas id="minimap-canvas" width="150" height="150"></canvas>
    </div>
  `;

  document.getElementById('copy-seed-btn')?.addEventListener('click', () => {
    const seed = document.getElementById('seed-display')?.textContent;
    if (seed && seed !== '—') {
      navigator.clipboard?.writeText(seed).catch(() => {});
      const btn = document.getElementById('copy-seed-btn');
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = 'COPY'; }, 1500);
    }
  });

  document.getElementById('hud-settings-btn')?.addEventListener('click', () => toggleSettingsPanel());

  // Minimap click → open teleport panel
  document.getElementById('hud-minimap')?.addEventListener('click', () => toggleTeleportPanel());

  minimapCanvas = document.getElementById('minimap-canvas');
  minimapCtx = minimapCanvas?.getContext('2d');
}

export function updateHUD({ speed, playerCount, seed, time, localPosition, remotePlayers }) {
  if (!hudBuilt) buildHUD();

  const sv = document.getElementById('speed-val');
  if (sv) sv.textContent = Math.round(speed);

  const pc = document.getElementById('player-count-val');
  if (pc) pc.textContent = `${playerCount} player${playerCount !== 1 ? 's' : ''}`;

  const sd = document.getElementById('seed-display');
  if (sd && seed) sd.textContent = seed;

  const timer = document.getElementById('hud-timer');
  if (timer) {
    const mins = Math.floor(time / 60).toString().padStart(2, '0');
    const secs = Math.floor(time % 60).toString().padStart(2, '0');
    timer.textContent = `${mins}:${secs}`;
  }

  _localPos = localPosition;
  _remotePlayers = remotePlayers || [];
  drawMinimap(localPosition, remotePlayers);
}

// ── Minimap ───────────────────────────────────────────────────────────────────

const MINIMAP_SCALE = 3; // world units per pixel

function drawMinimap(localPos, remotePlayers) {
  if (!minimapCtx || !localPos) return;
  const ctx = minimapCtx;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const cx = w / 2;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = 'rgba(5,10,20,0.85)';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 20) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 20) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Road indicator lines (approximate road crossing center)
  ctx.strokeStyle = 'rgba(200,200,200,0.12)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

  // North indicator
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '9px monospace';
  ctx.fillText('N', w - 14, 14);

  // Remote players
  if (remotePlayers) {
    for (const rp of remotePlayers) {
      if (!rp.position) continue;
      const dx = (rp.position.x - localPos.x) / MINIMAP_SCALE;
      const dz = (rp.position.z - localPos.z) / MINIMAP_SCALE;
      const sx = cx + dx;
      const sy = cy + dz;
      if (sx < 4 || sx > w - 4 || sy < 4 || sy > h - 4) {
        // Off-map indicator: arrow at edge
        const angle = Math.atan2(dz, dx);
        const edgeX = cx + Math.cos(angle) * (cx - 8);
        const edgeY = cy + Math.sin(angle) * (cy - 8);
        ctx.fillStyle = '#' + (rp.tint || 0xff6600).toString(16).padStart(6, '0');
        ctx.beginPath();
        ctx.arc(edgeX, edgeY, 3, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const color = '#' + (rp.tint || 0xff6600).toString(16).padStart(6, '0');
      // Dot with glow
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      // Player name label
      if (rp.name) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '8px sans-serif';
        ctx.fillText(rp.name, sx + 7, sy + 3);
      }
    }
  }

  // Local player (white dot, center, with heading arrow)
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,107,53,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Scale bar
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(6, h - 10, 30, 2);
  ctx.font = '7px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(`${30 * MINIMAP_SCALE}m`, 38, h - 7);
}

// ── Teleport Panel ────────────────────────────────────────────────────────────

let teleportPanelVisible = false;

function toggleTeleportPanel() {
  const panel = document.getElementById('teleport-panel');
  if (!panel) { buildTeleportPanel(); return; }
  teleportPanelVisible = !teleportPanelVisible;
  rebuildTeleportList();
  panel.classList.toggle('visible', teleportPanelVisible);
}

function buildTeleportPanel() {
  let panel = document.getElementById('teleport-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'teleport-panel';
    document.body.appendChild(panel);
  }
  rebuildTeleportList();
  panel.classList.add('visible');
  teleportPanelVisible = true;
}

function rebuildTeleportList() {
  const panel = document.getElementById('teleport-panel');
  if (!panel) return;

  const players = _remotePlayers || [];
  panel.innerHTML = `<div class="teleport-title">⚡ Teleport to Player</div>`;

  if (players.length === 0) {
    panel.innerHTML += `<div class="teleport-no-players">No other players online</div>`;
    return;
  }

  for (const rp of players) {
    const color = '#' + (rp.tint || 0xff6600).toString(16).padStart(6, '0');
    const btn = document.createElement('button');
    btn.className = 'teleport-player-btn';
    btn.innerHTML = `<span class="tp-dot" style="background:${color}"></span>${rp.name || rp.id || 'Player'}`;
    btn.addEventListener('click', () => {
      if (_onTeleport && rp.position) {
        _onTeleport(rp.position);
      }
      const p = document.getElementById('teleport-panel');
      if (p) p.classList.remove('visible');
      teleportPanelVisible = false;
    });
    panel.appendChild(btn);
  }
}

// ── Settings panel ────────────────────────────────────────────────────────────

let settingsVisible = false;

export function showSettings(gameState, renderer, scene) {
  buildSettingsPanel();
  document.getElementById('settings-panel').classList.add('visible');
  settingsVisible = true;
}

function toggleSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (!panel) { buildSettingsPanel(); }
  settingsVisible = !settingsVisible;
  if (settingsVisible) {
    buildSettingsPanel();
    document.getElementById('settings-panel').classList.add('visible');
  } else {
    document.getElementById('settings-panel').classList.remove('visible');
  }
}

function buildSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  panel.innerHTML = `
    <div class="settings-title">
      Settings
      <button class="settings-close" id="settings-close-btn">✕</button>
    </div>
    <div class="settings-row">
      <span class="settings-label">Graphics Quality</span>
      <div class="quality-btns">
        ${['low','medium','high','ultra'].map(q => `
          <button class="quality-btn ${q === currentQuality ? 'active' : ''}" data-q="${q}">
            ${q.charAt(0).toUpperCase() + q.slice(1)}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="settings-row">
      <span class="settings-label">Move</span>
      <span style="font-size:0.75rem;color:var(--text-dim)">W/S or ↑/↓</span>
    </div>
    <div class="settings-row">
      <span class="settings-label">Steer</span>
      <span style="font-size:0.75rem;color:var(--text-dim)">A=Left  D=Right</span>
    </div>
    <div class="settings-row">
      <span class="settings-label">Brake / Reverse</span>
      <span style="font-size:0.75rem;color:var(--text-dim)">S brakes, then reverses</span>
    </div>
    <div class="settings-row">
      <span class="settings-label">Handbrake</span>
      <span style="font-size:0.75rem;color:var(--text-dim)">Space</span>
    </div>
    <div class="settings-row">
      <span class="settings-label">Teleport</span>
      <span style="font-size:0.75rem;color:var(--text-dim)">Click minimap</span>
    </div>
  `;

  panel.querySelector('#settings-close-btn').addEventListener('click', () => {
    panel.classList.remove('visible');
    settingsVisible = false;
  });

  panel.querySelectorAll('.quality-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentQuality = btn.dataset.q;
      panel.querySelectorAll('.quality-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (callbacks.onQuality) callbacks.onQuality(currentQuality);
    });
  });
}

// ── Mobile controls ───────────────────────────────────────────────────────────

function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
    window.matchMedia('(pointer: coarse)').matches;
}

function buildMobileControls() {
  if (!isMobile()) return;

  const container = document.getElementById('mobile-controls');
  container.innerHTML = `
    <div class="mobile-left-cluster">
      <div style="position:relative;width:120px;height:120px;">
        <div class="joystick-zone" id="joystick-zone">
          <div class="joystick-knob" id="joystick-knob"></div>
        </div>
      </div>
      <div class="steer-arrows">
        <button class="steer-btn" id="steer-left-btn">◀</button>
        <button class="steer-btn" id="steer-right-btn">▶</button>
      </div>
    </div>
    <div class="mobile-buttons">
      <button class="mobile-btn gas" id="gas-btn">GAS</button>
      <button class="mobile-btn brake" id="brake-btn">BRK</button>
    </div>
  `;

  setupJoystick();
  setupSteerArrows();
  setupMobileButtons();
}

function setupJoystick() {
  const zone = document.getElementById('joystick-zone');
  const knob = document.getElementById('joystick-knob');
  if (!zone || !knob) return;

  let active = false;
  let originX = 0, originY = 0;
  const MAX_DIST = 42;

  function onStart(e) {
    active = true;
    const touch = e.touches ? e.touches[0] : e;
    const rect = zone.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    onMove(e);
  }

  function onMove(e) {
    if (!active) return;
    const touch = e.touches ? e.touches[0] : e;
    let dx = touch.clientX - originX;
    let dy = touch.clientY - originY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > MAX_DIST) { dx = (dx / dist) * MAX_DIST; dy = (dy / dist) * MAX_DIST; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (window.__vehicleInput) window.__vehicleInput.steerAxis = dx / MAX_DIST;
  }

  function onEnd() {
    active = false;
    knob.style.transform = 'translate(-50%, -50%)';
    if (window.__vehicleInput) window.__vehicleInput.steerAxis = 0;
  }

  zone.addEventListener('touchstart', onStart, { passive: true });
  zone.addEventListener('touchmove', onMove, { passive: true });
  zone.addEventListener('touchend', onEnd);
  zone.addEventListener('touchcancel', onEnd);
}

function setupSteerArrows() {
  const leftBtn  = document.getElementById('steer-left-btn');
  const rightBtn = document.getElementById('steer-right-btn');

  function setLeft(on) {
    leftBtn?.classList.toggle('active', on);
    if (window.__vehicleInput) window.__vehicleInput.mobileLeft = on;
  }
  function setRight(on) {
    rightBtn?.classList.toggle('active', on);
    if (window.__vehicleInput) window.__vehicleInput.mobileRight = on;
  }

  leftBtn?.addEventListener('touchstart',  (e) => { e.preventDefault(); setLeft(true); },  { passive: false });
  leftBtn?.addEventListener('touchend',    () => setLeft(false));
  leftBtn?.addEventListener('touchcancel', () => setLeft(false));

  rightBtn?.addEventListener('touchstart',  (e) => { e.preventDefault(); setRight(true); }, { passive: false });
  rightBtn?.addEventListener('touchend',    () => setRight(false));
  rightBtn?.addEventListener('touchcancel', () => setRight(false));
}

function setupMobileButtons() {
  const gasBtn   = document.getElementById('gas-btn');
  const brakeBtn = document.getElementById('brake-btn');

  function setThrottle(v) {
    gasBtn?.classList.toggle('active', v !== 0);
    if (window.__vehicleInput) window.__vehicleInput.throttleAxis = v;
  }
  function setBrake(v) {
    brakeBtn?.classList.toggle('active', v);
    if (window.__vehicleInput) window.__vehicleInput.brake = v;
  }

  gasBtn?.addEventListener('touchstart',  (e) => { e.preventDefault(); setThrottle(1); },    { passive: false });
  gasBtn?.addEventListener('touchend',    () => setThrottle(0));
  gasBtn?.addEventListener('touchcancel', () => setThrottle(0));

  brakeBtn?.addEventListener('touchstart',  (e) => { e.preventDefault(); setBrake(true); },  { passive: false });
  brakeBtn?.addEventListener('touchend',    () => setBrake(false));
  brakeBtn?.addEventListener('touchcancel', () => setBrake(false));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateLocalSeed() {
  const len = 12 + Math.floor(Math.random() * 5);
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < len) s += String(Math.floor(Math.random() * 10));
  return s;
}