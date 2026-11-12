# Aeronet · Even Realities G2

Juego de detección aérea multijugador para las gafas G2. Eliges una aeronave, el
servidor calcula qué contactos detecta tu radar y la pantalla de las gafas actúa
como HUD.

## Cómo funciona

Cada jugador es un avión con firma radar (RCS), potencia de radar y tiempo de bloqueo:

| Avión | RCS (m²) | Radar | Bloqueo | Consecuencia |
|---|---|---|---|---|
| F-35 | 0.001 | 1.00 | 18 s | Ve al Su-27 a 480 m; a otro F-35 solo a 90 m |
| Su-27 | 12 | 0.55 | 10 s | Ve al Su-27 a 264 m; al F-35 a 90 m |

Regla de detección (ecuación radar simplificada, en `src/geo.ts` y `server/index.mjs`):

```
alcance_km = max(0.09, 4.3 × 0.06 × radar_observador × (rcs_objetivo)^0.25 × silencio)
```

El factor `silencio` es `1` con el radar encendido y `0.55` con el radar apagado,
y se aplica **a los dos lados**: el que calla ve menos y también es más difícil
de ver.

El `0.06` es la **escala urbana**: los alcances están calibrados para jugar
caminando, no para aviación real. El `0.09` (90 m) es el **suelo visual**: nadie
es invisible a menos de 90 m, o el sigilo rompería el juego a escala de barrio.

**La visibilidad se decide en el servidor.** El cliente nunca recibe la posición
de un contacto que no puede ver, así que el sigilo no se puede falsear leyendo
el tráfico WebSocket.

## Reglas de partida

- **Duelo de bloqueo:** mantén fijado tu blanco. Si no eliges, se bloquea el
  contacto visible más cercano. Si pierdes el fijado, el contador vuelve a cero.
- **Elegir blanco:** con la rueda en la vista de radar. Si el elegido deja de
  verse, se suelta y vuelve el automático al tick siguiente.
- **Modo silencio:** pulsación larga. Apagar el radar te hace difícil de ver,
  pero también reduces lo que tú ves (×0.55 en ambos sentidos). El suelo visual
  de 90 m sigue mandando: nadie desaparece del todo.
- **Cono de visión:** solo se fija lo que se tiene a la vista. Hay que estar a
  menos de `lock.rangeM` (250 m) y dentro de un cono de `lock.fovDeg` (90°)
  respecto al rumbo. Sin rumbo fiable (móvil parado, GPS sin `heading`) se
  permite 360° para que el juego siga siendo jugable.
- **5 minutos:** al agotarse el tiempo gana quien tenga más bloqueo acumulado.
- **Reinicio:** 12 s de marcador y empieza otra partida.
- **Memoria de pings:** un contacto que dejas de ver no desaparece de golpe;
  queda 15 s como última posición conocida (`? Su-27 320m 8s`).

## Arrancar

Dos terminales:

```bash
npm run server   # servidor del juego en ws://0.0.0.0:8787
npm run dev      # Vite en :5173
```

Y en una tercera (o en el móvil):

```bash
npm run simulate                                  # simulador de escritorio
npx evenhub qr -i <TU_IP_LAN> -p 5173 --http      # gafas reales
```

En la app companion: indicativo, aeronave y **Conectar**.

## Qué verás

Todo el display es un HUD de realidad aumentada tipo caza: no hay contenedores
de texto, la pantalla se pinta entera y el texto va dentro del canvas.

```
┌───────────────────────────────────────────────────────┐
│ GPS ▮▮▮▮ 9m   315  330 ▼345  000  015   030      ┌──┐ │
│ SPD        ┊    ▼        ✛        ▲          ┊   │··│ │  MFD
│  5.4       ┊  ─┬─┬─┬─┬─┬─  TGT +12      ┊   └──┘ │
│  KPH       ┊      ┌ ┌─ ─┐ ┐              ┊       650 │  SPD / ALT
│            ┊      │  ✛   │              ┊          M │
│            ┊      └ FLANK │              ┊   WDE     │
│            ┊        5.0/10               ┊           │
│            ┊       220m ▼1.2  A+12m      ┊           │
│ Su-27                  ! F-35 A 71 m           4:56    │
│ R 264 m                                TAP: ficha     │
└───────────────────────────────────────────────────────┘
```

- **Horizonte artificial:** se inclina con el **IMU** de las gafas y se desplaza
  con el cabeceo, con marcas cada 10°. Sin símbolo de avión en el centro.
- **Cinta de rumbo:** escala deslizante centrada en tu **rumbo GPS**, con la
  marcación del blanco fijado como triángulo. Sin deriva (parado), se ancla al
  blanco para no quedar ciega.
- **CDI:** aguja de desviación al blanco, saturada a ±60°, con el desvío en
  grados bajo la aguja.
- **SPD / ALT:** velocidad y altitud del GPS del móvil, con cintas verticales.
  Si no hay GPS, la posición de respaldo trae una altitud fija para poder probar.
- **Calidad de GPS:** barras y precisión en metros arriba a la izquierda;
  `GPS JAM` parpadea si el error pasa de 60 m o la posición es simulada.
- **MFD:** radar táctico pequeño arriba a la derecha con todos los contactos.
- **Selector de alcance:** `WDE` / `MID` / `NRW`. Se cambia con la **rueda**
  (arriba acerca, abajo aleja).
- **Contactos:** cada enemigo con la **silueta de su caza** (F-35 corto y ancho,
  Su-27 largo y estrecho), indicativo, distancia y **tasa de cierre**
  (`▼` se acerca, `▲` se aleja). Los que quedan fuera de la escala elegida
  aparecen como flecha en el borde con su distancia real.
- **Blanco fijado:** corchetes con el progreso de bloqueo en arco, la distancia,
  el cierre y la **altitud relativa** (`A+12m`).
- **Aviso:** `! F-35 A 90 m` (amenaza), `!! TE BLOQUEAN · X`, `!! MISSILE · X`
  cuando el que te fija pasa del 70 % de su bloqueo, o `BLOQUEANDO · X`;
  parpadea cuando es una amenaza.
- **Resultado:** `VICTORIA · S` / `GANA X` / `EMPATE · D` y cuenta atrás, en panel
  centrado. La nota sale del mejor bloqueo de la partida contra lo que pide tu
  avión: **S** derribo, **A** victoria por tiempo, **B** ≥75 %, **C** ≥35 %,
  **D** el resto.
- **Radio:** voz sintetizada (`es-ES`) con el guion de un juego de cabina — saludo
  al entrar en vuelo, contacto nuevo con rumbo y distancia, blanco fijado,
  «mantén el bloqueo» al 50 %, aviso cuando te fijan, grito de misil, resultado
  y partida nueva. Se enciende y apaga con el botón **Radio** del móvil y se
  recuerda entre sesiones.
- **Tap:** alterna radar ↔ ficha de tu avión (también en panel centrado).
- **Rueda:** en el radar elige blanco; en la ficha cambia el alcance
  (`WDE` / `MID` / `NRW`).
- **Pulsación larga:** enciende o apaga el radar (modo silencio).
- **Doble tap:** sale.
- **Companion:** elección de aeronave, estado de conexión y un radar en canvas.

## Bots

El servidor crea dos contactos para poder probar sin segunda persona:

- `FLANKER-1` (Su-27) orbita a 220 m — siempre visible.
- `GHOST-1` (F-35) oscila entre 60 m y 400 m con periodo de 75 s: aparece,
  se desvanece al pasar de 90 m y vuelve. Es la demostración del sigilo.

La sala se reinicia (y los bots se re-anclan) cuando se queda vacía.

## Estructura

```
src/main.ts      bridge, contenedores y eventos de las gafas
src/hud.ts       qué texto se pinta en cada contenedor
src/track.ts     memoria de pings (contactos frescos vs última posición conocida)
src/net.ts       cliente WebSocket
src/location.ts  posición (GPS del móvil, con respaldo simulado)
src/ui.ts        UI companion + radar en canvas
src/scope.ts     geometría del radar: posición, siluetas y etiquetas (puro)
src/instruments.ts etiquetas e instrumentos del HUD: cierre, GPS, escalas (puro)
src/imu.ts       actitud desde el IMU: alabeo y cabeceo (puro)
src/screen.ts    HUD AR a pantalla completa: canvas 576x288 → 4 PNG
src/geo.ts       haversine, rumbo, alcance radar
src/shared/aircraft.json   perfiles y reglas (compartido con el servidor)
server/rules.mjs reglas puras: visibilidad, bloqueo, partidas y bots
server/index.mjs servidor WebSocket (solo transporta; no decide nada)
```

## Tests

```bash
npm test          # una pasada
npm run test:watch
```

| Archivo | Qué protege |
|---|---|
| `src/geo.test.ts` | haversine, rumbos, ida y vuelta de coordenadas, alcance radar con suelo visual |
| `src/track.test.ts` | memoria de pings: frescos, viejos, olvido a los 15 s y orden |
| `src/hud.test.ts` | prioridad de avisos, barra de bloqueo, resultado, ficha del avión |
| `src/location.test.ts` | GPS: lectura inicial, actualizaciones, `null`/`0,0`, respaldo a los 8 s y limpieza |
| `src/net.test.ts` | WebSocket: join al abrir, radar, JSON inválido, errores, `sendPos` y reconexión |
| `src/scope.test.ts` | radar: posición por distancia/rumbo, siluetas (simétricas, morro al norte, tipos distinguibles) y colocación de la etiqueta contra los bordes |
| `src/screen.test.ts` | teselado 2x2 (cubre la pantalla, tiles ≤288x144), cuantización a 16 grises, hashes de tile y pintado completo de cada estado con canvas falso |
| `src/instruments.test.ts` | tasa de cierre, calidad de GPS, escalas de alcance y altitud relativa |
| `src/imu.test.ts` | actitud: recto, alabeo, cabeceo, calibración, muestras inválidas y media circular |
| `src/reconnect.test.ts` | espera creciente con tope y ruido, `error`+`close` como un solo fallo, reinicio del historial |
| `src/wakelock.test.ts` | wake lock: soporte ausente, petición única, permiso denegado, release del navegador y recuperación |
| `src/radio.test.ts` | guion de radio (prioridades, transiciones, contactos) y huecos entre frases |
| `server/rules.test.mjs` | visibilidad por RCS, bloqueo y reinicio de contador, victoria, tiempo agotado, sala vacía |
| `server/server.test.mjs` | contrato del WebSocket contra el servidor real (welcome, radar, JSON inválido) |

Las reglas viven en `server/rules.mjs` sin red ni relojes propios (el tiempo se
inyecta), así que los tests simulan partidas enteras en milisegundos. `npm run
build` también comprueba los tipos de los tests.

## Notas de desarrollo

- **Reinicia el simulador tras cambiar el código.** Recargar en caliente deja la
  página anterior registrada y `createStartUpPageContainer` devuelve `invalid`
  (1): los contenedores nuevos “no existen”. En frío se crea sin problema.
- **Glifos:** la fuente del firmware no incluye `⚠` (U+26A0); el simulador lo
  delata con `lv_draw_letter: glyph dsc. not found for U+26A0`. El HUD usa ASCII
  (`!`, `!!`) y caracteres verificados: `↑ ↗ → ↘ ↓ ↙ ← ↖ · ° ² [ ] #`.
- **Imagen:** `ImageContainerProperty` admite 20–288 × 20–144, no hay un
  contenedor que cubra los 576×288 del display. Por eso el HUD se pinta en un
  canvas lógico de 576×288 y se trocea en **4 tiles** 2×2. Se envían como PNG
  con `updateImageRawData`, **en serie** (una imagen en vuelo a la vez).
- **IMU a 1 Hz:** el horizonte cruza los 4 tiles, así que el IMU va a `P1000`
  a propósito. A `P300` movería ~80 KB/s solo en horizonte; a `P1000` coincide
  con el tick del radar y no cuesta ancho de banda. Hay además un umbral de 2°
  para no repintar por ruido.
- **Altitud a pie:** el GPS del móvil da ±10 m, así que `A+12m` es decorativo:
  sirve para que el HUD se comporte como uno de cabina, no para táctica real.
- **Enlace:** si el socket se cae, el cliente reconecta solo con espera creciente
  (1, 2, 4, 8, 15 s y tope, con ±15 % de ruido para que ocho móviles no vuelvan
  sincronizados). El chip del móvil pasa a `RECONECTO · n s`. Un error **con
  mensaje** del servidor (`sala llena`, `indicativo repetido`) no se reintenta:
  volver a pedir lo mismo daría el mismo error.
- **Pantalla encendida:** con la pantalla apagada el navegador congela la
  geolocalización y el jugador se queda congelado en el radar de los demás. Se
  pide `Screen Wake Lock` al conectar (`PANTALLA FIJA`) y se suelta al salir. El
  navegador lo suelta solo al pasar a segundo plano, así que al volver se vuelve
  a pedir — y se reintenta el socket si murió mientras estaba oculto.
- **Ancho de banda:** un frame completo son ~4 PNG. Para que no se vayan todos
  por el enlace cada segundo, cada tile se hashea y solo se reenvía si cambió
  (el reloj cambia 1 tile, no 4). Además se cuantiza a los 16 grises del panel
  antes de codificar: mismo aspecto en las gafas y ~35 % menos bytes.
- **Radio:** el umbral de `MISSILE` (70 %) es **uno solo** para el HUD y para la
  voz (`MISSILE_PERCENT` en `hud.ts`): lo que se ve es lo que se oye. El servidor
  no decide umbrales, solo manda el `percent` del que te fija.
- **Rango:** lo calcula el servidor por jugador dentro de `result`, porque dos
  jugadores ven el mismo `winner` pero no la misma nota.

## Límites conocidos

- El G2 no tiene GPS: la posición viene del teléfono (`getAppLocation`). Bajo
  techo no hay señal. El respaldo de posición (Retiro) **solo se activa en
  desarrollo**: en producción, sin GPS no se emite posición en vez de inventar
  una y apilar a todos los jugadores en el mismo punto.
- El bucle de render es de 1 Hz a propósito: cada actualización viaja por el
  enlace con el móvil.
- Los bots **no te fijan**, así que el aviso de `MISSILE` y la voz de amenaza
  solo aparecen jugando contra otra persona.
- La voz depende del motor del sistema (`speechSynthesis`). En iOS necesita el
  gesto de **Conectar** para arrancar; si el móvil está en silencio, no suena.
- Al reconectar se abre un socket nuevo y el servidor da de alta un jugador
  nuevo: si el anterior todavía no ha caducado (TCP que no ha avisado), durante
  unos segundos aparecen dos indicativos iguales. Se arregla solo cuando el
  servidor cierra el socket viejo; falta un *takeover* explícito por indicativo.
- `whitelist` del permiso `network` en `app.json` hay que actualizarla con el
  host real del servidor antes de publicar.
