# FotoCaza 📸

Juego para el móvil: sal a la calle, encuentra criaturas en el mapa y captúralas lanzándoles un orbe.
**Las criaturas son las imágenes que subáis a un repositorio de GitHub.** Cada vez que alguien sube una
imagen nueva a la carpeta `imagenes/`, aparece en el juego para todos.

- Mapa real con tu posición GPS (OpenStreetMap).
- Las criaturas aparecen alrededor y cambian cada 15 minutos. **Todos los jugadores ven las mismas en el mismo sitio.**
- Pantalla de captura: desliza el orbe hacia arriba. Si aciertas cuando el anillo es pequeño, más probabilidad.
- Opción de cámara (📷) para ver la criatura sobre la calle.
- Rarezas (común, raro, épico, legendario), experiencia, niveles y un álbum con las que te faltan.
- Se instala en el móvil como una app (no hace falta Play Store ni App Store).

## Ponerla en marcha (10 minutos)

1. Crea un repositorio **público** en GitHub (por ejemplo `fotocaza`).
2. Sube todos estos archivos a la raíz del repositorio (`index.html`, `app.js`, `osm.js`, `style.css`, `config.js`,
   `sw.js`, `manifest.webmanifest`, `icon.svg`, `editor.html`, `editor.js`, `paradas.json`, `cloud.js`, `firebase-reglas.txt`, `criaturas.html`, `criaturas.js` y la carpeta `imagenes/`).
3. En el repositorio: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
4. En un par de minutos la app estará en `https://TU-USUARIO.github.io/fotocaza/`.
5. Ábrela en el móvil y, en el menú del navegador, pulsa **"Añadir a pantalla de inicio"** / **"Instalar app"**.

No hace falta configurar nada: al estar en GitHub Pages, la app detecta sola de qué repositorio leer las imágenes.

## Añadir criaturas

Sube imágenes a `imagenes/` (desde la web de GitHub: *Add file → Upload files*). El nombre del archivo es el nombre de la criatura.

**Categorías:** la subcarpeta decide la sección del álbum (`imagenes/bichos/…`, `imagenes/pokemon/…`).
Las imágenes sueltas en `imagenes/` van a «Otros».

**Rarezas**, de más fácil a más difícil de encontrar y de capturar (y con más experiencia):

| Rareza | Probabilidad de aparecer |
|---|---|
| Común | ~55 % (1 de cada 2) |
| Raro | ~25 % (1 de cada 4) |
| Superraro | ~11 % (1 de cada 9) |
| Épico | ~5 % (1 de cada 20) |
| Legendario | ~2 % (1 de cada 50) |
| Mítico | ~0,7 % (1 de cada 140) |
| Astral | ~0,25 % (1 de cada 400) |
| Secreto | ~0,05 % (1 de cada 2000) |

(Si una rareza no tiene ninguna imagen, su probabilidad se reparte entre las demás. Se puede ajustar en `config.js` con `rarityWeights`.)

| Archivo | Criatura |
|---|---|
| `gato.png` | Gato · Otros · común |
| `bichos/mariquita_raro.png` | Mariquita · Bichos · rara |
| `bichos/legendario/escarabajo.png` | Escarabajo · Bichos · legendaria |
| `pokemon/pato_superraro.png` | Pato · Pokemon · superrara |
| `pokemon/fantasma_secreto.png` | Fantasma · Pokemon · secreta |

Las secretas ni siquiera muestran su silueta en el álbum hasta capturarlas.
Los PNG con fondo transparente quedan mucho mejor. Las imágenes nuevas tardan hasta 10 minutos en aparecer
(o pulsa **Ajustes → Recargar**).

Mientras la carpeta esté vacía, la app usa unas criaturas de demostración.

## Cómo encontrar criaturas

- Las criaturas están repartidas por todo el mapa, pero **solo las ves cuando estás cerca** (a unos 90 m).
  Hay que salir a explorar.
- Las de rareza **épica o mejor** que haya por la zona (hasta ~700 m) salen en la barra **📡 Raras por la zona**,
  arriba, con su distancia aproximada. Pulsa una y el mapa marca un **círculo de ~150 m** por donde anda
  (no su punto exacto). Cuando te acerques lo bastante, aparecerá y te avisará.
- Las secretas salen en la barra como «?» hasta que captures una.
- Las **paradas se ven siempre**, estés donde estés.
- Las distancias se cambian en `config.js` (`revealRadius`, `radarRange`, `hintRadius`).

## Criaturas brillantes ✨

Más o menos **1 de cada 200** criaturas sale **brillante**: otros colores y un efecto holográfico (foil) que se mueve.
Es la misma para todos (si a ti te sale brillante en un sitio, a tus amigos también). Al abrir la captura avisa
«✨ ¡Es brillante!», da +1000 XP extra y en el álbum se marca con borde arcoíris y la etiqueta **✨ Brillante**.
Los huevos y las paradas abonadas también pueden dar brillantes. La probabilidad se cambia en `config.js` (`shinyRate`).

## Maestría de barrios (Región de Murcia)

Cada captura que hagas **dentro de la Región de Murcia** suma puntos al barrio, pedanía o diputación donde estés
(en Murcia ciudad, el barrio: La Catedral, La Fama…; fuera, la pedanía o diputación; si no hay, el municipio):

- +1 por captura · +1 si es una especie nueva en ese barrio · +5 si es brillante.
- Niveles: 🧭 Explorador (1) · 🥉 Bronce (10) · 🥈 Plata (30) · 🥇 Oro (70) · 💠 Platino (150) · 💎 Diamante (300) · 👑 Leyenda (600).
  Cada nivel nuevo da todocoins.
- Arriba a la derecha sale el barrio en el que estás; tócalo (o **Álbum → 🏘️ Barrios**) para ver todos tus barrios por municipio.

Los barrios salen de OpenStreetMap: no se descarga ningún mapa, solo se pregunta en qué barrio cae cada captura
y se guarda la respuesta. Si no hay conexión, la captura se apunta y se asigna al barrio más tarde.

## Cómo capturar

- **Lanza** deslizando el orbe hacia arriba. La dirección del dedo es hacia dónde va; la fuerza, a qué altura llega:
  floja → se queda corta y bota en el suelo; demasiado fuerte → pasa por encima y cae detrás de la criatura.
- La escena tiene **profundidad real**: el orbe vuela en 3D, se hace pequeño al alejarse y proyecta su sombra en el suelo.
  Las criaturas más raras además se acercan y se alejan, así que su tamaño (y el punto al que apuntar) cambia.
- **Anillo de color:** se encoge una y otra vez. Si aciertas cuando es pequeño: *¡Bien!* (×1), *¡Genial!* (×1,4) o *¡Excelente!* (×1,8).
  Su color dice lo difícil que es la criatura: verde, amarillo, naranja o rojo.
- **Curva:** gira el orbe en círculos (más de una vuelta) antes de lanzarlo. Brillará en dorado, saldrá con efecto
  y vuelve a donde apuntaste. Da un ×1,35 extra que se suma al del anillo.
- **Saltos:** las criaturas a partir de raras saltan de vez en cuando (primero se agachan: ¡es el aviso!). Si el orbe llega
  mientras están en el aire, fallas.
- Si se escapa del orbe puede huir (las más raras huyen más). Las criaturas brotadas de un abono nunca huyen.
- Sonido y vibración se pueden quitar en **Ajustes**.

## Fusión y huevos

Cuando tengas **5 copias de la misma criatura** (en el álbum salen con un 🥚 y borde dorado), ábrela y pulsa
**Fusionar 5 en un huevo**. Las 5 copias se convierten en un huevo de **su misma rareza y familia** (su categoría/carpeta).

Los huevos se abren **andando** con la app abierta (botón 🥚 de la barra inferior). Cuanto más raro, más hay que andar:

| Huevo | Distancia |
|---|---|
| Común | 1 km |
| Raro | 2 km |
| Superraro | 3 km |
| Épico | 5 km |
| Legendario | 7 km |
| Mítico | 10 km |
| Astral | 12 km |
| Secreto | 15 km |

- Hay **3 incubadoras**: los huevos que no caben esperan su turno y entran solos cuando se libera una.
- Al eclosionar sale una criatura **de la misma familia**: 55 % de la misma rareza, 25 % una más, 5 % dos más
  y 15 % una menos (si la familia no tiene esa rareza, la más cercana). El panel enseña los porcentajes de cada huevo.
- La distancia se mide con el GPS: no cuentan los saltos de señal ni ir en coche o bus (más de 25 km/h).
  Solo cuenta mientras la app está abierta (una web no puede usar el GPS cerrada).
- En **Modo prueba**, moverte tocando el mapa también cuenta como andar.

## Bienvenida

La primera vez que alguien abre el juego ve una pequeña guía de 6 pantallas y recibe 5 superorbes. Se puede repetir en **Ajustes → ❓ Ver la bienvenida otra vez**.

## Quimeras 🧬

En el álbum, botón **🧬**: elige dos de tus criaturas y cómo cortarlas (◧ vertical u ⬒ horizontal) y verás la mezcla
al momento. Por 25 todocoins nace una **criatura nueva** con un nombre mezclado (lo puedes cambiar).
- Tus quimeras se quedan en tu colección.
- Con la sesión iniciada se comparten: en la **galería de los amigos** cada uno vota con ❤️ las que más le gustan
  (las tuyas no las puedes votar) y la más votada de la semana se lleva la **👑 corona**.

## Caza de color 🎨

En 📋 → «Caza de color» ves el **color del día** (el mismo para todos los amigos). Busca algo de ese color en la vida
real (una flor, un coche, una puerta, una camiseta…) y hazle una foto de cerca. El juego mira qué color domina en la
foto y, si es el del día, **invoca una criatura cuya imagen es de ese color** (las raras salen más de lo normal).
- 3 intentos al día y una invocación. Los blancos, negros y grises no cuentan: acércate para que el color llene la foto.
- 🔒 La foto **no se sube a ningún sitio**: se analiza en tu móvil y se descarta.
- Debajo ves qué amigos lo han conseguido hoy.

## Combo de capturas ⚡

Si capturas otra criatura antes de 3 minutos, el combo sube (×2, ×3… hasta ×10) y cada paso da un 10 % más de XP.
Encima de la barra de abajo ves el combo y el tiempo que te queda. Si una criatura se te escapa y huye, lo pierdes.
Tu récord sale en tu perfil y en la clasificación (pestaña ⚡ Combo).

## Sensor de criaturas ocultas 📡

Además de las criaturas normales hay **criaturas ocultas** (suelen ser más raras) que no salen en el mapa ni en la
barra de raras. Solo las detecta el sensor, y **solo mientras andas**: a menos de 150 m el móvil vibra, pita y el
📡 de abajo a la izquierda late. Cuanto más cerca estás, más deprisa y más fuerte. No hay flechas ni distancias:
prueba direcciones y sigue la vibración. A 25 m la encuentras y empieza la captura.
- En iPhone el navegador no permite vibrar: allí te guías por el pitido (con el sonido activado) y por el 📡.
- Cambian cada 15 minutos, como las demás.

## Niebla de exploración

El mapa está cubierto de una niebla suave que se despeja por donde pasas (unos 70 m alrededor). Lo explorado se queda
guardado y cuenta en tu perfil como «🌫️ Zonas exploradas». Si prefieres el mapa limpio: **Ajustes → Niebla de exploración**.

## Clima y hora reales

Arriba a la derecha ves el tiempo real de tu zona (☀️ 🌧️ ❄️ 🌫️ 💨 ⛈️ 🌙). Cambia lo que aparece:
- Salen **el triple** las criaturas cuyas **etiquetas** (las del editor de criaturas) encajan con el tiempo:
  lluvia → `#lluvia #agua #mar #pez #rana` · sol → `#sol #fuego #calor #verano #playa` · nieve → `#nieve #hielo #frio`
  · niebla → `#niebla #fantasma #misterio` · tormenta → `#tormenta #electrico #rayo` · viento/nubes → `#aire #volador`
  · noche → `#noche #oscuridad #luna #fantasma #cosmico #estrella`.
- **De noche** el mapa se oscurece y las criaturas épicas o mejores salen un 50 % más.

Se usa Open-Meteo (gratis, sin claves) y solo se envía la zona aproximada (unos 10 km), no tu posición exacta.

## Eventos

Los eventos activos salen arriba del panel 📋 (y avisan al empezar):
- **⏰ Hora feliz** (todos los días de 18:00 a 19:00): doble XP y doble de todocoins en paradas.
- **✨ Fin de semana brillante** (sábado y domingo): las brillantes salen el triple.
- **⭐ Familia de la semana**: cada semana una familia de vuestras imágenes sale el triple.
- **🌅 Hora dorada** (amanecer y atardecer reales de tu zona, calculados con la posición del sol): el mapa se vuelve dorado, XP ×2 y el doble de brillantes. Empieza 30 min antes de la puesta de sol (y 10 min antes del amanecer).
- **Los vuestros**, en `eventos.json` (en la raíz del repositorio). Ejemplo:
  `{"nombre":"Noche de Halloween","icono":"🎃","desde":"2026-10-31T18:00","hasta":"2026-11-01T02:00","etiqueta":"fantasma","familia":"Pou Series","xp":2,"brillo":2,"monedas":1.5,"texto":"¡Fantasmas por todas partes!"}`
  (`familia` y `etiqueta` hacen que esas criaturas salgan el triple; `xp`, `brillo` y `monedas` multiplican, hasta ×5).

## Funciones sociales (con la sesión iniciada)

- **📣 Avisos de raras:** al encontrar una criatura épica o mejor, pulsa **📣 Avisar** en la captura. A tus amigos
  cercanos (menos de 3 km) les llega un aviso y la ven en su barra de raras con tu nombre y la zona exacta.
- **📰 Novedades:** tus momentos destacados (brillantes, capturas épicas o mejores, huevos raros, subir de nivel,
  barrios que suben) se publican solos y salen en **Jugadores → Novedades**. Un punto rojo en tu nivel avisa de que hay algo nuevo.
- **🎁 Regalos:** las paradas a veces te dan un regalo (siempre en la primera visita; puedes guardar hasta 10).
  Solo se pueden **enviar a amigos**: abre su perfil en Jugadores, escribe un mensaje y pulsa Enviar. Cuando te llega
  uno, tu nivel muestra 🎁; ábrelo en Jugadores y te tocará algo al azar (orbes, todocoins, caramelos… ¡o un huevo!).
- **❤️ Reacciones:** en el perfil de un amigo puedes reaccionar con ❤️ 🔥 😂 👏 😮 (una por persona). En tu perfil ves las que te han dejado.
- **🏅 Logros:** 17 medallas que se desbloquean solas (primera captura, 50 capturas, brillante, legendario, 10 km, barrio en Oro, 5 regalos…). Cada una da 15 todocoins y se ve en tu perfil.
- **🎖️ Títulos:** con logros, niveles, rachas y el reto semanal desbloqueas títulos («Cazador/a», «Leyenda viva», «Racha de fuego 🔥»…). Elige uno en «Editar perfil» y saldrá bajo tu nombre.
- **📋 Misiones diarias:** botón 📋 abajo a la derecha. 3 misiones cada día, **las mismas para todos los amigos**. Cada una da 10 todocoins y 100 XP; completar las 3 suma un día de **racha 🔥**, y cada 7 días seguidos hay premio (caramelo dorado, 3 ultraorbes y 50 todocoins).
- **🏆 Reto semanal:** cada semana hay un reto para todos (más capturas, más km, más paradas o más raras). En **Jugadores** ves la clasificación en directo; si llegas a la meta ganas 40 todocoins y 5 superorbes.
- **📖 Comparar álbumes:** en el perfil de un amigo pulsa «Comparar álbumes»: verás las criaturas en común, las que él tiene y tú no (en silueta) y las que solo tienes tú.
- **🔄 Intercambios:** en el perfil de un amigo pulsa «Proponer intercambio»: ofreces una criatura repetida (te quedas al menos con una) y pides una de su álbum. Tu amigo la acepta o rechaza en Jugadores (tu nivel muestra 🔄) y el cambio se hace en los dos álbumes.
- **🫣 Escondites:** en la tarjeta de una criatura repetida pulsa «Esconder una para mis amigos»: se queda escondida donde estás 7 días (máx. 3 a la vez), con una pista. A tus amigos a menos de 3 km les sale en la barra de raras (🫣 @tunombre) con una zona aproximada; al llegar ven un 🫣 en el mapa y quien lo toca se queda una copia (+10 todocoins). Tú ganas 15 todocoins por cada amigo que la encuentre, y en Jugadores ves quién la ha encontrado. Ojo: tus amigos ven el sitio donde la escondes.
- **💬 Notas en paradas:** al abrir una parada en la que estás puedes dejar una nota para tus amigos («aquí salen muchas de agua», «¡pasad por aquí a las 18:00!»). Una por parada (la nueva sustituye a la anterior, y la puedes borrar con ✕); duran 30 días. Las paradas con notas de amigos llevan un 💬 en el mapa y, al pasar cerca, te avisa.
- **🧠 ¿Quién es?:** en 📋 → «¿Quién es? del día»: una silueta (la misma para todos) y 4 nombres, con un solo intento. Si aciertas: 20 todocoins, 80 XP y racha de aciertos. Debajo ves qué amigos han acertado hoy. El botón 📋 lleva un 🧠 mientras no hayas jugado.
- **🏆 Clasificaciones:** en Jugadores, las pestañas de la clasificación ordenan a todos por XP, álbum, km andados, zonas exploradas, brillantes o aciertos del ¿Quién es?
- **⚔️ Duelos:** en el perfil de un amigo pulsa «Retar a un duelo» y elige 3 criaturas en orden. Tu amigo ve solo de qué rareza son y elige las suyas y su orden; luchan 1ª contra 1ª, 2ª contra 2ª y 3ª contra 3ª. El poder (⚔️) depende de la rareza, de si la tienes brillante y de cuántas copias tienes, más un poco de suerte. Gana quien gane 2 rondas: 25 todocoins y 100 XP (empate 10, perder 5).
- **👹 Jefe de la semana:** en 📋 o en Jugadores. Un jefe (el mismo para todos) que derrotáis entre todos capturando: cada captura le quita vida según su rareza (las brillantes, el doble). La vida crece con cada amigo que participa. Cuando cae, quien haya hecho al menos 10 de daño reclama una copia del jefe, 50 todocoins y 3 ultraorbes. Cada lunes llega uno nuevo. (Sin sesión iniciada también se puede, tú solo.)
- **👯 Cazar juntos:** actívalo en Ajustes («Cazar junto a amigos»). Mientras juegas, tus amigos ven solo tu zona aproximada (unos 100 m) y nunca en el mapa. Si un amigo con la opción activada está a menos de 250 m, los dos tenéis XP ×1,5 y el doble de brillantes, y vuestra amistad sube con cada minuto juntos (se ve en su perfil). Al desactivarlo se borra tu zona.
- **🐾 Criatura compañera:** abre una criatura de tu álbum y pulsa «Hacer compañera». Caminará a tu lado en el mapa y cada km juntas te encontrará algo (caramelos, todocoins, orbes…). Tus amigos la ven en tu perfil.
- **📸 Modo foto:** en la captura pulsa 📸 para hacer una foto de la criatura (sobre la escena o sobre la cámara) con un marco con su nombre y rareza, y compartirla con tus amigos.

## Editor de criaturas (desde el ordenador)

Abre `https://TU-USUARIO.github.io/fotocaza/criaturas.html` en el ordenador (también hay enlace en **Ajustes** y en
el editor de paradas). Verás todas las criaturas del repositorio agrupadas por familia, con buscador.

- **Editar una criatura:** haz clic en ella y cambia su **nombre** (con tildes y espacios), **rareza**, **familia**,
  **etiquetas** (escribe y pulsa Intro: `fuego`, `volador`…) y **descripción**. El archivo no cambia de nombre
  (así nadie pierde sus capturas): los datos se guardan en `imagenes/criaturas.json`.
- **Añadir criaturas:** pulsa **Añadir criatura** o arrastra imágenes a la página. Se reducen solas a 600 px
  (conservando la transparencia) y el editor les pone el nombre de archivo correcto en la carpeta de su familia.
- **Subirlo:** pulsa **Descargar cambios (ZIP)**, descomprímelo y, en la página principal de tu repositorio,
  **Add file → Upload files** → arrastra la carpeta **imagenes** que sale del ZIP → **Commit changes**.

El editor recuerda en ese ordenador lo que no hayas descargado. En el juego, las etiquetas y la descripción salen
en la tarjeta de cada criatura, y en el **álbum** puedes buscar por nombre, familia o etiqueta.

## Orbes y paradas

Cada lanzamiento gasta un **orbe** (empiezas con 30). Para conseguir más, ve a una **parada** del mapa
(los postes azules con foto), tócala cuando estés cerca y pulsa **Recoger orbes**: te da de 3 a 5 orbes
(más en la primera visita) y experiencia. Después se pone morada y se recarga a los 5 minutos.

### Tienda

Botón de la bolsa en la barra inferior (o toca el contador de orbes y todocoins de arriba). Se paga con todocoins:

| Artículo | Precio | Efecto |
|---|---|---|
| 10 orbes | 6 | Orbes normales |
| 30 orbes | 15 | Pack grande, más barato |
| 5 superorbes | 12 | ×1,5 de probabilidad de captura |
| 3 ultraorbes | 15 | ×2 de probabilidad de captura |
| 3 caramelos | 6 | ×1,5 en el siguiente intento |
| 1 caramelo dorado | 8 | ×2,5 en el siguiente intento |

En la captura:
- **Cambiar de orbe:** toca el contador de la derecha (Orbe → Superorbe → Ultraorbe). El orbe cambia de color.
- **Dar un caramelo:** botón 🍬 de la izquierda. La criatura brilla en rosa y el efecto dura hasta que el orbe la golpee
  (aciertes o se escape). Si fallas el lanzamiento, el caramelo sigue activo.
- El **color del anillo** se recalcula con el orbe y el caramelo: así ves cuánto te ayudan.
- Todo se multiplica: rareza × anillo (Bien/Genial/Excelente) × curva × orbe × caramelo (máximo 97 %).

### Todocoins y abono

Las paradas también dan **todocoins** (2 a 4 por visita, 5 más la primera vez; empiezas con 10).
Sirven para **abonar una parada**: en su panel pulsa *Abonar esta parada*, elige **5, 10, 12, 20 o 24 horas**
(cuesta 1 todocoin por hora) y confirma estando cerca. Cuando pase ese tiempo, junto a la parada brotará una
criatura **rara o mejor** que solo verás tú (la parada muestra 🌱 mientras crece y ✨ cuando está lista).
Cuanto más tiempo, más probabilidad de rarezas altas; el panel enseña los porcentajes antes de abonar.
Las criaturas brotadas no huyen. Solo puede haber un abono a la vez en cada parada.
En **Modo prueba** las horas duran un minuto, para poder probarlo rápido.

Hay dos tipos de paradas:

- **Automáticas:** salen solas en sitios chulos de cualquier ciudad (miradores, monumentos, fuentes,
  museos, parques, obras de arte…) gracias a OpenStreetMap, muchas con foto.
- **Vuestras:** las que pongáis con el editor, con vuestro nombre, descripción y foto.

### Editor de paradas (desde el ordenador)

Abre `https://TU-USUARIO.github.io/fotocaza/editor.html` en el ordenador. También hay un enlace en **Ajustes**.

- **Clic en el mapa** para crear una parada; **arrástrala** para moverla.
- Ponle nombre y descripción, y una **foto**: arrástrala al recuadro, haz clic para elegirla o pégala con Ctrl+V.
  Se reduce sola y se guarda dentro del archivo.
- Acerca el mapa para ver las paradas automáticas en gris. Haz clic en una para **ocultarla** del juego
  o **hacerla tuya** y editarla. También puedes desactivarlas todas.
- Cuando acabes, pulsa **Descargar paradas.json** y súbelo al repositorio (**Add file → Upload files**),
  sustituyendo el anterior. En 1 o 2 minutos estará en el juego.

El editor recuerda tu trabajo en ese ordenador aunque cierres la pestaña.
`paradas.json` trae de ejemplo algunas paradas en el centro de Madrid: bórralas o cámbialas a tu gusto.

## Cuentas con usuario y contraseña (guardar la partida en la nube)

En **Ajustes → Cuenta** puedes **Crear cuenta** o **Entrar** con un **usuario** y una **contraseña**. Cada usuario
es único (nadie más puede registrarse con el mismo). La partida se guarda sola en tu cuenta y puedes seguir en otro
móvil. Si en el móvil ya había otra partida, el juego pregunta cuál quedarse. La contraseña se cambia en
**Ajustes → 🔑 Contraseña**.

- Usuario: de 3 a 20 caracteres, solo letras (a-z), números, «.» y «_» (se guarda en minúsculas).
- Contraseña: mínimo 6 caracteres. **No hay correo, así que si se olvida no se puede recuperar**: el dueño del
  proyecto puede borrar esa cuenta en Firebase (**Authentication → Usuarios**) para que vuelva a registrarse.

Por dentro se usa **Firebase** (gratis para un proyecto así) con un "correo" interno `usuario@jugadores.fotocaza.app`
que no existe de verdad. No se guarda ningún dato personal. Como son datos de compañeros, coméntalo antes con el profe.

**Activarlo en Firebase (una vez):** en la consola de Firebase → **Authentication** → pestaña **Método de acceso** →
**Agregar proveedor nuevo** → **Correo electrónico/contraseña** → activa el primer interruptor (no el de "vínculo
del correo") → **Guardar**. Puedes desactivar el proveedor **Google**, ya no se usa.

**Si aún no tienes proyecto de Firebase (unos 10 minutos):**

1. Entra en <https://console.firebase.google.com> → **Crear un proyecto** (por ejemplo `fotocaza`). Analytics no hace falta.
2. **Authentication** → **Comenzar** → activa **Correo electrónico/contraseña** como se explica arriba.
3. En **Authentication → Configuración → Dominios autorizados** → **Agregar dominio** → `TU-USUARIO.github.io`.
4. **Firestore Database** → **Crear base de datos** → ubicación en Europa (por ejemplo `eur3`) → **modo de producción**.
5. En Firestore → pestaña **Reglas** → borra lo que hay, pega el contenido de `firebase-reglas.txt` → **Publicar**.
6. Rueda ⚙️ → **Configuración del proyecto** → **Tus apps** → icono web **</>** → **Registrar app** y copia
   `apiKey`, `authDomain`, `projectId` y `appId` en `config.js`, en el apartado `firebase`.

Esos datos **no son secretos**: lo que protege las partidas son las reglas del paso 5.

### Jugadores (perfiles de amigos)

Con la sesión iniciada, toca tu **nivel** (arriba a la izquierda, el círculo con 👥) o **Ajustes → 👥 Jugadores**:

- **Tu perfil:** apodo, una frase y tus **3 criaturas favoritas** (la primera es tu foto). Se edita con **Editar perfil**.
- **Estadísticas** automáticas: nivel, criaturas descubiertas, capturas, huevos abiertos, km andados, paradas y tu criatura más rara.
- **Clasificación** de todos los que han iniciado sesión, ordenada por experiencia. Toca a un amigo para ver su perfil.

El perfil (apodo, frase, favoritas y estadísticas) lo puede ver **cualquiera que inicie sesión en el juego**; la partida
completa sigue siendo privada. Por defecto el apodo es tu nombre de usuario: cámbialo si prefieres otro.

> ⚠️ Cada vez que se añaden funciones sociales nuevas cambian las reglas. Si ya configuraste Firebase, **vuelve a pegar las reglas**:
> Firestore → **Reglas** → borra todo → pega el contenido nuevo de `firebase-reglas.txt` → **Publicar**.

## Ajustes (`config.js`)

- `owner` / `repo`: para leer imágenes de **otro** repositorio distinto al de la app.
- `folder`: carpeta de las imágenes.
- `catchRadius`: metros a los que se puede capturar (60 por defecto).
- `slotMinutes`, `cellSize`, `cellRange`: cada cuánto cambian y cuántas criaturas aparecen.
- `orbsStart`, `orbsMax`: orbes iniciales y máximo en la mochila.
- `stopCooldownMin`: minutos hasta poder volver a usar una parada.
- `coinsStart`, `coinsPerHour`: todocoins iniciales y coste del abono por hora.
- `autoParadas`: `false` para quitar las paradas automáticas.

## Probar en el ordenador

```
python -m http.server 8765
```
Abre `http://localhost:8765`, entra en **Ajustes → Modo prueba** y toca el mapa para moverte.
Con el modo prueba puedes capturar a cualquier distancia.

## Notas

- El GPS y la cámara solo funcionan con HTTPS (GitHub Pages ya lo es).
- El progreso se guarda en cada móvil (no hay cuentas ni servidor).
- GitHub permite 60 consultas por hora sin cuenta; la app guarda la lista 10 minutos, así que sobra.
- Si queréis un APK de verdad para Android, se puede generar a partir de la URL con [PWABuilder](https://www.pwabuilder.com/).
