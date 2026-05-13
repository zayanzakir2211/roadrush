/**
 * POST /session
 * Create or join a session by seed.
 * Returns the seed and WebSocket URL for the client to connect to.
 */

export async function handleSession(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { seed, vehicleType = 0, playerName = 'Anonymous' } = body;

  // Validate seed: must be a numeric string 12-16 digits
  if (!seed || !/^\d{12,16}$/.test(String(seed))) {
    return jsonResponse(
      { error: 'Invalid seed. Must be a numeric string of 12-16 digits.' },
      400
    );
  }

  // Validate vehicleType: 0=Sports, 1=Truck, 2=SUV
  const vt = Number(vehicleType);
  if (![0, 1, 2].includes(vt)) {
    return jsonResponse({ error: 'Invalid vehicleType. Must be 0, 1, or 2.' }, 400);
  }

  // Build the WebSocket URL the client should connect to.
  // The worker's own URL is used as the base.
  const workerUrl = new URL(request.url);
  const wsProtocol = workerUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${workerUrl.host}/ws/${seed}`;

  return jsonResponse({
    seed: String(seed),
    wsUrl,
    vehicleType: vt,
    playerName,
    message: 'Session ready. Connect to wsUrl to join the room.',
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
