// Servidor de pruebas: sirve pagina.html en /citapreviasepe/ y contesta cita/cargaOficinasMapa
// con datos inventados. La variante se elige con GET /__variante?v=a|b|c|error500.
//   a        sin huecos en ninguna oficina
//   b        huecos solo en oficinas que NO son de la zona (incluye una trampa: dirección que la menciona)
//   c        como b, más dos oficinas de la zona con hueco (la más temprana es la 102)
//   error500 el servidor falla
// Uso: node pruebas/servidor.mjs [puerto]   (por defecto 8765)
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PUERTO = Number(process.argv[2] || 8765);
const PAGINA = fileURLToPath(new URL('./pagina.html', import.meta.url));

// Mismos campos que la respuesta real (los que usa la página y el vigía).
const oficina = (idOficina, oficina, direccion) => ({
  idOficina, oficina, direccion, primerHuecoDisponible: '', oficinaVirtual: false,
  idServicio: 1, servicio: 'Trámite de ejemplo', telefono: '', horarioAtencion: '9:00 a 14:00',
  latitud: 0, longitud: 0, distanciaCP: 0, numMinSolicitantes: 1, numMaxSolicitantes: 1,
  idOficinaDependiente: 0, nombreOficinaDependiente: '', idServicioDependiente: 0,
  nombreServicioDependiente: '', primerHuecoDisponibleDependiente: '', infoTramiteRelacionado: '',
});

export const ZONA = { patron: /\b(villa norte|vilanord)\b/i, nombre: 'Villa Norte' };

export function variante(v) {
  const lista = [
    oficina(101, 'VILLA NORTE CENTRO - SEPE', 'Plaza Mayor 1, Villa Norte'),
    oficina(102, 'VILLA NORTE-CALLE LARGA - SEPE', 'Calle Larga 11, Villa Norte'),
    oficina(201, 'PUEBLO SUR - SEPE', 'Camino de Villa Norte 7, Pueblo Sur'),
    oficina(202, 'CIUDAD ESTE - SEPE', 'Avenida del Puerto 3, Ciudad Este'),
    oficina(203, 'MONTE ALTO - SEPE', 'Calle Olmo 2, Monte Alto'),
  ];
  const hueco = (id, h) => { lista.find(o => o.idOficina === id).primerHuecoDisponible = h; };
  if (v === 'b' || v === 'c') {
    hueco(201, '2026-01-22, 11:54:00');   // trampa: su dirección menciona la zona
    hueco(202, '2026-02-04, 10:42:00');
  }
  if (v === 'c') {
    hueco(101, '2026-01-28, 10:00:00');
    hueco(102, '2026-01-23, 09:12:00');
  }
  return { listaTramites: [], listaOficina: lista };
}

let actual = 'a';

export function arrancar(puerto = PUERTO) {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    req.resume();
    req.on('end', () => {
      if (url.pathname === '/__variante') { actual = url.searchParams.get('v'); return res.end('variante ' + actual); }
      if (url.pathname === '/citapreviasepe/') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.end(fs.readFileSync(PAGINA));
      }
      if (url.pathname === '/citapreviasepe/cita/cargaOficinasMapa') {
        if (actual === 'error500') { res.statusCode = 500; return res.end('error'); }
        res.setHeader('content-type', 'application/json;charset=UTF-8');
        return res.end(JSON.stringify(variante(actual)));
      }
      res.statusCode = 404; res.end();
    });
  });
  return new Promise(ok => srv.listen(puerto, '127.0.0.1', () => ok(srv)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await arrancar();
  console.log(`Simulador en http://127.0.0.1:${PUERTO}/citapreviasepe/  (variante: /__variante?v=a|b|c|error500)`);
}
