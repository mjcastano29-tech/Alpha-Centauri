// Escena three.js que reproduce una trayectoria ya calculada por el ambiente (Python). Interpola entre
// las muestras grabadas cada 0,1 s; nada de lo que ocurre aquí cambia los datos. El modo (replay de
// entrenamiento, modelo final o evaluación en vivo) lo decide quien crea el reproductor.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Vuelo } from './api'

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y) // el entorno usa z hacia arriba
const COLOR_RESULTADO: Record<string, number> = { aterrizaje: 0x3ee08a, 'fuera de plataforma': 0xf2c14e, choque: 0xff6b5c, 'sin pasos': 0xa5b2c4, 'fuera de zona': 0xc39bff }

function texturaBrillo() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!, grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

export interface EstadoReproductor { indice: number; paso: number; etiqueta: string; recompensaAcumulada: number; terminado: boolean }

export class Reproductor {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private rocket = new THREE.Group()
  private flame: THREE.Mesh
  private glow: THREE.Sprite
  private trailFull?: THREE.Line
  private trailDone?: THREE.Line
  private markers = new THREE.Group()
  private ghosts = new THREE.Group()
  private wind: THREE.ArrowHelper
  private shadow: THREE.Mesh
  private vuelo?: Vuelo
  private t = 0
  playing = false
  speed = 4
  follow = true
  onFrame?: (estado: EstadoReproductor) => void
  onEnd?: () => void
  private last: number | null = null
  private raf = 0
  private padRadius: number
  private contenedor: HTMLElement

  constructor(contenedor: HTMLElement, opciones: { padRadius?: number; startAltitude?: number } = {}) {
    this.contenedor = contenedor
    this.padRadius = opciones.padRadius ?? 10
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    contenedor.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(0x3f5a8a)
    this.scene.fog = new THREE.Fog(0x6f7ea8, 900, 6000)
    this.camera = new THREE.PerspectiveCamera(48, 1, 1, 20000)
    this.camera.position.set(140, 60, 140)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.target.set(0, 300, 0)
    this.controls.addEventListener('start', () => { this.follow = false })

    this.scene.add(new THREE.HemisphereLight(0x8aa4dc, 0x4a3d33, 1.1))
    const sun = new THREE.DirectionalLight(0xffb070, 0.9); sun.position.set(-1600, 260, -1500); this.scene.add(sun)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: 0xd4bc92 }))
    ground.rotation.x = -Math.PI / 2; this.scene.add(ground)
    const grid = new THREE.GridHelper(1200, 24, 0xa89d85, 0xc4b99f); grid.position.y = 0.2; this.scene.add(grid)
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(72, 74, 1.6, 72), new THREE.MeshStandardMaterial({ color: 0x3a3f49, roughness: 0.9 }))
    pad.position.y = 0.8; this.scene.add(pad)
    const flat = (geom: THREE.BufferGeometry, mat: THREE.Material, y: number) => { const m = new THREE.Mesh(geom, mat); m.rotation.x = -Math.PI / 2; m.position.y = y; this.scene.add(m) }
    for (const [r, hex, op] of [[this.padRadius, 0x38ff9a, 1], [22, 0xffd24a, 0.9], [36, 0xffd24a, 0.55], [52, 0x5fd0ff, 0.5], [68, 0xffffff, 0.35]] as [number, number, number][]) {
      flat(new THREE.RingGeometry(r - 0.5, r + 0.5, 128), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op }), 1.7)
      flat(new THREE.RingGeometry(r - 3, r + 3, 128), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op * 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), 1.75)
    }
    flat(new THREE.CircleGeometry(this.padRadius - 0.6, 64), new THREE.MeshBasicMaterial({ color: 0x1f6b45, transparent: true, opacity: 0.85 }), 1.68)
    const brillo = texturaBrillo()
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 2 * Math.PI, x = 66 * Math.cos(a), z = 66 * Math.sin(a)
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 14, 10), new THREE.MeshStandardMaterial({ color: 0x2a2f3a })); pylon.position.set(x, 7, z); this.scene.add(pylon)
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: brillo, color: 0xfff0c8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.set(x, 14.5, z); s.scale.set(9, 9, 1); this.scene.add(s)
      const light = new THREE.PointLight(0xffe2a8, 60, 260, 2); light.position.set(x, 14, z); this.scene.add(light)
    }
    for (let z = 200; z <= 1200; z += 200) this.scene.add(this.anillo(300, z, 0x5fd0ff, z % 600 === 0 ? 0.35 : 0.16))
    const start = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(100, 1, 100)), new THREE.LineBasicMaterial({ color: 0xaab8d6, transparent: true, opacity: 0.55 }))
    start.position.y = opciones.startAltitude ?? 600; this.scene.add(start)

    // cohete (tamaño exagerado) con las patas en el punto de la trayectoria
    const hull = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.6, roughness: 0.38 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2129, metalness: 0.4, roughness: 0.5 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 16, 28), hull); this.rocket.add(body)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.9, 5.2, 28), dark); nose.position.y = 10.6; this.rocket.add(nose)
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.5, 2.4, 18), new THREE.MeshStandardMaterial({ color: 0x3b3f47, metalness: 0.7 })); bell.position.y = -9.1; this.rocket.add(bell)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * 2 * Math.PI + Math.PI / 4
      const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 1.3), dark); fin.position.set(2.9 * Math.cos(a), 6.2, 2.9 * Math.sin(a)); fin.rotation.y = -a; this.rocket.add(fin)
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7.6, 8), dark); leg.position.set(3.4 * Math.cos(a), -9.2, 3.4 * Math.sin(a)); leg.rotation.z = 0.62 * Math.cos(a); leg.rotation.x = -0.62 * Math.sin(a); this.rocket.add(leg)
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 10), dark); foot.position.set(5.2 * Math.cos(a), -12.4, 5.2 * Math.sin(a)); this.rocket.add(foot)
    }
    this.rocket.children.forEach((c) => (c.position.y += 12.6))
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(2, 14, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }))
    this.flame.rotation.x = Math.PI; this.rocket.add(this.flame)
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: brillo, color: 0xff9a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); this.rocket.add(this.glow)
    this.rocket.scale.setScalar(1.15)
    this.scene.add(this.rocket, this.markers, this.ghosts)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(4, 24), new THREE.MeshBasicMaterial({ map: brillo, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2; this.scene.add(this.shadow)
    this.wind = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 20, 0x5fd0ff, 5, 2.5); this.scene.add(this.wind)

    new ResizeObserver(() => this.resize()).observe(contenedor)
    this.resize()
    this.loop(performance.now())
  }

  private anillo(r: number, y: number, hex: number, opacity: number) {
    const pts = []; for (let k = 0; k <= 128; k++) pts.push(new THREE.Vector3(r * Math.cos((k / 128) * 2 * Math.PI), y, r * Math.sin((k / 128) * 2 * Math.PI)))
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity }))
  }

  private resize() {
    const w = this.contenedor.clientWidth, h = this.contenedor.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix()
  }

  private posiciones(v: Vuelo) {
    const n = v.f.t.length, arr = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) { arr[k * 3] = v.f.x[k]; arr[k * 3 + 1] = v.f.z[k]; arr[k * 3 + 2] = -v.f.y[k] }
    return arr
  }

  /** Carga una trayectoria y la reproduce desde el principio. */
  cargar(vuelo: Vuelo, reproducir = true) {
    if (this.vuelo && this.trailFull) this.fantasma(this.vuelo)
    this.vuelo = vuelo; this.t = 0; this.playing = reproducir; this.follow = true
    if (this.trailFull) this.scene.remove(this.trailFull, this.trailDone!)
    const pos = this.posiciones(vuelo)
    const g1 = new THREE.BufferGeometry(); g1.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3))
    this.trailFull = new THREE.Line(g1, new THREE.LineBasicMaterial({ color: 0xdff0ff, transparent: true, opacity: 0.22 }))
    this.trailDone = new THREE.Line(g2, new THREE.LineBasicMaterial({ color: 0xdff0ff }))
    this.scene.add(this.trailFull, this.trailDone)
    this.markers.clear()
    for (const m of vuelo.step_marks) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8fa3c0, transparent: true, opacity: 0.5 }))
      s.position.set(pos[m.i * 3], pos[m.i * 3 + 1], pos[m.i * 3 + 2]); s.userData.i = m.i; this.markers.add(s)
    }
    this.controls.target.copy(V(vuelo.f.x[0], vuelo.f.y[0], vuelo.f.z[0] + 12))
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(90, 30, 90))
    this.dibujar()
  }

  private fantasma(v: Vuelo) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.posiciones(v), 3))
    this.ghosts.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: COLOR_RESULTADO[v.reason] ?? 0xffffff, transparent: true, opacity: 0.5 })))
  }
  limpiarFantasmas() { this.ghosts.clear() }

  get indice() { return this.vuelo ? Math.min(Math.round(this.t), this.vuelo.f.t.length - 1) : 0 }
  get total() { return this.vuelo ? this.vuelo.f.t.length : 0 }
  ir(indice: number) { this.t = Math.max(0, Math.min(indice, this.total - 1)); this.playing = false; this.dibujar() }
  reiniciar() { this.t = 0; this.playing = true }

  private estado(): EstadoReproductor {
    const v = this.vuelo!, i = this.indice
    let k = v.step_marks.findIndex((m) => m.i >= i); if (k < 0) k = v.step_marks.length - 1
    const paso = i === 0 ? 0 : k + 1
    return { indice: i, paso, etiqueta: i === 0 ? '—' : v.step_marks[k].label, terminado: i >= v.f.t.length - 1,
      recompensaAcumulada: v.step_marks.filter((m) => m.i <= i).reduce((a, m) => a + m.r, 0) }
  }

  private dibujar() {
    const v = this.vuelo; if (!v) { this.renderer.render(this.scene, this.camera); return }
    const f = v.f, i = this.indice, p = V(f.x[i], f.y[i], f.z[i])
    this.rocket.position.copy(p)
    const axis = new THREE.Vector3(f.dx[i], f.dz[i], -f.dy[i]).normalize()
    this.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)
    const thr = f.on[i] ? f.thr[i] : 0, s = thr > 0 ? 0.3 + thr * 1.4 : 0
    this.flame.visible = this.glow.visible = s > 0
    this.flame.scale.set(0.8 + thr * 0.5, Math.max(s, 0.01), 0.8 + thr * 0.5); this.flame.position.y = 2.3 - 7 * s
    this.glow.scale.setScalar(6 + 16 * thr); this.glow.position.y = 2.3 - 2.5 * s
    this.shadow.position.set(p.x, 1.85, p.z); this.shadow.scale.setScalar(1 + f.z[i] / 150)
    const wl = Math.hypot(f.wx[i], f.wy[i], f.wz[i])
    this.wind.position.copy(p); this.wind.setDirection(new THREE.Vector3(f.wx[i], f.wz[i], -f.wy[i]).normalize()); this.wind.setLength(Math.min(90, Math.max(6, wl * 4)), 5, 2.5); this.wind.visible = wl > 0.3
    this.trailDone!.geometry.setDrawRange(0, i + 1)
    for (const m of this.markers.children as THREE.Mesh[]) (m.material as THREE.MeshBasicMaterial).opacity = m.userData.i <= i ? 1 : 0.5
    if (this.follow) { // la cámara acompaña al cohete manteniendo su encuadre
      const antes = this.controls.target.clone()
      this.controls.target.lerp(p.clone().add(new THREE.Vector3(0, 12, 0)), 0.25)
      this.camera.position.add(this.controls.target.clone().sub(antes))
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.onFrame?.(this.estado())
  }

  private loop = (ts: number) => {
    const dt = this.last === null ? 0 : (ts - this.last) / 1000; this.last = ts
    if (this.vuelo && this.playing) {
      this.t += (dt / 0.1) * this.speed
      if (this.t >= this.total - 1) { this.t = this.total - 1; this.playing = false; this.dibujar(); this.onEnd?.() }
    }
    this.dibujar()
    this.raf = requestAnimationFrame(this.loop)
  }

  destruir() { cancelAnimationFrame(this.raf); this.renderer.dispose(); this.renderer.domElement.remove() }
}
