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
alcance_km = max(0.09, 4.3 × 0.06 × radar_observador × (rcs_objetivo)^0.25)
```

El `0.06` es la **escala urbana**: los alcances están calibrados para jugar
caminando, no para aviación real. El `0.09` (90 m) es el **suelo visual**: nadie
es invisible a menos de 90 m, o el sigilo rompería el juego a escala de barrio.

**La visibilidad se decide en el servidor.** El cliente nunca recibe la posición
de un contacto que no puede ver, así que el sigilo no se puede falsear leyendo
el tráfico WebSocket.

## Reglas de partida

- **Duelo de bloqueo:** mantén fijado tu contacto visible más cercano. Si lo
  pierdes, el contador vuelve a cero.
- **5 minutos:** al agotarse el tiempo gana quien tenga más bloqueo acumulado.
- **Reinicio:** 12 s de marcador y empieza otra partida.
- **Memoria de pings:** un contacto que dejas de ver no desaparece de golpe;
  queda 15 s como última posición conocida (`? Su-27 · 320 m · hace 8 s`).

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

- **HUD (576×288):** aviso superior (`⚠ F-35 A 120 m`, `⚠ TE BLOQUEAN · GHOST-1`),
  barra de bloqueo (`#####----- 12/18 s`), contactos con rumbo y distancia, y pie
  con las acciones.
- **Resultado:** `VICTORIA` / `GANA X` / `EMPATE` y cuenta atrás de reinicio.
- **Tap:** alterna radar ↔ ficha de tu avión.
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
| `server/rules.test.mjs` | visibilidad por RCS, bloqueo y reinicio de contador, victoria, tiempo agotado, sala vacía |
| `server/server.test.mjs` | contrato del WebSocket contra el servidor real (welcome, radar, JSON inválido) |

Las reglas viven en `server/rules.mjs` sin red ni relojes propios (el tiempo se
inyecta), así que los tests simulan partidas enteras en milisegundos. `npm run
build` también comprueba los tipos de los tests.

## Límites conocidos

- El G2 no tiene GPS: la posición viene del teléfono (`getAppLocation`). Bajo
  techo no hay señal y el juego usa la posición de respaldo.
- El bucle de render es de 1 Hz a propósito: cada actualización viaja por el
  enlace con el móvil.
- `whitelist` del permiso `network` en `app.json` hay que actualizarla con el
  host real del servidor antes de publicar.
