// Iconos de la consola (SVG en línea, heredan el color del texto).
const trazo = (d: string, ancho = 2) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${ancho}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
export const ICONO = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pausa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  reiniciar: trazo('<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>'),
  pasoAtras: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2.4v14H6zM20 5v14L9.5 12z" fill="currentColor"/></svg>',
  pasoAdelante: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 5H18v14h-2.4zM4 5v14l10.5-7z" fill="currentColor"/></svg>',
  altavoz: trazo('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  mudo: trazo('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>'),
  ajustes: trazo('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>', 1.8),
  cerrar: trazo('<path d="M6 6l12 12M18 6 6 18"/>'),
  flecha: '<svg class="flecha" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h11M9 4l4 4-4 4"/></svg>',
  navegacion: trazo('<path d="M12 3v18M5 10l7-7 7 7"/>', 1.8),
  propulsion: trazo('<path d="M12 3c3 3 4 6 4 9a4 4 0 0 1-8 0c0-3 1-6 4-9z"/><path d="M10 19l-1 2M14 19l1 2M12 19v3"/>', 1.8),
  entorno: trazo('<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 15h15a3 3 0 1 1-3 3"/>', 1.8),
  ampliar: trazo('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 2),
  reducir: trazo('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', 2),
  aterrizaje: trazo('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>', 1.8),
}
