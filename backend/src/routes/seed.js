/**
 * GET /seed/random
 * Returns a cryptographically random 12-16 digit numeric seed.
 * The length itself is randomly chosen between 12 and 16.
 */

export async function handleRandomSeed(request, env) {
  // Random length between 12 and 16 inclusive
  const length = 12 + Math.floor(Math.random() * 5);

  // Build seed digit by digit using crypto.getRandomValues for quality randomness
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  // Map each byte to a digit 0-9. First digit must be 1-9 (no leading zero).
  let seed = '';
  for (let i = 0; i < length; i++) {
    if (i === 0) {
      // First digit: 1-9
      seed += String(1 + (bytes[i] % 9));
    } else {
      seed += String(bytes[i] % 10);
    }
  }

  return new Response(JSON.stringify({ seed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
