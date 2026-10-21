// Pruebas automáticas del vigía contra el simulador, en un Chrome/Chromium/Brave sin ventana.
// Uso: node pruebas/probar.mjs        (Node 22 o superior; NAVEGADOR=/ruta/al/navegador para elegir uno)
// No toca la web real ni tu perfil del navegador: usa un perfil temporal que se borra al acabar.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrancar, ZONA } from './servidor.mjs';

const PUERTO = 8766;
const BASE = `http://127.0.0.1:${PUERTO}`;
const SCRIPT = fs.readFileSync(fileURLToPath(new URL('../sepe-vigia-citas.user.js', import.meta.url)), 'utf8');
const configurado = SCRIPT
  .replace('/\\bTU_MUNICIPIO\\b/i', String(ZONA.patron))
  .replace("NOMBRE_ZONA: 'mi zona'", `NOMBRE_ZONA: '${ZONA.nombre}'`);
if (configurado === SCRIPT) throw new Error('No encuentro PATRON_OFICINA / NOMBRE_ZONA de ejemplo en el script');

/* ---------- navegador ---------- */
function buscarNavegador() {
  if (process.env.NAVEGADOR) return process.env.NAVEGADOR;
  const win = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
  for (const p of win) if (fs.existsSync(p)) return p;
  for (const n of ['google-chrome', 'chromium', 'chromium-browser', 'brave-browser']) {
    try { return execFileSync('which', [n], { encoding: 'utf8' }).trim(); } catch (e) { /* siguiente */ }
  }
  throw new Error('No encuentro Chrome/Chromium/Brave. Indica la ruta con NAVEGADOR=...');
}

const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-pruebas-'));
const nav = spawn(buscarNavegador(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

async function puntoCDP() {
  const f = path.join(perfil, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(f)) {
      const [puerto, ruta] = fs.readFileSync(f, 'utf8').trim().split('\n');
      if (ruta) return `ws://127.0.0.1:${puerto}${ruta}`;
    }
    await espera(100);
  }
  throw new Error('El navegador no abrió el puerto de depuración');
}

/* ---------- CDP mínimo ---------- */
let ws, sesion, sig = 0;
const pendientes = new Map();
const oyentes = [];
function cdp(method, params = {}, conSesion = true) {
  const id = ++sig;
  ws.send(JSON.stringify({ id, method, params, ...(conSesion && sesion ? { sessionId: sesion } : {}) }));
  return new Promise((ok, mal) => pendientes.set(id, { ok, mal }));
}
async function evaluar(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
function esperaEvento(nombre) { return new Promise(ok => oyentes.push({ nombre, ok })); }
const espera = ms => new Promise(ok => setTimeout(ok, ms));

async function abrir(limpiar = true) {
  if (limpiar) await evaluar('try { sessionStorage.clear() } catch (e) {}; 1');
  const cargada = esperaEvento('Page.loadEventFired');
  await cdp('Page.navigate', { url: BASE + '/citapreviasepe/' });
  await cargada;
}
async function recargar() {
  const cargada = esperaEvento('Page.loadEventFired');
  await cdp('Page.reload', {});
  await cargada;
}
// Inyecta el script como lo haría Tampermonkey (sin GM_*: Telegram responde "no disponible")
// y guarda lo que la página pide enviar por Telegram.
async function inyectar(fuente = configurado) {
  await evaluar(`window.__tg = []; document.addEventListener('vigia-sepe:telegram', e => window.__tg.push(JSON.parse(e.detail))); 1`);
  await evaluar(`{ ${fuente}\n }; 1`);
}
const variante = v => fetch(`${BASE}/__variante?v=${v}`).then(r => r.text());
const pulsar = clase => evaluar(`(b => { if (!b.hidden) b.click(); return 1 })(document.querySelector('#vigia-sepe-panel .${clase}'))`);
const leer = () => evaluar(`JSON.stringify({
  clase: document.querySelector('#vigia-sepe-panel').className,
  estado: document.querySelector('#vigia-sepe-panel .vs-estado').textContent,
  detalle: document.querySelector('#vigia-sepe-panel .vs-detalle').textContent,
  e: window.__vigiaSepe.estado,
  titulo: document.title,
  resaltadas: [...document.querySelectorAll('.vigia-sepe-elegida')].map(e => e.id),
  marcadas: [...document.querySelectorAll('.chkOficinas:checked')].map(e => e.id),
  sinCitas: /no podemos ofrecerle/.test(document.getElementById('cntOficinas').innerText),
  sonido: document.querySelector('#vigia-sepe-panel .vs-sonido').checked,
  avisos: document.querySelector('#vigia-sepe-panel .vs-avisos').textContent,
  lineaTelegram: document.querySelector('#vigia-sepe-panel .vs-telegram').textContent,
  telegram: (window.__tg || []).filter(m => m.tipo === 'enviar').map(m => m.texto)
})`).then(JSON.parse);

/* ---------- casos ---------- */
const resultados = [];
async function caso(nombre, fn) {
  try { await fn(); resultados.push([true, nombre]); console.log('PASA  ' + nombre); }
  catch (e) { resultados.push([false, nombre]); console.log('FALLA ' + nombre + '\n      ' + e.message); }
}
function comprobar(cond, msg, s) { if (!cond) throw new Error(msg + (s ? ' | ' + JSON.stringify(s) : '')); }

async function principal() {
  await arrancar(PUERTO);
  ws = new WebSocket(await puntoCDP());
  await new Promise(ok => ws.addEventListener('open', ok));
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pendientes.has(d.id)) { const p = pendientes.get(d.id); pendientes.delete(d.id); d.error ? p.mal(new Error(d.error.message)) : p.ok(d.result); }
    else if (d.method) for (let i = oyentes.length - 1; i >= 0; i--) if (oyentes[i].nombre === d.method) oyentes.splice(i, 1)[0].ok(d.params);
  });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' }, false);
  ({ sessionId: sesion } = await cdp('Target.attachToTarget', { targetId, flatten: true }, false));
  await cdp('Page.enable');

  await caso('sin configurar: no arranca', async () => {
    await abrir(); await variante('c'); await inyectar(SCRIPT);
    await pulsar('vs-iniciar'); await espera(1500);
    const s = await leer();
    comprobar(!s.e.activo && s.e.ciclos === 0 && /No configurado/.test(s.estado) && !s.telegram.length, 'debería negarse a arrancar', s);
  });

  await abrir(); await evaluar('try { localStorage.clear() } catch (e) {}; 1'); await inyectar();

  await caso('(a) sin citas: no avisa, se ve el aviso de la web y advierte de Telegram sin configurar', async () => {
    await variante('a'); await pulsar('vs-iniciar'); await espera(1500);
    const s = await leer(); await pulsar('vs-parar');
    comprobar(s.clase === 'ok' && s.e.ciclos === 1 && s.sinCitas && !s.telegram.length && /0 con hueco/.test(s.detalle), 'estado inesperado', s);
    comprobar(/^Aviso principal, Telegram/.test(s.lineaTelegram) && /no te llegará nada al móvil/.test(s.lineaTelegram), 'debería advertir de Telegram sin configurar', s);
  });

  await caso('sonido apagado por defecto; la casilla se recuerda tras recargar', async () => {
    const s1 = await leer();
    comprobar(!s1.sonido && /Sonido: apagado/.test(s1.avisos), 'el sonido debería empezar apagado', s1);
    await evaluar(`(c => { c.click(); return 1 })(document.querySelector('#vigia-sepe-panel .vs-sonido'))`);
    await recargar(); await inyectar();
    const s2 = await leer();
    await evaluar(`(c => { c.click(); return 1 })(document.querySelector('#vigia-sepe-panel .vs-sonido'))`);
    comprobar(s2.sonido && !/apagado/.test(s2.avisos), 'debería recordar el sonido activado', s2);
  });

  await caso('(b) citas solo fuera de la zona (con trampa en la dirección): no avisa', async () => {
    await variante('b'); await pulsar('vs-iniciar'); await espera(1500);
    const s = await leer(); await pulsar('vs-parar');
    comprobar(s.clase === 'ok' && !s.e.encontrado && !s.telegram.length && /2 con hueco, 0 en/.test(s.detalle), 'no debería avisar', s);
  });

  await caso('Telefónica elegida a mano con cita en la zona: se ignora', async () => {
    await variante('c');
    await evaluar(`(c => { c.value = '3'; c.dispatchEvent(new Event('change', { bubbles: true })); return 1 })(document.getElementById('comboCanales'))`);
    await espera(1500);
    const s = await leer();
    comprobar(s.clase !== 'alerta' && !s.e.encontrado && !s.telegram.length, 'no debería avisar por Telefónica', s);
  });

  await caso('(c) cita en la zona: avisa y marca la oficina con el hueco más temprano', async () => {
    await variante('c'); await pulsar('vs-iniciar'); await espera(2000);
    const s = await leer();
    comprobar(s.clase === 'alerta' && !s.e.activo && s.e.encontrado?.id === 102, 'debería avisar por la 102', s);
    comprobar(s.resaltadas.join() === 'cntOficina_102' && s.marcadas.join() === 'chkOficina_102', 'debería marcar la 102', s);
    comprobar(/CITA!/.test(s.titulo), 'título sin cambiar', s);
    comprobar(s.telegram.length === 1 && /VILLA NORTE-CALLE LARGA/.test(s.telegram[0]) && /VILLA NORTE CENTRO/.test(s.telegram[0]), 'mensaje de Telegram incorrecto', s);
  });

  await caso('error 500: baja el ritmo y se recupera solo', async () => {
    await variante('error500'); await pulsar('vs-iniciar'); await espera(1500);
    const s1 = await leer();
    comprobar(s1.clase === 'error' && s1.e.fallos === 1 && /HTTP 500/.test(s1.estado), 'debería contar el fallo', s1);
    await variante('b'); await espera(13000);
    const s2 = await leer(); await pulsar('vs-parar');
    comprobar(s2.clase === 'ok' && s2.e.fallos === 0 && s2.e.ciclos >= 2, 'debería haberse recuperado', s2);
  });

  await caso('recarga completa: sigue vigilando', async () => {
    await variante('b'); await pulsar('vs-iniciar'); await espera(1500);
    await recargar(); await inyectar(); await espera(2000);
    const s = await leer(); await pulsar('vs-parar');
    comprobar(s.e.activo && s.e.ciclos >= 2 && s.clase === 'ok', 'debería reanudar tras la recarga', s);
  });

  await caso('la página vuelve al inicio: avisa y se reanuda al volver al canal', async () => {
    await variante('b'); await pulsar('vs-iniciar'); await espera(1500);
    await evaluar(`document.getElementById('contenido2').style.display = 'none'; 1`); await espera(8500);
    const s1 = await leer();
    comprobar(/Esperando la pantalla de canal/.test(s1.estado) && s1.telegram.some(t => /volvió al inicio/.test(t)), 'debería avisar de sesión perdida', s1);
    await evaluar(`document.getElementById('contenido2').style.display = ''; 1`); await espera(5000);
    const s2 = await leer(); await pulsar('vs-parar');
    comprobar(/Vigilando/.test(s2.estado), 'debería reanudar', s2);
  });
}

try { await principal(); }
catch (e) { console.log('ERROR ' + e.message); resultados.push([false, 'ejecución']); }
finally {
  try { ws?.close(); } catch (e) { /* nada */ }
  nav.kill();
  await espera(500);
  try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { /* lo limpia el sistema */ }
  const malos = resultados.filter(r => !r[0]).length;
  console.log(`\n${resultados.length - malos}/${resultados.length} casos pasan`);
  process.exit(malos ? 1 : 0);
}
