'use strict';

/* ======================================================================
   CONSTANTES Y ESTADO GLOBAL
   ====================================================================== */

const RESULTADOS_DURACION = 15;

const IMAGENES_DILEMA = {
  1: '/static/img/dilema1.jpeg',
  2: '/static/img/dilema2.jpeg',
  3: '/static/img/dilema3.jpeg',
  5: '/static/img/dilema5.jpeg',
};

const imagenesDisponibles = {};

function precargarImagenes() {
  for (const [num, url] of Object.entries(IMAGENES_DILEMA)) {
    const n = Number(num);
    imagenesDisponibles[n] = false;
    const img = new Image();
    img.onload  = () => { imagenesDisponibles[n] = true; };
    img.onerror = () => { imagenesDisponibles[n] = false; };
    img.src = url;
  }
}

const SONIDOS = {
  ambient: '/static/sounds/ambient.mp3',
  tick:    '/static/sounds/tick.mp3',
  reveal:  '/static/sounds/reveal.mp3',
  result:  '/static/sounds/result.mp3',
};

const VOLUMENES = { ambient: 0.22, tick: 0.30, reveal: 0.15, result: 0.35 };

const sonidosDisponibles = { ambient: false, tick: false, reveal: false, result: false };

let estadoActual        = null;   // último snapshot del servidor
let faseActualKey       = 'lobby';// clave de la pantalla visible ahora
let prevDilemaNum       = 0;      // para detectar cambio de dilema (typewriter)
let prediccionTerminada = true;   // false mientras dura la pantalla D5
let estadoPendienteD5   = null;   // estado recibido durante revelación D5
let transicionId        = 0;      // BUG 2: abortar transiciones obsoletas
let muteado             = localStorage.getItem('proyector-muted') === 'true';
let resultadosInterval  = null;   // countdown en fase resultados
let audioDesbloqueado   = false;  // true tras la primera interacción del usuario
let revealActivo        = null;   // instancia Audio del reveal en curso
let tickActivo          = null;   // instancia del tick actualmente sonando (evita solapamiento)
const respuestasMostradas = new Set(); // evita duplicar respuestas libres
const twTokens          = new Map();  // element → cancel token para typewriter

// Elemento de audio ambient (loop permanente)
const audioAmbient = document.createElement('audio');
audioAmbient.id      = 'audio-ambient';
audioAmbient.loop    = true;
audioAmbient.preload = 'auto';
audioAmbient.src     = SONIDOS.ambient;
audioAmbient.volume  = muteado ? 0 : VOLUMENES.ambient;
document.body.appendChild(audioAmbient);

/* ======================================================================
   SONIDO
   ====================================================================== */

async function precargarSonidos() {
  for (const [nombre, url] of Object.entries(SONIDOS)) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      sonidosDisponibles[nombre] = r.ok;
    } catch {
      sonidosDisponibles[nombre] = false;
    }
  }
}

/** Interpola el volumen de audioEl linealmente de `desde` a `hasta` en duracionMs. */
function fadeVolumen(audioEl, desde, hasta, duracionMs) {
  const pasos = Math.ceil(duracionMs / 50);
  const delta = (hasta - desde) / pasos;
  let actual = desde;
  audioEl.volume = Math.max(0, Math.min(1, desde));
  let i = 0;
  const interval = setInterval(() => {
    i++;
    actual += delta;
    audioEl.volume = Math.max(0, Math.min(1, actual));
    if (i >= pasos) {
      audioEl.volume = Math.max(0, Math.min(1, hasta));
      clearInterval(interval);
    }
  }, 50);
}

function reproducirTick() {
  if (!sonidosDisponibles.tick || muteado || !audioDesbloqueado) return;
  if (tickActivo && !tickActivo.paused && !tickActivo.ended) return;
  tickActivo = new Audio(SONIDOS.tick);
  tickActivo.volume = VOLUMENES.tick;
  tickActivo.addEventListener('ended', () => { tickActivo = null; });
  tickActivo.play().catch(() => { tickActivo = null; });
}

function detenerTodosLosTicks() {
  if (tickActivo) {
    try { tickActivo.pause(); tickActivo.currentTime = 0; } catch(e) {}
    tickActivo = null;
  }
}

function reproducirReveal() {
  if (!sonidosDisponibles.reveal || muteado || !audioDesbloqueado) return;
  detenerReveal();
  revealActivo = new Audio(SONIDOS.reveal);
  revealActivo.volume = VOLUMENES.reveal;
  revealActivo.play().catch(() => {});
  setTimeout(() => detenerReveal(), 7500);
}

function detenerReveal() {
  if (revealActivo) {
    try { revealActivo.pause(); revealActivo.currentTime = 0; } catch(e) {}
    revealActivo = null;
  }
}

function reproducirOneShot(nombre) {
  if (!sonidosDisponibles[nombre] || muteado || !audioDesbloqueado) return;
  const a = new Audio(SONIDOS[nombre]);
  a.volume = VOLUMENES[nombre];
  a.play().catch(() => {});
}

function iniciarAmbient() {
  if (!sonidosDisponibles.ambient || muteado) return;
  audioAmbient.volume = VOLUMENES.ambient;
  audioAmbient.play().catch(() => {});
}

/** Intenta desbloquear el audio en la primera interacción del usuario. */
function desbloquearAudio() {
  if (audioDesbloqueado) return;
  audioDesbloqueado = true;

  const aviso = document.getElementById('aviso-audio');
  if (aviso) aviso.hidden = true;

  iniciarAmbient();
}

// Escuchar la primera interacción en toda la página
['click', 'keydown'].forEach(evt =>
  document.addEventListener(evt, desbloquearAudio, { once: false })
);

/* ======================================================================
   UTILIDADES
   ====================================================================== */

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Efecto de máquina de escribir. Cancela cualquier animación previa en el mismo elemento. */
function typewriter(el, texto, delayMs = 30) {
  const existing = twTokens.get(el);
  if (existing) existing.cancelled = true;

  const token = { cancelled: false };
  twTokens.set(el, token);

  el.textContent = '';
  let i = 0;

  const tick = () => {
    if (token.cancelled) { twTokens.delete(el); return; }
    if (i < texto.length) {
      el.textContent += texto[i++];
      setTimeout(tick, delayMs);
    } else {
      twTokens.delete(el);
    }
  };
  setTimeout(tick, delayMs);
}

/** Aplica o limpia la imagen de fondo en el contenedor dado.
 *  recortada=true → imagen en parte superior, enunciado sobre negro (fase dilema).
 *  recortada=false → imagen cubre todo el fondo (fase resultados). */
function aplicarImagenFondo(bgEl, imgEl, dilemaNum, recortada = false) {
  const url = IMAGENES_DILEMA[dilemaNum];
  const parent = bgEl ? bgEl.parentElement : null;

  if (url && imagenesDisponibles[dilemaNum]) {
    imgEl.src = url;
    imgEl.classList.remove('visible');
    bgEl.hidden = false;
    bgEl.classList.toggle('imagen-recortada', recortada);
    if (parent && parent.classList.contains('dilema-centro')) {
      parent.classList.toggle('con-imagen', recortada);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => imgEl.classList.add('visible')));
  } else {
    imgEl.classList.remove('visible');
    bgEl.hidden = true;
    imgEl.src = '';
    bgEl.classList.remove('imagen-recortada');
    if (parent && parent.classList.contains('dilema-centro')) {
      parent.classList.remove('con-imagen');
    }
  }
}

/* ======================================================================
   REFERENCIAS DOM
   ====================================================================== */

// Fases
const FASES = {
  lobby:      document.getElementById('fase-lobby'),
  prediccion: document.getElementById('fase-prediccion'),
  dilema:     document.getElementById('fase-dilema'),
  libre:      document.getElementById('fase-libre'),
  resultados: document.getElementById('fase-resultados'),
  terminado:  document.getElementById('fase-terminado'),
};

// Lobby
const lobbyContador = document.getElementById('lobby-contador');
const btnIniciar    = document.getElementById('btn-iniciar');

// Dilema binario
const dilemaTituloBar = document.getElementById('dilema-titulo-bar');
const timerWrap       = document.getElementById('timer-wrap');
const timerNum        = document.getElementById('timer-num');
const enunciadoTexto  = document.getElementById('enunciado-texto');
const cajaA           = document.getElementById('caja-a');
const cajaB           = document.getElementById('caja-b');
const textoA          = document.getElementById('texto-a');
const textoB          = document.getElementById('texto-b');
const barraA          = document.getElementById('barra-a');
const barraB          = document.getElementById('barra-b');
const votosA          = document.getElementById('votos-a');
const votosB          = document.getElementById('votos-b');
const votosContador   = document.getElementById('votos-contador');

// Dilema libre (6)
const libreTituloBar   = document.getElementById('libre-titulo-bar');
const libreTimerWrap   = document.getElementById('libre-timer-wrap');
const libreTimerNum    = document.getElementById('libre-timer-num');
const libreEnunciado   = document.getElementById('libre-enunciado');
const respuestasContenedor = document.getElementById('respuestas-contenedor');
const libreContador    = document.getElementById('libre-contador');

// Predicción D5
const predLinea1 = document.getElementById('pred-linea1');
const predLinea2 = document.getElementById('pred-linea2');
const predLinea3 = document.getElementById('pred-linea3');
const predLinea4 = document.getElementById('pred-linea4');

// Resultados
const resultadosTitulo = document.getElementById('resultados-titulo');
const resBarra = { a: document.getElementById('res-barra-a'), b: document.getElementById('res-barra-b') };
const resPct   = { a: document.getElementById('res-pct-a'),   b: document.getElementById('res-pct-b') };
const resTexto = { a: document.getElementById('res-texto-a'), b: document.getElementById('res-texto-b') };
const notaLogicaTexto  = document.getElementById('nota-logica-texto');
const bloqueNotaLogica = document.getElementById('bloque-nota-logica');
const reflexionTexto   = document.getElementById('reflexion-texto');
const siguienteCountdown = document.getElementById('siguiente-countdown');

// Terminado
const finTitulo  = document.getElementById('fin-titulo');
const finGracias = document.getElementById('fin-gracias');
const finCita    = document.getElementById('fin-cita');

// Controles
const btnMute  = document.getElementById('btn-mute');
const btnReset = document.getElementById('btn-reset');

/* ======================================================================
   MÁQUINA DE ESTADOS — clave de pantalla
   ====================================================================== */

/**
 * Mapea (fase, dilema_actual) a la clave de sección HTML.
 * 'prediccion' no se computa aquí: lo dispara el evento especial D5.
 */
function computarKey(estado) {
  if (!estado) return 'lobby';
  switch (estado.fase) {
    case 'lobby':      return 'lobby';
    case 'terminado':  return 'terminado';
    case 'dilema':     return estado.dilema_actual === 6 ? 'libre' : 'dilema';
    case 'resultados': return 'resultados';
    default:           return 'lobby';
  }
}

/**
 * Transiciona a nuevaKey con fade-out/fade-in (300ms c/u).
 * Si la clave no cambia, solo actualiza el contenido.
 */
async function cambiarFase(nuevaKey, estado) {
  const miId = ++transicionId;

  if (nuevaKey === faseActualKey) {
    actualizarContenido(nuevaKey, estado);
    return;
  }

  if (faseActualKey === 'resultados') clearInterval(resultadosInterval);

  // Cancelar cualquier typewriter activo
  for (const token of twTokens.values()) token.cancelled = true;
  twTokens.clear();

  const elActual = FASES[faseActualKey];
  if (elActual) {
    elActual.classList.remove('activa');
    await sleep(300);
  }

  // Abortar si una transición más reciente ya tomó el control
  if (transicionId !== miId) return;

  renderFase(nuevaKey, estado);

  const elNuevo = FASES[nuevaKey];
  if (elNuevo) elNuevo.classList.add('activa');

  faseActualKey = nuevaKey;
  actualizarHint();
}

/* ======================================================================
   RENDERERS
   ====================================================================== */

function renderFase(key, estado) {
  switch (key) {
    case 'lobby':      renderLobby(estado);      break;
    case 'dilema':     renderDilema(estado);     break;
    case 'libre':      renderLibre(estado);      break;
    case 'resultados': renderResultados(estado); break;
    case 'terminado':  renderTerminado();        break;
    // 'prediccion' se maneja aparte en mostrarPrediccionD5
  }
}

/** Actualiza datos en la fase ya visible (sin transición). */
function actualizarContenido(key, estado) {
  switch (key) {
    case 'lobby':  actualizarLobby(estado);  break;
    case 'dilema': actualizarDilema(estado); break;
    case 'libre':  actualizarLibre(estado);  break;
    // resultados no se actualiza en tiempo real
  }
}

/* --- LOBBY --- */

function renderLobby(estado) { actualizarLobby(estado); }

function actualizarLobby(estado) {
  const n = estado ? estado.num_jugadores : 0;
  lobbyContador.textContent = n === 1 ? '1 jugador conectado' : `${n} jugadores conectados`;
  btnIniciar.hidden = n < 1;

  const badge = document.getElementById('modo-prueba-badge');
  if (badge) badge.hidden = !(estado && estado.modo_prueba);
}

/* --- DILEMA BINARIO --- */

function renderDilema(estado) {
  const info = estado && estado.dilema_info;
  if (!info) return;

  dilemaTituloBar.textContent = info.titulo;
  textoA.textContent = info.opciones[0].texto;
  textoB.textContent = info.opciones[1].texto;

  // Resetear UI de votos
  barraA.style.width = '0%';
  barraB.style.width = '0%';
  votosA.textContent = '0';
  votosB.textContent = '0';
  cajaA.classList.remove('ganador');
  cajaB.classList.remove('ganador');
  votosContador.textContent = '';

  // Timer inicial
  timerNum.textContent = estado.timer_restante || '—';
  timerWrap.classList.remove('timer-urgente', 'timer-critico');
  enunciadoTexto.classList.remove('enunciado-shake');

  // Imagen de fondo — recortada: visible en parte superior, enunciado sobre negro
  aplicarImagenFondo(
    document.getElementById('dilema-bg'),
    document.getElementById('dilema-bg-img'),
    estado.dilema_actual,
    true
  );

  // Typewriter solo cuando cambia el número de dilema
  if (estado.dilema_actual !== prevDilemaNum) {
    prevDilemaNum = estado.dilema_actual;
    typewriter(enunciadoTexto, info.enunciado, 28);
  } else {
    enunciadoTexto.textContent = info.enunciado;
  }

  actualizarDilema(estado);
}

function actualizarDilema(estado) {
  const votos = estado.votos || {};
  const numA = votos.A || 0;
  const numB = votos.B || 0;
  const total = numA + numB;

  // Ocultar barras, números y ganador durante la votación (anti-sugestión)
  barraA.style.width = '0%';
  barraB.style.width = '0%';
  votosA.textContent = '';
  votosB.textContent = '';
  cajaA.classList.remove('ganador');
  cajaB.classList.remove('ganador');

  const conectados = estado.num_jugadores || 0;
  votosContador.textContent = `${total} de ${conectados} han votado`;
}

/* --- DILEMA LIBRE (6) --- */

function renderLibre(estado) {
  const info = estado && estado.dilema_info;
  if (!info) return;

  libreTituloBar.textContent = info.titulo;

  if (estado.dilema_actual !== prevDilemaNum) {
    prevDilemaNum = estado.dilema_actual;
    typewriter(libreEnunciado, info.enunciado, 28);
  } else {
    libreEnunciado.textContent = info.enunciado;
  }

  // Limpiar respuestas anteriores al entrar en esta fase
  respuestasMostradas.clear();
  respuestasContenedor.innerHTML = '';

  actualizarLibre(estado);
}

function actualizarLibre(estado) {
  const respuestas = estado.respuestas_libres || [];
  const esperandoMsg = document.getElementById('libre-espera-msg');

  for (const texto of respuestas) {
    if (!respuestasMostradas.has(texto) && respuestasContenedor.children.length < 30) {
      respuestasMostradas.add(texto);
      agregarRespuestaLibre(texto);
    }
  }

  if (esperandoMsg) esperandoMsg.style.display = respuestas.length === 0 ? '' : 'none';

  libreContador.textContent = `${respuestas.length} respuesta${respuestas.length !== 1 ? 's' : ''}`;

  if (typeof estado.timer_restante === 'number') {
    libreTimerNum.textContent = estado.timer_restante || '—';
  }
}

function agregarRespuestaLibre(texto) {
  const el = document.createElement('p');
  el.className = 'respuesta-libre';
  const size   = (1.2 + Math.random() * 0.8).toFixed(2);
  const rotate = ((Math.random() * 6) - 3).toFixed(1);
  el.style.fontSize = `${size}rem`;
  el.style.setProperty('--rotate', `${rotate}deg`);
  el.textContent = `"${texto}"`;
  respuestasContenedor.appendChild(el);
  // doble rAF: asegura que el browser aplica estado inicial antes de la transición
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
}

/* --- RESULTADOS --- */

function renderResultados(estado) {
  const info  = estado && estado.dilema_info;
  const votos = estado ? (estado.votos || {}) : {};
  if (!info) return;

  resultadosTitulo.textContent = `Resultados — ${info.titulo}`;

  // Imagen de fondo — completa: cubre toda la sección con overlay oscuro
  aplicarImagenFondo(
    document.getElementById('res-bg'),
    document.getElementById('res-bg-img'),
    estado.dilema_actual,
    false
  );

  // Enunciado del dilema para que la audiencia lo relea
  const resEnunciado = document.getElementById('res-enunciado');
  if (resEnunciado) resEnunciado.textContent = info.enunciado || '';

  const resBinarioWrap = document.getElementById('res-binario-wrap');
  const resLibreWrap   = document.getElementById('res-libre-wrap');

  if (info.tipo === 'texto_libre') {
    resBinarioWrap.style.display = 'none';
    resLibreWrap.style.display   = '';

    const resLibreRespuestas = document.getElementById('res-libre-respuestas');
    resLibreRespuestas.innerHTML = '';
    for (const texto of (estado.respuestas_libres || [])) {
      const el = document.createElement('p');
      el.className = 'respuesta-libre-estatica';
      el.textContent = `"${texto}"`;
      resLibreRespuestas.appendChild(el);
    }
  } else {
    resBinarioWrap.style.display = '';
    resLibreWrap.style.display   = 'none';

    if (info.opciones) {
      resTexto.a.textContent = info.opciones[0].texto;
      resTexto.b.textContent = info.opciones[1].texto;
    }

    const numA  = votos.A || 0;
    const numB  = votos.B || 0;
    const total = numA + numB;
    const pctA  = total > 0 ? Math.round(numA / total * 100) : 0;
    const pctB  = total > 0 ? Math.round(numB / total * 100) : 0;

    resBarra.a.style.width = '0%';
    resBarra.b.style.width = '0%';
    resPct.a.textContent = '0%';
    resPct.b.textContent = '0%';

    setTimeout(() => {
      resBarra.a.style.width = `${pctA}%`;
      resBarra.b.style.width = `${pctB}%`;
      resPct.a.textContent = `${pctA}%`;
      resPct.b.textContent = `${pctB}%`;
    }, 150);
  }

  if (info.nota_logica) {
    notaLogicaTexto.textContent = info.nota_logica;
    bloqueNotaLogica.style.display = '';
  } else {
    bloqueNotaLogica.style.display = 'none';
  }
  reflexionTexto.textContent = info.comentario_filosofico;

  siguienteCountdown.textContent = '';
}

/* --- TERMINADO --- */

async function renderTerminado() {
  // Ocultar elementos; la sección ya se está haciendo visible (clase activa)
  [finTitulo, finGracias, finCita].forEach(el => {
    el.style.transition = 'none';
    el.style.opacity = '0';
  });
  // Esperar al fade-in de la sección (300ms) + pequeño margen
  await sleep(600);

  const aparece = async (el, ms = 1200) => {
    el.style.transition = `opacity ${ms}ms ease`;
    el.style.opacity = '1';
    await sleep(ms);
  };

  await aparece(finTitulo);
  await sleep(1000);
  await aparece(finGracias);
  await sleep(1000);
  await aparece(finCita);
}

/* ======================================================================
   HINT DEL PRESENTADOR
   ====================================================================== */

const hintEl = document.getElementById('hint-presentador');

function actualizarHint() {
  if (!hintEl) return;
  if (faseActualKey === 'resultados') {
    const es6 = estadoActual && estadoActual.dilema_actual === 6;
    hintEl.textContent = es6 ? '[ESPACIO] terminar' : '[ESPACIO] continuar';
    hintEl.classList.add('visible');
  } else if (faseActualKey === 'terminado') {
    hintEl.textContent = '[ESPACIO] reiniciar';
    hintEl.classList.add('visible');
  } else {
    hintEl.classList.remove('visible');
  }
}

/* ======================================================================
   PREDICCIÓN DILEMA 5
   ====================================================================== */

async function mostrarPrediccionD5(data) {
  const opcionTexto = data.prediccion === 'A' ? 'Acepto' : 'No acepto';
  const explicacion = data.explicacion.replace(/predecimos/gi, 'predigo');
  const seccion = FASES['prediccion'];

  // Limpiar estilos inline de ejecuciones anteriores
  if (seccion) { seccion.style.transition = ''; seccion.style.opacity = ''; }

  // Resetear todas las líneas
  [predLinea1, predLinea2, predLinea3, predLinea4].forEach(el => {
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.textContent = '';
  });
  await sleep(100);

  const mostrarLinea = (el, texto, fadeDur) => {
    el.textContent = texto;
    el.getBoundingClientRect(); // force reflow antes de la transición
    el.style.transition = `opacity ${fadeDur}ms ease`;
    el.style.opacity = '1';
  };

  // t≈0.1s — línea 1 (fade 0.6s)
  mostrarLinea(predLinea1, 'Antes de mostrarles el siguiente dilema…', 600);
  await sleep(1200);

  // t≈1.3s — línea 2 (fade 0.6s)
  mostrarLinea(predLinea2, 'déjenme adivinar.', 600);
  await sleep(1600);

  // t≈2.9s — línea 3 (fade 0.8s, más dramática)
  mostrarLinea(predLinea3, `Predigo que el ${data.porcentaje}% del salón elegirá: '${opcionTexto}'`, 800);
  await sleep(1200);

  // t≈4.1s — línea 4 (fade 0.6s)
  mostrarLinea(predLinea4, explicacion, 600);

  // t≈4.7s — todo visible; esperar lectura (~2.8s hasta t≈7.5s desde inicio de función)
  await sleep(2900);

  // t≈7.6s — fade-out de la sección completa (0.5s)
  if (seccion) {
    seccion.style.transition = 'opacity 0.5s ease';
    seccion.style.opacity = '0';
  }
  await sleep(500);
  // t≈8.1s — el backend ya inició dilema 5 (espera 8s desde el evento)
}

/* ======================================================================
   TIMER — actualiza el display y las clases de urgencia
   ====================================================================== */

function actualizarTimerDisplay(wrapEl, numEl, enunciadoEl, segundos) {
  numEl.textContent = segundos;

  wrapEl.classList.remove('timer-urgente', 'timer-critico');
  if (enunciadoEl) enunciadoEl.classList.remove('enunciado-shake');

  if (segundos <= 5) {
    wrapEl.classList.add('timer-urgente', 'timer-critico');
    if (enunciadoEl) enunciadoEl.classList.add('enunciado-shake');
  } else if (segundos <= 10) {
    wrapEl.classList.add('timer-urgente');
  }
}

/* ======================================================================
   SOCKET.IO — eventos del servidor
   ====================================================================== */

const socket = io();

socket.on('connect', () => {
  console.log('[Proyector] socket conectado');
  socket.emit('proyector:registrar');
});
socket.on('disconnect', () => console.log('[Proyector] socket desconectado'));

socket.on('estado:actualizado', async (estado) => {
  estadoActual = estado;

  if (estado.fase !== 'dilema') detenerTodosLosTicks();
  if (estado.fase === 'lobby') detenerReveal();

  // Si la revelación D5 sigue en pantalla, encolar el estado de dilema 5
  if (estado.fase === 'dilema' && estado.dilema_actual === 5 && !prediccionTerminada) {
    estadoPendienteD5 = estado;
    return;
  }

  await cambiarFase(computarKey(estado), estado);
});

socket.on('timer:tick', ({ restante }) => {
  if (estadoActual) estadoActual.timer_restante = restante;

  if (faseActualKey === 'dilema') {
    actualizarTimerDisplay(timerWrap, timerNum, enunciadoTexto, restante);
  } else if (faseActualKey === 'libre') {
    actualizarTimerDisplay(libreTimerWrap, libreTimerNum, null, restante);
  }

  if (restante <= 7 && restante >= 1) reproducirTick();
});

socket.on('dilema5:revelacion_prediccion', async (data) => {
  prediccionTerminada = false;

  // Duck ambient y reproducir reveal
  if (!muteado && audioDesbloqueado) {
    fadeVolumen(audioAmbient, VOLUMENES.ambient, 0.06, 800);
    reproducirReveal();
  }

  // Transición a la pantalla de predicción
  await cambiarFase('prediccion', null);
  await mostrarPrediccionD5(data);
  prediccionTerminada = true;

  // Restaurar ambient (la predicción duró ~8s; esperamos hasta t≈7.5s dentro de mostrarPrediccionD5)
  if (!muteado && audioDesbloqueado) {
    fadeVolumen(audioAmbient, audioAmbient.volume, VOLUMENES.ambient, 1500);
  }

  // Si el estado de dilema 5 llegó mientras mostrábamos la predicción, procesarlo ahora
  if (estadoPendienteD5) {
    const estado = estadoPendienteD5;
    estadoPendienteD5 = null;
    await cambiarFase(computarKey(estado), estado);
  }
});

socket.on('dilema:terminado', (payload) => {
  console.log(`[Proyector] Dilema ${payload.dilema} terminado:`, payload.votos);
  detenerTodosLosTicks();
  reproducirOneShot('result');
});

socket.on('partida:terminada', async (estado) => {
  estadoActual = estado;
  await cambiarFase('terminado', estado);
});

/* ======================================================================
   TECLADO — control del presentador
   ====================================================================== */

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code !== 'Space') return;
  e.preventDefault();

  if (faseActualKey === 'resultados') {
    socket.emit('presentador:avanzar');
  } else if (faseActualKey === 'terminado') {
    socket.emit('proyector:reset');
  }
});

/* ======================================================================
   BOTONES
   ====================================================================== */

btnIniciar.addEventListener('click', () => {
  socket.emit('proyector:iniciar_partida');
});

btnReset.addEventListener('click', () => {
  if (confirm('¿Reiniciar la exposición desde el principio?')) {
    prevDilemaNum = 0;
    respuestasMostradas.clear();
    socket.emit('proyector:reset');
  }
});

function aplicarMute() {
  btnMute.textContent = muteado ? '🔇' : '🔊';
  btnMute.title = muteado ? 'Activar sonido' : 'Silenciar';
  if (muteado) {
    audioAmbient.pause();
    audioAmbient.volume = 0;
    detenerReveal();
    detenerTodosLosTicks();
  } else {
    audioAmbient.volume = VOLUMENES.ambient;
    if (audioDesbloqueado) audioAmbient.play().catch(() => {});
  }
}

btnMute.addEventListener('click', () => {
  muteado = !muteado;
  localStorage.setItem('proyector-muted', muteado);
  aplicarMute();
});

// Estado inicial del botón mute (persistido en localStorage)
aplicarMute();

precargarSonidos();
precargarImagenes();
