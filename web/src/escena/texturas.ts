// Texturas pintadas en canvas (sin archivos externos): losa de aterrizaje, piel de acero de los cohetes, losetas térmicas,
// toberas, brillo y niebla. Se generan una vez por sesión y las comparten todos los reproductores.
import * as THREE from 'three'
import { mulberry32, vnoise } from './ruido'

export const PAD_R = 42, PAD_TOP = 0.25 // losa de aterrizaje (m) y altura de su cara superior
type Pintar = (g: CanvasRenderingContext2D, w: number, h: number) => void
export function canvasTexture(w: number, h: number, paint: Pintar, srgb = true) {
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
/** Bocanada de niebla: gradiente radial roto por ruido, para bancos de bruma alrededor de las islas flotantes. */
function nieblaTexture() {
  return canvasTexture(256, 256, (g, W) => {
    const img = g.createImageData(W, W), d = img.data
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const dx = x / W - 0.5, dy = y / W - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2
      let n = 0, a = 0.5, f = 4; for (let o = 0; o < 5; o++) { n += a * vnoise(x / W * f + 11, y / W * f + 3); a *= 0.5; f *= 2 }
      const v = Math.max(0, (1 - r) * (0.35 + n)) ** 1.6, i = (y * W + x) * 4
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.min(255, v * 255)
    }
    g.putImageData(img, 0, 0)
  })
}

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
// piel de acero: anillos soldados cada 1,8 m, paneles con brillo distinto, tinte de revenido del calor cerca de los motores,
// rotulación y, con tiles, la mitad −z cubierta de losetas. Devuelve [color, orm] (orm: verde = rugosidad, azul = metálico)
interface OpcionesPiel { hatch?: [number, number]; raceway?: boolean; soot?: boolean; tiles: boolean; calor?: boolean; letras?: boolean }
function steelSkin(rnd: () => number, W: number, H: number, circ: number, tall: number, opts: OpcionesPiel) {
  const sx = W / circ, sy = H / tall, rings = Math.ceil(tall / 1.8), cols = 6
  const panel: [number, number][] = []; for (let k = 0; k < rings * cols; k++) panel.push([rnd(), rnd()])
  const paint = (orm: boolean): Pintar => (g) => {
    g.setTransform(sx, 0, 0, sy, 0, 0)
    for (let r = 0; r < rings; r++) for (let c = 0; c < cols; c++) {
      const [a, b] = panel[r * cols + c], x = (c / cols) * circ, y = tall - (r + 1) * 1.8
      if (orm) g.fillStyle = `rgb(0,${(70 + a * 30) | 0},255)`
      else { const l = 184 + a * 12, warm = (b - 0.5) * 6; g.fillStyle = `rgb(${(l + warm) | 0},${(l + 2) | 0},${(l + 7 - warm) | 0})` }
      g.fillRect(x, y, circ / cols + 0.01, 1.81)
    }
    g.fillStyle = orm ? 'rgb(0,150,210)' : 'rgba(64,66,74,0.6)' // soldaduras
    for (let r = 1; r <= rings; r++) g.fillRect(0, tall - r * 1.8 - 0.025, circ, 0.05)
    for (let c = 0; c < cols; c++) g.fillRect((c / cols) * circ - 0.02, 0, 0.04, tall)
    if (!orm) {
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '40,40,48'},${0.03 + rnd() * 0.05})`; g.fillRect(rnd() * circ, rnd() * tall, 0.02 + rnd() * 0.05, 0.5 + rnd() * 4) } // pulido
      for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(96,92,120,${0.04 + rnd() * 0.08})`; g.fillRect(rnd() * circ, tall - rnd() * 7, 0.05 + rnd() * 0.2, rnd() * 3) } // polvo violáceo del planeta
      if (opts.calor) { // revenido del acero: azul, violeta, bronce y paja según la distancia a los motores
        const grd = g.createLinearGradient(0, tall, 0, tall - 7)
        grd.addColorStop(0, 'rgba(62,74,140,0.42)'); grd.addColorStop(0.22, 'rgba(120,84,140,0.32)'); grd.addColorStop(0.48, 'rgba(168,118,70,0.26)'); grd.addColorStop(0.75, 'rgba(204,176,112,0.14)'); grd.addColorStop(1, 'rgba(204,176,112,0)')
        g.fillStyle = grd; g.fillRect(0, tall - 7, circ, 7)
      }
    }
    if (opts.raceway) { g.fillStyle = orm ? 'rgb(0,110,255)' : '#9a9ea8'; g.fillRect(circ * 0.07, tall * 0.08, 0.32, tall * 0.88) }
    if (opts.soot) { const grd = g.createLinearGradient(0, tall, 0, tall - 5); grd.addColorStop(0, orm ? 'rgba(0,200,160,0.9)' : 'rgba(24,22,28,0.8)'); grd.addColorStop(1, orm ? 'rgba(0,200,160,0)' : 'rgba(24,22,28,0)'); g.fillStyle = grd; g.fillRect(0, tall - 5, circ, 5) }
    if (opts.hatch) for (const x of [-0.55, circ - 0.55]) { // escotilla en la cara de acero (u = 0)
      const [y0, y1] = opts.hatch
      g.fillStyle = orm ? 'rgb(0,150,140)' : '#3a3c44'; g.fillRect(x - 0.08, tall - y1 - 0.08, 1.26, y1 - y0 + 0.16)
      g.fillStyle = orm ? 'rgb(0,90,40)' : '#141519'; g.fillRect(x, tall - y1, 1.1, y1 - y0)
    }
    if (opts.letras) { // rotulación de la misión en vertical, sobre el acero (pintura mate)
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0)
      g.translate(circ * 0.165 * sx, (tall - 8.5) * sy); g.rotate(-Math.PI / 2); g.scale(sy / sx, 1)
      g.fillStyle = orm ? 'rgb(0,215,30)' : 'rgba(22,24,30,0.86)'; g.font = `800 ${0.95 * sx}px "Arial Black", "Helvetica Neue", Arial, sans-serif`; g.textBaseline = 'middle'
      g.fillText('E L Y N D R A', 0, 0)
      g.font = `700 ${0.42 * sx}px "Helvetica Neue", Arial, sans-serif`; g.fillText('EXPLORACIÓN · ALFA CENTAURI · EL-01', 0, 0.95 * sx)
      g.restore()
    }
    if (opts.tiles) { if (orm) { g.fillStyle = 'rgb(0,215,0)'; g.fillRect(circ * 0.25, 0, circ * 0.5, tall) } else hexTiles(g, rnd, circ * 0.25, 0, circ * 0.75, tall) }
  }
  return [canvasTexture(W, H, paint(false)), canvasTexture(W, H, paint(true), false)]
}

export interface Texturas {
  GLOW: THREE.Texture; niebla: THREE.Texture; scorchTex: THREE.Texture; franjasTex: THREE.Texture
  skins: { body: THREE.Texture[][]; nose: THREE.Texture[][] }; tileTex: THREE.Texture; sootTex: THREE.Texture; gridTex: THREE.Texture
  toberaRelieve: THREE.Texture; toberaCalor: THREE.Texture
}
let cache: Texturas | null = null
const padCache = new Map<number, THREE.Texture>()
/** Losa de material compuesto oscuro con el círculo de éxito del ambiente (radio de la API) pintado en cian. */
export function texturaPlataforma(padRadius: number) {
  if (padCache.has(padRadius)) return padCache.get(padRadius)!
  const rnd = mulberry32(20261108)
  const tex = canvasTexture(2048, 2048, (g, W, H) => {
    const cx = W / 2, cy = H / 2, px = W / (2 * PAD_R) // píxeles por metro
    g.fillStyle = '#4b4e5a'; g.fillRect(0, 0, W, H)
    for (let k = 0; k < 2600; k++) { const l = 62 + rnd() * 44; g.fillStyle = `rgba(${l | 0},${(l + 2) | 0},${(l + 9) | 0},${0.05 + rnd() * 0.07})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, 4 + rnd() * 40, 0, 7); g.fill() }
    const img = g.getImageData(0, 0, W, H), d = img.data
    for (let i = 0; i < d.length; i += 4) { const v = (rnd() - 0.5) * 18; d[i] += v; d[i + 1] += v; d[i + 2] += v }
    g.putImageData(img, 0, 0)
    g.strokeStyle = 'rgba(18,20,26,0.6)'; g.lineWidth = 2.4 // juntas de las losas cada 6 m
    for (let m = -PAD_R; m <= PAD_R; m += 6) { const q = cx + m * px; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, H); g.stroke(); g.beginPath(); g.moveTo(0, q); g.lineTo(W, q); g.stroke() }
    for (let k = 0; k < 7; k++) { // quemaduras de aterrizajes anteriores
      const ox = cx + (rnd() - 0.5) * 14 * px, oy = cy + (rnd() - 0.5) * 14 * px, r = (6 + rnd() * 9) * px, grd = g.createRadialGradient(ox, oy, 0, ox, oy, r)
      grd.addColorStop(0, 'rgba(12,12,16,0.55)'); grd.addColorStop(0.5, 'rgba(20,20,26,0.24)'); grd.addColorStop(1, 'rgba(20,20,26,0)'); g.fillStyle = grd; g.fillRect(0, 0, W, H)
    }
    for (let k = 0; k < 240; k++) { // estrías radiales de hollín
      const a = rnd() * 2 * Math.PI, r0 = (2 + rnd() * 5) * px, r1 = r0 + (4 + rnd() * 16) * px
      g.strokeStyle = `rgba(14,14,18,${0.06 + rnd() * 0.1})`; g.lineWidth = 1 + rnd() * 4
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke()
    }
    g.globalAlpha = 0.92 // pintura: anillo exterior discontinuo, círculo de éxito en cian, flechas de aproximación y cruz
    g.strokeStyle = '#dfe7ea'; g.lineWidth = 0.6 * px; g.setLineDash([3.2 * px, 1.6 * px]); g.beginPath(); g.arc(cx, cy, (PAD_R - 3) * px, 0, 7); g.stroke(); g.setLineDash([])
    g.strokeStyle = '#42d9ce'; g.lineWidth = 0.6 * px; g.beginPath(); g.arc(cx, cy, padRadius * px, 0, 7); g.stroke()
    g.lineWidth = 0.18 * px; g.beginPath(); g.arc(cx, cy, padRadius * 0.55 * px, 0, 7); g.stroke()
    g.fillStyle = '#dfe7ea'
    for (let k = 0; k < 8; k++) { // chevrones que apuntan al centro entre los dos anillos
      const a = (k / 8) * Math.PI * 2, r = (padRadius + (PAD_R - 3 - padRadius) * 0.5) * px
      g.save(); g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.rotate(a + Math.PI / 2)
      g.beginPath(); g.moveTo(-1.6 * px, -0.8 * px); g.lineTo(0, 0.8 * px); g.lineTo(1.6 * px, -0.8 * px); g.lineTo(1.6 * px, -0.1 * px); g.lineTo(0, 1.5 * px); g.lineTo(-1.6 * px, -0.1 * px); g.closePath(); g.fill(); g.restore()
    }
    const L = padRadius * 0.7 * px, w = 0.45 * px; g.fillRect(cx - L, cy - w / 2, 2 * L, w); g.fillRect(cx - w / 2, cy - L, w, 2 * L)
    g.globalAlpha = 1
    for (let k = 0; k < 14000; k++) { g.fillStyle = `rgba(92,94,108,${0.2 + rnd() * 0.35})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3) } // desgaste
  })
  padCache.set(padRadius, tex)
  return tex
}
export function texturas(): Texturas {
  if (cache) return cache
  const rnd = mulberry32(20261030)
  const scorchTex = canvasTexture(256, 256, (g, W) => { const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); grd.addColorStop(0, 'rgba(6,6,9,1)'); grd.addColorStop(0.45, 'rgba(12,11,16,0.7)'); grd.addColorStop(1, 'rgba(16,14,20,0)'); g.fillStyle = grd; g.fillRect(0, 0, W, W) })
  const R = 3, circ = 2 * Math.PI * R
  const skins = {
    body: [false, true].map((tiles) => steelSkin(rnd, 1024, 2048, circ, 33 - 3.2, { hatch: [26.4, 28.3], raceway: true, soot: true, tiles, calor: true, letras: true })),
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
  // torres y pilares de los niveles 2 y 3: acero oscuro con franjas de advertencia naranjas, gastadas por el polvo
  const franjasTex = canvasTexture(128, 512, (g, W, H) => {
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#2f333d' : '#b9602f'; g.fillRect(0, (k * H) / 8, W, H / 8) }
    for (let k = 0; k < 1200; k++) { g.fillStyle = `rgba(70,64,90,${0.08 + rnd() * 0.18})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 6, 1 + rnd() * 14) }
    g.fillStyle = 'rgba(20,20,26,0.55)'; for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 2, H) // nervios verticales
  })
  franjasTex.wrapS = franjasTex.wrapT = THREE.RepeatWrapping
  // tobera: tubos de refrigeración regenerativa (relieve) y el faldón que se pone al rojo (emisivo, más caliente en la salida)
  const toberaRelieve = canvasTexture(512, 32, (g, W, H) => { g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 4) { g.fillStyle = '#d8d8d8'; g.fillRect(x, 0, 2, H) } }, false)
  const toberaCalor = canvasTexture(16, 256, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H) // fila 0 = salida de la tobera (v = 1)
    grd.addColorStop(0, '#ff9a4a'); grd.addColorStop(0.35, '#c4441a'); grd.addColorStop(0.7, '#2a0a04'); grd.addColorStop(1, '#000000')
    g.fillStyle = grd; g.fillRect(0, 0, W, H)
  })
  cache = { GLOW: glowTexture(), niebla: nieblaTexture(), scorchTex, franjasTex, skins, tileTex, sootTex, gridTex, toberaRelieve, toberaCalor }
  return cache
}
