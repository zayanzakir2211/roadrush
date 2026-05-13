/**
 * seed.js — Seed Input, Random Fetch, Sharing Logic
 *
 * Manages seed validation, fetching a random seed from the backend,
 * and URL-based sharing so players can share a link to the same world.
 */

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';

export class SeedManager {
  constructor() {
    // Try to read seed from URL query param ?seed=
    const urlSeed = new URLSearchParams(window.location.search).get('seed');
    this.currentSeed = urlSeed && this.isValidSeed(urlSeed) ? urlSeed : null;
  }

  /** Validate: numeric string 12-16 digits */
  isValidSeed(seed) {
    return /^\d{12,16}$/.test(String(seed));
  }

  /** Fetch a random seed from the backend. Falls back to local generation. */
  async fetchRandom() {
    try {
      const res = await fetch(`${WORKER_URL}/seed/random`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (this.isValidSeed(data.seed)) {
        this.currentSeed = data.seed;
        return data.seed;
      }
    } catch (err) {
      console.warn('[Seed] Backend random seed failed, generating locally:', err.message);
    }
    return this.generateLocal();
  }

  /** Generate a seed locally (no backend required). */
  generateLocal() {
    const len = 12 + Math.floor(Math.random() * 5);
    let s = String(1 + Math.floor(Math.random() * 9));
    const arr = new Uint8Array(len - 1);
    crypto.getRandomValues(arr);
    for (const byte of arr) s += String(byte % 10);
    this.currentSeed = s;
    return s;
  }

  /** Set seed from user input. Returns { valid, seed }. */
  setSeed(raw) {
    const cleaned = String(raw).replace(/\D/g, '').slice(0, 16);
    if (!this.isValidSeed(cleaned)) {
      return { valid: false, seed: null };
    }
    this.currentSeed = cleaned;
    return { valid: true, seed: cleaned };
  }

  /** Get current seed. */
  getSeed() {
    return this.currentSeed;
  }

  /**
   * Return a shareable URL for the current seed.
   * Opens in a new tab if `open` is true.
   */
  getShareUrl(open = false) {
    if (!this.currentSeed) return null;
    const url = new URL(window.location.href);
    url.searchParams.set('seed', this.currentSeed);
    const shareUrl = url.toString();
    if (open) window.open(shareUrl, '_blank');
    return shareUrl;
  }

  /** Copy share URL to clipboard. Returns the URL. */
  async copyShareUrl() {
    const url = this.getShareUrl();
    if (!url) return null;
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {}
    return url;
  }
}
