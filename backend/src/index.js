/**
 * Multiplayer Car Game — Cloudflare Worker Entry Point
 * Handles REST API routing and WebSocket upgrade for game rooms.
 * Durable Objects manage per-seed WebSocket rooms.
 */

import { handleSession } from './routes/session.js';
import { handleRandomSeed } from './routes/seed.js';
import { handleLeaderboard } from './routes/leaderboard.js';

// Re-export Durable Object class so Cloudflare can bind it
export { GameRoom } from './room.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // ── REST Routes ──────────────────────────────────────────────────────────

      // POST /session — create or join a session by seed
      if (pathname === '/session' && request.method === 'POST') {
        const res = await handleSession(request, env);
        return addCors(res, corsHeaders);
      }

      // GET /seed/random — return a random 12-16 digit numeric seed
      if (pathname === '/seed/random' && request.method === 'GET') {
        const res = await handleRandomSeed(request, env);
        return addCors(res, corsHeaders);
      }

      // GET /leaderboard — fetch top scores from Firebase
      if (pathname === '/leaderboard' && request.method === 'GET') {
        const res = await handleLeaderboard(request, env, 'GET');
        return addCors(res, corsHeaders);
      }

      // POST /leaderboard — submit a score to Firebase
      if (pathname === '/leaderboard' && request.method === 'POST') {
        const res = await handleLeaderboard(request, env, 'POST');
        return addCors(res, corsHeaders);
      }

      // ── WebSocket Route ──────────────────────────────────────────────────────

      // WS /ws/:seed — real-time player position sync via WebSocket
      const wsMatch = pathname.match(/^\/ws\/(\d+)$/);
      if (wsMatch) {
        const seed = wsMatch[1];
        // Route to Durable Object for this seed (one room per seed)
        const roomId = env.GAME_ROOM.idFromName(seed);
        const room = env.GAME_ROOM.get(roomId);
        return room.fetch(request);
      }

      // Health check
      if (pathname === '/health') {
        return addCors(
          new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
            headers: { 'Content-Type': 'application/json' },
          }),
          corsHeaders
        );
      }

      // 404 for unmatched routes
      return addCors(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
        corsHeaders
      );
    } catch (err) {
      console.error('Worker error:', err);
      return addCors(
        new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
        corsHeaders
      );
    }
  },
};

/** Merge CORS headers into any Response */
function addCors(response, corsHeaders) {
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    newHeaders.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
