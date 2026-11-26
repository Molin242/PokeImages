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
   `sw.js`, `manifest.webmanifest`, `icon.svg`, `editor.html`, `editor.js`, `paradas.json`, `cloud.js`, `firebase-reglas.txt` y la carpeta `imagenes/`).
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
| Común | ~50 % |
| Raro | ~25 % |
| Superraro | ~12 % |
| Épico | ~7 % |
| Legendario | ~3,5 % |
| Mítico | ~1,6 % |
| Astral | ~0,7 % |
| Secreto | ~0,2 % |

(Si una rareza no tiene ninguna imagen, su probabilidad se reparte entre las demás.)

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

## Cuentas con Google (guardar la partida en la nube)

Opcional. Si lo configuras, en **Ajustes** aparece **Iniciar sesión con Google**: la partida se guarda sola en tu
cuenta y puedes seguir en otro móvil. Si en el móvil ya había otra partida, el juego pregunta cuál quedarse.

Se usa **Firebase** (de Google, gratis para un proyecto así). Solo se guarda la partida, ligada al identificador
interno de la cuenta; ni el nombre ni el correo se guardan en la base de datos. Como son datos de compañeros,
coméntalo antes con el profe.

**Configurarlo (unos 10 minutos):**

1. Entra en <https://console.firebase.google.com> con tu cuenta de Google → **Crear un proyecto** (por ejemplo
   `fotocaza`). Google Analytics no hace falta.
2. Menú izquierdo → **Authentication** → **Comenzar** → pestaña **Método de acceso** → **Google** → actívalo,
   elige tu correo de asistencia → **Guardar**.
3. En **Authentication → Configuración → Dominios autorizados** → **Agregar dominio** → `TU-USUARIO.github.io`.
4. Menú izquierdo → **Firestore Database** → **Crear base de datos** → ubicación en Europa (por ejemplo `eur3`)
   → **modo de producción**.
5. En Firestore → pestaña **Reglas** → borra lo que hay, pega el contenido de `firebase-reglas.txt` → **Publicar**.
6. Rueda ⚙️ → **Configuración del proyecto** → abajo, en **Tus apps**, pulsa el icono web **</>** → ponle un nombre
   (sin Firebase Hosting) → **Registrar app**. Te enseñará un bloque `firebaseConfig`.
7. Copia `apiKey`, `authDomain`, `projectId` y `appId` en `config.js`, en el apartado `firebase` (quita las `//`
   del ejemplo), y sube `config.js` a GitHub.

Esos datos **no son secretos** (Firebase está pensado para que vayan en la web): lo que protege las partidas son
las reglas del paso 5, que solo dejan a cada uno leer y escribir la suya.

### Jugadores (perfiles de amigos)

Con la sesión iniciada, toca tu **nivel** (arriba a la izquierda, el círculo con 👥) o **Ajustes → 👥 Jugadores**:

- **Tu perfil:** apodo, una frase y tus **3 criaturas favoritas** (la primera es tu foto). Se edita con **Editar perfil**.
- **Estadísticas** automáticas: nivel, criaturas descubiertas, capturas, huevos abiertos, km andados, paradas y tu criatura más rara.
- **Clasificación** de todos los que han iniciado sesión, ordenada por experiencia. Toca a un amigo para ver su perfil.

El perfil (apodo, frase, favoritas y estadísticas) lo puede ver **cualquiera que inicie sesión en el juego**; la partida
completa sigue siendo privada. Por defecto el apodo es tu nombre de pila de Google: cámbialo si prefieres otro.

> ⚠️ Si ya configuraste Firebase antes de que existieran los perfiles, **vuelve a pegar las reglas**:
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
