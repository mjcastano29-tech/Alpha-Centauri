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


def test_suites_y_manifiestos_de_la_seccion_11():
    s = cliente.get("/suites").json()["suites"]
    assert s["suite-v1"]["semilla_base"] == 10_000_000 and {c["id"] for c in s["suite-v1"]["condiciones"]} == {"normal", "viento-15"}
    for run_id in EJECUCIONES:
        resumen = next(e for e in cliente.get("/catalogo").json()["ejecuciones"] if e["run_id"] == run_id)
        assert resumen["diseno"]["estado"] in ("seleccionado", "rechazado", "referencia") and resumen["diseno"]["hipotesis"]
        m = cliente.get(f"/ejecuciones/{run_id}/manifiesto").json()
        assert m["run_id"] == run_id and len(m["git_commit"]) == 40 and len(m["model_sha256"]) == 64
        assert m["evaluation_suite_id"] == "suite-v1" and m["level_id"] == resumen["nivel"] and m["status"] == resumen["diseno"]["estado"]


def test_evaluar_con_suite_fija_semilla_y_viento():
    e = cliente.post("/evaluar", json={"run_id": EJECUCIONES[0], "suite": "suite-v1", "condicion": "viento-15", "episodios": 2}).json()
    assert e["suite"]["semilla_base"] == 10_000_000 and e["suite"]["viento"] == 15.0 and e["resumen"]["episodios"] == 2
    assert cliente.post("/evaluar", json={"run_id": EJECUCIONES[0], "suite": "no-existe"}).status_code == 404
    assert cliente.post("/evaluar", json={"run_id": EJECUCIONES[0], "suite": "suite-v1", "condicion": "huracan"}).status_code == 422


def test_un_modelo_del_nivel_2_juega_en_el_nivel_3_sin_adaptador():
    run_id = next(r for r in EJECUCIONES if r.startswith("ppo-n2-"))
    e = cliente.post("/evaluar", json={"run_id": run_id, "episodios": 2, "grabar": 0, "ambiente": "RocketLanding3D-N3-v0"}).json()
    amb = e["ambiente"]
    assert amb["nivel"] == "N3" and amb["nivel_entrenado"] == "N2" and amb["misma_familia"] and not amb["adaptador"] and not amb["compatible"]
    assert cliente.post("/evaluar", json={"run_id": run_id, "episodios": 1, "ambiente": "RocketLanding3D-v0"}).status_code == 422


def test_incidentes_muestran_la_degradacion_y_las_intervenciones_del_nivel_3():
    d = cliente.get("/incidentes").json()
    n3 = "RocketLanding3D-N3-v0"
    m = next(x for x in d["medidas"] if x["run_id"] == "ppo-n2-transfer-1m5-v0.2-s1" and x["ambiente"]["id"] == n3)
    assert m["nivel_entrenado"] == "N2" and not m["adaptador"] and m["despues"]["normal"]["episodios"] == 200
    assert m["despues"]["normal"]["aterrizajes"] < m["antes"]["normal"]["aterrizajes"]  # se degrada al cambiar de condiciones
    ids = [r["run_id"] for r in d["intervenciones"][n3]]
    assert "ppo-n3-transfer-v0.3-s0" in ids and any(r["estado"] == "recomendado" for r in d["intervenciones"][n3])


def test_monitoreo_resume_la_operacion():
    m = cliente.get("/monitoreo").json()
    cat = cliente.get("/catalogo").json()["catalogo"]
    assert m["servicio"]["api"] and m["catalogo"]["version"] == cat["version"]
    assert {n["nivel"]: n["recomendado"] for n in m["niveles"]} == {k: v["recomendado"] for k, v in cat["niveles"].items()}
    assert all("aterrizajes" in n for n in m["niveles"] if n["recomendado"])
    assert m["resumen"]["ejecuciones"] == len(EJECUCIONES) and isinstance(m["alertas"], list)
    antes = m["servicio"]["evaluaciones_servidas"]
    cliente.post("/evaluar", json={"run_id": EJECUCIONES[0], "episodios": 1})
    m2 = cliente.get("/monitoreo").json()
    assert m2["servicio"]["evaluaciones_servidas"] == antes + 1 and m2["evaluaciones"][-1]["run_id"] == EJECUCIONES[0]
