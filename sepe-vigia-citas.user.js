// ==UserScript==
// @name         SEPE vigía de citas presenciales
// @namespace    sepe-vigia-citas
// @version      1.0.0
// @description  Vigila la cita previa del SEPE y avisa cuando hay cita PRESENCIAL en las oficinas que elijas. No reserva nada.
// @match        https://citaprevia-sede.sepe.gob.es/citapreviasepe/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.telegram.org
// @noframes
// ==/UserScript==

/* ======================= PARÁMETROS EDITABLES ======================= */
const CONFIG = {
  // OBLIGATORIO. Oficinas que te sirven: se busca en el nombre que da el SEPE, que suele
  // ser "<MUNICIPIO> - SEPE" o "<MUNICIPIO>-<CALLE> - SEPE". Pon el municipio y, si lo
  // tiene, su nombre en la otra lengua oficial: /\b(nombre1|nombre2)\b/i
  // Mientras siga el valor de ejemplo, el vigía no arranca.
  PATRON_OFICINA: /\bTU_MUNICIPIO\b/i,
  // Nombre corto que sale en el panel y en los avisos.
  NOMBRE_ZONA: 'mi zona',
  // Buscar también en la dirección de la oficina (más amplio, más riesgo de falsos positivos).
  MIRAR_DIRECCION: false,
  // Texto de la opción del desplegable de canal que se vigila.
  PATRON_CANAL: /presencial/i,
  // Segundos entre comprobaciones (mínimo 4) y variación aleatoria añadida.
  INTERVALO_SEG: 5,
  VARIACION_SEG: 2,
  // Si el servidor falla: el intervalo se duplica en cada fallo hasta este máximo...
  INTERVALO_MAX_SEG: 300,
  // ...se avisa a partir de este número de fallos seguidos...
  FALLOS_PARA_AVISAR: 3,
  // ...y se para del todo al llegar a este.
  FALLOS_PARA_PARAR: 8,
  // Segundos máximos esperando la respuesta de oficinas.
  ESPERA_RESPUESTA_SEG: 20,
  // Avisos. Telegram es el principal: se envía antes que ningún otro. Cada instalación usa
  // SU PROPIO bot; la clave NO va aquí: se pega con el botón "Telegram…" del panel.
  TELEGRAM: true,
  NOTIFICACION: true,
  // Valor inicial de la casilla "Sonido" del panel. Lo que marques en el panel se recuerda.
  SONIDO: false,
  SEGUNDOS_PITIDOS: 15,
};
/* ==================================================================== */

/* ---------- Parte 1: Tampermonkey. Telegram y arranque de la parte de la página ----------
   La web prohíbe (CSP) que la página se conecte a otros servidores; Tampermonkey sí puede
   (GM_xmlhttpRequest). La página le pide los envíos con eventos del documento. */
(function () {
  'use strict';
  const EV = 'vigia-sepe:telegram';
  const conGM = typeof GM_xmlhttpRequest === 'function';
  const clave = () => (conGM ? GM_getValue('telegramClave', '') : '');
  const destinatarios = () => (conGM ? GM_getValue('telegramDestinatarios', []) : []);

  function api(metodo, datos) {
    return new Promise(resolver => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `https://api.telegram.org/bot${clave()}/${metodo}`,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(datos || {}),
        timeout: 15000,
        onload: r => { try { resolver(JSON.parse(r.responseText)); } catch (e) { resolver({ ok: false, description: 'HTTP ' + r.status }); } },
        onerror: () => resolver({ ok: false, description: 'sin conexión' }),
        ontimeout: () => resolver({ ok: false, description: 'tiempo agotado' }),
      });
    });
  }

  async function enviar(texto) {
    if (!conGM || !clave() || !destinatarios().length) return { ok: false, motivo: 'Telegram sin configurar' };
    const r = await Promise.all(destinatarios().map(c => api('sendMessage', { chat_id: c.id, text: texto, disable_web_page_preview: true })));
    const bien = r.filter(x => x.ok).length;
    return { ok: bien === r.length, motivo: `${bien}/${r.length} enviados` + (bien < r.length ? ' (' + r.find(x => !x.ok).description + ')' : '') };
  }

  async function configurar() {
    if (!conGM) return { ok: false, motivo: 'hace falta Tampermonkey' };
    const ayuda = 'Pega la clave (token) de tu bot de Telegram.\n' +
      'Antes, cada persona que quiera recibir avisos debe abrir el bot en Telegram y pulsar "Iniciar".\n' +
      (clave() ? 'Deja el campo vacío para conservar la clave guardada.' : '');
    const t = prompt(ayuda, '');
    if (t === null) return { ok: false, motivo: 'cancelado' };
    if (t.trim()) GM_setValue('telegramClave', t.trim());
    if (!clave()) return { ok: false, motivo: 'falta la clave' };
    const r = await api('getUpdates', {});
    if (!r.ok) return { ok: false, motivo: 'Telegram rechaza la clave: ' + (r.description || '?') };
    // Se apuntan todas las personas que han escrito al bot (getUpdates guarda las últimas 24 h).
    const vistos = new Map(destinatarios().map(c => [c.id, c]));
    for (const u of r.result || []) {
      const ch = (u.message || u.edited_message || u.my_chat_member || {}).chat;
      if (ch) vistos.set(ch.id, { id: ch.id, nombre: ch.first_name || ch.title || ch.username || String(ch.id) });
    }
    GM_setValue('telegramDestinatarios', [...vistos.values()]);
    if (!vistos.size) return { ok: false, motivo: 'nadie ha escrito al bot todavía: abridlo, pulsad "Iniciar" y repite' };
    return enviar('✅ Vigía SEPE: avisos de Telegram activados en este chat.');
  }

  function resumen() {
    if (!conGM) return 'no disponible (hace falta Tampermonkey)';
    if (!clave()) return 'sin configurar';
    const c = destinatarios();
    return c.length ? `${c.length} destinatario(s): ${c.map(x => x.nombre).join(', ')}` : 'sin destinatarios';
  }

  document.addEventListener(EV, async ev => {
    let p;
    try { p = JSON.parse(ev.detail); } catch (e) { return; }
    let r = {};
    if (p.tipo === 'enviar') r = await enviar(p.texto);
    else if (p.tipo === 'configurar') r = await configurar();
    r.id = p.id;
    r.resumen = resumen();
    document.dispatchEvent(new CustomEvent(EV + '-respuesta', { detail: JSON.stringify(r) }));
  });

  // La vigilancia tiene que correr en el mundo de la página (usa sus peticiones y sus funciones).
  const cfg = JSON.stringify(CONFIG, (k, v) => (v instanceof RegExp ? { __re: v.source, flags: v.flags } : v));
  const s = document.createElement('script');
  s.textContent = `(${pagina})(${cfg});`;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
})();

/* ---------- Parte 2: corre dentro de la página ---------- */
function pagina(CONFIG) {
  'use strict';
  if (window.__vigiaSepe) return;
  for (const k in CONFIG) if (CONFIG[k] && CONFIG[k].__re) CONFIG[k] = new RegExp(CONFIG[k].__re, CONFIG[k].flags);

  const CLAVE = 'vigiaSepe.v1';
  const MIN_SEG = 4;
  const TITULO_ORIGINAL = document.title;

  /* ---------- estado persistente (sobrevive a recargas de la pestaña) ---------- */
  const estadoInicial = { activo: false, ciclos: 0, fallos: 0, inicio: null, ultimo: null, encontrado: null, avisoRecarga: false };
  function leer() {
    try { return Object.assign({}, estadoInicial, JSON.parse(sessionStorage.getItem(CLAVE) || '{}')); }
    catch (e) { return Object.assign({}, estadoInicial); }
  }
  function guardar() {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) { /* sin almacenamiento: sigue en memoria */ }
  }
  const estado = leer();

  /* ---------- lógica de detección (pura, se prueba aparte) ---------- */
  function evaluar(listaOficina) {
    const lista = Array.isArray(listaOficina) ? listaOficina : [];
    const conHueco = lista.filter(o => o && o.primerHuecoDisponible);
    const validas = conHueco.filter(o => {
      if (o.oficinaVirtual) return false;
      const texto = (o.oficina || '') + (CONFIG.MIRAR_DIRECCION ? ' ' + (o.direccion || '') : '');
      return CONFIG.PATRON_OFICINA.test(texto);
    }).sort((a, b) => String(a.primerHuecoDisponible).localeCompare(String(b.primerHuecoDisponible)));
    return { total: lista.length, conHueco: conHueco.length, validas };
  }

  /* ---------- acceso a la página ---------- */
  const combo = () => document.getElementById('comboCanales');
  function opcionPresencial() {
    const c = combo();
    if (!c) return null;
    return [...c.options].find(o => CONFIG.PATRON_CANAL.test(o.text)) || null;
  }
  function enPantallaCanal() {
    const c = combo();
    return !!(c && c.offsetParent !== null && opcionPresencial());
  }

  /* ---------- avisos ---------- */
  let audio = null;
  function desbloquearAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { /* sin audio */ }
  }
  // Cualquier clic o tecla del usuario habilita el sonido (política de reproducción automática).
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, desbloquearAudio, { capture: true, passive: true }));

  // Elección de la casilla "Sonido", recordada en este navegador.
  function sonidoElegido() {
    try { const v = localStorage.getItem('vigiaSepe.sonido'); return v === null ? CONFIG.SONIDO : v === '1'; }
    catch (e) { return CONFIG.SONIDO; }
  }
  function elegirSonido(si) {
    try { localStorage.setItem('vigiaSepe.sonido', si ? '1' : '0'); } catch (e) { /* solo para esta visita */ }
    CONFIG.SONIDO = si;
  }

  function pitar(segundos) {
    if (!sonidoElegido() || !audio) return false;
    try {
      audio.resume();
      const t0 = audio.currentTime + 0.05;
      // Se programa todo de una vez en el reloj de audio: no depende de temporizadores
      // y suena igual con la pestaña en segundo plano.
      for (let i = 0; i < segundos * 2; i++) {
        const t = t0 + i * 0.5;
        const osc = audio.createOscillator();
        const gan = audio.createGain();
        osc.type = 'square';
        osc.frequency.value = i % 2 ? 1320 : 880;
        gan.gain.setValueAtTime(0.0001, t);
        gan.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gan.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        osc.connect(gan).connect(audio.destination);
        osc.start(t);
        osc.stop(t + 0.32);
      }
      return audio.state === 'running';
    } catch (e) { return false; }
  }

  function notificar(titulo, cuerpo) {
    if (!CONFIG.NOTIFICACION || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    try {
      const n = new Notification(titulo, { body: cuerpo, requireInteraction: true, tag: 'vigia-sepe' });
      n.onclick = () => { window.focus(); n.close(); };
      return true;
    } catch (e) { return false; }
  }

  // Telegram: lo envía la parte de Tampermonkey (ver arriba).
  let tgResumen = 'comprobando…';
  let tgId = 0;
  const tgPendientes = new Map();
  document.addEventListener('vigia-sepe:telegram-respuesta', ev => {
    let r;
    try { r = JSON.parse(ev.detail); } catch (e) { return; }
    tgResumen = r.resumen || tgResumen;
    const f = tgPendientes.get(r.id);
    if (f) { tgPendientes.delete(r.id); f(r); }
    pintar(panel.className);
  });
  function telegram(tipo, texto) {
    if (tipo === 'enviar' && !CONFIG.TELEGRAM) return Promise.resolve({ ok: false, motivo: 'desactivado' });
    return new Promise(resolver => {
      const id = ++tgId;
      tgPendientes.set(id, resolver);
      document.dispatchEvent(new CustomEvent('vigia-sepe:telegram', { detail: JSON.stringify({ id, tipo, texto }) }));
      setTimeout(() => { if (tgPendientes.delete(id)) resolver({ ok: false, motivo: 'Tampermonkey no responde' }); }, tipo === 'configurar' ? 300000 : 30000);
    });
  }

  let parpadeo = null;
  function tituloAlerta(texto) {
    clearInterval(parpadeo);
    let on = false;
    document.title = texto;
    parpadeo = setInterval(() => { on = !on; document.title = on ? '\u{1F514}\u{1F514}\u{1F514} ' + texto : texto; }, 1000);
  }
  function tituloNormal(prefijo) {
    clearInterval(parpadeo);
    parpadeo = null;
    document.title = (prefijo ? prefijo + ' ' : '') + TITULO_ORIGINAL;
  }

  /* ---------- panel ---------- */
  const panel = document.createElement('div');
  panel.id = 'vigia-sepe-panel';
  panel.innerHTML = `
    <style>
      #vigia-sepe-panel{position:fixed;top:8px;right:8px;z-index:2147483647;width:300px;max-width:calc(100vw - 16px);
        font:13px/1.35 system-ui,sans-serif;background:#fff;color:#111;border:2px solid #555;border-radius:8px;
        box-shadow:0 4px 16px rgba(0,0,0,.3);padding:8px 10px}
      #vigia-sepe-panel.ok{border-color:#1a7f37} #vigia-sepe-panel.alerta{border-color:#d00;background:#fff4f4}
      #vigia-sepe-panel.error{border-color:#c60}
      #vigia-sepe-panel b{display:block;margin-bottom:4px} #vigia-sepe-panel .vs-l{margin:2px 0;word-wrap:break-word}
      #vigia-sepe-panel button{margin:6px 6px 0 0;padding:4px 10px;font:inherit;cursor:pointer}
      #vigia-sepe-panel .vs-x{position:absolute;top:2px;right:6px;border:0;background:none;font-size:16px;margin:0;padding:0 4px}
      #vigia-sepe-panel .vs-aviso{color:#b00;font-weight:600}
      .vigia-sepe-elegida{outline:4px solid #d00 !important;outline-offset:2px;background:#fff1a8 !important}
    </style>
    <button class="vs-x" title="Minimizar">–</button>
    <b>Vigía SEPE · Presencial · ${CONFIG.NOMBRE_ZONA}</b>
    <div class="vs-cuerpo">
      <div class="vs-l vs-estado"></div>
      <div class="vs-l vs-detalle"></div>
      <div class="vs-l vs-telegram"></div>
      <div class="vs-l vs-avisos"></div>
      <label class="vs-l"><input type="checkbox" class="vs-sonido"> Sonido al encontrar cita</label>
      <button class="vs-iniciar">Iniciar</button><button class="vs-parar">Parar</button><button class="vs-probar">Probar aviso</button><button class="vs-tg">Telegram…</button>
    </div>`;
  document.body.appendChild(panel);
  const q = s => panel.querySelector(s);
  q('.vs-x').onclick = () => { const c = q('.vs-cuerpo'); c.hidden = !c.hidden; };

  function pintar(clase, textoEstado, detalle) {
    panel.className = clase || '';
    if (textoEstado != null) q('.vs-estado').textContent = textoEstado;
    if (detalle != null) q('.vs-detalle').textContent = detalle;
    const permiso = 'Notification' in window ? Notification.permission : 'no disponible';
    const sonido = !sonidoElegido() ? 'apagado' : audio && audio.state === 'running' ? 'activo' : 'pulsa en la página para activarlo';
    const tgListo = !CONFIG.TELEGRAM || /destinatario/.test(tgResumen);
    q('.vs-telegram').textContent = 'Aviso principal, Telegram: ' + (CONFIG.TELEGRAM ? tgResumen : 'desactivado') +
      (tgListo ? '' : ' · ¡no te llegará nada al móvil! Pulsa "Telegram…"');
    q('.vs-telegram').classList.toggle('vs-aviso', !tgListo);
    q('.vs-avisos').textContent = `Notificación: ${permiso === 'granted' ? 'permitida' : permiso === 'denied' ? 'BLOQUEADA' : 'sin permiso'} · Sonido: ${sonido}`;
    q('.vs-sonido').checked = sonidoElegido();
    q('.vs-iniciar').hidden = estado.activo;
    q('.vs-parar').hidden = !estado.activo;
  }
  const hora = d => new Date(d).toLocaleTimeString('es-ES');

  /* ---------- bucle de vigilancia ---------- */
  let temporizador = null;
  let esperando = null; // { resolver }

  function siguienteEspera() {
    const base = Math.max(MIN_SEG, CONFIG.INTERVALO_SEG);
    const conFallos = Math.min(CONFIG.INTERVALO_MAX_SEG, base * Math.pow(2, estado.fallos));
    return (conFallos + Math.random() * CONFIG.VARIACION_SEG) * 1000;
  }

  function programar(ms) {
    clearTimeout(temporizador);
    if (estado.activo) temporizador = setTimeout(ciclo, ms);
  }

  // Respuestas de cita/cargaOficinasMapa, las pida el vigía o el usuario a mano.
  function alResponder(url, cuerpo, xhr) {
    if (!/cita\/cargaOficinasMapa/.test(url || '')) return;
    const presencial = opcionPresencial();
    const canalPedido = new URLSearchParams(typeof cuerpo === 'string' ? cuerpo : '').get('idTipoAtencion');
    const res = { estado: xhr.status, datos: null, canalOk: !!presencial && canalPedido === presencial.value };
    try { res.datos = JSON.parse(xhr.responseText); } catch (e) { res.datos = null; }
    if (esperando) { const r = esperando.resolver; esperando = null; r(res); }
    else if (res.canalOk && res.datos) procesar(res, false); // cambio manual del usuario
  }

  // Se escucha la petición de red misma, no los callbacks de jQuery: si el código de la
  // página falla al pintar la lista, la respuesta llega igual.
  function enganchar() {
    if (window.__vigiaSepeEnganchado) return;
    window.__vigiaSepeEnganchado = true;
    const proto = XMLHttpRequest.prototype;
    const abrir = proto.open, enviar = proto.send;
    proto.open = function (metodo, url) { this.__vigiaUrl = String(url); return abrir.apply(this, arguments); };
    proto.send = function (cuerpo) {
      if (/cita\/cargaOficinasMapa/.test(this.__vigiaUrl || '')) {
        this.addEventListener('loadend', () => alResponder(this.__vigiaUrl, cuerpo, this));
      }
      return enviar.apply(this, arguments);
    };
  }

  function pedirOficinas() {
    return new Promise(resolver => {
      const plazo = setTimeout(() => { if (esperando) { esperando = null; resolver({ estado: 0, datos: null, canalOk: false, plazo: true }); } }, CONFIG.ESPERA_RESPUESTA_SEG * 1000);
      esperando = { resolver: r => { clearTimeout(plazo); resolver(r); } };
      const c = combo();
      c.value = opcionPresencial().value;
      // Es exactamente lo que hace la página al elegir canal: onChange="limpiarMensajes();cargaOficinasMapa();"
      c.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function ciclo() {
    if (!estado.activo) return;
    if (!enPantallaCanal()) {
      pintar('error', 'Esperando la pantalla de canal…', 'Rellena el formulario hasta el desplegable "Canal". El vigía seguirá solo.');
      if (estado.ciclos > 0 && !estado.avisoRecarga) {
        estado.avisoRecarga = true; guardar();
        notificar('Vigía SEPE: sesión perdida', 'La página volvió al inicio. Rellena el formulario de nuevo; el vigía seguirá solo.');
        telegram('enviar', '⚠️ Vigía SEPE: la página volvió al inicio y NO está vigilando. Hay que rellenar el formulario de nuevo en el ordenador.');
      }
      return programar(3000);
    }
    estado.avisoRecarga = false;
    enganchar();
    const res = await pedirOficinas();
    if (!estado.activo) return;
    procesar(res, true);
  }

  function procesar(res, delVigia) {
    estado.ultimo = Date.now();
    if (delVigia) estado.ciclos++;
    const valido = res.estado === 200 && res.datos && Array.isArray(res.datos.listaOficina) && res.canalOk;
    if (!valido) {
      estado.fallos++;
      guardar();
      const motivo = res.plazo ? 'sin respuesta' : res.estado !== 200 ? 'HTTP ' + res.estado : !res.canalOk ? 'canal distinto de Presencial' : 'respuesta no válida (¿sesión caducada?)';
      const espera = Math.round(siguienteEspera() / 1000);
      if (estado.fallos >= CONFIG.FALLOS_PARA_PARAR) {
        estado.activo = false; guardar();
        pintar('error', `PARADO tras ${estado.fallos} fallos seguidos (${motivo}).`, 'Revisa la página; si volvió al inicio, rellénala y pulsa Iniciar.');
        tituloNormal('⚠️');
        notificar('Vigía SEPE parado', `${estado.fallos} fallos seguidos: ${motivo}.`);
        telegram('enviar', `⚠️ Vigía SEPE PARADO tras ${estado.fallos} fallos seguidos (${motivo}). Ya no está vigilando.`);
        return;
      }
      if (estado.fallos >= CONFIG.FALLOS_PARA_AVISAR) notificar('Vigía SEPE: errores', `${estado.fallos} fallos seguidos (${motivo}). Bajo el ritmo a ${espera} s.`);
      if (estado.fallos === CONFIG.FALLOS_PARA_AVISAR) telegram('enviar', `⚠️ Vigía SEPE: ${estado.fallos} fallos seguidos (${motivo}). Sigue intentándolo más despacio.`);
      pintar('error', `Fallo ${estado.fallos}: ${motivo}. Reintento en ${espera} s.`, null);
      return programar(espera * 1000);
    }
    estado.fallos = 0;
    const r = evaluar(res.datos.listaOficina);
    if (r.validas.length) return alarma(r);
    guardar();
    pintar('ok', `Vigilando · ${estado.ciclos} comprobaciones · última ${hora(estado.ultimo)}`,
      `${r.total} oficinas, ${r.conHueco} con hueco, 0 en ${CONFIG.NOMBRE_ZONA}.`);
    tituloNormal(`[${estado.ciclos}]`);
    if (delVigia) programar(siguienteEspera());
  }

  function alarma(r) {
    clearTimeout(temporizador);
    const o = r.validas[0];
    estado.activo = false;
    estado.encontrado = { id: o.idOficina, oficina: o.oficina, hueco: o.primerHuecoDisponible, cuando: Date.now() };
    guardar();
    const texto = `${o.oficina}: ${o.primerHuecoDisponible}`;
    const otras = r.validas.slice(1).map(x => `${x.oficina} (${x.primerHuecoDisponible})`).join('; ');
    const resto = ' Pulsa tú "Continuar" YA: la sesión caduca enseguida.' + (otras ? ' También: ' + otras : '');
    // Telegram primero: es el aviso que llega aunque no estés delante.
    telegram('enviar', `\u{1F514} CITA PRESENCIAL EN ${CONFIG.NOMBRE_ZONA.toUpperCase()}\n${o.oficina}\nPrimer hueco: ${o.primerHuecoDisponible}` +
      (otras ? `\nTambién: ${otras}` : '') + '\nVe al ordenador y pulsa "Continuar" YA: la sesión caduca enseguida.');
    pintar('alerta', `¡CITA PRESENCIAL EN ${CONFIG.NOMBRE_ZONA.toUpperCase()}! ${texto}`, 'Marcando la oficina…' + resto);
    marcar(o.idOficina, 30, ok => pintar('alerta', null, (ok ? 'Oficina marcada en la lista.' : 'No pude marcarla: búscala y pulsa "Seleccionar".') + resto));
    tituloAlerta('¡CITA! ' + o.oficina);
    notificar(`¡Cita presencial en ${CONFIG.NOMBRE_ZONA}!`, texto + '. Ve a la pestaña y pulsa Continuar.');
    pitar(CONFIG.SEGUNDOS_PITIDOS);
    window.focus();
  }

  // Marca la oficina igual que el botón "Seleccionar" de la página y la resalta.
  function marcar(id, intentos = 30, hecho = () => {}) {
    const bloque = document.getElementById('cntOficina_' + id);
    if (!bloque) { if (intentos > 0) setTimeout(() => marcar(id, intentos - 1, hecho), 100); else hecho(false); return; }
    const chk = document.getElementById('chkOficina_' + id);
    if (chk && !chk.checked && typeof window.marcarOficina === 'function') {
      try { window.marcarOficina(id); } catch (e) { chk.checked = true; }
    }
    document.querySelectorAll('.vigia-sepe-elegida').forEach(e => e.classList.remove('vigia-sepe-elegida'));
    bloque.classList.add('vigia-sepe-elegida');
    bloque.scrollIntoView({ block: 'center' });
    hecho(!!(chk && chk.checked));
  }

  const sinConfigurar = () => /TU_MUNICIPIO/.test(CONFIG.PATRON_OFICINA.source);
  const AVISO_CONFIGURAR = 'Falta configurar: edita PATRON_OFICINA y NOMBRE_ZONA al principio del script (Tampermonkey > Panel de control) y recarga.';

  /* ---------- botones ---------- */
  q('.vs-iniciar').onclick = () => {
    if (sinConfigurar()) return pintar('error', 'No configurado.', AVISO_CONFIGURAR);
    desbloquearAudio();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(() => pintar(panel.className));
    Object.assign(estado, { activo: true, fallos: 0, encontrado: null, inicio: Date.now(), ciclos: 0, avisoRecarga: false });
    guardar();
    tituloNormal();
    document.querySelectorAll('.vigia-sepe-elegida').forEach(e => e.classList.remove('vigia-sepe-elegida'));
    pintar('ok', 'Iniciando…', '');
    ciclo();
  };
  q('.vs-sonido').onchange = e => {
    elegirSonido(e.target.checked);
    if (e.target.checked) desbloquearAudio();
    pintar(panel.className);
  };
  q('.vs-parar').onclick = () => {
    estado.activo = false; guardar();
    clearTimeout(temporizador);
    tituloNormal();
    pintar('', `Parado · ${estado.ciclos} comprobaciones`, null);
  };
  q('.vs-probar').onclick = () => {
    desbloquearAudio();
    const avisar = async () => {
      const envio = telegram('enviar', `\u{1F514} Vigía SEPE: mensaje de prueba. Así llegará el aviso cuando haya cita en ${CONFIG.NOMBRE_ZONA}.`);
      const n = notificar('Vigía SEPE: prueba', `Así te avisará cuando haya cita en ${CONFIG.NOMBRE_ZONA}.`);
      const s = !sonidoElegido() ? 'apagado' : pitar(2) ? 'OK' : 'NO';
      const linea = t => `Prueba: Telegram ${t} · notificación ${n ? 'OK' : 'NO (revisa permisos)'} · sonido ${s}`;
      pintar(panel.className, null, linea('enviando…'));
      const t = await envio;
      pintar(panel.className, null, linea(t.ok ? 'OK' : 'NO (' + t.motivo + ')'));
    };
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(avisar);
    else avisar();
  };
  q('.vs-tg').onclick = async () => {
    pintar(panel.className, null, 'Configurando Telegram…');
    const r = await telegram('configurar');
    pintar(panel.className, null, 'Telegram: ' + (r.ok ? 'mensaje de prueba enviado (' + r.motivo + ')' : r.motivo));
  };

  /* ---------- arranque ---------- */
  window.__vigiaSepe = { CONFIG, evaluar, estado, marcar };
  enganchar();
  telegram('estado');
  if (sinConfigurar()) {
    estado.activo = false; guardar();
    pintar('error', 'No configurado.', AVISO_CONFIGURAR);
  } else if (estado.encontrado) {
    pintar('alerta', `Última cita encontrada: ${estado.encontrado.oficina} (${estado.encontrado.hueco}) a las ${hora(estado.encontrado.cuando)}.`, 'Pulsa Iniciar para volver a vigilar.');
  } else if (estado.activo) {
    pintar('ok', 'Reanudando tras recarga…', sonidoElegido() ? 'Pulsa en la página para reactivar el sonido.' : '');
    ciclo();
  } else {
    pintar('', 'Parado. Llega a la pantalla de canal y pulsa Iniciar.', '');
  }
}
