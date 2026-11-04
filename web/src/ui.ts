// Utilidades de interfaz: construcción segura de DOM, formato y gráficas SVG pequeñas.
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`)
export const num = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d })
export const entero = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('es'))
export const corto = (sha: string | null | undefined) => (sha ? sha.slice(0, 12) : '—')

export const COLOR_RESULTADO: Record<string, string> = {
  aterrizaje: 'var(--good)', 'fuera de plataforma': 'var(--warning)', choque: 'var(--critical)',
  'sin pasos': 'var(--neutral)', 'fuera de zona': 'var(--serious)',
}
export const ICONO_RESULTADO: Record<string, string> = { aterrizaje: '✓', 'fuera de plataforma': '◐', choque: '✕', 'sin pasos': '…', 'fuera de zona': '↗' }

export function pillEstado(estado: string) {
  const texto = { recomendado: 'recomendado', anterior: 'anterior (rollback)', historico: 'histórico' }[estado] ?? estado
  return `<span class="pill pill-${esc(estado)}">${esc(texto)}</span>`
}

/** Estado del diseño experimental: seleccionado / rechazado / referencia (configs/<run_id>.json). */
export function pillDiseno(estado: string | null | undefined) {
  if (!estado) return '<span class="pill pill-sin">sin hipótesis</span>'
  return `<span class="pill pill-${esc(estado)}">${esc(estado)}</span>`
}

export function barraResultados(resultados: Record<string, number>, outcomes: string[]) {
  const total = Object.values(resultados).reduce((a, b) => a + b, 0) || 1
  const partes = outcomes
    .filter((o) => resultados[o])
    .map((o) => `<i title="${esc(o)}: ${resultados[o]}" style="width:${(100 * resultados[o]) / total}%;background:${COLOR_RESULTADO[o]}"></i>`)
    .join('')
  return `<span class="barra">${partes}</span>`
}

/** Gráfica de línea sencilla (SVG) con eje y de 0 a 1 o automático. */
export function lineaSvg(series: { x: number[]; y: number[]; color: string; nombre: string }[], opciones: { pct?: boolean; alto?: number; xLabel?: string } = {}) {
  const W = 640, H = opciones.alto ?? 200, L = 44, R = 12, T = 12, B = 28
  const xs = series.flatMap((s) => s.x), ys = series.flatMap((s) => s.y)
  if (!xs.length) return '<p class="muted">Sin datos.</p>'
  const xmax = Math.max(...xs), lo = opciones.pct ? 0 : Math.min(0, ...ys), hi = opciones.pct ? 1 : Math.max(...ys) * 1.05 || 1
  const X = (v: number) => L + (v / (xmax || 1)) * (W - L - R), Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const ticks = opciones.pct ? [0, 0.25, 0.5, 0.75, 1] : [lo, (lo + hi) / 2, hi]
  const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${opciones.pct ? Math.round(v * 100) + ' %' : Math.round(v)}</text>`).join('')
  const xt = [0, 0.25, 0.5, 0.75].map((f) => `<text x="${X(f * xmax)}" y="${H - 8}" text-anchor="middle">${entero(Math.round(f * xmax))}</text>`).join('')
  const paths = series.map((s) => `<path d="${s.x.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(s.y[i]).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`).join('')
  const leyenda = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.nombre)}</span>`).join('')
  return `<div class="leyenda">${leyenda}</div><svg viewBox="0 0 ${W} ${H}" class="grafica" role="img">${grid}<line x1="${L}" x2="${W - R}" y1="${Y(lo)}" y2="${Y(lo)}" class="eje"/>${xt}${paths}<text x="${W - R}" y="${H - 8}" text-anchor="end" class="xl">${esc(opciones.xLabel ?? '')}</text></svg>`
}

/** Tabla simple. Cabeceras y celdas llegan ya escapadas (o con HTML propio); la cabecera puede llevar enlaces. */
export function tabla(cabecera: string[], filas: (string | number)[][], clase = '') {
  return `<div class="tabla ${clase}"><table><thead><tr>${cabecera.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${filas
    .map((f) => `<tr>${f.map((c) => `<td>${typeof c === 'number' ? c : c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`
}
