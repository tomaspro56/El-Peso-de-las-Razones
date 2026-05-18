DILEMAS = [
    {
        "id": 1,
        "tipo": "binario",
        "titulo": "I · El tranvía",
        "enunciado": (
            "Un tranvía sin frenos avanza hacia cinco personas que morirán si no haces nada. "
            "Puedes accionar una palanca que lo desvía a otra vía, donde hay una sola persona. "
            "¿Accionas la palanca?"
        ),
        "opciones": [
            {"id": "A", "texto": "Acciono la palanca"},
            {"id": "B", "texto": "No acciono"},
        ],
        "nota_logica": "Cálculo utilitarista: minimizar(víctimas) → 1 < 5",
        "comentario_filosofico": (
            "Este es el dilema más estudiado en filosofía moral del siglo XX. "
            "Lo planteó Philippa Foot en 1967. La mayoría de personas acciona la palanca."
        ),
    },
    {
        "id": 2,
        "tipo": "binario",
        "titulo": "II · El puente",
        "enunciado": (
            "Mismo tranvía, mismas cinco personas. Ahora estás en un puente sobre la vía. "
            "A tu lado hay un hombre muy grande. La única forma de detener el tranvía es empujarlo "
            "a las vías. Su cuerpo lo detendrá. ¿Lo empujas?"
        ),
        "opciones": [
            {"id": "A", "texto": "Lo empujo"},
            {"id": "B", "texto": "No lo empujo"},
        ],
        "nota_logica": "Lógicamente equivalente al anterior: ∃x(muerte(x) → salvación(5)). Pero el resultado cambia.",
        "comentario_filosofico": (
            "Matemáticamente es idéntico al dilema anterior: uno muere, cinco viven. "
            "Pero algo en nosotros se resiste. Kant diría que aquí estás usando a una persona "
            "como medio, no como fin. La lógica formal y la moral humana no siempre coinciden."
        ),
    },
    {
        "id": 3,
        "tipo": "binario",
        "titulo": "III · El botón universal",
        "enunciado": (
            "Imagina un botón. Si lo presionas, TODOS los criminales del mundo serán castigados "
            "justamente. Pero ALGUNOS inocentes también serán castigados por error. No sabes cuántos. "
            "¿Presionas?"
        ),
        "opciones": [
            {"id": "A", "texto": "Presiono"},
            {"id": "B", "texto": "No presiono"},
        ],
        "nota_logica": "∀x(criminal(x) → castigo(x)) ∧ ∃y(inocente(y) ∧ castigo(y))",
        "comentario_filosofico": (
            "Esto es lógica de predicados aplicada a la moral. El cuantificador universal ∀ promete "
            "justicia perfecta. El cuantificador existencial ∃ recuerda que basta un inocente para "
            "que el sistema sea injusto. ¿Cuánto pesa cada uno?"
        ),
    },
    {
        "id": 4,
        "tipo": "binario",
        "titulo": "IV · La paradoja",
        "enunciado": (
            "Esta pregunta tiene dos opciones. La mayoría del salón va a elegir una de las dos. "
            "Tu tarea es elegir la opción que SERÁ LA MINORÍA. ¿Cuál escoges?"
        ),
        "opciones": [
            {"id": "A", "texto": "A"},
            {"id": "B", "texto": "B"},
        ],
        "nota_logica": "Proposición autorreferente. El tercer excluido (P ∨ ¬P) tambalea.",
        "comentario_filosofico": (
            "Si todos razonan así, no hay solución estable. Es el primo lógico de la paradoja "
            "del mentiroso. En 1931 Gödel demostró que en cualquier sistema lógico suficientemente "
            "potente hay verdades que no se pueden demostrar dentro del sistema. La lógica tiene grietas."
        ),
    },
    {
        "id": 5,
        "tipo": "binario_oculto",
        "titulo": "V · El trabajo soñado",
        "enunciado": (
            "Te ofrecen el trabajo perfecto. Alineado con tus valores, salario excelente, todo lo que "
            "quieres. Para aceptarlo debes mentir UNA sola vez a alguien que te quiere, sobre algo que "
            "nunca descubrirá. ¿Aceptas?"
        ),
        "opciones": [
            {"id": "A", "texto": "Acepto"},
            {"id": "B", "texto": "No acepto"},
        ],
        "nota_logica": "Predicción basada en correlación con dilemas 1-3: utilitaristas tienden a aceptar.",
        "comentario_filosofico": (
            "Si pudimos predecir cómo iba a votar el salón antes de mostrarles el dilema, no fue magia. "
            "Fue el principio de razón suficiente en acción: cada decisión que tomaste antes determinó "
            "parcialmente esta. Leibniz tenía razón."
        ),
    },
    {
        "id": 6,
        "tipo": "texto_libre",
        "titulo": "VI · La única libertad",
        "enunciado": (
            "Escribe en una frase corta una decisión que vas a tomar esta semana que NINGUNA ley lógica, "
            "NINGÚN principio filosófico, y NINGUNA app pueda predecir."
        ),
        "opciones": None,
        "nota_logica": None,
        "comentario_filosofico": (
            "Tal vez no podemos elegir la respuesta, pero podemos formular preguntas que nadie nos puso "
            "enfrente. En esa formulación está, quizás, lo que llamamos libertad."
        ),
    },
]
