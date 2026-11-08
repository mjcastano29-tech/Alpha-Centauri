// Superficie de Elyndra: llanura despejada alrededor de la plataforma (el ambiente tiene el suelo en z = 0), lomas, mesetas
// y cordilleras afiladas hacia el horizonte. Regolito pizarra, polvo lila, biopelícula verdeazulada con vetas de líquenes
// bioluminiscentes que destellan cuando el chorro del motor se acerca, y rocas con líquenes en la cara de arriba.
import * as THREE from 'three'
import { GLSL_RUIDO, col, fbm, hash, smooth, vnoise } from './ruido'

/** Altura del terreno (m): plana cerca de la plataforma, lomas, mesetas y cordilleras al fondo. */
export function terrainHeight(x: number, z: number) {
  const r = Math.hypot(x, z)
  const lomas = (fbm(x / 520 + 5.2, z / 520 - 1.3) - 0.5) * 70 * smooth(260, 1100, r)
  const mesas = smooth(0.56, 0.63, fbm(x / 1500 + 3.1, z / 1500 - 4.7)) * 210 * smooth(900, 2200, r)
  const cordillera = Math.pow(fbm(x / 1150 + 7.3, z / 1150 + 2.1), 2.3) * 1250 * smooth(1700, 3700, r)
  const dunas = (fbm(x / 150, z / 150) - 0.5) * 7 * smooth(150, 600, r) + (fbm(x / 35, z / 35) - 0.5) * 1.2 * smooth(60, 160, r)
  return lomas + mesas + cordillera + dunas
}
/** Máscara de biopelícula (0..1): la misma en el color del suelo, en las vetas luminosas y en dónde crece la flora. */
export const musgo = (x: number, z: number) => smooth(0.47, 0.62, fbm(x / 340 + 21, z / 340 - 9, 4)) * smooth(60, 140, Math.hypot(x, z))

let geometria: THREE.BufferGeometry | null = null
function geometriaTerreno() {
  if (geometria) return geometria
  // la malla se concentra cerca de la plataforma (más detalle donde aterriza el cohete) y se abre hacia el horizonte
  const size = 9000, half = size / 2, seg = 300
  const warp = (v: number) => Math.sign(v) * half * Math.pow(Math.abs(v) / half, 1.7)
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) { const x = warp(p.getX(i)), z = warp(p.getZ(i)); p.setXYZ(i, x, terrainHeight(x, z), z) }
  g.computeVertexNormals()
  const nrm = g.attributes.normal as THREE.BufferAttribute, colores = new Float32Array(p.count * 3), mus = new Float32Array(p.count)
  const regolito = col(0x2e3245), polvo = col(0x5d5774), bio = col(0x173b40), basalto = col(0x17181f), sal = col(0x77789a), quemado = col(0x1f2028), c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), ny = nrm.getY(i), r = Math.hypot(x, z), m = musgo(x, z)
    c.copy(regolito).lerp(polvo, smooth(0.42, 0.72, fbm(x / 230 + 11, z / 230 - 5)) * 0.65) // polvo lila en las llanuras
    c.lerp(sal, smooth(0.66, 0.78, fbm(x / 900 - 31, z / 900 + 17, 4)) * smooth(700, 1400, r) * 0.7) // salinas pálidas a lo lejos
    c.lerp(bio, m * 0.85)
    c.lerp(basalto, smooth(0.08, 0.38, 1 - ny)) // la roca oscura aflora en las pendientes
    c.lerp(quemado, smooth(75, 46, r) * 0.7) // zona despejada y requemada alrededor de la losa
    colores.set([c.r, c.g, c.b], i * 3); mus[i] = m * smooth(0.3, 0.05, 1 - ny)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colores, 3))
  g.setAttribute('musgo', new THREE.BufferAttribute(mus, 1))
  geometria = g
  return g
}

// relieve de pocos centímetros en el shader (se ve de cerca) a partir de derivadas de pantalla
const GLSL_RELIEVE = `
  float detailH(vec2 p, float fade){ return efbm(p * 0.35, 4) * 0.9 + en(p * 2.7) * 0.2 + (en(p * 9.0) * 0.06 + sin(dot(p, vec2(0.55, 0.83)) * 3.1 + en(p * 0.4) * 6.0) * 0.05) * fade; }
  vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy){
    vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos), R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
    float det = dot(sx, R1); vec3 grad = sign(det) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(det) * surf_norm - grad); }`

export interface UniformesMundo { uTime: { value: number }; uBlast: { value: THREE.Vector4 }; uBrillo: { value: number } }

export function crearSuelo(U: UniformesMundo) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.45 })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float musgo; varying float vMusgo; varying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vMusgo = musgo;')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uTime, uBrillo; uniform vec4 uBlast; varying float vMusgo; varying vec3 vWPos;
        ${GLSL_RUIDO}${GLSL_RELIEVE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dFade = smoothstep(450.0, 25.0, length(vViewPosition));
        vec2 dP = vWPos.xz;
        float dTone = efbm(dP * 0.045, 4), dGrain = en(dP * 3.1);
        diffuseColor.rgb *= mix(0.9 + 0.2 * dTone, 0.72 + 0.52 * dTone + 0.16 * (dGrain - 0.5), dFade);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float dH = detailH(dP, dFade) * dFade * 0.32;
        normal = perturbN(-vViewPosition, normal, vec2(dFdx(dH), dFdy(dH)));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float vena = efbm(dP * 0.028, 4);
        float linea = (1.0 - smoothstep(0.0, 0.013, abs(vena - 0.5))) * smoothstep(0.45, 0.72, en(dP * 0.004 + 5.0));
        float puntos = smoothstep(0.88, 0.97, en(dP * 0.85)) * smoothstep(0.4, 0.85, en(dP * 0.05 + 3.0));
        float pulso = 0.78 + 0.22 * sin(uTime * 0.9 + vena * 22.0);
        float chorro = uBlast.w * exp(-distance(dP, uBlast.xz) / 40.0);
        vec3 tono = mix(vec3(0.26, 0.85, 0.81), vec3(0.62, 0.45, 0.86), smoothstep(0.35, 0.7, en(dP * 0.008)));
        totalEmissiveRadiance += tono * vMusgo * (linea * 0.55 + puntos * 0.9) * (pulso * uBrillo + chorro * 3.0) * smoothstep(3200.0, 500.0, length(vViewPosition));`)
  }
  const suelo = new THREE.Mesh(geometriaTerreno(), mat)
  suelo.receiveShadow = true
  return suelo
}

let geoRoca: THREE.BufferGeometry | null = null
/** Roca irregular semienterrada (icosaedro deformado), compartida por las rocas del suelo y los bloques que flotan junto a las islas. */
export function geometriaRoca() {
  if (geoRoca) return geoRoca
  const roca = new THREE.IcosahedronGeometry(1, 2), gp = roca.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i), d = 0.72 + 0.55 * vnoise(x * 1.9 + 3.1, y * 1.9 + z * 1.3 + 7.7)
    gp.setXYZ(i, x * d, (y < -0.2 ? y * 0.55 : y) * d, z * d)
  }
  roca.computeVertexNormals()
  geoRoca = roca
  return roca
}
/** Material de roca basáltica con líquenes luminosos en la cara de arriba (los avivan el pulso y el chorro del motor). */
export function materialRoca(U: UniformesMundo) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vArriba; varying vec3 vRP;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        mat4 rocaM = modelMatrix;
        #ifdef USE_INSTANCING
          rocaM = modelMatrix * instanceMatrix;
        #endif
        vArriba = normalize(mat3(rocaM) * objectNormal).y; vRP = (rocaM * vec4(transformed, 1.0)).xyz;`)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nuniform float uTime, uBrillo; uniform vec4 uBlast; varying float vArriba; varying vec3 vRP;\n${GLSL_RUIDO}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float liquen = smoothstep(0.55, 0.9, vArriba) * smoothstep(0.45, 0.75, en(vRP.xz * 0.6 + vRP.y));
        float chorroR = uBlast.w * exp(-distance(vRP, uBlast.xyz) / 40.0);
        totalEmissiveRadiance += vec3(0.26, 0.85, 0.81) * liquen * ((0.55 + 0.25 * sin(uTime * 1.3 + vRP.x)) * uBrillo + chorroR * 3.0) * 0.6;`)
  }
  return mat
}
/** Rocas del suelo: guijarros dentro de la zona de vuelo, bloques grandes fuera de ella. */
export function crearRocas(U: UniformesMundo) {
  const n = 560, rocks = new THREE.InstancedMesh(geometriaRoca(), materialRoca(U), n)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), at = new THREE.Vector3(), c = new THREE.Color(), base = col(0x34354a), violeta = col(0x45385a)
  for (let k = 0; k < n; k++) {
    const small = k < 240, a = hash(k, 101) * 2 * Math.PI
    const r = small ? 52 + hash(k, 131) * 260 : 320 + Math.pow(hash(k, 131), 1.6) * 1400
    const sz = small ? 0.15 + Math.pow(hash(k, 151), 2) * 0.9 : 0.8 + Math.pow(hash(k, 151), 3) * 9
    const x = r * Math.cos(a), z = r * Math.sin(a)
    q.setFromEuler(e.set(hash(k, 171) * 6, hash(k, 191) * 6, hash(k, 211) * 6))
    s.set(sz * (0.8 + hash(k, 233) * 0.6), sz * (0.45 + hash(k, 251) * 0.4), sz)
    m.compose(at.set(x, terrainHeight(x, z) - sz * 0.18, z), q, s); rocks.setMatrixAt(k, m)
    rocks.setColorAt(k, c.copy(base).lerp(violeta, hash(k, 291)).multiplyScalar(0.7 + hash(k, 271) * 0.5))
  }
  rocks.castShadow = rocks.receiveShadow = true
  return rocks
}
