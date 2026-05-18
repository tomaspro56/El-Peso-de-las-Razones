import random

PERFILES = [
    {"nombre": "Sofía M.",      "tendencia": "utilitarista"},
    {"nombre": "Carlos R.",     "tendencia": "utilitarista"},
    {"nombre": "Ana L.",        "tendencia": "utilitarista"},
    {"nombre": "Diego P.",      "tendencia": "utilitarista"},
    {"nombre": "María G.",      "tendencia": "kantiano"},
    {"nombre": "Lucas T.",      "tendencia": "kantiano"},
    {"nombre": "Valentina C.",  "tendencia": "kantiano"},
    {"nombre": "Andrés F.",     "tendencia": "kantiano"},
    {"nombre": "Camila R.",     "tendencia": "aleatorio"},
    {"nombre": "Sebastián V.",  "tendencia": "aleatorio"},
]

RESPUESTAS_LIBRES_FAKE = [
    "Dejar de mirar el teléfono antes de dormir.",
    "Llamar a mi abuela sin excusas.",
    "Ir al gimnasio aunque llueva.",
    "Leer algo que no me gusta para entenderlo.",
    "Decirle a alguien que me importa sin esperar el momento perfecto.",
    "Apagar las notificaciones por un día completo.",
    "Tomar una ruta diferente al trabajo.",
    "Escribir algo sin revisar si está bien escrito.",
    "Pedir perdón primero.",
    "No explicarme cuando no tengo que hacerlo.",
]

# Utilitaristas: maximizan bienestar → A en dilemas de salvar/castigar
# Kantianos: respetan deberes absolutos → B cuando se viola un deber
_PATRONES = {
    "utilitarista": {1: "A", 2: "A", 3: "A", 4: "A", 5: "A"},
    "kantiano":     {1: "A", 2: "B", 3: "B", 4: "B", 5: "B"},
}


def generar_jugadores_fake(n: int) -> list[dict]:
    """Devuelve n perfiles mezclados (con repetición si n > len(PERFILES))."""
    base = PERFILES * ((n // len(PERFILES)) + 1)
    seleccion = base[:n]
    return [dict(p) for p in seleccion]


def get_voto_fake(perfil: dict, dilema_num: int) -> str:
    tendencia = perfil.get("tendencia", "aleatorio")
    if tendencia == "aleatorio":
        return random.choice(["A", "B"])
    voto_patron = _PATRONES.get(tendencia, {}).get(dilema_num)
    if voto_patron is None:
        return random.choice(["A", "B"])
    # 15% de chance de romper el patrón (simula variabilidad humana)
    if random.random() < 0.15:
        return "B" if voto_patron == "A" else "A"
    return voto_patron


def get_respuesta_libre_fake() -> str:
    return random.choice(RESPUESTAS_LIBRES_FAKE)
