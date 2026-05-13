/**
 * GET  /leaderboard — fetch top scores from Firebase
 * POST /leaderboard — submit a score to Firebase
 *
 * Firebase schema:
 *   /leaderboard/{pushId}: { playerName, score, seed, vehicleType, ts }
 */

import { firebaseGet, firebasePost } from '../firebase.js';

const LEADERBOARD_PATH = 'leaderboard';
const TOP_COUNT = 20;

export async function handleLeaderboard(request, env, method) {
  if (method === 'GET') {
    return handleGet(env);
  } else if (method === 'POST') {
    return handlePost(request, env);
  }
  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleGet(env) {
  try {
    // Fetch ordered by score descending, limit to top 20
    const data = await firebaseGet(env, LEADERBOARD_PATH, {
      orderBy: '"score"',
      limitToLast: String(TOP_COUNT),
    });

    // Firebase returns an object keyed by push IDs; convert to sorted array
    let entries = [];
    if (data && typeof data === 'object') {
      entries = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      // Sort descending by score
      entries.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    return jsonResponse({ leaderboard: entries.slice(0, TOP_COUNT) });
  } catch (err) {
    console.error('Leaderboard GET error:', err);
    // Return empty leaderboard if Firebase is not configured yet
    return jsonResponse({ leaderboard: [], warning: 'Firebase not configured' });
  }
}

async function handlePost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { playerName, score, seed, vehicleType } = body;

  if (!playerName || typeof score !== 'number' || !seed) {
    return jsonResponse(
      { error: 'Required fields: playerName (string), score (number), seed (string)' },
      400
    );
  }

  // Sanitise inputs
  const entry = {
    playerName: String(playerName).slice(0, 32),
    score: Math.round(Math.max(0, score)),
    seed: String(seed).slice(0, 16),
    vehicleType: Number(vehicleType) || 0,
    ts: Date.now(),
  };

  try {
    const result = await firebasePost(env, LEADERBOARD_PATH, entry);
    return jsonResponse({ success: true, id: result.name, entry });
  } catch (err) {
    console.error('Leaderboard POST error:', err);
    return jsonResponse({ error: 'Failed to submit score', detail: err.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
