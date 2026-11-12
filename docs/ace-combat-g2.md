# Camino a un Ace Combat en las Even G2

Notas de diseño. No es una lista de deseos: cada pieza está filtrada por lo que
estas gafas pueden y no pueden hacer. Lo que aquí no aparece es porque no cabe.

## 1. La fantasía y el hierro

Ace Combat no es un simulador: es un **drama militar con forma de juego de
acción**. Lo que la gente recuerda no es el modelo de vuelo, es el briefing, la
radio, la música, el misil que entra, el as con nombre propio y el
`MISSION ACCOMPLISHED` en pantalla.

| Tenemos | No tenemos |
|---|---|
| 576×288, 16 verdes, y **se ve a través** | color, profundidad, cámara |
| touchpad: tap, doble tap, rueda, pulsación larga | stick analógico, gatillos, botones |
| GPS del móvil, IMU de las gafas | GPS propio, velocidad real, altitud |
| móvil: pantalla, altavoz, vibración, red | altavoz en las gafas |

De ahí salen cuatro reglas que no se negocian:

- **Nada de vuelo 3D.** El juego es 2D sobre un plano de la ciudad; la altura es
  ficción de cabina, no táctica.
- **La presentación vive fuera del cristal.** Música, briefing, gritos y
  cinemáticas van al móvil; las gafas son la cabina.
- **Trazo fino y alto contraste.** 16 grises y 1 Hz de radar: nada de rellenos,
  degradados ni vídeo.
- **El cuerpo es el mando.** El rumbo y el movimiento son físicos. Es el
  diferencial que ningún juego de móvil puede copiar.

## 2. Lo que ya está

- HUD AR de cabina: horizonte, cintas de rumbo y altitud, CDI, MFD, siluetas.
- Duelo de bloqueo con cono de visión, elección de blanco, modo silencio.
- Bots que fijan, aviso de `MISSILE` al 70 %, radio TTS, rangos S–D.
- Multijugador autoritativo, reconexión automática, wake lock.

## 3. Las siete piezas que faltan

### 3.1 Elenco de radio — coste S, impacto altísimo

Hoy hay **una** voz anónima narrando. Ace Combat tiene **personajes**: el AWACS
que te guía, el compañero que bromea, el as enemigo que te insulta.

- `radio.ts` pasa de «una frase por transición» a un **guion por misión** con
  `who: 'AWACS' | 'ALA' | 'ENEMIGO'`.
- Cada personaje: prefijo en el HUD (`[AWACS]`), `pitch`/`rate` distintos y su
  propio hueco anti-repetición.
- El motor de transiciones que ya existe no cambia: solo la tabla de guiones.
- 5–8 frases por misión bastan para que el juego parezca escrito.

En multijugador los personajes salen gratis del propio juego: **`ALA`** es el
jugador más cercano, **`ENEMIGO`** es el que lleva la marca `AS` (o el que te
está fijando) y el resto de frases las firma el **AWACS**, que es el único que
puede hablarle a todos por igual.

No hace falta API nueva. Es el mejor retorno por línea de código de toda la lista.

### 3.2 Tarjeta de partida y debriefing — coste S

Aquí no hay briefing por jugador: la partida es la misma para los ocho. Lo que
falta es una **tarjeta de partida** compartida en los 12 s de reinicio —nombre
del escenario, objetivo, cuenta atrás— y un debriefing al terminar (rango,
derribos, récord).

De paso arregla un problema actual: ahora mismo el marcador aparece y la partida
siguiente empieza sin explicar nada. Un cartel de 3 s convierte ese salto en una
transición.

### 3.3 Escenarios de partida — coste M

**No hay campaña.** En un PvP de 8 personas una historia scriptada no se puede
contar: cada partida la escriben los jugadores. Lo que sí falta es **un motivo
para la ronda** más allá del cronómetro. La misión de Ace Combat se traduce a
*modo de juego*, y el motor que hace falta ya está: visibilidad, cono, bloqueo y
rango.

| Escenario | Regla | Qué añade |
|---|---|---|
| `duel` | Gana quien cierra el primer bloqueo (lo de ahora) | El duelo puro |
| `sector` | Un círculo de 80 m que se mueve cada 90 s; gana quien sume 60 s dentro | Entrar en el sector te expone: objetivo y riesgo en el mismo sitio |
| `ace` | Un jugador lleva la marca `AS` (RCS ×4, visible desde lejos); gana quien lo fija, él gana si sobrevive | El as con nombre de Ace Combat, pero **humano**: el que va primero |

`ace` es la pieza más interesante: el villano de la partida es una persona, y
como cambia de ronda en ronda, la rivalidad sale sola. «Otra vez el mismo» vale
más que cualquier guion.

Coste real: `sector` es trigonometría de una zona (30 líneas y tests); `ace` es
un multiplicador de RCS por jugador (20 líneas). El resto —anuncio, marcador,
rango— ya existe.

### 3.4 Armas de verdad: munición y evasión — coste L, cambia el meta

Hoy, llegar al 100 % de bloqueo gana al instante. En Ace Combat el bloqueo
**lanza un misil** y el otro puede esquivarlo.

- Munición contada (2–4 por partida). Sin munición, el bloqueo solo sirve para
  asustar.
- Al lanzar, ventana de 2–3 s: el atacado la rompe girándose (el cono ya está),
  apagando el radar o alejándose N metros. Si la rompe, el misil falla y el
  atacante ha gastado la bala.
- Visual: símbolo que viaja del centro al blanco en el HUD; traza en el móvil.
- Riesgo: toca el corazón de las reglas y del protocolo (`missile`, `evade`).
  Merece su propio commit grande, con tests de servidor antes de tocar el HUD.

### 3.5 Audio de verdad — coste S-M

- Tono de bloqueo en dos fases (bajo intermitente → alto continuo) con WebAudio,
  sin assets.
- Música: dos o tres acordes en bucle, sintetizados. Nada de orquesta: no hay
  assets ni licencia.
- Stinger de derribo y de victoria, y **vibración** en el móvil.
- Ojo: el G2 no tiene altavoz. Suena en el móvil o en auriculares.

### 3.6 El as enemigo — coste M-L

Un bot con nombre propio que juega distinto: te sigue, **apaga su radar** para
romper tu bloqueo (el concepto ya existe) y reaparece a mitad de misión. Barra
de daño en el HUD y una frase propia al entrar en el sector.

### 3.7 Progresión — coste S si es local, M si es de servidor

Medallas y récord en `localStorage`: derribos totales, mejor rango, racha. Un
tercer perfil desbloqueable. Sin economía: nadie quiere grind en unas gafas.

## 4. Lo que no vamos a hacer

- **Dogfight 3D y maniobras post-stall:** no hay mando ni modelo de vuelo real.
- **Superponer cajas a aviones reales:** no hay cámara.
- **Cinemáticas y música orquestal:** no hay color, ni profundidad, ni assets.
- **Mundo abierto:** 258 m de radar y GPS a pie.
- **Campaña con historia y briefings:** es multijugador. No se puede contar una
  historia a ocho personas que juegan a la vez y en distinto orden; lo que se
  comparte es el escenario de la ronda, no el guion.

## 5. Orden recomendado: tres entregas

**Entrega 1 — «suena a Ace Combat»** (todo coste S).
Elenco de radio con personajes, briefing y debriefing en el móvil, tonos y
vibración. No se toca la física: se toca cómo se cuenta. Aquí está el grueso de
la sensación y cuesta poco.

**Entrega 2 — «cada ronda tiene motivo»** (coste M).
Tarjeta de partida compartida, escenarios `sector` y `ace` con su marcador, y
debriefing con rango y récord. Convierte el bucle infinito en un ciclo de
rondas con objetivo, sin inventar ninguna historia.

**Entrega 3 — «hay que ganárselo»** (coste L).
Misiles con munición y evasión, más el as enemigo. Cambia el meta del juego.

## 6. Idea diferencial: misiones ancladas en tu barrio

Los bots ya orbitan un ancla real: la primera posición GPS. Si el escenario
`sector` mueve su círculo entre coordenadas reales (una plaza, una esquina, un
parque a 150–300 m), la ronda se juega **andando por tu calle**, y el cono de
visión obliga a girarte físicamente para cubrir el sector. Eso no lo puede hacer
ningún juego de móvil y es la única razón por la que este juego necesita unas
gafas.

Riesgos: seguridad (no mandar a nadie a cruzar calles) y batería. Mitigación:
el círculo siempre dentro de un radio corto del ancla y un botón de «salir de la
ronda».

## 7. Restricciones de plataforma (recordatorio)

- **Display:** 576×288 lógicos. Una imagen no pasa de 288×144, así que el HUD se
  trocea en 4 tiles y se envían **en serie**.
- **Ritmo:** el radar llega a 1 Hz; el IMU se pinta cada 250 ms como mucho y
  solo si la actitud cambia más de 2°. Cada píxel viaja por el enlace del móvil.
- **Glifos:** la fuente del firmware no tiene `⚠` (U+26A0). Verificados:
  `↑ ↗ → ↘ ↓ ↙ ← ↖ · ° ² [ ] #`.
- **Recarga en caliente:** tras cambiar código hay que **reiniciar el
  simulador**; el HMR deja la página vieja registrada y la creación devuelve 1.
