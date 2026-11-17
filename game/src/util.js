// Shared helpers for Solmarina: a seeded random number generator (so the city is the
// same every load), small math helpers and the one global namespace every file uses.
window.SM = window.SM || {};

/** Deterministic RNG (mulberry32). Same seed, same city, every load. */
SM.makeRng = function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

SM.clamp = function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
SM.lerp = function lerp(a, b, t) { return a + (b - a) * t; };
SM.damp = function damp(a, b, lambda, dt) { return SM.lerp(a, b, 1 - Math.exp(-lambda * dt)); };
SM.dist2d = function dist2d(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); };
SM.angleLerp = function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
SM.angleDiff = function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
SM.pick = function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; };
SM.rand = function rand(rng, lo, hi) { return lo + rng() * (hi - lo); };
SM.randInt = function randInt(rng, lo, hi) { return Math.floor(SM.rand(rng, lo, hi + 1)); };

/** Format cash: 1250 -> "$1,250". */
SM.money = function money(n) {
  return '$' + Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/** A small canvas texture from a draw callback (used for windows, signs, roads). */
SM.canvasTexture = function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** Query params (?shot=chase stages a scene for screenshots, ?seed=N fixes the city seed). */
SM.params = function params() {
  const out = {};
  for (const [k, v] of new URLSearchParams(window.location.search)) out[k] = v;
  return out;
};
