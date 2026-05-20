import io
import os
import base64
import random
import socket

import qrcode
from dotenv import load_dotenv
from flask import Flask, redirect, render_template, url_for, request
from flask_socketio import SocketIO, emit

from game_state import GameState

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = "peso-razones-dev-key"

socketio = SocketIO(app, async_mode="eventlet", cors_allowed_origins="*")

game_state = GameState()
proyector_sids: set = set()


def emit_estado_a_todos() -> None:
    """
    Emite estado:actualizado a todos los clientes conectados.
    Jugadores reciben un snapshot personalizado con su propio tu_voto.
    El proyector recibe el snapshot base (sin tu_voto).
    """
    snapshot_base = game_state.snapshot_estado()
    for sid in list(proyector_sids):
        socketio.emit("estado:actualizado", snapshot_base, room=sid)
    for sid, info in list(game_state.jugadores.items()):
        if not info["conectado"]:
            continue
        jugador_id = info["jugador_id"]
        tu_voto = game_state.votos_individuales.get(jugador_id, {}).get(game_state.dilema_actual)
        socketio.emit("estado:actualizado", {**snapshot_base, "tu_voto": tu_voto}, room=sid)


# ---------------------------------------------------------------------------
# Utilidades de red y QR
# ---------------------------------------------------------------------------

def get_local_ip() -> str:
    """
    Devuelve la IP para el QR. Respeta IP_OVERRIDE del .env.
    En WSL, poner IP_OVERRIDE con la IP del adaptador Wi-Fi de Windows
    (obtenida con `ipconfig` en PowerShell).
    """
    override = os.getenv("IP_OVERRIDE", "").strip()
    if override:
        return override
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def generar_qr_base64(url: str) -> str:
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0a0a0a", back_color="#f5f0e8")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


url_override = os.getenv("URL_OVERRIDE", "").strip()
if url_override:
    URL_JUGADOR = f"{url_override.rstrip('/')}/jugador"
else:
    IP_LOCAL = get_local_ip()
    URL_JUGADOR = f"http://{IP_LOCAL}:5000/jugador"
QR_BASE64 = generar_qr_base64(URL_JUGADOR)


# ---------------------------------------------------------------------------
# Rutas HTTP
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return redirect(url_for("proyector"))


@app.route("/proyector")
def proyector():
    return render_template(
        "proyector.html",
        url_jugador=URL_JUGADOR,
        qr_base64=QR_BASE64,
    )


@app.route("/jugador")
def jugador():
    return render_template("jugador.html")


@app.route("/admin/prueba")
def admin_prueba():
    return render_template("admin_prueba.html")


# ---------------------------------------------------------------------------
# Modo prueba — jugadores virtuales
# ---------------------------------------------------------------------------

def votar_fakes_dilema(run_id: int, num: int) -> None:
    """Hace que los jugadores fake voten con timing variado y realista."""
    from fake_players import get_voto_fake, get_respuesta_libre_fake

    fake_sids = list(game_state.jugadores_fake)
    random.shuffle(fake_sids)

    # Primera espera antes de que el primer fake vote
    socketio.sleep(random.uniform(2.5, 6.0))

    for fake_sid in fake_sids:
        if game_state._run_id != run_id:
            return
        if game_state.fase != "dilema" or game_state.dilema_actual != num:
            return
        if fake_sid not in game_state.jugadores:
            continue

        perfil = game_state.jugadores[fake_sid].get("perfil", {})

        if num == 6:
            texto = get_respuesta_libre_fake()
            game_state.registrar_respuesta_libre(fake_sid, texto)
            print(f"[PRUEBA] {perfil.get('nombre', fake_sid)} responde libre: {texto[:40]}")
        else:
            opcion = get_voto_fake(perfil, num)
            game_state.registrar_voto(fake_sid, opcion)
            print(f"[PRUEBA] {perfil.get('nombre', fake_sid)} vota {opcion} en D{num}")

        emit_estado_a_todos()
        socketio.sleep(random.uniform(1.0, 3.5))


# ---------------------------------------------------------------------------
# Loop principal del juego (corre como background task de eventlet)
# ---------------------------------------------------------------------------

def run_game_loop(run_id: int) -> None:
    if game_state.fase != "lobby":
        return

    duracion = int(os.getenv("DILEMA_DURACION", 30))
    # RESULTADOS_DURACION ya no se usa — el presentador avanza manualmente

    for num in range(1, 7):
        if game_state._run_id != run_id:
            return

        # --- Dilema 5: revelar predicción antes de abrir la votación ---
        if num == 5:
            prediccion = game_state.calcular_prediccion_d5()
            game_state.prediccion_dilema5 = prediccion
            print(
                f"[GAME] Predicción D5 calculada: "
                f"{prediccion['prediccion']} ({prediccion['porcentaje']}%)"
            )
            socketio.emit("dilema5:revelacion_prediccion", prediccion)

            # Esperar avance manual del presentador (timeout de seguridad: 60s)
            game_state.avanzar_solicitado = False
            espera_max = 60
            while not game_state.avanzar_solicitado and espera_max > 0:
                if game_state._run_id != run_id:
                    return
                socketio.sleep(0.2)
                espera_max -= 0.2
            game_state.avanzar_solicitado = False
            print(f"[GAME] Predicción D5 cerrada, iniciando dilema 5")

        # --- Iniciar dilema ---
        game_state.iniciar_dilema(num)
        print(f"[GAME] Dilema {num} iniciado")
        emit_estado_a_todos()

        if game_state.modo_prueba and game_state.jugadores_fake:
            socketio.start_background_task(votar_fakes_dilema, run_id, num)

        # --- Timer ---
        for t in range(duracion, 0, -1):
            if game_state._run_id != run_id:
                return
            game_state.timer_restante = t
            socketio.emit("timer:tick", {"restante": t})
            socketio.sleep(1)
            if game_state.todos_votaron():
                print(f"[GAME] Early end — todos votaron en dilema {num}")
                break

        game_state.timer_restante = 0

        # --- Terminar dilema ---
        game_state.terminar_dilema()
        votos = game_state.votos_por_dilema.get(num, {})
        print(
            f"[GAME] Dilema {num} terminado: "
            f"{votos.get('A', 0)}A/{votos.get('B', 0)}B"
        )

        payload: dict = {"dilema": num, "votos": votos}
        if num == 5:
            payload["prediccion"] = game_state.prediccion_dilema5
        socketio.emit("dilema:terminado", payload)
        emit_estado_a_todos()

        # --- Pantalla de resultados: espera hasta que el presentador avance ---
        game_state.avanzar_solicitado = False
        while not game_state.avanzar_solicitado:
            if game_state._run_id != run_id:
                return
            socketio.sleep(0.2)
        game_state.avanzar_solicitado = False

    # --- Fin de la partida ---
    if game_state._run_id != run_id:
        return
    game_state.fase = "terminado"
    print("[GAME] Partida terminada")
    socketio.emit("partida:terminada", game_state.snapshot_estado())
    emit_estado_a_todos()


# ---------------------------------------------------------------------------
# Eventos SocketIO — conexión base
# ---------------------------------------------------------------------------

@socketio.on("connect")
def on_connect():
    pass  # El registro real ocurre en jugador:conectar


@socketio.on("disconnect")
def on_disconnect():
    proyector_sids.discard(request.sid)
    if request.sid in game_state.jugadores:
        jugador_id = game_state.jugadores[request.sid]["jugador_id"]
        game_state.eliminar_jugador(request.sid)
        total = sum(1 for j in game_state.jugadores.values() if j["conectado"])
        print(f"[GAME] Jugador desconectado: {jugador_id} (total: {total})")
        emit_estado_a_todos()


# ---------------------------------------------------------------------------
# Eventos SocketIO — jugador
# ---------------------------------------------------------------------------

@socketio.on("jugador:conectar")
def on_jugador_conectar():
    jugador_id = game_state.agregar_jugador(request.sid)
    total = sum(1 for j in game_state.jugadores.values() if j["conectado"])
    print(f"[GAME] Jugador conectado: {jugador_id} (total: {total})")
    emit("jugador:bienvenida", {
        "jugador_id": jugador_id,
        "estado": game_state.snapshot_estado_para(request.sid),
    })
    emit_estado_a_todos()


@socketio.on("jugador:votar")
def on_jugador_votar(data):
    if game_state.fase != "dilema":
        return
    opcion = str(data.get("opcion", "")).upper()
    ok = game_state.registrar_voto(request.sid, opcion)
    if ok:
        jugador_id = game_state.jugadores[request.sid]["jugador_id"]
        num = game_state.dilema_actual
        votos = game_state.votos_por_dilema.get(num, {})
        print(
            f"[GAME] Voto registrado: {jugador_id} → {opcion} "
            f"(D{num}: {votos.get('A', 0)}A/{votos.get('B', 0)}B)"
        )
        emit_estado_a_todos()


@socketio.on("jugador:respuesta_libre")
def on_jugador_respuesta_libre(data):
    if game_state.fase != "dilema" or game_state.dilema_actual != 6:
        return
    texto = str(data.get("texto", ""))
    ok = game_state.registrar_respuesta_libre(request.sid, texto)
    if ok:
        emit_estado_a_todos()


# ---------------------------------------------------------------------------
# Eventos SocketIO — proyector
# ---------------------------------------------------------------------------

@socketio.on("proyector:iniciar_partida")
def on_proyector_iniciar_partida():
    if game_state.fase != "lobby":
        return
    run_id = game_state._run_id
    print("[GAME] Partida iniciada")
    socketio.start_background_task(run_game_loop, run_id)


@socketio.on("presentador:avanzar")
def on_presentador_avanzar():
    # Acepta avance desde teclado del proyector o botón del cel del presentador.
    game_state.solicitar_avance()
    print("[GAME] Avance solicitado por el presentador")


@socketio.on("proyector:registrar")
def on_proyector_registrar():
    proyector_sids.add(request.sid)
    print(f"[GAME] Proyector registrado: {request.sid}")


@socketio.on("admin:activar_prueba")
def on_admin_activar_prueba(data):
    if game_state.fase != "lobby":
        emit("admin:error", {"mensaje": "Solo puedes activar el modo prueba desde el lobby."})
        return

    n = max(1, min(10, int(data.get("n", 5))))
    from fake_players import generar_jugadores_fake

    # Limpiar fakes previos
    for sid in game_state.jugadores_fake:
        game_state.jugadores.pop(sid, None)
    game_state.jugadores_fake.clear()

    perfiles = generar_jugadores_fake(n)
    for perfil in perfiles:
        game_state.agregar_jugador_fake(perfil)

    game_state.modo_prueba = True
    total = sum(1 for j in game_state.jugadores.values() if j["conectado"])
    print(f"[PRUEBA] Modo prueba activado: {n} jugadores fake (total conectados: {total})")
    emit_estado_a_todos()
    emit("admin:estado_prueba", {"activo": True, "n": n})


@socketio.on("admin:desactivar_prueba")
def on_admin_desactivar_prueba():
    for sid in game_state.jugadores_fake:
        game_state.jugadores.pop(sid, None)
    game_state.jugadores_fake.clear()
    game_state.modo_prueba = False
    print("[PRUEBA] Modo prueba desactivado")
    emit_estado_a_todos()
    emit("admin:estado_prueba", {"activo": False, "n": 0})


@socketio.on("proyector:reset")
def on_proyector_reset():
    game_state.reset()
    print("[GAME] Estado reseteado a lobby")
    emit_estado_a_todos()


# ---------------------------------------------------------------------------
# Arranque
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print()
    print("=" * 60)
    print("  El peso de las razones — Servidor de exposición")
    print("=" * 60)
    print(f"  Proyector : http://localhost:5000/proyector")
    print(f"  Jugadores : {URL_JUGADOR}")
    print()
    print("  NOTA WSL: si los celulares no alcanzan esa IP, pon")
    print("  IP_OVERRIDE en .env con la IP de Windows (ipconfig).")
    print("=" * 60)
    print()

    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
