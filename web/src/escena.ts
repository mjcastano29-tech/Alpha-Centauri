// Escena three.js que reproduce una trayectoria ya calculada por el ambiente (Python). Interpola entre
// las muestras grabadas cada 0,1 s con un spline de Hermite (usa las velocidades grabadas); nada de lo que
// ocurre aquí cambia los datos. El modo (replay de entrenamiento, modelo final o evaluación en vivo) lo
// decide quien crea el reproductor. Es el porte a módulos de la escena de visualizacion/aprendizaje3d.html:
// cielo de Alfa Centauri, terreno de regolito, losa de aterrizaje, dos cohetes, penacho con diamantes de
// choque, polvo, bola de fuego al chocar, tres cámaras y posproceso (brillo, viñeta, grano).
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { Vuelo } from './api'

const DT = 0.1 // s entre muestras grabadas
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y) // el entorno usa z hacia arriba; three.js, y hacia arriba
const COLOR_RESULTADO: Record<string, number> = { aterrizaje: 0x3ee08a, 'fuera de plataforma': 0xf2c14e, choque: 0xff6b5c, 'sin pasos': 0xa5b2c4, 'fuera de zona': 0xc39bff, 'colisión': 0xff8f6b }
export interface Obstaculo { tipo?: 'torre' | 'pasarela'; nombre: string; x: number; y: number; radio: number; altura: number; radio_abertura?: number; grosor?: number }
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const col = (hex: number) => new THREE.Color(hex) // con la gestión de color de three.js, el hex sRGB se convierte solo a lineal
// los ShaderMaterial no aplican solos el tone mapping ni la conversión de color de salida; esto los iguala al resto
const OUTPUT = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n'
const PAD_R = 42, PAD_TOP = 0.25 // losa de hormigón (m) y altura de su cara superior
const UP = new THREE.Vector3(0, 1, 0)

export type ModoCamara = 'seguir' | 'torre' | 'abordo'
export type Cohete = 'nave' | 'propulsor'
export interface EstadoReproductor { indice: number; paso: number; etiqueta: string; recompensaAcumulada: number; terminado: boolean; velocidadEfectiva: number }

// ---------- utilidades deterministas (texturas y rocas idénticas en cada carga) ----------
function mulberry32(a: number) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function hash(ix: number, iz: number) { let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296 }
function vnoise(x: number, z: number) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v }
function fbm(x: number, z: number) { let s = 0, amp = 1, f = 1; for (let o = 0; o < 5; o++) { s += amp * vnoise(x * f, z * f); amp *= 0.5; f *= 2.07 } return s / 1.9375 }
const CRATERS: [number, number, number][] = []
for (let k = 0; k < 46; k++) { // [x, z, radio], siempre lejos de la zona de vuelo
  const R = 50 + Math.pow(hash(k, 37), 2.2) * 320, a = hash(k, 11) * 2 * Math.PI, r = 450 + R * 1.6 + hash(k, 23) * 3200
  CRATERS.push([r * Math.cos(a), r * Math.sin(a), R])
}
function craterHeight(x: number, z: number) {
  let h = 0
  for (const [cx, cz, R] of CRATERS) {
    const dx = x - cx, dz = z - cz, d2 = (dx * dx + dz * dz) / (R * R)
    if (d2 > 2.6) continue
    const d = Math.sqrt(d2)
    h += d < 1 ? -0.22 * R * (1 - d2) + 0.1 * R : 0.1 * R * Math.exp(-Math.pow((d - 1) / 0.22, 2)) // cuenco y borde elevado
  }
  return h
}
/** Altura del terreno (m) en un punto: dunas suaves cerca de la plataforma, mesetas y cordilleras al fondo. */
export function terrainHeight(x: number, z: number) {
  const r = Math.hypot(x, z)
  const mesas = smooth(0.52, 0.6, fbm(x / 1500 + 3.1, z / 1500 - 4.7)) * 260 * smooth(700, 2200, r)
  const ridge = Math.pow(fbm(x / 1300 + 7.3, z / 1300 + 2.1), 2.2) * 900 * smooth(1400, 3200, r)
  const dunes = (fbm(x / 160, z / 160) - 0.5) * 9 * smooth(150, 600, r) + (fbm(x / 35, z / 35) - 0.5) * 1.2 * smooth(60, 160, r)
  return mesas + ridge + dunes + craterHeight(x, z)
}

type Pintar = (g: CanvasRenderingContext2D, w: number, h: number) => void
function canvasTexture(w: number, h: number, paint: Pintar, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t
}
function glowTexture() {
  return canvasTexture(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128)
  })
}

// ---------- recursos pesados compartidos entre reproductores (se generan una vez por sesión) ----------
interface Recursos { GLOW: THREE.Texture; padTex: THREE.Texture; scorchTex: THREE.Texture; franjasTex: THREE.Texture; terreno: THREE.BufferGeometry; roca: THREE.BufferGeometry; skins: { body: THREE.Texture[][]; nose: THREE.Texture[][] }; tileTex: THREE.Texture; sootTex: THREE.Texture; gridTex: THREE.Texture }
let recursos: Recursos | null = null
const HEX = 2 / (Math.sqrt(3) * 6) // radio de las losetas (m): 6 por cada 2 m, así la textura se repite sin costuras
function hexTiles(g: CanvasRenderingContext2D, rnd: () => number, x0: number, y0: number, x1: number, y1: number) {
  g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip()
  g.fillStyle = '#0b0b0d'; g.fillRect(x0, y0, x1 - x0, y1 - y0)
  const s = HEX, w = Math.sqrt(3) * s, h = 1.5 * s
  for (let row = 0, y = y0 - s; y < y1 + s; row++, y += h) {
    for (let x = x0 - w + (row % 2 ? w / 2 : 0); x < x1 + w; x += w) {
      const l = 24 + rnd() * 16; g.fillStyle = `rgb(${l | 0},${l | 0},${(l + 3) | 0})`
      g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; g.lineTo(x + s * 0.92 * Math.cos(a), y + s * 0.92 * Math.sin(a)) } g.closePath(); g.fill()
    }
  }
  g.restore()
}
// piel de acero: anillos soldados cada 1,8 m, paneles con brillo distinto y, con tiles, la mitad −z cubierta de losetas.
// Devuelve [color, orm]: en orm el canal verde es la rugosidad y el azul lo metálico (convención de three.js)
function steelSkin(rnd: () => number, W: number, H: number, circ: number, tall: number, opts: { hatch?: [number, number]; raceway?: boolean; soot?: boolean; tiles: boolean }) {
  const sx = W / circ, sy = H / tall, rings = Math.ceil(tall / 1.8), cols = 6
  const panel: [number, number][] = []; for (let k = 0; k < rings * cols; k++) panel.push([rnd(), rnd()])
  const paint = (orm: boolean): Pintar => (g) => {
    g.setTransform(sx, 0, 0, sy, 0, 0)
    for (let r = 0; r < rings; r++) for (let c = 0; c < cols; c++) {
      const [a, b] = panel[r * cols + c], x = (c / cols) * circ, y = tall - (r + 1) * 1.8
      if (orm) g.fillStyle = `rgb(0,${(78 + a * 26) | 0},255)`
      else { const l = 182 + a * 12, warm = (b - 0.5) * 6; g.fillStyle = `rgb(${(l + warm) | 0},${(l + 2) | 0},${(l + 6 - warm) | 0})` }
      g.fillRect(x, y, circ / cols + 0.01, 1.81)
    }
    g.fillStyle = orm ? 'rgb(0,150,210)' : 'rgba(70,72,78,0.55)' // soldaduras
    for (let r = 1; r <= rings; r++) g.fillRect(0, tall - r * 1.8 - 0.025, circ, 0.05)
    for (let c = 0; c < cols; c++) g.fillRect((c / cols) * circ - 0.02, 0, 0.04, tall)
    if (!orm) {
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '40,40,44'},${0.03 + rnd() * 0.05})`; g.fillRect(rnd() * circ, rnd() * tall, 0.02 + rnd() * 0.05, 0.5 + rnd() * 4) } // pulido
      for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(150,100,70,${0.04 + rnd() * 0.08})`; g.fillRect(rnd() * circ, tall - rnd() * 7, 0.05 + rnd() * 0.2, rnd() * 3) } // polvo del planeta
    }
    if (opts.raceway) { g.fillStyle = orm ? 'rgb(0,110,255)' : '#9a9ea5'; g.fillRect(circ * 0.07, tall * 0.08, 0.32, tall * 0.88) }
    if (opts.soot) { const grd = g.createLinearGradient(0, tall, 0, tall - 5); grd.addColorStop(0, orm ? 'rgba(0,200,160,0.9)' : 'rgba(28,24,22,0.8)'); grd.addColorStop(1, orm ? 'rgba(0,200,160,0)' : 'rgba(28,24,22,0)'); g.fillStyle = grd; g.fillRect(0, tall - 5, circ, 5) }
    if (opts.hatch) for (const x of [-0.55, circ - 0.55]) { // escotilla en la cara de acero (u = 0)
      const [y0, y1] = opts.hatch
      g.fillStyle = orm ? 'rgb(0,150,140)' : '#3a3c41'; g.fillRect(x - 0.08, tall - y1 - 0.08, 1.26, y1 - y0 + 0.16)
      g.fillStyle = orm ? 'rgb(0,90,40)' : '#141518'; g.fillRect(x, tall - y1, 1.1, y1 - y0)
    }
    if (opts.tiles) { if (orm) { g.fillStyle = 'rgb(0,215,0)'; g.fillRect(circ * 0.25, 0, circ * 0.5, tall) } else hexTiles(g, rnd, circ * 0.25, 0, circ * 0.75, tall) }
  }
  return [canvasTexture(W, H, paint(false)), canvasTexture(W, H, paint(true), false)]
}
function cargarRecursos(padRadius: number): Recursos {
  if (recursos) return recursos
  const rnd = mulberry32(20261030)
  const padTex = canvasTexture(2048, 2048, (g, W, H) => {
    const cx = W / 2, cy = H / 2, px = W / (2 * PAD_R) // píxeles por metro
    g.fillStyle = '#8f8981'; g.fillRect(0, 0, W, H)
    for (let k = 0; k < 2600; k++) { const l = 105 + rnd() * 55; g.fillStyle = `rgba(${l | 0},${(l * 0.95) | 0},${(l * 0.9) | 0},${0.05 + rnd() * 0.06})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, 4 + rnd() * 40, 0, 7); g.fill() }
    const img = g.getImageData(0, 0, W, H), d = img.data
    for (let i = 0; i < d.length; i += 4) { const v = (rnd() - 0.5) * 22; d[i] += v; d[i + 1] += v; d[i + 2] += v }
    g.putImageData(img, 0, 0)
    g.strokeStyle = 'rgba(42,38,35,0.55)'; g.lineWidth = 2.2 // juntas de las losas cada 6 m
    for (let m = -PAD_R; m <= PAD_R; m += 6) { const q = cx + m * px; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, H); g.stroke(); g.beginPath(); g.moveTo(0, q); g.lineTo(W, q); g.stroke() }
    for (let k = 0; k < 7; k++) { // quemaduras de aterrizajes anteriores
      const ox = cx + (rnd() - 0.5) * 14 * px, oy = cy + (rnd() - 0.5) * 14 * px, r = (6 + rnd() * 9) * px, grd = g.createRadialGradient(ox, oy, 0, ox, oy, r)
      grd.addColorStop(0, 'rgba(20,16,14,0.5)'); grd.addColorStop(0.5, 'rgba(30,24,20,0.22)'); grd.addColorStop(1, 'rgba(30,24,20,0)'); g.fillStyle = grd; g.fillRect(0, 0, W, H)
    }
    for (let k = 0; k < 240; k++) { // estrías radiales de hollín
      const a = rnd() * 2 * Math.PI, r0 = (2 + rnd() * 5) * px, r1 = r0 + (4 + rnd() * 16) * px
      g.strokeStyle = `rgba(25,20,18,${0.06 + rnd() * 0.1})`; g.lineWidth = 1 + rnd() * 4
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke()
    }
    g.globalAlpha = 0.9 // pintura: anillo exterior blanco, círculo de éxito del ambiente en amarillo y cruz
    g.strokeStyle = '#e6e1d6'; g.lineWidth = 0.6 * px; g.beginPath(); g.arc(cx, cy, (PAD_R - 3) * px, 0, 7); g.stroke()
    g.strokeStyle = '#e8b931'; g.lineWidth = 0.55 * px; g.beginPath(); g.arc(cx, cy, padRadius * px, 0, 7); g.stroke()
    g.fillStyle = '#e6e1d6'; const L = padRadius * 0.7 * px, w = 0.5 * px; g.fillRect(cx - L, cy - w / 2, 2 * L, w); g.fillRect(cx - w / 2, cy - L, w, 2 * L)
    g.globalAlpha = 1
    for (let k = 0; k < 14000; k++) { g.fillStyle = `rgba(118,112,104,${0.2 + rnd() * 0.35})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3) } // desgaste
  })
  const scorchTex = canvasTexture(256, 256, (g, W) => { const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); grd.addColorStop(0, 'rgba(8,6,5,1)'); grd.addColorStop(0.45, 'rgba(15,11,9,0.7)'); grd.addColorStop(1, 'rgba(20,14,10,0)'); g.fillStyle = grd; g.fillRect(0, 0, W, W) })
  // terreno: la malla se concentra cerca de la plataforma (más detalle donde aterriza el cohete) y se abre hacia el horizonte
  const size = 9000, half = size / 2, seg = 300
  const warp = (v: number) => Math.sign(v) * half * Math.pow(Math.abs(v) / half, 1.7)
  const terreno = new THREE.PlaneGeometry(size, size, seg, seg); terreno.rotateX(-Math.PI / 2)
  const p = terreno.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) { const x = warp(p.getX(i)), z = warp(p.getZ(i)); p.setXYZ(i, x, terrainHeight(x, z), z) }
  terreno.computeVertexNormals()
  const nrm = terreno.attributes.normal as THREE.BufferAttribute, colores = new Float32Array(p.count * 3)
  const dustCol = col(0xb8714a), pale = col(0xcf9a74), basalt = col(0x4e2a1f), tmpc = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = p.getY(i), ny = nrm.getY(i)
    tmpc.copy(dustCol).lerp(pale, smooth(0.45, 0.75, fbm(x / 260 + 11, z / 260 - 5)) * 0.6) // manchas de polvo claro
    tmpc.lerp(basalt, smooth(0.08, 0.35, 1 - ny)) // la roca oscura aflora en las pendientes
    tmpc.multiplyScalar(h < -4 ? 0.85 : 1)
    colores.set([tmpc.r, tmpc.g, tmpc.b], i * 3)
  }
  terreno.setAttribute('color', new THREE.BufferAttribute(colores, 3))
  // roca irregular semienterrada (se instancia 520 veces)
  const roca = new THREE.IcosahedronGeometry(1, 2), gp = roca.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i), d = 0.72 + 0.55 * vnoise(x * 1.9 + 3.1, y * 1.9 + z * 1.3 + 7.7)
    gp.setXYZ(i, x * d, (y < -0.2 ? y * 0.55 : y) * d, z * d)
  }
  roca.computeVertexNormals()
  // pieles de los cohetes
  const R = 3, circ = 2 * Math.PI * R
  const skins = {
    body: [false, true].map((tiles) => steelSkin(rnd, 1024, 2048, circ, 33 - 3.2, { hatch: [26.4, 28.3], raceway: true, soot: true, tiles })),
    nose: [false, true].map((tiles) => steelSkin(rnd, 1024, 512, circ, 10.4, { tiles })),
  }
  const tileTex = canvasTexture(512, 512, (g, W, H) => { g.setTransform(W / 2, 0, 0, H / (6 * HEX * 2), 0, 0); hexTiles(g, rnd, 0, 0, 2, 6 * HEX * 2) })
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping; tileTex.repeat.set(0.5, 1 / (12 * HEX))
  const sootTex = canvasTexture(1024, 2048, (c, W, H) => {
    c.fillStyle = '#ecebe6'; c.fillRect(0, 0, W, H)
    for (let y = 70; y < H; y += 90 + Math.floor(rnd() * 40)) { c.fillStyle = 'rgba(110,110,108,0.28)'; c.fillRect(0, y, W, 3) } // soldaduras de los anillos
    const grd = c.createLinearGradient(0, H, 0, H * 0.2) // hollín: denso abajo, se desvanece hacia arriba
    grd.addColorStop(0, 'rgba(26,22,20,0.95)'); grd.addColorStop(0.3, 'rgba(38,32,28,0.6)'); grd.addColorStop(0.65, 'rgba(60,52,46,0.18)'); grd.addColorStop(1, 'rgba(60,52,46,0)')
    c.fillStyle = grd; c.fillRect(0, 0, W, H)
    for (let k = 0; k < 1400; k++) { // chorretones verticales, más en la cara que recibe el flujo al reentrar
      const side = rnd() < 0.6, x = side ? W * (0.15 + rnd() * 0.35) : rnd() * W, y0 = H - rnd() * H * 0.2, len = H * (0.08 + Math.pow(rnd(), 1.5) * 0.7)
      c.strokeStyle = `rgba(28,24,21,${0.03 + rnd() * 0.12})`; c.lineWidth = 1 + rnd() * 7
      c.beginPath(); c.moveTo(x, y0); c.lineTo(x + (rnd() - 0.5) * 10, y0 - len); c.stroke()
    }
  })
  const gridTex = canvasTexture(256, 256, (c, W, H) => {
    c.clearRect(0, 0, W, H); c.strokeStyle = '#ffffff'; c.lineWidth = 7
    for (let k = -W; k < 2 * W; k += 28) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + W, H); c.stroke(); c.beginPath(); c.moveTo(k, H); c.lineTo(k + W, 0); c.stroke() }
    c.lineWidth = 16; c.strokeRect(0, 0, W, H)
  })
  // torres del nivel 2: acero oscuro con franjas rojas y blancas de señalización, desgastadas por el polvo
  const franjasTex = canvasTexture(128, 512, (g, W, H) => {
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#c8c4bb' : '#b8372a'; g.fillRect(0, (k * H) / 8, W, H / 8) }
    for (let k = 0; k < 1200; k++) { g.fillStyle = `rgba(90,60,40,${0.08 + rnd() * 0.18})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 6, 1 + rnd() * 14) }
    g.fillStyle = 'rgba(30,28,26,0.55)'; for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 2, H) // nervios verticales
  })
  franjasTex.wrapS = franjasTex.wrapT = THREE.RepeatWrapping
  recursos = { GLOW: glowTexture(), padTex, scorchTex, franjasTex, terreno, roca, skins, tileTex, sootTex, gridTex }
  return recursos
}

// ---------- piezas de la escena ----------
interface Nave { group: THREE.Group; nozzle: THREE.Vector3; height: number; plumeW: number; heatShield?: (on: boolean) => void; onboard: { pos: THREE.Vector3; aim: THREE.Vector3; up: THREE.Vector3 }; plume: { inner: THREE.Color[]; outer: THREE.Color[] } }
function beamMesh(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, geo: (L: number) => THREE.BufferGeometry, mat: THREE.Material) { // pieza recta entre dos puntos: patas y puntales
  const d = to.clone().sub(from), m = new THREE.Mesh(geo(d.length()), mat)
  m.position.copy(from).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.castShadow = m.receiveShadow = true; parent.add(m); return m
}
function bellGeometry(r0: number, r1: number, len: number) { const pts: THREE.Vector2[] = []; for (let k = 0; k <= 14; k++) { const t = k / 14; pts.push(new THREE.Vector2(r0 + (r1 - r0) * Math.pow(t, 0.75), -len * t)) } return new THREE.LatheGeometry(pts, 32) }
function flapGeometry(pts: [number, number][]) { // aleta plana con bordes redondeados, en el plano XY (x: distancia al eje, y: altura)
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([x, y]) => s.lineTo(x, y)); s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 2 })
  geo.translate(0, 0, -0.15); return geo
}
function plumeMaterial(inner: boolean) { // penacho del motor: cono exterior y núcleo caliente con diamantes de choque
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, power: { value: 0 }, c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() } },
    vertexShader: `varying float vV; varying vec3 vN; varying vec3 vView;
      void main(){ vV = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float time, power; uniform vec3 c0, c1; varying float vV; varying vec3 vN; varying vec3 vView;
      void main(){
        float along = 1.0 - vV;
        float edge = pow(abs(dot(normalize(vN), normalize(vView))), ${inner ? '2.5' : '1.6'});
        float flick = 0.85 + 0.15 * sin(time * 60.0 + along * 20.0) * sin(time * 37.0);
        ${inner
          ? `float fade = pow(1.0 - along, 2.2);
        vec3 c = mix(c0, c1, smoothstep(0.0, 0.7, along));
        float diamonds = 0.55 + 0.9 * pow(0.5 + 0.5 * cos(along * 6.2832 * 4.0), 6.0) * (1.0 - along);
        float a = edge * fade * flick * diamonds * power * 2.6;
        c *= 1.0 + 1.5 * (1.0 - along) * power;`
          : `float fade = pow(1.0 - along, 1.3);
        vec3 c = mix(c0, c1, along);
        float a = edge * fade * flick * power * 0.9;`}
        gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));${OUTPUT}}`,
  })
}
/** Partículas suaves: polvo del regolito (lo levanta el chorro y el contacto) y humo de un choque; el viento grabado las arrastra. */
class Particulas {
  readonly points: THREE.Points
  alive = 0
  private cursor = 0
  private readonly pos: Float32Array; private readonly vel: Float32Array; private readonly life: Float32Array; private readonly max: Float32Array; private readonly alpha: Float32Array; private readonly size: Float32Array
  private readonly N: number; private readonly opacity: number; private readonly size0: number; private readonly size1: number; private readonly drag: number; private readonly gravity: number
  constructor(N: number, hex: number, opacity: number, size0: number, size1: number, drag: number, gravity: number) {
    this.N = N; this.opacity = opacity; this.size0 = size0; this.size1 = size1; this.drag = drag; this.gravity = gravity
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.alpha = new Float32Array(N); this.size = new Float32Array(N)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1)); geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1))
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { color: { value: col(hex) }, scale: { value: 600 } },
      vertexShader: `attribute float alpha; attribute float size; uniform float scale; varying float vA;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
          gl_FragColor = vec4(color, vA * (1.0 - d) * (1.0 - d));${OUTPUT}}`,
    }))
    this.points.frustumCulled = false
  }
  emit(x: number, y: number, z: number, count: number, speed: number, spread: number, rise: number, lifeBase: number) { // abanico radial con subida vertical
    for (let c = 0; c < count; c++) {
      const i = this.cursor, o = i * 3; this.cursor = (this.cursor + 1) % this.N
      const a = Math.random() * 2 * Math.PI, r = Math.random() * spread, sp = speed * (0.5 + Math.random() * 0.7)
      this.pos[o] = x + r * Math.cos(a); this.pos[o + 1] = y + Math.random() * 1.5; this.pos[o + 2] = z + r * Math.sin(a)
      this.vel[o] = Math.cos(a) * sp; this.vel[o + 1] = rise * (0.6 + Math.random() * 0.8); this.vel[o + 2] = Math.sin(a) * sp
      this.max[i] = this.life[i] = lifeBase * (0.7 + Math.random() * 0.8)
    }
  }
  update(dt: number, wx: number, wy: number, wz: number) {
    this.alive = 0
    const k = Math.exp(-dt * this.drag), { pos, vel, life, max, alpha, size } = this
    for (let i = 0; i < this.N; i++) {
      const o = i * 3
      if (life[i] <= 0) { alpha[i] = 0; continue }
      this.alive++; life[i] -= dt
      vel[o] *= k; vel[o + 2] *= k; vel[o + 1] = vel[o + 1] * k + this.gravity * dt
      pos[o] += (vel[o] + wx * 0.5) * dt; pos[o + 1] = Math.max(0.4, pos[o + 1] + (vel[o + 1] + wy * 0.5) * dt); pos[o + 2] += (vel[o + 2] + wz * 0.5) * dt
      const u = 1 - Math.max(0, life[i]) / max[i]
      alpha[i] = this.opacity * Math.sin(Math.PI * Math.min(1, u * 1.15)); size[i] = this.size0 + (this.size1 - this.size0) * u
    }
    const g = this.points.geometry; g.attributes.position.needsUpdate = g.attributes.alpha.needsUpdate = g.attributes.size.needsUpdate = true
  }
  reset() { this.life.fill(0) }
}
// posproceso de cámara (tras el tone mapping): viñeta, grano y una leve aberración cromática de lente
const FINAL_SHADER = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, time: { value: 0 }, grain: { value: 0.03 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, grain; varying vec2 vUv;
    float rnd(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d); vec2 off = d * r2 * 0.01;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= 1.0 - smoothstep(0.12, 0.62, r2) * 0.45;
      c += (rnd(gl_FragCoord.xy + fract(time) * 917.0) - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0); }`,
}
// detalle fino del suelo en el shader: tono, grano y relieve de pocos centímetros que se ven de cerca
const DETAIL_GLSL = `varying vec3 vWPos;
  float dh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float dn(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(dh(i), dh(i + vec2(1.0, 0.0)), u.x), mix(dh(i + vec2(0.0, 1.0)), dh(i + vec2(1.0, 1.0)), u.x), u.y); }
  float dfbm(vec2 p){ float s = 0.0, a = 0.5; for (int o = 0; o < 4; o++) { s += a * dn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
  float detailH(vec2 p, float fade){
    return dfbm(p * 0.35) * 0.9 + dn(p * 2.7) * 0.2 + (dn(p * 9.0) * 0.06 + sin(dot(p, vec2(0.55, 0.83)) * 3.1 + dn(p * 0.4) * 6.0) * 0.05) * fade; }
  vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy){
    vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos), R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
    float det = dot(sx, R1); vec3 grad = sign(det) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(det) * surf_norm - grad); }`

interface Muestra { x: number; y: number; z: number; dx: number; dy: number; dz: number; wx: number; wy: number; wz: number; thr: number }
// el vuelo está grabado cada DT segundos; entre dos muestras la posición se interpola con un spline de Hermite que usa las velocidades
function sampleAt(f: Vuelo['f'], t: number, S: Muestra) {
  const n = f.t.length, i0 = Math.min(Math.floor(t), n - 1), i1 = Math.min(i0 + 1, n - 1)
  const h = f.t[i1] - f.t[i0], a = h > 0 ? Math.min(1, Math.max(0, t - i0)) : 0
  const a2 = a * a, a3 = a2 * a, h00 = 2 * a3 - 3 * a2 + 1, h10 = a3 - 2 * a2 + a, h01 = 3 * a2 - 2 * a3, h11 = a3 - a2
  const herm = (p: 'x' | 'y' | 'z', v: 'vx' | 'vy' | 'vz') => h00 * f[p][i0] + h10 * h * f[v][i0] + h01 * f[p][i1] + h11 * h * f[v][i1]
  const lerp = (k: 'dx' | 'dy' | 'dz' | 'wx' | 'wy' | 'wz') => f[k][i0] + (f[k][i1] - f[k][i0]) * a
  S.x = herm('x', 'vx'); S.y = herm('y', 'vy'); S.z = Math.max(0, herm('z', 'vz'))
  S.dx = lerp('dx'); S.dy = lerp('dy'); S.dz = lerp('dz'); S.wx = lerp('wx'); S.wy = lerp('wy'); S.wz = lerp('wz')
  S.thr = (f.on[i0] ? f.thr[i0] : 0) * (1 - a) + (f.on[i1] ? f.thr[i1] : 0) * a
  return S
}
const shake = (t: number, a: number) => a * (Math.sin(t * 51.3) * 0.6 + Math.sin(t * 33.7 + 1.3) * 0.4) // vibración del motor

export class Reproductor {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  // opciones que cambia la interfaz
  playing = false
  speed = 4
  cine = true // órbita lenta de la cámara mientras reproduce
  slowmo = true // cámara lenta por debajo de 80 m
  fantasmas = true
  camMode: ModoCamara = 'seguir'
  onFrame?: (estado: EstadoReproductor) => void
  onEnd?: () => void
  // estado interno
  private vuelo?: Vuelo
  private t = 0
  private snap = true
  private touched = false
  private clock = 0
  private prev: number | null = null
  private raf = 0
  private eff = 4
  private _follow = true
  private quality: 'alta' | 'ligera' = 'alta'
  private readonly cam = { yaw: 0.9, pitch: 0.16, dist: 120, target: new THREE.Vector3(0, 300, 0) }
  private lastInteract = -1e9
  private drag: { x: number; y: number } | null = null
  // objetos
  private readonly contenedor: HTMLElement
  private readonly padRadius: number
  private readonly R: Recursos
  private readonly skyGroup = new THREE.Group()
  private readonly sunA = new THREE.Vector3(-0.82, 0.34, 0.46).normalize() // Alfa Centauri A: da la luz y las sombras
  private readonly sun: THREE.DirectionalLight
  private readonly beacons: THREE.Sprite[] = []
  private readonly guides = new THREE.Group()
  private readonly rocket = new THREE.Group()
  private readonly ships: Record<Cohete, Nave>
  private ship: Nave
  private readonly NOZZLE = new THREE.Vector3()
  private readonly plumeOuter: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly plumeInner: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly nozzleGlow: THREE.Sprite
  private readonly engineLight: THREE.PointLight
  private readonly groundGlow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private readonly scorch: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private scorchLevel = 0
  private readonly dust = new Particulas(900, 0xa8775a, 0.4, 5, 31, 1.4, -1.2)
  private readonly smoke = new Particulas(360, 0x2a2421, 0.6, 8, 55, 0.5, 1.5)
  private readonly flash: THREE.Sprite
  private readonly flashCore: THREE.Sprite
  private readonly flashLight: THREE.PointLight
  private flashT = 0
  private crashT = -1 // segundos desde el choque (−1: sin choque)
  private readonly fallDir = new THREE.Vector3()
  private readonly shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private readonly plumb: THREE.Line
  private readonly windArrow: THREE.ArrowHelper
  private trailFull: THREE.Line | null = null
  private trailDone: THREE.Line | null = null
  private readonly markers = new THREE.Group()
  private readonly ghosts = new THREE.Group()
  private readonly torres = new THREE.Group()
  private torreBeacons: THREE.Sprite[] = []
  private pasarela: { altura: number; materiales: THREE.Material[]; opacidades: number[] } | null = null
  private crashY = 0 // altura (m) a la que ocurrió el choque: suelo o, en una colisión con una torre, en el aire
  private readonly markerDone = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
  private readonly markerTodo = new THREE.MeshBasicMaterial({ color: 0x8fa3c0, transparent: true, opacity: 0.3 })
  private composer: EffectComposer | null = null
  private finalPass: ShaderPass | null = null
  // temporales
  private readonly S: Muestra = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, wx: 0, wy: 0, wz: 0, thr: 0 }
  private readonly axis = new THREE.Vector3()
  private readonly nozzle = new THREE.Vector3()
  private readonly hit = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()
  private readonly qTarget = new THREE.Quaternion()
  private readonly fallAxis = new THREE.Vector3()
  private readonly fallQ = new THREE.Quaternion()

  constructor(contenedor: HTMLElement, opciones: { padRadius?: number; startAltitude?: number } = {}) {
    this.contenedor = contenedor
    this.padRadius = opciones.padRadius ?? 10
    const R = (this.R = cargarRecursos(this.padRadius)), GLOW = R.GLOW
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }))
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    contenedor.appendChild(renderer.domElement)
    const scene = this.scene
    scene.fog = new THREE.FogExp2(col(0xc08a68).getHex(), 0.00019) // bruma de polvo en suspensión
    this.camera = new THREE.PerspectiveCamera(48, 1, 1, 30000)

    // cielo de un planeta de atmósfera fina a media tarde: polvo ocre en el horizonte, cénit oscuro, halo frío alrededor
    // del sol (dispersión del polvo fino) y los dos soles de Alfa Centauri. El grupo sigue a la cámara: queda en el infinito
    const sunA = this.sunA, sunB = new THREE.Vector3(0.55, 0.12, -0.83).normalize()
    scene.add(this.skyGroup)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { zenith: { value: col(0x1b1830) }, mid: { value: col(0x7b5246) }, horizon: { value: col(0xdba27c) }, halo: { value: col(0xd6dde6) }, sunA: { value: sunA }, sunB: { value: sunB } },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 zenith, mid, horizon, halo, sunA, sunB; varying vec3 vPos;
        void main(){ vec3 d = normalize(vPos); float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
          c = mix(c, zenith, smoothstep(0.15, 0.85, h));
          float a = max(dot(d, sunA), 0.0), b = max(dot(d, sunB), 0.0);
          c = mix(c, halo, pow(a, 12.0) * 0.35);
          c += vec3(1.0, 0.9, 0.75) * (pow(a, 4.0) * 0.16 + pow(a, 90.0) * 0.9);
          c += vec3(1.0, 0.97, 0.9) * smoothstep(0.99955, 0.99972, a) * 12.0;
          c += vec3(1.0, 0.6, 0.32) * pow(b, 40.0) * 0.4 + vec3(1.0, 0.82, 0.6) * smoothstep(0.99986, 0.99992, b) * 6.0;
          c *= 1.0 - 0.25 * smoothstep(0.0, -0.2, d.y);
          gl_FragColor = vec4(c, 1.0);${OUTPUT}}`,
    }))
    sky.renderOrder = -1; this.skyGroup.add(sky)
    { // unas pocas estrellas tenues en el cénit
      const rnd = mulberry32(7), n = 500, pos = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) { const th = rnd() * 2 * Math.PI, y = 0.45 + rnd() * 0.55, r = Math.sqrt(1 - y * y); pos.set([r * Math.cos(th) * 8600, y * 8600, r * Math.sin(th) * 8600], i * 3) }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this.skyGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, map: GLOW, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })))
    }
    { // gigante gaseoso con anillos, iluminado por Alfa Centauri A
      const giant = new THREE.Group()
      giant.position.copy(new THREE.Vector3(-0.35, 0.22, -0.91).normalize()).multiplyScalar(7000); giant.rotation.set(0.35, 0, 0.42); this.skyGroup.add(giant)
      giant.scale.setScalar(0.82)
      giant.add(new THREE.Mesh(new THREE.SphereGeometry(1250, 64, 32), new THREE.ShaderMaterial({
        uniforms: { light: { value: sunA } },
        vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 light; varying vec3 vN; varying vec3 vP;
          void main(){ float lat = vP.y / 1250.0;
            float bands = sin(lat * 22.0 + sin(lat * 7.0 + vP.x * 0.002) * 1.6) * 0.5 + 0.5;
            vec3 c = mix(vec3(0.42, 0.24, 0.13), vec3(0.86, 0.68, 0.48), bands);
            c = mix(c, vec3(0.62, 0.34, 0.18), smoothstep(0.6, 1.0, sin(lat * 51.0) * 0.5 + 0.5) * 0.35);
            float diff = smoothstep(-0.15, 0.35, dot(normalize(vN), light));
            c *= 0.03 + diff * 0.95;
            c = mix(c, vec3(0.64, 0.33, 0.19), 0.25);
            gl_FragColor = vec4(c, 1.0);${OUTPUT}}`,
      })))
      const rings = new THREE.Mesh(new THREE.RingGeometry(1650, 2750, 128, 1), new THREE.ShaderMaterial({
        side: THREE.DoubleSide, transparent: true, depthWrite: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec3 vP;
          void main(){ float r = (length(vP.xy) - 1650.0) / 1100.0;
            float a = (0.55 + 0.45 * sin(r * 61.0) * sin(r * 17.0 + 1.3)) * smoothstep(0.0, 0.06, r) * smoothstep(1.0, 0.85, r);
            a *= 1.0 - 0.8 * smoothstep(0.42, 0.46, r) * smoothstep(0.54, 0.50, r);
            gl_FragColor = vec4(vec3(0.72, 0.58, 0.42), a * 0.7);${OUTPUT}}`,
      }))
      rings.rotation.x = -Math.PI / 2 + 0.25; giant.add(rings)
    }
    { // mapa de entorno a partir del cielo y el suelo: reflejos creíbles en el metal y la pintura del cohete
      const envScene = new THREE.Scene()
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), sky.material))
      const floor = new THREE.Mesh(new THREE.CircleGeometry(50, 32), new THREE.MeshBasicMaterial({ color: 0x7a4a34 }))
      floor.rotation.x = -Math.PI / 2; floor.position.y = -6; envScene.add(floor)
      const pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromScene(envScene, 0.03).texture
      pmrem.dispose()
    }

    // luces: Alfa Centauri A (blanca, con sombras), Alfa Centauri B (naranja, de relleno) y el rebote rojizo del suelo
    // (intensidades × π respecto a la página original: three.js ya no escala las luces por π)
    scene.add(new THREE.HemisphereLight(0xe0b49a, 0x5a3426, 0.35 * Math.PI))
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0dc, 2.2 * Math.PI))
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 4000 })
    scene.add(sun, sun.target)
    const sun2 = new THREE.DirectionalLight(0xff9a55, 0.3 * Math.PI); sun2.position.copy(sunB).multiplyScalar(1000); scene.add(sun2)

    { // terreno con detalle fino en el shader
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, envMapIntensity: 0.5 })
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + DETAIL_GLSL)
          .replace('#include <color_fragment>', `#include <color_fragment>
            float dFade = smoothstep(450.0, 25.0, length(vViewPosition));
            vec2 dP = vWPos.xz;
            float dTone = dfbm(dP * 0.045), dGrain = dn(dP * 3.1);
            diffuseColor.rgb *= mix(0.92 + 0.16 * dTone, 0.70 + 0.55 * dTone + 0.16 * (dGrain - 0.5), dFade);`)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            float dH = detailH(dP, dFade) * dFade * 0.32;
            normal = perturbN(-vViewPosition, normal, vec2(dFdx(dH), dFdy(dH)));`)
      }
      const ground = new THREE.Mesh(R.terreno, mat)
      ground.receiveShadow = true; scene.add(ground)
    }
    { // rocas irregulares semienterradas: guijarros dentro de la zona de vuelo, bloques grandes fuera de ella
      const n = 520, rocks = new THREE.InstancedMesh(R.roca, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, envMapIntensity: 0.45 }), n)
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), at = new THREE.Vector3(), c = new THREE.Color(), base = col(0x5b3628)
      for (let k = 0; k < n; k++) {
        const small = k < 220, a = hash(k, 101) * 2 * Math.PI
        const r = small ? 50 + hash(k, 131) * 260 : 320 + Math.pow(hash(k, 131), 1.6) * 1300
        const sz = small ? 0.15 + Math.pow(hash(k, 151), 2) * 0.9 : 0.8 + Math.pow(hash(k, 151), 3) * 8
        const x = r * Math.cos(a), z = r * Math.sin(a)
        q.setFromEuler(e.set(hash(k, 171) * 6, hash(k, 191) * 6, hash(k, 211) * 6))
        s.set(sz * (0.8 + hash(k, 233) * 0.6), sz * (0.45 + hash(k, 251) * 0.4), sz)
        m.compose(at.set(x, terrainHeight(x, z) - sz * 0.18, z), q, s); rocks.setMatrixAt(k, m)
        rocks.setColorAt(k, c.copy(base).multiplyScalar(0.75 + hash(k, 271) * 0.5))
      }
      rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks)
    }
    { // zona de aterrizaje: losa de hormigón con el círculo del ambiente pintado, torres de luz y balizas
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R + 0.6, 0.6, 128), new THREE.MeshStandardMaterial({ map: R.padTex, roughness: 0.9, metalness: 0, envMapIntensity: 0.5 }))
      slab.position.y = PAD_TOP - 0.3; slab.receiveShadow = true; scene.add(slab)
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x9a9ca0, roughness: 0.5, metalness: 0.7 })
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe6b8, emissiveIntensity: 1.2 })
      for (let k = 0; k < 4; k++) { // torres de iluminación con baliza roja
        const a = (k / 4) * 2 * Math.PI + Math.PI / 4, x = 64 * Math.cos(a), z = 64 * Math.sin(a), y0 = terrainHeight(x, z)
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 16, 10), poleMat); pole.position.set(x, y0 + 8, z); pole.castShadow = true; scene.add(pole)
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.5), lampMat); lamp.position.set(x * 0.985, y0 + 16, z * 0.985); lamp.lookAt(0, 0, 0); lamp.castShadow = true; scene.add(lamp)
        const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xff2a1a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }))
        b.position.set(x, y0 + 16.9, z); b.scale.set(2.2, 2.2, 1); scene.add(b); this.beacons.push(b)
      }
      for (let k = 0; k < 20; k++) { // luces del borde de la losa
        const a = (k / 20) * 2 * Math.PI, s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffc46a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
        s.position.set((PAD_R + 0.9) * Math.cos(a), PAD_TOP + 0.25, (PAD_R + 0.9) * Math.sin(a)); s.scale.set(1.3, 1.3, 1); scene.add(s)
      }
    }
    // guías (se pueden ocultar): zona de vuelo, cuadrado de salida, trayectoria, pasos, viento y plomada
    scene.add(this.guides)
    for (let z = 200; z <= 1200; z += 200) this.guides.add(this.anillo(300, z, 0x5fd0ff, z % 600 === 0 ? 0.25 : 0.1))
    const startBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(100, 1, 100)), new THREE.LineBasicMaterial({ color: 0xaab8d6, transparent: true, opacity: 0.4 }))
    startBox.position.y = opciones.startAltitude ?? 600; this.guides.add(startBox)

    // cohetes: nave de acero inoxidable o primera etapa reutilizable. El origen está en los pies, que es el punto de la trayectoria
    scene.add(this.rocket)
    this.ships = { nave: this.construirNave(), propulsor: this.construirPropulsor() }
    this.ship = this.ships.nave
    const plumeGeo = new THREE.CylinderGeometry(0.42, 2.2, 1, 32, 1, true); plumeGeo.translate(0, -0.5, 0) // se abre: la atmósfera es fina
    const coreGeo = new THREE.CylinderGeometry(0.26, 0.42, 1, 24, 1, true); coreGeo.translate(0, -0.5, 0)
    this.plumeOuter = new THREE.Mesh(plumeGeo, plumeMaterial(false)); this.plumeInner = new THREE.Mesh(coreGeo, plumeMaterial(true))
    this.plumeOuter.renderOrder = 2; this.plumeInner.renderOrder = 3
    this.plumeOuter.frustumCulled = this.plumeInner.frustumCulled = false
    this.rocket.add(this.plumeOuter, this.plumeInner)
    this.nozzleGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffb070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.rocket.add(this.nozzleGlow)
    this.engineLight = new THREE.PointLight(0xffa060, 0, 160, 2); this.rocket.add(this.engineLight)
    this.setCohete('nave')
    this.groundGlow = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshBasicMaterial({ map: GLOW, color: 0xff9a50, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.groundGlow.rotation.x = -Math.PI / 2; scene.add(this.groundGlow)
    this.scorch = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ map: R.scorchTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
    this.scorch.rotation.x = -Math.PI / 2; this.scorch.visible = false; scene.add(this.scorch)
    scene.add(this.dust.points, this.smoke.points)
    // choque: bola de fuego, luz del estallido y humo negro
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.flashCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.flashLight = new THREE.PointLight(0xff8a30, 0, 400, 2)
    this.flash.visible = this.flashCore.visible = false; scene.add(this.flash, this.flashCore, this.flashLight)
    // marca en el suelo, plomada, viento, trayectoria y fantasmas
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(4, 24), new THREE.MeshBasicMaterial({ map: GLOW, color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2; this.guides.add(this.shadow)
    this.plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xbfd0ea, dashSize: 6, gapSize: 6, transparent: true, opacity: 0.35 }))
    this.plumb.frustumCulled = false; this.guides.add(this.plumb)
    this.windArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 20, 0x5fd0ff, 8, 5); this.guides.add(this.windArrow)
    this.guides.add(this.markers); scene.add(this.ghosts, this.torres)

    // posproceso: brillo de las luces intensas, tone mapping y, al final, viñeta, grano y aberración de lente
    if (renderer.capabilities.isWebGL2) {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
      this.composer = new EffectComposer(renderer, rt)
      this.composer.addPass(new RenderPass(scene, this.camera))
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.55, 0.85))
      this.composer.addPass(new OutputPass())
      this.finalPass = new ShaderPass(FINAL_SHADER); this.composer.addPass(this.finalPass)
    }

    // cámara orbital propia: objetivo + yaw/pitch/distancia; la cinematográfica se aparta 4 s cada vez que el usuario mueve la cámara
    const el = renderer.domElement
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', (ev) => { this.drag = { x: ev.clientX, y: ev.clientY }; el.setPointerCapture(ev.pointerId) })
    el.addEventListener('pointermove', (ev) => { if (!this.drag) return; this.lastInteract = performance.now(); this.cam.yaw -= (ev.clientX - this.drag.x) * 0.006; this.cam.pitch = Math.min(1.45, Math.max(-0.1, this.cam.pitch + (ev.clientY - this.drag.y) * 0.004)); this.drag = { x: ev.clientX, y: ev.clientY } })
    el.addEventListener('pointerup', () => (this.drag = null))
    el.addEventListener('pointercancel', () => (this.drag = null))
    el.addEventListener('wheel', (ev) => { ev.preventDefault(); this.lastInteract = performance.now(); this.cam.dist = Math.min(4000, Math.max(30, this.cam.dist * Math.exp(ev.deltaY * 0.001))) }, { passive: false })
    el.addEventListener('dblclick', () => { this.cam.yaw = 0.9; this.cam.pitch = 0.16; this.cam.dist = this._follow ? 120 : 1100 })
    new ResizeObserver(() => this.resize()).observe(contenedor)
    this.resize()
    this.raf = requestAnimationFrame(this.tick)
  }

  // ----- construcción de los cohetes -----
  private construirNave(): Nave { // nave de acero inoxidable (≈ 42 m de alto, Ø 6 m): morro ojival, aletas con losetas, 4 patas y 3 motores
    const R = this.R, g = new THREE.Group(); this.rocket.add(g)
    const RAD = 3, BASE = 3.2, TOP = 33, NOSE = 9.5
    const steel = ([map, orm]: THREE.Texture[]) => new THREE.MeshStandardMaterial({ map, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, envMapIntensity: 1.15 })
    const tiles = new THREE.MeshStandardMaterial({ map: R.tileTex, roughness: 0.85, metalness: 0 })
    const legSteel = new THREE.MeshStandardMaterial({ color: 0xb4b8bf, roughness: 0.35, metalness: 1 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.8, metalness: 0.2 })
    const bellMat = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.32, metalness: 0.95, side: THREE.DoubleSide })
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m }
    const skins = { body: R.skins.body.map(steel), nose: R.skins.nose.map(steel) }
    const body = mesh(new THREE.CylinderGeometry(RAD, RAD, TOP - BASE, 96, 1, true), skins.body[0], 0, (TOP + BASE) / 2, 0)
    const noseR = (y: number) => RAD * Math.pow(Math.max(0, 1 - Math.pow((y - TOP) / NOSE, 2)), 0.55) // ojiva roma
    const nosePts: THREE.Vector2[] = []; for (let k = 0; k <= 40; k++) { const y = TOP + (k / 40) * NOSE; nosePts.push(new THREE.Vector2(Math.max(1e-3, noseR(y)), y - TOP)) }
    const nose = mesh(new THREE.LatheGeometry(nosePts, 96), skins.nose[0], 0, TOP, 0)
    mesh(new THREE.CircleGeometry(RAD, 64), darkMat, 0, BASE, 0).rotation.x = Math.PI / 2 // escudo térmico de los motores
    const bell = bellGeometry(0.3, 0.68, 1.7)
    for (let k = 0; k < 3; k++) { const a = Math.PI / 2 + (k * 2 * Math.PI) / 3; mesh(bell, bellMat, 1.05 * Math.cos(a), BASE, 1.05 * Math.sin(a)) }
    const fwd = flapGeometry([[RAD - 0.15, 29.4], [RAD + 2.4, 30.8], [RAD + 2.6, 35.4], [noseR(38.3) - 0.15, 38.3]])
    const aft = flapGeometry([[RAD - 0.15, 4.0], [RAD + 3.0, 4.4], [RAD + 2.8, 7.4], [RAD - 0.15, 13.6]])
    for (const geo of [fwd, aft]) for (const rot of [0, Math.PI]) mesh(geo, tiles).rotation.y = rot
    for (let k = 0; k < 4; k++) { // patas: puntal principal de acero, pistón y pie ancho
      const leg = new THREE.Group(); leg.rotation.y = -(k / 4) * 2 * Math.PI; g.add(leg)
      const H = new THREE.Vector3(RAD - 0.3, 6.2, 0), F = new THREE.Vector3(RAD + 3.4, 0.5, 0), A = new THREE.Vector3(RAD - 0.2, 10.8, 0), P = H.clone().lerp(F, 0.55)
      beamMesh(leg, H, F, (L) => new THREE.CylinderGeometry(0.42, 0.34, L, 16), legSteel)
      beamMesh(leg, A, P, (L) => new THREE.CylinderGeometry(0.15, 0.15, L, 10), bellMat)
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.32, 24), darkMat); foot.position.set(RAD + 3.45, 0.16, 0); foot.castShadow = foot.receiveShadow = true; leg.add(foot)
    }
    return {
      group: g, nozzle: new THREE.Vector3(0, BASE - 1.7, 0), height: TOP + NOSE, plumeW: 2.3,
      heatShield: (on) => { body.material = skins.body[+on]; nose.material = skins.nose[+on] },
      onboard: { pos: new THREE.Vector3(0, 35.5, RAD + 0.9), aim: new THREE.Vector3(0, 0, RAD + 9), up: new THREE.Vector3(0, 0, 1) },
      plume: { inner: [new THREE.Color(1, 0.96, 1), new THREE.Color(0.72, 0.66, 1)], outer: [new THREE.Color(1, 0.6, 0.3), new THREE.Color(0.75, 0.28, 0.12)] }, // metano: núcleo azulado
    }
  }
  private construirPropulsor(): Nave { // primera etapa reutilizable (≈ 36 m, Ø 3,7 m) con las patas desplegadas
    const R = this.R, g = new THREE.Group(); this.rocket.add(g)
    const paint = new THREE.MeshStandardMaterial({ map: R.sootTex, roughness: 0.5, metalness: 0.05 })
    const carbon = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.42, metalness: 0.25 })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.8, metalness: 0.2 })
    const bellMat = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.32, metalness: 0.95, side: THREE.DoubleSide })
    const finMat = new THREE.MeshStandardMaterial({ map: R.gridTex, alphaTest: 0.5, color: 0x8e8e92, roughness: 0.45, metalness: 0.85, side: THREE.DoubleSide })
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m }
    add(new THREE.CylinderGeometry(1.85, 1.85, 27.1, 64, 1, true), paint, 0, 17.45, 0) // tanques
    add(new THREE.CylinderGeometry(1.86, 1.86, 5, 64), carbon, 0, 33.5, 0) // interetapa
    add(new THREE.CylinderGeometry(1.87, 1.92, 0.8, 64), darkMat, 0, 3.5, 0) // protección térmica de los motores
    add(new THREE.BoxGeometry(0.22, 26, 0.34), darkMat, 1.93 * Math.SQRT1_2, 17.6, 1.93 * Math.SQRT1_2).rotation.y = -Math.PI / 4 // conducto de cables
    const bell = bellGeometry(0.16, 0.43, 1.5)
    add(bell, bellMat, 0, 3.1, 0) // 9 motores: uno central y ocho alrededor
    for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * Math.PI; add(bell, bellMat, 1.25 * Math.cos(a), 3.1, 1.25 * Math.sin(a)) }
    for (let k = 0; k < 4; k++) { // aletas de rejilla desplegadas
      const a = (k / 4) * 2 * Math.PI + Math.PI / 4
      add(new THREE.BoxGeometry(1.5, 0.16, 1.25), finMat, 2.62 * Math.cos(a), 34.3, 2.62 * Math.sin(a)).rotation.y = -a
    }
    for (let k = 0; k < 4; k++) { // patas: panel de fibra de carbono, puntal telescópico y pie
      const leg = new THREE.Group(); leg.rotation.y = -(k / 4) * 2 * Math.PI; g.add(leg)
      const H = new THREE.Vector3(1.9, 4.2, 0), F = new THREE.Vector3(7.2, 0.35, 0), A = new THREE.Vector3(1.95, 10.5, 0), P = H.clone().lerp(F, 0.45)
      beamMesh(leg, H, F, (L) => new THREE.BoxGeometry(0.32, L, 0.85), carbon)
      beamMesh(leg, A, P, (L) => new THREE.CylinderGeometry(0.13, 0.13, L, 10), bellMat)
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.24, 20), darkMat); foot.position.set(7.25, 0.12, 0); foot.castShadow = true; leg.add(foot)
    }
    return {
      group: g, nozzle: new THREE.Vector3(0, 1.6, 0), height: 36, plumeW: 1,
      onboard: { pos: new THREE.Vector3(0, 31, 3.4), aim: new THREE.Vector3(0, 0, 10), up: new THREE.Vector3(0, 0, 1) },
      plume: { inner: [new THREE.Color(1, 0.95, 0.86), new THREE.Color(1, 0.6, 0.25)], outer: [new THREE.Color(1, 0.55, 0.18), new THREE.Color(0.85, 0.22, 0.05)] }, // queroseno: anaranjado
    }
  }
  private anillo(r: number, y: number, hex: number, opacity: number) {
    const pts: THREE.Vector3[] = []; for (let k = 0; k <= 128; k++) pts.push(new THREE.Vector3(r * Math.cos((k / 128) * 2 * Math.PI), y, r * Math.sin((k / 128) * 2 * Math.PI)))
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity }))
  }

  // ----- opciones -----
  /** Cambia el modelo dibujado; el penacho y la luz del motor se mueven a su tobera. */
  setCohete(name: Cohete) {
    this.ship = this.ships[name]
    for (const k of Object.keys(this.ships) as Cohete[]) this.ships[k].group.visible = k === name
    this.NOZZLE.copy(this.ship.nozzle)
    this.plumeOuter.position.copy(this.NOZZLE); this.plumeInner.position.copy(this.NOZZLE)
    this.nozzleGlow.position.copy(this.NOZZLE).y -= 0.6; this.engineLight.position.copy(this.NOZZLE).y -= 3.6
    this.plumeInner.material.uniforms.c0.value.copy(this.ship.plume.inner[0]); this.plumeInner.material.uniforms.c1.value.copy(this.ship.plume.inner[1])
    this.plumeOuter.material.uniforms.c0.value.copy(this.ship.plume.outer[0]); this.plumeOuter.material.uniforms.c1.value.copy(this.ship.plume.outer[1])
    this.snap = true
  }
  /** Torres del nivel 2 (o ninguna): acero con franjas de señalización, plataforma superior y baliza roja. */
  setObstaculos(lista: Obstaculo[]) {
    this.torres.clear(); this.torreBeacons = []; this.pasarela = null
    const acero = new THREE.MeshStandardMaterial({ map: this.R.franjasTex, roughness: 0.55, metalness: 0.75, envMapIntensity: 0.8 })
    const oscuro = new THREE.MeshStandardMaterial({ color: 0x3a3c41, roughness: 0.6, metalness: 0.7 })
    for (const o of lista) {
      if (o.tipo === 'pasarela') { this.construirPasarela(o, oscuro); continue }
      const g = new THREE.Group(); g.position.copy(V(o.x, o.y, terrainHeight(o.x, -o.y)))
      const mat = acero.clone(); mat.map = this.R.franjasTex.clone(); mat.map.repeat.set(1, o.altura / 40); mat.map.needsUpdate = true
      const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(o.radio * 0.85, o.radio, o.altura, 32, 1, false), mat)
      cuerpo.position.y = o.altura / 2; cuerpo.castShadow = cuerpo.receiveShadow = true; g.add(cuerpo)
      for (let y = 40; y < o.altura; y += 40) { // anillos de refuerzo
        const r = o.radio * (1 - 0.15 * (y / o.altura)) + 0.4
        const anillo = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 8, 48), oscuro); anillo.rotation.x = Math.PI / 2; anillo.position.y = y; anillo.castShadow = true; g.add(anillo)
      }
      const tapa = new THREE.Mesh(new THREE.CylinderGeometry(o.radio * 0.85 + 1.6, o.radio * 0.85 + 1.6, 1.4, 32), oscuro); tapa.position.y = o.altura + 0.7; tapa.castShadow = true; g.add(tapa)
      const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 8, 8), oscuro); mastil.position.y = o.altura + 5; g.add(mastil)
      const baliza = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.R.GLOW, color: 0xff2a1a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }))
      baliza.position.y = o.altura + 9.5; baliza.scale.set(6, 6, 1); g.add(baliza); this.torreBeacons.push(baliza)
      for (let y = 60; y < o.altura; y += 60) { // luces de obstáculo a media altura
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.R.GLOW, color: 0xff6a3a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
        s.position.set(o.radio + 0.8, y, 0); s.scale.set(3, 3, 1); g.add(s)
      }
      this.torres.add(g)
    }
  }
  /** Pasarela: tablero translúcido con la abertura, celosía de vigas, baranda y luces en el borde de la abertura. El tablero
   *  y las vigas se vuelven casi transparentes cuando quedan entre la cámara y el cohete, para no taparlo. */
  private construirPasarela(o: Obstaculo, oscuro: THREE.Material) {
    const g = new THREE.Group(), R = o.radio, H = o.altura, grosor = o.grosor ?? 3, ra = o.radio_abertura ?? 12
    const forma = new THREE.Shape(); forma.absarc(0, 0, R, 0, Math.PI * 2, false)
    const hueco = new THREE.Path(); hueco.absarc(o.x, -o.y, ra, 0, Math.PI * 2, true); forma.holes.push(hueco)
    const tablero = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: grosor, bevelEnabled: false, curveSegments: 96 }),
      new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.6 }))
    tablero.rotation.x = Math.PI / 2; tablero.position.y = H + grosor / 2; tablero.renderOrder = 1; g.add(tablero)
    const vigaMat = new THREE.MeshStandardMaterial({ color: 0x5c6069, roughness: 0.5, metalness: 0.8, transparent: true, opacity: 0.9 })
    for (let k = 0; k < 12; k++) { // vigas radiales bajo el tablero
      const a = (k / 12) * Math.PI * 2, viga = new THREE.Mesh(new THREE.BoxGeometry(R - 14, 1.6, 1.0), vigaMat)
      viga.position.set(Math.cos(a) * (R + 14) / 2, H - grosor / 2 - 0.8, Math.sin(a) * (R + 14) / 2); viga.rotation.y = -a; viga.castShadow = true; g.add(viga)
    }
    for (const r of [R * 0.45, R * 0.75, R - 0.6]) { // anillos de la celosía y borde
      const anillo = new THREE.Mesh(new THREE.TorusGeometry(r, 0.7, 8, 128), vigaMat); anillo.rotation.x = Math.PI / 2; anillo.position.y = H - grosor / 2 - 0.8; g.add(anillo)
    }
    const baranda = new THREE.Mesh(new THREE.TorusGeometry(R - 1, 0.25, 6, 128), oscuro); baranda.rotation.x = Math.PI / 2; baranda.position.y = H + grosor + 1.2; g.add(baranda)
    const borde = new THREE.Mesh(new THREE.TorusGeometry(ra + 0.4, 0.6, 8, 64), new THREE.MeshStandardMaterial({ color: 0xc8c4bb, emissive: 0xb8372a, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.4 }))
    borde.rotation.x = Math.PI / 2; borde.position.set(o.x, H + grosor / 2, -o.y); g.add(borde)
    for (let k = 0; k < 12; k++) { // luces alrededor de la abertura, para verla desde arriba y desde abajo
      const a = (k / 12) * Math.PI * 2, s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.R.GLOW, color: k % 2 ? 0xff6a3a : 0xfff0c8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
      s.position.set(o.x + Math.cos(a) * (ra + 1.2), H + grosor / 2 + 0.6, -o.y + Math.sin(a) * (ra + 1.2)); s.scale.set(4, 4, 1); g.add(s); this.torreBeacons.push(s)
    }
    this.torres.add(g)
    this.pasarela = { altura: H, materiales: [tablero.material, vigaMat], opacidades: [0.42, 0.9] }
  }
  /** Escudo térmico de la nave (losetas negras en la mitad −z). */
  setEscudo(on: boolean) { this.ships.nave.heatShield?.(on) }
  /** "alta": sombras, posproceso y resolución nativa; "ligera": para equipos lentos. */
  setCalidad(alta: boolean) {
    this.quality = alta ? 'alta' : 'ligera'
    const pr = alta ? Math.min(devicePixelRatio || 1, 2) : 1
    this.renderer.setPixelRatio(pr); this.composer?.setPixelRatio(pr)
    this.sun.castShadow = alta
    this.resize()
  }
  setGuias(on: boolean) { this.guides.visible = on }
  setCamara(modo: ModoCamara) { this.camMode = modo; this.snap = true }
  get follow() { return this._follow }
  set follow(v: boolean) { this._follow = v; this.cam.dist = v ? 120 : 1100; if (!v) this.cam.target.set(0, 300, 0) }

  private resize() {
    const w = this.contenedor.clientWidth, h = this.contenedor.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false); this.composer?.setSize(w, h)
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix()
  }

  // ----- vuelos -----
  private posiciones(v: Vuelo) {
    const n = v.f.t.length, arr = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) { arr[k * 3] = v.f.x[k]; arr[k * 3 + 1] = v.f.z[k]; arr[k * 3 + 2] = -v.f.y[k] }
    return arr
  }
  /** Carga una trayectoria y la reproduce desde el principio; la anterior queda como fantasma. */
  cargar(vuelo: Vuelo, reproducir = true) {
    if (this.vuelo && this.trailFull && this.fantasmas) this.fantasma(this.vuelo)
    this.vuelo = vuelo; this.t = 0; this.playing = reproducir; this.snap = true; this.touched = false
    if (!reproducir) this.t = vuelo.f.t.length - 1
    if (this.trailFull && this.trailDone) { this.guides.remove(this.trailFull, this.trailDone); this.trailFull.geometry.dispose(); this.trailDone.geometry.dispose() }
    const pos = this.posiciones(vuelo)
    const g1 = new THREE.BufferGeometry(); g1.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.trailFull = new THREE.Line(g1, new THREE.LineBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.12 }))
    this.trailDone = new THREE.Line(g2, new THREE.LineBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.5 }))
    this.guides.add(this.trailFull, this.trailDone)
    this.markers.clear()
    for (const m of vuelo.step_marks) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), this.markerTodo)
      s.position.set(pos[m.i * 3], pos[m.i * 3 + 1], pos[m.i * 3 + 2]); s.userData.i = m.i; this.markers.add(s)
    }
    this.resetEffects()
  }
  private fantasma(v: Vuelo) {
    const hex = COLOR_RESULTADO[v.reason] ?? 0xffffff, pos = this.posiciones(v), n = v.f.t.length
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.ghosts.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.45 })))
    const end = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.R.GLOW, color: hex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    end.position.set(pos[(n - 1) * 3], pos[(n - 1) * 3 + 1] + 1.5, pos[(n - 1) * 3 + 2]); end.scale.set(10, 10, 1); this.ghosts.add(end)
  }
  limpiarFantasmas() { this.ghosts.clear() }
  get numeroFantasmas() { return this.ghosts.children.length / 2 }
  private resetEffects() { this.dust.reset(); this.smoke.reset(); this.flashT = 0; this.crashT = -1; this.scorchLevel = 0 }

  get indice() { return this.vuelo ? Math.min(Math.round(this.t), this.vuelo.f.t.length - 1) : 0 }
  get total() { return this.vuelo ? this.vuelo.f.t.length : 0 }
  ir(indice: number) { this.t = Math.max(0, Math.min(indice, this.total - 1)); this.playing = false; this.snap = true }
  reiniciar() { this.t = 0; this.playing = true; this.snap = true; this.touched = false; this.resetEffects() }

  private estado(): EstadoReproductor {
    const v = this.vuelo!, i = this.indice
    let k = v.step_marks.findIndex((m) => m.i >= i); if (k < 0) k = v.step_marks.length - 1
    const paso = i === 0 ? 0 : k + 1
    return { indice: i, paso, etiqueta: i === 0 ? '—' : v.step_marks[k].label, terminado: i >= v.f.t.length - 1,
      recompensaAcumulada: v.step_marks.filter((m) => m.i <= i).reduce((a, m) => a + m.r, 0), velocidadEfectiva: this.eff }
  }

  private placeCamera() {
    const t = this.cam.target, c = this.cam, cam = this.camera
    cam.position.set(t.x + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), t.y + c.dist * Math.sin(c.pitch), t.z + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw))
    const h = terrainHeight(cam.position.x, cam.position.z) + 4
    if (cam.position.y < h) cam.position.y = h
    cam.lookAt(t)
  }
  private touchdown(v: Vuelo, n: number, p: THREE.Vector3) { // nube de polvo al tocar suelo y destello si es un choque (solo al llegar reproduciendo)
    if (this.t < n - 1) { this.touched = false; return }
    if (this.touched) return
    this.touched = true
    if (this.snap) return
    const crash = v.reason === 'choque', colision = v.reason === 'colisión'
    if (v.f.z[n - 1] <= 0.5) this.dust.emit(p.x, 0.6, p.z, crash ? 380 : 200, crash ? 48 : 26, 5, 1.5 + (crash ? 48 : 26) * 0.09, 2.2)
    if (crash || colision) { // bola de fuego en el suelo o contra la torre; el cohete se vuelca hacia donde estaba inclinado
      this.flashT = 1.2; this.crashT = 0; this.crashY = colision ? p.y : 0
      this.fallDir.set(this.axis.x, 0, this.axis.z); if (this.fallDir.lengthSq() < 1e-4) this.fallDir.set(1, 0, 0); this.fallDir.normalize()
      if (colision) this.smoke.emit(p.x, p.y + 10, p.z, 40, 6, 4, 4, 6)
    }
  }

  private dibujar(dt: number, simDt: number, fxDt: number) {
    const v = this.vuelo
    if (!v) { this.skyGroup.position.copy(this.camera.position); this.renderer.render(this.scene, this.camera); return }
    this.clock += dt
    const { axis, nozzle, hit, tmp, qTarget, rocket, ship } = this
    const f = v.f, n = f.t.length, s = sampleAt(f, this.t, this.S), i = Math.min(Math.floor(this.t), n - 1)
    const ground = Math.hypot(s.x, s.y) < PAD_R ? PAD_TOP : 0 // sobre la losa, el cohete apoya en el hormigón
    const p = V(s.x, s.y, s.z + ground)
    rocket.position.copy(p)
    // el eje gira con suavidad hacia la dirección de empuje grabada (solo el dibujo; la telemetría muestra el dato exacto)
    qTarget.setFromUnitVectors(UP, axis.set(s.dx, s.dz, -s.dy).normalize())
    if (this.snap) rocket.quaternion.copy(qTarget); else rocket.quaternion.slerp(qTarget, 1 - Math.exp(-simDt / 0.35))
    if (this.crashT >= 0) { // tras un choque el cohete se vuelca sobre sus pies (solo visual: los datos terminan en el contacto)
      this.crashT += dt
      this.fallQ.setFromAxisAngle(this.fallAxis.crossVectors(UP, this.fallDir).normalize(), 1.42 * Math.pow(Math.min(1, this.crashT / 1.7), 2))
      rocket.quaternion.copy(qTarget).premultiply(this.fallQ)
      if (this.crashT < 7) this.smoke.emit(p.x + this.fallDir.x * ship.height * 0.3, this.crashY + 2, p.z + this.fallDir.z * ship.height * 0.3, Math.random() < dt * 30 ? 1 : 0, 2, 6, 6, 7)
    }
    rocket.updateMatrixWorld()
    axis.copy(UP).applyQuaternion(rocket.quaternion)
    nozzle.copy(this.NOZZLE).applyMatrix4(rocket.matrixWorld)

    // motor: penacho, brillo de la tobera y luz sobre patas y suelo; el penacho no atraviesa el suelo
    const ended = this.t >= n - 1 // al tocar suelo se corta el motor
    const thr = this.crashT >= 0 || ended ? 0 : s.thr, flick = this.playing && thr > 0 ? 0.92 + Math.random() * 0.16 : 1
    const hN = Math.max(0.2, nozzle.y - ground), toGround = hN / Math.max(0.25, axis.y)
    const L = thr > 0 ? Math.min((8 + 30 * thr) * flick, toGround + 1.5) : 0
    this.plumeOuter.visible = this.plumeInner.visible = this.nozzleGlow.visible = L > 0.05
    const pw = ship.plumeW
    this.plumeOuter.scale.set((1 + 0.4 * thr) * pw, Math.max(L, 0.01), (1 + 0.4 * thr) * pw)
    this.plumeInner.scale.set(pw, Math.max(Math.min(L, 6 + 14 * thr), 0.01), pw)
    for (const m of [this.plumeOuter, this.plumeInner]) { m.material.uniforms.time.value = this.clock; m.material.uniforms.power.value = thr > 0 ? (0.35 + 0.65 * thr) * flick : 0 }
    this.nozzleGlow.scale.setScalar((2.5 + 5 * thr) * flick * Math.sqrt(pw))
    this.engineLight.intensity = 3 * Math.PI * thr * flick
    hit.copy(nozzle).addScaledVector(axis, -toGround) // donde el chorro toca el suelo
    const near = thr * smooth(45, 0, hN)
    this.groundGlow.position.set(hit.x, ground + 0.06, hit.z); this.groundGlow.material.opacity = 0.9 * near * flick; this.groundGlow.scale.setScalar(0.6 + 2.2 * smooth(45, 0, hN))
    if (near > 0 && simDt > 0) {
      const want = 320 * near * simDt, speed = 25 + 35 * near
      this.dust.emit(hit.x, 0.6, hit.z, Math.floor(want) + (Math.random() < want % 1 ? 1 : 0), speed, 1.5 + hN * 0.1, 1.5 + speed * 0.09, 2.2)
      this.scorchLevel = Math.min(0.8, this.scorchLevel + near * simDt * 0.12); this.scorch.position.set(hit.x, ground + 0.04, hit.z)
    }
    this.scorch.material.opacity = this.scorchLevel; this.scorch.visible = this.scorchLevel > 0.01
    this.touchdown(v, n, p)
    this.dust.update(fxDt, s.wx, s.wz, -s.wy); this.smoke.update(fxDt, s.wx, s.wz, -s.wy)
    if (this.flashT > 0) { // bola de fuego: crece rápido y se apaga en 1,2 s
      this.flashT = Math.max(0, this.flashT - dt)
      const u = 1 - this.flashT / 1.2, fd = this.fallDir
      this.flash.position.set(p.x + fd.x * 6, this.crashY + 8 + 10 * u, p.z + fd.z * 6); this.flash.scale.setScalar(30 + 80 * Math.sqrt(u)); this.flash.material.opacity = Math.min(1, 1.6 * Math.pow(1 - u, 1.2))
      this.flashCore.position.copy(this.flash.position); this.flashCore.scale.setScalar(16 + 36 * Math.sqrt(u)); this.flashCore.material.opacity = Math.min(1, 1.4 * Math.pow(1 - u, 2))
      this.flashLight.position.copy(this.flash.position); this.flashLight.intensity = 8 * Math.PI * Math.pow(1 - u, 2)
    } else this.flashLight.intensity = 0
    this.flash.visible = this.flashCore.visible = this.flashT > 0
    const blink = Math.sin(this.clock * 2.6) > 0.55 ? 1 : 0.08; for (const b of this.beacons) b.material.opacity = blink
    const blink2 = Math.sin(this.clock * 1.7 + 1) > 0.3 ? 1 : 0.15; for (const b of this.torreBeacons) b.material.opacity = blink2
    if (this.pasarela) { // si la pasarela queda entre la cámara y el cohete, se vuelve casi transparente
      const tapa = (this.camera.position.y > this.pasarela.altura) !== (p.y + ship.height * 0.5 > this.pasarela.altura)
      this.pasarela.materiales.forEach((m, k) => { const objetivo = tapa ? this.pasarela!.opacidades[k] * 0.22 : this.pasarela!.opacidades[k]; m.opacity += (objetivo - m.opacity) * Math.min(1, dt * 6) })
    }

    // guías
    this.shadow.position.set(p.x, ground + 0.05, p.z); this.shadow.scale.setScalar(1 + s.z / 150); this.shadow.material.opacity = 0.18 * smooth(400, 0, s.z)
    const pp = this.plumb.geometry.attributes.position as THREE.BufferAttribute; pp.setXYZ(0, p.x, p.y, p.z); pp.setXYZ(1, p.x, ground + 0.05, p.z); pp.needsUpdate = true; this.plumb.computeLineDistances()
    const wl = Math.hypot(s.wx, s.wy, s.wz)
    this.windArrow.position.copy(p).y += 18; this.windArrow.setDirection(tmp.set(s.wx, s.wz, -s.wy).normalize()); this.windArrow.setLength(Math.min(90, Math.max(6, wl * 4)), 5, 2.5); this.windArrow.visible = wl > 0.3
    this.trailDone!.geometry.setDrawRange(0, i + 1)
    for (const mk of this.markers.children as THREE.Mesh[]) mk.material = mk.userData.i <= i ? this.markerDone : this.markerTodo

    // el mapa de sombras del sol se centra donde cae la sombra del cohete
    tmp.copy(p).addScaledVector(this.sunA, -p.y / this.sunA.y); this.sun.target.position.copy(tmp); this.sun.position.copy(tmp).addScaledVector(this.sunA, 2500)

    // cámaras
    const camera = this.camera, cam = this.cam, vib = this.playing ? thr * (1 + 2 * smooth(60, 0, hN)) : 0
    let fov = 48, nearPlane = 1
    if (this.camMode === 'abordo') {
      camera.up.copy(ship.onboard.up).applyQuaternion(rocket.quaternion)
      camera.position.copy(ship.onboard.pos).applyMatrix4(rocket.matrixWorld)
      tmp.copy(ship.onboard.aim).applyMatrix4(rocket.matrixWorld); tmp.x += shake(this.clock, 0.05 * vib); tmp.z += shake(this.clock + 3.1, 0.05 * vib)
      camera.lookAt(tmp); fov = 68; nearPlane = 0.3
    } else if (this.camMode === 'torre') { // torre de seguimiento con teleobjetivo, entre dos torres de luz
      camera.up.set(0, 1, 0); camera.position.set(0, terrainHeight(0, 185) + 3, 185)
      tmp.copy(p); tmp.y += ship.height * 0.5
      cam.target.lerp(tmp, this.snap || !this.playing ? 1 : 1 - Math.exp(-dt * 3))
      const dist = camera.position.distanceTo(cam.target), sway = 0.002 * dist * (0.3 + vib) // operador con teleobjetivo
      tmp.copy(cam.target); tmp.x += shake(this.clock * 0.07, sway); tmp.y += shake(this.clock * 0.05 + 1.7, sway)
      camera.lookAt(tmp); fov = THREE.MathUtils.clamp((2 * Math.atan((ship.height * 0.8) / dist) * 180) / Math.PI, 3.5, 40)
    } else {
      camera.up.set(0, 1, 0)
      if (this._follow) { tmp.copy(p); tmp.y += ship.height * 0.45; cam.target.lerp(tmp, this.snap || !this.playing ? 1 : 1 - Math.exp(-dt * (4 + this.speed))) }
      if (this.cine && this._follow && this.playing && performance.now() - this.lastInteract > 4000) {
        // órbita lenta; la cámara baja y se acerca a medida que el cohete se aproxima al suelo
        const k = 1 - Math.exp(-dt * 0.8)
        cam.yaw += dt * 0.06
        cam.dist += (75 + Math.min(s.z, 600) * 0.16 - cam.dist) * k
        cam.pitch += (0.05 + 0.22 * smooth(0, 400, s.z) - cam.pitch) * k
      }
      this.placeCamera()
      camera.position.x += shake(this.clock, 0.1 * vib); camera.position.y += shake(this.clock + 2.3, 0.1 * vib)
    }
    if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== nearPlane) {
      camera.fov = this.snap ? fov : camera.fov + (fov - camera.fov) * (1 - Math.exp(-dt * 4)); camera.near = nearPlane; camera.updateProjectionMatrix()
    }
    this.skyGroup.position.copy(camera.position)
    if (this.composer && this.quality === 'alta') { this.finalPass!.uniforms.time.value = this.clock; this.composer.render(dt) } else this.renderer.render(this.scene, camera)
    this.snap = false
  }

  private tick = (ts: number) => {
    const dt = this.prev === null ? 0 : Math.min(0.1, (ts - this.prev) / 1000)
    let simDt = 0, fin = false
    if (this.vuelo) {
      const n = this.vuelo.f.t.length
      // cámara lenta: por debajo de 80 m la reproducción baja hasta un 30 % de la velocidad elegida
      this.eff = this.speed * (this.slowmo ? 0.3 + 0.7 * smooth(0, 80, this.vuelo.f.z[this.indice]) : 1)
      if (this.playing && this.prev !== null) {
        simDt = dt * this.eff
        this.t += simDt / DT
        if (this.t >= n - 1) { this.t = n - 1; this.playing = false; fin = true }
      }
    }
    this.prev = ts
    this.dibujar(dt, simDt, this.playing ? dt * this.eff : dt)
    if (this.vuelo) this.onFrame?.(this.estado())
    if (fin) this.onEnd?.()
    this.raf = requestAnimationFrame(this.tick)
  }

  destruir() { cancelAnimationFrame(this.raf); this.composer?.dispose(); this.renderer.dispose(); this.renderer.domElement.remove() }
}
