// Landing de presentación (landing/index.html, servida en /landing/): abrebocas del proyecto que lleva a la aplicación.
// Niveles, bitácora y enlaces se pintan con el catálogo de la API; mientras responde se muestra la copia de landing-respaldo.ts.
import './landing.css'
import * as api from './api'
import { RESPALDO, type DatosLanding } from './landing-respaldo'
import { esc, num } from './ui'

const NOMBRE_NIVEL: Record<string, string> = { N1: 'Misión base', N2: 'Obstáculos', N3: 'Operación exigente' }
const $ = (s: string) => document.querySelector<HTMLElement>(s)!
const porcentaje = (v: number) => `${num(v * 100, 1)}<span> %</span>`

type Ejecucion = DatosLanding['ejecuciones'][number]
const decision = (r: Ejecucion): [string, string] =>
  r.estado === 'recomendado' ? ['recomendado', 'recomendado'] : r.estado === 'anterior' ? ['anterior (rollback)', 'anterior']
    : r.diseno?.estado === 'rechazado' ? ['rechazado', 'rechazado'] : r.diseno?.estado === 'seleccionado' ? ['seleccionado', 'seleccionado'] : ['referencia', 'referencia']

function tarjetaNivel(d: DatosLanding, nivel: string) {
  const rec = d.ejecuciones.find((r) => r.nivel === nivel && r.estado === 'recomendado')
  const amb = d.ambientes.find((a) => a.id === rec?.ambiente_id)
  // si el ambiente vigente del nivel ya no es el del recomendado (p. ej. la pasarela que sustituye a las torres), se anuncia como trabajo en curso
  const vigente = d.ambientes.find((a) => a.nivel === nivel && a.vigente !== false)
  const enCurso = vigente && vigente.id !== amb?.id ? vigente : null
  const colisiones = amb?.resultados?.includes('colisión') ? rec?.evaluacion.resultados['colisión'] ?? 0 : undefined // solo en niveles con obstáculos
  return `
    <article class="nivel">
      <span class="numero">${esc(nivel)} · ${esc(amb?.id ?? vigente?.id ?? '')}</span>
      <h3>${esc(NOMBRE_NIVEL[nivel] ?? nivel)}</h3>
      ${rec ? `<span class="cifra">${porcentaje(rec.evaluacion.aterrizajes)}</span>` : '<span class="cifra vacia">—</span>'}
      <p>${esc(amb?.resumen ?? vigente?.resumen ?? '')}</p>
      <div class="nivel-pie">${rec ? `${rec.perturbado ? `Con viento de 15 m/s: ${num(rec.perturbado.aterrizajes * 100, 1)} %` : ''}${colisiones !== undefined ? ` · ${colisiones} colisiones` : ''}<br>Modelo: ${esc(rec.run_id)}` : 'Sin modelo recomendado todavía'}</div>
      ${enCurso ? `<div class="en-curso"><b>EN CURSO · ${esc(enCurso.id)} v${esc(enCurso.version)}</b>${esc(enCurso.resumen ?? '')}</div>` : ''}
    </article>`
}

function filaEjecucion(r: Ejecucion) {
  const [texto, clase] = decision(r)
  return `<tr>
    <td class="run">${esc(r.run_id)}</td><td>${esc(r.nivel)}</td><td>${esc(r.agente.nombre ?? '—')}</td>
    <td><div class="barra"><i><b class="${r.estado === 'recomendado' ? 'rec' : ''}" style="width: ${(r.evaluacion.aterrizajes * 100).toFixed(1)}%"></b></i>${num(r.evaluacion.aterrizajes * 100, 1)} %</div></td>
    <td><span class="decision ${clase}">${texto}</span></td>
  </tr>`
}

function pintar(d: DatosLanding, enVivo: boolean) {
  const niveles = [...new Set(d.ambientes.map((a) => a.nivel))].sort()
  $('#niveles-lista').innerHTML = niveles.map((n) => tarjetaNivel(d, n)).join('')

  const experimentos = [...(d.experimentos ?? [])].sort((a, b) => a.numero - b.numero)
  const conEjecuciones = experimentos.filter((e) => d.ejecuciones.some((r) => r.experimento === e.id))
  const enCurso = experimentos.length - conEjecuciones.length
  $('#bitacora-resumen').textContent = `${d.ejecuciones.length} ejecuciones en ${conEjecuciones.length} experimentos${enCurso ? ` (y ${enCurso} en curso)` : ''}, cada una con su hipótesis y su decisión. También se guardan las rechazadas.`
  const sueltas = d.ejecuciones.filter((r) => !experimentos.some((e) => e.id === r.experimento))
  $('#bitacora-filas').innerHTML = experimentos.map((e) => {
    const runs = d.ejecuciones.filter((r) => r.experimento === e.id)
    return `<tr class="grupo"><th colspan="5">Experimento ${e.numero} · ${esc(e.titulo)}${runs.length ? '' : ' <span>· en curso, todavía sin ejecuciones</span>'}</th></tr>${runs.map(filaEjecucion).join('')}`
  }).join('') + (sueltas.length ? `<tr class="grupo"><th colspan="5">Otras ejecuciones</th></tr>${sueltas.map(filaEjecucion).join('')}` : '')

  // el replay de la portada: el recomendado del nivel más alto que tenga uno
  const destacado = [...niveles].reverse().map((n) => d.ejecuciones.find((r) => r.nivel === n && r.estado === 'recomendado')).find(Boolean)
  if (destacado) $('#cta-replay').setAttribute('href', `/#/replay/${encodeURIComponent(destacado.run_id)}`)
  $('#meta-catalogo').textContent = `CATÁLOGO V${d.catalogo.version} · ${enVivo ? 'EN VIVO' : 'COPIA DEL 6 NOV'}`
  $('#meta-punto').classList.toggle('vivo', enVivo)
}

pintar(RESPALDO, false)
$('#enlace-api').setAttribute('href', `${api.API}/docs`)
api.catalogo().then((c) => pintar(c, true)).catch(() => { $('#meta-catalogo').textContent = `CATÁLOGO V${RESPALDO.catalogo.version} · COPIA DEL 6 NOV (SIN API)` })

// modo presentación: → y ← saltan a la sección siguiente o anterior (AvPág y RePág siguen desplazando una pantalla).
// Mientras dura el desplazamiento suave se cuenta desde la sección de destino, para que varias pulsaciones seguidas no se pierdan.
const secciones = [...document.querySelectorAll<HTMLElement>('[data-seccion]')]
let destino = 0, moviendoHasta = 0
addEventListener('keydown', (ev) => {
  if (ev.altKey || ev.ctrlKey || ev.metaKey || (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft')) return
  const base = performance.now() < moviendoHasta ? destino : Math.max(0, secciones.findLastIndex((s) => s.getBoundingClientRect().top <= 8))
  destino = Math.max(0, Math.min(secciones.length - 1, base + (ev.key === 'ArrowRight' ? 1 : -1)))
  moviendoHasta = performance.now() + 1200
  secciones[destino].scrollIntoView({ behavior: 'smooth', block: 'start' })
  ev.preventDefault()
})
