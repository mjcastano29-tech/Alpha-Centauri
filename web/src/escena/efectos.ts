// Efectos de partículas y de contacto: polvo que levanta el chorro (y el viento grabado arrastra), humo de un choque,
// esquirlas y la onda de polvo que se abre por el suelo al tocar. Son solo visuales: se disparan con los eventos de la
// trayectoria grabada (contacto en el último fotograma, resultado del ambiente) y no cambian ningún dato.
import * as THREE from 'three'
import { col } from './ruido'

const OUTPUT = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n'
/** Partículas suaves con vida, arrastre y gravedad; el viento grabado las desplaza. */
export class Particulas {
  readonly points: THREE.Points
  alive = 0
  private cursor = 0
  private readonly pos: Float32Array; private readonly vel: Float32Array; private readonly life: Float32Array; private readonly max: Float32Array; private readonly alpha: Float32Array; private readonly size: Float32Array
  private readonly N: number; private readonly opacity: number; private readonly size0: number; private readonly size1: number; private readonly drag: number; private readonly gravity: number
  /** Multiplica cuántas partículas se emiten (calidad e intensidad de efectos). */
  escala = 1
  constructor(N: number, hex: number, opacity: number, size0: number, size1: number, drag: number, gravity: number, aditivo = false) {
    this.N = N; this.opacity = opacity; this.size0 = size0; this.size1 = size1; this.drag = drag; this.gravity = gravity
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.alpha = new Float32Array(N); this.size = new Float32Array(N)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1)); geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1))
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { color: { value: col(hex) }, scale: { value: 600 } },
      vertexShader: `attribute float alpha; attribute float size; uniform float scale; varying float vA;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
          gl_FragColor = vec4(color, vA * (1.0 - d) * (1.0 - d));${OUTPUT}}`,
    }))
    this.points.frustumCulled = false
  }
  setColor(hex: number) { ((this.points.material as THREE.ShaderMaterial).uniforms.color.value as THREE.Color).copy(col(hex)) }
  setEscalaPuntos(px: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = px }
  emit(x: number, y: number, z: number, count: number, speed: number, spread: number, rise: number, lifeBase: number) { // abanico radial con subida vertical
    const n = Math.round(count * this.escala)
    for (let c = 0; c < n; c++) {
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

/** Anillo de polvo que se abre por el suelo desde el punto de contacto y se desvanece. */
export class OndaChoque {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private t = -1
  private dur = 1.6
  private radio = 40
  constructor() {
    const geo = new THREE.RingGeometry(0.55, 1, 96, 1); geo.rotateX(-Math.PI / 2)
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
      uniforms: { uP: { value: 0 }, uA: { value: 0 }, uColor: { value: col(0xa49cc4) } },
      vertexShader: 'varying float vR; void main(){ vR = length(position.xz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uP, uA; uniform vec3 uColor; varying float vR;
        void main(){ float a = smoothstep(0.55, 0.88, vR) * smoothstep(1.0, 0.93, vR) * pow(1.0 - uP, 1.5) * uA;
          gl_FragColor = vec4(uColor, a);${OUTPUT}}`,
    }))
    this.mesh.visible = false; this.mesh.frustumCulled = false
  }
  disparar(x: number, y: number, z: number, radio: number, intensidad: number, hex = 0xa49cc4, dur = 1.6) {
    this.t = 0; this.dur = dur; this.radio = radio; this.mesh.position.set(x, y, z); this.mesh.material.uniforms.uA.value = Math.min(1, intensidad)
    this.mesh.material.uniforms.uColor.value.copy(col(hex)); this.mesh.visible = true
  }
  actualizar(dt: number) {
    if (this.t < 0) return
    this.t += dt
    const u = Math.min(1, this.t / this.dur), s = 2 + this.radio * (1 - Math.pow(1 - u, 2.4))
    this.mesh.scale.set(s, 1, s); this.mesh.material.uniforms.uP.value = u
    if (u >= 1) { this.t = -1; this.mesh.visible = false }
  }
  reset() { this.t = -1; this.mesh.visible = false }
}
