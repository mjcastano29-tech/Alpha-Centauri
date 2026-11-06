// Vistas de la aplicación: catálogo, detalle de una ejecución (con evaluación en vivo), comparación y replay 3D.
import * as api from './api'
import type { Catalogo, Detalle, Obstaculo, Resumen, ResultadoEvaluacion, Vuelo } from './api'
import { Reproductor, type Cohete, type ModoCamara } from './escena'
import { barraResultados, corto, entero, esc, ICONO_RESULTADO, lineaSvg, num, pct, pillDiseno, pillEstado, tabla } from './ui'

const COLORES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']
/** Última evaluación ejecutada en vivo, para poder reproducir sus vuelos. */
let ultimaEvaluacion: ResultadoEvaluacion | null = null
let catalogoCache: Catalogo | null = null
const ETIQUETA_PRESUPUESTO: Record<string, (v: string | number) => string> = {
  epocas: (v) => `${entero(+v)} épocas`, pasos_agente: (v) => `${entero(+v)} pasos del agente`, tiempo_s: (v) => `${num(+v / 60, 1)} min`, maquina: (v) => String(v),
}
function presupuesto(p: Record<string, string | number> | null | undefined) {
  if (!p) return '—'
  return esc(Object.entries(p).map(([k, v]) => (ETIQUETA_PRESUPUESTO[k] ?? ((x: string | number) => `${k}: ${x}`))(v)).join(' · '))
}

async function cargarCatalogo() {
  catalogoCache ??= await api.catalogo()
  return catalogoCache
}

// ---------- incidente controlado ----------
export async function vistaIncidente(el: HTMLElement) {
  const d = await api.incidentes()
  const destinos = [...new Set(d.medidas.map((m) => m.ambiente.id))]
  const bloques = destinos.map((amb) => {
    const medidas = d.medidas.filter((m) => m.ambiente.id === amb).sort((a, b) => b.antes.normal.aterrizajes - a.antes.normal.aterrizajes)
    const a = medidas[0].ambiente
    const col = (r: api.Resultados) => r['colisión'] ?? 0
    const degradacion = tabla(['modelo', 'entrenado en', `en su nivel (suite v1)`, `en ${esc(a.nivel)}, normal`, `en ${esc(a.nivel)}, viento ${medidas[0].viento} m/s`, 'cambio', 'causas de fallo en ' + esc(a.nivel)], medidas.map((m) => [
      `<a href="#/ejecucion/${esc(m.run_id)}"><b>${esc(m.run_id)}</b></a><br>${pillEstado(m.estado)}`,
      `${esc(m.nivel_entrenado)}<br><span class="muted">${m.adaptador ? 'con adaptador: no ve las torres' : 'misma observación, sin adaptador'}</span>`,
      `${pct(m.antes.normal.aterrizajes)} ${barraResultados(m.antes.normal.resultados, d.outcomes)}<br><span class="muted">${col(m.antes.normal.resultados)} colisiones</span>`,
      `<b>${pct(m.despues.normal.aterrizajes)}</b> ${barraResultados(m.despues.normal.resultados, d.outcomes)}<br><span class="muted">${col(m.despues.normal.resultados)} colisiones</span>`,
      `${pct(m.despues.perturbado.aterrizajes)} ${barraResultados(m.despues.perturbado.resultados, d.outcomes)}`,
      `<b>${Math.round((m.despues.normal.aterrizajes - m.antes.normal.aterrizajes) * 100)} puntos</b>`,
      d.outcomes.filter((o) => o !== 'aterrizaje' && m.despues.normal.resultados[o]).map((o) => `${esc(ICONO_RESULTADO[o] ?? '')} ${esc(o)}: ${m.despues.normal.resultados[o]}`).join('<br>') || '—',
    ]))
    const inter = (d.intervenciones[amb] ?? []).map((r) => [
      `<a href="#/ejecucion/${esc(r.run_id)}"><b>${esc(r.run_id)}</b></a><br>${pillEstado(r.estado)} ${pillDiseno(r.diseno?.estado)}`,
      esc(r.diseno?.cambio ?? '—'),
      `<b>${pct(r.evaluacion.aterrizajes)}</b> ${barraResultados(r.evaluacion.resultados, d.outcomes)}<br><span class="muted">${col(r.evaluacion.resultados)} colisiones</span>`,
      r.perturbado ? pct(r.perturbado.aterrizajes) : '—',
      esc(r.diseno?.decision ?? '—'),
    ])
    return `
      <h2>${esc(a.nivel)} · ${esc(a.id)} v${esc(a.version)}</h2>
      <p class="muted">Condiciones de operación: viento a 10 m de 0 a ${a.viento_max} m/s y ráfagas de ${a.rafagas} m/s. Misma suite v1 en todos los casos (${medidas[0].episodios} épocas por condición, semillas desde 10 000 000), modelos congelados y sin exploración.</p>
      <h3>1 · Degradación: modelos de otros niveles en estas condiciones</h3>
      ${degradacion}
      <h3>2 · Intervención: modelos reentrenados en ${esc(a.nivel)} y decisión del pipeline</h3>
      <p class="muted">Criterio fijado antes de entrenar: +2 puntos de aterrizajes frente a la referencia, no perder más de 5 con viento de 15 m/s y no tener más colisiones. Se conservan los intentos rechazados.</p>
      ${tabla(['ejecución', 'cambio', 'aterrizajes (suite v1)', 'con viento 15 m/s', 'decisión'], inter)}`
  })
  el.innerHTML = `
    <h1>Incidente controlado</h1>
    <p>Qué le pasa a un modelo cuando cambian las condiciones de operación, y si reentrenarlo lo recupera. Los datos salen de <code>resultados/incidentes/</code> (<code>python incidente.py</code>) y de las ejecuciones entrenadas en cada nivel. Para repetir una de estas evaluaciones en vivo, abre la ejecución y elige otro ambiente.</p>
    ${bloques.join('') || '<p class="muted">Sin incidentes medidos.</p>'}`
}

// ---------- catálogo ----------
export async function vistaCatalogo(el: HTMLElement) {
  const c = await cargarCatalogo()
  const filas = c.ejecuciones.map((r) => [
    `<a href="#/ejecucion/${esc(r.run_id)}"><b>${esc(r.run_id)}</b></a><br><span class="muted">${esc(r.experimento ?? '—')}</span>`,
    `${pillEstado(r.estado)}<br>${pillDiseno(r.diseno?.estado)}`,
    `${esc(r.nivel)}<br><span class="muted">${esc(r.ambiente)}</span>`,
    `${esc(r.agente.nombre ?? r.agente.clase)}<br><span class="muted">${esc(r.agente.accion ?? '')}</span>`,
    `<b>${pct(r.evaluacion.aterrizajes)}</b> ${barraResultados(r.evaluacion.resultados, c.outcomes)}<br><span class="muted">${num(r.evaluacion.velocidad_contacto, 2)} m/s · ${num(r.evaluacion.error_posicion)} m</span>`,
    r.perturbado ? `${pct(r.perturbado.aterrizajes)}<br><span class="muted">viento ${r.perturbado.viento} m/s</span>` : '—',
    `${entero(r.epocas)}<br><span class="muted">1.º aterrizaje: ${r.primer_aterrizaje ? entero(r.primer_aterrizaje) : 'nunca'}</span>`,
    `<code>${corto(r.git.commit)}</code>${r.git.cambios_sin_commit ? '*' : ''}<br><span class="muted">${r.mlflow ? (r.mlflow.url ? `<a href="${esc(r.mlflow.url)}" target="_blank" rel="noopener">${esc(r.mlflow.modelo)} v${r.mlflow.version}</a>` : `${esc(r.mlflow.modelo)} v${r.mlflow.version}`) : 'sin registro MLflow'}</span>`,
    `<label class="check"><input type="checkbox" class="cmp" value="${esc(r.run_id)}"> comparar</label><br><a class="btn" href="#/replay/${esc(r.run_id)}">replay</a>`,
  ])
  const rec = c.ejecuciones.find((r) => r.estado === 'recomendado' && r.nivel === 'N1')
  const porNivel = Object.entries(c.catalogo.niveles).map(([nivel, v]) => {
    const r = c.ejecuciones.find((e) => e.run_id === v.recomendado), a = c.ambientes.find((x) => x.nivel === nivel)
    return `<b>${esc(nivel)}</b>${a ? ` <span class="muted">(${esc(a.id)} v${esc(a.version)})</span>` : ''}: recomendado ${r ? `<a href="#/ejecucion/${esc(r.run_id)}">${esc(r.run_id)}</a> (${pct(r.evaluacion.aterrizajes)})` : '—'} · anterior (rollback) ${esc(v.anterior ?? '—')}`
  })
  el.innerHTML = `
    <section class="hero card">
      <div><div class="num">${rec ? pct(rec.evaluacion.aterrizajes) : '—'}</div><div class="muted">aterrizajes seguros del modelo recomendado del nivel 1</div></div>
      <div class="sub">
        <p>${porNivel.join('<br>')}</p>
        <p class="muted">Catálogo v${c.catalogo.version} (${esc(c.catalogo.actualizado ?? '—')}). Cada nivel tiene su ambiente. Los niveles 2 y 3 comparten familia de modelos (misma observación): un modelo del nivel 2 juega en el nivel 3 tal cual, y así se mide la degradación con viento fuerte. Un modelo del nivel 1 solo puede jugar en los niveles con torres a través de un adaptador que se las oculta.</p>
        <p class="muted">${c.ejecuciones.length} ejecuciones, incluidas las que no mejoraron. Evaluación: 200 épocas nuevas (suite v1, semillas desde 10 000 000) y la misma suite con viento lateral de 15 m/s. Cada configuración documenta su hipótesis, el cambio frente al baseline, el presupuesto y la decisión.</p>
      </div>
    </section>
    <h2>Ejecuciones</h2>
    ${tabla(['ejecución', 'catálogo · decisión', 'nivel · ambiente', 'agente', 'aterrizajes (suite v1)', 'con viento', 'épocas', 'commit · MLflow', ''], filas)}
    <h2>Hipótesis y decisiones</h2>
    <p class="muted">La cadena de experimentos: cada fila es una configuración, qué cambió frente a la anterior y por qué se seleccionó o se rechazó.</p>
    ${tabla(['ejecución', 'hipótesis', 'cambio frente al baseline', 'presupuesto', 'decisión'], c.ejecuciones.filter((r) => r.diseno).map((r) => [
      `<a href="#/ejecucion/${esc(r.run_id)}"><b>${esc(r.run_id)}</b></a><br>${pillDiseno(r.diseno!.estado)}`,
      esc(r.diseno!.hipotesis ?? '—'),
      `${esc(r.diseno!.cambio ?? '—')}${r.diseno!.baseline ? `<br><span class="muted">baseline: ${esc(r.diseno!.baseline)}</span>` : ''}`,
      presupuesto(r.diseno!.presupuesto),
      `${esc(r.diseno!.decision ?? '—')}<br><span class="muted">${esc(r.diseno!.fecha_decision ?? '')}</span>`,
    ]))}
    <p><button id="btn-comparar" class="btn primario" disabled>Comparar seleccionadas</button> <span class="muted">marca 2 o más</span></p>
    <h2>Historial del catálogo</h2>
    ${tabla(['v', 'fecha', 'acción', 'nivel', 'ejecución', 'motivo', 'commit base'], c.catalogo.historial.slice().reverse().map((h) => [h.version, esc(h.fecha), esc(h.accion), esc(h.nivel ?? 'N1'), esc(h.run_id), esc(h.motivo), `<code>${corto(h.commit_base)}</code>`]))}
  `
  const boton = el.querySelector<HTMLButtonElement>('#btn-comparar')!
  const casillas = [...el.querySelectorAll<HTMLInputElement>('input.cmp')]
  const actualizar = () => { boton.disabled = casillas.filter((c) => c.checked).length < 2 }
  casillas.forEach((c) => c.addEventListener('change', actualizar))
  boton.addEventListener('click', () => { location.hash = '#/comparar/' + casillas.filter((c) => c.checked).map((c) => c.value).join(',') })
}

// ---------- detalle y evaluación en vivo ----------
export async function vistaEjecucion(el: HTMLElement, id: string) {
  const d: Detalle = await api.ejecucion(id)
  const c = await cargarCatalogo()
  const sha = d.sha256 ? Object.entries(d.sha256.archivos).map(([n, h]) => `<li><code>${esc(n)}</code> <span class="hash">${esc(h)}</span></li>`).join('') : '<li class="muted">sin huellas (ejecución anterior a las huellas SHA-256)</li>'
  el.innerHTML = `
    <p><a href="#/">← catálogo</a></p>
    <h1>${esc(d.run_id)} ${pillEstado(d.estado)}</h1>
    <p class="muted">${esc(d.experimento ?? '')} · nivel ${esc(d.nivel)} · ${esc(d.ambiente)} · ${esc(d.agente.nombre ?? '')} · entrenada el ${esc(d.fecha)}</p>
    <section class="card">
      <h2>Hipótesis y decisión ${pillDiseno(d.diseno?.estado)}</h2>
      ${d.diseno ? `
        <div class="hipotesis">
          <p><b>Hipótesis.</b> ${esc(d.diseno.hipotesis ?? '—')}</p>
          <p><b>Cambio frente al baseline${d.diseno.baseline ? ` (<a href="#/ejecucion/${esc(d.diseno.baseline)}">${esc(d.diseno.baseline)}</a>)` : ''}.</b> ${esc(d.diseno.cambio ?? '—')}</p>
          <p><b>Presupuesto.</b> ${presupuesto(d.diseno.presupuesto)} · suite ${esc(d.diseno.suite ?? '—')}</p>
          <p><b>Decisión (${esc(d.diseno.fecha_decision ?? 'sin fecha')}).</b> ${esc(d.diseno.decision ?? '—')}</p>
        </div>
        <p class="muted">Fuente: <code>configs/${esc(d.run_id)}.json</code>; las mismas etiquetas están en la run de MLflow${d.mlflow?.url ? ` (<a href="${esc(d.mlflow.url)}" target="_blank" rel="noopener">verlas en MLflow</a>)` : d.mlflow_ui ? ` (<a href="${esc(d.mlflow_ui)}" target="_blank" rel="noopener">abrir MLflow</a>)` : ''}.${d.diseno.comparacion_principal ? ` Comparación principal: <a href="#/comparar/${esc(d.run_id)},${esc(d.diseno.comparacion_principal)}">${esc(d.run_id)} frente a ${esc(d.diseno.comparacion_principal)}</a>.` : ''}</p>`
      : '<p class="muted">Esta ejecución no tiene configs/&lt;run_id&gt;.json: no se documentó hipótesis ni decisión.</p>'}
    </section>
    <div class="dos">
      <section class="card">
        <h2>Identidad</h2>
        <dl class="kv">
          <dt>commit de git</dt><dd><code>${esc(d.git.commit ?? '—')}</code> (${esc(d.git.branch ?? '—')}${d.git.cambios_sin_commit ? ', con cambios sin commit' : ''})</dd>
          <dt>ambiente</dt><dd>${esc(d.ambiente)} ${d.ambiente_version === c.ejecuciones[0]?.ambiente_version ? '' : ''}</dd>
          <dt>modelo en MLflow</dt><dd>${d.mlflow ? `${esc(d.mlflow.modelo)} versión ${d.mlflow.version}` : '—'}${d.mlflow?.url ? ` · <a href="${esc(d.mlflow.url)}" target="_blank" rel="noopener">abrir la run en MLflow</a>` : d.mlflow_ui ? ` · <a href="${esc(d.mlflow_ui)}" target="_blank" rel="noopener">MLflow</a>` : ''}</dd>
          <dt>manifiesto (sección 11)</dt><dd>${d.manifiesto ? `<a href="${esc(api.urlManifiesto(d.run_id))}" target="_blank" rel="noopener">manifests/${esc(d.run_id)}.json</a> · commit completo, SHA-256 del modelo, suite y nivel` : '—'}</dd>
          <dt>acción</dt><dd>${esc(d.agente.accion ?? '—')}</dd>
          <dt>red</dt><dd>${esc(d.agente.red ?? '—')}</dd>
          <dt>checkpoint</dt><dd>${d.checkpoint ? 'disponible' : '<b>sin checkpoint disponible</b>'}</dd>
          <dt>huellas SHA-256</dt><dd><ul class="hashes">${sha}</ul></dd>
        </dl>
        <h2>Configuración</h2>
        ${tabla(['parámetro', 'valor'], Object.entries(d.config).map(([k, v]) => [esc(k), esc(Array.isArray(v) ? v.join(' × ') : v)]))}
      </section>
      <section class="card">
        <h2>Evaluación guardada (suite v1, ${d.evaluacion.episodios} épocas)</h2>
        <p><b>${pct(d.evaluacion.aterrizajes)}</b> aterrizajes ${barraResultados(d.evaluacion.resultados, c.outcomes)}</p>
        ${tabla(['métrica', 'normal', d.perturbado ? `viento ${d.perturbado.viento} m/s` : '—'], [
          ['aterrizajes seguros', pct(d.evaluacion.aterrizajes), d.perturbado ? pct(d.perturbado.aterrizajes) : '—'],
          ['velocidad de contacto', `${num(d.evaluacion.velocidad_contacto, 2)} m/s`, d.perturbado ? `${num(d.perturbado.velocidad_contacto, 2)} m/s` : '—'],
          ['error de posición', `${num(d.evaluacion.error_posicion)} m`, d.perturbado ? `${num(d.perturbado.error_posicion)} m` : '—'],
          ['combustible por época', `${num(d.evaluacion.combustible, 0)} kg`, '—'],
          ...c.outcomes.map((o) => [`${ICONO_RESULTADO[o]} ${esc(o)}`, d.evaluacion.resultados[o] ?? 0, d.perturbado ? d.perturbado.resultados[o] ?? 0 : '—']),
        ])}
        <h2>Entrenamiento</h2>
        <p class="muted">${entero(d.epocas)} épocas · primer aterrizaje: ${d.primer_aterrizaje ? 'época ' + entero(d.primer_aterrizaje) : 'nunca'} · mejor versión: época ${entero(d.mejor_epoca)}</p>
        ${lineaSvg([{ x: d.curva.x, y: d.curva.aterrizajes, color: COLORES[0], nombre: 'aterrizajes por tramo (con exploración)' }, { x: d.checks.epoch, y: d.checks.landings.map((n) => n / d.check_episodes), color: COLORES[1], nombre: `evaluación sin explorar (${d.check_episodes} épocas)` }], { pct: true, xLabel: 'época' })}
        ${lineaSvg([{ x: d.curva.x, y: d.curva.recompensa, color: COLORES[0], nombre: 'recompensa media por tramo' }], { xLabel: 'época', alto: 160 })}
        <p><a class="btn" href="#/replay/${esc(d.run_id)}">Ver replay de los vuelos grabados</a></p>
      </section>
    </div>
    <section class="card">
      <h2>Evaluar ahora este modelo</h2>
      <p class="muted">La API carga el modelo congelado y lo ejecuta en el ambiente ${esc(d.ambiente)} con las semillas que indiques. Es determinista: las mismas semillas dan el mismo resultado.</p>
      <form id="form-eval" class="fila">
        <label>ambiente <select id="ev-ambiente"><option value="">el de la ejecución (${esc(d.nivel)})</option>${c.ambientes.filter((a) => a.id !== d.ambiente_id && (d.nivel === 'N1' ? a.obstaculos.length > 0 : a.nivel !== 'N1')).map((a) => `<option value="${esc(a.id)}">${esc(a.nivel)} · ${esc(a.id)} (${d.nivel === 'N1' ? 'con adaptador: no ve las torres' : 'misma observación, otras condiciones'})</option>`).join('')}</select></label>
        <label>suite <select id="ev-suite"><option value="">manual</option><option value="suite-v1|normal">suite-v1 · normal</option><option value="suite-v1|viento-15">suite-v1 · viento 15 m/s</option></select></label>
        <label>épocas <input type="number" id="ev-episodios" value="20" min="1" max="50"></label>
        <label>semilla inicial <input type="number" id="ev-semilla" value="10000000" min="0"></label>
        <label>viento fijo (m/s) <input type="number" id="ev-viento" placeholder="aleatorio 0–10" min="0" max="30" step="1"></label>
        <button type="submit" class="btn primario" id="ev-boton">Evaluar</button>
      </form>
      <p class="muted">Con una suite, la semilla y el viento los fija la suite (configs/suites/suite-v1.json); la API acepta hasta 50 épocas por petición.</p>
      <div id="ev-resultado"></div>
    </section>
  `
  const form = el.querySelector<HTMLFormElement>('#form-eval')!, salida = el.querySelector<HTMLElement>('#ev-resultado')!, boton = el.querySelector<HTMLButtonElement>('#ev-boton')!
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const episodios = +(el.querySelector<HTMLInputElement>('#ev-episodios')!.value), semilla = +(el.querySelector<HTMLInputElement>('#ev-semilla')!.value)
    const vientoTxt = el.querySelector<HTMLInputElement>('#ev-viento')!.value, viento = vientoTxt === '' ? null : +vientoTxt
    const [suite, condicion] = el.querySelector<HTMLSelectElement>('#ev-suite')!.value.split('|')
    const ambiente = el.querySelector<HTMLSelectElement>('#ev-ambiente')!.value || null
    boton.disabled = true; salida.innerHTML = `<p class="estado">Evaluando ${episodios} épocas en la API…</p>`
    try {
      const r = await api.evaluar(suite ? { run_id: d.run_id, episodios, grabar: 3, suite, condicion, ambiente } : { run_id: d.run_id, episodios, semilla_base: semilla, viento, grabar: 3, ambiente })
      ultimaEvaluacion = r
      salida.innerHTML = `
        <p class="modo modo-eval">Modo: evaluación en vivo${r.suite.id ? ` · ${esc(r.suite.id)} / ${esc(r.suite.condicion ?? '')}` : ''} · modelo ${esc(r.modelo.run_id)} (${r.modelo.mlflow ? esc(r.modelo.mlflow.modelo) + ' v' + r.modelo.mlflow.version : 'sin MLflow'}) · ambiente ${esc(r.ambiente.id)} v${esc(r.ambiente.version)} (${esc(r.ambiente.nivel)})${r.ambiente.adaptador ? ' · <b>modelo del nivel 1 con adaptador: no ve las torres</b>' : r.ambiente.misma_familia ? ` · <b>modelo de ${esc(r.ambiente.nivel_entrenado ?? '')} jugando en las condiciones de ${esc(r.ambiente.nivel)}</b>` : r.ambiente.compatible ? '' : ' · <b>ambiente no compatible</b>'} · servido por commit <code>${corto(r.servido_por.commit)}</code> · ${r.latencia.total_ms} ms (${r.latencia.por_paso_ms} ms por paso)</p>
        <p><b>${pct(r.resumen.aterrizajes)}</b> aterrizajes en ${r.resumen.episodios} épocas ${barraResultados(r.resumen.resultados, c.outcomes)} · contacto ${num(r.resumen.velocidad_contacto, 2)} m/s · error ${num(r.resumen.error_posicion)} m · ${num(r.resumen.combustible, 0)} kg</p>
        <p><a class="btn" href="#/replay/${esc(d.run_id)}/evaluacion">Ver en 3D las ${r.vuelos.length} primeras épocas</a></p>
        ${tabla(['época', 'semilla', 'resultado', 'recompensa', 'pasos', 'vz contacto', 'vh', 'distancia', 'inclinación', 'combustible', 'viento'],
          r.episodios.map((e) => [e.epoca, e.semilla, `${ICONO_RESULTADO[e.resultado]} ${esc(e.resultado)}`, num(e.recompensa), e.pasos, `${num(e.vz, 2)} m/s`, `${num(e.vh, 2)} m/s`, `${num(e.distancia)} m`, `${num(e.inclinacion)}°`, `${num(e.combustible, 0)} kg`, `${num(e.viento)} m/s`]))}`
    } catch (e) {
      salida.innerHTML = `<p class="error">Error de la API: ${esc((e as Error).message)}</p>`
    } finally { boton.disabled = false }
  })
}

// ---------- comparación ----------
export async function vistaComparar(el: HTMLElement, ids: string[]) {
  const [{ ejecuciones }, c] = await Promise.all([api.comparar(ids), cargarCatalogo()])
  const col = (f: (r: Resumen) => string | number) => ejecuciones.map(f)
  el.innerHTML = `
    <p><a href="#/">← catálogo</a></p>
    <h1>Comparación</h1>
    <p class="muted">Mismas 200 épocas de evaluación para todas (suite v1). Solo son comparables entre sí modelos del mismo ambiente.</p>
    ${tabla(['', ...ejecuciones.map((r) => `<a href="#/ejecucion/${esc(r.run_id)}">${esc(r.run_id)}</a><br>${pillEstado(r.estado)}`)], [
      ['agente', ...col((r) => esc(r.agente.nombre ?? r.agente.clase))],
      ['acción', ...col((r) => esc(r.agente.accion ?? '—'))],
      ['ambiente', ...col((r) => esc(r.ambiente))],
      ['hipótesis', ...col((r) => esc(r.diseno?.hipotesis ?? '—'))],
      ['cambio frente al baseline', ...col((r) => `${esc(r.diseno?.cambio ?? '—')}${r.diseno?.baseline ? `<br><span class="muted">baseline: ${esc(r.diseno.baseline)}</span>` : ''}`)],
      ['presupuesto', ...col((r) => presupuesto(r.diseno?.presupuesto))],
      ['aterrizajes seguros', ...col((r) => `<b>${pct(r.evaluacion.aterrizajes)}</b>`)],
      ['cómo terminan', ...col((r) => barraResultados(r.evaluacion.resultados, c.outcomes))],
      ['velocidad de contacto', ...col((r) => `${num(r.evaluacion.velocidad_contacto, 2)} m/s`)],
      ['error de posición', ...col((r) => `${num(r.evaluacion.error_posicion)} m`)],
      ['combustible', ...col((r) => `${num(r.evaluacion.combustible, 0)} kg`)],
      ['con viento de 15 m/s', ...col((r) => (r.perturbado ? pct(r.perturbado.aterrizajes) : '—'))],
      ['épocas de entrenamiento', ...col((r) => entero(r.epocas))],
      ['primer aterrizaje', ...col((r) => (r.primer_aterrizaje ? 'época ' + entero(r.primer_aterrizaje) : 'nunca'))],
      ['commit', ...col((r) => `<code>${corto(r.git.commit)}</code>`)],
      ['MLflow', ...col((r) => (r.mlflow ? `${esc(r.mlflow.modelo)} v${r.mlflow.version}` : '—'))],
      ['decisión', ...col((r) => `${pillDiseno(r.diseno?.estado)}<br>${esc(r.diseno?.decision ?? '—')}`)],
    ], 'comparar')}`
}

// ---------- replay 3D ----------
export async function vistaReplay(el: HTMLElement, id: string, fuente: 'grabados' | 'evaluacion'): Promise<() => void> {
  let vuelos: Vuelo[], modo: string, nota: string
  if (fuente === 'evaluacion') {
    if (!ultimaEvaluacion || ultimaEvaluacion.modelo.run_id !== id) {
      el.innerHTML = `<p><a href="#/ejecucion/${esc(id)}">← ejecución</a></p><p class="error">No hay una evaluación en vivo de ${esc(id)} en esta sesión. Lánzala desde la página de la ejecución.</p>`
      return () => {}
    }
    vuelos = ultimaEvaluacion.vuelos
    modo = 'Evaluación en vivo'
    nota = `ejecutada por la API hace un momento · ${ultimaEvaluacion.suite.episodios} épocas, semilla inicial ${ultimaEvaluacion.suite.semilla_base}${ultimaEvaluacion.suite.viento !== null ? `, viento ${ultimaEvaluacion.suite.viento} m/s` : ''}`
  } else {
    vuelos = (await api.vuelos(id)).episodes
    modo = 'Replay'
    nota = 'vuelos grabados durante el entrenamiento (con exploración) y del modelo final (sin ruido)'
  }
  const c = await cargarCatalogo(), r = c.ejecuciones.find((e) => e.run_id === id)
  const obstaculos: Obstaculo[] = fuente === 'evaluacion' ? ultimaEvaluacion!.ambiente.obstaculos : r?.obstaculos ?? []
  const nivelVisto = fuente === 'evaluacion' ? ultimaEvaluacion!.ambiente.nivel : r?.nivel ?? 'N1'
  const finales = vuelos.filter((v) => !v.epoch && !v.epoca_evaluacion)
  const etiqueta = (v: Vuelo, _k: number) => v.epoch ? `Época ${entero(v.epoch)} · entrenamiento` : v.epoca_evaluacion ? `Evaluación · época ${v.epoca_evaluacion}` : `Modelo final · vuelo ${finales.indexOf(v) + 1} de ${finales.length}`
  el.innerHTML = `
    <p><a href="#/ejecucion/${esc(id)}">← ejecución</a></p>
    <div class="replay">
      <div class="visor card"><div id="visor3d"></div>
        <div class="hud">
          <span class="modo ${fuente === 'evaluacion' ? 'modo-eval' : 'modo-replay'}">${esc(modo)}</span>
          <span id="hud-ep"></span><span id="hud-paso"></span><span id="hud-rec"></span><span id="hud-res"></span>
        </div>
        <div class="controles">
          <button class="btn" id="rp-play">Pausa</button><button class="btn" id="rp-reiniciar">Reiniciar</button>
          <input type="range" id="rp-scrub" min="0" max="1" value="0" step="1" aria-label="tiempo">
          <span id="rp-clock" class="mono">0,0 s</span>
          <select id="rp-speed" aria-label="velocidad"><option value="1">1×</option><option value="2">2×</option><option value="4" selected>4×</option><option value="8">8×</option><option value="16">16×</option><option value="32">32×</option></select>
          <span id="rp-eff" class="muted mono"></span>
        </div>
        <div class="controles opciones">
          <select id="rp-camara" aria-label="cámara"><option value="seguir">Cámara: seguimiento</option><option value="torre">Cámara: torre con teleobjetivo</option><option value="abordo">Cámara: a bordo</option></select>
          <select id="rp-cohete" aria-label="cohete"><option value="nave">Cohete: nave de acero</option><option value="propulsor">Cohete: propulsor</option></select>
          <label class="check"><input type="checkbox" id="rp-follow" checked> seguir al cohete</label>
          <label class="check"><input type="checkbox" id="rp-cine" checked> cámara cinematográfica</label>
          <label class="check"><input type="checkbox" id="rp-slowmo" checked> cámara lenta al aterrizar</label>
          <label class="check"><input type="checkbox" id="rp-fantasmas" checked> dejar fantasmas</label>
          <label class="check"><input type="checkbox" id="rp-guias" checked> guías (trayectoria, viento, zona)</label>
          <label class="check"><input type="checkbox" id="rp-hq" checked> calidad alta (sombras y brillo)</label>
          <label class="check"><input type="checkbox" id="rp-escudo"> escudo térmico de la nave</label>
        </div>
      </div>
      <aside class="card lateral">
        <h2>${esc(id)}</h2>
        <p class="muted">${esc(nota)}</p>
        <p class="muted">Modelo ${esc(r?.agente.nombre ?? '')} · ambiente ${esc(r?.ambiente ?? '')}${nivelVisto !== r?.nivel ? ` · <b>jugando en ${esc(nivelVisto)}${r?.nivel === 'N1' ? ' con adaptador' : ''}</b>` : ''}${obstaculos.length ? ` · ${obstaculos.length} torres` : ''} · commit <code>${corto(r?.git.commit)}</code>${r?.mlflow ? ` · ${esc(r.mlflow.modelo)} v${r.mlflow.version}` : ''}</p>
        <label>vuelo <select id="rp-vuelo">${vuelos.map((v, k) => `<option value="${k}">${esc(etiqueta(v, k))} · ${esc(v.reason)} · ${v.steps} pasos</option>`).join('')}</select></label>
        <p class="muted">La velocidad de reproducción no cambia las reglas ni el paso físico (0,1 s): solo cuánto tarda en verse. Entre dos muestras la posición se interpola con las velocidades grabadas. Arrastra para girar la cámara, rueda para acercar, doble clic para recentrar. El cohete se dibuja a tamaño real (42 m); los fantasmas son las trayectorias de los vuelos anteriores, con el color de su resultado.</p>
        <p class="muted" id="rp-fantasmas-n"></p>
        <dl class="kv" id="rp-telemetria"></dl>
      </aside>
    </div>`
  const visor = el.querySelector<HTMLElement>('#visor3d')!
  const rp = new Reproductor(visor, { padRadius: 10, startAltitude: 600 })
  rp.setObstaculos(obstaculos)
  const sel = el.querySelector<HTMLSelectElement>('#rp-vuelo')!, play = el.querySelector<HTMLButtonElement>('#rp-play')!, scrub = el.querySelector<HTMLInputElement>('#rp-scrub')!
  const telemetria = el.querySelector<HTMLElement>('#rp-telemetria')!
  let actual = vuelos[0]
  const cargar = (k: number) => { actual = vuelos[k]; rp.cargar(actual); el.querySelector('#rp-fantasmas-n')!.textContent = rp.numeroFantasmas ? `Fantasmas en escena: ${rp.numeroFantasmas}` : ''; scrub.max = String(rp.total - 1); el.querySelector('#hud-ep')!.textContent = etiqueta(actual, k); el.querySelector('#hud-res')!.textContent = `${ICONO_RESULTADO[actual.reason] ?? ''} ${actual.reason} · recompensa ${num(actual.reward, 0)}` }
  rp.onFrame = (s) => {
    const f = actual.f, i = s.indice
    el.querySelector('#hud-paso')!.textContent = `paso ${s.paso}/50 · ${s.etiqueta}`
    el.querySelector('#hud-rec')!.textContent = `acumulado ${num(s.recompensaAcumulada)}`
    scrub.value = String(i); el.querySelector('#rp-clock')!.textContent = `${num(f.t[i])} s`
    play.textContent = rp.playing ? 'Pausa' : 'Reproducir'
    el.querySelector('#rp-eff')!.textContent = `${num(s.velocidadEfectiva, 1)}×`
    telemetria.innerHTML = [['altitud', `${num(f.z[i])} m`], ['velocidad vertical', `${num(f.vz[i])} m/s`], ['velocidad horizontal', `${num(Math.hypot(f.vx[i], f.vy[i]))} m/s`], ['distancia a la plataforma', `${num(Math.hypot(f.x[i], f.y[i]))} m`], ['motor', f.on[i] ? `ON · ${Math.round(f.thr[i] * 100)} %` : 'OFF'], ['inclinación', `${num((Math.acos(Math.max(-1, Math.min(1, f.dz[i]))) * 180) / Math.PI)}°`], ['combustible', `${num(f.fuel[i], 0)} kg`], ['motor (temperatura)', `${num(f.eng_t[i], 0)} K`], ['viento', `${num(f.wh[i])} m/s`], ['aire', `${num(f.air_t[i])} °C · ${num(f.p[i])} kPa`]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')
  }
  rp.onEnd = () => { if (fuente === 'grabados' && sel.selectedIndex < vuelos.length - 1) setTimeout(() => { sel.selectedIndex += 1; cargar(sel.selectedIndex) }, 900) }
  sel.addEventListener('change', () => cargar(sel.selectedIndex))
  play.addEventListener('click', () => { if (!rp.playing && rp.indice >= rp.total - 1) rp.reiniciar(); else rp.playing = !rp.playing })
  el.querySelector('#rp-reiniciar')!.addEventListener('click', () => rp.reiniciar())
  scrub.addEventListener('input', () => rp.ir(+scrub.value))
  el.querySelector<HTMLSelectElement>('#rp-speed')!.addEventListener('change', (e) => { rp.speed = +(e.target as HTMLSelectElement).value })
  const casilla = (id: string, f: (on: boolean) => void) => el.querySelector<HTMLInputElement>(id)!.addEventListener('change', (e) => f((e.target as HTMLInputElement).checked))
  casilla('#rp-follow', (on) => { rp.follow = on })
  casilla('#rp-cine', (on) => { rp.cine = on })
  casilla('#rp-slowmo', (on) => { rp.slowmo = on })
  casilla('#rp-fantasmas', (on) => { rp.fantasmas = on; if (!on) { rp.limpiarFantasmas(); el.querySelector('#rp-fantasmas-n')!.textContent = '' } })
  casilla('#rp-guias', (on) => rp.setGuias(on))
  casilla('#rp-hq', (on) => rp.setCalidad(on))
  casilla('#rp-escudo', (on) => rp.setEscudo(on))
  el.querySelector<HTMLSelectElement>('#rp-camara')!.addEventListener('change', (e) => rp.setCamara((e.target as HTMLSelectElement).value as ModoCamara))
  el.querySelector<HTMLSelectElement>('#rp-cohete')!.addEventListener('change', (e) => rp.setCohete((e.target as HTMLSelectElement).value as Cohete))
  cargar(0)
  return () => rp.destruir()
}
