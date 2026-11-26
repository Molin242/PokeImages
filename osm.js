/* Busca "sitios chulos" (miradores, monumentos, fuentes, museos, parques…) en OpenStreetMap
   para usarlos como paradas automáticas. Los resultados se guardan 7 días en el navegador. */
window.OSM = (() => {
  'use strict';
  const CELL = 0.01;               // ~1 km
  const TTL = 7 * 864e5;
  const KEY = 'fotocaza_osm_';
  const MAX_POR_CELDA = 25;
  const SEPARACION = 70;           // metros mínimos entre paradas automáticas
  const SERVIDORES = [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

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
  const fallos = new Map();        // "cx_cy" -> momento del último error (no reintentar enseguida)
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
    let datos = null, error = null;
    for (const url of SERVIDORES) { // si un servidor está saturado se prueba el siguiente
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(consulta(bbox)),
          signal: AbortSignal.timeout(20000)
        });
        if (!r.ok) throw new Error('Overpass ' + r.status);
        datos = await r.json();
        break;
      } catch (e) { error = e; }
    }
    if (!datos) throw error;
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
      return (!c || Date.now() - c.t > TTL) && !pendientes.has(k) && !(Date.now() - (fallos.get(k) || 0) < 120e3);
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
          fallos.set(k, Date.now());
          if (!memoria.has(k)) memoria.set(k, []);
          await new Promise(r => setTimeout(r, 3000)); // margen si el servidor está ocupado
        } finally {
          pendientes.delete(k);
          hechas++;
          onUpdate?.();
          onProgress?.(hechas, faltan.length);
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

  // ---------------------------------------------------------------- Barrios (solo Región de Murcia)
  // Pregunta a OpenStreetMap en qué barrio/pedanía/diputación cae un punto. No se descarga ningún mapa:
  // se consulta solo cuando hace falta y la respuesta se guarda por zonas de ~100 m.
  const BKEY = 'fotocaza_barrio_';
  async function overpass(q) {
    let error = null;
    for (const url of SERVIDORES) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error('Overpass ' + r.status);
        return await r.json();
      } catch (e) { error = e; }
    }
    throw error;
  }
  const enProceso = new Map();
  function barrio(lat, lng) {
    const k = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
    try { const c = localStorage.getItem(BKEY + k); if (c) return Promise.resolve(JSON.parse(c)); } catch {}
    if (enProceso.has(k)) return enProceso.get(k);
    const p = (async () => {
      const d = await overpass(`[out:json][timeout:20];is_in(${lat.toFixed(5)},${lng.toFixed(5)})->.a;` +
        `area.a[boundary=administrative][admin_level~"^(4|8|9|10|11)$"];out tags;`);
      const areas = d.elements.map(e => ({ id: String(e.id), lvl: +e.tags.admin_level, name: e.tags.name || '', iso: e.tags['ISO3166-2'] || '' }));
      const murcia = areas.some(a => a.lvl === 4 && (a.iso === 'ES-MC' || /murcia/i.test(a.name)));
      let res = { murcia };
      if (murcia) {
        const muni = areas.find(a => a.lvl === 8);
        const sub = areas.filter(a => a.lvl >= 9).sort((a, b) => b.lvl - a.lvl)[0] || muni; // lo más concreto
        if (sub) res = { murcia: true, id: sub.id, name: sub.name, muni: muni ? muni.name : sub.name };
      }
      try { localStorage.setItem(BKEY + k, JSON.stringify(res)); } catch {}
      return res;
    })().finally(() => enProceso.delete(k));
    enProceso.set(k, p);
    return p;
  }

  return { CELL, cellOf, metros, get, asegurar, celdasAlrededor, celdasEnCaja, enCeldas, barrio };
})();
