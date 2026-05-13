/**
 * Firebase REST Helper
 * All Firebase access via fetch() against the REST API.
 * No Node SDK — Cloudflare Workers cannot run it.
 *
 * Credentials come exclusively from Worker Secrets:
 *   env.FIREBASE_API_KEY
 *   env.FIREBASE_URL   (e.g. https://your-project-default-rtdb.firebaseio.com)
 *   env.FIREBASE_PROJECT_ID
 */

/**
 * Obtain a Firebase ID token by exchanging the API key for anonymous auth.
 * For a production game you'd use a proper auth flow; here we use the
 * signInAnonymously REST endpoint to get a short-lived token.
 */
async function getFirebaseToken(env) {
  const apiKey = env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error('FIREBASE_API_KEY secret not set');

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase auth failed: ${body}`);
  }

  const data = await res.json();
  return data.idToken;
}

/**
 * Read data from a Firebase Realtime Database path.
 * @param {object} env - Worker environment with secrets
 * @param {string} path - DB path, e.g. "leaderboard/top"
 * @param {object} [queryParams] - Extra query params (orderBy, limitToFirst, etc.)
 * @returns {Promise<any>} Parsed JSON from Firebase
 */
export async function firebaseGet(env, path, queryParams = {}) {
  const baseUrl = env.FIREBASE_URL;
  if (!baseUrl) throw new Error('FIREBASE_URL secret not set');

  const token = await getFirebaseToken(env);
  const params = new URLSearchParams({ auth: token, ...queryParams });
  const url = `${baseUrl}/${path}.json?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase GET failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Write (PUT) data to a Firebase Realtime Database path.
 * Overwrites the entire node at `path`.
 * @param {object} env
 * @param {string} path
 * @param {any} data
 */
export async function firebasePut(env, path, data) {
  const baseUrl = env.FIREBASE_URL;
  if (!baseUrl) throw new Error('FIREBASE_URL secret not set');

  const token = await getFirebaseToken(env);
  const url = `${baseUrl}/${path}.json?auth=${token}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase PUT failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Push (POST) data to a Firebase Realtime Database path.
 * Firebase assigns a unique key under `path`.
 * @param {object} env
 * @param {string} path
 * @param {any} data
 * @returns {Promise<{name: string}>} Object containing the new key
 */
export async function firebasePost(env, path, data) {
  const baseUrl = env.FIREBASE_URL;
  if (!baseUrl) throw new Error('FIREBASE_URL secret not set');

  const token = await getFirebaseToken(env);
  const url = `${baseUrl}/${path}.json?auth=${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase POST failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Delete a node from Firebase Realtime Database.
 * @param {object} env
 * @param {string} path
 */
export async function firebaseDelete(env, path) {
  const baseUrl = env.FIREBASE_URL;
  if (!baseUrl) throw new Error('FIREBASE_URL secret not set');

  const token = await getFirebaseToken(env);
  const url = `${baseUrl}/${path}.json?auth=${token}`;

  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase DELETE failed (${res.status}): ${body}`);
  }
}
