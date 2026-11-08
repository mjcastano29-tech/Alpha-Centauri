// Escena three.js que reproduce una trayectoria ya calculada por el ambiente (Python). Interpola entre las muestras
// grabadas cada 0,1 s con un spline de Hermite (usa las velocidades grabadas); nada de lo que ocurre aquí cambia los
// datos. El modo (replay de entrenamiento, modelo final o evaluación en vivo) lo decide quien crea el reproductor.
// Mundo: el planeta Elyndra, en el sistema de Alfa Centauri (cielo, gigante con anillos, islas flotantes, flora
// bioluminiscente). Efectos de descenso y contacto disparados por los eventos reales de la trayectoria.
import * as THREE from 'three'
import type { Vuelo } from '../api'
import { Sonido } from '../sonido'
import { Esporas, NIEBLA, SOL_A, SOL_B, parchearNiebla } from './atmosfera'
import { PRESETS, calidadSugerida, type NivelCalidad } from './calidad'
import { PLANETA_DIR, crearCielo, crearEntorno, type Cielo } from './cielo'
import { construirNave, construirPropulsor, plumeMaterial, type Nave } from './cohete'
import { OndaChoque, Particulas } from './efectos'
import { CAM_ATERRIZAJE, crearFlora, type Flora } from './flora'
import { crearMontanas, type Montanas } from './montanas'
import { Plataforma, construirObstaculos, type Obstaculo } from './plataforma'
import { Posproceso } from './posproceso'
import { smooth } from './ruido'
import { crearRocas, crearSuelo, terrainHeight, type UniformesMundo } from './terreno'
import { PAD_R, PAD_TOP, texturas, type Texturas } from './texturas'

const DT = 0.1 // s entre muestras grabadas
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y) // el entorno usa z hacia arriba; three.js, y hacia arriba
const COLOR_RESULTADO: Record<string, number> = { aterrizaje: 0x3ee08a, 'fuera de plataforma': 0xffc857, choque: 0xff4d5a, 'sin pasos': 0x9aa6b8, 'fuera de zona': 0xa879d9, 'colisión': 0xff8a42 }
const UP = new THREE.Vector3(0, 1, 0)
const PLANETA_H = new THREE.Vector3(PLANETA_DIR.x, 0, PLANETA_DIR.z).normalize()

export type ModoCamara = 'cine' | 'seguir' | 'torre' | 'aterrizaje' | 'abordo'
export type Cohete = 'nave' | 'propulsor'
export interface EstadoReproductor { indice: number; paso: number; etiqueta: string; recompensaAcumulada: number; terminado: boolean; velocidadEfectiva: number }

interface Muestra { x: number; y: number; z: number; dx: number; dy: number; dz: number; wx: number; wy: number; wz: number; thr: number; engT: number }
// el vuelo está grabado cada DT segundos; entre dos muestras la posición se interpola con un spline de Hermite que usa las velocidades
function sampleAt(f: Vuelo['f'], t: number, S: Muestra) {
  const n = f.t.length, i0 = Math.min(Math.floor(t), n - 1), i1 = Math.min(i0 + 1, n - 1)
  const h = f.t[i1] - f.t[i0], a = h > 0 ? Math.min(1, Math.max(0, t - i0)) : 0
  const a2 = a * a, a3 = a2 * a, h00 = 2 * a3 - 3 * a2 + 1, h10 = a3 - 2 * a2 + a, h01 = 3 * a2 - 2 * a3, h11 = a3 - a2
  const herm = (p: 'x' | 'y' | 'z', v: 'vx' | 'vy' | 'vz') => h00 * f[p][i0] + h10 * h * f[v][i0] + h01 * f[p][i1] + h11 * h * f[v][i1]
  const lerp = (k: 'dx' | 'dy' | 'dz' | 'wx' | 'wy' | 'wz' | 'eng_t') => f[k][i0] + (f[k][i1] - f[k][i0]) * a
  S.x = herm('x', 'vx'); S.y = herm('y', 'vy'); S.z = Math.max(0, herm('z', 'vz'))
  S.dx = lerp('dx'); S.dy = lerp('dy'); S.dz = lerp('dz'); S.wx = lerp('wx'); S.wy = lerp('wy'); S.wz = lerp('wz'); S.engT = lerp('eng_t')
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
  cine = true // órbita lenta de la cámara de seguimiento mientras reproduce
  slowmo = true // cámara lenta por debajo de 80 m
  fantasmas = true
  camMode: ModoCamara = 'cine'
  onFrame?: (estado: EstadoReproductor) => void
  onEnd?: () => void
  /** Avisa cuando cambia el nivel de calidad (también cuando el modo automático baja de nivel por falta de fps). */
  onCalidad?: (nivel: NivelCalidad, auto: boolean) => void
  /** Motor, contacto, choque y viento; apagado hasta que el usuario lo activa con un clic. */
  readonly sonido = new Sonido()
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
  private nivel: NivelCalidad = 'alta'
  private auto = true
  private intensidad = 1
  private visible = true
  private medida = { t: 0, n: 0, espera: 3 } // fps medidos para el modo automático
  private readonly cam = { yaw: 0.9, pitch: 0.16, dist: 120, target: new THREE.Vector3(0, 300, 0) }
  private lastInteract = -1e9
  private drag: { x: number; y: number } | null = null
  private readonly dir = { plano: -1, delta: new THREE.Vector3(), mezcla: 1, yaw: 0, manual: false } // director de la cámara cinematográfica
  private finT = -1 // s desde el contacto (−1: aún no), para apagar el motor poco a poco y la transición final
  private thrFin = 0
  private readonly impacto = { t: -1, amp: 0 }
  private obstaculos: { x: number; z: number; r: number; top: number }[] = [] // torres, para que la cámara cinematográfica no quede detrás
  private readonly giro = { plano: -1, angulo: 0 }
  // mundo
  private readonly contenedor: HTMLElement
  private readonly T: Texturas
  private readonly U: UniformesMundo = { uTime: { value: 0 }, uBlast: { value: new THREE.Vector4(0, -1000, 0, 0) }, uBrillo: { value: 1 } }
  private readonly cielo: Cielo
  private readonly entorno: THREE.WebGLRenderTarget
  private readonly flora: Flora
  private readonly montanas: Montanas
  private readonly esporas: Esporas
  private readonly plataforma: Plataforma
  private readonly sun: THREE.DirectionalLight
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
  private readonly dust = new Particulas(1100, 0x8d87a6, 0.42, 5, 32, 1.4, -1.2)
  private readonly smoke = new Particulas(360, 0x1d1a24, 0.6, 8, 55, 0.5, 1.5)
  private readonly chispas = new Particulas(260, 0xffa860, 0.9, 0.6, 0.2, 0.6, -9.8, true)
  private readonly onda = new OndaChoque()
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
  private post: Posproceso | null = null
  private readonly observadores: { disconnect(): void }[] = []
  // temporales
  private readonly S: Muestra = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, wx: 0, wy: 0, wz: 0, thr: 0, engT: 300 }
  private readonly axis = new THREE.Vector3()
  private readonly nozzle = new THREE.Vector3()
  private readonly hit = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()
  private readonly tmp2 = new THREE.Vector3()
  private readonly tmp3 = new THREE.Vector3()
  private readonly tmp4 = new THREE.Vector3()
  private readonly qTarget = new THREE.Quaternion()
  private readonly fallAxis = new THREE.Vector3()
  private readonly fallQ = new THREE.Quaternion()

  constructor(contenedor: HTMLElement, opciones: { padRadius?: number; startAltitude?: number; calidad?: NivelCalidad | 'auto' } = {}) {
    parchearNiebla()
    this.contenedor = contenedor
    const padRadius = opciones.padRadius ?? 10
    const T = (this.T = texturas()), GLOW = T.GLOW, U = this.U
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }))
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    contenedor.appendChild(renderer.domElement)
    const scene = this.scene
    scene.fog = new THREE.FogExp2(NIEBLA.lejos, NIEBLA.densidad) // la niebla real (por altura y teñida por el sol) está en atmosfera.ts
    this.camera = new THREE.PerspectiveCamera(48, 1, 1, 30000)

    // cielo y reflejos
    this.cielo = crearCielo(U.uTime); scene.add(this.cielo.grupo)
    this.entorno = crearEntorno(renderer, this.cielo); scene.environment = this.entorno.texture

    // luces: Alfa Centauri A baja (cálida, con sombras), Alfa Centauri B (naranja, de relleno) y el cielo violeta del atardecer
    scene.add(new THREE.HemisphereLight(0x6b70c8, 0x1c1626, 1.15))
    const sun = (this.sun = new THREE.DirectionalLight(0xffd3aa, 4.4))
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 900, far: 2100 })
    scene.add(sun, sun.target)
    const sun2 = new THREE.DirectionalLight(0xff9a6a, 0.7); sun2.position.copy(SOL_B).multiplyScalar(1000); scene.add(sun2)

    // planeta: suelo, rocas, islas flotantes, flora, zona de aterrizaje y esporas en el aire
    scene.add(crearSuelo(U), crearRocas(U))
    this.montanas = crearMontanas(U, T); scene.add(this.montanas.grupo)
    this.flora = crearFlora(U, this.montanas.puntosFlora); scene.add(this.flora.grupo)
    this.plataforma = new Plataforma(T, padRadius, U.uTime); scene.add(this.plataforma.grupo)
    this.esporas = new Esporas(1700, U.uTime, U.uBlast); scene.add(this.esporas.points)

    // guías (se pueden ocultar): haz de aproximación, zona de vuelo, cuadrado de salida, trayectoria, pasos, viento y plomada
    scene.add(this.guides)
    this.guides.add(this.plataforma.haz)
    for (let z = 200; z <= 1200; z += 200) this.guides.add(this.anillo(300, z, 0x42d9ce, z % 600 === 0 ? 0.22 : 0.08))
    const startBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(100, 1, 100)), new THREE.LineBasicMaterial({ color: 0xb9a6e6, transparent: true, opacity: 0.4 }))
    startBox.position.y = opciones.startAltitude ?? 600; this.guides.add(startBox)

    // cohetes: nave de acero inoxidable o primera etapa reutilizable
    scene.add(this.rocket)
    this.ships = { nave: construirNave(T, this.rocket), propulsor: construirPropulsor(T, this.rocket) }
    this.ship = this.ships.nave
    const plumeGeo = new THREE.CylinderGeometry(0.42, 2.2, 1, 32, 1, true); plumeGeo.translate(0, -0.5, 0) // se abre: la atmósfera es fina
    const coreGeo = new THREE.CylinderGeometry(0.26, 0.42, 1, 24, 1, true); coreGeo.translate(0, -0.5, 0)
    this.plumeOuter = new THREE.Mesh(plumeGeo, plumeMaterial(false)); this.plumeInner = new THREE.Mesh(coreGeo, plumeMaterial(true))
    this.plumeOuter.renderOrder = 2; this.plumeInner.renderOrder = 3
    this.plumeOuter.frustumCulled = this.plumeInner.frustumCulled = false
    this.rocket.add(this.plumeOuter, this.plumeInner)
    this.nozzleGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffb070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.rocket.add(this.nozzleGlow)
    this.engineLight = new THREE.PointLight(0xffa868, 0, 320, 2); this.rocket.add(this.engineLight) // el chorro ilumina patas, suelo y flora cercana
    this.setCohete('nave')
    this.groundGlow = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshBasicMaterial({ map: GLOW, color: 0xff9a50, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.groundGlow.rotation.x = -Math.PI / 2; scene.add(this.groundGlow)
    this.scorch = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ map: T.scorchTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
    this.scorch.rotation.x = -Math.PI / 2; this.scorch.visible = false; scene.add(this.scorch)
    scene.add(this.dust.points, this.smoke.points, this.chispas.points, this.onda.mesh)
    // choque: bola de fuego, luz del estallido y humo negro
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.flashCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.flashLight = new THREE.PointLight(0xff8a30, 0, 500, 2)
    this.flash.visible = this.flashCore.visible = false; scene.add(this.flash, this.flashCore, this.flashLight)
    // marca en el suelo, plomada, viento, trayectoria y fantasmas
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(4, 24), new THREE.MeshBasicMaterial({ map: GLOW, color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }))
    this.shadow.rotation.x = -Math.PI / 2; this.guides.add(this.shadow)
    this.plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0xbfe9ea, dashSize: 6, gapSize: 6, transparent: true, opacity: 0.35 }))
    this.plumb.frustumCulled = false; this.guides.add(this.plumb)
    this.windArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 20, 0x42d9ce, 8, 5); this.guides.add(this.windArrow)
    this.guides.add(this.markers); scene.add(this.ghosts, this.torres)

    // cámara orbital propia: objetivo + yaw/pitch/distancia; las automáticas se apartan unos segundos cada vez que el usuario mueve la cámara
    const el = renderer.domElement
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', (ev) => { this.tomarControl(); this.drag = { x: ev.clientX, y: ev.clientY }; el.setPointerCapture(ev.pointerId) })
    el.addEventListener('pointermove', (ev) => { if (!this.drag) return; this.lastInteract = performance.now(); this.cam.yaw -= (ev.clientX - this.drag.x) * 0.006; this.cam.pitch = Math.min(1.45, Math.max(-0.1, this.cam.pitch + (ev.clientY - this.drag.y) * 0.004)); this.drag = { x: ev.clientX, y: ev.clientY } })
    el.addEventListener('pointerup', () => (this.drag = null))
    el.addEventListener('pointercancel', () => (this.drag = null))
    el.addEventListener('wheel', (ev) => { ev.preventDefault(); this.tomarControl(); this.lastInteract = performance.now(); this.cam.dist = Math.min(4000, Math.max(30, this.cam.dist * Math.exp(ev.deltaY * 0.001))) }, { passive: false })
    el.addEventListener('dblclick', () => { this.cam.yaw = 0.9; this.cam.pitch = 0.16; this.cam.dist = this._follow ? 120 : 1100 })
    const ro = new ResizeObserver(() => this.resize()); ro.observe(contenedor); this.observadores.push(ro)
    const io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting }); io.observe(contenedor); this.observadores.push(io)
    this.setCalidad(opciones.calidad ?? 'auto')
    this.raf = requestAnimationFrame(this.tick)
  }

  /** Al arrastrar con la cámara cinematográfica activa, la órbita manual empieza desde donde está la cámara. */
  private tomarControl() {
    if (this.camMode !== 'cine' || performance.now() - this.lastInteract < 5000) return
    const o = this.tmp.copy(this.camera.position).sub(this.cam.target), d = Math.max(30, o.length())
    this.cam.dist = d; this.cam.pitch = Math.min(1.45, Math.max(-0.1, Math.asin(o.y / d))); this.cam.yaw = Math.atan2(o.x, o.z)
    this.lastInteract = performance.now()
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
  /** Torres del nivel 2 y pasarela de los niveles con v1 (o ninguna), con la geometría que da la API. */
  setObstaculos(lista: Obstaculo[]) {
    this.torres.clear()
    const r = construirObstaculos(this.T, lista, this.torres)
    this.torreBeacons = r.balizas; this.pasarela = r.pasarela
    this.obstaculos = lista.filter((o) => o.tipo !== 'pasarela').map((o) => ({ x: o.x, z: -o.y, r: o.radio + 4, top: terrainHeight(o.x, -o.y) + o.altura + 12 }))
  }
  /** Escudo térmico de la nave (losetas negras en la mitad −z). */
  setEscudo(on: boolean) { this.ships.nave.heatShield?.(on) }
  /** Nivel de calidad ("auto": se elige por el equipo y baja si no llega a ~26 fps). */
  setCalidad(nivel: NivelCalidad | 'auto') {
    this.auto = nivel === 'auto'
    this.medida = { t: 0, n: 0, espera: 3 }
    this.aplicarCalidad(this.auto ? calidadSugerida(this.renderer) : (nivel as NivelCalidad))
  }
  get calidad() { return { nivel: this.nivel, auto: this.auto } }
  private aplicarCalidad(n: NivelCalidad) {
    const p = PRESETS[n]
    this.nivel = n
    const pr = Math.min(devicePixelRatio || 1, p.pixelRatio)
    this.renderer.setPixelRatio(pr)
    this.sun.castShadow = p.sombras > 0
    if (p.sombras && this.sun.shadow.mapSize.x !== p.sombras) { this.sun.shadow.mapSize.set(p.sombras, p.sombras); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null }
    const webgl2 = this.renderer.capabilities.isWebGL2
    if (p.composer && webgl2) { this.post?.dispose(); this.post = new Posproceso(this.renderer, this.scene, this.camera, p.msaa); this.post.setIntensidad(this.intensidad) }
    else if (this.post) { this.post.dispose(); this.post = null }
    this.flora.setDensidad(p.flora); this.montanas.setDensidad(p.flora)
    this.esporas.setCantidad(p.particulas * Math.min(1, this.intensidad))
    for (const ps of [this.dust, this.smoke, this.chispas]) ps.escala = p.particulas * this.intensidad
    this.cielo.setOctavas(p.nubes)
    this.plataforma.setFocos(p.focos)
    this.resize()
    this.onCalidad?.(n, this.auto)
  }
  /** Intensidad de efectos (0..1,5): partículas, brillo, vibración de cámara, grano y destello de la flora. */
  setIntensidad(k: number) {
    this.intensidad = Math.max(0, Math.min(1.5, k))
    this.post?.setIntensidad(this.intensidad)
    const p = PRESETS[this.nivel]
    this.esporas.setCantidad(p.particulas * Math.min(1, this.intensidad))
    for (const ps of [this.dust, this.smoke, this.chispas]) ps.escala = p.particulas * this.intensidad
    this.U.uBrillo.value = 0.55 + 0.45 * this.intensidad
  }
  setGuias(on: boolean) { this.guides.visible = on }
  setCamara(modo: ModoCamara) { this.camMode = modo; this.snap = true; this.dir.plano = -1 }
  get follow() { return this._follow }
  set follow(v: boolean) { this._follow = v; this.cam.dist = v ? 120 : 1100; if (!v) this.cam.target.set(0, 300, 0) }

  private resize() {
    const w = this.contenedor.clientWidth, h = this.contenedor.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false); this.post?.setTamano(w, h, this.renderer.getPixelRatio())
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix()
    this.escalaPuntos()
  }
  /** Píxeles por unidad a distancia 1: el tamaño en pantalla de las partículas no depende de la resolución. */
  private escalaPuntos() {
    const px = (this.renderer.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    this.esporas.setEscala(px); this.flora.setEscalaPuntos(px); this.montanas.setEscalaPuntos(px)
    for (const ps of [this.dust, this.smoke, this.chispas]) ps.setEscalaPuntos(px * 1.1)
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
    if (this.trailFull && this.trailDone) { this.guides.remove(this.trailFull, this.trailDone); this.trailFull.geometry.dispose(); this.trailDone.geometry.dispose(); (this.trailFull.material as THREE.Material).dispose(); (this.trailDone.material as THREE.Material).dispose() }
    const pos = this.posiciones(vuelo)
    const g1 = new THREE.BufferGeometry(); g1.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.trailFull = new THREE.Line(g1, new THREE.LineBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.12 }))
    this.trailDone = new THREE.Line(g2, new THREE.LineBasicMaterial({ color: 0xbff4f0, transparent: true, opacity: 0.5 }))
    this.guides.add(this.trailFull, this.trailDone)
    for (const m of this.markers.children as THREE.Mesh[]) m.geometry.dispose()
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
    const end = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.GLOW, color: hex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    end.position.set(pos[(n - 1) * 3], pos[(n - 1) * 3 + 1] + 1.5, pos[(n - 1) * 3 + 2]); end.scale.set(10, 10, 1); this.ghosts.add(end)
  }
  limpiarFantasmas() { this.ghosts.traverse((o) => { if (o instanceof THREE.Line) { o.geometry.dispose(); (o.material as THREE.Material).dispose() } else if (o instanceof THREE.Sprite) o.material.dispose() }); this.ghosts.clear() }
  get numeroFantasmas() { return this.ghosts.children.length / 2 }
  private resetEffects() {
    this.dust.reset(); this.smoke.reset(); this.chispas.reset(); this.onda.reset(); this.flashT = 0; this.crashT = -1; this.scorchLevel = 0
    this.finT = -1; this.impacto.t = -1; this.plataforma.setEstado('vuelo')
  }

  get indice() { return this.vuelo ? Math.min(Math.round(this.t), this.vuelo.f.t.length - 1) : 0 }
  get total() { return this.vuelo ? this.vuelo.f.t.length : 0 }
  ir(indice: number) { this.t = Math.max(0, Math.min(indice, this.total - 1)); this.playing = false; this.snap = true }
  reiniciar() { this.t = 0; this.playing = true; this.snap = true; this.touched = false; this.resetEffects() }
  /** Salta a la muestra donde empieza el siguiente paso del agente (o al final). */
  pasoSiguiente() { const v = this.vuelo; if (!v) return; const m = v.step_marks.find((s) => s.i > this.indice); this.ir(m ? m.i : this.total - 1) }
  /** Salta al paso anterior del agente (o al principio). */
  pasoAnterior() { const v = this.vuelo; if (!v) return; const m = [...v.step_marks].reverse().find((s) => s.i < this.indice); this.ir(m ? m.i : 0) }
  /** Posición en pantalla (px CSS, relativa al lienzo) del centro de la plataforma, para el indicador del objetivo. */
  objetivoPantalla(out: { x: number; y: number; visible: boolean; dist: number }) {
    const v = this.tmp3.set(0, PAD_TOP, 0), d = v.distanceTo(this.camera.position)
    v.project(this.camera)
    out.visible = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15
    out.x = (v.x * 0.5 + 0.5) * this.contenedor.clientWidth; out.y = (-v.y * 0.5 + 0.5) * this.contenedor.clientHeight; out.dist = d
    return out
  }

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
  private touchdown(v: Vuelo, n: number, p: THREE.Vector3, thr: number) { // efectos del final del vuelo (solo al llegar reproduciendo)
    if (this.t < n - 1) { if (this.touched) { this.touched = false; this.finT = -1; this.plataforma.setEstado('vuelo') } return }
    if (this.touched) return
    this.touched = true
    this.plataforma.setEstado(v.reason === 'aterrizaje' ? 'exito' : 'fallo') // el resultado lo decidió el ambiente
    if (this.snap) return
    const crash = v.reason === 'choque', colision = v.reason === 'colisión', suelo = v.f.z[n - 1] <= 0.5
    const vz = Math.abs(v.f.vz[n - 1]), k = this.intensidad
    this.finT = 0; this.thrFin = thr
    if (crash || colision) this.sonido.explosion()
    else if (suelo) this.sonido.contacto(Math.min(1, 0.35 + vz / 3))
    if (suelo) {
      this.dust.emit(p.x, 0.6, p.z, crash ? 420 : 240, crash ? 48 : 26, 5, 1.5 + (crash ? 48 : 26) * 0.09, 2.4)
      this.onda.disparar(p.x, (Math.hypot(p.x, p.z) < PAD_R ? PAD_TOP : 0) + 0.08, p.z, crash ? 75 : 30 + vz * 6, (crash ? 1 : 0.45 + vz * 0.12) * Math.min(1, k + 0.2), crash ? 0xffb070 : 0xa49cc4, crash ? 1.3 : 1.8)
      this.impacto.t = 0; this.impacto.amp = (crash ? 1.6 : 0.12 + vz * 0.1) * k
    }
    if (crash || colision) { // bola de fuego en el suelo o contra la torre; el cohete se vuelca hacia donde estaba inclinado
      this.flashT = 1.2; this.crashT = 0; this.crashY = colision ? p.y : 0
      this.fallDir.set(this.axis.x, 0, this.axis.z); if (this.fallDir.lengthSq() < 1e-4) this.fallDir.set(1, 0, 0); this.fallDir.normalize()
      this.chispas.emit(p.x, this.crashY + 4, p.z, 160, 30, 3, 26, 2.2)
      if (colision) { this.smoke.emit(p.x, p.y + 10, p.z, 40, 6, 4, 4, 6); this.impacto.t = 0; this.impacto.amp = 1.2 * k }
    }
  }

  /** ¿Alguna torre corta la línea entre la cámara y el cohete? */
  private tapado(a: THREE.Vector3, b: THREE.Vector3) {
    const ux = b.x - a.x, uz = b.z - a.z, L2 = ux * ux + uz * uz || 1
    return this.obstaculos.some((o) => {
      const t = Math.max(0, Math.min(1, ((o.x - a.x) * ux + (o.z - a.z) * uz) / L2))
      return Math.hypot(a.x + ux * t - o.x, a.z + uz * t - o.z) < o.r && a.y + (b.y - a.y) * t < o.top
    })
  }
  /** Cámara cinematográfica: planos según la fase real del vuelo, con transiciones suaves entre ellos. */
  private dirigir(dt: number, p: THREE.Vector3, z: number, ship: Nave) {
    const fin = this.touched && this.vuelo !== undefined && this.t >= this.vuelo.f.t.length - 1
    const plano = fin ? 3 : z > 260 ? 0 : z > 80 ? 1 : 2
    const look = this.tmp3.copy(p); look.y += ship.height * 0.45
    const cambio = plano !== this.dir.plano || this.dir.manual
    if (cambio && (plano === 1 || plano === 3)) this.dir.yaw = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z)
    if (this.playing || plano === 3) this.dir.yaw += dt * (plano === 3 ? 0.07 : 0.09)
    const d = this.tmp2
    let fov = 46
    if (plano === 0) { // gran angular desde abajo: el cohete recortado contra el gigante gaseoso y sus anillos
      const D = 230 + Math.min(z, 900) * 0.12
      d.copy(p).addScaledVector(PLANETA_H, -D); d.y = look.y - D * 0.21; fov = 44
    } else if (plano === 1) { // órbita lenta alrededor del cohete
      const D = 92 + z * 0.12
      d.set(p.x + D * Math.sin(this.dir.yaw), look.y + D * 0.1, p.z + D * Math.cos(this.dir.yaw))
    } else if (plano === 2) { // plano bajo desde el suelo, con la plataforma y el gigante al fondo
      d.copy(PLANETA_H).multiplyScalar(-80); d.y = terrainHeight(d.x, d.z) + 2.2
      const dist = d.distanceTo(look); fov = THREE.MathUtils.clamp((2 * Math.atan((ship.height * 1.4 + 10) / dist) * 180) / Math.PI, 24, 64)
    } else { // tras el contacto: órbita amplia y lenta alrededor del cohete posado
      d.set(p.x + 108 * Math.sin(this.dir.yaw), p.y + 24, p.z + 108 * Math.cos(this.dir.yaw)); fov = 44
    }
    if (this.obstaculos.length) { // si una torre tapa el plano, se gira alrededor del cohete hasta tener vista despejada
      if (this.giro.plano !== plano) { this.giro.plano = plano; this.giro.angulo = 0 }
      const ox = d.x - p.x, oz = d.z - p.z, cand = this.tmp4
      const rotar = (a: number) => cand.set(p.x + ox * Math.cos(a) - oz * Math.sin(a), d.y, p.z + ox * Math.sin(a) + oz * Math.cos(a))
      if (this.tapado(rotar(this.giro.angulo), look)) {
        for (const a of [0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, Math.PI]) {
          if (this.tapado(rotar(this.giro.angulo + a), look)) continue
          this.giro.angulo += a
          if (!cambio && !this.snap) { this.dir.delta.copy(this.camera.position).sub(cand); this.dir.mezcla = 0 }
          break
        }
      }
      d.copy(rotar(this.giro.angulo))
    }
    const suelo = terrainHeight(d.x, d.z) + 2; if (d.y < suelo) d.y = suelo
    if (cambio) {
      if (this.dir.plano >= 0 && !this.snap) { this.dir.delta.copy(this.camera.position).sub(d); this.dir.mezcla = 0 } else { this.dir.delta.set(0, 0, 0); this.dir.mezcla = 1 }
      this.dir.plano = plano; this.dir.manual = false
    }
    this.dir.mezcla = Math.min(1, this.dir.mezcla + dt / THREE.MathUtils.clamp(2.2 * 4 / Math.max(4, this.eff), 0.5, 2.2)) // a más velocidad de reproducción, transición más corta
    this.camera.up.set(0, 1, 0)
    this.camera.position.copy(d).addScaledVector(this.dir.delta, 1 - smooth(0, 1, this.dir.mezcla))
    this.cam.target.copy(look); this.camera.lookAt(look)
    return fov
  }

  private dibujar(dt: number, simDt: number, fxDt: number) {
    const v = this.vuelo
    this.clock += dt; this.U.uTime.value = this.clock
    if (!v) { this.cielo.grupo.position.copy(this.camera.position); this.render(dt); return }
    const { axis, nozzle, hit, tmp, qTarget, rocket, ship } = this
    const f = v.f, n = f.t.length, s = sampleAt(f, this.t, this.S), i = Math.min(Math.floor(this.t), n - 1)
    const ground = Math.hypot(s.x, s.y) < PAD_R ? PAD_TOP : 0 // sobre la losa, el cohete apoya en la losa
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

    // motor: penacho, brillo de la tobera y luz sobre patas, suelo y flora; el penacho no atraviesa el suelo.
    // Al tocar suelo el empuje grabado se apaga en ~0,9 s (solo el dibujo; los datos terminan en el contacto)
    const ended = this.t >= n - 1
    if (this.finT >= 0) this.finT += dt
    const cola = this.finT >= 0 && this.crashT < 0 ? this.thrFin * Math.max(0, 1 - this.finT / 0.9) : 0
    const thr = this.crashT >= 0 ? 0 : ended ? cola : s.thr, flick = (this.playing || cola > 0) && thr > 0 ? 0.92 + Math.random() * 0.16 : 1
    const hN = Math.max(0.2, nozzle.y - ground), toGround = hN / Math.max(0.25, axis.y)
    const L = thr > 0 ? Math.min((8 + 30 * thr) * flick, toGround + 1.5) : 0
    this.plumeOuter.visible = this.plumeInner.visible = this.nozzleGlow.visible = L > 0.05
    const pw = ship.plumeW
    this.plumeOuter.scale.set((1 + 0.4 * thr) * pw, Math.max(L, 0.01), (1 + 0.4 * thr) * pw)
    this.plumeInner.scale.set(pw, Math.max(Math.min(L, 6 + 14 * thr), 0.01), pw)
    for (const m of [this.plumeOuter, this.plumeInner]) { m.material.uniforms.time.value = this.clock; m.material.uniforms.power.value = thr > 0 ? (0.35 + 0.65 * thr) * flick : 0 }
    this.nozzleGlow.scale.setScalar((2.5 + 5 * thr) * flick * Math.sqrt(pw))
    this.engineLight.intensity = 1600 * thr * flick
    ship.calor(smooth(330, 640, s.engT)) // toberas al rojo según la temperatura del motor grabada
    hit.copy(nozzle).addScaledVector(axis, -toGround) // donde el chorro toca el suelo
    const near = thr * smooth(45, 0, hN), alcance = thr * smooth(80, 0, hN)
    this.U.uBlast.value.set(hit.x, ground, hit.z, alcance * (0.6 + 0.4 * this.intensidad))
    this.groundGlow.position.set(hit.x, ground + 0.06, hit.z); this.groundGlow.material.opacity = 0.9 * near * flick; this.groundGlow.scale.setScalar(0.6 + 2.4 * smooth(45, 0, hN))
    if (near > 0 && simDt > 0) {
      const want = 320 * near * simDt, speed = 25 + 35 * near
      this.dust.emit(hit.x, 0.6, hit.z, Math.floor(want) + (Math.random() < want % 1 ? 1 : 0), speed, 1.5 + hN * 0.1, 1.5 + speed * 0.09, 2.2)
      this.scorchLevel = Math.min(0.8, this.scorchLevel + near * simDt * 0.12); this.scorch.position.set(hit.x, ground + 0.04, hit.z)
    }
    this.scorch.material.opacity = this.scorchLevel; this.scorch.visible = this.scorchLevel > 0.01
    this.sonido.actualizar(this.playing || cola > 0 ? thr : 0, this.camera.position.distanceTo(nozzle), hN, Math.hypot(s.wx, s.wy))
    this.touchdown(v, n, p, s.thr)
    this.dust.update(fxDt, s.wx, s.wz, -s.wy); this.smoke.update(fxDt, s.wx, s.wz, -s.wy); this.chispas.update(dt, 0, 0, 0); this.onda.actualizar(dt)
    if (this.flashT > 0) { // bola de fuego: crece rápido y se apaga en 1,2 s
      this.flashT = Math.max(0, this.flashT - dt)
      const u = 1 - this.flashT / 1.2, fd = this.fallDir
      this.flash.position.set(p.x + fd.x * 6, this.crashY + 8 + 10 * u, p.z + fd.z * 6); this.flash.scale.setScalar(30 + 80 * Math.sqrt(u)); this.flash.material.opacity = Math.min(1, 1.6 * Math.pow(1 - u, 1.2))
      this.flashCore.position.copy(this.flash.position); this.flashCore.scale.setScalar(16 + 36 * Math.sqrt(u)); this.flashCore.material.opacity = Math.min(1, 1.4 * Math.pow(1 - u, 2))
      this.flashLight.position.copy(this.flash.position); this.flashLight.intensity = 9000 * Math.pow(1 - u, 2) * Math.max(0.3, this.intensidad)
    } else this.flashLight.intensity = 0
    this.flash.visible = this.flashCore.visible = this.flashT > 0
    this.plataforma.actualizar(dt, this.clock)
    const blink2 = Math.sin(this.clock * 1.7 + 1) > 0.3 ? 1 : 0.15; for (const b of this.torreBeacons) b.material.opacity = blink2
    for (const l of ship.luces) l.sprite.material.opacity = l.tipo === 'estrobo' ? ((this.clock % 1.4 < 0.06) || (this.clock % 1.4 > 0.18 && this.clock % 1.4 < 0.24) ? 1 : 0) : 0.85 + 0.15 * Math.sin(this.clock * 4)
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

    // sombras con el sol bajo: la caja de la luz cubre el cohete y, cerca del suelo, también la sombra que proyecta
    const lejos = p.y / SOL_A.y, sc = this.sun.shadow.camera as THREE.OrthographicCamera
    const centro = tmp.copy(p).addScaledVector(SOL_A, lejos < 280 ? -lejos * 0.5 : 0), half = lejos < 280 ? 34 + lejos * 0.5 : 36
    if (Math.abs(sc.right - half) > 0.5) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix() }
    this.sun.target.position.copy(centro); this.sun.position.copy(centro).addScaledVector(SOL_A, 1500)

    // cámaras
    const camera = this.camera, cam = this.cam, vib = (this.playing ? thr * (1 + 2 * smooth(60, 0, hN)) : 0) * this.intensidad
    const manual = performance.now() - this.lastInteract < 5000
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
    } else if (this.camMode === 'aterrizaje') { // cámara fija a ras de suelo junto a la losa, mirando hacia arriba al cohete
      camera.up.set(0, 1, 0); camera.position.set(CAM_ATERRIZAJE.x, terrainHeight(CAM_ATERRIZAJE.x, CAM_ATERRIZAJE.z) + 1.7, CAM_ATERRIZAJE.z)
      tmp.copy(p); tmp.y += ship.height * 0.5
      cam.target.lerp(tmp, this.snap || !this.playing ? 1 : 1 - Math.exp(-dt * 5))
      const dist = camera.position.distanceTo(cam.target), sway = 0.0012 * dist * (0.4 + vib)
      tmp.copy(cam.target); tmp.x += shake(this.clock * 0.09, sway); tmp.y += shake(this.clock * 0.06 + 1.1, sway)
      camera.lookAt(tmp); fov = THREE.MathUtils.clamp((2 * Math.atan((ship.height * 1.25 + 12) / dist) * 180) / Math.PI, 14, 62)
    } else if (this.camMode === 'cine' && !manual) {
      fov = this.dirigir(dt, p, s.z, ship)
      camera.position.x += shake(this.clock, 0.08 * vib); camera.position.y += shake(this.clock + 2.3, 0.08 * vib)
    } else { // seguimiento (y la cinematográfica mientras el usuario mueve la cámara)
      if (this.camMode === 'cine') this.dir.manual = true
      camera.up.set(0, 1, 0)
      if (this._follow || this.camMode === 'cine') { tmp.copy(p); tmp.y += ship.height * 0.45; cam.target.lerp(tmp, this.snap || !this.playing ? 1 : 1 - Math.exp(-dt * (4 + this.speed))) }
      if (this.camMode === 'seguir' && this.cine && this._follow && this.playing && !manual) {
        // órbita lenta; la cámara baja y se acerca a medida que el cohete se aproxima al suelo
        const k = 1 - Math.exp(-dt * 0.8)
        cam.yaw += dt * 0.06
        cam.dist += (75 + Math.min(s.z, 600) * 0.16 - cam.dist) * k
        cam.pitch += (0.05 + 0.22 * smooth(0, 400, s.z) - cam.pitch) * k
      }
      this.placeCamera()
      camera.position.x += shake(this.clock, 0.1 * vib); camera.position.y += shake(this.clock + 2.3, 0.1 * vib)
    }
    if (this.impacto.t >= 0) { // sacudida del contacto, amortiguada
      this.impacto.t += dt
      const a = this.impacto.amp * Math.exp(-this.impacto.t * 3.2)
      camera.position.y += a * Math.sin(this.impacto.t * 41); camera.position.x += a * 0.6 * Math.sin(this.impacto.t * 29 + 1)
      if (this.impacto.t > 1.8) this.impacto.t = -1
    }
    if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== nearPlane) {
      camera.fov = this.snap ? fov : camera.fov + (fov - camera.fov) * (1 - Math.exp(-dt * 4)); camera.near = nearPlane; camera.updateProjectionMatrix(); this.escalaPuntos()
    }
    this.esporas.actualizar(dt, camera.position, s.wx, s.wz, -s.wy)
    this.cielo.grupo.position.copy(camera.position)
    this.render(dt)
    this.snap = false
  }
  private render(dt: number) {
    if (this.post) this.post.render(dt, this.clock); else this.renderer.render(this.scene, this.camera)
  }
  /** Modo automático: si tras unos segundos no llega a ~26 fps, baja un nivel (una vez por nivel). */
  private medirFps(dt: number) {
    if (!this.auto || !this.visible || dt <= 0 || document.hidden) return
    const m = this.medida
    if (m.espera > 0) { m.espera -= dt; return }
    m.t += dt; m.n++
    if (m.t < 4) return
    const fps = m.n / m.t; m.t = 0; m.n = 0
    if (fps < 26 && this.nivel !== 'baja') { this.aplicarCalidad(this.nivel === 'alta' ? 'media' : 'baja'); m.espera = 3 }
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
    if (this.visible) { this.dibujar(dt, simDt, this.playing ? dt * this.eff : dt); this.medirFps(dt) }
    if (this.vuelo) this.onFrame?.(this.estado())
    if (fin) this.onEnd?.()
    this.raf = requestAnimationFrame(this.tick)
  }

  /** Libera todo: bucle, audio, observadores, geometrías, materiales, texturas y el contexto WebGL. */
  destruir() {
    cancelAnimationFrame(this.raf); this.sonido.destruir()
    for (const o of this.observadores) o.disconnect()
    this.post?.dispose(); this.post = null
    const texturasVistas = new Set<THREE.Texture>()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
      for (const mat of mats) { for (const v of Object.values(mat)) if (v instanceof THREE.Texture) texturasVistas.add(v); mat.dispose() }
    })
    for (const t of texturasVistas) t.dispose()
    this.entorno.dispose(); this.sun.shadow.map?.dispose()
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove()
  }
}
