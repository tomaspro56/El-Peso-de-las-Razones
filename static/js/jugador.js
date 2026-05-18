'use strict';

/* ======================================================================
   ESTADO GLOBAL
   ====================================================================== */

let jugadorId          = null;   // asignado por el servidor al conectar
let estadoActual       = null;   // último snapshot del servidor (incluye tu_voto)
let faseActualKey      = 'lobby';// clave de la sección visible
let prevDilemaNum      = 0;      // para detectar cambio de dilema y deshabilitar botones
let botonesHabilitados = true;   // evitar tap residual entre dilemas

// Modo presentador: activado con ?p=1 en la URL, persistido en sessionStorage
const modoP = (() => {
  if (new URLSearchParams(location.search).get('p') === '1') {
    sessionStorage.setItem('modo-presentador', '1');
    return true;
  }
  return sessionStorage.getItem('modo-presentador') === '1';
})();

/* ======================================================================
   UTILIDADES
   ====================================================================== */

const sleep = ms => new Promise(r => setTimeout(r, ms));

const twTokens = new Map(); // element → cancel token para typewriter

/* ======================================================================
   REFERENCIAS DOM
   ====================================================================== */

const FASES = {
  lobby:     document.getElementById('fase-lobby'),
  dilema:    document.getElementById('fase-dilema'),
  votado:    document.getElementById('fase-votado'),
  libre:     document.getElementById('fase-libre'),
  enviado:   document.getElementById('fase-enviado'),
  resultados:document.getElementById('fase-resultados'),
  terminado: document.getElementById('fase-terminado'),
};

// Banner y ID fijo
const bannerDesconexion = document.getElementById('banner-desconexion');
const jugadorIdFijo     = document.getElementById('jugador-id-fijo');

// Lobby
const lobbyId = document.getElementById('lobby-id');

// Dilema
const dilTitulo  = document.getElementById('dil-titulo');
const dilTimer   = document.getElementById('dil-timer');
const dilTimerWrap = document.getElementById('dil-timer-wrap');
const dilEnunciado = document.getElementById('dil-enunciado');
const btnTextoA  = document.getElementById('btn-texto-a');
const btnTextoB  = document.getElementById('btn-texto-b');
const btnOpcionA = document.getElementById('btn-opcion-a');
const btnOpcionB = document.getElementById('btn-opcion-b');

// Votado
const votTitulo       = document.getElementById('vot-titulo');
const votTimer        = document.getElementById('vot-timer');
const votTimerWrap    = document.getElementById('vot-timer-wrap');
const votLetra        = document.getElementById('vot-letra');
const votTextoOpcion  = document.getElementById('vot-texto-opcion');

// Libre
const libTitulo    = document.getElementById('lib-titulo');
const libTimer     = document.getElementById('lib-timer');
const libTimerWrap = document.getElementById('lib-timer-wrap');
const libEnunciado = document.getElementById('lib-enunciado');
const libTextarea  = document.getElementById('lib-textarea');
const libChars     = document.getElementById('lib-chars');
const btnEnviar    = document.getElementById('btn-enviar');

// Enviado
const envTitulo = document.getElementById('env-titulo');

// Resultados
const resTitulo = document.getElementById('res-titulo');
const resBarra  = { a: document.getElementById('res-barra-a'), b: document.getElementById('res-barra-b') };
const resPct    = { a: document.getElementById('res-pct-a'),   b: document.getElementById('res-pct-b') };
const resMiVoto = { a: document.getElementById('res-mi-voto-a'), b: document.getElementById('res-mi-voto-b') };

// Terminado
const termId = document.getElementById('term-id');

/* ======================================================================
   HELPERS
   ====================================================================== */

/** Efecto de máquina de escribir. Cancela cualquier animación previa en el mismo elemento. */
function escribirTexto(elemento, texto, delayMs = 20) {
  const existing = twTokens.get(elemento);
  if (existing) existing.cancelled = true;

  const token = { cancelled: false };
  twTokens.set(elemento, token);

  elemento.textContent = '';
  let i = 0;

  const tick = () => {
    if (token.cancelled) { twTokens.delete(elemento); return; }
    if (i < texto.length) {
      elemento.textContent += texto[i++];
      setTimeout(tick, delayMs);
    } else {
      twTokens.delete(elemento);
    }
  };
  setTimeout(tick, delayMs);
}

function deshabilitarBotones(ms = 600) {
  botonesHabilitados = false;
  btnOpcionA.disabled = true;
  btnOpcionB.disabled = true;
  setTimeout(() => {
    botonesHabilitados = true;
    btnOpcionA.disabled = false;
    btnOpcionB.disabled = false;
  }, ms);
}

const panelPresentador = document.getElementById('panel-presentador');

function actualizarPanelPresentador() {
  if (!modoP || !panelPresentador) return;
  const fase = estadoActual && estadoActual.fase;
  panelPresentador.style.display = (fase === 'resultados' || fase === 'terminado') ? '' : 'none';
}

if (modoP && panelPresentador) {
  document.getElementById('btn-presentador-avanzar').addEventListener('click', () => {
    if (!estadoActual) return;
    if (estadoActual.fase === 'terminado') {
      socket.emit('proyector:reset');
    } else {
      socket.emit('presentador:avanzar');
    }
  });
}

/* ======================================================================
   MÁQUINA DE ESTADOS
   ====================================================================== */

/**
 * Deriva la pantalla a mostrar únicamente del snapshot del servidor.
 * tu_voto: null | "A" | "B" | "LIBRE" — enviado por el servidor para este jugador.
 */
function computarKey(estado) {
  if (!estado) return 'lobby';
  switch (estado.fase) {
    case 'lobby':      return 'lobby';
    case 'terminado':  return 'terminado';
    case 'resultados': return 'resultados';
    case 'dilema':
      if (estado.dilema_actual === 6) {
        return estado.tu_voto === 'LIBRE' ? 'enviado' : 'libre';
      }
      return (estado.tu_voto === 'A' || estado.tu_voto === 'B') ? 'votado' : 'dilema';
    default: return 'lobby';
  }
}

/**
 * Transiciona a nuevaKey con fade (200ms).
 * Si la clave no cambia, solo actualiza el contenido.
 */
async function cambiarFase(nuevaKey, estado) {
  if (nuevaKey === faseActualKey) {
    actualizarContenido(nuevaKey, estado);
    return;
  }

  const elActual = FASES[faseActualKey];
  if (elActual) {
    elActual.classList.remove('activa');
    await sleep(200);
  }

  renderFase(nuevaKey, estado);

  const elNuevo = FASES[nuevaKey];
  if (elNuevo) elNuevo.classList.add('activa');

  faseActualKey = nuevaKey;
}

/* ======================================================================
   RENDERERS
   ====================================================================== */

function renderFase(key, estado) {
  switch (key) {
    case 'lobby':      renderLobby(estado);      break;
    case 'dilema':     renderDilema(estado);     break;
    case 'votado':     renderVotado(estado);     break;
    case 'libre':      renderLibre(estado);      break;
    case 'enviado':    renderEnviado(estado);    break;
    case 'resultados': renderResultados(estado); break;
    case 'terminado':  renderTerminado();        break;
  }
}

/** Actualiza datos en la fase ya visible (sin transición). */
function actualizarContenido(key, estado) {
  // En ninguna fase del jugador hay actualizaciones "en vivo" complejas;
  // el único cambio relevante es el timer (se maneja en timer:tick).
}

/* --- LOBBY --- */
function renderLobby(estado) {
  // El lobby del jugador no necesita datos del servidor
}

/* --- DILEMA BINARIO --- */
function renderDilema(estado) {
  const info = estado && estado.dilema_info;
  if (!info) return;

  dilTitulo.textContent  = info.titulo;
  escribirTexto(dilEnunciado, info.enunciado, 20);
  btnTextoA.textContent  = info.opciones[0].texto;
  btnTextoB.textContent  = info.opciones[1].texto;

  // Mostrar timer actual
  dilTimer.textContent = estado.timer_restante || '—';
  dilTimerWrap.classList.remove('timer-urgente', 'timer-critico');
}

/* --- YA VOTASTE --- */
function renderVotado(estado) {
  const info = estado && estado.dilema_info;
  const voto = estado && estado.tu_voto;
  if (!info || !voto) return;

  votTitulo.textContent  = info.titulo;
  votTimer.textContent   = estado.timer_restante || '—';
  votTimerWrap.classList.remove('timer-urgente', 'timer-critico');
  votLetra.textContent   = voto;

  const opcion = info.opciones && info.opciones.find(o => o.id === voto);
  votTextoOpcion.textContent = opcion ? opcion.texto : '';
}

/* --- DILEMA LIBRE (6) --- */
function renderLibre(estado) {
  const info = estado && estado.dilema_info;
  if (!info) return;

  libTitulo.textContent = info.titulo;
  escribirTexto(libEnunciado, info.enunciado, 20);
  libTimer.textContent  = estado.timer_restante || '—';
  libTimerWrap.classList.remove('timer-urgente', 'timer-critico');

  // Limpiar textarea por si quedó texto de una sesión anterior
  libTextarea.value = '';
  libChars.textContent = '0';
}

/* --- YA ENVIÓ --- */
function renderEnviado(estado) {
  const info = estado && estado.dilema_info;
  envTitulo.textContent = info ? info.titulo : '';
}

/* --- RESULTADOS --- */
function renderResultados(estado) {
  const info  = estado && estado.dilema_info;
  const votos = estado ? (estado.votos || {}) : {};
  const numDilema = estado ? estado.dilema_actual : '';

  resTitulo.textContent = info ? `Resultados — ${info.titulo}` : `Resultados — Dilema ${numDilema}`;

  const resOpciones    = document.getElementById('res-opciones');
  const resGraciasLibre = document.getElementById('res-gracias-libre');

  if (info && info.tipo === 'texto_libre') {
    resOpciones.style.display    = 'none';
    resGraciasLibre.style.display = '';
    return;
  }

  resOpciones.style.display    = '';
  resGraciasLibre.style.display = 'none';

  const numA  = votos.A || 0;
  const numB  = votos.B || 0;
  const total = numA + numB;
  const pctA  = total > 0 ? Math.round(numA / total * 100) : 0;
  const pctB  = total > 0 ? Math.round(numB / total * 100) : 0;

  resBarra.a.style.width = '0%';
  resBarra.b.style.width = '0%';
  resPct.a.textContent = '—';
  resPct.b.textContent = '—';

  setTimeout(() => {
    resBarra.a.style.width = `${pctA}%`;
    resBarra.b.style.width = `${pctB}%`;
    resPct.a.textContent = `${pctA}%`;
    resPct.b.textContent = `${pctB}%`;
  }, 100);

  resMiVoto.a.textContent = '';
  resMiVoto.b.textContent = '';
  const tuVoto = estado && estado.tu_voto;
  if (tuVoto === 'A' || tuVoto === 'B') {
    resMiVoto[tuVoto.toLowerCase()].textContent = '← tu voto';
  }
}

/* --- TERMINADO --- */
function renderTerminado() {
  if (termId) termId.textContent = jugadorId || '';
}

/* ======================================================================
   TIMER — actualiza los tres posibles timers en paralelo
   ====================================================================== */

function actualizarTodosLosTimers(segundos) {
  const elementos = [
    { wrap: dilTimerWrap,  num: dilTimer },
    { wrap: votTimerWrap,  num: votTimer },
    { wrap: libTimerWrap,  num: libTimer },
  ];

  for (const { wrap, num } of elementos) {
    if (!wrap || !num) continue;
    num.textContent = segundos;
    wrap.classList.remove('timer-urgente', 'timer-critico');
    if (segundos <= 5) {
      wrap.classList.add('timer-urgente', 'timer-critico');
    } else if (segundos <= 10) {
      wrap.classList.add('timer-urgente');
    }
  }
}

/* ======================================================================
   ID DEL JUGADOR — mostrar en todos los lugares
   ====================================================================== */

function mostrarJugadorId(id) {
  jugadorId = id;
  jugadorIdFijo.textContent = id;
  if (lobbyId) lobbyId.textContent = id;
  if (termId)  termId.textContent  = id;
}

/* ======================================================================
   SOCKET.IO
   ====================================================================== */

const socket = io();

socket.on('connect', () => {
  bannerDesconexion.classList.remove('visible');
  // Re-emitir al conectar Y al reconectar (el servidor crea un nuevo jugador_id)
  socket.emit('jugador:conectar');
});

socket.on('disconnect', () => {
  bannerDesconexion.classList.add('visible');
});

socket.on('jugador:bienvenida', async (data) => {
  mostrarJugadorId(data.jugador_id);
  estadoActual = data.estado;
  prevDilemaNum = data.estado ? data.estado.dilema_actual : 0;
  await cambiarFase(computarKey(data.estado), data.estado);
  actualizarPanelPresentador();
});

socket.on('estado:actualizado', async (estado) => {
  estadoActual = estado;

  // Deshabilitar botones brevemente al entrar en un nuevo dilema (evita tap residual)
  if (estado.fase === 'dilema' && estado.dilema_actual !== prevDilemaNum) {
    prevDilemaNum = estado.dilema_actual;
    console.log('[Jugador] Nuevo dilema:', estado.dilema_actual);
    deshabilitarBotones(600);
  }

  await cambiarFase(computarKey(estado), estado);
  actualizarPanelPresentador();
});

socket.on('timer:tick', ({ restante }) => {
  if (estadoActual) estadoActual.timer_restante = restante;
  actualizarTodosLosTimers(restante);
});

socket.on('dilema:terminado', () => {
  // El backend emitirá estado:actualizado con fase=resultados justo después.
  // No necesitamos hacer nada especial aquí.
});

socket.on('partida:terminada', async (estado) => {
  estadoActual = estado;
  await cambiarFase('terminado', estado);
  actualizarPanelPresentador();
});

/* ======================================================================
   BOTONES DE VOTACIÓN
   ====================================================================== */

[btnOpcionA, btnOpcionB].forEach(btn => {
  btn.addEventListener('click', () => {
    // Ignorar si el servidor ya registró un voto, o si no estamos en fase dilema
    if (faseActualKey !== 'dilema' || !botonesHabilitados) return;
    if (estadoActual && estadoActual.tu_voto) return;

    const opcion = btn.dataset.opcion;

    if (navigator.vibrate) navigator.vibrate(30);

    btn.classList.add('presionado');
    setTimeout(() => btn.classList.remove('presionado'), 150);

    // Emitir al servidor
    socket.emit('jugador:votar', { opcion });

    // UX optimista: mostrar "votado" de inmediato con tu_voto sintético
    cambiarFase('votado', { ...estadoActual, tu_voto: opcion });
  });
});

/* ======================================================================
   ENVÍO DE RESPUESTA LIBRE (DILEMA 6)
   ====================================================================== */

libTextarea.addEventListener('input', () => {
  libChars.textContent = libTextarea.value.length;
});

btnEnviar.addEventListener('click', () => {
  const texto = libTextarea.value.trim();
  if (!texto || faseActualKey !== 'libre') return;
  if (estadoActual && estadoActual.tu_voto === 'LIBRE') return;

  if (navigator.vibrate) navigator.vibrate(30);

  console.log('[Jugador] Emitiendo respuesta_libre:', texto);
  socket.emit('jugador:respuesta_libre', { texto });

  libTextarea.value = '';
  libChars.textContent = '0';

  // UX optimista: mostrar "enviado" de inmediato con tu_voto sintético
  cambiarFase('enviado', { ...estadoActual, tu_voto: 'LIBRE' });
});
