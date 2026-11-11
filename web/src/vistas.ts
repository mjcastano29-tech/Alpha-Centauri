// Vistas de la aplicación: catálogo, detalle de una ejecución (con evaluación en vivo), comparación y replay 3D.
import * as api from './api'
import type { Ambiente, Detalle, Resumen } from './api'
import { vistaReplay } from './consola/replay'
import { cargarCatalogo, sesion } from './estado'
import { barraResultados, corto, entero, esc, ICONO_RESULTADO, lineaSvg, num, pct, pillDiseno, pillEstado, tabla } from './ui'

const COLORES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']
export { vistaReplay }
const ETIQUETA_PRESUPUESTO: Record<string, (v: string | number) => string> = {
  epocas: (v) => `${entero(+v)} épocas`, pasos_agente: (v) => `${entero(+v)} pasos del agente`, tiempo_s: (v) => `${num(+v / 60, 1)} min`, maquina: (v) => String(v),
}
function presupuesto(p: Record<string, string | number> | null | undefined) {
  if (!p) return '—'
  return esc(Object.entries(p).map(([k, v]) => (ETIQUETA_PRESUPUESTO[k] ?? ((x: string | number) => `${k}: ${x}`))(v)).join(' · '))
}

// ---------- monitoreo de la operación ----------
const segundos = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)

export async function vistaMonitoreo(el: HTMLElement): Promise<() => void> {
  let temporizador = 0
  const pintar = async () => {
    const m = await api.monitoreo()
    const c = await cargarCatalogo()
    const s = m.servicio
    const alertas = m.alertas.length
      ? `<ul class="alertas">${m.alertas.map((a) => `<li class="alerta alerta-${esc(a.tipo)}"><b>${esc(a.nivel ?? 'API')}</b> · ${esc(a.texto)}</li>`).join('')}</ul>`
      : '<p class="ok">Sin alertas: los recomendados juegan en los ambientes vigentes, aguantan el viento y el pipeline terminó bien.</p>'
    const niveles = tabla(['nivel', 'recomendado (lo que se sirve)', 'ambiente', 'suite v1', 'con viento 15 m/s', 'colisiones', 'anterior (rollback)', 'modelo'], m.niveles.map((n) => [
      `<b>${esc(n.nivel)}</b>`,
      n.recomendado ? `<a href="#/ejecucion/${esc(n.recomendado)}">${esc(n.recomendado)}</a>${n.cambios_sin_commit ? ' <span class="muted" title="entrenado con cambios sin commit">*</span>' : ''}<br><span class="muted">${esc(n.fecha ?? '')}</span>` : '—',
      `${esc(n.ambiente_modelo ?? '—')}${n.ambiente_modelo && n.ambiente_modelo !== n.ambiente_vigente ? ' <b class="error">no vigente</b>' : ''}`,
      n.aterrizajes !== undefined ? `<b>${pct(n.aterrizajes)}</b>` : '—',
      n.aterrizajes_viento !== undefined && n.aterrizajes_viento !== null ? `${pct(n.aterrizajes_viento)}${n.aterrizajes_viento < 0.6 ? ' <b class="error">frágil</b>' : ''}` : '—',
      n.colisiones ?? '—',
      esc(n.anterior ?? '—'),
      `${n.mlflow ? (n.mlflow.url ? `<a href="${esc(n.mlflow.url)}" target="_blank" rel="noopener">${esc(n.mlflow.modelo)} v${n.mlflow.version}</a>` : `${esc(n.mlflow.modelo)} v${n.mlflow.version}`) : '—'}<br><span class="muted">${n.modelo_cargado ? 'cargado en memoria' : 'se carga al evaluar'}</span>`,
    ]))
    const pipeline = tabla(['cuándo', 'ejecución', 'ambiente', 'resultado', 'decisión', 'duración', 'comprobación', 'commit'], m.pipeline.map((p) => p.tipo === 'pipeline' ? [
      esc(p.inicio ?? ''), p.run_id ? `<a href="#/ejecucion/${esc(p.run_id)}">${esc(p.run_id)}</a>` : '—', esc(p.ambiente ?? '—'),
      p.aterrizajes !== undefined && p.aterrizajes !== null ? pct(p.aterrizajes) : '—',
      `${p.decision ? pillDiseno(p.decision) : '—'}${p.estado && String(p.estado).startsWith('fallido') ? `<br><span class="error">${esc(p.estado)}</span>` : ''}`,
      p.duracion_s ? segundos(p.duracion_s) : '—', esc(p.comprobacion ?? '—'), `<code>${corto(p.commit)}</code>`,
    ] : [esc(p.fecha ?? ''), `<b>${esc(p.tipo)}</b> ${esc(p.recomendado ?? '')}`, esc(p.nivel ?? '—'), p.ok ? 'API comprobada' : '—', '—', '—', esc(p.archivo), `<code>${corto(p.commit)}</code>`]))
    const evaluaciones = m.evaluaciones.length
      ? tabla(['hora', 'modelo', 'ambiente', 'épocas', 'aterrizajes', 'latencia', 'por paso'], m.evaluaciones.slice().reverse().map((e) => [
        esc(e.fecha.slice(11)), `<a href="#/ejecucion/${esc(e.run_id)}">${esc(e.run_id)}</a>${e.adaptador ? ' <span class="muted">(adaptador)</span>' : ''}`, `${esc(e.nivel)} · ${esc(e.ambiente)}`,
        e.episodios, pct(e.aterrizajes), `${entero(e.total_ms)} ms`, `${num(e.por_paso_ms, 1)} ms`]))
      : '<p class="muted">Este proceso de la API todavía no ha servido evaluaciones (el registro vive en memoria y se vacía cuando Render la duerme).</p>'
    el.innerHTML = `
      <h1>Monitoreo</h1>
      <p>Lo que un operador mira: qué código y qué catálogo se están sirviendo, qué modelo atiende cada nivel y cómo se comporta, qué decidió el pipeline en sus últimas ejecuciones y cuánto tardan las evaluaciones. Se actualiza cada 30 s.</p>
      <div class="dos">
        <section class="card">
          <h2>Servicio</h2>
          <dl class="kv">
            <dt>API</dt><dd>v${esc(s.api)} · commit <code>${esc(s.commit ?? '—')}</code> · Python ${esc(s.python)}</dd>
            <dt>arrancó</dt><dd>${esc(s.arranque)} (hace ${segundos(s.uptime_s)})</dd>
            <dt>catálogo</dt><dd>v${m.catalogo.version} (${esc(m.catalogo.actualizado ?? '—')})</dd>
            <dt>ambientes vigentes</dt><dd>${Object.entries(s.ambientes_vigentes).map(([n, a]) => `${esc(n)}: ${esc(a)}`).join(' · ')}</dd>
            <dt>modelos en memoria</dt><dd>${s.modelos_cargados.length ? s.modelos_cargados.map(esc).join(', ') : 'ninguno todavía'}</dd>
            <dt>evaluaciones servidas</dt><dd>${s.evaluaciones_servidas} desde el arranque · máximo ${s.max_episodios} épocas por petición</dd>
            <dt>registro</dt><dd>${m.resumen.ejecuciones} ejecuciones · ${s.versiones_mlflow} versiones en MLflow${s.mlflow_ui ? ` (<a href="${esc(s.mlflow_ui)}" target="_blank" rel="noopener">abrir</a>)` : ''} · ${m.resumen.evidencias_pipeline} evidencias del pipeline · ${m.resumen.incidentes} incidentes medidos</dd>
            <dt>trazabilidad</dt><dd>${m.resumen.con_cambios_sin_commit.length} ejecuciones entrenadas con cambios sin commit${m.resumen.con_cambios_sin_commit.length ? `: ${m.resumen.con_cambios_sin_commit.map(esc).join(', ')}` : ''}</dd>
          </dl>
          <p><button class="btn primario" id="mon-medir">Medir latencia ahora</button> <span class="muted">evalúa 3 épocas de la suite v1 con el recomendado de cada nivel</span> <span id="mon-estado" class="muted"></span></p>
        </section>
        <section class="card">
          <h2>Alertas</h2>
          ${alertas}
          <h2>Últimos cambios del catálogo</h2>
          ${tabla(['v', 'fecha', 'acción', 'nivel', 'ejecución'], m.catalogo.historial.slice().reverse().map((h) => [h.version, esc(h.fecha), esc(h.accion), esc(h.nivel ?? 'N1'), esc(h.run_id)]))}
        </section>
      </div>
      <h2>Qué se sirve en cada nivel</h2>
      ${niveles}
      <h2>Últimas ejecuciones del pipeline y rollbacks</h2>
      ${pipeline}
      <h2>Evaluaciones servidas por esta instancia</h2>
      ${evaluaciones}
      <p class="muted">Ambientes: ${c.ambientes.filter((a) => a.vigente !== false).map((a) => `${esc(a.nivel)} ${esc(a.id)} v${esc(a.version)}`).join(' · ')}.</p>`
    el.querySelector<HTMLButtonElement>('#mon-medir')!.addEventListener('click', async (ev) => {
      const boton = ev.currentTarget as HTMLButtonElement, estado = el.querySelector<HTMLElement>('#mon-estado')!
      boton.disabled = true
      try {
        for (const n of m.niveles.filter((x) => x.recomendado)) {
          estado.textContent = `evaluando ${n.recomendado}…`
          await api.evaluar({ run_id: n.recomendado!, episodios: 3, grabar: 0, suite: 'suite-v1', condicion: 'normal' })
        }
        estado.textContent = ''
        await pintar()
      } catch (e) { estado.textContent = `error: ${(e as Error).message}`; boton.disabled = false }
    })
  }
  await pintar()
  temporizador = window.setInterval(() => { pintar().catch(() => {}) }, 30000)
  return () => window.clearInterval(temporizador)
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
      `${esc(m.nivel_entrenado)}<br><span class="muted">${m.adaptador ? 'con adaptador: no ve los obstáculos' : 'misma observación, sin adaptador'}</span>`,
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

// ---------- inicio: el cohete en 3D, con pestañas para cambiar de experimento y de modelo ----------
export async function vistaInicio(el: HTMLElement, expId?: string, runId?: string): Promise<() => void> {
  const c = await cargarCatalogo()
  const experimentos = c.experimentos ?? []
  // sin experimento elegido, el último que ya tenga ejecuciones (los recién creados empiezan vacíos)
  const actual = experimentos.find((e) => e.id === expId) ?? [...experimentos].reverse().find((e) => c.ejecuciones.some((r) => r.experimento === e.id)) ?? experimentos[experimentos.length - 1]
  const runs = c.ejecuciones.filter((r) => r.experimento === actual?.id)
  const run = runs.find((r) => r.run_id === runId) ?? runs.find((r) => r.estado === 'recomendado') ?? runs.find((r) => r.diseno?.estado === 'seleccionado') ?? runs[runs.length - 1]
  if (!run) { // experimento recién creado: se mantienen las pestañas para poder volver a otro
    el.innerHTML = `<section class="selector-mision" aria-label="elegir misión"><span class="kicker">Experimento</span>
      <nav class="tabs" aria-label="experimentos">${experimentos.map((e) => `<a href="#/inicio/${esc(e.id)}" class="tab${e.id === actual?.id ? ' activa' : ''}">${e.numero} · ${esc(e.titulo)}<br><span class="muted">${esc(e.nivel)} · ${c.ejecuciones.filter((r) => r.experimento === e.id).length} ejecuciones</span></a>`).join('')}</nav></section>
      <section class="card"><h2>${actual ? `${actual.numero} · ${esc(actual.titulo)}` : 'Sin experimentos'}</h2><p class="muted">Este experimento todavía no tiene ejecuciones en el catálogo: no hay vuelos que reproducir.</p>${actual ? `<p><a class="btn" href="#/experimentos/${esc(actual.id)}">Ver el experimento ${actual.numero}</a></p>` : ''}</section>`
    return () => {}
  }
  const amb = c.ambientes.find((a) => a.id === run.ambiente_id)
  el.innerHTML = `
    <section class="selector-mision" aria-label="elegir misión">
    <span class="kicker">Experimento</span>
    <nav class="tabs" aria-label="experimentos">${experimentos.map((e) => `<a href="#/inicio/${esc(e.id)}" class="tab${e.id === actual.id ? ' activa' : ''}">${e.numero} · ${esc(e.titulo)}<br><span class="muted">${esc(e.nivel)} · ${c.ejecuciones.filter((r) => r.experimento === e.id).length} ejecuciones</span></a>`).join('')}</nav>
    <span class="kicker">Modelo</span>
    <div class="chips" aria-label="modelos del experimento">${runs.map((r) => `<a href="#/inicio/${esc(actual.id)}/${esc(r.run_id)}" class="chip${r.run_id === run.run_id ? ' activa' : ''}">${esc(r.run_id)} <b>${pct(r.evaluacion.aterrizajes)}</b> ${r.estado === 'recomendado' ? pillEstado(r.estado) : pillDiseno(r.diseno?.estado)}</a>`).join('')}</div>
    </section>
    <div id="visor-inicio"></div>
    <section class="card ficha-mision">
      <h2>${esc(run.run_id)} · ${esc(run.nivel)} · ${esc(run.ambiente)}</h2>
      ${amb ? `<p><b>Nivel.</b> ${esc(amb.resumen ?? '')} <span class="muted">${esc(amb.novedad ?? '')}</span></p>` : ''}
      ${run.diseno ? `<p><b>Hipótesis.</b> ${esc(run.diseno.hipotesis ?? '—')}</p><p><b>Cambio.</b> ${esc(run.diseno.cambio ?? '—')}</p><p><b>Decisión.</b> ${esc(run.diseno.decision ?? '—')}</p>` : ''}
      <p><b>${pct(run.evaluacion.aterrizajes)}</b> aterrizajes en la suite v1 ${barraResultados(run.evaluacion.resultados, c.outcomes)} · ${run.perturbado ? `${pct(run.perturbado.aterrizajes)} con viento de 15 m/s` : ''} · ${num(run.evaluacion.velocidad_contacto, 2)} m/s al contacto · ${num(run.evaluacion.error_posicion)} m del centro</p>
      <p><a class="btn" href="#/ejecucion/${esc(run.run_id)}">Ficha, variables y evaluación en vivo</a> <a class="btn" href="#/experimentos/${esc(actual.id)}">Experimento ${actual.numero}: variables y comparación</a> <a class="btn" href="#/comparar/${runs.map((r) => esc(r.run_id)).join(',')}">Comparar las ${runs.length} del experimento</a></p>
    </section>`
  return vistaReplay(el.querySelector<HTMLElement>('#visor-inicio')!, run.run_id, 'grabados')
}

// ---------- experimentos: progresión de complejidad y variables de cada configuración ----------
const valorVariable = (v: unknown) => (Array.isArray(v) ? v.join(' × ') : v === null || v === undefined ? '—' : String(v))

export async function vistaExperimentos(el: HTMLElement, seleccionado?: string) {
  const [c, inc] = await Promise.all([cargarCatalogo(), api.incidentes().catch(() => null)])
  const experimentos = c.experimentos ?? [...new Set(c.ejecuciones.map((r) => r.experimento ?? ''))].map((id, k) => ({ id, numero: k + 1, titulo: id, nivel: '', ambiente: '', pregunta: '', variables: '' }))
  const actual = experimentos.find((e) => e.id === seleccionado) ?? experimentos[0]
  const niveles = c.ambientes.filter((a) => a.vigente !== false).sort((a, b) => a.nivel.localeCompare(b.nivel))
  const retirados = c.ambientes.filter((a) => a.vigente === false)
  const recomendadoDe = (nivel: string) => c.ejecuciones.find((r) => r.nivel === nivel && r.estado === 'recomendado')
  const anterior = (i: number) => (i > 0 ? recomendadoDe(niveles[i - 1].nivel) : undefined)
  const medida = (a: Ambiente, run?: Resumen) => inc?.medidas.find((m) => m.ambiente.id === a.id && m.run_id === run?.run_id)
  const filaNivel = (titulo: string, f: (a: Ambiente, i: number) => string) => [titulo, ...niveles.map(f)]
  const complejidad = tabla(['', ...niveles.map((a) => `<b>${esc(a.nivel)}</b><br><span class="muted">${esc(a.id)} v${esc(a.version)}</span>`)], [
    filaNivel('qué es', (a) => esc(a.resumen ?? '')),
    filaNivel('qué añade', (a) => `<b>${esc(a.novedad ?? '')}</b>`),
    filaNivel('observación · acción', (a) => `${a.observacion ?? '—'} valores · ${a.accion ?? '—'} valores`),
    filaNivel('resultados posibles', (a) => (a.resultados ?? []).map((o) => `${esc(ICONO_RESULTADO[o] ?? '')} ${esc(o)}`).join('<br>')),
    filaNivel('obstáculos', (a) => (a.obstaculos.length ? a.obstaculos.map((o) => o.tipo === 'pasarela' ? `${esc(o.nombre)}: radio ${o.radio} m a ${o.altura} m de altura; abertura de ${o.radio_abertura} m de radio en (${o.x}, ${o.y})` : `${esc(o.nombre)}: ${o.altura} m a (${o.x}, ${o.y})`).join('<br>') : 'ninguno')),
    filaNivel('viento', (a) => `0–${a.viento_max ?? '—'} m/s a 10 m · ráfagas ${a.rafagas ?? '—'} m/s`),
    filaNivel('familia de modelos', (a) => esc(a.familia ?? a.nivel)),
    filaNivel('modelo recomendado', (a) => { const r = recomendadoDe(a.nivel); return r ? `<a href="#/ejecucion/${esc(r.run_id)}">${esc(r.run_id)}</a><br><b>${pct(r.evaluacion.aterrizajes)}</b> · ${r.perturbado ? pct(r.perturbado.aterrizajes) + ' con viento' : ''}` : '—' }),
    filaNivel('el recomendado del nivel anterior, sin reentrenar', (a, i) => {
      const prev = anterior(i), m = medida(a, prev)
      if (!prev) return '—'
      if (!m) return `<span class="muted">${esc(prev.run_id)}: sin medir</span>`
      return `${esc(prev.run_id)}${m.adaptador ? ' (con adaptador)' : ''}<br><b>${pct(m.despues.normal.aterrizajes)}</b> frente a ${pct(m.antes.normal.aterrizajes)} en su nivel · <b>${Math.round((m.despues.normal.aterrizajes - m.antes.normal.aterrizajes) * 100)} puntos</b><br><span class="muted">${(m.despues.normal.resultados['colisión'] ?? 0)} colisiones</span>`
    }),
    filaNivel('ficha', (a) => (a.ficha ? `<a href="https://github.com/mjcastano29-tech/Alpha-Centauri/blob/main/${esc(a.ficha)}" target="_blank" rel="noopener">${esc(a.ficha)}</a>` : '—')),
  ], 'comparar')
  const runs = c.ejecuciones.filter((r) => r.experimento === actual.id)
  const claves = [...new Set(runs.flatMap((r) => Object.keys(r.config)))].filter((k) => k !== 'ambiente')
  const difiere = (k: string) => new Set(runs.map((r) => valorVariable(r.config[k]))).size > 1
  const variables = tabla(['variable', ...runs.map((r) => `<a href="#/ejecucion/${esc(r.run_id)}">${esc(r.run_id)}</a>`)], [
    ['agente · acción', ...runs.map((r) => esc(`${r.agente.nombre ?? r.agente.clase} · ${r.agente.accion ?? ''}`))],
    ['ambiente', ...runs.map((r) => esc(r.ambiente))],
    ...claves.map((k) => [difiere(k) ? `<b>${esc(k)}</b>` : esc(k), ...runs.map((r) => (difiere(k) ? `<b>${esc(valorVariable(r.config[k]))}</b>` : esc(valorVariable(r.config[k]))))]),
    ['semilla / modelo de partida', ...runs.map((r) => `${esc(valorVariable(r.config.seed))}${r.config.desde ? ` · desde ${esc(String(r.config.desde))}` : ''}`)],
  ], 'comparar')
  const resultados = tabla(['ejecución', 'cambio frente al baseline', 'aterrizajes (suite v1)', 'con viento 15 m/s', 'épocas · 1.º aterrizaje', 'decisión', ''], runs.map((r) => [
    `<a href="#/ejecucion/${esc(r.run_id)}"><b>${esc(r.run_id)}</b></a><br>${pillEstado(r.estado)} ${pillDiseno(r.diseno?.estado)}`,
    `${esc(r.diseno?.cambio ?? '—')}${r.diseno?.baseline ? `<br><span class="muted">baseline: ${esc(r.diseno.baseline)}</span>` : ''}`,
    `<b>${pct(r.evaluacion.aterrizajes)}</b> ${barraResultados(r.evaluacion.resultados, c.outcomes)}<br><span class="muted">${num(r.evaluacion.velocidad_contacto, 2)} m/s · ${num(r.evaluacion.error_posicion)} m${r.nivel !== 'N1' ? ` · ${r.evaluacion.resultados['colisión'] ?? 0} colisiones` : ''}</span>`,
    r.perturbado ? `${pct(r.perturbado.aterrizajes)} ${barraResultados(r.perturbado.resultados, c.outcomes)}` : '—',
    `${entero(r.epocas)}<br><span class="muted">${r.primer_aterrizaje ? 'época ' + entero(r.primer_aterrizaje) : 'nunca'}</span>`,
    `${esc(r.diseno?.decision ?? '—')}`,
    `<a class="btn" href="#/replay/${esc(r.run_id)}">replay</a>`,
  ]))
  el.innerHTML = `
    <h1>Experimentos</h1>
    <p>${experimentos.length} experimentos, uno por pregunta, sobre tres niveles de complejidad creciente. Elige uno para ver sus configuraciones, las variables que se movieron y lo que se decidió; la tabla de arriba muestra cómo crece la complejidad de un nivel al siguiente y cuánto pierde el modelo del nivel anterior cuando se le pone en el nuevo.</p>
    <h2>Cómo aumenta la complejidad</h2>
    ${complejidad}
    ${retirados.length ? `<p class="muted">Ambientes retirados (modelos históricos, siguen siendo reproducibles): ${retirados.map((a) => `${esc(a.nivel)} ${esc(a.id)} v${esc(a.version)} (${esc(a.familia ?? '')})`).join(' · ')}.</p>` : ''}
    <h2>Experimento</h2>
    <nav class="tabs" aria-label="experimentos">${experimentos.map((e) => `<a href="#/experimentos/${esc(e.id)}" class="tab${e.id === actual.id ? ' activa' : ''}">${e.numero} · ${esc(e.titulo)}<br><span class="muted">${esc(e.nivel)} · ${c.ejecuciones.filter((r) => r.experimento === e.id).length} ejecuciones</span></a>`).join('')}</nav>
    <section class="card">
      <h2>${actual.numero} · ${esc(actual.titulo)} <span class="muted">· ${esc(actual.nivel)} · ${esc(actual.ambiente)} · MLflow <code>${esc(actual.id)}</code></span></h2>
      <p><b>Pregunta.</b> ${esc(actual.pregunta)}</p>
      <p><b>Variables que se mueven.</b> ${esc(actual.variables)}</p>
      <h3>Configuraciones y decisiones</h3>
      ${resultados}
      <p><a class="btn primario" href="#/comparar/${runs.map((r) => esc(r.run_id)).join(',')}">Comparar las ${runs.length} en detalle</a></p>
      <h3>Variables de cada configuración</h3>
      <p class="muted">En negrita, las variables que cambian dentro del experimento. El resto es común a todas las configuraciones.</p>
      ${variables}
    </section>`
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
        <p class="muted">Catálogo v${c.catalogo.version} (${esc(c.catalogo.actualizado ?? '—')}). Cada nivel tiene su ambiente. Los niveles 2 y 3 comparten familia de modelos (misma observación): un modelo del nivel 2 juega en el nivel 3 tal cual, y así se mide la degradación con viento fuerte. Un modelo del nivel 1 solo puede jugar en los niveles con obstáculos a través de un adaptador que se los oculta.</p>
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
    <p><a href="#/catalogo">← catálogo</a> · <a href="#/">cohete</a></p>
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
        <label>ambiente <select id="ev-ambiente"><option value="">el de la ejecución (${esc(d.nivel)})</option>${c.ambientes.filter((a) => a.id !== d.ambiente_id && (d.nivel === 'N1' ? a.obstaculos.length > 0 : a.familia === c.ambientes.find((x) => x.id === d.ambiente_id)?.familia)).map((a) => `<option value="${esc(a.id)}">${esc(a.nivel)} · ${esc(a.id)} (${d.nivel === 'N1' ? 'con adaptador: no ve los obstáculos' : 'misma observación, otras condiciones'})</option>`).join('')}</select></label>
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
      sesion.ultimaEvaluacion = r
      salida.innerHTML = `
        <p class="modo modo-eval">Modo: evaluación en vivo${r.suite.id ? ` · ${esc(r.suite.id)} / ${esc(r.suite.condicion ?? '')}` : ''} · modelo ${esc(r.modelo.run_id)} (${r.modelo.mlflow ? esc(r.modelo.mlflow.modelo) + ' v' + r.modelo.mlflow.version : 'sin MLflow'}) · ambiente ${esc(r.ambiente.id)} v${esc(r.ambiente.version)} (${esc(r.ambiente.nivel)})${r.ambiente.adaptador ? ' · <b>modelo del nivel 1 con adaptador: no ve los obstáculos</b>' : r.ambiente.misma_familia ? ` · <b>modelo de ${esc(r.ambiente.nivel_entrenado ?? '')} jugando en las condiciones de ${esc(r.ambiente.nivel)}</b>` : r.ambiente.compatible ? '' : ' · <b>ambiente no compatible</b>'} · servido por commit <code>${corto(r.servido_por.commit)}</code> · ${r.latencia.total_ms} ms (${r.latencia.por_paso_ms} ms por paso)</p>
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
    <p><a href="#/catalogo">← catálogo</a> · <a href="#/">cohete</a></p>
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
