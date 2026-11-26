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
2. Sube todos estos archivos a la raíz del repositorio (`index.html`, `app.js`, `style.css`, `config.js`,
   `sw.js`, `manifest.webmanifest`, `icon.svg` y la carpeta `imagenes/`).
3. En el repositorio: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
4. En un par de minutos la app estará en `https://TU-USUARIO.github.io/fotocaza/`.
5. Ábrela en el móvil y, en el menú del navegador, pulsa **"Añadir a pantalla de inicio"** / **"Instalar app"**.

No hace falta configurar nada: al estar en GitHub Pages, la app detecta sola de qué repositorio leer las imágenes.

## Añadir criaturas

Sube imágenes a `imagenes/` (desde la web de GitHub: *Add file → Upload files*). El nombre del archivo es el nombre de la criatura:

| Archivo | Criatura |
|---|---|
| `gato.png` | Gato · común |
| `perro_raro.jpg` | Perro · rara |
| `dragon_de_fuego_epico.png` | Dragon de fuego · épica |
| `profe_legendario.webp` | Profe · legendaria |
| `raro/pato.png` | Pato · rara (por la subcarpeta) |

Los PNG con fondo transparente quedan mucho mejor. Las imágenes nuevas tardan hasta 10 minutos en aparecer
(o pulsa **Ajustes → Recargar**).

Mientras la carpeta esté vacía, la app usa unas criaturas de demostración.

## Ajustes (`config.js`)

- `owner` / `repo`: para leer imágenes de **otro** repositorio distinto al de la app.
- `folder`: carpeta de las imágenes.
- `catchRadius`: metros a los que se puede capturar (60 por defecto).
- `slotMinutes`, `cellSize`, `cellRange`: cada cuánto cambian y cuántas criaturas aparecen.

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
