/**
 * network.js — WebSocket Connection + Player State Sync
 *
 * Connects to the backend WebSocket room for a given seed.
 * Sends local vehicle state at ~20Hz.
 * Receives remote player states and fires callbacks.
 */

export class NetworkManager {
  /**
   * @param {string} workerUrl - Base URL of the Cloudflare Worker
   * @param {string} seed - Game seed (determines which room to join)
   * @param {number} vehicleType - 0=Sports, 1=Truck, 2=SUV
   */
  constructor(workerUrl, seed, vehicleType) {
    this.workerUrl = workerUrl || '';
    this.seed = seed;
    this.vehicleType = vehicleType;

    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.pingInterval = null;

    // Player tracking
    this.playerCount = 1;
    this.remotePlayers = new Map(); // id → last state

    // Callbacks set by main.js
    this.onInit = null;
    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onPlayerState = null;
    this.onConnected = null;
    this.onDisconnected = null;
  }

  /** Build WebSocket URL from worker URL and seed */
  _buildWsUrl() {
    let base = this.workerUrl;
    // Convert http(s) → ws(s)
    base = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    // Remove trailing slash
    base = base.replace(/\/$/, '');
    return `${base}/ws/${this.seed}`;
  }

  /** Connect to the WebSocket room */
  connect() {
    if (this.ws && this.ws.readyState <= 1) {
      return; // already connecting or open
    }

    const wsUrl = this._buildWsUrl();
    console.log('[Network] Connecting to', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.warn('[Network] WebSocket construction failed:', err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[Network] Connected');
      this.connected = true;
      this.reconnectAttempts = 0;
      this._startPing();
      if (this.onConnected) this.onConnected();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleMessage(data);
      } catch (err) {
        console.warn('[Network] Invalid message:', err.message);
      }
    };

    this.ws.onclose = () => {
      console.log('[Network] Disconnected');
      this.connected = false;
      this._stopPing();
      if (this.onDisconnected) this.onDisconnected();
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('[Network] WebSocket error:', err.message || err);
    };
  }

  /** Disconnect and stop reconnect attempts */
  disconnect() {
    this.maxReconnectAttempts = 0; // prevent reconnect
    this._stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  // ── Message handling ──────────────────────────────────────────────────────

  _handleMessage(data) {
    switch (data.type) {
      case 'init':
        // Received on join: own player ID + list of existing players
        this.playerCount = data.playerCount || 1;
        if (this.onInit) this.onInit(data);
        break;

      case 'player_joined':
        this.playerCount = data.playerCount || this.playerCount + 1;
        if (data.player && this.onPlayerJoined) {
          this.onPlayerJoined(data.player);
        }
        break;

      case 'player_left':
        this.playerCount = data.playerCount !== undefined ? data.playerCount : this.playerCount - 1;
        this.remotePlayers.delete(data.playerId);
        if (this.onPlayerLeft) this.onPlayerLeft(data.playerId);
        break;

      case 'state':
        // Remote player position update
        this.remotePlayers.set(data.id, { ...data, receivedAt: performance.now() });
        if (this.onPlayerState) this.onPlayerState(data);
        break;

      case 'pong':
        // Heartbeat response — ignore
        break;

      default:
        break;
    }
  }

  // ── Send local state ──────────────────────────────────────────────────────

  /**
   * Send local vehicle state to server.
   * @param {{ position, rotation, velocity, vehicleType }} state
   */
  sendState(state) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = JSON.stringify({
      type: 'state',
      position: {
        x: round3(state.position.x),
        y: round3(state.position.y),
        z: round3(state.position.z),
      },
      rotation: {
        x: round4(state.rotation.x),
        y: round4(state.rotation.y),
        z: round4(state.rotation.z),
        w: round4(state.rotation.w),
      },
      velocity: round2(state.velocity),
      vehicleType: state.vehicleType ?? this.vehicleType,
    });

    try {
      this.ws.send(msg);
    } catch (_) {
      // Ignore send errors — will reconnect
    }
  }

  // ── Ping / heartbeat ──────────────────────────────────────────────────────

  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 5000);
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ── Reconnect logic ───────────────────────────────────────────────────────

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[Network] Max reconnect attempts reached');
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    console.log(`[Network] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
function round4(n) { return Math.round(n * 10000) / 10000; }
