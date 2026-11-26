/* Busca "sitios chulos" (miradores, monumentos, fuentes, museos, parques…) en OpenStreetMap
   para usarlos como paradas automáticas. Los resultados se guardan 7 días en el navegador. */
window.OSM = (() => {
  'use strict';
  const CELL = 0.01;               // ~1 km
  const TTL = 7 * 864e5;
  const KEY = 'fotocaza_osm_';
  const MAX_POR_CELDA = 25;
  const SEPARACION = 70;           // metros mínimos entre paradas automáticas

  const TIPOS = {
    tourism:  { viewpoint: ['Mirador', 1], attraction: ['Lugar de interés', 1], artwork: ['Obra de arte', 2],
                museum: ['Museo', 2], gallery: ['Galería de arte', 3] },
    historic: { monument: ['Monumento', 2], memorial: ['Memorial', 3], castle: ['Castillo', 1], ruins: ['Ruinas', 2],
                archaeological_site: ['Yacimiento arqueológico', 2], fort: ['Fortaleza', 2], city_gate: ['Puerta histórica', 2] },
    amenity:  { fountain: ['Fuente', 3], theatre: ['Teatro', 3], library: ['Biblioteca', 4], place_of_worship: ['Templo', 5] },
    leisure:  { park: ['Parque', 4], garden: ['Jardín', 4] }
  };

  const memoria = new Map();       // "cx_cy" -> lista
  const pendientes = new Set();
  let cola = Promise.resolve();

  const cellOf = (lat, lng) => [Math.floor(lat / CELL), Math.floor(lng / CELL)];
  const metros = (a, b) => {
    const k = 111320, dx = (a.lng - b.lng) * k * Math.cos(a.lat * Math.PI / 180), dy = (a.lat - b.lat) * k;
    return Math.hypot(dx, dy);
  };

  function consulta(bbox) {
    const partes = Object.entries(TIPOS).map(([k, v]) =>
      `nwr["${k}"~"^(${Object.keys(v).join('|')})$"]["name"](${bbox});`).join('');
    return `[out:json][timeout:25];(${partes});out tags center 300;`;
  }

  function fotoDe(t) {
    if (t.image && /^https?:\/\//i.test(t.image)) return t.image.split(';')[0].trim();
    const wc = t.wikimedia_commons;
    if (wc && /^File:/i.test(wc))
      return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(wc.replace(/^File:/i, '')) + '?width=480';
    return '';
  }

  function convertir(el) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (lat == null || !t.name) return null;
    let tipo = null;
    for (const k in TIPOS) if (TIPOS[k][t[k]]) { tipo = TIPOS[k][t[k]]; break; }
    if (!tipo) return null;
    return { id: `osm_${el.type}_${el.id}`, nombre: t.name, descripcion: tipo[0], lat, lng, foto: fotoDe(t), prio: tipo[1] };
  }

  async function descargar(cx, cy) {
    const s = cx * CELL, w = cy * CELL;
    const bbox = `${s.toFixed(4)},${w.toFixed(4)},${(s + CELL).toFixed(4)},${(w + CELL).toFixed(4)}`;
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(consulta(bbox))
    });
    if (!r.ok) throw new Error('Overpass ' + r.status);
    const datos = await r.json();
    const todos = datos.elements.map(convertir).filter(Boolean)
      .sort((a, b) => a.prio - b.prio || (b.foto ? 1 : 0) - (a.foto ? 1 : 0));
    const elegidos = [];
    for (const p of todos) {
      if (elegidos.length >= MAX_POR_CELDA) break;
      if (elegidos.every(q => metros(p, q) > SEPARACION)) elegidos.push(p);
    }
    return elegidos;
  }

  function leerCache(k) {
    try { return JSON.parse(localStorage.getItem(KEY + k) || 'null'); } catch { return null; }
  }

  /** Lista ya disponible (memoria o caché) de una celda, o null si hay que descargarla. */
  function get(cx, cy) {
    const k = `${cx}_${cy}`;
    if (memoria.has(k)) return memoria.get(k);
    const c = leerCache(k);
    if (c) { memoria.set(k, c.list); return c.list; }
    return null;
  }

  /** Asegura que las celdas estén cargadas; llama a onUpdate cada vez que llega una nueva. */
  function asegurar(celdas, onUpdate, onProgress) {
    const faltan = celdas.filter(([cx, cy]) => {
      const k = `${cx}_${cy}`, c = leerCache(k);
      if (c && !memoria.has(k)) memoria.set(k, c.list);
      return (!c || Date.now() - c.t > TTL) && !pendientes.has(k);
    });
    if (!faltan.length) return;
    let hechas = 0;
    faltan.forEach(([cx, cy]) => pendientes.add(`${cx}_${cy}`));
    for (const [cx, cy] of faltan) {
      const k = `${cx}_${cy}`;
      cola = cola.then(async () => {
        try {
          const list = await descargar(cx, cy);
          memoria.set(k, list);
          try { localStorage.setItem(KEY + k, JSON.stringify({ t: Date.now(), list })); } catch {}
        } catch (e) {
          console.warn('No se pudieron cargar sitios de OpenStreetMap', e);
          if (!memoria.has(k)) memoria.set(k, []);
          await new Promise(r => setTimeout(r, 3000)); // margen si el servidor está ocupado
        } finally {
          pendientes.delete(k);
          hechas++;
          onProgress?.(hechas, faltan.length);
          onUpdate?.();
        }
      });
    }
  }

  function celdasAlrededor(lat, lng, radio = 1) {
    const [cx, cy] = cellOf(lat, lng), out = [[cx, cy]];
    for (let dx = -radio; dx <= radio; dx++)
      for (let dy = -radio; dy <= radio; dy++) if (dx || dy) out.push([cx + dx, cy + dy]);
    return out;
  }

  function celdasEnCaja(s, w, n, e) {
    const out = [];
    const [c0, d0] = cellOf(s, w), [c1, d1] = cellOf(n, e);
    for (let cx = c0; cx <= c1; cx++) for (let cy = d0; cy <= d1; cy++) out.push([cx, cy]);
    return out;
  }

  /** Todas las paradas automáticas cargadas en las celdas indicadas. */
  function enCeldas(celdas) {
    return celdas.flatMap(([cx, cy]) => get(cx, cy) || []);
  }

  return { CELL, cellOf, metros, get, asegurar, celdasAlrededor, celdasEnCaja, enCeldas };
})();
