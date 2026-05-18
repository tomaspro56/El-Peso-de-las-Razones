import random
import re

from dilemas import DILEMAS


ALLOW_VOTE_CHANGE = False  # Si True, los jugadores pueden cambiar su voto


class GameState:
    def __init__(self):
        # Incrementado en cada reset; los loops de background lo comprueban para salir.
        self._run_id: int = 0

        self.fase: str = "lobby"          # lobby | dilema | resultados | terminado
        self.dilema_actual: int = 0       # 0 = ninguno, 1-6 = dilema activo
        self.jugadores: dict = {}         # sid -> {jugador_id, conectado, voto_actual, ...}
        self.votos_por_dilema: dict = {}  # dilema_num -> {"A": int, "B": int}
        self.votos_individuales: dict = {}# jugador_id -> {dilema_num: opcion}
        self.respuestas_libres: list = []
        self.timer_restante: int = 0
        self.prediccion_dilema5: dict | None = None
        self.avanzar_solicitado: bool = False
        self.modo_prueba: bool = False
        self.jugadores_fake: list = []    # lista de fake sids activos

    # ------------------------------------------------------------------
    # Gestión de jugadores
    # ------------------------------------------------------------------

    def agregar_jugador(self, sid: str) -> str:
        ids_existentes = {j["jugador_id"] for j in self.jugadores.values()}
        while True:
            jugador_id = "Jugador-" + "".join(random.choices("0123456789ABCDEF", k=4))
            if jugador_id not in ids_existentes:
                break

        self.jugadores[sid] = {
            "jugador_id": jugador_id,
            "conectado": True,
            "voto_actual": None,
        }
        self.votos_individuales.setdefault(jugador_id, {})
        return jugador_id

    def eliminar_jugador(self, sid: str) -> None:
        if sid in self.jugadores:
            self.jugadores[sid]["conectado"] = False

    def agregar_jugador_fake(self, perfil: dict) -> tuple[str, str]:
        """Agrega un jugador virtual. Devuelve (fake_sid, jugador_id)."""
        nombre = perfil.get("nombre", "Fake")
        base_id = f"Fake-{nombre.split()[0]}"
        ids_existentes = {j["jugador_id"] for j in self.jugadores.values()}
        jugador_id = base_id
        suffix = 2
        while jugador_id in ids_existentes:
            jugador_id = f"{base_id}{suffix}"
            suffix += 1

        fake_sid = f"__fake__{jugador_id}_{random.randint(1000, 9999)}"
        self.jugadores[fake_sid] = {
            "jugador_id": jugador_id,
            "conectado": True,
            "voto_actual": None,
            "fake": True,
            "perfil": perfil,
        }
        self.votos_individuales.setdefault(jugador_id, {})
        self.jugadores_fake.append(fake_sid)
        return fake_sid, jugador_id

    def es_fake(self, sid: str) -> bool:
        return self.jugadores.get(sid, {}).get("fake", False)

    # ------------------------------------------------------------------
    # Flujo del juego
    # ------------------------------------------------------------------

    def iniciar_dilema(self, num: int) -> None:
        self.fase = "dilema"
        self.dilema_actual = num
        self.timer_restante = 0
        for j in self.jugadores.values():
            j["voto_actual"] = None
        self.votos_por_dilema[num] = {"A": 0, "B": 0}

    def terminar_dilema(self) -> None:
        self.fase = "resultados"
        self.timer_restante = 0

    def solicitar_avance(self) -> None:
        self.avanzar_solicitado = True

    def pasar_a_siguiente(self) -> None:
        siguiente = self.dilema_actual + 1
        if siguiente > 6:
            self.fase = "terminado"
        else:
            self.iniciar_dilema(siguiente)

    # ------------------------------------------------------------------
    # Votos
    # ------------------------------------------------------------------

    def registrar_voto(self, sid: str, opcion: str) -> bool:
        if sid not in self.jugadores:
            return False
        if opcion not in ("A", "B"):
            return False

        jugador = self.jugadores[sid]
        jugador_id = jugador["jugador_id"]
        num = self.dilema_actual

        ya_voto = num in self.votos_individuales.get(jugador_id, {})
        if ya_voto and not ALLOW_VOTE_CHANGE:
            return False

        # Si cambia el voto, descontar el anterior
        if ya_voto and ALLOW_VOTE_CHANGE:
            voto_anterior = self.votos_individuales[jugador_id][num]
            self.votos_por_dilema[num][voto_anterior] -= 1

        jugador["voto_actual"] = opcion
        self.votos_por_dilema.setdefault(num, {"A": 0, "B": 0})[opcion] += 1
        self.votos_individuales.setdefault(jugador_id, {})[num] = opcion
        return True

    def registrar_respuesta_libre(self, sid: str, texto: str) -> bool:
        if sid not in self.jugadores:
            return False
        texto = re.sub(r"<[^>]+>", "", texto).strip()[:200]
        if not texto:
            return False
        self.respuestas_libres.append(texto)
        self.jugadores[sid]["voto_actual"] = "LIBRE"
        jugador_id = self.jugadores[sid]["jugador_id"]
        self.votos_individuales.setdefault(jugador_id, {})[self.dilema_actual] = "LIBRE"
        return True

    def todos_votaron(self) -> bool:
        conectados = [j for j in self.jugadores.values() if j["conectado"]]
        if not conectados:
            return False
        return all(j["voto_actual"] is not None for j in conectados)

    # ------------------------------------------------------------------
    # Motor de predicción — Dilema 5
    # ------------------------------------------------------------------

    def calcular_prediccion_d5(self) -> dict:
        elegibles = [
            jid for jid, votos in self.votos_individuales.items()
            if 1 in votos and 2 in votos and 3 in votos
        ]

        if len(elegibles) < 3:
            return {
                "prediccion": "A",
                "porcentaje": 50.0,
                "explicacion": (
                    "Datos insuficientes para una predicción fiable "
                    "(necesitamos al menos 3 jugadores con los 3 primeros dilemas votados). "
                    "Predicción neutral: 50% A / 50% B."
                ),
            }

        pred_a = 0
        pred_b = 0
        for jid in elegibles:
            votos = self.votos_individuales[jid]
            score = (
                (1 if votos.get(1) == "A" else 0)
                + (1 if votos.get(2) == "A" else 0)
                + (1 if votos.get(3) == "A" else 0)
            )
            if score >= 2:
                pred_a += 1
            else:
                pred_b += 1

        total = pred_a + pred_b
        if pred_a >= pred_b:
            prediccion = "A"
            porcentaje = round(pred_a / total * 100, 1)
            texto_opcion = "Acepto"
        else:
            prediccion = "B"
            porcentaje = round(pred_b / total * 100, 1)
            texto_opcion = "No acepto"

        return {
            "prediccion": prediccion,
            "porcentaje": porcentaje,
            "explicacion": (
                f"Basado en los patrones de los dilemas 1-3, predecimos que el "
                f"{porcentaje}% del salón elegirá '{texto_opcion}'."
            ),
        }

    # ------------------------------------------------------------------
    # Snapshot para clientes
    # ------------------------------------------------------------------

    def snapshot_estado(self) -> dict:
        conectados = sum(1 for j in self.jugadores.values() if j["conectado"])
        dilema_info = DILEMAS[self.dilema_actual - 1] if self.dilema_actual > 0 else None

        return {
            "fase": self.fase,
            "dilema_actual": self.dilema_actual,
            "num_jugadores": conectados,
            "votos": self.votos_por_dilema.get(self.dilema_actual, {}),
            "timer_restante": self.timer_restante,
            "respuestas_libres": self.respuestas_libres if self.dilema_actual == 6 else [],
            "prediccion_dilema5": self.prediccion_dilema5,
            "dilema_info": dilema_info,
            "modo_prueba": self.modo_prueba,
        }

    def snapshot_estado_para(self, sid: str) -> dict:
        """Snapshot personalizado para un sid: incluye tu_voto para ese jugador."""
        base = self.snapshot_estado()
        tu_voto = None
        if sid in self.jugadores:
            jugador_id = self.jugadores[sid]["jugador_id"]
            tu_voto = self.votos_individuales.get(jugador_id, {}).get(self.dilema_actual)
        base["tu_voto"] = tu_voto
        return base

    # ------------------------------------------------------------------

    def reset(self) -> None:
        self._run_id += 1
        self.fase = "lobby"
        self.dilema_actual = 0
        self.jugadores = {}
        self.jugadores_fake = []
        self.votos_por_dilema = {}
        self.votos_individuales = {}
        self.respuestas_libres = []
        self.timer_restante = 0
        self.prediccion_dilema5 = None
        self.avanzar_solicitado = False
        self.modo_prueba = False
