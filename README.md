# Vigía de citas del SEPE (presencial)

Script de usuario de Tampermonkey que vigila la [cita previa del SEPE](https://sede.sepe.gob.es/portalSede/es/procedimientos-y-servicios/personas/proteccion-por-desempleo/cita-previa)
y avisa en cuanto hay una cita **presencial** en las oficinas que tú elijas. Cuando la hay, deja esa oficina
marcada en la página para que tú sigas con la reserva.

**Lo que hace**
- Comprueba la disponibilidad cada 5–7 segundos, en una sola pestaña, sin recargar la página.
- Solo avisa si la cita es **presencial** y en una oficina cuyo nombre encaja con tu patrón. Las citas telefónicas
  y las de otras localidades se ignoran.
- Avisa, por este orden:
  1. **Telegram**, el aviso principal: un mensaje al móvil de una o varias personas, con un bot tuyo.
  2. Una notificación del sistema.
  3. El título de la pestaña parpadeando.
  4. Pitidos, solo si marcas la casilla "Sonido" del panel. Vienen apagados.
- Marca la oficina con el primer hueco (la misma acción que el botón "Seleccionar") y la resalta.

**Lo que NO hace, a propósito**
- No pulsa "Continuar", no elige fecha ni hora, no rellena datos personales y no toca el captcha.
- No envía tus datos a ningún sitio. El mensaje de Telegram solo lleva el nombre de la oficina y la fecha del hueco.
- No trabaja en paralelo ni deprisa. Si la web falla, va más despacio y acaba parándose.

---

## Cómo funciona

La pantalla de selección de canal de la cita previa (`citaprevia-sede.sepe.gob.es/citapreviasepe/`) tiene un
desplegable `<select id="comboCanales">` (Presencial / Telefónica). Al cambiarlo, la página no se recarga: pide
la lista de oficinas al servidor (`POST cita/cargaOficinasMapa`) y recibe un JSON (texto con datos estructurados)
de esta forma:

```json
{ "listaTramites": [], "listaOficina": [
  { "idOficina": 101, "oficina": "MUNICIPIO - SEPE", "direccion": "...", "primerHuecoDisponible": "2026-01-23, 09:12:00", ... },
  { "idOficina": 102, "oficina": "OTRO MUNICIPIO - SEPE", "direccion": "...", "primerHuecoDisponible": "", ... }
] }
```

Por el distrito único, la lista trae **todas las oficinas de la provincia**, tengan hueco o no. Una oficina tiene
cita solo si `primerHuecoDisponible` viene relleno. La página pinta en `#cntOficinas` solo las que tienen hueco.
Si no hay ninguna, muestra *"En estos momentos no podemos ofrecerle citas en la oficina seleccionada"*.

El vigía:
1. Vuelve a disparar el cambio sobre **Presencial**, igual que si lo eligieras tú (`onChange="limpiarMensajes();cargaOficinasMapa();"`).
2. Lee directamente la respuesta de esa petición de red. No depende de cómo se pinte la página, así que funciona
   aunque el código de la página falle al dibujar la lista. Comprueba también que la petición era del canal Presencial.
3. Si hay hueco en una oficina de tu patrón, para, avisa y marca la de hueco más temprano con la función
   `marcarOficina(id)` de la propia página.
4. Si no, espera 5 s más un margen aleatorio de hasta 2 s y repite.

Ante errores (respuesta distinta de 200, respuesta no válida o sin respuesta), duplica la espera en cada fallo
hasta un máximo de 5 minutos. Avisa a los 3 fallos seguidos y se para a los 8.

El estado (activo, número de comprobaciones, cita encontrada) se guarda en `sessionStorage`. Tras una recarga
completa sigue solo en cuanto vuelve a ver la pantalla de canal.

Por qué Telegram va a través de Tampermonkey: la web prohíbe que su página se conecte a otros servidores (su
política de seguridad, CSP, es `default-src 'self'`). Por eso el script tiene dos partes:
- La **vigilancia** corre dentro de la página.
- El **envío a Telegram** lo hace Tampermonkey (`GM_xmlhttpRequest`), que tiene un permiso propio para conectar
  solo con `api.telegram.org`.

Las dos partes se hablan con eventos del documento.

---

## Instalación (Brave o Chrome, en Windows o Linux)

1. Instala la extensión **Tampermonkey** desde la tienda de extensiones de Chrome.
2. Abre `brave://extensions` (o `chrome://extensions`), entra en **Detalles** de Tampermonkey y activa
   **"Permitir scripts de usuario"** (*Allow User Scripts*). Sin esto, los navegadores recientes no ejecutan ningún script de usuario.
3. Pulsa el icono de Tampermonkey y luego **"Crear un nuevo script…"**. Borra la plantilla, pega el contenido de
   `sepe-vigia-citas.user.js` y guarda con **Ctrl+S**.
4. **Configura tu zona** (siguiente apartado) en ese mismo editor y vuelve a guardar.
5. **Crea tu bot de Telegram** (apartado "Avisos por Telegram"). Sin él no te llegará nada al móvil.
6. Abre la cita previa y rellena el formulario (código postal, trámite, subtrámite, DNI y captcha si lo pide)
   hasta la pantalla de canal. Arriba a la derecha aparece el panel **"Vigía SEPE"**. Pulsa **"Telegram…"** y
   pega la clave de tu bot.
7. Pulsa **"Probar aviso"** y permite las notificaciones cuando el navegador lo pregunte. Debe llegar un Telegram
   de prueba y verse una notificación. Si quieres pitidos, marca antes la casilla **"Sonido"**.
8. Pulsa **"Iniciar"**.

## Configuración

Todo está en el bloque `CONFIG`, al principio del script:

| Parámetro | Qué es | Por defecto |
|---|---|---|
| `PATRON_OFICINA` | **Obligatorio.** Expresión regular que debe encajar con el nombre de la oficina. Mientras siga el valor de ejemplo, el vigía no arranca. | `/\bTU_MUNICIPIO\b/i` |
| `NOMBRE_ZONA` | Nombre corto que sale en el panel y en los avisos. | `'mi zona'` |
| `MIRAR_DIRECCION` | Buscar el patrón también en la dirección. Amplía la búsqueda, pero puede dar falsos positivos (por ejemplo, "Camino de *tu municipio*" en otro pueblo). | `false` |
| `PATRON_CANAL` | Opción del desplegable que se vigila. | `/presencial/i` |
| `INTERVALO_SEG` / `VARIACION_SEG` | Espera entre comprobaciones y margen aleatorio. Mínimo forzado: 4 s. | `5` / `2` |
| `INTERVALO_MAX_SEG` | Espera máxima cuando hay fallos. | `300` |
| `FALLOS_PARA_AVISAR` / `FALLOS_PARA_PARAR` | Fallos seguidos para avisar y para parar. | `3` / `8` |
| `TELEGRAM`, `NOTIFICACION` | Activar o desactivar estos avisos. | `true` |
| `SONIDO` | Valor inicial de la casilla "Sonido" del panel. Lo que marques en el panel se recuerda en ese navegador. | `false` |
| `SEGUNDOS_PITIDOS` | Duración de los pitidos al encontrar cita (si el sonido está activado). | `15` |

Para saber cómo escribir el patrón, mira cómo nombra el SEPE las oficinas de tu municipio. Salen en la lista
cuando tienen hueco y siguen la forma `MUNICIPIO - SEPE` o `MUNICIPIO-CALLE - SEPE`. Si el municipio tiene
nombre en dos lenguas, pon los dos:

```js
PATRON_OFICINA: /\b(nombre uno|nombre dos)\b/i,
NOMBRE_ZONA: 'Mi municipio',
```

`\b` significa "límite de palabra": evita que un nombre corto encaje dentro de otra palabra.

Al actualizar el script pegando una versión nueva, vuelve a poner tu patrón. La configuración de Telegram no
se pierde, porque se guarda aparte.

## Avisos por Telegram (aviso principal, una o varias personas)

**Cada instalación usa su propio bot.** Este repositorio no incluye ninguno: ni clave, ni nombre, ni destinatarios.
No reutilices el bot de otra persona: sus avisos le llegarían a ella, y quien tenga la clave podría leer los tuyos.
Crear uno es gratis y lleva dos minutos:

1. En Telegram, abre **@BotFather** (con la marca de verificado), escribe `/newbot` y sigue los pasos. Al final te
   da la **clave del bot** (*token*). Trátala como una contraseña: no la compartas ni la guardes en el script.
   El script la guarda en el almacenamiento de Tampermonkey de tu navegador, no en el fichero.
2. Abre el enlace de tu bot (`t.me/<tu_bot>`) y pulsa **Iniciar**. **Cada persona que quiera recibir avisos hace
   lo mismo desde su cuenta.**
3. En el panel del vigía, pulsa **"Telegram…"** y pega la clave. El script pregunta a Telegram quién ha escrito al
   bot, apunta a todas esas personas y les envía "avisos de Telegram activados". El panel muestra cuántos
   destinatarios hay.
4. Si Tampermonkey pregunta si permites la conexión con `api.telegram.org`, elige **"Permitir siempre"**.

Para añadir a alguien más adelante: esa persona pulsa **Iniciar** en el bot y tú vuelves a pulsar
**"Telegram…"** dejando el campo vacío, para conservar la clave. Telegram solo recuerda durante 24 horas
quién ha escrito al bot, así que pulsa "Telegram…" en ese plazo.

Telegram recibe un mensaje en estos casos:
- **Hay cita**: oficina, primer hueco y otras oficinas de la zona con hueco.
- **Sesión perdida**: la página volvió al inicio y el vigía no está vigilando.
- **3 fallos seguidos**: un solo mensaje.
- **Vigía parado** tras 8 fallos.

## Uso diario

1. Abre la cita previa en una pestaña y llega a la pantalla de canal.
2. Comprueba que la línea **"Aviso principal, Telegram"** muestra tus destinatarios. Si sale en rojo
   ("¡no te llegará nada al móvil!"), pulsa "Telegram…".
3. Pulsa **Iniciar**. El panel muestra el número de comprobaciones, la hora de la última y el resumen
   ("N oficinas, X con hueco, 0 en tu zona"). El título de la pestaña lleva el contador.
4. **Cuando avise, ve a la pestaña y pulsa "Continuar" tú.** La sesión caduca en pocos segundos cuando hay
   oficinas en pantalla. La oficina ya está marcada y resaltada. Después eliges fecha, hora y datos y resuelves
   el captcha como siempre.
5. Si no llegas a tiempo, pulsa **Iniciar** otra vez.

Elementos del panel:
- **Iniciar / Parar**.
- **Probar aviso**: Telegram, notificación y, si está activado, sonido de prueba.
- **Telegram…**: configurar.
- Casilla **Sonido**: apagada por defecto; se recuerda.
- **–**: minimizar.

## Limitaciones y consejos

- **El ordenador no debe suspenderse.** Con el equipo dormido no se comprueba nada. Que se apague la pantalla no importa.
- **La pestaña debe seguir abierta y sin descartar.** Brave y Chrome pueden "dormir" pestañas inactivas para
  ahorrar memoria, y entonces la página se recarga y pierde el formulario. Añade el sitio a la lista
  "Mantener siempre activos" del ahorro de memoria, o desactiva esa función mientras vigilas.
- **Pestaña en segundo plano.** Los navegadores basados en Chromium ralentizan los temporizadores de las
  pestañas ocultas. Tras unos 5 minutos oculta, puede bajar a una comprobación por minuto. El sonido y los
  avisos siguen funcionando porque no dependen de temporizadores. Para el ritmo completo, deja la pestaña
  visible en su propia ventana. En Windows, una ventana tapada del todo por otras puede contar como oculta.
  La web no permite el truco habitual de usar un hilo de fondo (su CSP lo bloquea).
- **Sonido** (si lo activas). El navegador solo deja sonar audio después de que hayas hecho clic o pulsado una
  tecla en la página. Pulsar Iniciar o rellenar el formulario ya cuenta. Tras una recarga, haz clic en cualquier
  parte de la página.
- **Captcha.** La primera pantalla puede pedir captcha, y el código de la web muestra uno tras varias cargas de
  la pantalla de oficinas. Siempre lo resuelves tú. Cambiar de canal no lo pide.
- **Si no hay huecos en toda la provincia,** la propia página envía en cada comprobación un aviso al SEPE
  (`cita/crearDesbordamientoMapa`, con el documento introducido). Lo hace igual cuando cambias el canal a mano.
  El vigía no lo provoca aparte, pero sí multiplica las comprobaciones.
- **Si la web cambia** (identificadores, nombres de campos o direcciones), el vigía fallará y avisará con
  "fallos seguidos". Hay que revisar los selectores y el nombre de la petición.

## Pruebas

Necesitan Node 22 o superior y Chrome, Chromium, Brave o Edge instalado. No tocan la web real ni tu perfil:

```sh
node pruebas/probar.mjs            # NAVEGADOR=/ruta/al/navegador para elegir uno
```

El script arranca un navegador sin ventana con un perfil temporal, sirve el simulador (`pruebas/pagina.html` +
`pruebas/servidor.mjs`, con oficinas inventadas) y comprueba:

- sin configurar no arranca;
- (a) sin citas: no avisa, y advierte de que Telegram no está configurado;
- el sonido empieza apagado y la casilla se recuerda tras recargar;
- (b) citas solo fuera de la zona, con trampa en la dirección: no avisa;
- Telefónica elegida a mano: se ignora;
- (c) cita en la zona: avisa, marca la oficina con el hueco más temprano y prepara el mensaje de Telegram;
- error 500: baja el ritmo y se recupera;
- recarga completa: sigue vigilando;
- vuelta al inicio: avisa y se reanuda.

Para mirarlo a mano: `node pruebas/servidor.mjs`, abre `http://127.0.0.1:8765/citapreviasepe/`, elige la variante con
`http://127.0.0.1:8765/__variante?v=c` (`a`, `b`, `c` o `error500`) y pega el script en la consola del navegador
(F12) tras poner un `PATRON_OFICINA` que encaje con las oficinas de prueba, por ejemplo `/\bvilla norte\b/i`.
Fuera de Tampermonkey, Telegram responde "no disponible".

## Estado de la verificación

**En la web real** (pantalla de canal, octubre de 2026):
- El selector de canal, la petición `cita/cargaOficinasMapa`, el formato de la respuesta y el marcado de la lista
  de oficinas coinciden con lo descrito.
- 62 comprobaciones seguidas (una cada 6–8 s), todas con respuesta 200, sin errores, sin caducar la sesión y
  **sin falsos positivos**, con huecos reales en otras localidades de la provincia y ninguno en la zona vigilada.
- El sonido llegó a habilitarse tras interactuar con la página.

**Solo en simulación:**
- El aviso y el marcado cuando hay cita en la zona.
- El caso "sin huecos en toda la provincia".
- Los errores del servidor y la recuperación, la recarga y la vuelta al inicio.

**Sin verificar todavía:**
- Una cita real en la zona vigilada.
- El script instalado en Tampermonkey en la web real y el envío real a Telegram.
- La notificación del sistema con el permiso concedido.
- El ritmo real con la pestaña más de 5 minutos en segundo plano.
- El funcionamiento en Linux.
- Cuánto tarda en caducar la sesión una vez que aparecen oficinas.
