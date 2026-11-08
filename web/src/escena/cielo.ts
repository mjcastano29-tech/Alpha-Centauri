// Cielo de Elyndra: degradado violeta y azul profundo, los dos soles de Alfa Centauri, un gigante gaseoso con anillos
// (sombra del planeta sobre los anillos y de los anillos sobre el planeta), dos lunas, estrellas, nubes altas y una
// aurora tenue. Todo vive en un grupo que sigue a la cámara (queda en el infinito) y se dibuja sin prueba de
// profundidad y antes que el resto: el relieve y las islas siempre lo tapan. El orden de dibujo resuelve qué tapa a qué.
import * as THREE from 'three'
import { GLSL_NIEBLA, SOL_A, SOL_B } from './atmosfera'
import { GLSL_RUIDO, glsl, glslV, mulberry32 } from './ruido'

const OUTPUT = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n'
export const PLANETA_DIR = new THREE.Vector3(-0.4, 0.3, -0.87).normalize() // el gigante asoma sobre el horizonte, detrás de la plataforma
const D_PLANETA = 8200, R_PLANETA = 2350, R_IN = 1.32, R_OUT = 2.55 // radios de los anillos en radios del planeta
const ORDEN = { cielo: -10, estrellas: -9, anilloAtras: -8, planeta: -7, lunas: -6, anilloDelante: -5, nubes: -4 }

// perfil radial de los anillos (x = 0 en el borde interior, 1 en el exterior): anillas finas, división principal y un hueco estrecho
const GLSL_ANILLO = `
  float densidadAnillo(float x){
    if (x < 0.0 || x > 1.0) return 0.0;
    float d = 0.55 + 0.45 * sin(x * 83.0) * sin(x * 29.0 + 1.3) + 0.12 * sin(x * 211.0);
    d *= smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.9, x);
    d *= 1.0 - 0.93 * smoothstep(0.50, 0.515, x) * smoothstep(0.585, 0.57, x);
    d *= 1.0 - 0.7 * smoothstep(0.835, 0.842, x) * smoothstep(0.862, 0.855, x);
    d *= mix(0.35, 1.0, smoothstep(0.08, 0.36, x));
    return clamp(d, 0.0, 1.0);
  }
  vec3 veloAtmosfera(vec3 c, vec3 dir){
    float hz = 1.0 - smoothstep(-0.02, 0.45, dir.y);
    return c * (1.0 - 0.5 * hz) + elyColorNiebla(dir) * (0.07 + 0.5 * hz);
  }`

export interface Cielo { grupo: THREE.Group; materiales: { cielo: THREE.ShaderMaterial; nubes: THREE.ShaderMaterial }; setOctavas(n: number): void }

export function crearCielo(uTime: { value: number }): Cielo {
  const grupo = new THREE.Group()
  const sinProfundidad = { depthTest: false, depthWrite: false }
  const cielo = new THREE.ShaderMaterial({
    side: THREE.BackSide, ...sinProfundidad,
    uniforms: { sunB: { value: SOL_B } },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 sunB; varying vec3 vPos;
      ${GLSL_NIEBLA}
      void main(){
        vec3 d = normalize(vPos); float h = d.y;
        vec3 c = mix(elyColorNiebla(d), ${glsl(0x3a3374)}, smoothstep(0.0, 0.26, h));
        c = mix(c, ${glsl(0x151b44)}, smoothstep(0.16, 0.6, h));
        c = mix(c, ${glsl(0x070a1c)}, smoothstep(0.5, 1.0, h));
        float a = max(dot(d, ELY_SOL), 0.0), b = max(dot(d, sunB), 0.0);
        c += ${glsl(0xffb98a)} * (pow(a, 6.0) * 0.22 + pow(a, 70.0) * 0.7);
        c += vec3(1.0, 0.94, 0.86) * smoothstep(0.99962, 0.99978, a) * 16.0;
        c += vec3(1.0, 0.55, 0.3) * pow(b, 60.0) * 0.3 + vec3(1.0, 0.76, 0.52) * smoothstep(0.99989, 0.99994, b) * 7.0;
        if (h < 0.0) c = mix(elyColorNiebla(d), elyColorNiebla(d) * 0.55, smoothstep(0.0, -0.35, h));
        gl_FragColor = vec4(c, 1.0);${OUTPUT}}`,
  })
  const esfera = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), cielo)
  esfera.renderOrder = ORDEN.cielo; esfera.frustumCulled = false; grupo.add(esfera)

  { // estrellas: solo en la parte alta del cielo y lejos del sol, tenues porque aún queda luz del atardecer
    const rnd = mulberry32(7), pos: number[] = []
    while (pos.length < 900 * 3) {
      const th = rnd() * 2 * Math.PI, y = 0.32 + rnd() * 0.68, r = Math.sqrt(1 - y * y), v = new THREE.Vector3(r * Math.cos(th), y, r * Math.sin(th))
      if (v.dot(SOL_A) < 0.55) pos.push(v.x * 8600, v.y * 8600, v.z * 8600)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    const estrellas = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, fog: false, ...sinProfundidad }))
    estrellas.renderOrder = ORDEN.estrellas; estrellas.frustumCulled = false; grupo.add(estrellas)
  }

  { // gigante gaseoso helado con anillos; el plano de los anillos se inclina ~20° hacia el observador
    const gigante = new THREE.Group()
    gigante.position.copy(PLANETA_DIR).multiplyScalar(D_PLANETA)
    const upProj = new THREE.Vector3(0, 1, 0).addScaledVector(PLANETA_DIR, -PLANETA_DIR.y).normalize().applyAxisAngle(PLANETA_DIR, THREE.MathUtils.degToRad(-22))
    const B = THREE.MathUtils.degToRad(19)
    const normal = upProj.multiplyScalar(Math.cos(B)).addScaledVector(PLANETA_DIR, -Math.sin(B)).normalize()
    gigante.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
    gigante.updateMatrix()
    const qInv = gigante.quaternion.clone().invert()
    const solLocal = SOL_A.clone().applyQuaternion(qInv), vistaLocal = PLANETA_DIR.clone().applyQuaternion(qInv) // dirección cámara → planeta
    grupo.add(gigante)
    const comunes = `uniform vec3 uSol; uniform vec3 uSolMundo; varying vec3 vP; varying vec3 vDir;
      ${GLSL_NIEBLA}${GLSL_RUIDO}${GLSL_ANILLO}`
    const vert = `varying vec3 vP; varying vec3 vDir; void main(){ vP = position; vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
    const planeta = new THREE.ShaderMaterial({
      ...sinProfundidad,
      uniforms: { uSol: { value: solLocal }, uSolMundo: { value: SOL_A } },
      vertexShader: vert,
      fragmentShader: `${comunes}
        void main(){
          vec3 n = normalize(vP); float lat = n.y, lon = atan(n.z, n.x);
          float turb = efbm(vec2(lon * 2.2, lat * 9.0), 4) - 0.5;
          float bandas = sin(lat * 24.0 + turb * 2.6) * 0.5 + 0.5;
          vec3 c = mix(${glsl(0x6a98b4)}, ${glsl(0xd4e0ec)}, bandas);
          c = mix(c, ${glsl(0x8470c0)}, smoothstep(0.55, 1.0, sin(lat * 57.0 + turb * 5.0) * 0.5 + 0.5) * 0.5);
          c = mix(c, ${glsl(0x5e7fb0)}, smoothstep(0.62, 0.9, abs(lat)) * 0.6);
          float tormenta = smoothstep(0.16, 0.0, length(vec2((lon - 0.8) * 0.55, (lat + 0.28) * 1.6)));
          c = mix(c, ${glsl(0xe6eef8)}, tormenta * 0.7);
          float ndl = dot(n, uSol);
          float dif = smoothstep(-0.06, 0.55, ndl);
          float sombra = 1.0;
          if (abs(uSol.y) > 1e-3) { float t = -n.y / uSol.y; if (t > 0.0) { vec3 q = n + uSol * t; sombra = 1.0 - 0.72 * densidadAnillo((length(q.xz) - ${R_IN.toFixed(2)}) / ${(R_OUT - R_IN).toFixed(2)}); } }
          vec3 col = c * (0.015 + 1.15 * dif * sombra);
          vec3 vd = normalize(vDir);
          float borde = pow(1.0 - abs(dot(n, normalize(-${glslV(vistaLocal)}))), 3.0);
          col += ${glsl(0x9fd8ff)} * borde * (0.08 + 0.9 * dif);
          col += ${glsl(0x3a3a70)} * 0.05 * (1.0 - dif);
          gl_FragColor = vec4(veloAtmosfera(col, vd), 1.0);${OUTPUT}}`,
    })
    const esferaP = new THREE.Mesh(new THREE.SphereGeometry(R_PLANETA, 96, 48), planeta)
    esferaP.renderOrder = ORDEN.planeta; gigante.add(esferaP)
    const anilloGeo = new THREE.RingGeometry(R_PLANETA * R_IN, R_PLANETA * R_OUT, 256, 2); anilloGeo.rotateX(-Math.PI / 2)
    const anillo = (mitad: number) => new THREE.ShaderMaterial({ // mitad +1: la parte más lejana que el planeta; −1: la que lo cruza por delante
      side: THREE.DoubleSide, transparent: false, ...sinProfundidad,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uSol: { value: solLocal }, uSolMundo: { value: SOL_A } },
      vertexShader: vert,
      fragmentShader: `${comunes}
        void main(){
          if (dot(vP, ${glslV(vistaLocal)}) * ${mitad.toFixed(1)} < 0.0) discard;
          float r = length(vP.xz) / ${R_PLANETA.toFixed(1)}, x = (r - ${R_IN.toFixed(2)}) / ${(R_OUT - R_IN).toFixed(2)};
          float dens = densidadAnillo(x);
          if (dens < 0.004) discard;
          vec3 q = vP / ${R_PLANETA.toFixed(1)}; float b = dot(q, uSol), cc = dot(q, q) - 1.0, disc = b * b - cc;
          float sombra = (disc > 0.0 && -b + sqrt(disc) > 0.0 && b < 0.0) ? 0.06 : 1.0;
          vec3 c = mix(${glsl(0x8c7f9e)}, ${glsl(0xe4e6f0)}, smoothstep(0.15, 0.75, x)) * (0.85 + 0.3 * sin(x * 37.0));
          vec3 vd = normalize(vDir);
          float luz = 0.3 + 1.1 * abs(uSol.y);
          vec3 col = c * luz * sombra + ${glsl(0xffe2c8)} * pow(max(dot(vd, uSolMundo), 0.0), 6.0) * 0.5 * sombra;
          float a = dens * 0.82;
          gl_FragColor = vec4(veloAtmosfera(col, vd) * a, a);${OUTPUT}}`,
    })
    const atras = new THREE.Mesh(anilloGeo, anillo(1)), delante = new THREE.Mesh(anilloGeo, anillo(-1))
    atras.renderOrder = ORDEN.anilloAtras; delante.renderOrder = ORDEN.anilloDelante
    gigante.add(atras, delante)

    const luna = new THREE.ShaderMaterial({
      ...sinProfundidad, uniforms: { uSolMundo: { value: SOL_A }, uTinte: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vN; varying vec3 vDir; void main(){ vN = normalize(mat3(modelMatrix) * normal); vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uSolMundo, uTinte; varying vec3 vN; varying vec3 vDir;
        ${GLSL_NIEBLA}${GLSL_RUIDO}${GLSL_ANILLO}
        void main(){ vec3 n = normalize(vN); float crater = en(n.xy * 7.0 + n.z * 3.0) * 0.35 + en(n.zy * 17.0) * 0.2;
          vec3 col = uTinte * (0.75 + crater) * (0.02 + smoothstep(-0.05, 0.5, dot(n, uSolMundo)));
          gl_FragColor = vec4(veloAtmosfera(col, normalize(vDir)), 1.0);${OUTPUT}}`,
    })
    for (const [az, el, dist, r, hex] of [[-22, 9, 7400, 160, 0xb9b2c8], [31, 21, 7900, 95, 0xc8b8a4]] as const) {
      const dir = PLANETA_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(az)); dir.y += Math.sin(THREE.MathUtils.degToRad(el)); dir.normalize()
      const m = luna.clone(); m.uniforms.uTinte.value = new THREE.Color(hex)
      const esferaL = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), m); esferaL.position.copy(dir).multiplyScalar(dist); esferaL.renderOrder = ORDEN.lunas; grupo.add(esferaL)
    }
  }

  // nubes altas y aurora: una cúpula aparte, por delante del gigante (las nubes están en la atmósfera de Elyndra)
  const nubes = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: false, ...sinProfundidad,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uTime, uOct: { value: 5 } },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform int uOct; varying vec3 vPos;
      ${GLSL_NIEBLA}${GLSL_RUIDO}
      void main(){
        vec3 d = normalize(vPos);
        if (d.y < 0.004) discard;
        vec2 uv = d.xz / (d.y + 0.1), w = vec2(uTime * 0.005, uTime * 0.0018);
        float n = efbm(uv * 1.05 + w, uOct), s = efbm(vec2(uv.x * 0.32, uv.y * 2.4) + w * 1.6 + 9.0, uOct);
        float dens = smoothstep(0.5, 0.82, n * 0.62 + s * 0.52) * smoothstep(0.0, 0.1, d.y) * (1.0 - 0.8 * smoothstep(0.3, 0.85, d.y));
        float a = max(dot(d, ELY_SOL), 0.0);
        vec3 lit = mix(${glsl(0x2a2655)}, ${glsl(0xc596b6)}, 0.3 + 0.7 * pow(a, 2.0)) + ${glsl(0xffc49a)} * pow(a, 9.0) * 0.9;
        lit = mix(lit, elyColorNiebla(d), 1.0 - smoothstep(0.0, 0.22, d.y));
        float az = atan(d.z, d.x);
        float banda = exp(-pow((d.y - 0.34 - 0.05 * sin(az * 3.0 + uTime * 0.04)) / 0.08, 2.0));
        float cortina = 0.5 + 0.5 * sin(az * 46.0 + efbm(vec2(az * 5.0, uTime * 0.03), 3) * 9.0);
        vec3 aurora = vec3(0.22, 0.92, 0.8) * banda * cortina * smoothstep(0.1, -0.7, dot(d, ELY_SOL)) * 0.22;
        float alpha = dens * 0.78;
        gl_FragColor = vec4(lit * alpha + aurora, alpha);${OUTPUT}}`,
  })
  const cupula = new THREE.Mesh(new THREE.SphereGeometry(8800, 48, 24), nubes)
  cupula.renderOrder = ORDEN.nubes; cupula.frustumCulled = false; grupo.add(cupula)
  return { grupo, materiales: { cielo, nubes }, setOctavas: (n) => { nubes.uniforms.uOct.value = n } }
}

/** Mapa de entorno a partir del cielo y un suelo oscuro: los reflejos del acero del cohete recogen el violeta y el rosa del atardecer. */
export function crearEntorno(renderer: THREE.WebGLRenderer, cielo: Cielo) {
  const escena = new THREE.Scene()
  escena.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), cielo.materiales.cielo))
  escena.add(new THREE.Mesh(new THREE.SphereGeometry(49, 48, 24), cielo.materiales.nubes))
  const suelo = new THREE.Mesh(new THREE.CircleGeometry(50, 32), new THREE.MeshBasicMaterial({ color: 0x1b1a2a }))
  suelo.rotation.x = -Math.PI / 2; suelo.position.y = -6; escena.add(suelo)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(escena, 0.03)
  pmrem.dispose()
  escena.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (o.material !== cielo.materiales.cielo && o.material !== cielo.materiales.nubes) (o.material as THREE.Material).dispose() } })
  return rt
}
