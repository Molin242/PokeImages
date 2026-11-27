# Modo automático de FotoCaza

Activado el 27/11/2026 a las 20:28. Cada ~5 minutos se añade una mejora (enfoque: **social y divertido**)
hasta las 00:00 del 28/11. Al terminar se genera `resumen.html` con todo lo hecho.
Copia de seguridad del proyecto antes de empezar: `Escritorio\FotoCaza-copia-antes-modo-auto`.

## Ideas pendientes (en orden)

- [x] Reglas de Firebase para todo lo social (un solo cambio de reglas para todas las mejoras)
- [x] Avisos de raras a los amigos (compartir un avistamiento: les sale en su barra de raras)
- [x] Muro de actividad de amigos ("Lucía ha capturado un Mítico ✨")
- [x] Regalos: las paradas dan regalos para enviar a amigos (orbes, caramelos, todocoins, a veces un huevo)
- [x] Reacciones en perfiles (❤️ 🔥 😂 👏) y contador en el perfil
- [x] Logros y medallas visibles en el perfil
- [x] Misiones diarias con racha y premio cada 7 días
- [x] Reto semanal con clasificación propia y premio
- [x] Comparar álbum con un amigo (qué tiene él que tú no)
- [x] Criatura compañera que camina contigo y encuentra cosas
- [x] Clima y hora reales que cambian las apariciones
- [x] Modo foto: hacer y compartir una foto de la criatura en la captura
- [x] Intercambios de criaturas entre amigos
- [x] Eventos temporales (horas felices, semanas temáticas)
- [x] Títulos elegibles para el perfil
- [x] Bienvenida/tutorial para jugadores nuevos
- [x] Niebla de exploración del barrio
- [x] Escondites: esconder una criatura en el mapa para que la busquen tus amigos
- [x] Notas en paradas (dejar un mensaje que leen tus amigos al visitarla)
- [x] ¿Quién es? Adivina la silueta del día (minijuego diario)
- [x] Clasificación de exploración (zonas despejadas) en Jugadores
- [x] Duelos entre amigos (equipos de 3 criaturas, por turnos y con estrategia)
- [x] Jefe de la semana cooperativo
- [x] Sensor de criaturas ocultas (pedido por el usuario)
- [x] Cazar juntos (bonus con amigos cerca)
- [x] Combo de capturas
- [x] Caza de color (fotos reales que invocan criaturas)
- [x] Quimeras (inventar criaturas mezclando dos y votarlas)
- [x] Hora dorada con el sol real

## Hecho

- 20:28 — Cuentas con **usuario y contraseña únicos** en lugar de Google (crear cuenta, entrar, cambiar contraseña).
- 20:40 — **Reglas de Firebase para lo social** (avisos, actividad, reacciones, regalos, intercambios, títulos y logros en el perfil) y funciones comunes en `cloud.js`. ⚠️ Hay que volver a pegar `firebase-reglas.txt` en Firestore → Reglas → Publicar.
- 20:36 — **Avisos de raras a los amigos**: en la captura de una épica o mejor aparece 📣 Avisar; a los amigos (a menos de 3 km) les llega una notificación y les sale en la barra de raras con tu nombre y la zona exacta (60 m) hasta que cambian las apariciones.
- 20:37 — **Muro de novedades**: se publican solos los momentos destacados (capturas brillantes o épicas+, huevos raros, subir de nivel, barrios que suben, avisos) y salen en Jugadores → Novedades; punto rojo en el nivel cuando hay algo nuevo.
- 20:38 — **Regalos entre amigos**: las paradas dan 🎁 (35 %, siempre en la primera visita, máx. 10); se envían desde el perfil de un amigo con un mensaje; quien lo recibe lo abre en Jugadores y le tocan orbes, todocoins, caramelos, superorbes o un huevo raro.
- 20:39 — **Reacciones en perfiles**: ❤️ 🔥 😂 👏 😮 en el perfil de cada amigo (una por persona, se puede cambiar o quitar); tu perfil muestra las que has recibido.
- 20:41 — **Logros y medallas**: 17 logros (capturas, colección, brillantes, km, paradas, huevos, barrios, regalos, avisos…); cada uno da 15 todocoins, sale en las novedades y se ve como medalla en el perfil (los tuyos con los bloqueados en gris).
- 20:42 — **Misiones diarias**: botón 📋 (abajo a la derecha) con 3 misiones al día iguales para todos los amigos (capturar, andar, paradas, curvas, «Excelente», regalos, reacciones…); cada una da 10 todocoins y 100 XP; completar las 3 suma racha 🔥 y cada 7 días seguidos hay premio gordo.
- 20:43 — **Reto semanal**: cada semana un reto igual para todos (más capturas, km, paradas o raras) con clasificación en directo en Jugadores y premio por llegar a la meta (40 todocoins + 5 superorbes); sale en las novedades.
- 20:44 — **Comparar álbumes**: en el perfil de un amigo, «📖 Comparar álbumes» muestra cuántas tenéis en común, las que él tiene y tú no (en silueta, para saber qué buscar) y las que tú tienes y él no.
- 20:45 — **Criatura compañera**: desde su tarjeta del álbum («🐾 Hacer compañera») camina a tu lado en el mapa; cada km juntas encuentra caramelos, todocoins, orbes o un caramelo dorado; sale en tu perfil para tus amigos.
- 20:46 — **Clima y hora reales** (Open-Meteo, sin claves): el tiempo sale arriba (☀️ 🌧️ ❄️ 🌙…); según llueva, haga sol, nieve, niebla, viento o sea de noche salen el triple las criaturas con esas etiquetas (#lluvia, #agua, #sol, #fuego, #noche, #fantasma…); de noche el mapa se oscurece y las épicas o mejores salen un 50 % más.
- 20:47 — **Modo foto**: botón 📸 en la captura; hace una foto de la criatura en la escena (o sobre la cámara), con marco de nombre, rareza y fecha; en el móvil se comparte directamente (WhatsApp…), en el ordenador se descarga.
- 20:48 — **Intercambios**: desde el perfil de un amigo, «🔄 Proponer intercambio» (ofreces una repetida y pides una de su álbum); tu amigo la acepta o rechaza en Jugadores y los dos álbumes se actualizan; sale en las novedades.
- 20:50 — **Eventos**: automáticos (⏰ hora feliz 18–19 h con doble XP y todocoins, ✨ fin de semana brillante ×3, ⭐ familia de la semana ×3) y propios en `eventos.json` (fechas, familia o etiqueta, XP, brillo, monedas); se ven en 📋 y avisan al empezar.
- 20:51 — **Títulos**: 16 títulos que se desbloquean con logros, niveles, rachas y el reto semanal; se eligen en «Editar perfil» y salen bajo tu nombre en el perfil y en la clasificación.
- 20:52 — **Bienvenida**: 6 pantallas que explican el juego la primera vez (explorar, capturar, paradas, amigos, misiones) y regalan 5 superorbes; se puede volver a ver desde Ajustes.
- 20:57 — **Niebla de exploración**: el mapa está cubierto de niebla y se despeja (≈70 m) por donde pasas; las zonas exploradas se guardan, salen en tu perfil («🌫️ Zonas exploradas») y se puede quitar en Ajustes.
- 20:58 — **Escondites**: desde la tarjeta de una criatura repetida, «🫣 Esconder una para mis amigos» la deja escondida donde estás 7 días, con una pista. A tus amigos (a menos de 3 km) les sale en la barra de raras con una zona aproximada; al llegar aparece un 🫣 en el mapa y quien lo toca se queda una copia (+10 todocoins). Tú ganas 15 todocoins por cada amigo que la encuentre. Logro nuevo «Buscatesoros». ⚠️ Reglas de Firebase nuevas (`escondites` y `hallazgos`). Arreglado también el «?» de la barra de raras, que a veces salía enorme.
- 21:00 — **Notas en paradas**: estando en una parada puedes dejar una nota (máx. 100 letras, una por parada; la nueva sustituye a la anterior y se puede borrar). Tus amigos la leen al abrir la parada, las paradas con notas llevan un 💬 en el mapa y, al pasar cerca, avisa. Duran 30 días y salen en las novedades. ⚠️ Reglas de Firebase nuevas (`notas`).
- 21:02 — **¿Quién es?**: minijuego diario en 📋 (el botón lleva un 🧠 si aún no has jugado). La misma silueta para todos y 4 nombres (los despistes, de la misma familia); un solo intento. Acertar da 20 todocoins y 80 XP, suma racha de aciertos y sale en las novedades; ves qué amigos han acertado hoy (sin desvelar la respuesta). Logro nuevo «Cerebrito» (7 aciertos).
- 21:04 — **Clasificación por categorías**: en Jugadores, pestañas para ordenar a los amigos por ⭐ XP, 📖 álbum, 👟 km, 🌫️ exploración, ✨ brillantes o 🧠 aciertos del ¿Quién es? (se recuerda la última elegida).
- 21:06 — **Duelos**: desde el perfil de un amigo, «⚔️ Retar a un duelo» con un equipo de 3 criaturas en orden. Tu amigo solo ve la rareza de las tuyas y elige su equipo y su orden (¡estrategia!); se enfrentan 1ª–1ª, 2ª–2ª y 3ª–3ª con poder según rareza, brillante y copias, más algo de suerte igual en los dos móviles. Ganar da 25 todocoins y 100 XP (empate 10, perder 5); resultado animado para los dos, sale en las novedades, nueva pestaña ⚔️ en la clasificación y logro «Gladiador» (5 victorias). ⚠️ Reglas de Firebase nuevas (`duelos`).
- 21:09 — **Jefe de la semana** (cooperativo): cada semana un jefe legendario o mejor, el mismo para todos y en silueta hasta que cae. Cada captura le quita vida según su rareza (brillantes ×2) y el daño se suma entre todos los amigos; la vida crece con cada jugador que se une. Al caer, quien haya hecho al menos 10 de daño reclama el premio: una copia del jefe, 50 todocoins y 3 ultraorbes. Se ve en 📋 y en Jugadores, sale en las novedades y hay logro «Matajefes». Sin reglas nuevas (va en el perfil). Arreglados también los rótulos de colores de escondites y jefe en la tarjeta.
- 21:15 — **Sensor de criaturas ocultas** (petición del usuario): hay criaturas ocultas (más raras: la mejor de dos tiradas) que no salen ni en el mapa ni en la barra de raras. Solo mientras andas, el sensor 📡 vibra (y pita, y el icono late) más deprisa y más fuerte cuanto más cerca estás, desde 150 m, sin flechas ni distancias. A 25 m la encuentras y empieza la captura. Salen en las novedades, cuentan en el perfil y hay logro «Zahorí» (5 ocultas). En iPhone el navegador no deja vibrar: allí avisa con el pitido y el 📡.
- 21:18 — **Cazar juntos**: opción en Ajustes (desactivada de entrada). Mientras juegas, tus amigos saben tu zona aproximada (~100 m); si hay un amigo a menos de 250 m, los dos tenéis XP ×1,5 y el doble de brillantes (sale como evento «👯 Cazando juntos» en 📋 y con 👯 arriba). Cada minuto juntos sube la amistad (Amigos → Buenos → Grandes → Mejores amigos), que se ve en su perfil; sale en las novedades y hay logro «La pandilla» (60 min). Al desactivarlo se borra tu zona. ⚠️ Reglas de Firebase nuevas (`presencia`).
- 21:22 — **Combo de capturas**: cada captura a menos de 3 minutos de la anterior sube el combo (hasta ×10) y da +10 % de XP por paso; si una criatura huye, se pierde. Contador ⚡ ×N con cuenta atrás encima de la barra de abajo. El récord sale en el perfil, en una pestaña nueva ⚡ de la clasificación y en las novedades (desde ×5); logro «Imparable» (×10).
- 21:26 — **🎨 Caza de color** (idea original, petición «algo distinto»): cada día un color, el mismo para todos. Haces una foto a algo real de ese color y el juego analiza en el propio móvil (la foto no se sube) el color dominante; si acierta, invoca una criatura cuya imagen es de ese color (las raras pesan más) y empieza la captura. 3 intentos al día, una invocación. Se ve qué amigos lo han conseguido, sale en las novedades y hay logro «Ojo de pintor» (5 cazas). Está en 📋.
- 21:30 — **🧬 Quimeras** (idea original): en el álbum, botón 🧬. Eliges dos criaturas tuyas y un corte (vertical u horizontal), ves la mezcla en directo y nace una criatura nueva con nombre mezclado (editable) por 25 todocoins. Se guardan en tu colección de quimeras y, con sesión iniciada, se comparten: galería de los amigos con votos ❤️ (uno por persona, no a las tuyas) y «👑 Quimera de la semana». Sale en las novedades; logro «Científico loco» (3 quimeras). ⚠️ Reglas de Firebase nuevas (`quimeras`).
- 21:32 — **🌅 Hora dorada**: el juego calcula el amanecer y el atardecer reales de tu zona (con precisión de minutos). De 10 min antes a 30 min después del amanecer, y de 30 min antes a 10 min después del atardecer: el mapa se vuelve dorado y hay XP ×2 y el doble de brillantes (evento en 📋, igual para todos los amigos de la ciudad).
- 21:33 — **Fin del modo automático** (límite de uso al ~70 %): creado `resumen.html` con todo lo hecho y los pasos pendientes para el usuario.
