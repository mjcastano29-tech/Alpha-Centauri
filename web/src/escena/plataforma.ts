// Zona de aterrizaje: losa de material compuesto con el círculo de éxito del ambiente, luces de borde (persecución en
// vuelo; verde fijo o naranja intermitente al tocar suelo, según el resultado grabado), cuatro torres con focos que
// iluminan la losa y baliza de advertencia, y un haz de aproximación tenue que marca el objetivo desde la altura.
// También construye los obstáculos de los niveles 2 y 3 (torres y pasarela), con la geometría que da la API.
import * as THREE from 'three'
import { col, glsl } from './ruido'
import { terrainHeight } from './terreno'
import { PAD_R, PAD_TOP, texturaPlataforma, type Texturas } from './texturas'

export interface Obstaculo { tipo?: 'torre' | 'pasarela'; nombre: string; x: number; y: number; radio: number; altura: number; radio_abertura?: number; grosor?: number }
export type EstadoPlataforma = 'vuelo' | 'exito' | 'fallo'
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y) // el entorno usa z hacia arriba; three.js, y hacia arriba
const CIAN = col(0x42d9ce), VERDE = col(0x3ee08a), NARANJA = col(0xff8a42)

export class Plataforma {
  readonly grupo = new THREE.Group()
  /** Haz de aproximación: es una guía, se oculta con las demás. */
  readonly haz: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly luces: THREE.Sprite[] = []
  private readonly balizas: THREE.Sprite[] = []
  private readonly focos: THREE.SpotLight[] = []
  private estado: EstadoPlataforma = 'vuelo'
  private tEstado = 0
  constructor(T: Texturas, padRadius: number, uTime: { value: number }) {
    const g = this.grupo
    const losa = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R, PAD_R + 0.6, 0.6, 128), new THREE.MeshStandardMaterial({ map: texturaPlataforma(padRadius), roughness: 0.82, metalness: 0.12, envMapIntensity: 0.55 }))
    losa.position.y = PAD_TOP - 0.3; losa.receiveShadow = true; g.add(losa)
    const carcasa = new THREE.MeshStandardMaterial({ color: 0x23252d, roughness: 0.6, metalness: 0.6 })
    const caja = new THREE.BoxGeometry(1.1, 0.28, 0.5)
    for (let k = 0; k < 28; k++) { // luces del borde de la losa
      const a = (k / 28) * 2 * Math.PI, x = (PAD_R + 0.9) * Math.cos(a), z = (PAD_R + 0.9) * Math.sin(a)
      const c = new THREE.Mesh(caja, carcasa); c.position.set(x, PAD_TOP + 0.05, z); c.rotation.y = -a; c.receiveShadow = true; g.add(c)
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.GLOW, color: CIAN, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
      s.position.set(x, PAD_TOP + 0.35, z); s.scale.set(1.6, 1.6, 1); s.userData.a = a; g.add(s); this.luces.push(s)
    }
    const acero = new THREE.MeshStandardMaterial({ color: 0x3a3e49, roughness: 0.45, metalness: 0.85 })
    const panel = new THREE.MeshStandardMaterial({ color: 0x15171c, emissive: 0xdff4ff, emissiveIntensity: 2.2 })
    for (let k = 0; k < 4; k++) { // torres de iluminación: mástil troncopiramidal, travesaño, foco hacia la losa y baliza
      const a = (k / 4) * 2 * Math.PI + Math.PI / 4, x = 66 * Math.cos(a), z = 66 * Math.sin(a), y0 = terrainHeight(x, z)
      const torre = new THREE.Group(); torre.position.set(x, y0, z); torre.lookAt(0, y0, 0); g.add(torre)
      const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.55, 18, 4, 1), acero); mastil.position.y = 9; mastil.rotation.y = Math.PI / 4; mastil.castShadow = true; torre.add(mastil)
      const trav = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.35, 0.35), acero); trav.position.set(0, 17.6, 0.2); trav.castShadow = true; torre.add(trav)
      for (const dx of [-1.3, 0, 1.3]) { const f = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.3), panel); f.position.set(dx, 17.1, 0.55); f.rotation.x = 0.35; torre.add(f) }
      const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.GLOW, color: NARANJA, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }))
      b.position.set(0, 18.9, 0); b.scale.set(2.4, 2.4, 1); torre.add(b); this.balizas.push(b)
      const foco = new THREE.SpotLight(0xdcefff, 2600, 220, 0.42, 0.65, 2); foco.position.set(x * 0.98, y0 + 17, z * 0.98); foco.target.position.set(0, 0, 0)
      g.add(foco, foco.target); this.focos.push(foco)
    }
    const haz = new THREE.CylinderGeometry(padRadius, padRadius, 420, 64, 1, true); haz.translate(0, 210, 0)
    this.haz = new THREE.Mesh(haz, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime },
      vertexShader: 'varying float vH; varying vec3 vN; varying vec3 vV; void main(){ vH = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime; varying float vH; varying vec3 vN; varying vec3 vV;
        void main(){
          float h = vH / 420.0, borde = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
          float anillos = smoothstep(0.92, 1.0, fract(vH / 35.0 - uTime * 0.25)) * (1.0 - h);
          float a = (pow(1.0 - h, 3.0) * 0.03 + anillos * 0.03) * (0.3 + 0.7 * borde) * smoothstep(0.0, 0.01, h) * smoothstep(1.0, 0.6, h);
          gl_FragColor = vec4(${glsl(0x42d9ce)} * 1.5, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }))
    this.haz.frustumCulled = false
  }
  /** "vuelo" hasta el contacto; después, "exito" o "fallo" según el resultado que grabó el ambiente. */
  setEstado(e: EstadoPlataforma) { if (e !== this.estado) { this.estado = e; this.tEstado = 0 } }
  setFocos(on: boolean) { for (const f of this.focos) f.visible = on }
  actualizar(dt: number, reloj: number) {
    this.tEstado += dt
    for (const s of this.luces) {
      const m = s.material
      if (this.estado === 'vuelo') { m.color.copy(CIAN); m.opacity = 0.22 + 0.78 * Math.pow(Math.max(0, Math.cos(s.userData.a - reloj * 2.4)), 14) }
      else if (this.estado === 'exito') { m.color.copy(VERDE); m.opacity = Math.min(1, this.tEstado * 2) * (0.75 + 0.25 * Math.sin(reloj * 3)) }
      else { m.color.copy(NARANJA); m.opacity = Math.sin(reloj * 9) > 0 ? 1 : 0.12 }
    }
    const blink = Math.sin(reloj * 2.6) > 0.55 ? 1 : 0.08
    for (const b of this.balizas) b.material.opacity = blink
  }
}

/** Torres del nivel 2 y pasarela de los niveles con v1: acero oscuro con franjas de advertencia y balizas. */
export function construirObstaculos(T: Texturas, lista: Obstaculo[], grupo: THREE.Group) {
  const balizas: THREE.Sprite[] = []
  let pasarela: { altura: number; materiales: THREE.Material[]; opacidades: number[] } | null = null
  const acero = new THREE.MeshStandardMaterial({ map: T.franjasTex, roughness: 0.55, metalness: 0.75, envMapIntensity: 0.8 })
  const oscuro = new THREE.MeshStandardMaterial({ color: 0x2c2f38, roughness: 0.55, metalness: 0.75 })
  const baliza = (hex: number, s: number) => { const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.GLOW, color: hex, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })); b.scale.set(s, s, 1); return b }
  for (const o of lista) {
    if (o.tipo === 'pasarela') { pasarela = construirPasarela(T, o, oscuro, grupo, balizas); continue }
    const g = new THREE.Group(); g.position.copy(V(o.x, o.y, terrainHeight(o.x, -o.y)))
    const mat = acero.clone(); mat.map = T.franjasTex.clone(); mat.map.repeat.set(1, o.altura / 40); mat.map.needsUpdate = true
    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(o.radio * 0.85, o.radio, o.altura, 32, 1, false), mat)
    cuerpo.position.y = o.altura / 2; cuerpo.castShadow = cuerpo.receiveShadow = true; g.add(cuerpo)
    for (let y = 40; y < o.altura; y += 40) { // anillos de refuerzo
      const r = o.radio * (1 - 0.15 * (y / o.altura)) + 0.4
      const anillo = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 8, 48), oscuro); anillo.rotation.x = Math.PI / 2; anillo.position.y = y; anillo.castShadow = true; g.add(anillo)
    }
    const tapa = new THREE.Mesh(new THREE.CylinderGeometry(o.radio * 0.85 + 1.6, o.radio * 0.85 + 1.6, 1.4, 32), oscuro); tapa.position.y = o.altura + 0.7; tapa.castShadow = true; g.add(tapa)
    const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 8, 8), oscuro); mastil.position.y = o.altura + 5; g.add(mastil)
    const b = baliza(0xff5a2a, 6); b.position.y = o.altura + 9.5; g.add(b); balizas.push(b)
    for (let y = 60; y < o.altura; y += 60) { const s = baliza(0xff8a42, 3); s.position.set(o.radio + 0.8, y, 0); s.material.opacity = 0.8; g.add(s) } // luces de obstáculo a media altura
    grupo.add(g)
  }
  return { balizas, pasarela }
}
/** Pasarela: tablero translúcido con la abertura, celosía de vigas, baranda y luces en el borde de la abertura. El tablero
 *  y las vigas se vuelven casi transparentes cuando quedan entre la cámara y el cohete, para no taparlo. */
function construirPasarela(T: Texturas, o: Obstaculo, oscuro: THREE.Material, grupo: THREE.Group, balizas: THREE.Sprite[]) {
  const g = new THREE.Group(), R = o.radio, H = o.altura, grosor = o.grosor ?? 3, ra = o.radio_abertura ?? 12
  const forma = new THREE.Shape(); forma.absarc(0, 0, R, 0, Math.PI * 2, false)
  const hueco = new THREE.Path(); hueco.absarc(o.x, -o.y, ra, 0, Math.PI * 2, true); forma.holes.push(hueco)
  const tablero = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: grosor, bevelEnabled: false, curveSegments: 96 }),
    new THREE.MeshStandardMaterial({ color: 0x7d8494, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.6 }))
  tablero.rotation.x = Math.PI / 2; tablero.position.y = H + grosor / 2; tablero.renderOrder = 1; g.add(tablero)
  const vigaMat = new THREE.MeshStandardMaterial({ color: 0x4f5462, roughness: 0.5, metalness: 0.8, transparent: true, opacity: 0.9 })
  for (let k = 0; k < 12; k++) { // vigas radiales bajo el tablero
    const a = (k / 12) * Math.PI * 2, viga = new THREE.Mesh(new THREE.BoxGeometry(R - 14, 1.6, 1.0), vigaMat)
    viga.position.set(Math.cos(a) * (R + 14) / 2, H - grosor / 2 - 0.8, Math.sin(a) * (R + 14) / 2); viga.rotation.y = -a; viga.castShadow = true; g.add(viga)
  }
  for (const r of [R * 0.45, R * 0.75, R - 0.6]) { // anillos de la celosía y borde
    const anillo = new THREE.Mesh(new THREE.TorusGeometry(r, 0.7, 8, 128), vigaMat); anillo.rotation.x = Math.PI / 2; anillo.position.y = H - grosor / 2 - 0.8; g.add(anillo)
  }
  const baranda = new THREE.Mesh(new THREE.TorusGeometry(R - 1, 0.25, 6, 128), oscuro); baranda.rotation.x = Math.PI / 2; baranda.position.y = H + grosor + 1.2; g.add(baranda)
  const borde = new THREE.Mesh(new THREE.TorusGeometry(ra + 0.4, 0.6, 8, 64), new THREE.MeshStandardMaterial({ color: 0xc8c4bb, emissive: 0xff8a42, emissiveIntensity: 0.8, roughness: 0.5, metalness: 0.4 }))
  borde.rotation.x = Math.PI / 2; borde.position.set(o.x, H + grosor / 2, -o.y); g.add(borde)
  for (let k = 0; k < 12; k++) { // luces alrededor de la abertura, para verla desde arriba y desde abajo
    const a = (k / 12) * Math.PI * 2, s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.GLOW, color: k % 2 ? 0xff8a42 : 0xfff0c8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    s.position.set(o.x + Math.cos(a) * (ra + 1.2), H + grosor / 2 + 0.6, -o.y + Math.sin(a) * (ra + 1.2)); s.scale.set(4, 4, 1); g.add(s); balizas.push(s)
  }
  grupo.add(g)
  return { altura: H, materiales: [tablero.material, vigaMat] as THREE.Material[], opacidades: [0.42, 0.9] }
}
