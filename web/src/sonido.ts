// Sonido de la escena 3D: motor, encendido, contacto, choque y viento, sintetizados con Web Audio (sin archivos).
// Viene de visualizacion/aprendizaje3d.html. El navegador solo deja sonar audio después de un clic: el contexto se crea
// la primera vez que se activa el sonido.

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

function loopBuffer(ctx: AudioContext, seconds: number, gen: (a: Float32Array) => void) { // ruido en bucle sin clic en la unión: el final se funde con lo que sigue al principio
  const n = Math.floor(ctx.sampleRate * seconds), F = Math.floor(ctx.sampleRate * 0.05), raw = new Float32Array(n + F)
  gen(raw)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = i < F ? raw[i] * (i / F) + raw[n + i] * (1 - i / F) : raw[i]
  return buf
}
const whiteNoise = (a: Float32Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1 }
const brownNoise = (a: Float32Array) => { let last = 0; for (let i = 0; i < a.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; a[i] = last * 3.5 } }
const crackleNoise = (a: Float32Array) => { // chasquidos sueltos que decaen en ~1 ms: el chisporroteo típico de un motor cohete
  for (let i = 0; i < a.length; i++) if (Math.random() < 0.002) { const amp = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.7); for (let k = 0; k < 160 && i + k < a.length; k++) a[i + k] += amp * Math.exp(-k / 25) }
}

interface Nodos { master: GainNode; air: BiquadFilterNode; rumble: GainNode; roar: GainNode; roarF: BiquadFilterNode; crack: GainNode; wind: GainNode }

export class Sonido {
  activo = false
  private ctx: AudioContext | null = null
  private nodos: Nodos | null = null
  private ruido: AudioBuffer | null = null
  private ultimoThr = 0

  private iniciar() {
    const ctx = new AudioContext()
    const src = (buf: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s }
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g }
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b }
    const master = gain(0), comp = ctx.createDynamicsCompressor()
    master.connect(comp).connect(ctx.destination)
    // motor: retumbo grave + rugido de banda ancha con turbulencia + chisporroteo; pasa por el filtro de distancia (el aire apaga los agudos)
    const air = filt('lowpass', 8000, 0.5); air.connect(master)
    const rumble = gain(); src(loopBuffer(ctx, 6, brownNoise)).connect(filt('lowpass', 160)).connect(rumble).connect(air)
    const roarF = filt('bandpass', 600, 0.6), flutter = gain(1), roar = gain()
    src(loopBuffer(ctx, 6, whiteNoise)).connect(roarF).connect(flutter).connect(roar).connect(air)
    src(loopBuffer(ctx, 6, brownNoise)).connect(filt('lowpass', 6)).connect(gain(0.6)).connect(flutter.gain) // el rugido late de forma irregular
    const crack = gain(); src(loopBuffer(ctx, 5, crackleNoise)).connect(filt('highpass', 700)).connect(crack).connect(air)
    // viento del planeta: ruido filtrado que sube y baja despacio
    const wind = gain(); src(loopBuffer(ctx, 8, whiteNoise)).connect(filt('bandpass', 380, 0.4)).connect(wind).connect(master)
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13; lfo.connect(gain(0.012)).connect(wind.gain); lfo.start()
    this.ctx = ctx; this.ruido = loopBuffer(ctx, 3, whiteNoise)
    this.nodos = { master, air, rumble, roar, roarF, crack, wind }
  }

  /** Enciende o apaga el sonido (debe llamarse desde un clic). Devuelve el estado nuevo. */
  alternar() {
    if (!this.ctx) this.iniciar()
    const ctx = this.ctx!, t = ctx.currentTime
    this.activo = !this.activo
    if (this.activo) ctx.resume()
    else { this.nodos!.master.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => { if (!this.activo) ctx.suspend() }, 400) }
    return this.activo
  }

  /** En cada fotograma: el motor sigue al acelerador grabado (0 en pausa) y a la distancia de la cámara a la tobera. */
  actualizar(thr: number, distancia: number, alturaTobera: number, viento: number) {
    if (!this.activo || !this.ctx || !this.nodos) return
    const { master, air, rumble, roar, roarF, crack, wind } = this.nodos, t = this.ctx.currentTime
    if (thr > 0.05 && this.ultimoThr <= 0.02) this.encendido() // encendido: golpe sordo
    this.ultimoThr = thr
    const near = 1 / (1 + distancia / 110), ground = 1 + 1.2 * smooth(40, 0, alturaTobera), e = Math.pow(thr, 0.7)
    rumble.gain.setTargetAtTime(1.6 * e * near * ground, t, 0.08)
    roar.gain.setTargetAtTime(1.0 * e * near, t, 0.08)
    roarF.frequency.setTargetAtTime(350 + 1400 * thr, t, 0.1)
    crack.gain.setTargetAtTime(0.6 * Math.pow(thr, 1.5) * near, t, 0.08)
    air.frequency.setTargetAtTime(600 + 9000 / (1 + distancia / 120), t, 0.2)
    wind.gain.setTargetAtTime(0.02 + 0.004 * viento, t, 0.5)
    master.gain.setTargetAtTime(0.9, t, 0.05)
  }

  private burst(t: number, dur: number, level: number, f0: number, f1: number) { // ráfaga de ruido con filtro que baja de f0 a f1 Hz
    const ctx = this.ctx!, n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    n.buffer = this.ruido; n.loop = true; f.type = 'lowpass'
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur)
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    n.connect(f).connect(g).connect(this.nodos!.master); n.start(t); n.stop(t + dur + 0.05)
  }
  private sub(t: number, dur: number, level: number, f0: number, f1: number) { // golpe grave: seno que baja de f0 a f1 Hz
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.nodos!.master); o.start(t); o.stop(t + dur + 0.05)
  }
  private encendido() { if (this.activo && this.ctx) { const t = this.ctx.currentTime; this.burst(t, 0.35, 0.5, 600, 120); this.sub(t, 0.4, 0.4, 60, 35) } }
  /** Contacto con el suelo; fuerza de 0 a 1 según la velocidad vertical. */
  contacto(fuerza: number) { if (this.activo && this.ctx) { const t = this.ctx.currentTime; this.sub(t, 0.9, 0.7 * fuerza, 70, 32); this.burst(t, 1.6, 0.35 * fuerza, 900, 200) } }
  explosion() { if (this.activo && this.ctx) { const t = this.ctx.currentTime; this.burst(t, 3, 1.2, 4000, 150); this.sub(t, 2.2, 1, 48, 22); this.burst(t + 0.25, 2.5, 0.5, 1500, 100) } }

  destruir() { this.activo = false; this.ctx?.close(); this.ctx = null; this.nodos = null }
}
