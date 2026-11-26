// Configuración de FotoCaza
// Si publicas la app en GitHub Pages (https://USUARIO.github.io/REPO/),
// el usuario y el repositorio se detectan solos: no hace falta tocar nada.
window.FOTOCAZA_CONFIG = {
  owner: "",          // usuario u organización de GitHub (ej. "mi-usuario")
  repo: "",           // repositorio donde están las imágenes (ej. "fotocaza")
  branch: "",         // vacío = rama por defecto del repositorio
  folder: "imagenes", // carpeta con las imágenes de las criaturas

  catchRadius: 60,    // metros a los que puedes capturar una criatura
  cellSize: 0.0015,   // tamaño de cada "zona" de aparición (~165 m)
  cellRange: 2,       // cuántas zonas alrededor del jugador se generan
  slotMinutes: 15,    // cada cuántos minutos cambian las apariciones
  defaultLocation: [40.4168, -3.7038], // posición si no hay GPS (Madrid)

  // Orbes y paradas
  orbsStart: 30,      // orbes con los que empieza cada jugador
  orbsMax: 100,       // máximo de orbes en la mochila
  stopCooldownMin: 5, // minutos hasta poder volver a usar una parada
  coinsStart: 10,     // todocoins con los que empieza cada jugador
  coinsPerHour: 1,    // todocoins que cuesta cada hora de abono
  autoParadas: true   // añadir paradas automáticas en sitios chulos (OpenStreetMap)
                      // (el editor puede desactivarlas también desde paradas.json)
};
