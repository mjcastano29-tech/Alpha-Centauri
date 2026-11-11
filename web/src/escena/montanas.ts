// Montañas flotantes de Elyndra: islas de roca suspendidas (cima aplanada con biopelícula luminosa, base colgante en
// agujas), cascadas de partículas que caen de sus bordes y se deshacen en bruma, bloques que flotan a su alrededor y
// niebla en la cintura. En el suelo, agujas de roca de cientos de metros con la cumbre encendida. Todo lejos de la
// zona de vuelo (más de 800 m de la plataforma) para no interferir con la trayectoria ni con las cámaras.
import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { PLANETA_DIR } from './cielo'
import { col, fbm3, mulberry32, ridged3, smooth } from './ruido'
import { geometriaRoca, materialRoca, terrainHeight, type UniformesMundo } from './terreno'
import type { Texturas } from './texturas'

const ROCA_A = col(0x262938), ROCA_B = col(0x3b3452), BIO = col(0x173f45), FONDO = col(0x15161f)
/** Isla flotante (radio 1): cima aplanada a y ≈ 0,2 y base que se afila hasta y ≈ −2,4. Colores y oclusión horneados. */
function geoIsla(seed: number) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 30)
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g)
  const p = g.attributes.position as THREE.BufferAttribute, hueco = new Float32Array(p.count), rnd = mulberry32(Math.floor(seed * 1000))
  // lóbulos: la base se parte en 3–5 agujas colgantes de distinta longitud, y la punta se desvía hacia un lado
  const lobulos = Array.from({ length: 3 + Math.floor(rnd() * 3) }, () => ({ a: rnd() * Math.PI * 2, largo: 0.5 + rnd() * 0.8, ancho: 2 + rnd() * 3 }))
  const desvio = [(rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.7]
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), th = Math.atan2(z, x)
    const n1 = fbm3(x * 1.6 + seed, y * 1.6, z * 1.6 - seed), cr = ridged3(x * 2.6 - seed, y * 1.2, z * 2.6 + seed)
    let r = (1 + (n1 - 0.5) * 0.55) * (1 + (fbm3(Math.cos(th) * 1.3 + seed, 0, Math.sin(th) * 1.3) - 0.5) * 0.45), yy: number, dx = 0, dz = 0
    if (y > 0.18) yy = 0.18 + (y - 0.18) * 0.3 + (fbm3(x * 3.2, seed, z * 3.2) - 0.5) * 0.09
    else {
      const t = smooth(0.18, -1, y)
      let lob = 0, largo = 0
      for (const L of lobulos) { const w = Math.pow(0.5 + 0.5 * Math.cos(th - L.a), L.ancho); if (w > lob) { lob = w; largo = L.largo } }
      yy = 0.18 + (y - 0.18) * (1.25 + n1 * 0.7 + lob * largo * 1.1)
      r *= (1 - t * 0.8) * (0.55 + 0.6 * lob * t + 0.45 * (1 - t)) * (1 + (cr - 0.5) * 0.7 * t)
      dx = desvio[0] * t * t; dz = desvio[1] * t * t
    }
    p.setXYZ(i, x * r + dx, yy, z * r + dz); hueco[i] = n1
  }
  g.computeVertexNormals()
  const nrm = g.attributes.normal as THREE.BufferAttribute, colores = new Float32Array(p.count * 3), brillo = new Float32Array(p.count), c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = nrm.getY(i)
    const cima = smooth(0.55, 0.85, ny) * smooth(-0.05, 0.16, y)
    const estrato = 0.5 + 0.5 * Math.sin(y * 17 + fbm3(x * 2, y * 2, z * 2) * 6)
    c.copy(ROCA_A).lerp(ROCA_B, estrato * 0.65).lerp(BIO, cima).lerp(FONDO, smooth(-0.4, -2.2, y) * 0.6)
    c.multiplyScalar(0.62 + 0.38 * smooth(0.28, 0.72, hueco[i])) // oclusión ambiental horneada en las grietas
    colores.set([c.r, c.g, c.b], i * 3)
    const vena = (1 - smooth(0, 0.018, Math.abs(fbm3(x * 2.2, y * 2.2, z * 2.2) - 0.5))) * smooth(0.0, -1.4, y) * smooth(0.55, 0.7, fbm3(x * 0.8 + 3, y * 0.8, z * 0.8))
    brillo[i] = cima * smooth(0.55, 0.8, fbm3(x * 5 + 7, y * 5, z * 5)) * 0.9 + vena * 0.45 * (1 - cima)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colores, 3)); g.setAttribute('brillo', new THREE.BufferAttribute(brillo, 1))
  return g
}
/** Aguja de roca del suelo (base en y = 0, altura 1, radio 1): estratos horizontales y la cumbre cubierta de biopelícula. */
function geoAguja(seed: number) {
  let g: THREE.BufferGeometry = new THREE.CylinderGeometry(0.42, 1.3, 1, 20, 40, false)
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); g.translate(0, 0.5, 0)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x)
    const r = 1 + (fbm3(Math.cos(a) * 1.5 + seed, y * 5, Math.sin(a) * 1.5) - 0.5) * 0.5 + (ridged3(Math.cos(a) * 3, y * 9 + seed, Math.sin(a) * 3) - 0.5) * 0.25
    const cap = y > 0.99 ? 0.55 : 1 - 0.25 * smooth(0.6, 1, y) * ridged3(Math.cos(a) * 2, y * 3, Math.sin(a) * 2 + seed)
    p.setXYZ(i, x * r * cap, y + (y > 0.99 ? (fbm3(x * 4, seed, z * 4) - 0.5) * 0.03 : 0), z * r * cap)
  }
  g.computeVertexNormals()
  const nrm = g.attributes.normal as THREE.BufferAttribute, colores = new Float32Array(p.count * 3), brillo = new Float32Array(p.count), c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), cima = smooth(0.93, 0.99, y) * smooth(0.2, 0.7, nrm.getY(i) + 0.3)
    c.copy(ROCA_A).lerp(ROCA_B, 0.5 + 0.5 * Math.sin(y * 60 + p.getX(i))).lerp(BIO, cima).multiplyScalar(0.7 + 0.3 * smooth(0, 0.4, y))
    colores.set([c.r, c.g, c.b], i * 3); brillo[i] = cima * 0.45 + (1 - smooth(0, 0.03, Math.abs(Math.sin(y * 45 + seed) * 0.5))) * 0.12 * smooth(0.2, 0.9, y)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colores, 3)); g.setAttribute('brillo', new THREE.BufferAttribute(brillo, 1))
  return g
}
function materialIsla(U: UniformesMundo) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float brillo; varying float vBrilloI; varying vec3 vPI;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrilloI = brillo; vPI = position;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime, uBrillo; varying float vBrilloI; varying vec3 vPI;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float pulsoI = 0.75 + 0.25 * sin(uTime * 0.7 + vPI.x * 3.0 + vPI.z * 2.0);
        totalEmissiveRadiance += mix(vec3(0.26, 0.85, 0.81), vec3(0.62, 0.45, 0.86), step(0.5, fract(vPI.y * 1.7))) * vBrilloI * pulsoI * uBrillo * 1.25;`)
  }
  return mat
}

export interface Isla { centro: THREE.Vector3; radio: number; aplastar: number; malla: THREE.Mesh }
export interface Montanas { grupo: THREE.Group; puntosFlora: { p: THREE.Vector3; s: number }[]; setDensidad(k: number): void; setEscalaPuntos(px: number): void }

export function crearMontanas(U: UniformesMundo, T: Texturas): Montanas {
  const grupo = new THREE.Group(), rnd = mulberry32(777)
  const variantes = [3.1, 8.7, 15.2, 21.9].map(geoIsla), mat = materialIsla(U)
  const islas: Isla[] = [], azPlaneta = Math.atan2(PLANETA_DIR.z, PLANETA_DIR.x)
  for (let k = 0, intento = 0; k < 16 && intento < 400; intento++) {
    const enmarca = k < 3 // las tres primeras flanquean al gigante gaseoso, visto desde la plataforma
    const az = enmarca ? azPlaneta + [-0.62, 0.55, 0.95][k] + (rnd() - 0.5) * 0.08 : rnd() * Math.PI * 2
    const dist = enmarca ? 1900 + k * 700 : 1000 + Math.pow(rnd(), 0.7) * 3300
    if (!enmarca && Math.abs(Math.atan2(Math.sin(az - azPlaneta), Math.cos(az - azPlaneta))) < 0.42) continue // el gigante queda despejado desde la plataforma
    const radio = enmarca ? 210 + rnd() * 150 : 45 + Math.pow(rnd(), 1.5) * 240 + dist * 0.03, aplastar = 0.75 + rnd() * 0.45
    const x = dist * Math.cos(az), z = dist * Math.sin(az)
    const y = terrainHeight(x, z) + radio * aplastar * 2.5 + 80 + rnd() * 480 + dist * 0.05
    const centro = new THREE.Vector3(x, y, z)
    if (islas.some((o) => o.centro.distanceTo(centro) < (o.radio + radio) * 1.7)) continue
    const malla = new THREE.Mesh(variantes[k % variantes.length], mat)
    malla.position.copy(centro); malla.scale.set(radio, radio * aplastar, radio); malla.rotation.y = rnd() * Math.PI * 2
    grupo.add(malla); islas.push({ centro, radio, aplastar, malla }); k++
  }
  // bloques flotando alrededor de cada isla y puntos de su cima donde crece flora
  const nBloques = islas.length * 8, bloques = new THREE.InstancedMesh(geometriaRoca(), materialRoca(U), nBloques), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3()
  const puntosFlora: { p: THREE.Vector3; s: number }[] = []
  islas.forEach((isla, i) => {
    for (let j = 0; j < 8; j++) {
      const a = rnd() * Math.PI * 2, d = isla.radio * (1.15 + rnd() * 0.8), sz = isla.radio * (0.03 + Math.pow(rnd(), 2) * 0.1)
      v.set(isla.centro.x + Math.cos(a) * d, isla.centro.y - isla.radio * isla.aplastar * (rnd() * 1.1 - 0.2), isla.centro.z + Math.sin(a) * d)
      m.compose(v, q.setFromEuler(e.set(rnd() * 6, rnd() * 6, rnd() * 6)), s.set(sz, sz * 0.8, sz)); bloques.setMatrixAt(i * 8 + j, m)
      bloques.setColorAt(i * 8 + j, new THREE.Color(0x34354a).multiplyScalar(0.7 + rnd() * 0.4))
    }
    const geo = isla.malla.geometry, p = geo.attributes.position as THREE.BufferAttribute, nrm = geo.attributes.normal as THREE.BufferAttribute
    isla.malla.updateMatrixWorld()
    for (let t = 0, n = 0; t < 400 && n < 9; t++) {
      const idx = Math.floor(rnd() * p.count)
      if (nrm.getY(idx) < 0.82 || p.getY(idx) < 0.12) continue
      puntosFlora.push({ p: v.fromBufferAttribute(p, idx).applyMatrix4(isla.malla.matrixWorld).clone(), s: isla.radio * (0.05 + rnd() * 0.07) }); n++
    }
  })
  grupo.add(bloques)

  // agujas de roca en el suelo
  const agujas = [geoAguja(4.4), geoAguja(9.1)].map((g) => new THREE.InstancedMesh(g, mat, 12))
  agujas.forEach((malla, vI) => {
    let k = 0
    for (let t = 0; k < 12 && t < 300; t++) {
      const a = rnd() * Math.PI * 2, d = 900 + Math.pow(rnd(), 0.9) * 2900, x = d * Math.cos(a), z = d * Math.sin(a)
      if (islas.some((o) => Math.hypot(o.centro.x - x, o.centro.z - z) < o.radio * 1.4)) continue
      const r = 35 + rnd() * 70, h = r * (2.6 + rnd() * 3.2)
      m.compose(v.set(x, terrainHeight(x, z) - 6, z), q.setFromEuler(e.set((rnd() - 0.5) * 0.08, rnd() * 6, (rnd() - 0.5) * 0.08)), s.set(r, h, r)); malla.setMatrixAt(k++, m)
      if (rnd() < 0.5) puntosFlora.push({ p: new THREE.Vector3(x, terrainHeight(x, z) - 6 + h * 0.995, z), s: r * 0.12 + vI })
    }
    malla.count = k; grupo.add(malla)
  })

  // cascadas de partículas desde el borde de las islas más grandes
  const grandes = [...islas].sort((a, b) => b.radio - a.radio).slice(0, 6), porCascada = 450, n = grandes.length * porCascada
  const origen = new Float32Array(n * 3), altura = new Float32Array(n), lado = new Float32Array(n * 2), fase = new Float32Array(n)
  grandes.forEach((isla, c) => {
    const a = rnd() * Math.PI * 2, o = new THREE.Vector3(isla.centro.x + Math.cos(a) * isla.radio * 0.92, isla.centro.y + isla.radio * isla.aplastar * 0.16, isla.centro.z + Math.sin(a) * isla.radio * 0.92)
    const caida = isla.radio * isla.aplastar * 2.6 + 200
    // intercaladas: al reducir la densidad se aclaran todas las cascadas a la vez
    for (let i = 0; i < porCascada; i++) { const k = i * grandes.length + c; origen.set([o.x + (rnd() - 0.5) * isla.radio * 0.08, o.y, o.z + (rnd() - 0.5) * isla.radio * 0.08], k * 3); altura[k] = caida * (0.7 + rnd() * 0.3); lado.set([rnd() - 0.5, rnd() - 0.5], k * 2); fase[k] = rnd() }
  })
  const geoC = new THREE.BufferGeometry()
  geoC.setAttribute('position', new THREE.BufferAttribute(origen, 3)); geoC.setAttribute('altura', new THREE.BufferAttribute(altura, 1)); geoC.setAttribute('lado', new THREE.BufferAttribute(lado, 2)); geoC.setAttribute('fase', new THREE.BufferAttribute(fase, 1))
  const matC = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uBrillo: U.uBrillo, uEscala: { value: 500 } },
    vertexShader: `attribute float altura; attribute vec2 lado; attribute float fase; uniform float uTime, uEscala; varying float vA;
      void main(){
        float edad = fract(uTime * 0.06 + fase);
        vec3 p = position + vec3(lado.x * (2.0 + edad * 34.0), -pow(edad, 1.6) * altura, lado.y * (2.0 + edad * 34.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = smoothstep(0.0, 0.04, edad) * (1.0 - smoothstep(0.45, 1.0, edad)) * smoothstep(7000.0, 1500.0, -mv.z);
        gl_PointSize = clamp((2.5 + edad * 14.0) * uEscala / -mv.z, 1.0, 28.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uBrillo; varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
        gl_FragColor = vec4(vec3(0.45, 0.95, 0.92) * 1.4, vA * (1.0 - d) * 0.5 * min(1.0, uBrillo + 0.3));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const cascadas = new THREE.Points(geoC, matC); cascadas.frustumCulled = false; grupo.add(cascadas)

  // bruma en la cintura de las islas y donde se deshacen las cascadas
  const bruma = new THREE.Group()
  islas.forEach((isla) => {
    for (let j = 0; j < 5; j++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.niebla, color: j % 2 ? 0x8f86c4 : 0x6f80b4, transparent: true, opacity: 0.1 + rnd() * 0.12, depthWrite: false }))
      const a = rnd() * Math.PI * 2, d = isla.radio * (0.6 + rnd() * 0.7)
      sp.position.set(isla.centro.x + Math.cos(a) * d, isla.centro.y - isla.radio * isla.aplastar * (0.2 + rnd() * 1.4), isla.centro.z + Math.sin(a) * d)
      const sc = isla.radio * (1.6 + rnd() * 1.6); sp.scale.set(sc, sc * 0.55, 1); bruma.add(sp)
    }
  })
  grupo.add(bruma)
  return {
    grupo, puntosFlora,
    setDensidad(k) { geoC.setDrawRange(0, Math.floor(n * Math.max(0.3, k))); bruma.visible = k > 0.4 },
    setEscalaPuntos(px) { matC.uniforms.uEscala.value = px },
  }
}
