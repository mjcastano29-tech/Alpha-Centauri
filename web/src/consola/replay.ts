// Consola de misión de PROJECT ELYNDRA para el replay 3D: cabecera de misión, escena con instrumentos superpuestos,
// controles de reproducción, telemetría por grupos, criterios de aterrizaje y resumen al terminar. Todo lo que muestra
// sale de la trayectoria grabada por el ambiente (Python); aquí no hay física ni reglas propias.
import * as api from '../api'
import type { Obstaculo, Vuelo } from '../api'
import { NIVELES, guardarPreferenciaCalidad, preferenciaCalidad, type NivelCalidad } from '../escena/calidad'
import type { Cohete, ModoCamara, Reproductor } from '../escena/reproductor'
import { cargarCatalogo, sesion } from '../estado'
import { COLOR_RESULTADO, corto, entero, esc, ICONO_RESULTADO, num, pillEstado } from '../ui'
import { ICONO } from './iconos'
import { CRITERIO, MOTOR_T_MAX, TEXTO_FASE, UMBRAL, criterios, faseMision, medir, resumenMision, type Fase } from './mision'

/** Si el usuario activó el sonido, sigue activo al cambiar de vuelo o de modelo (la página ya recibió un clic). */
let sonidoActivo = false
let intensidad = 1 // intensidad de efectos elegida en la sesión
const NOMBRE_CAMARA: Record<ModoCamara, string> = { cine: 'Cinematográfica (director)', seguir: 'Seguimiento', aterrizaje: 'Aterrizaje (a ras de suelo)', torre: 'Torre con teleobjetivo', abordo: 'A bordo' }
const NOMBRE_CALIDAD: Record<NivelCalidad, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' }
/** Escala del radar del objetivo: logarítmica, 0 m en el centro y 320 m (fuera de zona) en el borde. */
const ESCALA = (d: number) => Math.min(1, Math.log1p(d / 6) / Math.log1p(320 / 6))
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const conUnidad = (v: string, u: string) => (u === '°' ? `${v}°` : `${v} ${u}`)

export async function vistaReplay(el: HTMLElement, id: string, fuente: 'grabados' | 'evaluacion' | 'vivo'): Promise<() => void> {
  let vuelos: Vuelo[], modo: string, nota: string
  const ev = sesion.ultimaEvaluacion, vivo = fuente === 'vivo' ? sesion.vivo : null
  if (fuente === 'vivo') {
    if (!vivo || vivo.modelo.run_id !== id) {
      el.innerHTML = `<p class="error">No hay una misión en vivo de ${esc(id)} en esta sesión.</p><p><a href="#/vivo">Preparar una misión en vivo</a></p>`
      return () => {}
    }
    vuelos = [vivo.vuelo]
    modo = 'Misión en vivo'
    nota = `la API simula paso a paso con el modelo congelado; el viento que marques abajo se aplica desde el siguiente paso del agente · semilla ${vivo.semilla}`
  } else if (fuente === 'evaluacion') {
    if (!ev || ev.modelo.run_id !== id) {
      el.innerHTML = `<p><a href="#/ejecucion/${esc(id)}">← ejecución</a></p><p class="error">No hay una evaluación en vivo de ${esc(id)} en esta sesión. Lánzala desde la página de la ejecución.</p>`
      return () => {}
    }
    vuelos = ev.vuelos
    modo = 'Evaluación en vivo'
    nota = `ejecutada por la API hace un momento · ${ev.suite.episodios} épocas, semilla inicial ${ev.suite.semilla_base}${ev.suite.viento !== null ? `, viento ${ev.suite.viento} m/s` : ''}`
  } else {
    vuelos = (await api.vuelos(id)).episodes
    modo = 'Replay'
    nota = 'vuelos grabados durante el entrenamiento (con exploración) y del modelo final (sin ruido)'
  }
  const c = await cargarCatalogo(), r = c.ejecuciones.find((e) => e.run_id === id)
  const obstaculos: Obstaculo[] = vivo ? vivo.ambiente.obstaculos : fuente === 'evaluacion' ? ev!.ambiente.obstaculos : r?.obstaculos ?? []
  const nivelVisto = vivo ? vivo.ambiente.nivel : fuente === 'evaluacion' ? ev!.ambiente.nivel : r?.nivel ?? 'N1'
  const finales = vuelos.filter((v) => !v.epoch && !v.epoca_evaluacion)
  const etiqueta = (v: Vuelo) => vivo ? 'Misión en vivo · viento manual' : v.epoch ? `Época ${entero(v.epoch)} · entrenamiento` : v.epoca_evaluacion ? `Evaluación · época ${v.epoca_evaluacion}` : `Modelo final · vuelo ${finales.indexOf(v) + 1} de ${finales.length}`
  const amb = c.ambientes.find((a) => a.id === (vivo ? vivo.ambiente.id : fuente === 'evaluacion' ? ev!.ambiente.id : r?.ambiente_id))
  const radio = amb?.radio_plataforma ?? 10, salida = amb?.altitud_salida ?? 600, pasos = amb?.pasos ?? 50
  const obst = obstaculos.length ? (obstaculos.some((o) => o.tipo === 'pasarela') ? `pasarela y ${obstaculos.filter((o) => o.tipo !== 'pasarela').length} pilares` : `${obstaculos.length} torres`) : ''
  const etiquetas = [
    `<span class="etiqueta destacada">${esc(nivelVisto)}${nivelVisto !== r?.nivel ? ` · jugando fuera de ${esc(r?.nivel ?? '')}${r?.nivel === 'N1' ? ' con adaptador' : ''}` : ''}</span>`,
    r?.ambiente ? `<span class="etiqueta">${esc(r.ambiente)}</span>` : '',
    r?.agente.nombre ? `<span class="etiqueta">${esc(r.agente.nombre)}</span>` : '',
    obst ? `<span class="etiqueta">${esc(obst)}</span>` : '',
    r?.mlflow ? `<span class="etiqueta">${esc(r.mlflow.modelo)} v${r.mlflow.version}</span>` : '',
    r?.git.commit ? `<span class="etiqueta">commit ${corto(r.git.commit)}</span>` : '',
  ].join('')
  const fila = (fid: string, nombre: string, unidad = '', barra = false, marca?: number) => `
    <div class="tm" id="${fid}"><span class="tm-k">${nombre}</span><span class="tm-v"><b>—</b>${unidad ? `<small>${unidad}</small>` : ''}</span>${barra ? `<span class="tm-barra"><i></i>${marca !== undefined ? `<em style="left:${(marca * 100).toFixed(1)}%"></em>` : ''}</span>` : ''}</div>`
  const grupo = (titulo: string, icono: string, cuerpo: string, extra = '') => `<section class="grupo"><h3>${icono}<span>${titulo}</span>${extra ? `<small>${extra}</small>` : ''}</h3><div class="grupo-cuerpo">${cuerpo}</div></section>`
  const rRadar = (d: number) => (56 * ESCALA(d)).toFixed(1)
  el.innerHTML = `
    <section class="consola" data-fase="preparando">
      <header class="mision">
        <div class="mision-id">
          <span class="modo ${fuente === 'evaluacion' ? 'modo-eval' : fuente === 'vivo' ? 'modo-vivo' : 'modo-replay'}"><i class="vivo"></i>${esc(modo)}</span>
          <div class="mision-nombre"><span class="kicker">PROJECT ELYNDRA · misión</span><h2>${esc(id)} ${r?.estado === 'recomendado' ? pillEstado(r.estado) : ''}</h2></div>
        </div>
        <dl class="mision-datos">
          <div><dt>Estado</dt><dd><span class="fase" id="mi-fase">${TEXTO_FASE.preparando}</span></dd></div>
          <div><dt>Zona de aterrizaje</dt><dd>Plataforma Alfa-1 · radio ${num(radio, 0)} m</dd></div>
          <div class="mi-cond"><dt>Condiciones del vuelo</dt><dd id="mi-cond">—</dd></div>
        </dl>
        <label class="selector-vuelo"><span class="kicker">Vuelo</span><select id="rp-vuelo">${vuelos.map((v, k) => `<option value="${k}">${esc(etiqueta(v))} · ${esc(v.reason)} · ${v.steps} pasos</option>`).join('')}</select></label>
        <a class="btn-consola" href="#/ejecucion/${esc(id)}" title="Ficha del modelo y evaluación en vivo">Ficha y evaluación →</a>
        <div class="mision-pie"><p class="consola-nota">${esc(nota)}</p><div class="etiquetas">${etiquetas}</div></div>
      </header>
      <div class="replay">
        <div class="visor">
          <div class="escena"><div id="visor3d"></div>
            <div class="hud hud-vuelo" aria-hidden="true">
              <span class="hud-id" id="hud-ep"></span>
              <div><span class="hud-k">Altitud</span><span class="hud-v grande" id="hud-alt">—</span></div>
              <div class="hud-par"><div><span class="hud-k">V. vertical</span><span class="hud-v" id="hud-vz">—</span></div><div><span class="hud-k">V. horizontal</span><span class="hud-v" id="hud-vh">—</span></div></div>
            </div>
            <div class="hud hud-fase"><i></i><span id="hud-fase">${TEXTO_FASE.preparando}</span><span class="hud-t" id="hud-t">T+ 0,0 s</span></div>
            <div class="hud hud-cinta" aria-hidden="true"><span>${salida} m</span><span class="cinta-barra"><b style="bottom:${((UMBRAL.aproximacion / salida) * 100).toFixed(1)}%" title="aproximación"></b><i id="hud-cinta"></i></span><span>0 m</span></div>
            <div class="hud hud-objetivo" aria-hidden="true">
              <svg viewBox="-60 -60 120 120"><circle r="56" class="r-borde"/><circle r="${rRadar(100)}" class="r-anillo"/><circle r="${rRadar(30)}" class="r-anillo"/><circle r="${rRadar(radio)}" class="r-pad"/><path d="M-56 0H56M0-56V56" class="r-ejes"/><line id="hud-rumbo" class="r-rumbo"/><circle id="hud-punto" r="3.6" class="r-punto"/></svg>
              <div><span class="hud-k">Objetivo</span><span class="hud-v" id="hud-dist">—</span></div>
            </div>
            <div class="reticula" id="hud-reticula" aria-hidden="true"><i></i><i></i><i></i><i></i><span id="hud-ret-txt">Plataforma</span></div>
            <div class="hud hud-pasos" aria-hidden="true"><div class="pasos-txt"><b id="hud-paso"></b><span id="hud-accion"></span></div><span class="pasos-barra"><i id="hud-pasos"></i></span></div>
            <div class="resumen" id="rp-resumen" hidden></div>
          </div>
          <div class="transporte">
            <div class="botones">
              <button type="button" class="btn-icono" id="rp-atras" aria-label="Paso anterior" title="Paso anterior (←)">${ICONO.pasoAtras}</button>
              <button type="button" class="btn-icono principal" id="rp-play" aria-label="Pausa" title="Reproducir o pausar (espacio)">${ICONO.pausa}</button>
              <button type="button" class="btn-icono" id="rp-adelante" aria-label="Paso siguiente" title="Paso siguiente (→)">${ICONO.pasoAdelante}</button>
              <button type="button" class="btn-icono" id="rp-reiniciar" aria-label="Reiniciar" title="Reiniciar (R)">${ICONO.reiniciar}</button>
            </div>
            <div class="linea-tiempo"><input type="range" id="rp-scrub" min="0" max="1" value="0" step="1" aria-label="tiempo de vuelo"><div class="marcas" id="rp-marcas"></div></div>
            <span id="rp-clock" class="mono reloj">0,0 s</span>
            <div class="segmentos" role="group" aria-label="velocidad de reproducción">${[1, 2, 4, 8, 16, 32].map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === 4}">${v}×</button>`).join('')}</div>
            <span id="rp-eff" class="mono efectiva" title="velocidad efectiva (con la cámara lenta al aterrizar)"></span>
            <button type="button" class="btn-sonido" id="rp-sonido" aria-pressed="false"></button>
            <details class="opciones" id="rp-opciones">
              <summary>${ICONO.ajustes}<span>Cámara y efectos</span></summary>
              <div class="opciones-cuerpo">
                <label class="campo">Cámara <select id="rp-camara">${(Object.keys(NOMBRE_CAMARA) as ModoCamara[]).map((m) => `<option value="${m}">${NOMBRE_CAMARA[m]}</option>`).join('')}</select></label>
                <label class="campo">Cohete <select id="rp-cohete"><option value="nave">Nave de acero inoxidable</option><option value="propulsor">Propulsor reutilizable</option></select></label>
                <div class="campo">Calidad gráfica <div class="segmentos calidad" role="group" aria-label="calidad gráfica">${(['auto', ...NIVELES] as const).map((q) => `<button type="button" data-q="${q}" aria-pressed="false">${q === 'auto' ? 'Auto' : NOMBRE_CALIDAD[q]}</button>`).join('')}</div><small id="rp-calidad-txt"></small></div>
                <label class="campo">Intensidad de efectos <span class="deslizador"><input type="range" id="rp-intensidad" min="0" max="150" step="5" value="${Math.round(intensidad * 100)}"><output id="rp-intensidad-v">${Math.round(intensidad * 100)} %</output></span></label>
                <div class="interruptores">
                  <label class="interruptor"><input type="checkbox" id="rp-follow" checked> Seguir al cohete</label>
                  <label class="interruptor"><input type="checkbox" id="rp-cine" checked> Órbita automática</label>
                  <label class="interruptor"><input type="checkbox" id="rp-slowmo" checked> Cámara lenta al aterrizar</label>
                  <label class="interruptor"><input type="checkbox" id="rp-fantasmas" checked> Dejar fantasmas</label>
                  <label class="interruptor"><input type="checkbox" id="rp-guias" checked> Guías (trayectoria, viento, zona)</label>
                  <label class="interruptor"><input type="checkbox" id="rp-escudo"> Escudo térmico de la nave</label>
                </div>
              </div>
            </details>
          </div>
        </div>
        <aside class="lateral"><div class="lateral-cuerpo">
          <div class="resultado" id="rp-resultado"><span class="resultado-principal" id="hud-res"></span><span class="mono" id="hud-rec"></span></div>
          ${vivo ? `<section class="grupo viento-vivo"><h3>${ICONO.entorno}<span>Viento manual</span><small id="vv-estado">en marcha</small></h3>
            <label class="campo">Intensidad a 10 m <span class="deslizador"><input type="range" id="vv-vel" min="0" max="25" step="0.5" value="${vivo.viento.velocidad}"><output id="vv-vel-v">${num(vivo.viento.velocidad)} m/s</output></span></label>
            <label class="campo">Dirección (hacia dónde sopla) <span class="deslizador"><input type="range" id="vv-dir" min="0" max="360" step="5" value="${Math.round(vivo.viento.direccion_grados)}"><output id="vv-dir-v">${Math.round(vivo.viento.direccion_grados)}°</output></span></label>
            <p class="muted vv-nota">El cambio se aplica en el siguiente paso del agente (cada 20 m o 2 s). Las ráfagas siguen su propio proceso. Pulsa reproducir si lo pausas; la misión avanza mientras se reproduce.</p>
            <p><span class="muted">Último paso: </span><span id="vv-ultimo" class="mono">—</span></p>
            <p><a class="btn-consola secundario" href="#/vivo/${esc(id)}">Nueva misión</a></p>
          </section>` : ''}
          ${grupo('Navegación', ICONO.navegacion, fila('tm-alt', 'Altitud', 'm', true) + fila('tm-vz', 'Velocidad vertical', 'm/s', true) + fila('tm-vh', 'Velocidad horizontal', 'm/s', true) + fila('tm-incl', 'Inclinación', '°', true, CRITERIO.inclinacion / 30) + fila('tm-dist', 'Distancia al objetivo', 'm', true, ESCALA(radio)))}
          ${grupo('Propulsión', ICONO.propulsion, fila('tm-motor', 'Estado del motor') + fila('tm-pot', 'Potencia (acelerador)', '%', true) + fila('tm-fuel', 'Combustible', 'kg', true) + fila('tm-temp', 'Temperatura del motor', 'K', true, MOTOR_T_MAX / 1000), `se apaga a ${MOTOR_T_MAX} K`)}
          ${grupo('Entorno', ICONO.entorno, fila('tm-viento', 'Viento', 'm/s', true) + fila('tm-aire', 'Temperatura ambiental', '°C') + fila('tm-p', 'Presión atmosférica', 'kPa'))}
          ${grupo('Aterrizaje', ICONO.aterrizaje, `<ul class="criterios">${criterios(medir(vuelos[0].f, 0), radio, false, false).map((k) => `<li id="cr-${k.id}" data-estado="neutral"><span class="cr-k">${k.nombre}</span><span class="cr-v">—</span><span class="cr-lim">permitido ${k.limite}</span></li>`).join('')}</ul>
            <p class="leyenda-cr"><span><i data-estado="cumple"></i>cumple</span><span><i data-estado="precaucion"></i>fuera del límite, aún sin juzgar</span><span><i data-estado="falla"></i>incumplido al tocar suelo</span></p>`, 'se juzgan al tocar el suelo')}
          <p class="muted" id="rp-fantasmas-n"></p>
          <details class="ayuda"><summary>Cómo leer este replay</summary>
            <p>La velocidad de reproducción no cambia las reglas ni el paso físico (0,1 s): solo cuánto tarda en verse. Entre dos muestras la posición se interpola con las velocidades grabadas; la telemetría muestra siempre el dato exacto de la muestra.</p>
            <p>Las fases (descenso, aproximación por debajo de ${UMBRAL.aproximacion} m, aterrizaje en los últimos ${UMBRAL.aterrizaje} m) se deducen de la trayectoria; el resultado final es el que decidió el ambiente al terminar el vuelo.</p>
            <p>Arrastra para girar la cámara, rueda para acercar, doble clic para recentrar. Atajos: espacio reproduce o pausa, ← y → saltan al paso anterior o siguiente del agente, R reinicia y M activa el sonido. El cohete se dibuja a tamaño real (42 m); los fantasmas son las trayectorias de los vuelos anteriores, con el color de su resultado.</p>
          </details>
        </div></aside>
      </div>
    </section>`
  const consola = el.querySelector<HTMLElement>('.consola')!
  // la escena 3D (three.js y el planeta) se descarga aparte, solo en las vistas que la usan
  const { Reproductor: ReproductorEscena } = await import('../escena/reproductor')
  if (!el.contains(consola)) return () => {} // el usuario cambió de vista mientras se descargaba
  const rp = new ReproductorEscena(el.querySelector<HTMLElement>('#visor3d')!, { padRadius: radio, startAltitude: salida, calidad: preferenciaCalidad() })
  rp.setObstaculos(obstaculos)
  rp.setIntensidad(intensidad)
  let vivoActivo = false, vivoFin = false
  if (vivo) {
    rp.enVivo = true; vivoActivo = true
    const vel = el.querySelector<HTMLInputElement>('#vv-vel')!, dir = el.querySelector<HTMLInputElement>('#vv-dir')!
    const velV = el.querySelector<HTMLElement>('#vv-vel-v')!, dirV = el.querySelector<HTMLElement>('#vv-dir-v')!, ultimo = el.querySelector<HTMLElement>('#vv-ultimo')!, estadoVivo = el.querySelector<HTMLElement>('#vv-estado')!
    let pendiente: { viento?: number; direccion_grados?: number } = {}
    vel.addEventListener('input', () => { velV.textContent = `${num(+vel.value)} m/s`; pendiente.viento = +vel.value })
    dir.addEventListener('input', () => { dirV.textContent = `${dir.value}°`; pendiente.direccion_grados = +dir.value })
    let pidiendo = false
    const avanzar = async () => {
      if (!vivoActivo || vivoFin || pidiendo || !rp.playing) return
      if (rp.total - rp.indice > 24) return // hay más de un paso por reproducir: no hace falta pedir todavía
      pidiendo = true
      try {
        const cuerpo = pendiente; pendiente = {}
        const p = await api.pasoSesion(vivo.sesion, cuerpo)
        rp.anexar(p.f, p.marca)
        scrub.max = String(rp.total - 1)
        ultimo.textContent = `${p.paso}/${pasos} · ${p.marca.label} · ${num(p.recompensa)} pts · viento ${num(p.viento.velocidad)} m/s a ${Math.round(p.viento.direccion_grados)}° · ${num(p.latencia_ms, 0)} ms`
        if (p.fin) {
          vivoFin = true; rp.enVivo = false
          vivo.vuelo.reason = p.resultado ?? 'sin pasos'; vivo.vuelo.reward = p.acumulada; vivo.vuelo.steps = p.paso; vivo.vuelo.landed = p.resultado === 'aterrizaje'
          estadoVivo.textContent = `terminada: ${p.resultado}`
          const color = COLOR_RESULTADO[vivo.vuelo.reason] ?? 'var(--neutral)'
          $('#rp-resultado').style.setProperty('--c-res', color)
          $('#hud-res').innerHTML = `<span style="color: ${color}">${esc(ICONO_RESULTADO[vivo.vuelo.reason] ?? '')}</span> ${esc(vivo.vuelo.reason)} · recompensa ${num(vivo.vuelo.reward, 0)}`
        }
      } catch (e) {
        estadoVivo.textContent = `error: ${(e as Error).message}`; vivoFin = true; rp.enVivo = false
      } finally { pidiendo = false }
    }
    const reloj = window.setInterval(() => { avanzar().catch(() => {}) }, 150)
    const limpiarVivo = () => { window.clearInterval(reloj); vivoActivo = false; api.cerrarSesion(vivo.sesion) }
    ;(el as HTMLElement & { __limpiarVivo?: () => void }).__limpiarVivo = limpiarVivo
  }
  if (import.meta.env.DEV) (window as unknown as { __rp: Reproductor }).__rp = rp // solo en desarrollo: lo usan las pruebas con el navegador
  const $ = (s: string) => el.querySelector<HTMLElement>(s)!
  const sel = el.querySelector<HTMLSelectElement>('#rp-vuelo')!, play = el.querySelector<HTMLButtonElement>('#rp-play')!, scrub = el.querySelector<HTMLInputElement>('#rp-scrub')!
  const hud = { alt: $('#hud-alt'), vz: $('#hud-vz'), vh: $('#hud-vh'), ep: $('#hud-ep'), fase: $('#hud-fase'), t: $('#hud-t'), dist: $('#hud-dist'), paso: $('#hud-paso'), accion: $('#hud-accion'), pasos: $('#hud-pasos'), cinta: $('#hud-cinta'), rec: $('#hud-rec'), reloj: $('#rp-clock'), eff: $('#rp-eff'), miFase: $('#mi-fase') }
  const instrumento = (s: string) => { const e = $(s); return { e, v: e.querySelector('b')!, barra: e.querySelector<HTMLElement>('.tm-barra i') } }
  const tm = { alt: instrumento('#tm-alt'), vz: instrumento('#tm-vz'), vh: instrumento('#tm-vh'), incl: instrumento('#tm-incl'), dist: instrumento('#tm-dist'), motor: instrumento('#tm-motor'), pot: instrumento('#tm-pot'), fuel: instrumento('#tm-fuel'), temp: instrumento('#tm-temp'), viento: instrumento('#tm-viento'), aire: instrumento('#tm-aire'), p: instrumento('#tm-p') }
  const poner = (t: ReturnType<typeof instrumento>, valor: string, barra?: number, estado = '') => { t.v.textContent = valor; if (t.barra && barra !== undefined) t.barra.style.width = `${(clamp01(barra) * 100).toFixed(1)}%`; if (t.e.dataset.estado !== estado) t.e.dataset.estado = estado }
  const crs = ['vz', 'vh', 'incl', 'dist'].map((k) => ({ li: $(`#cr-${k}`), v: $(`#cr-${k} .cr-v`) }))
  const reticula = $('#hud-reticula'), reticulaTxt = $('#hud-ret-txt'), pantalla = { x: 0, y: 0, visible: false, dist: 0 }
  const punto = el.querySelector<SVGCircleElement>('#hud-punto')!, rumbo = el.querySelector<SVGLineElement>('#hud-rumbo')!
  const resumenEl = $('#rp-resumen')
  let actual = vuelos[0], reproduciendo: boolean | null = null, fase: Fase | null = null, temporizador = 0

  const condiciones = (v: Vuelo) => {
    const f = v.f, n = f.t.length - 1
    return `${esc(nivelVisto)} · viento hasta ${num(Math.max(...f.wh))} m/s${amb?.rafagas ? `, ráfagas ${num(amb.rafagas)}` : ''}${obst ? ` · ${esc(obst)}` : ''} · suelo ${num(f.air_t[n])} °C, ${num(f.p[n])} kPa`
  }
  const ocultarResumen = () => { resumenEl.classList.remove('visible'); resumenEl.hidden = true }
  const siguiente = () => { if (sel.selectedIndex < vuelos.length - 1) { sel.selectedIndex += 1; cargar(sel.selectedIndex) } }
  const cargar = (k: number) => {
    clearTimeout(temporizador); ocultarResumen()
    actual = vuelos[k]; rp.cargar(actual)
    $('#rp-fantasmas-n').textContent = rp.numeroFantasmas ? `Fantasmas en escena: ${rp.numeroFantasmas}` : ''
    scrub.max = String(rp.total - 1)
    hud.ep.textContent = etiqueta(actual)
    $('#mi-cond').innerHTML = condiciones(actual); $('#mi-cond').title = $('#mi-cond').textContent ?? ''
    const color = COLOR_RESULTADO[actual.reason] ?? 'var(--neutral)', n = Math.max(1, rp.total - 1)
    $('#rp-resultado').style.setProperty('--c-res', color)
    $('#hud-res').innerHTML = vivo && !vivoFin ? '<span class="muted">misión en curso: el resultado lo decide el ambiente al terminar</span>' : `<span style="color: ${color}">${esc(ICONO_RESULTADO[actual.reason] ?? '')}</span> ${esc(actual.reason)} · recompensa ${num(actual.reward, 0)}`
    $('#rp-marcas').innerHTML = actual.step_marks.map((m, j, todas) => `<i style="left: ${((m.i / n) * 100).toFixed(2)}%${j === todas.length - 1 ? `; background: ${color}` : ''}"${j === todas.length - 1 ? ' class="final"' : ''}></i>`).join('')
    fase = null
  }
  const mostrarResumen = () => {
    const rs = resumenMision(actual, radio), color = COLOR_RESULTADO[actual.reason] ?? 'var(--neutral)', hay = sel.selectedIndex < vuelos.length - 1
    resumenEl.innerHTML = `
      <div class="resumen-tarjeta ${rs.exito ? 'exito' : 'fallo'}" role="dialog" aria-label="${rs.exito ? 'Misión completada' : 'Misión fallida'}">
        <button type="button" class="resumen-cerrar" aria-label="Cerrar el resumen">${ICONO.cerrar}</button>
        <span class="kicker">PROJECT ELYNDRA · ${esc(etiqueta(actual))}</span>
        <h3>${rs.exito ? 'Mission completed' : 'Mission failed'}</h3>
        <p class="resumen-res"><span style="color: ${color}">${esc(ICONO_RESULTADO[rs.resultado] ?? '')}</span> ${rs.exito ? 'Aterrizaje suave dentro de la plataforma' : `Resultado del ambiente: ${esc(rs.resultado)}`}</p>
        <dl class="resumen-datos">
          <div><dt>Velocidad de contacto</dt><dd>${rs.contacto ? `${num(Math.abs(rs.medida.vz), 2)} m/s` : 'sin contacto'}</dd><small>${rs.contacto ? `horizontal ${num(rs.medida.vh, 2)} m/s` : 'el vuelo terminó en el aire'}</small></div>
          <div><dt>Inclinación final</dt><dd>${num(rs.medida.incl)}°</dd><small>máximo ${CRITERIO.inclinacion}°</small></div>
          <div><dt>Distancia al centro</dt><dd>${num(rs.medida.dist)} m</dd><small>radio de la plataforma ${num(radio, 0)} m</small></div>
          <div><dt>Combustible restante</dt><dd>${num(rs.combustible, 0)} kg</dd><small>${num(rs.usado, 0)} kg en ${num(rs.duracion)} s</small></div>
        </dl>
        <div class="resumen-criterios">
          <span>${rs.contacto ? `${rs.cumplidos} de ${rs.criterios.length} criterios cumplidos` : 'Criterios sin juzgar: el cohete no llegó a tocar el suelo'}</span>
          <ul>${rs.criterios.map((k) => `<li data-estado="${k.estado}">${k.nombre} <b>${conUnidad(num(k.valor), k.unidad)}</b> <small>${k.limite}</small></li>`).join('')}</ul>
        </div>
        <p class="resumen-pie">Recompensa ${num(rs.recompensa, 1)} · ${rs.pasos} pasos del agente</p>
        <div class="resumen-acciones"><button type="button" class="btn-consola secundario" data-accion="repetir">Repetir vuelo</button>${hay ? '<button type="button" class="btn-consola" data-accion="siguiente">Siguiente vuelo →</button>' : ''}</div>
      </div>`
    resumenEl.hidden = false
    requestAnimationFrame(() => resumenEl.classList.add('visible'))
  }
  resumenEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return
    clearTimeout(temporizador); ocultarResumen()
    if (b.dataset.accion === 'repetir') rp.reiniciar(); else if (b.dataset.accion === 'siguiente') siguiente()
  })

  rp.onFrame = (s) => {
    const f = actual.f, i = s.indice, n = rp.total, fin = i >= n - 1, m = medir(f, i), cerca = m.z < UMBRAL.aproximacion
    hud.alt.textContent = `${num(m.z)} m`; hud.vz.textContent = `${num(m.vz)} m/s`; hud.vh.textContent = `${num(m.vh)} m/s`
    hud.paso.textContent = `Paso ${s.paso}/${pasos}`; hud.accion.textContent = s.etiqueta
    hud.pasos.style.width = `${Math.min(100, (s.paso / pasos) * 100)}%`
    hud.cinta.style.height = `${(clamp01(m.z / salida) * 100).toFixed(1)}%`
    hud.rec.textContent = `acumulado ${num(s.recompensaAcumulada)} · ${actual.steps} pasos`
    scrub.value = String(i); hud.reloj.textContent = `${num(f.t[i])} / ${num(f.t[n - 1])} s`; hud.t.textContent = `T+ ${num(f.t[i])} s`
    hud.eff.textContent = `${num(s.velocidadEfectiva, 1)}×`
    if (rp.playing !== reproduciendo) {
      reproduciendo = rp.playing; consola.classList.toggle('reproduciendo', reproduciendo)
      play.innerHTML = reproduciendo ? ICONO.pausa : ICONO.play; play.setAttribute('aria-label', reproduciendo ? 'Pausa' : 'Reproducir')
    }
    const fz = faseMision(actual, i)
    if (fz !== fase) { fase = fz; consola.dataset.fase = fz; hud.fase.textContent = TEXTO_FASE[fz]; hud.miFase.textContent = TEXTO_FASE[fz] }
    // telemetría: el dato exacto de la muestra; el color avisa cuando, cerca del suelo, un valor está fuera de su límite
    poner(tm.alt, num(m.z), m.z / salida)
    poner(tm.vz, num(m.vz), Math.abs(m.vz) / 40, cerca && Math.abs(m.vz) > CRITERIO.vertical ? 'precaucion' : '')
    poner(tm.vh, num(m.vh), m.vh / 10, cerca && m.vh > CRITERIO.horizontal ? 'precaucion' : '')
    poner(tm.incl, num(m.incl), m.incl / 30, m.incl > CRITERIO.inclinacion ? 'precaucion' : '')
    poner(tm.dist, num(m.dist), ESCALA(m.dist), m.dist <= radio ? 'cumple' : cerca ? 'precaucion' : '')
    tm.motor.v.innerHTML = f.on[i] ? '<span class="motor on">Encendido</span>' : '<span class="motor">Apagado</span>'
    poner(tm.pot, f.on[i] ? String(Math.round(f.thr[i] * 100)) : '0', f.on[i] ? f.thr[i] : 0, f.on[i] ? 'activo' : '')
    const fr = f.fuel[i] / Math.max(1, f.fuel[0]); poner(tm.fuel, num(f.fuel[i], 0), fr, fr < 0.05 ? 'critico' : fr < 0.2 ? 'precaucion' : '')
    const tr = f.eng_t[i] / MOTOR_T_MAX; poner(tm.temp, num(f.eng_t[i], 0), f.eng_t[i] / 1000, tr > 0.95 ? 'critico' : tr > 0.85 ? 'precaucion' : '')
    poner(tm.viento, num(f.wh[i]), f.wh[i] / 25)
    tm.viento.v.innerHTML = `${ICONO.flecha.replace('<svg', `<svg style="transform: rotate(${((-Math.atan2(f.wy[i], f.wx[i]) * 180) / Math.PI).toFixed(0)}deg)"`)}${num(f.wh[i])}`
    poner(tm.aire, num(f.air_t[i])); poner(tm.p, num(f.p[i]))
    criterios(m, radio, fin, f.z[n - 1] <= 0.5).forEach((k, j) => { crs[j].v.textContent = conUnidad(num(k.valor), k.unidad); if (crs[j].li.dataset.estado !== k.estado) crs[j].li.dataset.estado = k.estado })
    // radar del objetivo (vista cenital, x a la derecha e y hacia arriba como en el ambiente) y retícula sobre la plataforma
    const R = 56 * ESCALA(m.dist), ang = Math.atan2(f.y[i], f.x[i]), px = (R * Math.cos(ang)).toFixed(1), py = (-R * Math.sin(ang)).toFixed(1)
    punto.setAttribute('cx', px); punto.setAttribute('cy', py); rumbo.setAttribute('x1', px); rumbo.setAttribute('y1', py); rumbo.setAttribute('x2', '0'); rumbo.setAttribute('y2', '0')
    hud.dist.textContent = `${num(m.dist)} m`
    rp.objetivoPantalla(pantalla)
    const ver = pantalla.visible && rp.camMode !== 'abordo' && pantalla.dist > 45
    reticula.classList.toggle('visible', ver)
    if (ver) { reticula.style.transform = `translate(${pantalla.x.toFixed(1)}px, ${pantalla.y.toFixed(1)}px)`; reticulaTxt.textContent = `Plataforma · ${num(m.dist, 0)} m` }
    if (!fin && !resumenEl.hidden) ocultarResumen()
  }
  // al terminar: transición, resumen de la misión y, en los vuelos grabados, el siguiente vuelo al cabo de unos segundos
  rp.onEnd = () => {
    clearTimeout(temporizador)
    temporizador = window.setTimeout(() => {
      mostrarResumen()
      if (fuente === 'grabados' && sel.selectedIndex < vuelos.length - 1) temporizador = window.setTimeout(siguiente, 5200)
    }, 1300)
  }
  sel.addEventListener('change', () => cargar(sel.selectedIndex))
  play.addEventListener('click', () => { if (!rp.playing && rp.indice >= rp.total - 1) { ocultarResumen(); rp.reiniciar() } else rp.playing = !rp.playing })
  $('#rp-reiniciar').addEventListener('click', () => { clearTimeout(temporizador); ocultarResumen(); rp.reiniciar() })
  $('#rp-atras').addEventListener('click', () => rp.pasoAnterior())
  $('#rp-adelante').addEventListener('click', () => rp.pasoSiguiente())
  const botonSonido = $('#rp-sonido')
  const pintarSonido = (on: boolean) => {
    const txt = on ? 'Silenciar (M)' : 'Activar sonido (M)'
    botonSonido.setAttribute('aria-pressed', String(on)); botonSonido.title = txt
    botonSonido.innerHTML = `${on ? ICONO.altavoz : ICONO.mudo}<span class="solo-lector">${txt}</span>`
  }
  botonSonido.addEventListener('click', () => { sonidoActivo = rp.sonido.alternar(); pintarSonido(sonidoActivo) })
  if (sonidoActivo) rp.sonido.alternar()
  pintarSonido(sonidoActivo)
  scrub.addEventListener('input', () => rp.ir(+scrub.value))
  const segmentos = [...el.querySelectorAll<HTMLButtonElement>('.segmentos button[data-v]')]
  segmentos.forEach((b) => b.addEventListener('click', () => { rp.speed = +b.dataset.v!; segmentos.forEach((o) => o.setAttribute('aria-pressed', String(o === b))) }))
  const casilla = (cid: string, f: (on: boolean) => void) => el.querySelector<HTMLInputElement>(cid)!.addEventListener('change', (e) => f((e.target as HTMLInputElement).checked))
  casilla('#rp-follow', (on) => { rp.follow = on })
  casilla('#rp-cine', (on) => { rp.cine = on })
  casilla('#rp-slowmo', (on) => { rp.slowmo = on })
  casilla('#rp-fantasmas', (on) => { rp.fantasmas = on; if (!on) { rp.limpiarFantasmas(); $('#rp-fantasmas-n').textContent = '' } })
  casilla('#rp-guias', (on) => rp.setGuias(on))
  casilla('#rp-escudo', (on) => rp.setEscudo(on))
  const camara = el.querySelector<HTMLSelectElement>('#rp-camara')!
  camara.value = rp.camMode
  camara.addEventListener('change', () => rp.setCamara(camara.value as ModoCamara))
  el.querySelector<HTMLSelectElement>('#rp-cohete')!.addEventListener('change', (e) => rp.setCohete((e.target as HTMLSelectElement).value as Cohete))
  const botonesCalidad = [...el.querySelectorAll<HTMLButtonElement>('.calidad button')], textoCalidad = $('#rp-calidad-txt')
  const pintarCalidad = (nivel: NivelCalidad, auto: boolean) => {
    botonesCalidad.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === (auto ? 'auto' : nivel))))
    textoCalidad.textContent = auto ? `Automática: ${NOMBRE_CALIDAD[nivel].toLowerCase()} para este equipo` : ''
  }
  rp.onCalidad = pintarCalidad
  pintarCalidad(rp.calidad.nivel, rp.calidad.auto)
  botonesCalidad.forEach((b) => b.addEventListener('click', () => { const q = b.dataset.q as NivelCalidad | 'auto'; guardarPreferenciaCalidad(q); rp.setCalidad(q) }))
  const deslizador = el.querySelector<HTMLInputElement>('#rp-intensidad')!, salidaIntensidad = $('#rp-intensidad-v')
  deslizador.addEventListener('input', () => { intensidad = +deslizador.value / 100; rp.setIntensidad(intensidad); salidaIntensidad.textContent = `${deslizador.value} %` })
  // atajos de teclado, solo con la consola en pantalla y sin un control con el foco
  const teclas = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest?.('input, select, textarea, button, summary, a, [contenteditable]')) return
    const caja = consola.getBoundingClientRect(); if (caja.bottom < 0 || caja.top > innerHeight) return
    if (e.key === ' ') play.click()
    else if (e.key === 'ArrowLeft') rp.pasoAnterior()
    else if (e.key === 'ArrowRight') rp.pasoSiguiente()
    else if (e.key === 'r' || e.key === 'R') { clearTimeout(temporizador); ocultarResumen(); rp.reiniciar() }
    else if (e.key === 'm' || e.key === 'M') botonSonido.click()
    else return
    e.preventDefault()
  }
  window.addEventListener('keydown', teclas)
  cargar(0)
  return () => { clearTimeout(temporizador); window.removeEventListener('keydown', teclas); (el as HTMLElement & { __limpiarVivo?: () => void }).__limpiarVivo?.(); rp.destruir() }
}
