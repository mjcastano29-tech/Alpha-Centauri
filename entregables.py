"""Genera el paquete de entregables en `entregables/` a partir de los documentos versionados.

Convierte a PDF (y HTML) el informe final, el guion de la defensa, el índice de entregables, el catálogo de experimentos,
las fichas de los ambientes vigentes, la descripción del pipeline y el historial de versiones. Los PDF son una copia de
lectura: la fuente de verdad siguen siendo los Markdown del repositorio.

    python entregables.py --ref v1.1.0 # escribe entregables/*.pdf y entregables/*.html; los enlaces apuntan a esa etiqueta
    python entregables.py --sin-pdf    # solo HTML (no necesita Chromium)

Requiere `markdown` (está en requirements.txt) y, para el PDF, Playwright con Chromium (`playwright install chromium`).
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
SALIDA = RAIZ / "entregables"

# (archivo fuente, nombre de salida, título de portada)
DOCUMENTOS = [
    ("docs/entregables.md", "00-indice-entregables", "Índice de entregables"),
    ("docs/informe-final.md", "01-informe-final", "Informe final"),
    ("docs/guion-defensa.md", "02-guion-defensa", "Guion de la defensa"),
    ("EXPERIMENTOS.md", "03-experimentos-y-modelos", "Experimentos y modelos"),
    ("docs/ambiente-v0.1.md", "04-ficha-ambiente-v0.1-N1", "Ficha del ambiente 0.1 (nivel 1)"),
    ("docs/ambiente-v0.4.md", "05-ficha-ambiente-v0.4-N2", "Ficha del ambiente 0.4 (nivel 2, pasarela)"),
    ("docs/ambiente-v0.5.md", "06-ficha-ambiente-v0.5-N3", "Ficha del ambiente 0.5 (nivel 3, pasarela con viento)"),
    ("pipelines/README.md", "07-pipeline", "Pipeline de entrenamiento y publicación"),
    ("docs/CHANGELOG.md", "08-historial-de-versiones", "Historial de versiones"),
]

ESTILO = """
:root { --ink: #1d2126; --muted: #5d6572; --line: #d9d7cf; --accent: #1f6f5c; --soft: #eef3f1; }
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: #fff; font: 11pt/1.5 "Source Sans 3", "Segoe UI", system-ui, sans-serif; }
main { max-width: 86ch; margin: 0 auto; padding: 28px 32px 48px; }
.portada { border-bottom: 2px solid var(--accent); margin-bottom: 22px; padding-bottom: 10px; }
.portada .proyecto { font: 600 10pt/1.2 ui-monospace, Menlo, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
.portada h1 { margin: 6px 0 4px; font-size: 22pt; line-height: 1.15; }
.portada .meta { color: var(--muted); font-size: 9.5pt; }
h1, h2, h3 { line-height: 1.2; page-break-after: avoid; }
h1 { font-size: 18pt; margin: 26px 0 10px; }
h2 { font-size: 14pt; margin: 22px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 3px; }
h3 { font-size: 12pt; margin: 16px 0 6px; }
p, li { orphans: 3; widows: 3; }
a { color: var(--accent); text-decoration: none; word-break: break-word; }
code { font: 9.5pt ui-monospace, Menlo, Consolas, monospace; background: var(--soft); padding: 1px 4px; border-radius: 4px; }
pre { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; overflow-x: auto; font-size: 9pt; line-height: 1.4; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 16px; font-size: 9.5pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid var(--line); padding: 5px 7px; vertical-align: top; text-align: left; }
th { background: var(--soft); font-weight: 600; }
img, svg { max-width: 100%; height: auto; }
blockquote { margin: 10px 0; padding: 4px 14px; border-left: 3px solid var(--accent); color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--line); margin: 20px 0; }
@page { size: A4; margin: 16mm 14mm 18mm; }
@media print { main { padding: 0; max-width: none; } a { color: inherit; } }
"""


def renderizar(fuente: Path, titulo: str, fecha: str, commit: str, ref: str) -> str:
    import markdown  # importado aquí para que `--help` funcione sin la dependencia

    texto = fuente.read_text(encoding="utf-8")
    cuerpo = markdown.markdown(texto, extensions=["tables", "fenced_code", "sane_lists", "toc", "attr_list"], output_format="html5")
    # los enlaces relativos dentro del repositorio pasan a apuntar al commit en GitHub, así el PDF sigue siendo navegable
    base = f"https://github.com/mjcastano29-tech/Alpha-Centauri/blob/{ref}/"
    carpeta = fuente.parent.relative_to(RAIZ).as_posix()
    carpeta = "" if carpeta == "." else carpeta + "/"

    def enlace(m: re.Match[str]) -> str:
        destino = m.group(2)
        if re.match(r"^(https?:|mailto:|#|data:)", destino):
            return m.group(0)
        ruta = Path(carpeta + destino.split("#")[0]).as_posix()
        partes = []
        for p in ruta.split("/"):
            if p == "..":
                if partes:
                    partes.pop()
            elif p and p != ".":
                partes.append(p)
        ancla = ("#" + destino.split("#", 1)[1]) if "#" in destino else ""
        return f'{m.group(1)}{base}{"/".join(partes)}{ancla}"'

    cuerpo = re.sub(r'(<a [^>]*href=")([^"]+)"', enlace, cuerpo)
    # las imágenes quedan relativas a `entregables/` (hermana de `docs/`): valen en el disco, en GitHub y al imprimir
    def imagen(m: re.Match[str]) -> str:
        if m.group(2).startswith(("http", "data:")):
            return m.group(0)
        destino = (fuente.parent / m.group(2)).resolve().relative_to(RAIZ).as_posix()
        return f'{m.group(1)}../{destino}"'

    cuerpo = re.sub(r'(<img [^>]*src=")([^"]+)"', imagen, cuerpo)
    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(titulo)} · Alpha Centauri</title><style>{ESTILO}</style></head>
<body><main>
<header class="portada"><div class="proyecto">Alpha Centauri · Rocket Landing · proyecto final de MLOps</div>
{'' if texto.lstrip().startswith('# ') else f'<h1>{html.escape(titulo)}</h1>'}
<div class="meta">Generado el {fecha} desde <code>{html.escape(fuente.relative_to(RAIZ).as_posix())}</code> · {('etiqueta <code>' + html.escape(ref) + '</code>') if ref != commit else 'commit <code>' + commit[:10] + '</code>'} · fuente de verdad: el Markdown del repositorio</div></header>
{cuerpo}
</main></body></html>"""


def a_pdf(pares: list[tuple[Path, Path]]) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        navegador = p.chromium.launch()
        pagina = navegador.new_page()
        for html_path, pdf_path in pares:
            pagina.goto(html_path.resolve().as_uri(), wait_until="load")
            pagina.wait_for_timeout(300)
            pagina.pdf(path=str(pdf_path), format="A4", print_background=True, margin={"top": "16mm", "bottom": "18mm", "left": "14mm", "right": "14mm"},
                       display_header_footer=True, header_template="<span></span>",
                       footer_template='<div style="width:100%;font:8pt sans-serif;color:#5d6572;padding:0 14mm;display:flex;justify-content:space-between"><span>Alpha Centauri · Rocket Landing</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>')
            print(f"  {pdf_path.relative_to(RAIZ)}  ({pdf_path.stat().st_size // 1024} kB)")
        navegador.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sin-pdf", action="store_true", help="genera solo el HTML")
    ap.add_argument("--ref", default=None, help="etiqueta o rama a la que apuntan los enlaces del repositorio (por defecto, el commit actual)")
    args = ap.parse_args()
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=RAIZ, capture_output=True, text=True, check=True).stdout.strip()
    fecha = dt.date.today().isoformat()
    SALIDA.mkdir(exist_ok=True)
    pares = []
    for fuente, nombre, titulo in DOCUMENTOS:
        origen = RAIZ / fuente
        if not origen.exists():
            print(f"  falta {fuente}, se omite", file=sys.stderr)
            continue
        html_path = SALIDA / f"{nombre}.html"
        html_path.write_text(renderizar(origen, titulo, fecha, commit, args.ref or commit), encoding="utf-8")
        pares.append((html_path, SALIDA / f"{nombre}.pdf"))
    # la evidencia visual del pipeline acompaña al paquete tal cual
    evidencia = RAIZ / "docs/evidencia-prefect-flow-run.png"
    if evidencia.exists():
        shutil.copy(evidencia, SALIDA / "09-evidencia-prefect-flow-run.png")
    print(f"HTML: {len(pares)} documentos en {SALIDA.relative_to(RAIZ)}/")
    if not args.sin_pdf:
        a_pdf(pares)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
