/**
 * GameRoom — Durable Object
 * One instance per seed. Manages a WebSocket room where all players
 * sharing the same seed connect and broadcast their positions.
 *
 * Each connected WebSocket represents one player. When a player sends
 * their state, the room immediately broadcasts it to all other players.
 */

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Map of WebSocket → player metadata
    this.players = new Map();
    // Counter for assigning player IDs within this room
    this.nextPlayerId = 1;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Only handle WebSocket upgrade requests
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Accept the WebSocket connection
    const { 0: clientWs, 1: serverWs } = new WebSocketPair();
    this.handleSession(serverWs, url);
    return new Response(null, { status: 101, webSocket: clientWs });
  }

  /**
   * Set up event handlers for a new WebSocket connection.
   * @param {WebSocket} ws - The server-side WebSocket
   * @param {URL} url - The request URL (contains seed in path)
   */
  handleSession(ws, url) {
    ws.accept();

    // Assign a unique player ID for this connection
    const playerId = `p${this.nextPlayerId++}`;
    const joinedAt = Date.now();

    // Store player state (will be updated on each message)
    const playerState = {
      id: playerId,
      joinedAt,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: 0,
      vehicleType: 0, // 0=sports, 1=truck, 2=suv
    };

    this.players.set(ws, playerState);

    // Send the new player their assigned ID and list of current players
    const currentPlayers = [];
    for (const [otherWs, state] of this.players) {
      if (otherWs !== ws) {
        currentPlayers.push({ ...state });
      }
    }

    ws.send(
      JSON.stringify({
        type: 'init',
        playerId,
        players: currentPlayers,
        playerCount: this.players.size,
      })
    );

    // Notify existing players that someone joined
    this.broadcast(
      ws,
      JSON.stringify({
        type: 'player_joined',
        player: { ...playerState },
        playerCount: this.players.size,
      })
    );

    // Handle incoming messages from this player
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(ws, playerState, data);
      } catch (err) {
        // Ignore malformed messages
        console.error('Invalid message from player:', err.message);
      }
    });

    // Handle disconnect
    ws.addEventListener('close', () => {
      this.players.delete(ws);
      this.broadcast(
        null,
        JSON.stringify({
          type: 'player_left',
          playerId,
          playerCount: this.players.size,
        })
      );
    });

    ws.addEventListener('error', () => {
      this.players.delete(ws);
    });
  }

  /**
   * Process an incoming message from a player.
   * Supported message types:
   *   - "state": player position/rotation update → broadcast to others
   *   - "ping": heartbeat → respond with pong
   */
  handleMessage(ws, playerState, data) {
    if (data.type === 'state') {
      // Validate and update stored player state
      if (data.position) {
        playerState.position.x = Number(data.position.x) || 0;
        playerState.position.y = Number(data.position.y) || 0;
        playerState.position.z = Number(data.position.z) || 0;
      }
      if (data.rotation) {
        playerState.rotation.x = Number(data.rotation.x) || 0;
        playerState.rotation.y = Number(data.rotation.y) || 0;
        playerState.rotation.z = Number(data.rotation.z) || 0;
        playerState.rotation.w = Number(data.rotation.w) || 1;
      }
      if (data.velocity !== undefined) {
        playerState.velocity = Number(data.velocity) || 0;
      }
      if (data.vehicleType !== undefined) {
        playerState.vehicleType = Number(data.vehicleType) || 0;
      }

      // Broadcast to all OTHER players in the room
      this.broadcast(
        ws,
        JSON.stringify({
          type: 'state',
          id: playerState.id,
          position: playerState.position,
          rotation: playerState.rotation,
          velocity: playerState.velocity,
          vehicleType: playerState.vehicleType,
          ts: Date.now(),
        })
      );
    } else if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
    }
  }

  /**
   * Broadcast a message to all connected players, optionally skipping one.
   * @param {WebSocket|null} exclude - WebSocket to skip (usually the sender)
   * @param {string} message - JSON string to send
   */
  broadcast(exclude, message) {
    for (const [ws] of this.players) {
      if (ws !== exclude && ws.readyState === 1 /* OPEN */) {
        try {
          ws.send(message);
        } catch (_) {
          // Connection died — will be cleaned up on close event
        }
      }
    }
  }
}
