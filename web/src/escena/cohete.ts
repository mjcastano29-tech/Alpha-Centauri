// Cohetes: nave de acero inoxidable (≈ 42 m, Ø 6 m) y primera etapa reutilizable (≈ 36 m, Ø 3,7 m). Piel de acero con
// soldaduras, revenido térmico y losetas; toberas con tubos de refrigeración que se ponen al rojo según la temperatura
// del motor grabada; patas, aletas y luces de navegación. El origen está en los pies: es el punto de la trayectoria.
import * as THREE from 'three'
import type { Texturas } from './texturas'

const OUTPUT = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n'
const UP = new THREE.Vector3(0, 1, 0)
export interface Nave {
  group: THREE.Group; nozzle: THREE.Vector3; height: number; plumeW: number; heatShield?: (on: boolean) => void
  onboard: { pos: THREE.Vector3; aim: THREE.Vector3; up: THREE.Vector3 }; plume: { inner: THREE.Color[]; outer: THREE.Color[] }
  /** 0..1: brillo térmico de las toberas (sale de la temperatura del motor grabada). */
  calor: (k: number) => void
  luces: { sprite: THREE.Sprite; tipo: 'babor' | 'estribor' | 'estrobo' }[]
}
function beamMesh(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, geo: (L: number) => THREE.BufferGeometry, mat: THREE.Material) { // pieza recta entre dos puntos: patas y puntales
  const d = to.clone().sub(from), m = new THREE.Mesh(geo(d.length()), mat)
  m.position.copy(from).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.castShadow = m.receiveShadow = true; parent.add(m); return m
}
function bellGeometry(r0: number, r1: number, len: number) { const pts: THREE.Vector2[] = []; for (let k = 0; k <= 14; k++) { const t = k / 14; pts.push(new THREE.Vector2(r0 + (r1 - r0) * Math.pow(t, 0.75), -len * t)) } return new THREE.LatheGeometry(pts, 40) }
function flapGeometry(pts: [number, number][]) { // aleta plana con bordes redondeados, en el plano XY (x: distancia al eje, y: altura)
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([x, y]) => s.lineTo(x, y)); s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 2 })
  geo.translate(0, 0, -0.15); return geo
}
function materialTobera(T: Texturas) {
  const m = new THREE.MeshStandardMaterial({ color: 0x8a8279, roughness: 0.34, metalness: 0.95, side: THREE.DoubleSide, bumpMap: T.toberaRelieve, bumpScale: 1.6, emissiveMap: T.toberaCalor, emissive: 0xffffff, emissiveIntensity: 0 })
  return m
}
function luz(T: Texturas, hex: number, s: number) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.GLOW, color: hex, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })); sp.scale.set(s, s, 1); return sp }

export function plumeMaterial(inner: boolean) { // penacho del motor: cono exterior y núcleo caliente con diamantes de choque
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

export function construirNave(T: Texturas, padre: THREE.Object3D): Nave { // morro ojival, aletas con losetas, 4 patas y 3 motores
  const g = new THREE.Group(); padre.add(g)
  const RAD = 3, BASE = 3.2, TOP = 33, NOSE = 9.5
  const steel = ([map, orm]: THREE.Texture[]) => new THREE.MeshStandardMaterial({ map, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, envMapIntensity: 1.25 })
  const tiles = new THREE.MeshStandardMaterial({ map: T.tileTex, roughness: 0.85, metalness: 0 })
  const legSteel = new THREE.MeshStandardMaterial({ color: 0xb4b8c2, roughness: 0.32, metalness: 1 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.8, metalness: 0.25 })
  const bellMat = materialTobera(T), struts = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.32, metalness: 0.95 })
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m }
  const skins = { body: T.skins.body.map(steel), nose: T.skins.nose.map(steel) }
  const body = mesh(new THREE.CylinderGeometry(RAD, RAD, TOP - BASE, 96, 1, true), skins.body[0], 0, (TOP + BASE) / 2, 0)
  const noseR = (y: number) => RAD * Math.pow(Math.max(0, 1 - Math.pow((y - TOP) / NOSE, 2)), 0.55) // ojiva roma
  const nosePts: THREE.Vector2[] = []; for (let k = 0; k <= 40; k++) { const y = TOP + (k / 40) * NOSE; nosePts.push(new THREE.Vector2(Math.max(1e-3, noseR(y)), y - TOP)) }
  const nose = mesh(new THREE.LatheGeometry(nosePts, 96), skins.nose[0], 0, TOP, 0)
  mesh(new THREE.CircleGeometry(RAD, 64), darkMat, 0, BASE, 0).rotation.x = Math.PI / 2 // escudo térmico de los motores
  mesh(new THREE.CylinderGeometry(RAD + 0.04, RAD + 0.04, 0.5, 96, 1, true), darkMat, 0, BASE + 0.2, 0) // faldón de popa
  const bell = bellGeometry(0.3, 0.68, 1.7)
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / 3, x = 1.05 * Math.cos(a), z = 1.05 * Math.sin(a)
    mesh(bell, bellMat, x, BASE, z)
    mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.5, 16), darkMat, x, BASE + 0.15, z) // cabeza de potencia sobre cada tobera
  }
  const fwd = flapGeometry([[RAD - 0.15, 29.4], [RAD + 2.4, 30.8], [RAD + 2.6, 35.4], [noseR(38.3) - 0.15, 38.3]])
  const aft = flapGeometry([[RAD - 0.15, 4.0], [RAD + 3.0, 4.4], [RAD + 2.8, 7.4], [RAD - 0.15, 13.6]])
  for (const geo of [fwd, aft]) for (const rot of [0, Math.PI]) mesh(geo, tiles).rotation.y = rot
  for (let k = 0; k < 4; k++) { // patas: puntal principal de acero, pistón y pie ancho
    const leg = new THREE.Group(); leg.rotation.y = -(k / 4) * 2 * Math.PI; g.add(leg)
    const H = new THREE.Vector3(RAD - 0.3, 6.2, 0), F = new THREE.Vector3(RAD + 3.4, 0.5, 0), A = new THREE.Vector3(RAD - 0.2, 10.8, 0), P = H.clone().lerp(F, 0.55)
    beamMesh(leg, H, F, (L) => new THREE.CylinderGeometry(0.42, 0.34, L, 16), legSteel)
    beamMesh(leg, A, P, (L) => new THREE.CylinderGeometry(0.15, 0.15, L, 10), struts)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.32, 24), darkMat); foot.position.set(RAD + 3.45, 0.16, 0); foot.castShadow = foot.receiveShadow = true; leg.add(foot)
  }
  const luces: Nave['luces'] = [{ sprite: luz(T, 0xff3b30, 1.6), tipo: 'babor' }, { sprite: luz(T, 0x3ee08a, 1.6), tipo: 'estribor' }, { sprite: luz(T, 0xffffff, 2.2), tipo: 'estrobo' }]
  luces[0].sprite.position.set(-(RAD + 2.6), 34.5, 0); luces[1].sprite.position.set(RAD + 2.6, 34.5, 0); luces[2].sprite.position.set(0, TOP + NOSE - 0.2, 0)
  for (const l of luces) g.add(l.sprite)
  return {
    group: g, nozzle: new THREE.Vector3(0, BASE - 1.7, 0), height: TOP + NOSE, plumeW: 2.3, luces,
    heatShield: (on) => { body.material = skins.body[+on]; nose.material = skins.nose[+on] },
    calor: (k) => { bellMat.emissiveIntensity = 2.6 * k },
    onboard: { pos: new THREE.Vector3(0, 35.5, RAD + 0.9), aim: new THREE.Vector3(0, 0, RAD + 9), up: new THREE.Vector3(0, 0, 1) },
    plume: { inner: [new THREE.Color(1, 0.96, 1), new THREE.Color(0.72, 0.66, 1)], outer: [new THREE.Color(1, 0.6, 0.3), new THREE.Color(0.75, 0.28, 0.12)] }, // metano: núcleo azulado
  }
}
export function construirPropulsor(T: Texturas, padre: THREE.Object3D): Nave { // con las patas desplegadas
  const g = new THREE.Group(); padre.add(g)
  const paint = new THREE.MeshStandardMaterial({ map: T.sootTex, roughness: 0.5, metalness: 0.05 })
  const carbon = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.42, metalness: 0.25 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.8, metalness: 0.2 })
  const bellMat = materialTobera(T), struts = new THREE.MeshStandardMaterial({ color: 0x8c8378, roughness: 0.32, metalness: 0.95 })
  const finMat = new THREE.MeshStandardMaterial({ map: T.gridTex, alphaTest: 0.5, color: 0x8e8e92, roughness: 0.45, metalness: 0.85, side: THREE.DoubleSide })
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
    beamMesh(leg, A, P, (L) => new THREE.CylinderGeometry(0.13, 0.13, L, 10), struts)
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.24, 20), darkMat); foot.position.set(7.25, 0.12, 0); foot.castShadow = true; leg.add(foot)
  }
  const luces: Nave['luces'] = [{ sprite: luz(T, 0xff3b30, 1.2), tipo: 'babor' }, { sprite: luz(T, 0x3ee08a, 1.2), tipo: 'estribor' }, { sprite: luz(T, 0xffffff, 1.8), tipo: 'estrobo' }]
  luces[0].sprite.position.set(-1.95, 33.6, 0); luces[1].sprite.position.set(1.95, 33.6, 0); luces[2].sprite.position.set(0, 36.2, 0)
  for (const l of luces) g.add(l.sprite)
  return {
    group: g, nozzle: new THREE.Vector3(0, 1.6, 0), height: 36, plumeW: 1, luces,
    calor: (k) => { bellMat.emissiveIntensity = 2.6 * k },
    onboard: { pos: new THREE.Vector3(0, 31, 3.4), aim: new THREE.Vector3(0, 0, 10), up: new THREE.Vector3(0, 0, 1) },
    plume: { inner: [new THREE.Color(1, 0.95, 0.86), new THREE.Color(1, 0.6, 0.25)], outer: [new THREE.Color(1, 0.55, 0.18), new THREE.Color(0.85, 0.22, 0.05)] }, // queroseno: anaranjado
  }
}
