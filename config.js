// Configuración de FotoCaza
// Si publicas la app en GitHub Pages (https://USUARIO.github.io/REPO/),
// el usuario y el repositorio se detectan solos: no hace falta tocar nada.
window.FOTOCAZA_CONFIG = {
  owner: "",          // usuario u organización de GitHub (ej. "mi-usuario")
  repo: "",           // repositorio donde están las imágenes (ej. "fotocaza")
  branch: "",         // vacío = rama por defecto del repositorio
  folder: "imagenes", // carpeta con las imágenes de las criaturas

  catchRadius: 60,    // metros a los que puedes capturar una criatura
  revealRadius: 90,   // metros a los que las criaturas aparecen en el mapa (más lejos no se ven)
  radarRange: 4,      // zonas alrededor en las que se rastrean las criaturas épicas o mejores (~700 m)
  hintRadius: 150,    // radio en metros del círculo que marca por dónde anda una criatura rastreada
  cellSize: 0.0015,   // tamaño de cada "zona" de aparición (~165 m)
  cellRange: 2,       // cuántas zonas alrededor del jugador se generan
  slotMinutes: 15,    // cada cuántos minutos cambian las apariciones
  // Lo frecuente que sale cada rareza (números relativos: más alto = más frecuente).
  // Más o menos: común 1 de cada 2 · raro 1/4 · superraro 1/9 · épico 1/20 · legendario 1/50
  //              mítico 1/140 · astral 1/400 · secreto 1/2000
  shinyRate: 1 / 200,  // probabilidad de que una criatura salga brillante
  rarityWeights: { comun: 55, raro: 25, superraro: 11, epico: 5, legendario: 2, mitico: 0.7, astral: 0.25, secreto: 0.05 },
  defaultLocation: [40.4168, -3.7038], // posición si no hay GPS (Madrid)

  // Orbes y paradas
  orbsStart: 30,      // orbes con los que empieza cada jugador
  orbsMax: 100,       // máximo de orbes en la mochila
  stopCooldownMin: 5, // minutos hasta poder volver a usar una parada
  coinsStart: 10,     // todocoins con los que empieza cada jugador
  coinsPerHour: 1,    // todocoins que cuesta cada hora de abono
  autoParadas: true,  // añadir paradas automáticas en sitios chulos (OpenStreetMap)
                      // (el editor puede desactivarlas también desde paradas.json)

  // Cuentas con Google y guardado en la nube (opcional). Pega aquí la configuración
  // de tu proyecto de Firebase (lo explica el README). Si se deja en null, no se usa.
  // Estos datos NO son secretos: la seguridad la dan las reglas de Firestore.
  firebase: {
    apiKey: "AIzaSyAgNZznlGRLlXW5iwz3tVcjUeiWg5IB7D4",
    authDomain: "fotocaza-ad61a.firebaseapp.com",
    projectId: "fotocaza-ad61a",
    storageBucket: "fotocaza-ad61a.firebasestorage.app",
    messagingSenderId: "747642135675",
    appId: "1:747642135675:web:f8d36542d9bc8aa31feede"
  }
};
