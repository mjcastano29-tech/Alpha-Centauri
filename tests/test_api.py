"""Pruebas de la API: catálogo, identidad de los modelos y una evaluación corta.

Ejecutar desde la raíz: python -m pytest tests/test_api.py
"""
import pytest
from fastapi.testclient import TestClient

from api.main import app
from entrenar import load_registry

cliente = TestClient(app)
EJECUCIONES = [r["run_id"] for r in load_registry()["ejecuciones"]]


def test_version_identifica_lo_servido():
    v = cliente.get("/version").json()
    assert v["ambiente"]["version"] and v["catalogo"]["recomendado"] in EJECUCIONES
    assert v["commit"] is None or len(v["commit"]) == 40


def test_catalogo_lista_todas_las_ejecuciones_con_estado():
    c = cliente.get("/catalogo").json()
    ids = [e["run_id"] for e in c["ejecuciones"]]
    assert ids == EJECUCIONES
    estados = {e["run_id"]: e["estado"] for e in c["ejecuciones"]}
    assert estados[c["catalogo"]["recomendado"]] == "recomendado"
    assert all(e["checkpoint"] for e in c["ejecuciones"])


@pytest.mark.parametrize("run_id", EJECUCIONES)
def test_detalle_de_cada_ejecucion(run_id):
    d = cliente.get(f"/ejecuciones/{run_id}").json()
    assert d["manifest"]["run_id"] == run_id and d["curva"]["x"] and d["epocas"] > 0
    assert cliente.get(f"/ejecuciones/{run_id}/vuelos").status_code == 200


def test_ejecucion_inexistente_da_404():
    assert cliente.get("/ejecuciones/no-existe").status_code == 404


def test_evaluar_reproduce_la_evaluacion_guardada():
    """Las primeras épocas de la suite guardada salen igual al ejecutar el modelo recomendado."""
    rec = cliente.get("/version").json()["catalogo"]["recomendado"]
    guardada = cliente.get(f"/ejecuciones/{rec}/evaluacion").json()["normal"]["filas"][:5]
    r = cliente.post("/evaluar", json={"run_id": rec, "episodios": 5, "grabar": 1})
    assert r.status_code == 200
    e = r.json()
    assert e["modo"] == "evaluacion" and e["ambiente"]["compatible"]
    assert [f["resultado"] for f in e["episodios"]] == [f["resultado"] for f in guardada]
    assert len(e["vuelos"]) == 1 and e["vuelos"][0]["f"]["t"]


def test_evaluar_rechaza_mas_episodios_de_la_cuenta():
    assert cliente.post("/evaluar", json={"run_id": EJECUCIONES[0], "episodios": 10_000}).status_code == 422
