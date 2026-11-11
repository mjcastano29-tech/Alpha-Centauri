// Ecosistema bioluminiscente de Elyndra, todo instanciado (un dibujo por especie): tallos lumínicos con bulbos, árboles
// parasol de troncos trenzados con tentáculos, matas de vainas luminosas y cristales hexagonales. Se agrupan donde crece
// la biopelícula del suelo, se mecen en el shader, destellan cuando el chorro del motor pasa cerca y las rodean
// organismos luminosos que se apartan del chorro. Nada de hojas: formas que no existen en la Tierra.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { col, fbm, mulberry32, smooth } from './ruido'
import { musgo, terrainHeight, type UniformesMundo } from './terreno'

const CIAN = col(0x42d9ce), VIOLETA = col(0xa879d9), TURQUESA = col(0x3fe7a8)
/** Zonas sin vegetación: la losa y su anillo requemado, el pasillo de la cámara de la torre y el puesto de la cámara de aterrizaje. */
export const CAM_ATERRIZAJE = new THREE.Vector3(-46, 0, 38)
function despejado(x: number, z: number) {
  const r = Math.hypot(x, z)
  return r < 60 || (Math.abs(x) < 16 && z > 0 && z < 240) || Math.hypot(x - CAM_ATERRIZAJE.x, z - CAM_ATERRIZAJE.z) < 14
}

// ---------- geometrías (altura unitaria; cada instancia se escala) ----------
type Brillo = number | ((t: number) => number)
function tubo(curva: THREE.Curve<THREE.Vector3>, r0: number, r1: number, segs: number, radial: number, brillo: Brillo) {
  const frames = curva.computeFrenetFrames(segs, false), P = new THREE.Vector3(), N = new THREE.Vector3()
  const pos: number[] = [], nor: number[] = [], bri: number[] = [], idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, r = r0 + (r1 - r0) * t, b = typeof brillo === 'number' ? brillo : brillo(t); curva.getPointAt(t, P)
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      N.set(0, 0, 0).addScaledVector(frames.normals[i], -Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a)).normalize()
      pos.push(P.x + r * N.x, P.y + r * N.y, P.z + r * N.z); nor.push(N.x, N.y, N.z); bri.push(b)
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, b, b + 1, a + 1) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('brillo', new THREE.Float32BufferAttribute(bri, 1)); g.setIndex(idx)
  return g
}
/** Prepara una primitiva para fusionarla: sin uv, con índice y con el atributo de brillo (constante o según la altura local). */
function pieza(g: THREE.BufferGeometry, brillo: Brillo, y0 = 0, y1 = 1) {
  g.deleteAttribute('uv')
  const p = g.attributes.position as THREE.BufferAttribute, b = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) b[i] = typeof brillo === 'number' ? brillo : brillo(smooth(y0, y1, p.getY(i)))
  g.setAttribute('brillo', new THREE.BufferAttribute(b, 1))
  return g // las primitivas de three.js que se usan aquí ya vienen indexadas, como los tubos
}
const bulbo = (r: number, en: THREE.Vector3, brillo: number) => pieza(new THREE.SphereGeometry(r, 6, 4).translate(en.x, en.y, en.z), brillo)

function geoTallos(seed: number, simple: boolean) {
  const rnd = mulberry32(seed), partes: THREE.BufferGeometry[] = [], n = simple ? 3 : 5 + Math.floor(rnd() * 3)
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2, r0 = rnd() * 0.09, h = 0.5 + rnd() * 0.5, lean = 0.06 + rnd() * 0.24
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), b = d.clone().multiplyScalar(r0), rizo = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(0.04 * (rnd() - 0.5))
    const pts = [b.clone(), b.clone().addScaledVector(d, lean * 0.15).setY(h * 0.35), b.clone().addScaledVector(d, lean * 0.6).setY(h * 0.72), b.clone().addScaledVector(d, lean).add(rizo).setY(h)]
    partes.push(tubo(new THREE.CatmullRomCurve3(pts), 0.022, 0.008, simple ? 5 : 9, simple ? 4 : 5, (t) => 0.06 + 0.3 * t * t))
    partes.push(bulbo(0.032 + rnd() * 0.028, pts[3], 1))
    if (!simple && rnd() < 0.6) partes.push(bulbo(0.016, pts[2].clone().lerp(pts[3], 0.4), 0.75))
  }
  return mergeGeometries(partes)
}
function geoParasol(seed: number) {
  const rnd = mulberry32(seed), partes: THREE.BufferGeometry[] = [], alto = 0.84
  for (let k = 0; k < 3; k++) { // troncos trenzados en hélice
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 12; i++) { const t = i / 12, r = 0.034 * (1 - t) + 0.008, a = (k / 3) * Math.PI * 2 + t * (2.2 + rnd() * 0.6); pts.push(new THREE.Vector3(r * Math.cos(a), t * alto, r * Math.sin(a))) }
    partes.push(tubo(new THREE.CatmullRomCurve3(pts), 0.019, 0.008, 22, 7, (t) => 0.03 + 0.05 * Math.pow(Math.sin(t * 40), 8)))
  }
  for (let k = 0; k < 5; k++) { // raíces aéreas
    const a = (k / 5) * Math.PI * 2 + rnd() * 0.5, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    partes.push(tubo(new THREE.CatmullRomCurve3([d.clone().multiplyScalar(0.02).setY(0.09), d.clone().multiplyScalar(0.07).setY(0.04), d.clone().multiplyScalar(0.12).setY(-0.01)]), 0.011, 0.005, 6, 5, 0.05))
  }
  const perfil = [[0.001, 0.94], [0.12, 0.955], [0.25, 0.94], [0.35, 0.895], [0.42, 0.83], [0.45, 0.785], [0.43, 0.8], [0.34, 0.84], [0.2, 0.872], [0.06, 0.885], [0.001, 0.886]].map(([x, y]) => new THREE.Vector2(x, y))
  const copa = new THREE.LatheGeometry(perfil, 48)
  const p = copa.attributes.position as THREE.BufferAttribute, b = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) { // borde festoneado y nervios luminosos por debajo
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x), lob = 1 + 0.07 * Math.sin(a * 9) * smooth(0.2, 0.44, r)
    p.setXYZ(i, x * lob, y - 0.035 * (0.5 + 0.5 * Math.cos(a * 9)) * smooth(0.3, 0.45, r), z * lob)
    const debajo = i % perfil.length >= 6
    b[i] = debajo ? 0.15 + 0.9 * Math.pow(Math.abs(Math.sin(a * 11)), 14) * smooth(0.05, 0.3, r) + smooth(0.38, 0.45, r) : 0.04 + 0.5 * smooth(0.4, 0.45, r)
  }
  copa.computeVertexNormals(); copa.deleteAttribute('uv'); copa.setAttribute('brillo', new THREE.BufferAttribute(b, 1)); partes.push(copa)
  for (let k = 0; k < 16; k++) { // tentáculos colgantes con la punta encendida
    const a = (k / 16) * Math.PI * 2 + rnd() * 0.2, r = 0.39 + rnd() * 0.03, L = 0.1 + rnd() * 0.24, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    const top = d.clone().multiplyScalar(r).setY(0.79), pts = [top, top.clone().addScaledVector(d, 0.015).setY(0.79 - L * 0.5), top.clone().addScaledVector(d, -0.01).setY(0.79 - L)]
    partes.push(tubo(new THREE.CatmullRomCurve3(pts), 0.006, 0.003, 6, 4, (t) => 0.2 + 0.8 * t * t))
    partes.push(bulbo(0.009, pts[2], 1))
  }
  return mergeGeometries(partes)
}
function geoVainas(seed: number) {
  const rnd = mulberry32(seed), partes: THREE.BufferGeometry[] = [], n = 4 + Math.floor(rnd() * 4)
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2, h = 0.25 + rnd() * 0.5, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), rr = 0.1 + rnd() * 0.12
    const tope = d.clone().multiplyScalar(0.12 + rnd() * 0.18).setY(h)
    partes.push(tubo(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), d.clone().multiplyScalar(0.05).setY(h * 0.5), tope]), 0.02, 0.012, 5, 4, 0.08))
    partes.push(pieza(new THREE.SphereGeometry(rr, 10, 7).scale(1, 1.25, 1).translate(tope.x, tope.y + rr * 0.9, tope.z), (t) => 0.35 + 0.65 * t, tope.y, tope.y + rr * 2.2))
  }
  return mergeGeometries(partes)
}
function geoCristales(seed: number) {
  const rnd = mulberry32(seed), partes: THREE.BufferGeometry[] = [], n = 6 + Math.floor(rnd() * 5)
  for (let k = 0; k < n; k++) {
    const r = 0.05 + rnd() * 0.08, h = 0.35 + rnd() * 0.65
    const prisma = mergeGeometries([new THREE.CylinderGeometry(r, r * 1.08, h, 6, 1).translate(0, h / 2, 0), new THREE.ConeGeometry(r, r * 3.2, 6, 1).translate(0, h + r * 1.6, 0)].map((g) => pieza(g, (t) => 0.08 + 0.92 * t * t, 0, h + r * 3.2)))
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.9, rnd() * 6, (rnd() - 0.5) * 0.9))
    prisma.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((rnd() - 0.5) * 0.25, -0.03, (rnd() - 0.5) * 0.25), q, new THREE.Vector3(1, 1, 1)))
    partes.push(prisma)
  }
  return mergeGeometries(partes)
}

// ---------- material: base oscura, emisión por vértice teñida por instancia, vaivén y destello con el chorro ----------
function materialFlora(U: UniformesMundo, base: number, opciones: { vaiven: number; rugosidad?: number; metal?: number; borde?: number }) {
  const mat = new THREE.MeshStandardMaterial({ color: base, roughness: opciones.rugosidad ?? 0.62, metalness: opciones.metal ?? 0, envMapIntensity: 0.6 })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        uniform float uTime; attribute float brillo; attribute vec3 tinte;
        varying float vBrillo; varying vec3 vTinte; varying vec3 vFW; varying float vFase;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        vFase = fract(dot(ip.xz, vec2(0.0137, 0.0191)));
        float alturaF = max(position.y, 0.0);
        transformed.x += sin(uTime * 1.1 + vFase * 30.0) * ${opciones.vaiven.toFixed(3)} * alturaF * alturaF;
        transformed.z += cos(uTime * 0.85 + vFase * 21.0) * ${(opciones.vaiven * 0.7).toFixed(3)} * alturaF * alturaF;
        vBrillo = brillo; vTinte = tinte;
        vec4 fw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
        #endif
        vFW = (modelMatrix * fw).xyz;`)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uTime, uBrillo; uniform vec4 uBlast; varying float vBrillo; varying vec3 vTinte; varying vec3 vFW; varying float vFase;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float pulsoF = 0.7 + 0.3 * sin(uTime * 1.6 + vFase * 40.0 + vBrillo * 3.0);
        float chorroF = uBlast.w * exp(-distance(vFW, uBlast.xyz) / 55.0);
        float bordeF = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0) * ${(opciones.borde ?? 0.35).toFixed(2)};
        totalEmissiveRadiance += vTinte * (vBrillo * 2.4 + bordeF * vBrillo) * (pulsoF * uBrillo + chorroF * 2.5);`)
  }
  return mat
}

interface Siembra { n: number; rMin: number; rMax: number; potencia: number; mascara: (x: number, z: number, r: number) => number; escala: (r: number, u: number) => number; hundir?: number; inclinar?: number; tintes: THREE.Color[] }
function sembrar(geo: THREE.BufferGeometry, mat: THREE.Material, rnd: () => number, s: Siembra) {
  const g = geo.clone(), malla = new THREE.InstancedMesh(g, mat, s.n), tinte = new Float32Array(s.n * 3)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), esc = new THREE.Vector3()
  let k = 0
  for (let intento = 0; k < s.n && intento < s.n * 60; intento++) {
    const r = s.rMin + (s.rMax - s.rMin) * Math.pow(rnd(), s.potencia), a = rnd() * Math.PI * 2, x = r * Math.cos(a), z = r * Math.sin(a)
    if (despejado(x, z) || rnd() > s.mascara(x, z, r)) continue
    const sc = s.escala(r, rnd()), inc = s.inclinar ?? 0.12
    q.setFromEuler(e.set((rnd() - 0.5) * inc, rnd() * Math.PI * 2, (rnd() - 0.5) * inc))
    m.compose(p.set(x, terrainHeight(x, z) - (s.hundir ?? 0.02) * sc, z), q, esc.set(sc, sc, sc)); malla.setMatrixAt(k, m)
    const t = s.tintes[Math.floor(rnd() * s.tintes.length)]; tinte.set([t.r, t.g, t.b], k * 3); k++
  }
  malla.count = k
  g.setAttribute('tinte', new THREE.InstancedBufferAttribute(tinte, 3))
  malla.receiveShadow = true
  return malla
}

/** Organismos luminosos que revolotean cerca de la flora; el chorro del motor los dispersa. Movimiento en la GPU. */
function crearLuciernagas(U: UniformesMundo, centros: THREE.Vector3[], n: number) {
  const rnd = mulberry32(991), pos = new Float32Array(n * 3), fase = new Float32Array(n)
  for (let i = 0; i < n; i++) { const c = centros[Math.floor(rnd() * centros.length)]; pos.set([c.x + (rnd() - 0.5) * 16, c.y + 1 + rnd() * 7, c.z + (rnd() - 0.5) * 16], i * 3); fase[i] = rnd() }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('fase', new THREE.BufferAttribute(fase, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uBlast: U.uBlast, uBrillo: U.uBrillo, uEscala: { value: 500 } },
    vertexShader: `attribute float fase; uniform float uTime, uEscala; uniform vec4 uBlast; varying float vA; varying float vT;
      void main(){
        float t = uTime * (0.35 + fase * 0.4) + fase * 60.0;
        vec3 p = position + vec3(sin(t) * 3.0 + sin(t * 2.3) * 1.2, sin(t * 1.7) * 1.4, cos(t * 1.3) * 3.0);
        vec3 aw = p - uBlast.xyz; float d = length(aw);
        p += aw / max(d, 0.01) * uBlast.w * 30.0 * exp(-d / 50.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = pow(0.5 + 0.5 * sin(uTime * (2.0 + fase * 3.0) + fase * 40.0), 3.0) * smoothstep(900.0, 200.0, -mv.z);
        vT = fase;
        gl_PointSize = clamp(0.5 * uEscala / -mv.z, 1.5, 14.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uBrillo; varying float vA; varying float vT;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
        vec3 col = vT < 0.5 ? vec3(0.35, 1.0, 0.88) : vT < 0.8 ? vec3(0.75, 0.55, 1.0) : vec3(0.6, 1.0, 0.6);
        gl_FragColor = vec4(col * 3.0, vA * (1.0 - d) * (1.0 - d) * min(1.0, uBrillo));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const puntos = new THREE.Points(geo, mat); puntos.frustumCulled = false
  return puntos
}

export interface Flora { grupo: THREE.Group; setDensidad(k: number): void; setEscalaPuntos(px: number): void }
/** @param islas puntos (en lo alto de las islas flotantes) donde también crecen tallos lumínicos, más grandes. */
export function crearFlora(U: UniformesMundo, islas: { p: THREE.Vector3; s: number }[]): Flora {
  const grupo = new THREE.Group(), rnd = mulberry32(424242)
  const matTallo = materialFlora(U, 0x14302f, { vaiven: 0.07 })
  const matArbol = materialFlora(U, 0x272240, { vaiven: 0.012, rugosidad: 0.55, borde: 0.6 })
  const matVaina = materialFlora(U, 0x153842, { vaiven: 0.05, rugosidad: 0.35, borde: 0.9 })
  const matCristal = materialFlora(U, 0x231c38, { vaiven: 0, rugosidad: 0.12, metal: 0.25, borde: 0.8 })
  const bosque = (x: number, z: number) => smooth(0.4, 0.66, fbm(x / 650 + 41, z / 650 - 3, 3))
  const especies: { malla: THREE.InstancedMesh; total: number }[] = []
  const add = (malla: THREE.InstancedMesh) => { especies.push({ malla, total: malla.count }); grupo.add(malla); return malla }
  add(sembrar(geoTallos(11, false), matTallo, rnd, { n: 900, rMin: 60, rMax: 450, potencia: 1.1, mascara: (x, z) => 0.12 + 0.88 * musgo(x, z), escala: (r, u) => 1.1 + u * 2.4 + r * 0.002, tintes: [CIAN, CIAN, TURQUESA, VIOLETA] }))
  add(sembrar(geoTallos(23, true), matTallo, rnd, { n: 1000, rMin: 420, rMax: 2600, potencia: 1.4, mascara: (x, z) => 0.1 + 0.9 * musgo(x, z), escala: (r, u) => 3 + u * 5 + r * 0.0015, tintes: [CIAN, TURQUESA, VIOLETA] }))
  for (let v = 0; v < 3; v++) add(sembrar(geoParasol(101 + v), matArbol, rnd, { n: 22, rMin: 340, rMax: 2300, potencia: 1.5, mascara: (x, z) => 0.05 + 0.95 * bosque(x, z), escala: (r, u) => 24 + u * 34 + r * 0.008, inclinar: 0.08, tintes: [CIAN, VIOLETA, CIAN] }))
  add(sembrar(geoVainas(7), matVaina, rnd, { n: 700, rMin: 60, rMax: 1500, potencia: 1.3, mascara: (x, z) => 0.15 + 0.85 * musgo(x, z), escala: (r, u) => 0.7 + u * 1.3 + r * 0.0012, tintes: [CIAN, VIOLETA, VIOLETA, TURQUESA] }))
  add(sembrar(geoCristales(5), matCristal, rnd, { n: 170, rMin: 62, rMax: 420, potencia: 1.0, mascara: (x, z) => 0.2 + 0.8 * (1 - musgo(x, z)), escala: (_r, u) => 0.5 + Math.pow(u, 2) * 2, hundir: 0.05, inclinar: 0.4, tintes: [VIOLETA, VIOLETA, CIAN] }))
  add(sembrar(geoCristales(9), matCristal, rnd, { n: 90, rMin: 420, rMax: 2600, potencia: 1.2, mascara: (x, z) => 0.15 + 0.85 * (1 - musgo(x, z)), escala: (r, u) => 4 + Math.pow(u, 2.5) * 22 + r * 0.002, hundir: 0.06, inclinar: 0.35, tintes: [VIOLETA, CIAN] }))
  if (islas.length) { // tallos gigantes en lo alto de las islas flotantes
    const g = geoTallos(31, false).clone(), malla = new THREE.InstancedMesh(g, matTallo, islas.length), tinte = new Float32Array(islas.length * 3), m = new THREE.Matrix4(), q = new THREE.Quaternion()
    islas.forEach((it, k) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6); m.compose(it.p, q, new THREE.Vector3(it.s, it.s, it.s)); malla.setMatrixAt(k, m); const t = rnd() < 0.7 ? CIAN : VIOLETA; tinte.set([t.r, t.g, t.b], k * 3) })
    g.setAttribute('tinte', new THREE.InstancedBufferAttribute(tinte, 3)); add(malla)
  }
  // luciérnagas alrededor de los tallos cercanos y las vainas
  const centros: THREE.Vector3[] = [], m = new THREE.Matrix4(), v = new THREE.Vector3()
  for (const { malla } of especies.slice(0, 1).concat(especies.slice(5, 6))) for (let i = 0; i < malla.count; i += 3) { malla.getMatrixAt(i, m); centros.push(v.setFromMatrixPosition(m).clone()) }
  const luciernagas = crearLuciernagas(U, centros, 1400); grupo.add(luciernagas)
  const nLuc = 1400
  return {
    grupo,
    setDensidad(k) { for (const e of especies) e.malla.count = Math.max(1, Math.floor(e.total * k)); luciernagas.geometry.setDrawRange(0, Math.floor(nLuc * k)) },
    setEscalaPuntos(px) { (luciernagas.material as THREE.ShaderMaterial).uniforms.uEscala.value = px },
  }
}
