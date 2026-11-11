// Ruido y azar deterministas: el mundo de Elyndra (relieve, rocas, flora, islas) sale idéntico en cada carga.
import * as THREE from 'three'

export const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
export const col = (hex: number) => new THREE.Color(hex) // con la gestión de color de three.js, el hex sRGB se convierte solo a lineal
/** Color lineal como literal GLSL (vec3), para constantes compartidas entre shaders. */
export const glsl = (hex: number) => { const c = col(hex); return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})` }
export const glslV = (v: THREE.Vector3) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`

export function mulberry32(a: number) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
export function hash(ix: number, iz: number) { let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
function hash3(ix: number, iy: number, iz: number) { let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
export function vnoise(x: number, z: number) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v }
export function fbm(x: number, z: number, oct = 5) { let s = 0, amp = 1, f = 1, norm = 0; for (let o = 0; o < oct; o++) { s += amp * vnoise(x * f, z * f); norm += amp; amp *= 0.5; f *= 2.07 } return s / norm }
export function vnoise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz)
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w)
}
export function fbm3(x: number, y: number, z: number, oct = 4) { let s = 0, amp = 1, f = 1, norm = 0; for (let o = 0; o < oct; o++) { s += amp * vnoise3(x * f, y * f, z * f); norm += amp; amp *= 0.5; f *= 2.03 } return s / norm }
/** Ruido de crestas: aristas afiladas para roca erosionada. */
export function ridged3(x: number, y: number, z: number, oct = 4) { let s = 0, amp = 1, f = 1, norm = 0; for (let o = 0; o < oct; o++) { const n = 1 - Math.abs(vnoise3(x * f, y * f, z * f) * 2 - 1); s += amp * n * n; norm += amp; amp *= 0.5; f *= 2.1 } return s / norm }

// el mismo ruido en GLSL, para los shaders del cielo, el suelo y la flora
export const GLSL_RUIDO = `
  float eh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float en(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(eh(i), eh(i + vec2(1.0, 0.0)), u.x), mix(eh(i + vec2(0.0, 1.0)), eh(i + vec2(1.0, 1.0)), u.x), u.y); }
  float efbm(vec2 p, int oct){ float s = 0.0, a = 0.5; for (int o = 0; o < 6; o++) { if (o >= oct) break; s += a * en(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`
