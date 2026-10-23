# Alpha Centauri

Proyecto de aterrizaje de cohete (Rocket Landing) con [Gymnasium](https://gymnasium.farama.org/) y el entorno [LunarLander](https://gymnasium.farama.org/environments/box2d/lunar_lander/).

## Instalación

Requiere Python 3.10+.

```bash
git clone https://github.com/mjcastano29-tech/Alpha-Centauri.git
cd Alpha-Centauri
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

Si la instalación de `box2d` falla al compilar, instala `swig` (`sudo apt install swig` en Linux, `brew install swig` en macOS) y repite el último paso.

## Comprobar el entorno

```bash
python check_env.py            # sin ventana
python check_env.py --render   # con ventana de la simulación
```
