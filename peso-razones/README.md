# El peso de las razones

App web interactiva para exposición de Matemáticas para la Informática.
Una pantalla actúa como proyector; los estudiantes se conectan desde sus celulares
escaneando un QR para votar dilemas filosóficos en tiempo real.

---

## Instalación

```bash
cd peso-razones
pip install -r requirements.txt
```

> Recomendado: usa un virtualenv.
> ```bash
> python -m venv .venv
> source .venv/bin/activate   # Linux/WSL/Mac
> pip install -r requirements.txt
> ```

---

## Correr el servidor

```bash
python app.py
```

Al arrancar verás en consola:

```
============================================================
  El peso de las razones — Servidor de exposición
============================================================
  Proyector : http://localhost:5000/proyector
  Jugadores : http://<IP_LOCAL>:5000/jugador
============================================================
```

Abre `http://localhost:5000/proyector` en el navegador del proyector.
Los celulares escanean el QR o navegan a la URL de jugadores.

**URLs de acceso:**
| Rol | URL |
|-----|-----|
| Proyector | `http://localhost:5000/proyector` |
| Estudiantes | `http://<IP>:5000/jugador` |
| Presentador (cel) | `http://<IP>:5000/jugador?p=1` |

El presentador puede avanzar la pantalla de resultados presionando **ESPACIO** en el
proyector, o con el botón **▶ AVANZAR** que aparece en su celular al entrar con `?p=1`.

---

## Nota importante sobre WSL (Windows Subsystem for Linux)

Cuando corres el servidor desde WSL, la IP detectada automáticamente
(`172.x.x.x`) es la de la interfaz virtual de WSL, **no la de la tarjeta
WiFi de Windows**. Los celulares en la misma red no van a llegar a esa IP.

### Solución recomendada para WSL

**Opción 1 — Obtener la IP real de Windows y usarla manualmente:**

Desde PowerShell o CMD en Windows:
```powershell
ipconfig
```
Busca el adaptador "Wi-Fi" (o el hotspot que estés usando) y anota la
`Dirección IPv4`, por ejemplo `192.168.1.45`.

Los celulares deben navegar a:
```
http://192.168.1.45:5000/jugador
```

El servidor Flask ya escucha en `0.0.0.0` (todas las interfaces), así que
la IP de Windows sí llega al proceso aunque corra dentro de WSL, **siempre
que el firewall de Windows lo permita** (ver abajo).

**Firewall de Windows:** Si los celulares no conectan, permite el puerto 5000:
```powershell
# Ejecutar en PowerShell como administrador
New-NetFirewallRule -DisplayName "Flask 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow
```

**Opción 2 — Correr directamente en Windows (sin WSL):**
Instala Python en Windows, instala las dependencias y corre `python app.py`
desde PowerShell. La detección de IP automática funcionará correctamente.

---

## Plan A — WiFi del salón

1. Proyector y celulares conectados a la misma red WiFi.
2. Correr `python app.py`.
3. Obtener la IP (ver sección WSL arriba o ejecutar `ip addr` en Linux/WSL
   y buscar la IP bajo `eth0` o `wlan0`).
4. Compartir URL o escanear QR.

```bash
# Identificar IP local manualmente en Linux/WSL:
ip addr show
# Busca una línea tipo: inet 192.168.x.x/24 ... scope global eth0
```

---

## Plan B — Hotspot del celular del presentador

Cuando no hay WiFi de salón o no se puede usar.

**Paso a paso:**

1. En tu celular (Android): *Ajustes → Red → Zona WiFi y anclaje → Zona WiFi portátil* → Activar.
   En iPhone: *Ajustes → Compartir Internet* → Activar.

2. Conecta la laptop con el proyector a esa red WiFi del celular.

3. Desde la laptop, obtén la IP que el hotspot te asignó:
   - En WSL/Linux: `ip addr show eth0` (o `ip route get 1` para ver la interfaz usada).
   - En Windows: `ipconfig` → busca "Adaptador de LAN inalámbrica Wi-Fi".

4. Corre `python app.py` y comparte la URL `http://<esa IP>:5000/jugador`.

5. Los estudiantes se conectan a la red hotspot del celular del presentador
   y escanean el QR o navegan a la URL.

> **Limitación:** algunos operadores bloquean el tráfico entre clientes del hotspot
> (client isolation). Si pasa, prueba el Plan C.

---

## Plan C — ngrok (túnel público, funciona desde cualquier red)

Cuando A y B fallan o los dispositivos están en redes distintas.

**Instalación de ngrok:**

```bash
# Linux/WSL
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc \
  | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null \
  && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" \
  | sudo tee /etc/apt/sources.list.d/ngrok.list \
  && sudo apt update && sudo apt install ngrok

# O descarga el binario desde https://ngrok.com/download
```

Crea una cuenta gratuita en https://ngrok.com y autentica:
```bash
ngrok config add-authtoken <TU_TOKEN>
```

**Uso durante la exposición:**

Terminal 1 — servidor Flask:
```bash
python app.py
```

Terminal 2 — túnel ngrok:
```bash
ngrok http 5000
```

ngrok te dará una URL pública tipo `https://abc123.ngrok-free.app`.
Esa URL funciona desde cualquier red. Actualiza el QR manualmente o
comparte la URL directamente.

> La URL cambia en cada sesión con la cuenta gratuita. Con cuenta ngrok
> de pago puedes fijar un subdominio permanente.

---

## Configuración por variable de entorno

Copia `.env.example` a `.env` y edítalo:

```bash
cp .env.example .env
```

| Variable | Descripción | Default |
|---|---|---|
| `IP_OVERRIDE` | IP que aparece en el QR. En WSL: IP de Windows (ver arriba). | auto-detect |
| `DILEMA_DURACION` | Segundos de votación por dilema | `30` |
| `RESULTADOS_DURACION` | Segundos mostrando resultados entre dilemas | `15` |

---

## Prueba manual del flujo completo

Con el servidor corriendo (`python app.py`), abre una segunda terminal y usa
el script Python de prueba incluido abajo, o ejecuta los comandos curl en orden.

### Script de prueba rápida (copia y pega en Python REPL)

```python
import socketio

# Cliente que simula el proyector
proyector = socketio.SimpleClient()
proyector.connect("http://localhost:5000")

# Cliente que simula un jugador
jugador = socketio.SimpleClient()
jugador.connect("http://localhost:5000")

# Registrar jugador
jugador.emit("jugador:conectar")
event = jugador.receive(timeout=2)
print("Bienvenida:", event)  # ["jugador:bienvenida", {...}]

# Iniciar partida desde el proyector
proyector.emit("proyector:iniciar_partida")

# Esperar el evento estado:actualizado (dilema 1 activo)
import time; time.sleep(1)

# Votar en el dilema 1
jugador.emit("jugador:votar", {"opcion": "A"})
event = jugador.receive(timeout=2)
print("Estado tras voto:", event)

# Reset para volver al lobby
proyector.emit("proyector:reset")

proyector.disconnect()
jugador.disconnect()
```

Requiere `pip install "python-socketio[client]"` en el entorno donde corras el script.

### Verificar estado con curl (HTTP polling, sin WebSocket)

```bash
# El servidor no expone una REST API de estado, pero puedes verificar que las
# rutas HTTP responden:
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/proyector  # → 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/jugador    # → 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/           # → 302
```

---

## Estructura del proyecto

```
peso-razones/
├── app.py            # Servidor Flask + SocketIO + rutas
├── game_state.py     # Estado del juego (esqueleto)
├── dilemas.py        # Lista de dilemas (esqueleto)
├── requirements.txt
├── README.md
├── static/
│   ├── css/
│   │   ├── proyector.css
│   │   └── jugador.css
│   ├── js/
│   │   ├── proyector.js
│   │   └── jugador.js
│   └── sounds/       # Archivos .mp3 de efectos (añadir manualmente)
└── templates/
    ├── proyector.html
    └── jugador.html
```
