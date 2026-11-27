/* FotoCaza — juego de captura geolocalizado con imágenes de un repositorio de GitHub */
(() => {
'use strict';

const CFG = Object.assign({
  owner: '', repo: '', branch: '', folder: 'imagenes',
  catchRadius: 60, cellSize: 0.0015, cellRange: 2, slotMinutes: 15,
  defaultLocation: [40.4168, -3.7038],
  orbsStart: 30, orbsMax: 100, stopCooldownMin: 5, autoParadas: true, stopViewRadius: 1500,
  coinsStart: 10, coinsPerHour: 1,
  revealRadius: 90, radarRange: 4, hintRadius: 150, shinyRate: 1 / 200
}, window.FOTOCAZA_CONFIG || {});

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------------------------------------------------------------- Rarezas
// weight = probabilidad relativa de aparecer (cada una es más rara que la anterior)
// catch = probabilidad base de captura · flee = probabilidad de huir al escaparse del orbe
const RAR = {
  comun:      { label: 'Común',      weight: 55,   catch: 0.85, flee: 0.05, xp: 100 },
  raro:       { label: 'Raro',       weight: 25,   catch: 0.65, flee: 0.10, xp: 200 },
  superraro:  { label: 'Superraro',  weight: 11,   catch: 0.50, flee: 0.14, xp: 350 },
  epico:      { label: 'Épico',      weight: 5,    catch: 0.40, flee: 0.18, xp: 600 },
  legendario: { label: 'Legendario', weight: 2,    catch: 0.28, flee: 0.24, xp: 1200 },
  mitico:     { label: 'Mítico',     weight: 0.7,  catch: 0.20, flee: 0.30, xp: 2000 },
  astral:     { label: 'Astral',     weight: 0.25, catch: 0.13, flee: 0.36, xp: 3500 },
  secreto:    { label: 'Secreto',    weight: 0.05, catch: 0.08, flee: 0.45, xp: 6000 }
};
// Se pueden ajustar desde config.js con rarityWeights: { legendario: 1, ... }
for (const k in (CFG.rarityWeights || {})) if (RAR[k] && CFG.rarityWeights[k] >= 0) RAR[k].weight = +CFG.rarityWeights[k];
const RAR_ORDER = Object.keys(RAR);
// Nombres aceptados en archivos y carpetas (sin tildes, mayúsculas ni separadores)
const RAR_ALIAS = {};
const alias = (k, ...ws) => ws.forEach(w => { RAR_ALIAS[w] = k; });
alias('comun', 'comun', 'comunes', 'common');
alias('raro', 'raro', 'rara', 'raros', 'raras', 'rare');
alias('superraro', 'superraro', 'superrara', 'superraros', 'superraras', 'muyraro', 'muyrara', 'superrare');
alias('epico', 'epico', 'epica', 'epicos', 'epicas', 'epic');
alias('legendario', 'legendario', 'legendaria', 'legendarios', 'legendarias', 'legendary');
alias('mitico', 'mitico', 'mitica', 'miticos', 'miticas', 'mythic', 'mythical');
alias('astral', 'astral', 'astrales');
alias('secreto', 'secreto', 'secreta', 'secretos', 'secretas', 'secret');
// [amplitud horizontal (fracción de pantalla), velocidad]: las más raras se mueven más
const MOVE = { comun: [0.06, 0.7], raro: [0.10, 0.9], superraro: [0.14, 1.0], epico: [0.18, 1.2],
  legendario: [0.22, 1.4], mitico: [0.25, 1.6], astral: [0.28, 1.8], secreto: [0.30, 2.1] };

// ---------------------------------------------------------------- Partida guardada
const SAVE_KEY = 'fotocaza_v1';
let save;
try { save = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch { save = {}; }
save = Object.assign({ caught: {}, first: {}, xp: 0, gone: {}, dev: false, cam: false,
  orbs: CFG.orbsStart, stops: {}, visited: {}, coins: CFG.coinsStart, fert: {}, sound: true, eggs: [], walked: 0, items: {}, ball: 'orb' }, save);
save.items = Object.assign({ super: 0, ultra: 0, candy: 0, gold: 0 }, save.items);
save.gifts = save.gifts || 0;
save.quimeras = save.quimeras || [];  // criaturas inventadas mezclando dos { id, nombre, img, a, b, t }
save.combo = save.combo || { n: 0, last: 0 };   // capturas seguidas (menos de 3 min entre una y otra)
const COMBO_MS = 3 * 60e3, COMBO_MAX = 10;
save.amistad = save.amistad || {};   // minutos cazando junto a cada amigo { uid: { nick, min } }
let juntos = [];                      // amigos cazando cerca ahora mismo
let sensorT = null, sensorOn = false, lastWalkAt = 0; const sensorFired = new Set(); // sensor de criaturas ocultas
save.duelosVistos = save.duelosVistos || {}; // duelos ya cobrados (para no cobrarlos dos veces)
save.notasVistas = save.notasVistas || {}; // notas de amigos en paradas que ya he leído
const NOTA_MAX = 100, NOTA_DIAS = 30;
let notasCache = new Map();               // notas en paradas: parada → [notas]
const notaAvisada = new Set();
save.hides = save.hides || {};          // escondites que he puesto yo { id: { cid, t, hasta, found: [nicks] } }
save.foundHides = save.foundHides || {}; // escondites de amigos que ya he encontrado
save.logros = save.logros || {};        // logros conseguidos: { id: fecha }          // regalos listos para enviar a amigos
save.giftsOpened = save.giftsOpened || {}; // regalos recibidos ya abiertos (para no cobrarlos dos veces)
// Estadísticas para el perfil (en partidas antiguas, las capturas se estiman con lo que hay en el álbum)
save.stats = Object.assign({ captures: Object.values(save.caught).reduce((a, n) => a + n, 0), hatched: 0, fused: 0 }, save.stats);
save.shiny = save.shiny || {};            // brillantes conseguidas: { idCriatura: cuántas }
save.barrios = save.barrios || {};        // maestría por barrio: { idBarrio: { name, muni, pts, captures, species, shinies } }
save.barrioPending = save.barrioPending || []; // capturas que aún no se han podido asignar a un barrio (sin conexión)
for (const k in save.gone) if (Date.now() - save.gone[k] > 864e5) delete save.gone[k];
const persist = () => { save.savedAt = Date.now(); localStorage.setItem(SAVE_KEY, JSON.stringify(save)); cloudQueue(); };

// ---------------------------------------------------------------- Utilidades
function seeded(str) { // generador pseudoaleatorio determinista (igual para todos los jugadores)
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function distM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- Imágenes del repositorio
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

const rarKey = s => RAR_ALIAS[stripAccents(String(s).toLowerCase()).replace(/[\s_\-]+/g, '')] || null;
const pretty = s => { s = s.replace(/[_\-]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

/* Ruta dentro de la carpeta de imágenes → criatura.
   imagenes/bichos/mariquita_raro.png     → «Mariquita», categoría Bichos, rara
   imagenes/pokemon/legendario/dragon.png → «Dragon», categoría Pokemon, legendaria
   imagenes/gato.png                      → «Gato», categoría Otros, común            */
function parseCreature(relPath, url) {
  const parts = relPath.split('/');
  const file = parts.pop().normalize('NFC');
  let base = file.replace(IMG_RE, '');
  let rarity = null, category = null;
  // Rareza al final del nombre: primero dos palabras ("_super_raro"), luego una ("_epico")
  for (const re of [/[_\- ]([^_\- ]+[_\- ][^_\- ]+)$/, /[_\- ]([^_\- ]+)$/]) {
    const m = base.match(re);
    if (m && rarKey(m[1])) { rarity = rarKey(m[1]); base = base.slice(0, base.length - m[0].length); break; }
  }
  // Carpetas: las que se llaman como una rareza dan la rareza; la primera que no, la categoría
  for (const p of parts) {
    const r = rarKey(p);
    if (r) { if (!rarity) rarity = r; }
    else if (!category) category = pretty(p.normalize('NFC'));
  }
  return { id: relPath, name: pretty(base) || 'Sin nombre', rarity: rarity || 'comun', category: category || 'Otros', url };
}

function detectRepo() {
  let { owner, repo } = CFG;
  if ((!owner || !repo) && location.hostname.endsWith('.github.io')) {
    owner = owner || location.hostname.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    repo = repo || (seg && !seg.includes('.') ? seg : `${owner}.github.io`);
  }
  return owner && repo ? { owner, repo } : null;
}

async function loadCreatures(force) {
  const src = detectRepo();
  const folder = (CFG.folder || '').replace(/^\/+|\/+$/g, '');
  const prefix = folder ? folder + '/' : '';
  if (src) {
    const key = `${src.owner}/${src.repo}/${folder}`;
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem('fotocaza_cache_v2') || 'null'); } catch {}
    if (!force && cache && cache.key === key && Date.now() - cache.t < 10 * 60e3)
      return { list: cache.list, source: `GitHub · ${key}` };
    try {
      const api = `https://api.github.com/repos/${src.owner}/${src.repo}`;
      let branch = CFG.branch;
      if (!branch) {
        const r = await fetch(api);
        if (!r.ok) throw new Error(r.status === 404 ? 'repositorio no encontrado o privado' : `error ${r.status}`);
        branch = (await r.json()).default_branch;
      }
      const r = await fetch(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      if (!r.ok) throw new Error(r.status === 403 ? 'límite de GitHub alcanzado, prueba en un rato' : `error ${r.status}`);
      const data = await r.json();
      const list = data.tree
        .filter(n => n.type === 'blob' && n.path.startsWith(prefix) && IMG_RE.test(n.path))
        .map(n => parseCreature(n.path.slice(prefix.length),
          `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${encodeURIComponent(branch)}/${n.path.split('/').map(encodeURIComponent).join('/')}`))
        .sort((a, b) => a.id.localeCompare(b.id));
      localStorage.setItem('fotocaza_cache_v2', JSON.stringify({ key, t: Date.now(), list }));
      if (list.length) return { list, source: `GitHub · ${key}` };
      toast(`La carpeta "${folder}" del repositorio está vacía. Usando criaturas de demostración.`, 5000);
    } catch (e) {
      console.warn(e);
      if (cache && cache.key === key && cache.list.length) return { list: cache.list, source: `GitHub · ${key} (caché)` };
      toast('No se pudo leer el repositorio: ' + e.message, 5000);
    }
  }
  // Alternativa sin GitHub: un archivo imagenes/lista.json con ["gato.png", "raro/dragon.png", ...]
  try {
    const r = await fetch(`${prefix}lista.json`, { cache: 'no-store' });
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length)
        return { list: arr.map(p => parseCreature(p, prefix + p.split('/').map(encodeURIComponent).join('/')))
          .sort((a, b) => a.id.localeCompare(b.id)), source: `Local · ${prefix}lista.json` };
    }
  } catch {}
  return { list: demoCreatures(), source: 'Demostración (sin repositorio configurado)' };
}

function demoCreatures() {
  const defs = [
    ['Burbujín','comun','#4fc3f7','Gominolas'], ['Musgoso','comun','#81c784','Gominolas'], ['Chispín','comun','#ffd54f','Gominolas'],
    ['Rocaldo','raro','#a1887f','Gominolas'], ['Coralia','superraro','#f06292','Gominolas'],
    ['Nebulina','raro','#9575cd','Elementales'], ['Glaciar','epico','#80deea','Elementales'], ['Magmo','legendario','#ff7043','Elementales'],
    ['Floralia','mitico','#ff6fd8','Elementales'], ['Aurora','astral','#7c8cff','Cósmicos'], ['Umbra','secreto','#3a3a4a','Cósmicos']];
  return defs.map(([name, rarity, color, category], i) =>
    ({ id: 'demo/' + name, name, rarity, category, url: blobSvg(color, i) }));
}
function blobSvg(color, seed) {
  const r = seeded('blob' + seed), n = 9, pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, rad = 58 + r() * 26;
    pts.push([100 + Math.cos(a) * rad, 102 + Math.sin(a) * rad * 0.88]);
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], f = v => v.toFixed(1);
  const s = mid(pts[n - 1], pts[0]);
  let d = `M${f(s[0])} ${f(s[1])}`;
  for (let i = 0; i < n; i++) { const p = pts[i], e = mid(pts[i], pts[(i + 1) % n]); d += ` Q${f(p[0])} ${f(p[1])} ${f(e[0])} ${f(e[1])}`; }
  const ex = 18 + r() * 10, ey = 92 + r() * 10;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><radialGradient id="g" cx="35%" cy="30%">
<stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${color}"/></radialGradient></defs>
<path d="${d}" fill="url(#g)" stroke="#0004" stroke-width="3"/>
<circle cx="${100 - ex}" cy="${ey}" r="13" fill="#fff"/><circle cx="${100 + ex}" cy="${ey}" r="13" fill="#fff"/>
<circle cx="${100 - ex + 3}" cy="${ey + 2}" r="6" fill="#222"/><circle cx="${100 + ex + 3}" cy="${ey + 2}" r="6" fill="#222"/>
<path d="M88 ${ey + 26} Q100 ${ey + 38} 112 ${ey + 26}" stroke="#222" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ---------------------------------------------------------------- Apariciones
let creatures = [], sourceName = '';

function pickCreature(r) {
  const avail = RAR_ORDER.filter(k => creatures.some(c => c.rarity === k));
  // De noche las rarezas épicas o mejores salen un 50 % más
  const w = k => RAR[k].weight * (clima.night && RAR_ORDER.indexOf(k) >= RAR_ORDER.indexOf('epico') ? 1.5 : 1);
  const total = avail.reduce((s, k) => s + w(k), 0);
  let x = r() * total, rar = avail[0];
  for (const k of avail) { x -= w(k); if (x <= 0) { rar = k; break; } }
  const pool = creatures.filter(c => c.rarity === rar);
  // Las criaturas con etiquetas del tiempo que hace (#lluvia, #sol, #noche…) salen el triple
  const boost = c => ((c.tags || []).some(t => clima.tags.includes(stripAccents(t.toLowerCase()))) ? 3 : 1) * eventBoost(c);
  const tot = pool.reduce((s, c) => s + boost(c), 0);
  let y = r() * tot;
  for (const c of pool) { y -= boost(c); if (y <= 0) return c; }
  return pool[pool.length - 1];
}

// 1 de cada 200 es brillante. Se decide con su propio azar para que todos la vean igual.
const isShiny = seed => seeded(seed)() < CFG.shinyRate * eventMult('brillo');
const cssUrl = u => `url("${String(u).replace(/["\\\n]/g, m => encodeURIComponent(m))}")`;
const shinyHue = id => 60 + Math.floor(seeded('tono' + id)() * 240); // cada criatura brilla con su propio tono
// Imagen de una criatura; si es brillante, con el efecto foil holográfico encima
function creatureImg(c, shiny, attrs = '') {
  const img = `<img src="${esc(c.url)}" alt="" draggable="false" ${attrs}>`;
  return shiny ? `<span class="foil" style="--img:${esc(cssUrl(c.url))};--shue:${shinyHue(c.id)}deg">${img}</span>` : img;
}

function computeSpawns(pos, range = CFG.cellRange) {
  if (!creatures.length) return [];
  const cs = CFG.cellSize, cx0 = Math.floor(pos.lat / cs), cy0 = Math.floor(pos.lng / cs);
  const slot = Math.floor(Date.now() / (CFG.slotMinutes * 60e3)), out = [];
  for (let dx = -range; dx <= range; dx++)
    for (let dy = -range; dy <= range; dy++) {
      const cx = cx0 + dx, cy = cy0 + dy, r = seeded(`${cx}|${cy}|${slot}|${creatures.length}`);
      const n = Math.floor(r() * 3); // 0, 1 o 2 por zona
      for (let i = 0; i < n; i++) {
        const id = `${cx}_${cy}_${slot}_${i}`;
        const lat = (cx + r()) * cs, lng = (cy + r()) * cs, creature = pickCreature(r);
        if (!save.gone[id]) out.push({ id, lat, lng, creature, shiny: isShiny('brillo' + id) });
      }
    }
  return out;
}

// ---------------------------------------------------------------- Clima y hora reales
// Se consulta el tiempo real (Open-Meteo, gratis y sin claves; solo se envía la zona aproximada, ~10 km).
// Lluvia, sol, nieve, niebla, viento o noche hacen que salgan más las criaturas con esas etiquetas, y de noche
// hay más raras y el mapa se oscurece. Como todos los amigos de la zona tienen el mismo tiempo, veis lo mismo.
const clima = { icon: '', temp: '', tags: [], night: false, key: '', at: 0, label: '' };
const CLIMA_TAGS = {
  sol: ['sol', 'fuego', 'calor', 'verano', 'playa'], nubes: ['nube', 'nubes', 'aire', 'volador', 'pajaro'],
  lluvia: ['lluvia', 'agua', 'mar', 'pez', 'rana'], nieve: ['nieve', 'hielo', 'frio', 'invierno'],
  niebla: ['niebla', 'fantasma', 'misterio'], tormenta: ['tormenta', 'electrico', 'rayo', 'trueno'],
  viento: ['viento', 'aire', 'volador'], noche: ['noche', 'oscuridad', 'luna', 'fantasma', 'cosmico', 'estrella']
};
function climaDe(code, isDay, wind) {
  let k = code === 0 || code === 1 ? 'sol' : code <= 3 ? 'nubes' : code <= 48 ? 'niebla' : code <= 67 || (code >= 80 && code <= 82) ? 'lluvia'
    : code <= 77 || code === 85 || code === 86 ? 'nieve' : code >= 95 ? 'tormenta' : 'nubes';
  if (wind >= 30 && (k === 'sol' || k === 'nubes')) k = 'viento';
  const icon = { sol: isDay ? '☀️' : '🌙', nubes: '☁️', niebla: '🌫️', lluvia: '🌧️', nieve: '❄️', tormenta: '⛈️', viento: '💨' }[k];
  const label = { sol: isDay ? 'Hace sol' : 'Noche despejada', nubes: 'Está nublado', niebla: 'Hay niebla', lluvia: 'Está lloviendo',
    nieve: 'Está nevando', tormenta: 'Hay tormenta', viento: 'Hace mucho viento' }[k];
  return { k: isDay || k !== 'sol' ? k : 'noche', icon, label };
}
async function updateClima(lat, lng) {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  if (key === clima.key && Date.now() - clima.at < 15 * 60e3) return;
  clima.key = key; clima.at = Date.now();
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(1)}&longitude=${lng.toFixed(1)}&current=weather_code,is_day,temperature_2m,wind_speed_10m`);
    if (!r.ok) throw new Error('clima ' + r.status);
    const cur = (await r.json()).current;
    const night = !cur.is_day, c = climaDe(cur.weather_code, cur.is_day, cur.wind_speed_10m || 0);
    const changed = c.k !== clima.k || night !== clima.night;
    Object.assign(clima, { icon: c.icon, temp: Math.round(cur.temperature_2m), night, k: c.k, label: c.label,
      tags: [...new Set([...(CLIMA_TAGS[c.k] || []), ...(night ? CLIMA_TAGS.noche : [])])] });
    document.body.classList.toggle('night', night);
    if (changed) {
      for (const m of markers.values()) map.removeLayer(m);   // las apariciones cambian con el tiempo
      markers.clear(); radarKey = '';
      toast(`${c.icon} ${c.label}${night ? ' · de noche salen más criaturas raras' : ''}. Salen más las criaturas con #${clima.tags.slice(0, 3).join(' #')}`, 5000);
    }
    refreshSpawns();
  } catch (e) { console.warn('clima', e); clima.at = Date.now() - 10 * 60e3; } // reintentar en 5 min
}
setInterval(() => { if (player) updateClima(player.lat, player.lng); }, 5 * 60e3);

// ---------------------------------------------------------------- Mapa
const map = L.map('map', { zoomControl: false }).setView(CFG.defaultLocation, 17);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© OpenStreetMap'
}).addTo(map);

let player = null, follow = true, manualPos = false, gotGPS = false;
const meMarker = L.marker(CFG.defaultLocation, {
  icon: L.divIcon({ className: '', html: '<div class="me"><div class="pulse"></div><div class="dot"></div></div>', iconSize: [24, 24] }),
  interactive: false, zIndexOffset: 1000
});
const rangeCircle = L.circle(CFG.defaultLocation, { radius: CFG.catchRadius, color: '#2f80ff', weight: 1, fillOpacity: 0.07, interactive: false });
const markers = new Map();

function setPlayer(lat, lng) {
  const first = !player;
  player = { lat, lng };
  meMarker.setLatLng(player); rangeCircle.setLatLng(player);
  if (first) { meMarker.addTo(map); rangeCircle.addTo(map); map.setView(player, 17); }
  else if (follow) map.panTo(player, { animate: true });
  refreshSpawns();
  refreshStops();
  if (autoStops) OSM.asegurar(OSM.celdasAlrededor(lat, lng), refreshStops);
  updateCurrentBarrio(lat, lng);
  updateBuddyMarker();
  exploreAt(lat, lng);
  updateClima(lat, lng);
}

// ---------------------------------------------------------------- Niebla de exploración
// El mapa está cubierto de niebla y se despeja por donde pasas (zonas de unos 55 m). Se puede quitar en Ajustes.
const FOG_CELL = 0.0005, FOG_R = 70;  // tamaño de zona (grados) y radio despejado (m)
save.explored = save.explored || {};
const fogKey = (la, ln) => `${Math.round(la / FOG_CELL)}_${Math.round(ln / FOG_CELL)}`;
function exploreAt(lat, lng) {
  let nuevas = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const la = lat + dx * FOG_CELL, ln = lng + dy * FOG_CELL;
    if (distM({ lat, lng }, { lat: Math.round(la / FOG_CELL) * FOG_CELL, lng: Math.round(ln / FOG_CELL) * FOG_CELL }) > FOG_R) continue;
    const k = fogKey(la, ln);
    if (!save.explored[k] && Object.keys(save.explored).length < 30000) { save.explored[k] = 1; nuevas++; }
  }
  if (nuevas) { persist(); drawFog(); }
}
map.createPane('niebla');
map.getPane('niebla').style.zIndex = 450;            // encima del mapa, debajo de criaturas y paradas
map.getPane('niebla').style.pointerEvents = 'none';
const fogCanvas = L.DomUtil.create('canvas', 'fog-canvas', map.getPane('niebla'));
function drawFog() {
  const size = map.getSize(), dpr = Math.min(2, devicePixelRatio || 1);
  L.DomUtil.setPosition(fogCanvas, map.containerPointToLayerPoint([0, 0]));
  fogCanvas.width = size.x * dpr; fogCanvas.height = size.y * dpr;
  fogCanvas.style.width = size.x + 'px'; fogCanvas.style.height = size.y + 'px';
  const g = fogCanvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size.x, size.y);
  if (save.fog === false) return;
  g.fillStyle = document.body.classList.contains('night') ? 'rgba(20,25,45,.5)' : 'rgba(225,232,245,.55)';
  g.fillRect(0, 0, size.x, size.y);
  // Despejar las zonas exploradas que se ven en pantalla
  const b = map.getBounds().pad(0.2), c = map.getCenter();
  const px = map.latLngToContainerPoint([c.lat, c.lng]).distanceTo(map.latLngToContainerPoint([c.lat + FOG_R / 111320, c.lng]));
  g.globalCompositeOperation = 'destination-out';
  const r0 = Math.max(4, px);
  for (const k in save.explored) {
    const [a, o] = k.split('_').map(Number), la = a * FOG_CELL, ln = o * FOG_CELL;
    if (la < b.getSouth() || la > b.getNorth() || ln < b.getWest() || ln > b.getEast()) continue;
    const p = map.latLngToContainerPoint([la, ln]);
    const gr = g.createRadialGradient(p.x, p.y, r0 * 0.4, p.x, p.y, r0);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r0, 0, 7); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}
map.on('moveend zoomend resize', drawFog);
setTimeout(drawFog, 500);

// ---------------------------------------------------------------- Paradas (recarga de orbes)
let customStops = [], hiddenStops = new Set(), autoStops = CFG.autoParadas;
const stopMarkers = new Map();
const cooldownMs = () => CFG.stopCooldownMin * 60e3;
const stopReadyIn = s => Math.max(0, (save.stops[s.id] || 0) + cooldownMs() - Date.now());

async function loadParadas() {
  try {
    const r = await fetch('paradas.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    const arr = Array.isArray(d) ? d : (d.paradas || []);
    customStops = arr.filter(p => isFinite(p.lat) && isFinite(p.lng)).map(p => ({
      id: String(p.id || `p_${p.lat}_${p.lng}`), nombre: p.nombre || 'Parada', descripcion: p.descripcion || '',
      lat: +p.lat, lng: +p.lng, foto: p.foto || '', custom: true }));
    hiddenStops = new Set(d.ocultas || []);
    if (d.auto === false) autoStops = false;
  } catch (e) { console.warn('paradas.json', e); }
}

function visibleStops() {
  if (!player) return [];
  // Las paradas se ven siempre, estés donde estés
  let auto = [];
  if (autoStops) auto = OSM.enCeldas(OSM.celdasAlrededor(player.lat, player.lng))
    .filter(s => !hiddenStops.has(s.id) && customStops.every(c => OSM.metros(c, s) > 40));
  return customStops.concat(auto);
}

function stopHtml(s) {
  return `<div class="stop ${stopReadyIn(s) ? 'used' : ''}"><div class="disc">${s.foto
    ? `<img src="${esc(s.foto)}" alt="" draggable="false" onerror="this.remove()">` : ''}<span>★</span></div><div class="pole"></div></div>`;
}

function refreshStops() {
  if (!player) return;
  const list = visibleStops(), ids = new Set(list.map(s => s.id));
  for (const [id, m] of stopMarkers) if (!ids.has(id)) { map.removeLayer(m); stopMarkers.delete(id); }
  for (const s of list) {
    let m = stopMarkers.get(s.id);
    if (!m) {
      m = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', iconSize: [44, 66], iconAnchor: [22, 64], html: stopHtml(s) }), zIndexOffset: -500
      }).addTo(map);
      m.on('click', () => openStop(m.stop));
      stopMarkers.set(s.id, m);
    }
    m.stop = s;
    const el = m.getElement()?.firstElementChild, f = save.fert[s.id];
    el?.classList.toggle('used', stopReadyIn(s) > 0);
    el?.classList.toggle('growing', !!f && f.ready > Date.now());
    el?.classList.toggle('bloom', !!f && f.ready <= Date.now());
    el?.classList.toggle('has-nota', notasDe(s).some(n => !mineNota(n)));
  }
  avisarNotasCerca(list);
  refreshFert();
}

const stopPanel = $('#stopPanel');
let openStopData = null, stopTimer = null;
function openStop(s) {
  if (cs) return;
  openStopData = s;
  const disc = $('#stopDisc');
  disc.className = 'stop-disc';
  disc.innerHTML = s.foto ? `<img src="${esc(s.foto)}" alt="" onerror="this.remove()">` : '';
  $('#stopName').textContent = s.nombre;
  $('#stopDesc').textContent = s.descripcion || '';
  $('#stopGain').textContent = '';
  fertUI = null; fertKey = '';
  stopPanel.hidden = false;
  updateStopPanel();
  renderNotas(s, true);
  clearInterval(stopTimer); stopTimer = setInterval(updateStopPanel, 1000);
}
function closeStop() { stopPanel.hidden = true; openStopData = null; clearInterval(stopTimer); refreshStops(); }
function updateStopPanel() {
  const s = openStopData; if (!s || !player) return;
  const d = distM(player, s), wait = stopReadyIn(s), btn = $('#stopBtn');
  const inRange = d <= CFG.catchRadius || save.dev;
  $('#stopDisc').classList.toggle('used', wait > 0);
  let txt = '', ok = false;
  if (wait > 0) txt = `Disponible en ${fmtDur(wait)}`;
  else if (!inRange) txt = `Acércate más (estás a ${Math.round(d)} m)`;
  else { txt = 'Recoger'; ok = true; }
  btn.textContent = txt; btn.disabled = !ok;
  $('#stopInfo').innerHTML = `${s.custom ? 'Parada del grupo' : 'Sitio de OpenStreetMap'} · ${Math.round(d)} m<br>
    Tienes <i class="mini-orb"></i> ${save.orbs} orbes · <i class="coin"></i> ${save.coins} todocoins`;
  renderFertBox(s, inRange);
}
function collectStop() {
  const s = openStopData;
  if (!s || $('#stopBtn').disabled) return;
  const first = !save.visited[s.id];
  const n = Math.max(0, Math.min(CFG.orbsMax - save.orbs, 3 + Math.floor(Math.random() * 3) + (first ? 5 : 0)));
  const coins = Math.round((2 + Math.floor(Math.random() * 3) + (first ? 5 : 0)) * eventMult('monedas'));
  const xp = Math.round((50 + (first ? 250 : 0)) * eventMult('xp')), prevLvl = levelOf(save.xp);
  const gift = save.gifts < 10 && (first || Math.random() < 0.35);
  if (gift) save.gifts++;
  dailyInc('stops');
  save.orbs += n; save.coins += coins; save.xp += xp; save.stops[s.id] = Date.now(); save.visited[s.id] = true;
  persist(); updateHud();
  const disc = $('#stopDisc');
  disc.classList.remove('spin'); void disc.offsetWidth; disc.classList.add('spin');
  const g = $('#stopGain');
  g.innerHTML = `+${n} <i class="mini-orb"></i> · +${coins} <i class="coin"></i> · +${xp} XP` +
    (gift ? `<br><small>🎁 ¡Un regalo para enviar a un amigo! (tienes ${save.gifts})</small>` : '') +
    (n ? '' : '<br><small>Mochila de orbes llena</small>') +
    (first ? '<br><small>¡Primera visita!</small>' : '') +
    (levelOf(save.xp) > prevLvl ? `<br><b>¡Nivel ${levelOf(save.xp)}!</b>` : '');
  g.classList.remove('pop'); void g.offsetWidth; g.classList.add('pop');
  updateStopPanel(); refreshStops();
}
function fmtDur(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${sec} s` : `${sec} s`;
}

// ---------------------------------------------------------------- Todocoins y abono de paradas
// Abonas una parada durante X horas; al terminar brota junto a ella una criatura rara o mejor.
// Cuantas más horas, más probabilidad de las rarezas altas.
const FERT_HOURS = [5, 10, 12, 20, 24];
const fertCost = h => h * CFG.coinsPerHour;
const hourMs = () => save.dev ? 60e3 : 3600e3;   // en modo prueba las "horas" duran un minuto
const fertUnit = () => save.dev ? 'min' : 'h';
const pct = x => { const v = x * 100; return (v > 0 && v < 1 ? v.toFixed(1) : Math.round(v)) + ' %'; };
function fertWeights(h) {
  const f = 1 + h / 24; // cada nivel de rareza se multiplica: 5 h → ×1,2 · 24 h → ×2
  return RAR_ORDER.slice(1).filter(r => creatures.some(c => c.rarity === r))
    .map(r => [r, RAR[r].weight * Math.pow(f, RAR_ORDER.indexOf(r) - 1)]);
}
function fertOdds(h, from) {
  const w = fertWeights(h), tot = w.reduce((a, x) => a + x[1], 0);
  if (!tot) return 0;
  return w.filter(([r]) => RAR_ORDER.indexOf(r) >= RAR_ORDER.indexOf(from)).reduce((a, x) => a + x[1], 0) / tot;
}
function rollFert(h) {
  const w = fertWeights(h);
  let rar;
  if (!w.length) rar = [...RAR_ORDER].reverse().find(r => creatures.some(c => c.rarity === r)); // solo hay comunes
  else {
    let x = Math.random() * w.reduce((a, v) => a + v[1], 0);
    rar = w[w.length - 1][0];
    for (const [r, v] of w) { x -= v; if (x <= 0) { rar = r; break; } }
  }
  const pool = creatures.filter(c => c.rarity === rar);
  return pool[Math.floor(Math.random() * pool.length)];
}
function fertilize(s, h) {
  const cost = fertCost(h);
  if (save.coins < cost || save.fert[s.id]) return;
  const c = rollFert(h);
  if (!c) { toast('No hay criaturas en el repositorio'); return; }
  save.coins -= cost;
  const now = Date.now();
  save.fert[s.id] = { start: now, ready: now + h * hourMs(), hours: h, cid: c.id, rarity: c.rarity,
    lat: s.lat, lng: s.lng, nombre: s.nombre, shiny: Math.random() < CFG.shinyRate };
  persist(); updateHud(); fertUI = null;
  toast(`🌱 Parada abonada. Vuelve en ${h} ${fertUnit()}`);
  updateStopPanel(); refreshStops();
}
function fertSpawn(stopId) {
  const f = save.fert[stopId];
  const creature = creatures.find(c => c.id === f.cid) || creatures.find(c => c.rarity === f.rarity) || creatures[0];
  return { id: 'fert_' + stopId, stopId, fert: true, lat: f.lat + 0.00012, lng: f.lng + 0.00012, creature, shiny: !!f.shiny };
}
const fertMarkers = new Map();
function refreshFert() {
  const now = Date.now();
  const seen = id => player && distM(player, fertSpawn(id)) <= CFG.revealRadius;
  for (const [id, m] of fertMarkers)
    if (!save.fert[id] || save.fert[id].ready > now || !seen(id)) { map.removeLayer(m); fertMarkers.delete(id); }
  if (!creatures.length) return;
  for (const id in save.fert) {
    const f = save.fert[id];
    if (f.ready > now) continue;
    if (!f.notified) { f.notified = true; persist(); toast(`✨ ¡Ha brotado algo en ${f.nombre}! Ve a la parada para verlo.`, 4500); }
    if (fertMarkers.has(id) || !seen(id)) continue;
    const sp = fertSpawn(id);
    const m = L.marker([sp.lat, sp.lng], { zIndexOffset: 800, icon: L.divIcon({ className: '', iconSize: [64, 64], iconAnchor: [32, 60],
      html: `<div class="spawn fert r-${sp.creature.rarity} ${sp.shiny ? 'shiny' : ''}">${creatureImg(sp.creature, sp.shiny)}</div>` }) }).addTo(map);
    m.on('click', () => tryEncounter(fertSpawn(id)));
    fertMarkers.set(id, m);
  }
}

let fertUI = null, fertKey = '';
function fertState(s) {
  const f = save.fert[s.id];
  if (!f) return fertUI && fertUI.id === s.id ? 'choose' : 'none';
  return f.ready > Date.now() ? 'growing' : 'ready';
}
function renderFertBox(s, inRange) {
  const box = $('#fertBox'), st = fertState(s), f = save.fert[s.id], unit = fertUnit();
  box.closest('.stop-card').classList.toggle('compact', st === 'choose');
  const key = [s.id, st, fertUI && fertUI.hours, inRange, save.coins, save.dev].join('|');
  if (key !== fertKey) {
    fertKey = key;
    if (st === 'none') box.innerHTML = '<button class="btn secondary fert-open">🌱 Abonar esta parada</button>';
    else if (st === 'choose') {
      const h = fertUI.hours, cost = fertCost(h);
      const label = !inRange ? 'Acércate para abonarla'
        : save.coins < cost ? `Te faltan ${cost - save.coins} todocoins` : `Abonar ${h} ${unit} · ${cost} todocoins`;
      box.innerHTML = `<div class="fert-title">¿Cuánto tiempo la abonas?</div>
        <div class="seg">${FERT_HOURS.map(x => `<button class="seg-b ${x === h ? 'on' : ''}" data-h="${x}">${x} ${unit}<small><i class="coin"></i> ${fertCost(x)}</small></button>`).join('')}</div>
        <div class="fert-odds">Brotará una criatura <b>rara o mejor</b>. Con ${h} ${unit}:<br>
          Épica o mejor <b>${pct(fertOdds(h, 'epico'))}</b> · Legendaria o mejor <b>${pct(fertOdds(h, 'legendario'))}</b><br>
          Astral o mejor <b>${pct(fertOdds(h, 'astral'))}</b> · Secreta <b>${pct(fertOdds(h, 'secreto'))}</b></div>
        <button class="btn fert-go" ${inRange && save.coins >= cost ? '' : 'disabled'}>${label}</button>
        <button class="link fert-cancel">Cancelar</button>`;
    } else if (st === 'growing') {
      box.innerHTML = `<div class="fert-title">🌱 Abonada ${f.hours} ${unit} · algo está creciendo…</div>
        <div class="bar"><i id="fertBar"></i></div><div class="muted" id="fertLeft"></div>`;
    } else {
      const c = fertSpawn(s.id).creature;
      box.innerHTML = `<div class="fert-title">✨ ¡Ha brotado una criatura <span class="tag r-${c.rarity}">${RAR[c.rarity].label}</span>!</div>
        <button class="btn fert-catch" ${inRange ? '' : 'disabled'}>${inRange ? '¡A capturarla!' : 'Acércate para capturarla'}</button>`;
    }
  }
  if (st === 'growing') {
    const left = f.ready - Date.now();
    $('#fertBar').style.width = (100 * (1 - left / (f.ready - f.start))).toFixed(1) + '%';
    $('#fertLeft').textContent = `Lista en ${fmtDur(left)}`;
  }
}
$('#fertBox').onclick = e => {
  const s = openStopData, b = e.target.closest('button');
  if (!s || !b || b.disabled) return;
  if (b.classList.contains('fert-open')) fertUI = { id: s.id, hours: 12 };
  else if (b.dataset.h) fertUI.hours = +b.dataset.h;
  else if (b.classList.contains('fert-cancel')) fertUI = null;
  else if (b.classList.contains('fert-go')) return fertilize(s, fertUI.hours);
  else if (b.classList.contains('fert-catch')) { const sp = fertSpawn(s.id); closeStop(); tryEncounter(sp); return; }
  updateStopPanel();
};
$('#stopBtn').onclick = collectStop;
$('#stopDisc').onclick = collectStop;
$('#stopClose').onclick = closeStop;
stopPanel.onclick = e => { if (e.target === stopPanel) closeStop(); };

// Las criaturas existen aunque estén lejos, pero solo aparecen en el mapa cuando estás cerca.
function refreshSpawns() {
  if (!player) return;
  const spawns = computeSpawns(player, 1).filter(s => distM(player, s) <= CFG.revealRadius);
  const ids = new Set(spawns.map(s => s.id));
  for (const [id, m] of markers) if (!ids.has(id)) { map.removeLayer(m); markers.delete(id); }
  for (const s of spawns) if (!markers.has(s.id)) {
    const m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', iconSize: [58, 58], iconAnchor: [29, 54],
        html: `<div class="spawn reveal r-${s.creature.rarity} ${s.shiny ? 'shiny' : ''}">${creatureImg(s.creature, s.shiny)}</div>` })
    }).addTo(map);
    m.spawn = s;
    m.on('click', () => tryEncounter(s));
    markers.set(s.id, m);
    if (radarSel === s.id) { toast(`✨ ¡${s.creature.name} está aquí mismo!`, 3500); clearRadarSel(); }
  }
  let near = 0;
  for (const m of markers.values()) {
    const isNear = save.dev || distM(player, m.spawn) <= CFG.catchRadius;
    if (isNear) near++;
    m.getElement()?.firstElementChild?.classList.toggle('near', isNear && !save.dev);
  }
  // Rastreo: criaturas épicas o mejores por la zona que aún no se ven
  const minR = RAR_ORDER.indexOf('epico');
  const rares = computeSpawns(player, CFG.radarRange)
    .filter(s => RAR_ORDER.indexOf(s.creature.rarity) >= minR && !ids.has(s.id))
    .map(s => ({ ...s, d: distM(player, s) }))
    .sort((a, b) => RAR_ORDER.indexOf(b.creature.rarity) - RAR_ORDER.indexOf(a.creature.rarity) || a.d - b.d);
  renderRadar(mergeEscondites(mergeAvisos(rares, ids)));
  refreshHideMarkers();
  const bar = currentBarrio && currentBarrio.murcia && currentBarrio.name
    ? `${MASTERY_ICON[masteryLevel(save.barrios[currentBarrio.id]?.pts || 0)]} ${esc(currentBarrio.name)} · ` : '';
  setStatus(`${save.dev ? '<span class="dev">PRUEBA</span>' : ''}${clima.icon ? `${clima.icon} ${clima.temp}° · ` : ''}${bar}${near && !save.dev ? `✨ ${near} al alcance · ` : ''}👀 ${markers.size}`);
}

// ---------------------------------------------------------------- Rastreo de criaturas raras
const RC = { comun: '#5cc23a', raro: '#1ea7ff', superraro: '#00bfae', epico: '#a855f7', legendario: '#ffb300',
  mitico: '#ff2d92', astral: '#5b6cff', secreto: '#3a3a48' };
let radarSel = null, radarCircle = null, radarKey = '', radarList = [];
function hintCenter(s) {
  // Centro desplazado al azar (siempre igual para cada criatura) para que la zona no delate el punto exacto
  const r = seeded('pista' + s.id), ang = r() * Math.PI * 2, off = (0.15 + r() * 0.5) * CFG.hintRadius;
  return { lat: s.lat + off * Math.cos(ang) / 111320, lng: s.lng + off * Math.sin(ang) / (111320 * Math.cos(s.lat * Math.PI / 180)) };
}
function clearRadarSel() {
  radarSel = null;
  if (radarCircle) { map.removeLayer(radarCircle); radarCircle = null; }
  document.querySelectorAll('.radar-item.on').forEach(b => b.classList.remove('on'));
}
function renderRadar(list) {
  radarList = list;
  if (radarSel && !list.some(s => s.id === radarSel)) clearRadarSel();
  const key = list.map(s => s.id + ':' + Math.round(s.d / 100) + (s.aviso || '')).join('|') + '|' + radarSel;
  if (key === radarKey) return;
  radarKey = key;
  const box = $('#radar');
  box.hidden = !list.length;
  $('#radarList').innerHTML = list.map(s => {
    const c = s.creature, secret = c.rarity === 'secreto' && !known(c);
    return `<button class="radar-item r-${c.rarity} ${s.id === radarSel ? 'on' : ''} ${s.aviso ? 'has-aviso' : ''}" data-id="${esc(s.id)}" title="${esc(RAR[c.rarity].label)}${s.aviso ? (s.hide ? ' · escondite de @' : ' · aviso de @') + esc(s.aviso) : ''}">
      ${secret ? '<i class="radar-q">?</i>' : `<span class="radar-sil"><img src="${esc(c.url)}" alt="" draggable="false"></span>`}
      ${s.aviso ? `<i class="radar-aviso">${s.hide ? '🫣' : '📣'}</i>` : ''}
      <small>${s.aviso ? '@' + esc(s.aviso) : `~${Math.max(100, Math.round(s.d / 100) * 100)} m`}</small></button>`;
  }).join('');
}
$('#radarList').onclick = e => {
  const b = e.target.closest('.radar-item'); if (!b) return;
  if (radarSel === b.dataset.id) { clearRadarSel(); return; }
  const s = radarList.find(x => x.id === b.dataset.id); if (!s) return;
  clearRadarSel();
  radarSel = s.id; b.classList.add('on');
  const c = s.creature, center = s.exact ? { lat: s.lat, lng: s.lng } : hintCenter(s), col = RC[c.rarity];
  const radius = s.exact ? 60 : CFG.hintRadius;  // un amigo la vio: la zona es más pequeña
  const secretIcon = c.rarity === 'secreto' && !known(c);
  radarCircle = L.layerGroup([
    L.circle(center, { radius, color: col, weight: 4, dashArray: '10 8',
      fillColor: col, fillOpacity: 0.22, interactive: false, className: 'hint-zone' }),
    L.marker(center, { interactive: false, zIndexOffset: 900, icon: L.divIcon({ className: '', iconSize: [56, 56],
      html: `<div class="hint-pin r-${c.rarity}">${secretIcon ? '' : `<img src="${esc(c.url)}" alt="">`}<b>?</b></div>` }) })
  ]).addTo(map);
  follow = false;
  map.fitBounds(L.latLng(center).toBounds(radius * 2).extend([player.lat, player.lng]),
    { paddingTopLeft: [40, 150], paddingBottomRight: [40, 130], maxZoom: 17 });
  // Sin desvelar qué es: solo su rareza (se ve su silueta)
  toast(s.hide ? `🫣 @${s.aviso} escondió algo por esta zona${s.pista ? `: «${s.pista}»` : ''}. ¡Búscalo!`
    : s.aviso ? `📣 @${s.aviso} avisó: algo ${RAR[c.rarity].label.toLowerCase()} justo aquí. ¡Corre!`
    : `Algo ${RAR[c.rarity].label.toLowerCase()} anda por esta zona. ¡Acércate para descubrir qué es!`, 4000);
};

function removeSpawn(s) {
  if (s.fert) { // criatura brotada: se termina el abono de esa parada
    delete save.fert[s.stopId]; persist();
    const m = fertMarkers.get(s.stopId); if (m) { map.removeLayer(m); fertMarkers.delete(s.stopId); }
    refreshStops(); return;
  }
  save.gone[s.id] = Date.now(); persist();
  const m = markers.get(s.id); if (m) { map.removeLayer(m); markers.delete(s.id); }
}

function setStatus(html) { $('#status').innerHTML = html; }

map.on('dragstart', () => { follow = false; });
map.on('click', e => {
  if (!save.dev) return;
  manualPos = true; follow = false;
  if (player) addWalk(distM(player, e.latlng)); // en modo prueba, moverse tocando el mapa cuenta como andar
  setPlayer(e.latlng.lat, e.latlng.lng);
});
$('#btnCenter').onclick = () => {
  follow = true;
  if (player) map.setView(player, Math.max(map.getZoom(), 17));
};

function startGeo() {
  const fallback = () => {
    if (!player) setPlayer(...CFG.defaultLocation);
    toast('Sin GPS. Activa "Modo prueba" en Ajustes y toca el mapa para moverte.', 5000);
  };
  if (!('geolocation' in navigator)) return fallback();
  setTimeout(() => { if (!gotGPS) fallback(); }, 9000);
  navigator.geolocation.watchPosition(p => {
    gotGPS = true;
    if (!manualPos) {
      trackWalk(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.timestamp || Date.now());
      setPlayer(p.coords.latitude, p.coords.longitude);
    }
  }, err => { console.warn(err); if (!gotGPS && err.code === 1) fallback(); },
  { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function tryEncounter(s) {
  if (cs || !player || openStopData) return;
  const d = distM(player, s);
  if (d > CFG.catchRadius && !save.dev) {
    toast(`${s.creature.name} está a ${Math.round(d)} m. ¡Acércate más!`);
    return;
  }
  openCatch(s);
}

// ---------------------------------------------------------------- Pantalla de captura
const catchEl = $('#catch'), target = $('#target'), cImg = $('#creatureImg'), ring = $('#ring'), ringMax = $('#ringMax');
const orb = $('#orb'), orbIn = orb.firstElementChild, cMsg = $('#catchMsg'), cam = $('#cam'), btnRun = $('#btnRun'), fx = $('#fx');
const cShadow = $('#cShadow'), oShadow = $('#oShadow'), arena = $('#arena');
const FR = 38; // fotogramas hasta que el orbe llega a la criatura
// Probabilidad de que la criatura salte en cada intervalo (~2,2 s): las más raras saltan más
const JUMP = { comun: 0, raro: 0.06, superraro: 0.12, epico: 0.18, legendario: 0.24, mitico: 0.3, astral: 0.36, secreto: 0.42 };
const CURVE_BONUS = 1.35;
let cs = null, drag = null, camStream = null;

// Sonido (sintetizado, sin archivos) y vibración
const sfx = (() => {
  let ac = null;
  const ctx = () => {
    if (!save.sound) return null;
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); }
    catch { return null; }
    return ac;
  };
  function tone(freq, dur, { type = 'sine', vol = 0.15, slide = 0, delay = 0 } = {}) {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(dur, { vol = 0.15, from = 2000, to = 400, delay = 0 } = {}) {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + delay, n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(a.destination); src.start(t);
  }
  const vib = p => { if (save.sound && navigator.vibrate) try { navigator.vibrate(p); } catch {} };
  return {
    unlock: ctx,
    ping: k => tone(520 + 700 * k, 0.07, { type: 'sine', vol: 0.04 + 0.08 * k }),
    throw: () => noise(0.35, { vol: 0.1, from: 900, to: 2600 }),
    curve: () => { tone(880, 0.2, { type: 'triangle', vol: 0.07, slide: 1.6 }); vib(15); },
    hit: () => { tone(220, 0.12, { type: 'square', vol: 0.08, slide: 0.5 }); noise(0.1, { vol: 0.18, from: 3000, to: 800 }); vib(30); },
    absorb: () => tone(300, 0.35, { vol: 0.12, slide: 2.5 }),
    shake: () => { tone(110, 0.12, { type: 'triangle', vol: 0.2 }); vib(25); },
    breakOut: () => { noise(0.3, { vol: 0.22, from: 400, to: 3000 }); tone(500, 0.3, { type: 'sawtooth', vol: 0.05, slide: 0.4 }); vib([40, 40, 80]); },
    flee: () => tone(600, 0.6, { vol: 0.1, slide: 0.3 }),
    miss: () => tone(170, 0.18, { vol: 0.1, slide: 0.6 }),
    success: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.12, delay: i * 0.11 })); vib([30, 60, 30, 60, 120]); }
  };
})();

// Partículas y estela
function burst(x, y, color, n = 12, star = false) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 80;
    p.className = 'spark' + (star ? ' star' : '');
    p.style.cssText = `left:${x}px;top:${y}px;--dx:${(Math.cos(a) * r).toFixed(0)}px;--dy:${(Math.sin(a) * r).toFixed(0)}px;--c:${color};animation-delay:${(Math.random() * 90).toFixed(0)}ms`;
    if (star) p.textContent = '★';
    fx.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}
function trail(x, y, s, curve) {
  const d = document.createElement('i');
  d.className = 'trail' + (curve ? ' c' : '');
  d.style.transform = `translate(${x}px,${y}px) scale(${s})`;
  fx.appendChild(d);
  d.addEventListener('animationend', () => d.remove());
}
function quake() { catchEl.classList.remove('quake'); void catchEl.offsetWidth; catchEl.classList.add('quake'); }

function openCatch(spawn) {
  const c = spawn.creature, now = performance.now();
  cs = { spawn, cr: c, phase: 'aim', t0: now, throws: 0, last: 0, ringS: 1, jump: 0, nextJump: now + 1500, candy: 0 };
  cImg.src = c.url; cImg.className = 'appear';
  const cFoil = $('#cFoil');
  target.classList.toggle('shiny', !!spawn.shiny);
  cFoil.hidden = !spawn.shiny;
  if (spawn.shiny) {
    cFoil.style.setProperty('--img', cssUrl(c.url));
    target.style.setProperty('--shue', shinyHue(c.id) + 'deg');
    setTimeout(() => { if (cs && cs.spawn === spawn) { flash('✨ ¡Es brillante!', 1600); sfx.curve(); } }, 500);
  }
  target.className = `r-${c.rarity}${spawn.shiny ? ' shiny' : ''}`; arena.className = `r-${c.rarity}`; ring.style.opacity = ''; ringMax.style.opacity = '';
  target.classList.remove('candied'); $('#candyMenu').hidden = true;
  $('#catchName').innerHTML = `${esc(c.name)} <span class="tag r-${c.rarity}">${RAR[c.rarity].label}</span>
    <small>${esc(c.category || 'Otros')}${spawn.fert ? ' · 🌱 brotada' : ''}</small>`;
  catchEl.hidden = false; cMsg.classList.remove('show'); document.body.classList.add('catching');
  const ba = $('#btnAviso');
  ba.hidden = !(signedIn() && !spawn.fert && RAR_ORDER.indexOf(c.rarity) >= RAR_ORDER.indexOf('epico'));
  ba.disabled = false; ba.textContent = '📣 Avisar';
  const hint = $('#catchHint');
  hint.hidden = false;
  hint.innerHTML = 'Desliza el orbe hacia arriba. ¡Acierta cuando el anillo sea pequeño!<br>Gira el orbe en círculos antes de lanzarlo para hacer una <b>curva</b>.';
  fx.innerHTML = '';
  layout(); resetOrb(true);
  if (save.cam) startCam();
  cs.raf = requestAnimationFrame(loop);
}

function closeCatch() {
  if (!cs) return;
  cancelAnimationFrame(cs.raf);
  cs = null; drag = null;
  fx.innerHTML = '';
  stopCam(); catchEl.hidden = true; document.body.classList.remove('catching');
  refreshSpawns();
}

// Cámara virtual: proyecta el mundo 3D (metros) a la pantalla.
// X = izquierda/derecha, Y = altura sobre el suelo, Z = distancia a la cámara.
const proj = (X, Y, Z) => {
  const c = cs.cam;
  return { x: cs.W / 2 + c.f * X / Z, y: c.hy + c.f * (c.h - Y) / Z };
};
// Cuánto se acercan/alejan las criaturas (metros): las más raras se mueven más en profundidad
const DEPTH = { comun: 0, raro: 0.4, superraro: 0.6, epico: 0.9, legendario: 1.1, mitico: 1.3, astral: 1.5, secreto: 1.8 };

function layout() {
  if (!cs) return;
  cs.W = catchEl.clientWidth; cs.H = catchEl.clientHeight;
  cs.size = Math.min(cs.W * 0.55, cs.H * 0.32, 280);           // tamaño en pantalla a la distancia normal
  target.style.width = target.style.height = cs.size + 'px';
  const cam = cs.cam = { h: 1.6, hy: cs.H * 0.30, z0: 3, zc: 7 }; // altura de los ojos, horizonte, orbe en mano, criatura
  cam.f = (cs.H * 0.62 - cam.hy) * cam.zc / cam.h;               // los pies de la criatura quedan al 62 % de la pantalla
  cs.hC = cs.size * cam.zc / cam.f;                              // altura de la criatura en metros
  cs.rest = { x: cs.W / 2, y: cs.H - 110 };
  cShadow.style.width = (cs.size * 0.72).toFixed(0) + 'px'; cShadow.style.height = (cs.size * 0.13).toFixed(0) + 'px';
  drawGround();
  if (cs.phase === 'aim' && !drag) setOrb(cs.rest.x, cs.rest.y);
}
addEventListener('resize', layout);

// Suelo con perspectiva: franjas de césped que se estrechan hacia el horizonte, colinas y bruma
function drawGround() {
  const cv = $('#ground'), cam = cs.cam, W = cs.W, H = cs.H, hy = cam.hy;
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const yAt = z => hy + cam.f * cam.h / z;
  // colinas lejanas (más claras = más lejos)
  [[0.10, '#a9cfe0', 0.013, 0], [0.06, '#9cc99a', 0.021, 2]].forEach(([amp, col, fr, ph]) => {
    g.beginPath(); g.moveTo(0, hy);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, hy - (Math.sin(x * fr + ph) * 0.5 + 0.5) * H * amp - 4);
    g.lineTo(W, hy); g.closePath(); g.fillStyle = col; g.fill();
  });
  // césped
  const grd = g.createLinearGradient(0, hy, 0, H);
  grd.addColorStop(0, '#b4d99c'); grd.addColorStop(0.18, '#93cc76'); grd.addColorStop(1, '#4c9a3d');
  g.fillStyle = grd; g.fillRect(0, hy, W, H - hy);
  // franjas (cortadas en profundidad): cada una más estrecha cuanto más lejos
  let z = 1.6, i = 0;
  while (z < 120) {
    const z2 = z * 1.22, y1 = yAt(z), y2 = yAt(z2);
    if (i % 2) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, y2, W, y1 - y2); }
    z = z2; i++;
  }
  // líneas que van hacia el punto de fuga
  g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = 1;
  for (let X = -25; X <= 25; X += 2) { // impares: ninguna justo en el centro
    const a = proj(X, 0, 1.2), b = proj(X, 0, 120);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  // bruma en el horizonte (perspectiva atmosférica)
  const fog = g.createLinearGradient(0, hy - H * 0.06, 0, hy + H * 0.14);
  fog.addColorStop(0, 'rgba(226,242,255,0)'); fog.addColorStop(0.35, 'rgba(226,242,255,.9)'); fog.addColorStop(1, 'rgba(226,242,255,0)');
  g.fillStyle = fog; g.fillRect(0, hy - H * 0.06, W, H * 0.2);
  // un poco más oscuro cerca de la cámara
  const vig = g.createLinearGradient(0, H * 0.75, 0, H);
  vig.addColorStop(0, 'rgba(0,40,0,0)'); vig.addColorStop(1, 'rgba(0,40,0,.25)');
  g.fillStyle = vig; g.fillRect(0, H * 0.75, W, H * 0.25);
}

function setOrb(x, y, s = 1, rot = 0) {
  cs.ox = x; cs.oy = y;
  orb.style.transform = `translate(${x}px,${y}px) scale(${s}) rotate(${rot}deg)`;
}
function resetOrb(animated) {
  if (!cs) return;
  cs.phase = 'aim'; cs.fl = null;
  oShadow.style.opacity = '0'; orb.style.zIndex = '';
  if (!ballCount(save.ball)) save.ball = BALL_ORDER.find(t => ballCount(t)) || 'orb';
  const has = ballCount(save.ball) > 0;
  orb.dataset.type = save.ball;
  orb.style.opacity = has ? '' : '0.25';
  orbIn.className = 'orb-inner';
  btnRun.disabled = false;
  updateCatchItems();
  if (animated && has) { // el orbe nuevo sube desde abajo
    orb.style.transition = 'none'; setOrb(cs.rest.x, cs.H + 90); void orb.offsetWidth;
    orb.style.transition = 'transform .45s cubic-bezier(.2,1.4,.4,1)';
  } else orb.style.transition = '';
  setOrb(cs.rest.x, cs.rest.y);
  if (!has) {
    const h = $('#catchHint');
    h.hidden = false; h.innerHTML = '<b>¡No te quedan orbes!</b><br>Visita una parada o compra en la tienda.';
  }
}
function flash(text, ms = 1100) {
  cMsg.textContent = text; cMsg.classList.add('show');
  clearTimeout(flash.t); flash.t = setTimeout(() => cMsg.classList.remove('show'), ms);
}

function loop(now) {
  if (!cs) return;
  const dt = Math.min(50, cs.last ? now - cs.last : 16.67), k = dt / 16.67;
  cs.last = now;
  if (cs.phase === 'aim' || cs.phase === 'flying') {
    const cam = cs.cam, r = cs.cr.rarity, [amp, spd] = MOVE[r], t = (now - cs.t0) / 1000;
    // Posición en el mundo
    const zc = cam.zc + Math.sin(t * 0.55 + 1.3) * DEPTH[r];
    const X = (Math.sin(t * spd) + 0.3 * Math.sin(t * spd * 2.3)) * amp * cs.W * cam.zc / cam.f;
    // Saltos: se agacha (aviso), salta y aterriza
    let jY = 0, sx = 1, sy = 1;
    if (!cs.jump && now >= cs.nextJump) {
      cs.nextJump = now + 2200;
      if (Math.random() < JUMP[r]) cs.jump = now;
    }
    if (cs.jump) {
      const p = (now - cs.jump) / 1000;
      if (p >= 1) cs.jump = 0;
      else if (p < 0.3) { const q = Math.sin(p / 0.3 * Math.PI / 2); sy = 1 - 0.2 * q; sx = 1 + 0.14 * q; }
      else if (p < 0.85) { jY = Math.sin((p - 0.3) / 0.55 * Math.PI) * cs.hC * 0.6; sy = 1.07; sx = 0.95; }
      else { const q = Math.sin((p - 0.85) / 0.15 * Math.PI); sy = 1 - 0.1 * q; sx = 1 + 0.08 * q; }
    }
    const bob = (Math.sin(t * 2.1) * 0.5 + 0.5) * cs.hC * 0.03;
    // Proyección a pantalla
    const feet = proj(X, jY + bob, zc), ground = proj(X, 0, zc);
    const sNow = cam.zc / zc;                       // escala por distancia
    cs.zc = zc; cs.X = X; cs.sNow = sNow; cs.sizeNow = cs.size * sNow;
    cs.cx = feet.x; cs.cy = feet.y - cs.sizeNow / 2; cs.feetY = feet.y; cs.groundY = ground.y;
    cs.cyBase = proj(X, cs.hC / 2, zc).y;           // centro sin saltar (para apuntar)
    target.style.transform = `translate(${feet.x - cs.size / 2}px,${feet.y - cs.size}px) scale(${sNow * sx},${sNow * sy})`;
    // Sombra en el suelo (más pequeña y suave cuanto más alto salta) y plataforma
    const lift = clamp(1 - jY / (cs.hC * 0.8), 0.35, 1);
    cShadow.style.transform = `translate(${ground.x}px,${ground.y}px) scale(${sNow * lift})`;
    cShadow.style.opacity = (0.55 * lift).toFixed(2);
    const R = cs.hC * 0.62, yN = proj(X, 0, zc - R).y, yF = proj(X, 0, zc + R).y;
    arena.style.transform = `translate(${ground.x}px,${(yN + yF) / 2}px)`;
    arena.style.width = (2 * cam.f * R / zc).toFixed(1) + 'px';
    arena.style.height = (yN - yF).toFixed(1) + 'px';
    const P = 2200, ph = ((now - cs.t0) % P) / P;
    cs.ringS = 1 - 0.72 * ph;
    ring.style.transform = `scale(${cs.ringS})`;
  }
  if (cs.phase === 'flying') stepFlight(k);
  if (cs) cs.raf = requestAnimationFrame(loop);
}

function throwOrb(vxms, vyms, curve = 0) {
  // vxms / vyms: velocidad del dedo en px/ms. Dirección = hacia dónde va. Fuerza = si llega o se pasa.
  const cam = cs.cam;
  const X0 = (cs.ox - cs.W / 2) * cam.z0 / cam.f;          // del dedo (pantalla) al mundo
  const Y0 = cam.h - (cs.oy - cam.hy) * cam.z0 / cam.f;
  const zT = cs.zc, T = FR;                                  // llega a la profundidad de la criatura en T fotogramas
  const g = 0.0028 * cs.hC / 1.6;
  const vyNeed = (cs.hC / 2 - Y0 + 0.5 * g * T * T) / T;     // altura exacta para llegar al centro
  // ~2 px/ms = lanzamiento perfecto; si es flojo se queda corto, si es muy fuerte pasa por encima
  const power = clamp(-vyms / 2, 0.3, 1.9);
  const vy = vyNeed * (0.35 + 0.65 * power);
  const aimSx = cs.ox + (vxms / -vyms) * (cs.oy - cs.cyBase); // hacia dónde apunta el dedo, a la altura de la criatura
  const Xt = clamp((aimSx - cs.W / 2) * zT / cam.f, -12, 12);
  cs.fl = { X: X0, Y: Y0, Z: cam.z0, vx: (Xt - X0) / T, vy, vz: (zT - cam.z0) / T, g, f: 0, rot: 0,
    checked: false, curve, trail: 0, bounces: 0 };
  cs.phase = 'flying';
  cs.fl.ball = save.ball;
  useBall(save.ball); persist(); updateHud(); updateCatchItems();
  $('#candyMenu').hidden = true;
  $('#catchHint').hidden = true;
  sfx.throw();
}

function stepFlight(k) {
  const f = cs.fl, cam = cs.cam;
  f.X += f.vx * k; f.Y += f.vy * k; f.vy -= f.g * k; f.Z += f.vz * k; f.f += k;
  f.rot += (f.curve ? 34 * f.curve : 12 + f.vx * 60) * k;
  // Rebote si toca el suelo
  if (f.Y < 0.1) {
    f.Y = 0.1; f.vy = Math.abs(f.vy) * 0.45; f.vz *= 0.55; f.vx *= 0.55; f.bounces++;
    if (f.bounces === 1) sfx.miss();
  }
  // La curva se abre hacia un lado y vuelve al punto apuntado justo al llegar
  const p = Math.min(1, f.f / FR);
  const xo = f.curve ? f.curve * 0.16 * cs.W * cam.zc / cam.f * Math.sin(Math.PI * p) : 0;
  const P = proj(f.X + xo, f.Y, f.Z), sc = cam.z0 / f.Z;
  setOrb(P.x, P.y, sc, f.rot);
  orb.style.zIndex = f.Z > cs.zc + 0.15 ? '0' : '';         // si se pasa, queda detrás de la criatura
  // Sombra del orbe en el suelo
  const S = proj(f.X + xo, 0, f.Z);
  oShadow.style.transform = `translate(${S.x}px,${S.y}px) scale(${sc})`;
  oShadow.style.opacity = clamp(0.55 - f.Y * 0.18, 0.08, 0.55).toFixed(2);
  if ((f.trail += k) >= 1.5) { f.trail = 0; trail(P.x, P.y, sc, f.curve); }
  if (!f.checked && f.Z >= cs.zc) {
    f.checked = true;
    const d = Math.hypot(P.x - cs.cx, P.y - cs.cy);
    // si ya ha botado en el suelo no cuenta
    if (!f.bounces && d < cs.sizeNow * 0.45) { cs.phase = 'capture'; onHit(); return; }
    f.near = !f.bounces && d < cs.sizeNow * 0.8;
    f.short = f.bounces > 0;            // botó antes de llegar
    f.over = !f.bounces && P.y < cs.cy; // pasó por encima
  }
  const out = P.y < -120 || P.x < -100 || P.x > cs.W + 100 || f.Z > cs.zc + 9;
  if (f.f > FR + 55 || f.bounces > 2 || out) {
    cs.throws++; if (!f.bounces) sfx.miss();
    flash(f.near ? '¡Casi!' : (f.short || !f.checked) ? '¡Te has quedado corto!' : f.over ? '¡Demasiado fuerte!' : '¡Fallaste!');
    resetOrb(true);
  }
}

async function onHit() {
  const token = cs, q = cs.ringS, curve = cs.fl.curve;
  let bonus = 1, label = '¡Bien!';
  if (q < 0.45) { bonus = 1.8; label = '¡Excelente!'; } else if (q < 0.7) { bonus = 1.4; label = '¡Genial!'; }
  if (curve) { bonus *= CURVE_BONUS; label += ' + ¡Curva!'; dailyInc('curves'); }
  if (q < 0.45) dailyInc('excellent');
  btnRun.disabled = true;
  flash(label, 1400); sfx.hit();
  burst(cs.ox, cs.oy, '#ffffff', 14);
  cImg.className = 'hit';
  await sleep(140); if (cs !== token) return;
  ring.style.opacity = '0'; ringMax.style.opacity = '0'; cImg.className = 'absorb'; sfx.absorb();
  orbIn.className = 'orb-inner'; // quitar el giro de la curva para que se vea el temblor
  target.style.transform = `translate(${cs.cx - cs.size / 2}px,${cs.feetY - cs.size}px) scale(${cs.sNow})`;
  cShadow.style.opacity = '0'; oShadow.style.opacity = '0'; orb.style.zIndex = '';
  const oSc = Math.max(0.42, cs.cam.z0 / cs.zc);
  setOrb(cs.cx, cs.cy, oSc);
  await sleep(450); if (cs !== token) return;
  // cae al suelo (a la altura normal, aunque estuviera saltando)
  orb.style.transition = 'transform .45s cubic-bezier(.5,0,.75,1.5)';
  setOrb(cs.cx, cs.groundY - 37 * oSc, oSc);
  await sleep(550); if (cs !== token) return;
  orb.style.transition = '';
  const pc = Math.min(0.97, RAR[cs.cr.rarity].catch * bonus * BALLS[cs.fl.ball || 'orb'].mult * (cs.candy || 1));
  const perShake = Math.pow(pc, 1 / 3);
  cs.candy = 0; target.classList.remove('candied'); // el caramelo vale para un intento
  for (let i = 0; i < 3; i++) {
    orbIn.classList.remove('shake'); void orbIn.offsetWidth; orbIn.classList.add('shake');
    sfx.shake();
    await sleep(1000); if (cs !== token) return;
    if (Math.random() > perShake) return breakOut(token);
    burst(cs.ox, cs.oy - 30, '#ffe066', 3, true);
  }
  success(token);
}

async function breakOut(token) {
  orbIn.className = 'orb-inner burst';
  cImg.className = 'pop'; ring.style.opacity = ''; ringMax.style.opacity = ''; cShadow.style.opacity = '';
  flash('¡Se ha escapado del orbe!');
  sfx.breakOut(); quake();
  burst(cs.ox, cs.oy, getComputedStyle(target).getPropertyValue('--rc') || '#fff', 18);
  cs.throws++;
  await sleep(900); if (cs !== token) return;
  if (!cs.spawn.fert && Math.random() < RAR[cs.cr.rarity].flee + cs.throws * 0.02) { // las brotadas no huyen
    cs.phase = 'done'; cImg.className = 'flee'; orb.style.opacity = '0'; ring.style.opacity = '0'; ringMax.style.opacity = '0';
    flash(`¡${cs.cr.name} ha huido!${comboVivo() >= 2 ? ' Combo perdido 💔' : ''}`, 1600); sfx.flee();
    comboBreak();
    removeSpawn(cs.spawn);
    await sleep(1700); if (cs === token) closeCatch();
    return;
  }
  resetOrb(true);
}

async function success(token) {
  cs.phase = 'done';
  orbIn.className = 'orb-inner caught';
  flash('¡Capturado!', 1600); sfx.success();
  burst(cs.ox, cs.oy, '#ffd60a', 16, true);
  burst(cs.ox, cs.oy, '#7cff9b', 14);
  const c = cs.cr, R = RAR[c.rarity], isNew = !save.caught[c.id], prevLvl = levelOf(save.xp);
  save.caught[c.id] = (save.caught[c.id] || 0) + 1;
  if (isNew) save.first[c.id] = Date.now();
  save.stats.captures++;
  dailyInc('captures');
  if (RAR_ORDER.indexOf(c.rarity) >= RAR_ORDER.indexOf('raro')) dailyInc('rare');
  const shiny = !!cs.spawn.shiny, oculta = !!cs.spawn.oculta;
  if (shiny) save.shiny[c.id] = (save.shiny[c.id] || 0) + 1;
  creditBarrio({ lat: cs.spawn.lat, lng: cs.spawn.lng, cid: c.id, shiny });
  jefeHit(c, shiny);
  const combo = comboHit();
  const gained = Math.round((R.xp + (isNew ? 500 : 0) + (shiny ? 1000 : 0)) * eventMult('xp') * comboMult(combo));
  save.xp += gained;
  if (combo >= 2) setTimeout(() => flash(`⚡ ¡Combo ×${combo}! (+${Math.round((comboMult(combo) - 1) * 100)} % XP)`, 1400), 700);
  removeSpawn(cs.spawn);
  updateHud();
  await sleep(1600); if (cs !== token) return;
  closeCatch();
  if (oculta) { save.stats.ocultas = (save.stats.ocultas || 0) + 1; persist(); shareActivity('oculta', c, { shiny }, true); }
  else if (shiny || RAR_ORDER.indexOf(c.rarity) >= RAR_ORDER.indexOf('epico')) shareActivity('captura', c, { shiny });
  if (levelOf(save.xp) > prevLvl) shareActivity('nivel', null, { nivel: levelOf(save.xp) }, true);
  showCard(c, { isNew, gained, levelUp: levelOf(save.xp) > prevLvl, shiny });
}

// Arrastrar, girar (curva) y lanzar el orbe
orb.addEventListener('pointerdown', e => {
  if (!cs || cs.phase !== 'aim') return;
  e.preventDefault();
  sfx.unlock();
  if (!ballCount(save.ball)) { flash('¡Sin orbes!'); return; }
  $('#candyMenu').hidden = true;
  orb.setPointerCapture(e.pointerId);
  orb.style.transition = '';
  drag = { s: [{ x: e.clientX, y: e.clientY, t: performance.now() }], dx: e.clientX - cs.ox, dy: e.clientY - cs.oy,
    lx: e.clientX, ly: e.clientY, ang: null, turn: 0, curve: 0 };
});
orb.addEventListener('pointermove', e => {
  if (!drag || !cs) return;
  const t = performance.now();
  drag.s.push({ x: e.clientX, y: e.clientY, t });
  while (drag.s.length > 2 && t - drag.s[0].t > 90) drag.s.shift();
  setOrb(e.clientX - drag.dx, e.clientY - drag.dy);
  // Detectar giros: se suma cuánto cambia la dirección del dedo
  const mx = e.clientX - drag.lx, my = e.clientY - drag.ly;
  if (Math.hypot(mx, my) > 4) {
    const a = Math.atan2(my, mx);
    if (drag.ang !== null) {
      let d = a - drag.ang;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      drag.turn += d;
    }
    drag.ang = a; drag.lx = e.clientX; drag.ly = e.clientY;
    if (!drag.curve && Math.abs(drag.turn) > Math.PI * 2.5) { // ~1,25 vueltas
      drag.curve = Math.sign(drag.turn);
      orbIn.classList.add('curve'); sfx.curve();
    }
  }
});
orb.addEventListener('pointerup', e => {
  if (!drag || !cs) return;
  const t = performance.now();
  drag.s.push({ x: e.clientX, y: e.clientY, t });
  while (drag.s.length > 2 && t - drag.s[0].t > 90) drag.s.shift();
  const a = drag.s[0], b = drag.s[drag.s.length - 1], dt = Math.max(1, b.t - a.t), curve = drag.curve;
  drag = null;
  const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
  if (vy < -0.5) throwOrb(vx, vy, curve); else resetOrb();
});
orb.addEventListener('pointercancel', () => { drag = null; resetOrb(); });

btnRun.onclick = () => closeCatch();
$('#btnCam').onclick = () => {
  save.cam = !save.cam; persist();
  if (save.cam) startCam(); else stopCam();
};
async function startCam() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (!cs) return stopCam();
    cam.srcObject = camStream; cam.hidden = false; catchEl.classList.add('ar');
  } catch (e) {
    console.warn(e); save.cam = false; persist();
    toast('No se pudo abrir la cámara (requiere HTTPS y permiso).');
  }
}
function stopCam() {
  camStream?.getTracks().forEach(t => t.stop()); camStream = null;
  cam.srcObject = null; cam.hidden = true; catchEl.classList.remove('ar');
}

// ---------------------------------------------------------------- Objetos: orbes especiales y caramelos
const BALLS = {
  orb:   { label: 'Orbe',      mult: 1 },
  super: { label: 'Superorbe', mult: 1.5 },
  ultra: { label: 'Ultraorbe', mult: 2 }
};
const BALL_ORDER = ['orb', 'super', 'ultra'];
const CANDIES = {
  candy: { label: 'Caramelo',        mult: 1.5 },
  gold:  { label: 'Caramelo dorado', mult: 2.5 }
};
const SHOP = [
  { id: 'orb10',   kind: 'orb',   n: 10, price: 6,  name: '10 orbes',           desc: 'Los de siempre.' },
  { id: 'orb30',   kind: 'orb',   n: 30, price: 15, name: '30 orbes',           desc: 'Pack grande: sale más barato.' },
  { id: 'super5',  kind: 'super', n: 5,  price: 12, name: '5 superorbes',       desc: '×1,5 de probabilidad de captura.' },
  { id: 'ultra3',  kind: 'ultra', n: 3,  price: 15, name: '3 ultraorbes',       desc: '×2 de probabilidad de captura.' },
  { id: 'candy3',  kind: 'candy', n: 3,  price: 6,  name: '3 caramelos',        desc: 'Dáselo a la criatura: ×1,5 en el siguiente intento.' },
  { id: 'gold1',   kind: 'gold',  n: 1,  price: 8,  name: '1 caramelo dorado',  desc: '×2,5 en el siguiente intento. ¡Para las raras!' }
];
const ballCount = t => t === 'orb' ? save.orbs : (save.items[t] || 0);
function useBall(t) { if (t === 'orb') save.orbs = Math.max(0, save.orbs - 1); else save.items[t] = Math.max(0, (save.items[t] || 0) - 1); }
const fmtMult = m => '×' + String(m).replace('.', ',');
const itemIcon = kind => kind in BALLS ? `<i class="ball-ico t-${kind}"></i>` : `<i class="candy-ico t-${kind}">🍬</i>`;

// Color del anillo según la probabilidad real (rareza × orbe × caramelo): verde, amarillo, naranja, rojo
function updateRing() {
  if (!cs) return;
  const p = RAR[cs.cr.rarity].catch * BALLS[save.ball].mult * (cs.candy || 1);
  target.style.setProperty('--dc', p >= 0.6 ? '#34c759' : p >= 0.4 ? '#ffd60a' : p >= 0.2 ? '#ff9f0a' : '#ff3b30');
}
function updateCatchItems() {
  if (!cs) return;
  $('#orbLeft').innerHTML = `${itemIcon(save.ball)}<span>${BALLS[save.ball].label} ×${ballCount(save.ball)}</span>`;
  const nc = save.items.candy + save.items.gold;
  $('#candyBtn').innerHTML = `🍬<b>${nc}</b>`;
  $('#candyBtn').classList.toggle('active', !!cs.candy);
  $('#candyBtn').title = cs.candy ? `Caramelo activo (${fmtMult(cs.candy)})` : 'Dar un caramelo';
  $('#candyMenu').innerHTML = Object.entries(CANDIES).map(([k, c]) =>
    `<button data-candy="${k}" ${save.items[k] ? '' : 'disabled'}>${itemIcon(k)} ${c.label} <small>${fmtMult(c.mult)} · tienes ${save.items[k]}</small></button>`).join('');
  updateRing();
}
// Cambiar de orbe: toca el indicador de la esquina
$('#orbLeft').onclick = () => {
  if (!cs || cs.phase !== 'aim') return;
  const avail = BALL_ORDER.filter(t => ballCount(t) > 0);
  if (avail.length < 2) { flash(avail.length ? 'Solo tienes este tipo de orbe' : '¡Sin orbes!'); return; }
  save.ball = avail[(avail.indexOf(save.ball) + 1) % avail.length]; persist();
  orb.dataset.type = save.ball;
  updateCatchItems();
  flash(`${BALLS[save.ball].label} ${BALLS[save.ball].mult > 1 ? fmtMult(BALLS[save.ball].mult) : ''}`, 900);
};
$('#candyBtn').onclick = () => {
  if (!cs || cs.phase !== 'aim') return;
  if (cs.candy) { flash('Ya se está comiendo un caramelo', 900); return; }
  if (!save.items.candy && !save.items.gold) { toast('No tienes caramelos. Cómpralos en la tienda.'); return; }
  $('#candyMenu').hidden = !$('#candyMenu').hidden;
};
$('#candyMenu').onclick = async e => {
  const b = e.target.closest('button[data-candy]'); if (!b || !cs || cs.phase !== 'aim') return;
  const k = b.dataset.candy; if (!save.items[k]) return;
  save.items[k]--; persist();
  $('#candyMenu').hidden = true;
  // el caramelo vuela hasta la criatura
  const c = document.createElement('i');
  c.className = 'fly-candy' + (k === 'gold' ? ' gold' : ''); c.textContent = '🍬';
  c.style.cssText = `left:${cs.W - 70}px;top:${cs.H - 190}px;--tx:${(cs.cx - (cs.W - 70)).toFixed(0)}px;--ty:${(cs.cy - (cs.H - 190)).toFixed(0)}px`;
  fx.appendChild(c); c.addEventListener('animationend', () => c.remove());
  await sleep(550); if (!cs) return;
  cs.candy = CANDIES[k].mult;
  target.classList.add('candied');
  burst(cs.cx, cs.cy, k === 'gold' ? '#ffd60a' : '#ff6fb5', 10, true);
  sfx.curve();
  flash(`¡Ñam! ${fmtMult(cs.candy)}`, 1000);
  updateCatchItems();
};

// ---------------------------------------------------------------- Tienda
function renderShop() {
  $('#shopCoins').innerHTML = `<i class="coin"></i> ${save.coins}`;
  $('#shopInv').innerHTML = [...BALL_ORDER, 'candy', 'gold'].map(k =>
    `<span class="inv">${itemIcon(k)} <b>${k === 'orb' ? save.orbs : save.items[k]}</b></span>`).join('');
  $('#shopList').innerHTML = SHOP.map(it => {
    const full = it.kind === 'orb' && save.orbs >= CFG.orbsMax;
    const can = save.coins >= it.price && !full;
    return `<div class="shop-row nested">
      <div class="shop-ico">${itemIcon(it.kind)}</div>
      <div class="shop-info"><b>${it.name}</b><div class="muted">${it.desc}</div></div>
      <button class="btn small buy" data-id="${it.id}" ${can ? '' : 'disabled'}>${full ? 'Lleno' : `<i class="coin"></i> ${it.price}`}</button>
    </div>`;
  }).join('');
}
$('#shopList').onclick = e => {
  const b = e.target.closest('.buy'); if (!b || b.disabled) return;
  const it = SHOP.find(x => x.id === b.dataset.id); if (!it || save.coins < it.price) return;
  save.coins -= it.price;
  if (it.kind === 'orb') save.orbs = Math.min(CFG.orbsMax, save.orbs + it.n);
  else save.items[it.kind] += it.n;
  persist(); updateHud(); renderShop(); sfx.success();
  toast(`Comprado: ${it.name}`);
  const row = $(`.buy[data-id="${it.id}"]`)?.closest('.shop-row');
  row?.classList.remove('bought'); void row?.offsetWidth; row?.classList.add('bought');
};
$('#btnShop').onclick = () => { renderShop(); $('#shop').hidden = false; };
document.querySelector('.pill.orbs').onclick = () => { renderShop(); $('#shop').hidden = false; };

// ---------------------------------------------------------------- Nivel / HUD
const xpFor = lvl => 250 * (lvl - 1) ** 2;
const levelOf = xp => Math.floor(Math.sqrt(xp / 250)) + 1;
function updateHud() {
  const L = levelOf(save.xp), a = xpFor(L), b = xpFor(L + 1);
  $('#lvl').textContent = L;
  $('#xpbar').style.width = ((save.xp - a) / (b - a) * 100).toFixed(1) + '%';
  $('#xptext').textContent = `${save.xp - a} / ${b - a} XP`;
  $('#orbCount').textContent = save.orbs;
  $('#coinCount').textContent = save.coins;
  if (typeof checkLogros === 'function') checkLogros();
  if (typeof renderMisBadge === 'function') renderMisBadge();
}

// ---------------------------------------------------------------- Álbum / modal
const known = c => !!(save.caught[c.id] || save.first[c.id]);
function albumCell(c) {
  const n = save.caught[c.id] || 0, k = known(c);
  // Las secretas ni siquiera muestran la silueta hasta capturarlas
  const sh = save.shiny[c.id] || 0;
  const pic = !k && c.rarity === 'secreto'
    ? '<div class="mystery">?</div>'
    : creatureImg(c, sh > 0, 'loading="lazy"');
  return `<button class="cell r-${c.rarity} ${k ? '' : 'unknown'} ${n >= FUSE_N ? 'fusable' : ''} ${sh ? 'has-shiny' : ''}" data-id="${esc(c.id)}" title="${k ? esc(RAR[c.rarity].label) + (sh ? ' · Brillante' : '') : ''}">
    ${pic}<span>${k ? esc(c.name) : '???'}</span>${k ? `<b>×${n}</b>` : ''}<i class="rdot"></i>${n >= FUSE_N ? '<i class="fuse-badge">🥚</i>' : ''}${sh ? '<i class="shiny-badge">✨ Brillante</i>' : ''}</button>`;
}
function renderAlbum() {
  const got = list => list.filter(known).length;
  $('#albumCount').textContent = `${got(creatures)} / ${creatures.length}`;
  if (!creatures.length) { $('#albumGrid').innerHTML = '<div class="empty">No hay imágenes todavía.</div>'; return; }
  const q = stripAccents(($('#albumSearch')?.value || '').trim().toLowerCase());
  const norm = t => stripAccents(String(t).toLowerCase());
  // Las no descubiertas solo se encuentran por su familia (para no desvelar nombres ni etiquetas)
  const matches = c => !q || norm(c.category).includes(q) ||
    (known(c) && (norm(c.name).includes(q) || (c.tags || []).some(t => norm(t).includes(q))));
  const groups = new Map();
  for (const c of creatures) {
    if (!matches(c)) continue;
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(c);
  }
  if (!groups.size) { $('#albumGrid').innerHTML = '<div class="empty">No hay criaturas que coincidan con la búsqueda.</div>'; return; }
  const cats = [...groups.keys()].sort((a, b) => (a === 'Otros') - (b === 'Otros') || a.localeCompare(b, 'es'));
  const chips = cats.length > 1
    ? `<nav class="chips">${cats.map((cat, i) => `<button class="chip" data-sec="sec${i}">${esc(cat)}</button>`).join('')}</nav>` : '';
  $('#albumGrid').innerHTML = chips + cats.map((cat, i) => {
    const list = groups.get(cat).sort((a, b) =>
      RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name, 'es'));
    return `<section class="album-sec" id="sec${i}">
      <h3 class="album-h"><span>${esc(cat)}</span><span class="tag">${got(list)} / ${list.length}</span>${list.some(c => save.shiny[c.id]) ? `<span class="tag shiny-tag">✨ ${list.filter(c => save.shiny[c.id]).length}</span>` : ''}</h3>
      <div class="album-grid">${list.map(albumCell).join('')}</div></section>`;
  }).join('');
}
$('#albumSearch').oninput = () => renderAlbum();
$('#albumGrid').onclick = e => {
  const chip = e.target.closest('.chip');
  if (chip) { document.getElementById(chip.dataset.sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const cell = e.target.closest('.cell'); if (!cell) return;
  const c = creatures.find(x => x.id === cell.dataset.id);
  if (!c) return;
  if (!known(c)) return toast('Aún no has capturado esta criatura.');
  showCard(c, {});
};

function showCard(c, { isNew, gained, levelUp, hatched, shiny }) {
  const n = save.caught[c.id] || 0, first = save.first[c.id];
  const card = $('#modalCard');
  card.className = `card r-${c.rarity}`;
  const canFuse = n >= FUSE_N && !gained;
  const ns = save.shiny[c.id] || 0;
  card.innerHTML = `${shiny ? '<div class="new shiny-new">✨ ¡BRILLANTE! ✨</div>' : hatched ? '<div class="new">¡HA ECLOSIONADO!</div>' : isNew ? '<div class="new">¡NUEVA CRIATURA!</div>' : ''}
    <div class="card-pic">${creatureImg(c, !!shiny)}</div>
    <h3>${esc(c.name)}</h3><span class="tag">${RAR[c.rarity].label}</span> <span class="tag cat">${esc(c.category || 'Otros')}</span>
    ${shiny || ns ? '<span class="tag shiny-tag">✨ Brillante</span>' : ''}
    ${(c.tags || []).length ? `<div class="etq-list">${c.tags.map(t => `<span class="etq">#${esc(t)}</span>`).join('')}</div>` : ''}
    ${c.desc ? `<p class="cdesc">${esc(c.desc)}</p>` : ''}
    ${ns && !shiny ? `<div class="shiny-owned">${creatureImg(c, true)}<span>Tienes su versión brillante${ns > 1 ? ` ×${ns}` : ''}</span></div>` : ''}
    <div class="stats">${gained ? `+${gained} XP<br>` : ''}${levelUp ? `<b>¡Subes a nivel ${levelOf(save.xp)}!</b><br>` : ''}
    Tienes ${n} ${n === 1 ? 'copia' : 'copias'}${first ? `<br>Primera vez: ${new Date(first).toLocaleDateString('es-ES')}` : ''}</div>
    ${canFuse ? `<button class="btn fuse">🥚 Fusionar ${FUSE_N} en un huevo</button>
      <div class="muted fuse-info">Huevo ${RAR[c.rarity].label.toLowerCase()} de «${esc(c.category || 'Otros')}» · hay que andar ${EGG_KM[c.rarity]} km</div>` :
      n > 0 && !gained ? `<div class="muted fuse-info">Consigue ${FUSE_N} copias para fusionarlas en un huevo (${n}/${FUSE_N}).</div>` : ''}
    ${known(c) && !gained ? (save.buddy && save.buddy.id === c.id
      ? `<div class="buddy-info">🐾 Es tu compañera · ${buddyKm().toFixed(1).replace('.', ',')} km juntas</div>`
      : '<button class="btn secondary buddy-set">🐾 Hacer compañera</button>') : ''}
    ${n >= 2 && !gained && signedIn() ? '<button class="btn secondary hide-set">🫣 Esconder una para mis amigos</button>' : ''}
    <button class="btn ${canFuse ? 'secondary' : ''} ok">Vale</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  const bs = card.querySelector('.buddy-set');
  if (bs) bs.onclick = () => { setBuddy(c); $('#modal').hidden = true; };
  const hs = card.querySelector('.hide-set');
  if (hs) hs.onclick = () => hideForm(c);
  const fb = card.querySelector('.fuse');
  if (fb) fb.onclick = () => {
    if (!fb.dataset.sure) { fb.dataset.sure = 1; fb.textContent = `¿Seguro? Se gastan ${FUSE_N} ${c.name}`; return; }
    fuse(c);
  };
  $('#modal').hidden = false;
}

// ---------------------------------------------------------------- Fusión y huevos
// 5 copias iguales → un huevo de su rareza y su familia (categoría). Se abre andando.
const FUSE_N = 5, INCUBATORS = 3;
const EGG_KM = { comun: 1, raro: 2, superraro: 3, epico: 5, legendario: 7, mitico: 10, astral: 12, secreto: 15 };
// Qué sale del huevo respecto a su rareza: una menos, la misma, una más o dos más
const HATCH_SHIFT = [[-1, 15], [0, 55], [1, 25], [2, 5]];

const fmtKm = km => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 2 : 1).replace('.', ',')} km`;
const eggProgress = e => e.start == null ? 0 : Math.min(e.km, save.walked - e.start);
const eggReady = e => e.start != null && eggProgress(e) >= e.km;

let lastWalk = null;
function trackWalk(lat, lng, acc, t) {
  if (acc > 40) return;                                   // posición poco precisa
  if (!lastWalk) { lastWalk = { lat, lng, t }; return; }
  const d = distM(lastWalk, { lat, lng }), dt = Math.max(1, (t - lastWalk.t) / 1000);
  if (d < Math.max(8, acc * 0.6)) return;                 // temblor del GPS: no es andar
  if (d / dt > 7) { lastWalk = { lat, lng, t }; return; } // > 25 km/h: en coche/bus no cuenta
  lastWalk = { lat, lng, t };
  addWalk(d);
}
function addWalk(m) {
  if (!(m > 0)) return;
  lastWalkAt = Date.now();
  if (!sensorOn) setTimeout(sensorTick, 60);
  save.walked += m / 1000;
  checkBuddy();
  fillIncubators();
  for (const e of save.eggs) if (eggReady(e) && !e.notified) {
    e.notified = true;
    toast(`🥚 ¡Un huevo de ${e.family} está listo para eclosionar!`, 4500);
  }
  persist(); updateEggBadge();
  if (!$('#eggs').hidden) renderEggs();
}
function fillIncubators() {
  let busy = save.eggs.filter(e => e.start != null).length;
  for (const e of save.eggs) if (e.start == null && busy < INCUBATORS) { e.start = save.walked; busy++; }
}
function updateEggBadge() {
  const ready = save.eggs.filter(eggReady).length, b = $('#eggBadge');
  b.textContent = ready || save.eggs.length || '';
  b.hidden = !save.eggs.length;
  b.classList.toggle('ready', ready > 0);
}

function fuse(c) {
  if ((save.caught[c.id] || 0) < FUSE_N) return;
  save.caught[c.id] -= FUSE_N;
  save.stats.fused++;
  const egg = { id: 'e' + Date.now().toString(36), family: c.category || 'Otros', rarity: c.rarity, km: EGG_KM[c.rarity],
    from: c.id, fromName: c.name, created: Date.now(), start: null };
  save.eggs.push(egg);
  fillIncubators(); persist(); updateEggBadge();
  // Animación: las 5 copias se juntan y forman el huevo
  const card = $('#modalCard');
  card.className = `card r-${c.rarity}`;
  card.innerHTML = `<div class="fuse-anim">${Array.from({ length: FUSE_N }, (_, i) =>
      `<img src="${esc(c.url)}" alt="" style="--a:${i * 360 / FUSE_N}deg">`).join('')}
      <div class="egg big r-${c.rarity}"></div></div>
    <h3>¡Huevo ${esc(RAR[c.rarity].label.toLowerCase())}!</h3>
    <div class="stats">Familia «${esc(egg.family)}» · anda <b>${egg.km} km</b> para abrirlo.<br>
    ${egg.start != null ? 'Ya está en una incubadora.' : 'Tus incubadoras están llenas: esperará su turno.'}</div>
    <button class="btn see">Ver mis huevos</button><button class="btn secondary ok">Vale</button>`;
  sfx.success();
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  card.querySelector('.see').onclick = () => { $('#modal').hidden = true; openEggs(); };
  if (!$('#album').hidden) renderAlbum();
}

function hatchOdds(e) {
  const fam = creatures.filter(c => c.category === e.family);
  const pool = fam.length ? fam : creatures;
  const avail = new Set(pool.map(c => c.rarity));
  const ei = RAR_ORDER.indexOf(e.rarity), w = new Map();
  const nearest = idx => { // la rareza disponible más cercana en esa familia
    for (let d = 0; d < RAR_ORDER.length; d++)
      for (const k of [idx - d, idx + d]) if (k >= 0 && k < RAR_ORDER.length && avail.has(RAR_ORDER[k])) return RAR_ORDER[k];
    return null;
  };
  for (const [d, pr] of HATCH_SHIFT) {
    const r = nearest(clamp(ei + d, 0, RAR_ORDER.length - 1));
    if (r) w.set(r, (w.get(r) || 0) + pr);
  }
  return { pool, w: [...w].sort((a, b) => RAR_ORDER.indexOf(a[0]) - RAR_ORDER.indexOf(b[0])) };
}
function rollHatch(e) {
  const { pool, w } = hatchOdds(e);
  let x = Math.random() * w.reduce((a, v) => a + v[1], 0), rar = w[w.length - 1]?.[0];
  for (const [r, v] of w) { x -= v; if (x <= 0) { rar = r; break; } }
  const list = pool.filter(c => c.rarity === rar);
  return list[Math.floor(Math.random() * list.length)] || pool[0];
}

function eggHtml(e) {
  const prog = eggProgress(e), ready = eggReady(e), { w } = hatchOdds(e);
  const tot = w.reduce((a, v) => a + v[1], 0) || 1;
  const status = ready ? `<button class="btn hatch" data-id="${e.id}">✨ ¡Eclosionar!</button>`
    : e.start == null ? '<div class="muted">En espera: tus 3 incubadoras están ocupadas.</div>'
    : `<div class="bar"><i style="width:${(100 * prog / e.km).toFixed(1)}%"></i></div>
       <div class="muted">${fmtKm(prog)} de ${e.km} km · faltan ${fmtKm(e.km - prog)}</div>`;
  return `<div class="egg-row nested r-${e.rarity}">
    <div class="egg r-${e.rarity} ${ready ? 'ready' : e.start != null ? 'warm' : ''}"></div>
    <div class="egg-info"><b>Huevo ${esc(RAR[e.rarity].label.toLowerCase())}</b> <span class="tag cat">${esc(e.family)}</span>
      <div class="muted">${e.gift ? `Regalo de @${esc(e.gift)}` : `De 5 × ${esc(e.fromName)}`} · ${e.km} km</div>
      ${status}
      <div class="egg-odds">${w.map(([r, v]) => `<span class="tag r-${r}">${RAR[r].label} ${Math.round(100 * v / tot)} %</span>`).join(' ')}</div>
    </div></div>`;
}
function renderEggs() {
  $('#walked').textContent = `Has andado ${fmtKm(save.walked)}`;
  const box = $('#eggList');
  if (!save.eggs.length) {
    box.innerHTML = `<div class="empty"><div class="egg big r-comun" style="margin:0 auto 14px"></div>
      Aún no tienes huevos.<br>Cuando tengas <b>${FUSE_N} copias</b> de la misma criatura, ábrela en el álbum y pulsa
      <b>Fusionar</b>. El huevo se abre andando con el móvil (con la app abierta).</div>`;
    return;
  }
  const order = [...save.eggs].sort((a, b) => eggReady(b) - eggReady(a) || (a.start == null) - (b.start == null) || a.created - b.created);
  box.innerHTML = `<div class="muted" style="margin:0 2px 12px">Incubadoras: ${Math.min(INCUBATORS, save.eggs.filter(e => e.start != null).length)} / ${INCUBATORS} en uso</div>` +
    order.map(eggHtml).join('');
}
function openEggs() { fillIncubators(); renderEggs(); $('#eggs').hidden = false; }
$('#btnEggs').onclick = openEggs;
$('#eggList').onclick = e => {
  const b = e.target.closest('.hatch'); if (!b) return;
  const egg = save.eggs.find(x => x.id === b.dataset.id);
  if (egg && eggReady(egg)) hatch(egg);
};

async function hatch(egg) {
  const c = rollHatch(egg);
  if (!c) return toast('No hay criaturas en el repositorio');
  save.eggs = save.eggs.filter(x => x !== egg);
  const isNew = !save.caught[c.id] && !save.first[c.id], prevLvl = levelOf(save.xp);
  save.caught[c.id] = (save.caught[c.id] || 0) + 1;
  if (!save.first[c.id]) save.first[c.id] = Date.now();
  save.stats.hatched++;
  const shinyHatch = Math.random() < CFG.shinyRate;
  if (shinyHatch) save.shiny[c.id] = (save.shiny[c.id] || 0) + 1;
  const gained = RAR[c.rarity].xp + (isNew ? 500 : 0) + 200;
  save.xp += gained;
  fillIncubators(); persist(); updateHud(); updateEggBadge(); renderEggs();
  // Animación: el huevo tiembla, se agrieta y se abre
  const card = $('#modalCard');
  card.className = `card r-${egg.rarity}`;
  card.innerHTML = `<div class="hatch-anim"><div class="egg big r-${egg.rarity} shaking"></div></div><h3>…</h3><div class="stats">¡Se está moviendo!</div>`;
  $('#modal').hidden = false;
  for (let i = 0; i < 3; i++) { sfx.shake(); await sleep(700); }
  card.querySelector('.egg').classList.add('crack'); sfx.breakOut();
  await sleep(600);
  sfx.success();
  if (shinyHatch || RAR_ORDER.indexOf(c.rarity) >= RAR_ORDER.indexOf('epico')) shareActivity('eclosion', c, { shiny: shinyHatch });
  showCard(c, { isNew, gained, levelUp: levelOf(save.xp) > prevLvl, hatched: true, shiny: shinyHatch });
}

// ---------------------------------------------------------------- Paneles y ajustes
$('#btnAlbum').onclick = () => { renderAlbum(); $('#album').hidden = false; };
$('#btnSettings').onclick = () => {
  $('#sourceInfo').textContent = `${sourceName} — ${creatures.length} criaturas`;
  $('#chkDev').checked = save.dev;
  renderAccount();
  $('#chkSound').checked = save.sound;
  $('#chkFog').checked = save.fog !== false;
  $('#chkJuntos').checked = !!save.juntos;
  $('#folderName').textContent = CFG.folder || '(raíz)';
  $('#settings').hidden = false;
};
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { $('#' + b.dataset.close).hidden = true; });
$('#chkDev').onchange = e => {
  save.dev = e.target.checked; persist();
  if (!save.dev && manualPos) { manualPos = false; toast('Volviendo a tu ubicación GPS…'); }
  refreshSpawns(); refreshStops();
};
$('#chkSound').onchange = e => { save.sound = e.target.checked; persist(); if (save.sound) sfx.success(); };
$('#chkFog').onchange = e => { save.fog = e.target.checked; persist(); drawFog(); };
$('#chkJuntos').onchange = e => { save.juntos = e.target.checked; persist(); pollJuntos(); };
$('#btnReload').onclick = async () => {
  $('#sourceInfo').textContent = 'Cargando…';
  await initCreatures(true);
  $('#sourceInfo').textContent = `${sourceName} — ${creatures.length} criaturas`;
  toast('Imágenes actualizadas');
};
$('#btnReset').onclick = () => {
  if (!confirm('¿Seguro? Se borrarán tus capturas y tu experiencia.')) return;
  save.caught = {}; save.first = {}; save.xp = 0; save.gone = {};
  save.orbs = CFG.orbsStart; save.stops = {}; save.visited = {}; save.coins = CFG.coinsStart; save.fert = {}; save.eggs = []; save.walked = 0; save.items = { super: 0, ultra: 0, candy: 0, gold: 0 }; save.ball = 'orb'; save.stats = { captures: 0, hatched: 0, fused: 0 }; save.gifts = 0; save.logros = {}; save.daily = null; save.streak = { count: 0, last: '' }; save.week = null; save.buddy = null; save.hides = {}; save.foundHides = {}; save.notasVistas = {}; save.quien = null; save.quienRacha = null; save.amistad = {}; save.combo = { n: 0, last: 0 }; save.color = null; save.quimeras = []; save.duelosVistos = {}; save.jefe = null; save.explored = {}; save.shiny = {}; save.barrios = {}; save.barrioPending = []; persist(); updateEggBadge();
  updateHud(); refreshSpawns(); refreshStops(); toast('Progreso borrado');
};

// imagenes/criaturas.json (lo crea el editor de criaturas): nombre bonito, rareza, familia, etiquetas y descripción
async function loadMeta() {
  const folder = (CFG.folder || '').replace(/^\/+|\/+$/g, ''), file = (folder ? folder + '/' : '') + 'criaturas.json';
  const urls = [file], src = detectRepo();
  if (src) urls.push(`https://raw.githubusercontent.com/${src.owner}/${src.repo}/HEAD/${file.split('/').map(encodeURIComponent).join('/')}`);
  for (const u of urls) {
    try {
      const r = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const d = await r.json(); if (d && typeof d === 'object') return d; }
    } catch {}
  }
  return {};
}
function applyMeta(list, meta) {
  return list.map(c => {
    const m = meta[c.id] || {};
    return { ...c,
      name: String(m.nombre || '').trim().slice(0, 40) || c.name,
      rarity: RAR[m.rareza] ? m.rareza : c.rarity,
      category: String(m.categoria || '').trim().slice(0, 40) || c.category,
      tags: Array.isArray(m.etiquetas) ? m.etiquetas.map(t => String(t).trim().slice(0, 24)).filter(Boolean).slice(0, 12) : [],
      desc: String(m.descripcion || '').trim().slice(0, 300) };
  });
}

async function initCreatures(force) {
  const [res, meta] = await Promise.all([loadCreatures(force), loadMeta()]);
  creatures = applyMeta(res.list, meta); sourceName = res.source;
  setTimeout(() => checkLogros(), 1500); // con las criaturas ya cargadas
  for (const m of markers.values()) map.removeLayer(m);
  markers.clear();
  refreshSpawns();
}

// ---------------------------------------------------------------- Cuenta (usuario y contraseña) y guardado en la nube
// La partida se sube sola unos segundos después de cada cambio. Los ajustes del aparato no se suben.
const LOCAL_ONLY = ['dev', 'cam', 'sound', 'cloudUid'];
let cloudEnabled = false, cloudLoading = !!(CFG.firebase && CFG.firebase.apiKey), cloudT = null, cloudState = '';
const signedIn = () => !!(window.Cloud && Cloud.user && save.cloudUid === Cloud.user.uid);
function cloudData() {
  const d = {};
  for (const k in save) if (!LOCAL_ONLY.includes(k)) d[k] = save[k];
  return d;
}
function setCloudState(t) { cloudState = t; const el = $('#cloudState'); if (el) el.textContent = t; }
function cloudQueue() {
  if (!window.Cloud || !Cloud.user) return; // antes de conectar no hay nada que subir
  if (!signedIn()) return;
  clearTimeout(cloudT); cloudT = setTimeout(cloudPush, 3000);
}
async function cloudPush() {
  clearTimeout(cloudT); cloudT = null;
  if (!signedIn()) return;
  try {
    setCloudState('Guardando…');
    await Cloud.save(cloudData());
    if (myProfile) Cloud.saveProfile({ stats: profileStats(), logros: Object.keys(save.logros), updated: Date.now() }).catch(e => console.warn('perfil', e));
    setCloudState(`Guardado en la nube ✓ (${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })})`);
  } catch (e) {
    console.warn(e);
    setCloudState('⚠ No se pudo guardar (¿sin conexión?). Se reintentará.');
    cloudT = setTimeout(cloudPush, 30000);
  }
}
// Al salir de la app o cambiar de pestaña, sube lo pendiente
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && cloudT) cloudPush(); });

const summary = d => `nivel ${levelOf(d.xp || 0)} · ${Object.keys(d.first || {}).length} criaturas · ${(d.eggs || []).length} huevos`;
function adoptCloud(r, uid) {
  const keep = { dev: save.dev, cam: save.cam, sound: save.sound };
  localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign({}, r, keep, { cloudUid: uid })));
  location.reload();
}
async function onCloudUser(u) {
  cloudLoading = false;
  renderAccount();
  if (!u) { myProfile = null; profilesCache = []; return; }
  loadMyProfile(u);
  setTimeout(pollAvisos, 3000);
  setTimeout(pollFeed, 5000);
  setTimeout(pollGifts, 4000);
  setTimeout(pollTrades, 6000);
  setTimeout(pollDuelos, 9000);
  setTimeout(pollJuntos, 10000);
  setTimeout(pollEscondites, 7000);
  setTimeout(pollNotas, 8000);
  try {
    setCloudState('Comprobando tu partida…');
    const r = await Cloud.load();
    const localProgress = save.xp > 0 || Object.keys(save.first).length > 0;
    if (!r) {                                     // cuenta nueva: se sube la partida de este móvil
      save.cloudUid = u.uid; persist(); await cloudPush();
      toast('Tu partida ya se guarda en tu cuenta ✓'); renderAccount(); return;
    }
    if (save.cloudUid === u.uid) {                // mismo jugador: gana la versión más reciente
      if ((r.savedAt || 0) > (save.savedAt || 0) + 1000) return adoptCloud(r, u.uid);
      if ((save.savedAt || 0) > (r.savedAt || 0)) await cloudPush(); else setCloudState('Guardado en la nube ✓');
      return;
    }
    if (!localProgress) return adoptCloud(r, u.uid);
    // Hay dos partidas distintas: que elija el jugador
    const card = $('#modalCard');
    card.className = 'card';
    card.innerHTML = `<h3>¿Qué partida usas?</h3>
      <div class="stats">Tu cuenta ya tiene una partida guardada y en este móvil hay otra.</div>
      <button class="btn use-cloud">☁️ La de mi cuenta<br><small></small></button>
      <button class="btn secondary use-local">📱 La de este móvil<br><small></small></button>
      <div class="muted" style="margin-top:10px">La que no elijas se perderá.</div>`;
    card.querySelector('.use-cloud small').textContent = summary(r);
    card.querySelector('.use-local small').textContent = summary(save);
    card.querySelector('.use-cloud').onclick = () => adoptCloud(r, u.uid);
    card.querySelector('.use-local').onclick = async () => {
      $('#modal').hidden = true;
      save.cloudUid = u.uid; persist(); await cloudPush(); renderAccount();
      toast('Tu cuenta ahora tiene la partida de este móvil ✓');
    };
    $('#modal').hidden = false;
  } catch (e) {
    console.warn(e);
    setCloudState('⚠ No se pudo leer tu partida de la nube.');
  }
}

function renderAccount() {
  const box = $('#accountRow'); if (!box) return;
  const u = window.Cloud && Cloud.user;
  if (!cloudEnabled && !cloudLoading) {
    box.innerHTML = `<div><b>Cuenta</b><div class="muted">El guardado en la nube está desactivado.
      Para activarlo hay que configurar Firebase (lo explica el README).</div></div>`;
    return;
  }
  if (cloudLoading) { box.innerHTML = '<div><b>Cuenta</b><div class="muted">Conectando…</div></div>'; return; }
  if (!u) {
    box.innerHTML = `<div style="width:100%"><b>Cuenta</b><div class="muted">Entra o crea una cuenta para guardar tu partida y jugar con tus amigos.</div>
      ${loginFormHtml('acc')}</div>`;
    bindLoginForm(box, 'acc');
    return;
  }
  box.innerHTML = `<div class="account"><img class="avatar" alt="" hidden><div class="acc-info"><b class="acc-name"></b>
      <div class="muted" id="cloudState"></div></div></div>
    <button class="btn secondary small" id="btnLogout">Cerrar sesión</button>`;
  box.querySelector('.acc-name').textContent = '@' + (Cloud.userOf(u) || 'jugador');
  if (u.photoURL && /^https:\/\//.test(u.photoURL)) { const img = box.querySelector('.avatar'); img.src = u.photoURL; img.hidden = false; }
  setCloudState(cloudState || 'Conectado');
  const bp = document.createElement('button');
  bp.className = 'btn small'; bp.textContent = '👥 Jugadores'; bp.onclick = openSocial;
  $('#btnLogout').before(bp);
  const bpw = document.createElement('button');
  bpw.className = 'btn secondary small'; bpw.textContent = '🔑 Contraseña'; bpw.onclick = changePasswordDialog;
  $('#btnLogout').before(bpw);
  $('#btnLogout').onclick = async () => {
    if (cloudT) await cloudPush();
    await Cloud.signOut();
    myProfile = null; profilesCache = [];
    save.cloudUid = null; localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    cloudState = ''; renderAccount();
    toast('Sesión cerrada. Tu partida sigue guardada en tu cuenta.');
  };
}

// ---------------------------------------------------------------- Perfiles y amigos
// Cada jugador tiene un perfil público (solo para quien haya iniciado sesión) en perfiles/{uid}:
// apodo, frase, 3 favoritas y estadísticas. La partida completa sigue siendo privada.
const NICK_MAX = 24, BIO_MAX = 140;
let myProfile = null, profilesCache = [];
const creatureById = id => creatures.find(c => c.id === id);
const defaultNick = u => (Cloud.userOf(u) || 'Jugador').slice(0, NICK_MAX);

function profileStats() {
  const ids = Object.keys(save.first);
  const best = ids.map(creatureById).filter(Boolean)
    .sort((a, b) => RAR_ORDER.indexOf(b.rarity) - RAR_ORDER.indexOf(a.rarity))[0];
  return { level: levelOf(save.xp), xp: save.xp, discovered: ids.length, total: creatures.length,
    captures: save.stats.captures, hatched: save.stats.hatched, fused: save.stats.fused,
    km: Math.round(save.walked * 100) / 100, stops: Object.keys(save.visited).length, best: best ? best.id : null,
    shinies: Object.keys(save.shiny).length, barrios: Object.keys(save.barrios).length,
    zonas: Object.keys(save.explored || {}).length,
    quien: save.quien ? { date: save.quien.date, ok: !!save.quien.ok } : null, quienOk: save.stats.quienOk || 0, color: colorHoy().date === today() ? { date: today(), ok: !!colorHoy().ok } : null, colores: save.stats.colores || 0, combo: save.stats.comboMax || 0, ocultas: save.stats.ocultas || 0, duelos: save.stats.duelosGanados || 0, jefe: jefeState().week === weekId() ? { week: jefeState().week, dmg: jefeState().dmg } : null,
    semana: { id: weekState().id, ...retoValues() },
    album: Object.keys(save.first).slice(0, 400),
    buddy: save.buddy ? save.buddy.id : null, buddyKm: Math.round(buddyKm() * 10) / 10 };   // para comparar álbumes con amigos
}
async function loadMyProfile(u) {
  try {
    myProfile = await Cloud.loadProfile();
    if (!myProfile) {
      myProfile = { nick: defaultNick(u), bio: '', favs: [] };
      await Cloud.saveProfile({ ...myProfile, stats: profileStats(), creado: Date.now(), updated: Date.now() });
    }
    if (!$('#social').hidden) renderSocial();
  } catch (e) {
    console.warn('perfil', e);
    if (e.code === 'permission-denied')
      toast('Falta actualizar las reglas de Firebase para los perfiles (mira el README).', 6000);
  }
}

function avatarHtml(p, size) {
  const c = creatureById((p.favs || [])[0]);
  return `<div class="pavatar ${c ? 'r-' + c.rarity : ''}" style="--s:${size}px">${c
    ? `<img src="${esc(c.url)}" alt="">` : `<span>${esc((p.nick || '?').charAt(0).toUpperCase())}</span>`}</div>`;
}
function favsHtml(p) {
  const favs = (p.favs || []).slice(0, 3);
  return `<div class="pfavs">${[0, 1, 2].map(i => {
    const c = creatureById(favs[i]);
    return c ? `<div class="pfav r-${c.rarity}"><img src="${esc(c.url)}" alt=""><span>${esc(c.name)}</span><i class="tag r-${c.rarity}">${RAR[c.rarity].label}</i></div>`
      : '<div class="pfav empty-fav"><span>—</span></div>';
  }).join('')}</div>`;
}
function statsHtml(st = {}) {
  const best = creatureById(st.best);
  const cell = (v, l) => `<div class="pstat"><b>${v}</b><span>${l}</span></div>`;
  return `<div class="pstats">
    ${cell(st.level ?? 1, 'Nivel')}
    ${cell(`${st.discovered ?? 0}<small>/${st.total || creatures.length}</small>`, 'Descubiertas')}
    ${cell(st.captures ?? 0, 'Capturas')}
    ${cell(st.hatched ?? 0, 'Huevos abiertos')}
    ${cell(String(st.km ?? 0).replace('.', ','), 'Km andados')}
    ${cell(st.stops ?? 0, 'Paradas')}
    ${cell(st.shinies ?? 0, '✨ Brillantes')}
    ${cell(st.barrios ?? 0, 'Barrios')}
    ${cell(st.zonas ?? 0, '🌫️ Zonas exploradas')}
    </div>
    ${best ? `<div class="pbest">La más rara: <img src="${esc(best.url)}" alt=""> <b>${esc(best.name)}</b> <span class="tag r-${best.rarity}">${RAR[best.rarity].label}</span></div>` : ''}`;
}
function profileCardHtml(p, mine) {
  return `<div class="pcard nested">
    <div class="phead">${avatarHtml(p, 64)}
      <div class="pid"><b class="pnick">${esc(p.nick || 'Jugador')}</b>${p.titulo ? `<span class="ptit">${esc(p.titulo)}</span>` : ''}
        <div class="muted">${p.bio ? esc(p.bio) : mine ? 'Toca «Editar perfil» para poner una frase.' : ''}</div></div></div>
    ${p.reacts && p.reacts.length ? reactsSummaryHtml(p.reacts) : ''}
    ${logrosHtml(p, mine)}
    ${buddyLineHtml(p, mine)}
    <div class="sec-mini">Favoritas</div>${favsHtml(p)}
    <div class="sec-mini">Estadísticas</div>${statsHtml(p.stats)}
    ${mine ? '<button class="btn" id="btnEditProfile">✏️ Editar perfil</button>' : ''}
  </div>`;
}

async function openSocial() {
  $('#settings').hidden = true;
  $('#social').hidden = false;
  renderSocial();
  if (!signedIn()) return;
  try {
    const [ps, feed, rx] = await Promise.all([Cloud.loadProfiles(), Cloud.recent('actividad', Date.now() - 3 * 864e5, 40).catch(() => []),
      Cloud.where('reacciones', 'to', Cloud.user.uid).catch(() => [])]);
    profilesCache = ps; feedCache = feed; myReacts = rx;
    localStorage.setItem('fotocaza_feed_visto', String(Date.now())); $('.level').classList.remove('has-news');
    renderSocial();
  }
  catch (e) {
    console.warn(e);
    $('#socialList').innerHTML = `<div class="empty">No se pudieron cargar los perfiles${e.code === 'permission-denied'
      ? ': falta actualizar las reglas de Firebase (mira el README)' : ''}.</div>`;
  }
}
// Clasificación con varias categorías (se elige con las pestañas)
const RANKS = [
  { id: 'xp',     i: '⭐', n: 'XP',          v: st => +st.xp || 0,         f: v => `${v} XP` },
  { id: 'album',  i: '📖', n: 'Álbum',       v: st => +st.discovered || 0, f: v => `${v} criaturas` },
  { id: 'km',     i: '👟', n: 'Km',          v: st => +st.km || 0,         f: v => `${String(Math.round(v * 10) / 10).replace('.', ',')} km` },
  { id: 'zonas',  i: '🌫️', n: 'Exploración', v: st => +st.zonas || 0,      f: v => `${v} zonas exploradas` },
  { id: 'brillo', i: '✨', n: 'Brillantes',  v: st => +st.shinies || 0,    f: v => `${v} brillante${v === 1 ? '' : 's'}` },
  { id: 'quien',  i: '🧠', n: '¿Quién es?',  v: st => +st.quienOk || 0,    f: v => `${v} acierto${v === 1 ? '' : 's'}` },
  { id: 'combo',  i: '⚡', n: 'Combo',       v: st => +st.combo || 0,      f: v => `combo récord ×${v}` },
  { id: 'duelos', i: '⚔️', n: 'Duelos',      v: st => +st.duelos || 0,     f: v => `${v} duelo${v === 1 ? '' : 's'} ganado${v === 1 ? '' : 's'}` }
];
let rankMode = localStorage.getItem('fotocaza_rank') || 'xp';
$('#socialBody').addEventListener('click', e => {
  const t = e.target.closest('.rank-tab'); if (!t) return;
  e.stopPropagation();
  rankMode = t.dataset.rank; localStorage.setItem('fotocaza_rank', rankMode);
  renderSocial();
  $('.rank-tabs')?.scrollIntoView({ block: 'start' });
}, true);
function renderSocial() {
  const box = $('#socialBody');
  if (!cloudEnabled) {
    box.innerHTML = '<div class="empty">Para ver a tus amigos hay que activar las cuentas (Firebase).</div>';
    return;
  }
  if (!signedIn()) {
    box.innerHTML = `<div class="empty">Entra con tu usuario para tener perfil y ver el de tus amigos.</div>${loginFormHtml('soc')}`;
    bindLoginForm(box, 'soc');
    return;
  }
  const me = { ...(myProfile || { nick: defaultNick(Cloud.user), favs: [] }), stats: profileStats() };
  const others = profilesCache.filter(p => p.uid !== Cloud.user.uid);
  const rk = RANKS.find(r => r.id === rankMode) || RANKS[0];
  const ranking = [{ ...me, uid: Cloud.user.uid, me: true }, ...others]
    .sort((a, b) => rk.v(b.stats || {}) - rk.v(a.stats || {}) || (b.stats?.xp || 0) - (a.stats?.xp || 0));
  const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  box.innerHTML = `${giftsHtml()}${duelosHtml()}${tradesHtml()}${jefeSocialHtml(others)}${retoHtml(others)}${escondidosHtml()}${feedHtml()}<div class="sec-h">Tu perfil</div>${profileCardHtml({ ...me, reacts: myReacts }, true)}
    <div class="sec-h">Clasificación</div>
    <div class="rank-tabs">${RANKS.map(r => `<button class="rank-tab ${r.id === rk.id ? 'on' : ''}" data-rank="${r.id}">${r.i} ${r.n}</button>`).join('')}</div>
    <div id="socialList">${others.length || profilesCache.length ? ranking.map((p, i) => `
      <button class="prow nested ${p.me ? 'me' : ''}" data-uid="${esc(p.uid)}">
        <span class="pos">${medal(i)}</span>${avatarHtml(p, 44)}
        <span class="prow-info"><b>${esc(p.nick || 'Jugador')}${p.me ? ' (tú)' : ''}</b>${p.titulo ? `<em class="ptit-mini">${esc(p.titulo)}</em>` : ''}
          <small>Nivel ${p.stats?.level ?? 1} · <b class="rank-v">${rk.f(rk.v(p.stats || {}))}</b></small></span>
      </button>`).join('') : '<div class="empty">Cuando tus amigos inicien sesión aparecerán aquí.</div>'}</div>`;
  $('#btnEditProfile').onclick = editProfile;
}
$('#socialBody').onclick = e => {
  const row = e.target.closest('.prow'); if (!row) return;
  if (row.classList.contains('me')) { $('.pcard')?.scrollIntoView({ behavior: 'smooth' }); return; }
  const p = profilesCache.find(x => x.uid === row.dataset.uid); if (!p) return;
  const card = $('#modalCard');
  card.className = 'card pmodal';
  card.innerHTML = profileCardHtml(p, false) + `<div class="react-bar nested" id="reactBar"><span class="muted">Cargando reacciones…</span></div><div class="gift-send nested">
      <b>🎁 Enviar un regalo</b> <span class="muted">(tienes ${save.gifts})</span>
      <input class="gift-msg" maxlength="100" placeholder="Mensaje (opcional)">
      <button class="btn gift-go" ${save.gifts ? '' : 'disabled'}>${save.gifts ? `Enviar a @${esc(p.nick || 'amigo')}` : 'Consigue regalos en las paradas'}</button></div>`
    + '<button class="btn secondary ok">Cerrar</button>';
  loadReactBar(p);
  const am = save.amistad[p.uid];
  if (am && am.min >= 1) card.querySelector('.react-bar').insertAdjacentHTML('beforebegin',
    `<div class="amistad nested">👯 <b>${amistadNivel(am.min)}</b> · ${am.min} min cazando juntos</div>`);
  const cmp = document.createElement('div');
  cmp.className = 'compare nested';
  cmp.innerHTML = '<button class="btn secondary cmp-go">📖 Comparar álbumes</button>';
  card.querySelector('.gift-send').before(cmp);
  cmp.querySelector('.cmp-go').onclick = () => { cmp.innerHTML = compareHtml(p); };
  const trd = document.createElement('div');
  trd.className = 'trade nested';
  trd.innerHTML = '<button class="btn secondary trd-go">🔄 Proponer intercambio</button>';
  cmp.after(trd);
  trd.querySelector('.trd-go').onclick = () => tradeForm(trd, p);
  const dl = document.createElement('div');
  dl.className = 'duel nested';
  dl.innerHTML = '<button class="btn secondary duel-go">⚔️ Retar a un duelo</button>';
  trd.after(dl);
  dl.querySelector('.duel-go').onclick = () => duelForm(dl, p);
  card.querySelector('.gift-go').onclick = async ev => {
    const b = ev.currentTarget; if (!save.gifts) return;
    b.disabled = true;
    try {
      await Cloud.add('regalos', { to: p.uid, nick: (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user),
        mensaje: card.querySelector('.gift-msg').value.trim().slice(0, 100), abierto: false });
      save.gifts--; persist();
      b.textContent = '¡Enviado! 🎁'; sfx.success();
      save.stats.giftsSent = (save.stats.giftsSent || 0) + 1; persist(); updateHud(); dailyInc('gifts');
      shareActivity('regalo', null, { para: p.nick || '' }, true);
    } catch (e) { console.warn(e); b.disabled = false; toast('No se pudo enviar (¿faltan las reglas nuevas de Firebase?)'); }
  };
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  $('#modal').hidden = false;
};

function editProfile() {
  if (!myProfile) { toast('Tu perfil aún se está cargando…'); return; }
  let favs = (myProfile.favs || []).filter(id => creatureById(id));
  const options = creatures.filter(known)
    .sort((a, b) => RAR_ORDER.indexOf(b.rarity) - RAR_ORDER.indexOf(a.rarity) || a.name.localeCompare(b.name, 'es'));
  const card = $('#modalCard');
  card.className = 'card edit-card';
  card.innerHTML = `<h3>Editar perfil</h3>
    <label class="field">Apodo <input id="pfNick" maxlength="${NICK_MAX}"></label>
    <label class="field">Frase <textarea id="pfBio" rows="2" maxlength="${BIO_MAX}" placeholder="Algo sobre ti"></textarea></label>
    <label class="field">Título <select id="pfTit">${titulosDisponibles().map(t => `<option ${t === (myProfile.titulo || '') ? 'selected' : ''} value="${esc(t)}">${t ? esc(t) : '(sin título)'}</option>`).join('')}</select>
      <small class="muted">Consigue más con logros, niveles y rachas (${titulosDisponibles().length - 1}/${TITULOS.length}).</small></label>
    <div class="sec-mini">Tus 3 favoritas <small>(la primera es tu foto de perfil)</small></div>
    <div class="fav-pick">${options.length ? options.map(c => `<button class="fp r-${c.rarity}" data-id="${esc(c.id)}">
      <img src="${esc(c.url)}" alt=""><span>${esc(c.name)}</span><b></b></button>`).join('')
      : '<div class="muted">Aún no has capturado ninguna criatura.</div>'}</div>
    <button class="btn save">Guardar</button><button class="btn secondary cancel">Cancelar</button>`;
  card.querySelector('#pfNick').value = myProfile.nick || '';
  card.querySelector('#pfBio').value = myProfile.bio || '';
  const paint = () => card.querySelectorAll('.fp').forEach(b => {
    const i = favs.indexOf(b.dataset.id);
    b.classList.toggle('on', i >= 0);
    b.querySelector('b').textContent = i >= 0 ? i + 1 : '';
  });
  paint();
  card.querySelector('.fav-pick').onclick = e => {
    const b = e.target.closest('.fp'); if (!b) return;
    const id = b.dataset.id, i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1);
    else if (favs.length < 3) favs.push(id);
    else toast('Solo puedes elegir 3. Quita una primero.');
    paint();
  };
  card.querySelector('.cancel').onclick = () => { $('#modal').hidden = true; };
  card.querySelector('.save').onclick = async () => {
    const nick = card.querySelector('#pfNick').value.trim().slice(0, NICK_MAX) || defaultNick(Cloud.user);
    const bio = card.querySelector('#pfBio').value.trim().slice(0, BIO_MAX);
    const tit = titulosDisponibles().includes(card.querySelector('#pfTit').value) ? card.querySelector('#pfTit').value : '';
    const btn = card.querySelector('.save'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await Cloud.saveProfile({ nick, bio, favs, titulo: tit, stats: profileStats(), updated: Date.now() });
      myProfile = { ...myProfile, nick, bio, favs, titulo: tit };
      $('#modal').hidden = true; renderSocial(); toast('Perfil guardado ✓');
    } catch (e) {
      console.warn(e); btn.disabled = false; btn.textContent = 'Guardar';
      toast(e.code === 'permission-denied' ? 'Firebase no deja guardar: actualiza las reglas (README).' : 'No se pudo guardar el perfil.', 5000);
    }
  };
  $('#modal').hidden = false;
}
$('.level').onclick = openSocial;

// ---------------------------------------------------------------- Maestría de barrios (Región de Murcia)
// Cada captura suma puntos al barrio/pedanía donde ocurre: +1 por captura, +1 si es una especie nueva
// en ese barrio, +5 si es brillante. Al subir de nivel el barrio da todocoins.
const MASTERY = [
  { n: 'Sin explorar', pts: 0, coins: 0 }, { n: 'Explorador', pts: 1, coins: 0 }, { n: 'Bronce', pts: 10, coins: 5 },
  { n: 'Plata', pts: 30, coins: 10 }, { n: 'Oro', pts: 70, coins: 20 }, { n: 'Platino', pts: 150, coins: 35 },
  { n: 'Diamante', pts: 300, coins: 50 }, { n: 'Leyenda', pts: 600, coins: 100 }
];
const MASTERY_ICON = ['📍', '🧭', '🥉', '🥈', '🥇', '💠', '💎', '👑'];
const masteryLevel = pts => MASTERY.reduce((l, m, i) => pts >= m.pts ? i : l, 0);
let currentBarrio = null, barrioCellKey = '';

let barrioLastAsk = 0;
async function updateCurrentBarrio(lat, lng) {
  const k = `${lat.toFixed(3)}_${lng.toFixed(3)}`;
  if (k === barrioCellKey) return;
  // Como mucho una consulta por minuto mientras andas (lo ya consultado sale de la caché al momento)
  const cached = localStorage.getItem('fotocaza_barrio_' + k);
  if (!cached && Date.now() - barrioLastAsk < 60e3) return;
  if (!cached) barrioLastAsk = Date.now();
  barrioCellKey = k;
  try {
    const b = await OSM.barrio(lat, lng);
    if (barrioCellKey !== k) return;
    const changed = (currentBarrio && currentBarrio.id) !== (b && b.id);
    currentBarrio = b;
    if (changed && b.murcia && b.name) toast(`🏘️ Estás en ${b.name}${b.muni && b.muni !== b.name ? ` (${b.muni})` : ''}`, 2500);
    refreshSpawns();
    if (!$('#barrios').hidden) renderBarrios();
  } catch (e) { barrioCellKey = ''; }  // se reintentará en el próximo movimiento
}

async function creditBarrio(ev) {
  let b;
  try { b = await OSM.barrio(ev.lat, ev.lng); }
  catch { save.barrioPending.push(ev); persist(); return; }      // sin conexión: se asigna más tarde
  if (!b.murcia || !b.id) return;                                 // fuera de la Región de Murcia no cuenta
  const rec = save.barrios[b.id] || (save.barrios[b.id] = { name: b.name, muni: b.muni, pts: 0, captures: 0, species: {}, shinies: 0 });
  const prev = masteryLevel(rec.pts);
  let gain = 1;
  rec.captures++;
  if (!rec.species[ev.cid]) { rec.species[ev.cid] = 1; gain += 1; }
  if (ev.shiny) { rec.shinies++; gain += 5; }
  rec.pts += gain;
  const lvl = masteryLevel(rec.pts);
  if (lvl > prev) {
    const m = MASTERY[lvl];
    save.coins += m.coins;
    if (lvl >= 2) shareActivity('barrio', null, { barrio: rec.name, nivelBarrio: m.n }, true);
    setTimeout(() => {
      toast(`${MASTERY_ICON[lvl]} ¡${rec.name} sube a ${m.n}!${m.coins ? ` +${m.coins} todocoins` : ''}`, 5000);
      sfx.success();
    }, 2600);
  }
  persist(); updateHud(); refreshSpawns();
  if (!$('#barrios').hidden) renderBarrios();
}
// Reintentar las capturas pendientes de asignar (de una en una)
setInterval(async () => {
  if (!save.barrioPending.length || !navigator.onLine) return;
  const ev = save.barrioPending.shift(); persist();
  await creditBarrio(ev);
}, 60000);

function barrioRowHtml(id, r, here) {
  const lvl = masteryLevel(r.pts), next = MASTERY[lvl + 1], cur = MASTERY[lvl];
  const pct = next ? Math.min(100, 100 * (r.pts - cur.pts) / (next.pts - cur.pts)) : 100;
  return `<div class="brow nested lvl-${lvl} ${here ? 'here' : ''}">
    <span class="bicon">${MASTERY_ICON[lvl]}</span>
    <div class="binfo"><b>${esc(r.name)}</b>${here ? ' <span class="tag">Estás aquí</span>' : ''}
      <div class="muted">${cur.n} · ${r.pts} pts${next ? ` · ${next.pts - r.pts} para ${next.n}` : ' · ¡nivel máximo!'}</div>
      <div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div>
      <small class="muted">${r.captures} capturas · ${Object.keys(r.species).length} especies${r.shinies ? ` · ✨ ${r.shinies}` : ''}</small>
    </div></div>`;
}
function renderBarrios() {
  const box = $('#barriosBody'), cb = currentBarrio;
  const entries = Object.entries(save.barrios);
  const total = entries.reduce((a, [, r]) => a + r.pts, 0);
  let head = '';
  if (cb && cb.murcia && cb.id) {
    head = `<div class="sec-h">Estás en</div>${barrioRowHtml(cb.id, save.barrios[cb.id] || { name: cb.name, pts: 0, captures: 0, species: {}, shinies: 0 }, true)}`;
  } else if (cb && !cb.murcia) {
    head = '<div class="empty">Ahora mismo no estás en la Región de Murcia: aquí las capturas no suman maestría.</div>';
  } else {
    head = '<div class="muted" style="margin:0 2px 10px">Buscando en qué barrio estás…</div>';
  }
  const byMuni = new Map();
  for (const [id, r] of entries) {
    if (!byMuni.has(r.muni)) byMuni.set(r.muni, []);
    byMuni.get(r.muni).push([id, r]);
  }
  const munis = [...byMuni.keys()].sort((a, b) => a.localeCompare(b, 'es'));
  box.innerHTML = head + `
    <div class="bsum nested"><div><b>${entries.length}</b><span>barrios explorados</span></div>
      <div><b>${total}</b><span>puntos de maestría</span></div>
      <div><b>${entries.filter(([, r]) => masteryLevel(r.pts) >= 4).length}</b><span>en Oro o más</span></div></div>
    ${munis.length ? munis.map(m => `<div class="sec-h">${esc(m)}</div>` + byMuni.get(m)
      .sort((a, b) => b[1].pts - a[1].pts).map(([id, r]) => barrioRowHtml(id, r, cb && cb.id === id)).join('')).join('')
      : '<div class="empty">Captura criaturas en la Región de Murcia para empezar a dominar barrios.</div>'}
    <div class="help" style="margin-top:14px"><b>¿Cómo sube un barrio?</b>
      <p>+1 punto por captura · +1 si es una especie nueva en ese barrio · +5 si es brillante.</p>
      <p>${MASTERY.slice(1).map((m, i) => `${MASTERY_ICON[i + 1]} ${m.n} (${m.pts})`).join(' · ')}. Cada nivel nuevo da todocoins.</p></div>`;
}
function openBarrios() { renderBarrios(); $('#barrios').hidden = false; if (player) updateCurrentBarrio(player.lat, player.lng); }
$('#status').onclick = openBarrios;
$('#btnBarrios').onclick = () => { $('#album').hidden = true; openBarrios(); };
$('#btnQuimeras').onclick = () => openQuimeras();

// ---------------------------------------------------------------- Modo foto (para compartir)
function loadImgCORS(url) {
  return new Promise((res, rej) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => res(im); im.onerror = () => rej(new Error('No se pudo cargar la imagen'));
    im.src = url;
  });
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
async function takePhoto() {
  if (!cs) return;
  const W = cs.W, H = cs.H, S = 2, c = cs.cr;
  const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
  const g = cv.getContext('2d'); g.scale(S, S);
  // Fondo: la cámara si está encendida; si no, el cielo y el suelo de la captura
  if (camStream && cam.videoWidth) {
    const k = Math.max(W / cam.videoWidth, H / cam.videoHeight), vw = cam.videoWidth * k, vh = cam.videoHeight * k;
    g.drawImage(cam, (W - vw) / 2, (H - vh) / 2, vw, vh);
  } else {
    const sky = g.createLinearGradient(0, 0, 0, H * 0.32);
    sky.addColorStop(0, '#5aa9e6'); sky.addColorStop(0.6, '#9fd2f7'); sky.addColorStop(1, '#dff1ff');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.drawImage($('#ground'), 0, 0, W, H);
  }
  // La criatura donde está ahora
  try {
    const im = await loadImgCORS(c.url);
    const size = cs.sizeNow || cs.size, k = Math.min(size / im.width, size / im.height);
    const w = im.width * k, h = im.height * k, x = cs.cx - w / 2, y = (cs.feetY || cs.cy + size / 2) - h;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(cs.cx, (cs.groundY || y + h), w * 0.36, w * 0.07, 0, 0, 7); g.fill();
    if (cs.spawn.shiny) g.filter = `hue-rotate(${shinyHue(c.id)}deg) saturate(1.5) drop-shadow(0 0 10px #fff)`;
    g.drawImage(im, x, y, w, h);
    g.restore();
  } catch (e) { console.warn(e); }
  // Marco con el nombre, la rareza y la fecha
  const bh = 74, by = H - bh - 18;
  g.fillStyle = 'rgba(255,255,255,.78)'; roundRect(g, 14, by, W - 28, bh, 22); g.fill();
  g.strokeStyle = RC[c.rarity]; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#0b1424'; g.font = '800 22px system-ui, sans-serif';
  g.fillText(`${cs.spawn.shiny ? '✨ ' : ''}${c.name}`.slice(0, 32), 30, by + 32);
  g.fillStyle = RC[c.rarity]; g.font = '700 14px system-ui, sans-serif';
  g.fillText(`${RAR[c.rarity].label} · ${c.category || 'Otros'}`, 30, by + 54);
  g.fillStyle = 'rgba(11,20,36,.6)'; g.textAlign = 'right';
  g.fillText(`📸 FotoCaza · ${new Date().toLocaleDateString('es-ES')}`, W - 30, by + 54);
  g.textAlign = 'left';
  // Destello
  const fl = document.createElement('div'); fl.className = 'photo-flash'; catchEl.appendChild(fl);
  fl.addEventListener('animationend', () => fl.remove());
  sfx.shake();
  let blob;
  try { blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9)); }
  catch { toast('No se pudo hacer la foto con esta imagen'); return; }
  const file = new File([blob], `fotocaza-${c.name.replace(/[^\w\-]+/g, '_')}.jpg`, { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'FotoCaza', text: `¡Mira lo que he encontrado en FotoCaza: ${c.name}!` });
      return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('📸 Foto guardada en tus descargas');
}
$('#btnFoto').onclick = takePhoto;

// ---------------------------------------------------------------- Muro de actividad (novedades de amigos)
let feedCache = [], lastShare = 0;
async function shareActivity(tipo, c, extra = {}, force = false) {
  if (!signedIn() || !myProfile) return;
  if (!force && Date.now() - lastShare < 20000) return;   // como mucho uno cada 20 s
  lastShare = Date.now();
  try {
    await Cloud.add('actividad', { nick: myProfile.nick || Cloud.userOf(Cloud.user), tipo,
      cid: c ? c.id : null, rarity: c ? c.rarity : null, ...extra });
  } catch (e) { console.warn('actividad', e); }
}
function timeAgo(t) {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}
function feedText(a) {
  const c = creatureById(a.cid), r = a.rarity && RAR[a.rarity] ? RAR[a.rarity].label.toLowerCase() : '';
  const nom = c ? `<b>${esc(c.name)}</b>` : 'una criatura';
  switch (a.tipo) {
    case 'captura': return a.shiny ? `ha capturado ✨ <b>una brillante</b>: ${nom} (${r})` : `ha capturado ${nom}, ${r}`;
    case 'eclosion': return `ha abierto un huevo y ha salido ${a.shiny ? '✨ brillante ' : ''}${nom} (${r})`;
    case 'nivel': return `ha subido al <b>nivel ${esc(a.nivel)}</b> 🎉`;
    case 'barrio': return `ha llevado <b>${esc(a.barrio || '')}</b> a ${esc(a.nivelBarrio || '')} 🏘️`;
    case 'aviso': return `ha avisado de algo ${r} cerca 📣`;
    case 'logro': return `ha conseguido el logro <b>${esc(a.logro || '')}</b> 🏅`;
    case 'regalo': return `ha enviado un regalo a <b>@${esc(a.para || '')}</b> 🎁`;
    case 'racha': return `ha completado las misiones del día · racha de <b>${esc(a.racha)}</b> 🔥`;
    case 'reto': return `ha llegado a la meta del reto semanal «${esc(a.reto || '')}» 🏆`;
    case 'intercambio': return `ha intercambiado criaturas con <b>@${esc(a.con || '')}</b> 🔄`;
    case 'nota': return `ha dejado una nota en la parada <b>${esc(a.parada || '')}</b> 💬`;
    case 'quien': return `ha acertado el <b>¿Quién es?</b> de hoy 🧠${a.racha > 1 ? ` (${esc(a.racha)} días seguidos)` : ''}`;
    case 'duelo': return `ha ganado un duelo a <b>@${esc(a.con || '')}</b> ⚔️`;
    case 'jefe': return `ha derrotado con sus amigos al jefe de la semana: ${nom} 👹`;
    case 'oculta': return `ha encontrado con el sensor una criatura oculta: ${a.shiny ? '✨ ' : ''}${nom} (${r}) 📡`;
    case 'juntos': return `está cazando junto a <b>@${esc(a.con || '')}</b> 👯`;
    case 'combo': return `ha hecho un combo de <b>×${esc(a.combo)}</b> capturas seguidas ⚡`;
    case 'color': return `ha encontrado algo ${esc(a.color || '')} en la calle y ha invocado ${nom} 🎨`;
    case 'quimera': return `ha creado una quimera: <b>${esc(a.nombre || '')}</b> 🧬 ¡Vótala en el álbum!`;
    case 'escondite': return 'ha escondido una criatura en el mapa 🫣 ¡a buscarla!';
    case 'hallazgo': return `ha encontrado ${nom}, escondida por <b>@${esc(a.con || '')}</b> 🫣`;
    default: return 'ha hecho algo genial';
  }
}
function feedHtml() {
  const items = feedCache.slice(0, 20);
  return `<div class="sec-h">Novedades</div>
    <div class="feed nested">${items.length ? items.map(a => {
      const c = creatureById(a.cid), mine = Cloud.user && a.from === Cloud.user.uid;
      return `<div class="feed-item ${mine ? 'mine' : ''}">
        <div class="feed-pic ${c ? 'r-' + c.rarity : ''}">${c ? creatureImg(c, !!a.shiny) : { nivel: '🎉', barrio: '🏘️', regalo: '🎁', logro: '🏅', racha: '🔥', reto: '🏆', intercambio: '🔄', escondite: '🫣', nota: '💬', quien: '🧠', duelo: '⚔️', jefe: '👹', oculta: '📡', juntos: '👯', combo: '⚡', color: '🎨', quimera: '🧬' }[a.tipo] || '✨'}</div>
        <div class="feed-txt"><b>@${esc(a.nick || '?')}</b> ${feedText(a)}<small>${timeAgo(a.t)}</small></div></div>`;
    }).join('') : '<div class="muted" style="padding:8px">Aún no hay novedades. ¡Captura algo raro y aparecerá aquí!</div>'}</div>`;
}
// Punto de "hay novedades" en el botón de nivel
async function pollFeed() {
  if (!signedIn()) return;
  try {
    const seen = +localStorage.getItem('fotocaza_feed_visto') || 0;
    const news = await Cloud.recent('actividad', seen + 1, 5);
    $('.level').classList.toggle('has-news', news.some(a => a.from !== Cloud.user.uid));
  } catch {}
}
setInterval(pollFeed, 120000);

// ---------------------------------------------------------------- Hora dorada (amanecer y atardecer reales)
// Se calcula dónde está el sol en tu zona (precisión de unos minutos). Desde 10 min antes de que salga hasta 30 min
// después, y desde 30 min antes de que se ponga hasta 10 min después: mapa dorado, XP ×2 y el doble de brillantes.
function sunTimes(lat, lng, d = new Date()) {
  const rad = Math.PI / 180, n = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const decl = 23.44 * Math.sin(2 * Math.PI * (284 + n) / 365);
  const B = 2 * Math.PI * (n - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl * rad)) / (Math.cos(lat * rad) * Math.cos(decl * rad));
  if (cosH > 1 || cosH < -1) return null;                    // noche o día polar
  const H = Math.acos(cosH) / rad, noon = 12 - lng / 15 - eot / 60;   // horas UTC
  const at = h => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCMinutes(Math.round(h * 60)); return x; };
  return { rise: at(noon - H / 15), set: at(noon + H / 15) };
}
function horaDorada(now = new Date()) {
  const pos = player || { lat: CFG.defaultLocation[0], lng: CFG.defaultLocation[1] };
  const st = sunTimes(pos.lat, pos.lng, now); if (!st) return '';
  const m = 60e3, t = now.getTime();
  if (t >= st.rise - 10 * m && t <= +st.rise + 30 * m) return 'el amanecer';
  if (t >= st.set - 30 * m && t <= +st.set + 10 * m) return 'el atardecer';
  return '';
}

// ---------------------------------------------------------------- Eventos temporales
// Automáticos: hora feliz (18–19 h, doble XP y todocoins), fin de semana brillante (×3 brillantes) y
// familia de la semana (×3). Además, los que pongáis en eventos.json en el repositorio:
// [{ "nombre": "Noche de Halloween", "icono": "🎃", "desde": "2026-10-31T18:00", "hasta": "2026-11-01T02:00",
//    "familia": "Pou Series", "etiqueta": "fantasma", "xp": 2, "brillo": 2, "monedas": 1.5, "texto": "¡Fantasmas por todas partes!" }]
let customEvents = [];
async function loadEventos() {
  try {
    const r = await fetch('eventos.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { const d = await r.json(); if (Array.isArray(d)) customEvents = d.slice(0, 20); }
  } catch {}
}
function familiaDeLaSemana() {
  const fams = [...new Set(creatures.map(c => c.category))].sort();
  if (fams.length < 2) return null;
  return fams[Math.floor(seeded('familia' + weekId())() * fams.length)];
}
function activeEvents() {
  const now = new Date(), h = now.getHours(), dow = now.getDay(), out = [];
  if (h === 18) out.push({ icono: '⏰', nombre: 'Hora feliz', texto: 'doble XP y doble de todocoins en paradas', hasta: '19:00', xp: 2, monedas: 2 });
  if (dow === 0 || dow === 6) out.push({ icono: '✨', nombre: 'Fin de semana brillante', texto: 'las brillantes salen el triple', hasta: 'el domingo a medianoche', brillo: 3 });
  const fam = familiaDeLaSemana();
  if (fam) out.push({ icono: '⭐', nombre: `Semana de ${fam}`, texto: `las criaturas de «${fam}» salen el triple`, hasta: 'el domingo', familia: fam });
  const gh = horaDorada();
  if (gh) out.push({ icono: '🌅', nombre: 'Hora dorada', texto: `${gh} real: XP ×2 y el doble de brillantes`, hasta: '', xp: 2, brillo: 2 });
  if (juntos.length) out.push({ icono: '👯', nombre: 'Cazando juntos', texto: `con ${juntos.map(j => '@' + j.nick).join(', ')}: XP ×1,5 y el doble de brillantes`,
    hasta: '', xp: 1.5, brillo: 2 });
  for (const e of customEvents) {
    const d = e.desde ? new Date(e.desde) : null, a = e.hasta ? new Date(e.hasta) : null;
    if ((d && now < d) || (a && now > a)) continue;
    out.push({ icono: String(e.icono || '🎉').slice(0, 4), nombre: String(e.nombre || 'Evento').slice(0, 40),
      texto: String(e.texto || '').slice(0, 100), hasta: a ? a.toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '',
      xp: +e.xp || 1, brillo: +e.brillo || 1, monedas: +e.monedas || 1, familia: e.familia || null,
      etiqueta: e.etiqueta ? stripAccents(String(e.etiqueta).toLowerCase()) : null });
  }
  return out;
}
function eventMult(k) { return activeEvents().reduce((m, e) => m * (e[k] && e[k] > 0 ? Math.min(e[k], 5) : 1), 1); }
function eventBoost(c) {
  let b = 1;
  for (const e of activeEvents()) {
    if (e.familia && c.category === e.familia) b *= 3;
    if (e.etiqueta && (c.tags || []).some(t => stripAccents(t.toLowerCase()) === e.etiqueta)) b *= 3;
  }
  return b;
}
let lastEventsKey = '';
function announceEvents() {
  const evs = activeEvents(), key = evs.map(e => e.nombre).join('|');
  if (key === lastEventsKey) return;
  const nuevos = evs.filter(e => !lastEventsKey.split('|').includes(e.nombre));
  lastEventsKey = key;
  $('#btnMisiones').classList.toggle('has-event', evs.length > 0);
  document.body.classList.toggle('golden', !!horaDorada());
  if (nuevos.length) setTimeout(() => toast(`${nuevos[0].icono} ${nuevos[0].nombre}: ${nuevos[0].texto}${nuevos.length > 1 ? ` (+${nuevos.length - 1} evento más en 📋)` : ''}`, 5000), 2500);
}
setInterval(() => { announceEvents(); }, 60000);

// ---------------------------------------------------------------- Misiones diarias (iguales para todos) y racha
const MISIONES = [
  { id: 'cap5',    t: 'Captura 5 criaturas',                  k: 'captures',  n: 5 },
  { id: 'cap10',   t: 'Captura 10 criaturas',                 k: 'captures',  n: 10 },
  { id: 'stops3',  t: 'Visita 3 paradas',                     k: 'stops',     n: 3 },
  { id: 'km1',     t: 'Anda 1 km',                            k: 'km',        n: 1 },
  { id: 'km2',     t: 'Anda 2 km',                            k: 'km',        n: 2 },
  { id: 'curve3',  t: 'Acierta 3 lanzamientos con curva',     k: 'curves',    n: 3 },
  { id: 'exc2',    t: 'Consigue 2 «¡Excelente!»',             k: 'excellent', n: 2 },
  { id: 'rare1',   t: 'Captura una criatura rara o mejor',    k: 'rare',      n: 1 },
  { id: 'gift1',   t: 'Envía un regalo a un amigo',           k: 'gifts',     n: 1, social: true },
  { id: 'react1',  t: 'Reacciona al perfil de un amigo',      k: 'reacts',    n: 1, social: true }
];
const today = () => new Date().toLocaleDateString('sv');               // AAAA-MM-DD
const dayBefore = d => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() - 1); return x.toLocaleDateString('sv'); };
function dailyState() {
  const d = today();
  if (!save.daily || save.daily.date !== d) {
    // Las 3 misiones del día salen del mismo sorteo para todos (así podéis hacerlas juntos)
    const r = seeded('misiones' + d), pool = [...MISIONES];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const pick = [], usedK = new Set();
    for (const m of pool) { if (pick.length < 3 && !usedK.has(m.k)) { pick.push(m.id); usedK.add(m.k); } }
    save.daily = { date: d, ids: pick, prog: {}, km0: save.walked, done: {}, all: false };
  }
  save.streak = save.streak || { count: 0, last: '' };
  return save.daily;
}
function misProgress(m) {
  const st = dailyState();
  if (m.k === 'km') return Math.min(m.n, Math.floor((save.walked - st.km0) * 10) / 10);
  return Math.min(m.n, st.prog[m.k] || 0);
}
function dailyMissions() {
  const st = dailyState();
  const base = st.ids.map(id => MISIONES.find(m => m.id === id)).filter(Boolean);
  // Sin sesión, las misiones sociales se cambian por otra de un tipo distinto a las demás
  const usedK = new Set(base.filter(m => !(m.social && !signedIn())).map(m => m.k));
  return base.map(m => {
    if (!(m.social && !signedIn())) return m;
    const alt = MISIONES.find(x => !x.social && !usedK.has(x.k)) || m;
    usedK.add(alt.k); return alt;
  });
}
function dailyInc(k, n = 1) {
  const st = dailyState();
  st.prog[k] = (st.prog[k] || 0) + n;
  const w = weekState();
  if (k in w.prog) w.prog[k] += n;
  checkMisiones();
}
function checkMisiones() {
  const st = dailyState();
  let changed = false;
  for (const m of dailyMissions()) {
    if (st.done[m.id] || misProgress(m) < m.n) continue;
    st.done[m.id] = Date.now(); changed = true;
    save.coins += 10; save.xp += 100;
    toast(`📋 ¡Misión cumplida! ${m.t} · +10 todocoins +100 XP`, 3500);
  }
  if (!st.all && dailyMissions().every(m => st.done[m.id])) {
    st.all = true; changed = true;
    const s = save.streak;
    s.count = s.last === dayBefore(st.date) ? s.count + 1 : 1;
    s.last = st.date;
    let msg = `🔥 ¡Misiones del día completadas! Racha: ${s.count} día${s.count === 1 ? '' : 's'}`;
    if (s.count % 7 === 0) {           // premio gordo cada 7 días seguidos
      save.items.gold += 1; save.items.ultra += 3; save.coins += 50;
      msg += ' · 🎉 ¡Premio semanal: caramelo dorado, 3 ultraorbes y 50 todocoins!';
    }
    setTimeout(() => { toast(msg, 5000); sfx.success(); }, 3800);
    shareActivity('racha', null, { racha: s.count }, true);
  }
  checkReto();
  if (changed) { persist(); updateHud(); }
  renderMisBadge();
}
function renderMisBadge() {
  const b = $('#misBadge'); if (!b) return;
  const ms = dailyMissions(), st = save.daily;
  const n = ms.filter(m => st.done[m.id]).length;
  b.textContent = `${n}/${ms.length}`;
  $('#btnMisiones').classList.toggle('all-done', n === ms.length);
  $('#btnMisiones').classList.toggle('quien-pend', !quienHoy() && creatures.length >= 4);
}
function openMisiones() {
  checkMisiones();
  const st = dailyState(), s = save.streak, ms = dailyMissions();
  const card = $('#modalCard');
  card.className = 'card mis-card';
  const evs = activeEvents();
  card.innerHTML = `${evs.length ? `<div class="events">${evs.map(e => `<div class="event-item"><span>${e.icono}</span>
      <div><b>${esc(e.nombre)}</b><small>${esc(e.texto)}${e.hasta ? ` · hasta ${esc(e.hasta)}` : ''}</small></div></div>`).join('')}</div>` : ''}
    <h3>📋 Misiones de hoy</h3>
    <div class="muted">Son las mismas para todos tus amigos. Se renuevan a medianoche.</div>
    <div class="mis-list">${ms.map(m => {
      const v = misProgress(m), ok = !!st.done[m.id];
      return `<div class="mis-item nested ${ok ? 'ok' : ''}"><span class="mis-check">${ok ? '✅' : m.social ? '👥' : '🎯'}</span>
        <div class="mis-txt"><b>${esc(m.t)}</b><div class="bar"><i style="width:${(100 * v / m.n).toFixed(0)}%"></i></div>
        <small>${String(v).replace('.', ',')} / ${m.n}${m.k === 'km' ? ' km' : ''} · +10 todocoins +100 XP</small></div></div>`;
    }).join('')}</div>
    <div class="streak">🔥 Racha: <b>${s.count}</b> día${s.count === 1 ? '' : 's'}${s.last === st.date ? ' (hoy ya cuenta ✓)' : ''}
      <small>Cada 7 días seguidos: caramelo dorado + 3 ultraorbes + 50 todocoins</small></div>
    <button class="btn secondary color-go">🎨 Caza de color: ${colorDelDia().e} ${colorDelDia().n} ${colorHoy().ok ? '✅' : ''}</button>
    <button class="btn secondary jefe-go">👹 Jefe de la semana ${jefeState().claimed ? '✅' : ''}</button>
    <button class="btn secondary quien-go">🧠 ¿Quién es? del día ${quienHoy() ? (save.quien.ok ? '✅' : '❌') : '<span class="quien-new">¡nuevo!</span>'}</button>
    <button class="btn ok">Vale</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  card.querySelector('.quien-go').onclick = openQuien;
  card.querySelector('.jefe-go').onclick = openJefe;
  card.querySelector('.color-go').onclick = openColor;
  $('#modal').hidden = false;
}
$('#btnMisiones').onclick = openMisiones;
setInterval(checkMisiones, 30000);   // los km andados cuentan solos

// ---------------------------------------------------------------- ¿Quién es? (adivina la silueta del día)
// Cada día, la misma silueta para todos los amigos y 4 nombres. Un solo intento. Si aciertas: todocoins y XP,
// y una racha de días acertando. En la pantalla ves qué amigos han acertado hoy (sin desvelar la respuesta).
function quienHoy() { return !!(save.quien && save.quien.date === today()); }
function quienDelDia() {
  const pool = creatures.filter(c => c.rarity !== 'secreto');
  if (pool.length < 4) return null;
  const r = seeded('quien' + today());
  const c = pool[Math.floor(r() * pool.length)];
  // Despistes: mejor de la misma familia (más difícil) y sin nombres repetidos
  const names = new Set([c.name]);
  const fam = pool.filter(x => x.category === c.category && x.id !== c.id), rest = pool.filter(x => x.category !== c.category);
  const opts = [c];
  for (const src of [fam, rest]) {
    const arr = src.slice();
    while (arr.length && opts.length < 4) {
      const x = arr.splice(Math.floor(r() * arr.length), 1)[0];
      if (!names.has(x.name)) { names.add(x.name); opts.push(x); }
    }
  }
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  return { c, opts };
}
function quienAmigosHtml() {
  if (!signedIn() || !profilesCache.length) return '';
  const hoy = profilesCache.filter(p => p.uid !== Cloud.user.uid && p.stats && p.stats.quien && p.stats.quien.date === today());
  if (!hoy.length) return '<div class="muted quien-amigos">Ninguno de tus amigos ha jugado hoy todavía.</div>';
  return `<div class="quien-amigos">${hoy.map(p => `<span class="${p.stats.quien.ok ? 'ok' : 'ko'}">${p.stats.quien.ok ? '✅' : '❌'} @${esc(p.nick || '?')}</span>`).join('')}</div>`;
}
function openQuien() {
  const q = quienDelDia();
  const card = $('#modalCard');
  card.className = 'card quien-card';
  if (!q) {
    card.innerHTML = '<h3>🧠 ¿Quién es?</h3><p class="cdesc">Hacen falta al menos 4 criaturas en el juego.</p><button class="btn ok">Vale</button>';
    card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
    $('#modal').hidden = false; return;
  }
  const done = quienHoy(), racha = save.quienRacha || { count: 0, last: '' };
  card.innerHTML = `<h3>🧠 ¿Quién es?</h3>
    <div class="muted">La misma silueta para todos tus amigos. ¡Solo un intento!</div>
    <div class="quien-pic r-${q.c.rarity} ${done ? 'reveal' : ''}"><img src="${esc(q.c.url)}" alt="" draggable="false"></div>
    <div class="quien-opts">${q.opts.map(o => `<button class="btn secondary quien-opt ${done && o.id === q.c.id ? 'right' : ''} ${done && o.id === save.quien.cid && !save.quien.ok ? 'wrong' : ''}"
      data-id="${esc(o.id)}" ${done ? 'disabled' : ''}>${esc(o.name)}</button>`).join('')}</div>
    <div class="quien-res">${done ? quienResHtml(q.c) : ''}</div>
    <div class="streak">🧠 Racha de aciertos: <b>${racha.count}</b> · Aciertos totales: <b>${save.stats.quienOk || 0}</b></div>
    ${quienAmigosHtml()}
    <button class="btn ok">Vale</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  card.querySelectorAll('.quien-opt').forEach(b => { b.onclick = () => answerQuien(q, b.dataset.id); });
  $('#modal').hidden = false;
}
function quienResHtml(c) {
  const tiene = !!save.first[c.id];
  return save.quien.ok
    ? `<b>¡Correcto! Es ${esc(c.name)}</b> · +20 todocoins +80 XP${tiene ? '' : '<br><small>Aún no la tienes… ¡a buscarla!</small>'}`
    : `<b>¡Era ${esc(c.name)}!</b> Mañana más suerte.${tiene ? '' : '<br><small>Aún no la tienes… ¡a buscarla!</small>'}`;
}
function answerQuien(q, id) {
  if (quienHoy()) return;
  const ok = id === q.c.id, d = today();
  save.quien = { date: d, cid: id, ok };
  const r = save.quienRacha || { count: 0, last: '' };
  const ayer = new Date(Date.now() - 864e5).toLocaleDateString('sv');
  if (ok) {
    r.count = r.last === ayer ? r.count + 1 : 1; r.last = d;
    save.coins += 20; save.xp += Math.round(80 * eventMult('xp'));
    save.stats.quienOk = (save.stats.quienOk || 0) + 1;
    sfx.success();
  } else { r.count = 0; r.last = d; sfx.fail ? sfx.fail() : null; }
  save.quienRacha = r;
  persist(); updateHud();
  if (ok) shareActivity('quien', null, { racha: r.count }, true);
  if (signedIn()) cloudPush().catch(() => {});
  openQuien();
}

// ---------------------------------------------------------------- Jefe de la semana (cooperativo)
// Cada semana aparece un jefe (el mismo para todos). Cada captura le quita vida según su rareza (las brillantes, el
// doble). La vida se suma entre todos los amigos que participan; cuando llega a cero, quien haya ayudado
// (al menos 10 de daño) reclama el premio: una copia del jefe, 50 todocoins y 3 ultraorbes.
const JEFE_DMG = { comun: 2, raro: 3, superraro: 5, epico: 8, legendario: 12, mitico: 16, astral: 20, secreto: 25 };
const JEFE_MIN = 10;
function jefeState() {
  const w = weekId();
  if (!save.jefe || save.jefe.week !== w) save.jefe = { week: w, dmg: 0, claimed: false };
  return save.jefe;
}
function jefeDeLaSemana() {
  const tiers = [c => rarIdx(c.rarity) >= rarIdx('legendario') && c.rarity !== 'secreto', c => rarIdx(c.rarity) >= rarIdx('epico'), () => true];
  for (const t of tiers) {
    const pool = creatures.filter(t);
    if (pool.length) return pool[Math.floor(seeded('jefe' + weekId())() * pool.length)];
  }
  return null;
}
function jefeHit(c, shiny) {
  const j = jefeState(), before = jefeTotals();
  j.dmg += (JEFE_DMG[c.rarity] || 2) * (shiny ? 2 : 1);
  persist();
  const after = jefeTotals();
  if (before.total < before.hp && after.total >= after.hp) setTimeout(() => toast('👹 ¡El jefe de la semana ha caído! Reclama tu premio en 📋', 5000), 1500);
}
function jefeTotals(others) {
  const w = weekId(), j = jefeState();
  const list = (others || (signedIn() ? profilesCache.filter(p => p.uid !== Cloud.user.uid) : []))
    .filter(p => p.stats && p.stats.jefe && p.stats.jefe.week === w && +p.stats.jefe.dmg > 0)
    .map(p => ({ nick: p.nick || 'Jugador', dmg: +p.stats.jefe.dmg }));
  const rows = [{ nick: (myProfile && myProfile.nick) || 'Tú', dmg: j.dmg, me: true }].concat(list).sort((a, b) => b.dmg - a.dmg);
  const players = rows.filter(r => r.dmg > 0).length;
  // La vida crece con cada jugador que se une (así cuesta lo mismo con 1 que con 6)
  return { rows, total: rows.reduce((a, r) => a + r.dmg, 0), hp: 100 + 100 * Math.max(1, players) };
}
function jefeBoxHtml(others) {
  const c = jefeDeLaSemana(); if (!c) return '';
  const j = jefeState(), t = jefeTotals(others), dead = t.total >= t.hp || j.claimed;
  const pct = Math.max(0, 100 - 100 * t.total / t.hp);
  return `<div class="jefe nested ${dead ? 'dead' : ''}">
    <div class="jefe-pic r-${c.rarity} ${dead ? 'reveal' : ''}">${creatureImg(c, false)}</div>
    <div class="jefe-info"><b>${dead ? esc(c.name) : '¿?'}</b> <span class="tag">${RAR[c.rarity].label}</span>
      <div class="jefe-hp"><i style="width:${pct.toFixed(0)}%"></i><span>${dead ? '¡Derrotado!' : `❤️ ${Math.max(0, t.hp - t.total)} / ${t.hp}`}</span></div>
      <small>Tu daño: <b>${j.dmg}</b> · ${daysLeftWeek() === 1 ? 'último día' : `quedan ${daysLeftWeek()} días`}</small></div>
    <ol class="jefe-rank">${t.rows.filter(r => r.dmg > 0 || r.me).slice(0, 6).map(r => `<li class="${r.me ? 'me' : ''}"><b>${esc(r.nick)}${r.me ? ' (tú)' : ''}</b><em>${r.dmg} 💥</em></li>`).join('')}</ol>
    ${j.claimed ? '<div class="muted">✅ Premio reclamado. ¡El lunes llega otro jefe!</div>'
      : dead ? (j.dmg >= JEFE_MIN ? '<button class="btn jefe-claim">🎁 Reclamar premio</button>' : `<div class="muted">Necesitabas al menos ${JEFE_MIN} de daño para el premio.</div>`)
      : `<div class="muted">Cada captura le quita vida (las raras y brillantes, más). Premio: el jefe, 50 todocoins y 3 ultraorbes.</div>`}
  </div>`;
}
function jefeSocialHtml(others) { return creatures.length ? `<div class="sec-h">👹 Jefe de la semana</div>${jefeBoxHtml(others)}` : ''; }
function openJefe() {
  const card = $('#modalCard');
  card.className = 'card jefe-card';
  card.innerHTML = `<h3>👹 Jefe de la semana</h3><div class="muted">Lo derrotáis entre todos los amigos capturando criaturas.</div>
    ${jefeBoxHtml()}${signedIn() ? '' : '<div class="muted">Entra con tu usuario para luchar junto a tus amigos.</div>'}<button class="btn secondary ok">Vale</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  $('#modal').hidden = false;
}
function claimJefe() {
  const j = jefeState(), t = jefeTotals(), c = jefeDeLaSemana();
  if (j.claimed || !c || t.total < t.hp || j.dmg < JEFE_MIN) return;
  j.claimed = true;
  const isNew = !save.first[c.id];
  addCreature(c.id); save.coins += 50; save.items.ultra += 3;
  save.stats.jefes = (save.stats.jefes || 0) + 1;
  persist(); updateHud();
  shareActivity('jefe', c, {}, true);
  showCard(c, { isNew, gained: 0 });
  const tag = document.createElement('div');
  tag.className = 'new jefe-won'; tag.textContent = '👹 ¡Jefe derrotado! +50 todocoins +3 ultraorbes';
  $('#modalCard').prepend(tag);
  sfx.success();
}
document.addEventListener('click', e => { if (e.target.closest('.jefe-claim')) { e.stopPropagation(); claimJefe(); } }, true);

// ---------------------------------------------------------------- Caza de color (fotos reales que invocan criaturas)
// Cada día hay un color (el mismo para todos). Haces una foto a algo real de ese color y el juego mira, en tu propio
// móvil (la foto no se sube a ningún sitio), qué color domina. Si acierta, invoca una criatura cuya imagen es de ese
// color. 3 intentos al día y una invocación. Las criaturas raras salen más de lo normal.
const COLORES = [
  { n: 'rojo', e: '🔴', h: 0 }, { n: 'naranja', e: '🟠', h: 30 }, { n: 'amarillo', e: '🟡', h: 55 }, { n: 'verde', e: '🟢', h: 120 },
  { n: 'turquesa', e: '🩵', h: 178 }, { n: 'azul', e: '🔵', h: 220 }, { n: 'morado', e: '🟣', h: 275 }, { n: 'rosa', e: '🩷', h: 325 }
];
const COLOR_TRIES = 3;
const colorDelDia = () => COLORES[Math.floor(seeded('color' + today())() * COLORES.length)];
function colorHoy() {
  if (!save.color || save.color.date !== today()) save.color = { date: today(), tries: 0, ok: false, cid: null };
  return save.color;
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const colorDeHue = h => COLORES.reduce((best, c) => hueDist(h, c.h) < hueDist(h, best.h) ? c : best, COLORES[0]);
// Color dominante de una imagen (solo píxeles con color: se ignoran blancos, negros y grises)
function dominantHue(img, size = 48) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  let d; try { d = g.getImageData(0, 0, size, size).data; } catch { return null; }
  const bins = new Array(36).fill(0); let colored = 0, total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    total++;
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), c = mx - mn;
    if (mx < 0.22 || c / (mx || 1) < 0.3) continue;
    let h = mx === r ? ((gg - b) / c) % 6 : mx === gg ? (b - r) / c + 2 : (r - gg) / c + 4;
    h = (h * 60 + 360) % 360;
    bins[Math.floor(h / 10) % 36] += c * mx; colored++;
  }
  if (!total || colored / total < 0.08) return null;           // casi sin color
  const i = bins.indexOf(Math.max(...bins));
  return i * 10 + 5;
}
const loadImg = src => new Promise((ok, ko) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = ko; im.src = src; });
let hueCache = null;
async function creatureHues() {
  hueCache = hueCache || JSON.parse(localStorage.getItem('fotocaza_hues') || '{}');
  const faltan = creatures.filter(c => !(c.url in hueCache));
  await Promise.all(faltan.map(async c => {
    try { const h = dominantHue(await loadImg(c.url), 32); hueCache[c.url] = h == null ? -1 : h; } catch { hueCache[c.url] = -1; }
  }));
  if (faltan.length) try { localStorage.setItem('fotocaza_hues', JSON.stringify(hueCache)); } catch {}
  return hueCache;
}
async function invocarColor(target) {
  const hues = await creatureHues();
  let cands = creatures.filter(c => hues[c.url] >= 0 && colorDeHue(hues[c.url]).n === target.n && c.rarity !== 'secreto');
  if (!cands.length) cands = creatures.filter(c => hues[c.url] >= 0).sort((a, b) => hueDist(hues[a.url], target.h) - hueDist(hues[b.url], target.h)).slice(0, 5);
  if (!cands.length) cands = creatures.slice();
  // Las más raras pesan más que en la calle
  const w = c => 1 + rarIdx(c.rarity) * 1.5, tot = cands.reduce((a, c) => a + w(c), 0);
  let x = Math.random() * tot;
  return cands.find(c => (x -= w(c)) <= 0) || cands[0];
}
function colorAmigosHtml() {
  if (!signedIn() || !profilesCache.length) return '';
  const hoy = profilesCache.filter(p => p.uid !== Cloud.user.uid && p.stats && p.stats.color && p.stats.color.date === today());
  return hoy.length ? `<div class="quien-amigos">${hoy.map(p => `<span>${p.stats.color.ok ? '🎨' : '🔍'} @${esc(p.nick || '?')}</span>`).join('')}</div>` : '';
}
function openColor() {
  const t = colorDelDia(), st = colorHoy(), left = COLOR_TRIES - st.tries;
  const card = $('#modalCard');
  card.className = 'card color-card';
  card.style.setProperty('--cc', `hsl(${t.h} 85% 55%)`);
  card.innerHTML = `<h3>🎨 Caza de color</h3>
    <div class="color-target"><span class="color-dot"></span><div><small>Color de hoy (el mismo para todos)</small><b>${t.e} ${t.n.toUpperCase()}</b></div></div>
    <p class="cdesc">Busca algo <b>${t.n}</b> de verdad en la calle o en casa (una flor, un coche, una puerta…) y hazle una foto
      de cerca, que se vea bien el color. Si acierto, invocarás una criatura de ese color.</p>
    <div class="color-res">${st.ok ? `✅ ¡Hoy ya lo has conseguido!${st.cid && creatureById(st.cid) ? ` Invocaste a <b>${esc(creatureById(st.cid).name)}</b>.` : ''}` : ''}</div>
    ${st.ok ? '' : left > 0 ? `<label class="btn color-shot">📷 Hacer la foto <small>(${left} ${left === 1 ? 'intento' : 'intentos'})</small>
        <input type="file" accept="image/*" capture="environment" hidden></label>` : '<div class="muted">Sin intentos por hoy. ¡Mañana, otro color!</div>'}
    <div class="muted color-priv">🔒 La foto no sale de tu móvil: solo se mira su color.</div>
    ${colorAmigosHtml()}
    <button class="btn secondary ok">Cerrar</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; card.style.removeProperty('--cc'); };
  const inp = card.querySelector('.color-shot input');
  if (inp) inp.onchange = () => { if (inp.files && inp.files[0]) analizarFoto(inp.files[0]); };
  $('#modal').hidden = false;
  creatureHues();   // se van calculando los colores de las criaturas mientras tanto
}
async function analizarFoto(file) {
  const st = colorHoy(), t = colorDelDia(), res = $('.color-res');
  if (st.ok || st.tries >= COLOR_TRIES) return;
  res.innerHTML = '🔍 Mirando el color…';
  let hue = null;
  try {
    const url = URL.createObjectURL(file);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    hue = dominantHue(img, 64);
  } catch (e) { console.warn(e); res.textContent = 'No he podido leer la foto. Prueba otra vez.'; return; }
  st.tries++; persist();
  if (hue == null) { res.innerHTML = '😶 Casi no veo color ahí (mucho blanco, negro o gris). Acércate más al objeto.'; return setTimeout(openColor, 2200); }
  const vio = colorDeHue(hue);
  if (vio.n !== t.n) { sfx.flee(); res.innerHTML = `${vio.e} Eso es más bien <b>${vio.n}</b>. ¡Busca algo ${t.n}!`; return setTimeout(openColor, 2600); }
  const c = await invocarColor(t);
  st.ok = true; st.cid = c.id;
  save.stats.colores = (save.stats.colores || 0) + 1; persist();
  sfx.success();
  res.innerHTML = `✨ ¡${t.e} ${t.n.toUpperCase()}! Algo se acerca…`;
  shareActivity('color', c, { color: t.n }, true);
  if (signedIn()) cloudPush().catch(() => {});
  setTimeout(() => {
    $('#modal').hidden = true;
    const pos = player || { lat: CFG.defaultLocation[0], lng: CFG.defaultLocation[1] };
    openCatch({ id: `color_${today()}`, lat: pos.lat, lng: pos.lng, creature: c, shiny: isShiny('color' + today() + c.id), invocada: true });
  }, 1600);
}

// ---------------------------------------------------------------- Quimeras (inventa criaturas mezclando dos)
// Juntas media criatura con media de otra (en vertical o en horizontal) y nace una criatura nueva con nombre mezclado.
// Cuesta 25 todocoins. Tus amigos las ven en la galería y las votan con ❤️; la más votada de la semana se corona.
const QUIM_COST = 25, QUIM_PX = 160;
let quimGaleria = [];
const mixName = (a, b) => {
  const x = a.trim(), y = b.trim();
  return (x.slice(0, Math.ceil(x.length / 2)) + y.slice(Math.floor(y.length / 2))).replace(/\s+/g, ' ').slice(0, 24);
};
async function drawQuimera(cv, a, b, corte) {
  const g = cv.getContext('2d'), S = cv.width;
  g.clearRect(0, 0, S, S);
  const [ia, ib] = await Promise.all([loadImg(a.url), loadImg(b.url)]);
  const fit = (im) => { const k = Math.min(S / im.width, S / im.height); return [(S - im.width * k) / 2, (S - im.height * k) / 2, im.width * k, im.height * k]; };
  const half = (im, first) => {
    g.save(); g.beginPath();
    if (corte === 'v') g.rect(first ? 0 : S / 2, 0, S / 2, S); else g.rect(0, first ? 0 : S / 2, S, S / 2);
    g.clip(); g.drawImage(im, ...fit(im)); g.restore();
  };
  half(ia, true); half(ib, false);
}
function quimHtml(q, opts = {}) {
  const votos = (q.votos || []).length, mio = window.Cloud && Cloud.user && (q.votos || []).includes(Cloud.user.uid);
  return `<div class="quim ${opts.top ? 'top' : ''}">${opts.top ? '<i class="quim-crown">👑</i>' : ''}<img src="${esc(q.img)}" alt="">
    <b>${esc(q.nombre)}</b>${opts.autor ? `<small>de @${esc(q.nick || '?')}</small>` : ''}
    ${opts.votar ? `<button class="quim-vote ${mio ? 'on' : ''}" data-id="${esc(q.id)}" ${opts.propia ? 'disabled' : ''}>❤️ ${votos}</button>` : ''}</div>`;
}
async function openQuimeras() {
  const card = $('#modalCard');
  card.className = 'card quim-card';
  const mine = save.quimeras;
  const opts = discovered().filter(c => (save.caught[c.id] || 0) > 0).sort((a, b) => a.name.localeCompare(b.name));
  const sel = (cls, i) => `<select class="${cls}">${opts.map((c, j) => `<option value="${esc(c.id)}" ${j === i ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  card.innerHTML = `<h3>🧬 Quimeras</h3>
    <div class="muted">Junta media criatura con media de otra y crea una nueva. Tus amigos la votan.</div>
    ${opts.length < 2 ? '<p class="cdesc">Necesitas al menos 2 criaturas distintas.</p>' : `
    <div class="quim-lab nested">
      <canvas class="quim-prev" width="${QUIM_PX}" height="${QUIM_PX}"></canvas>
      <div class="quim-ctl">${sel('qa', 0)}${sel('qb', 1)}
        <div class="lf-row"><button class="btn small secondary quim-cut" data-c="v">◧ Vertical</button><button class="btn small secondary quim-cut" data-c="h">⬒ Horizontal</button></div>
        <input class="quim-name" maxlength="24" placeholder="Nombre">
      </div>
      <button class="btn quim-make" ${save.coins < QUIM_COST ? 'disabled' : ''}>🧬 Crear (${QUIM_COST} todocoins)</button>
    </div>`}
    <div class="sec-h">Tus quimeras</div>
    <div class="quim-grid">${mine.length ? mine.slice().reverse().map(q => quimHtml(q)).join('') : '<div class="muted">Aún no has creado ninguna.</div>'}</div>
    <div class="quim-gal">${signedIn() ? '<div class="muted">Cargando la galería de tus amigos…</div>' : ''}</div>
    <button class="btn secondary ok">Cerrar</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  $('#modal').hidden = false;
  if (opts.length >= 2) {
    let corte = 'v';
    const cv = card.querySelector('.quim-prev'), qa = card.querySelector('.qa'), qb = card.querySelector('.qb'), nm = card.querySelector('.quim-name');
    const upd = () => {
      const a = creatureById(qa.value), b = creatureById(qb.value); if (!a || !b) return;
      nm.value = mixName(a.name, b.name);
      card.querySelectorAll('.quim-cut').forEach(x => x.classList.toggle('on', x.dataset.c === corte));
      drawQuimera(cv, a, b, corte).catch(e => console.warn(e));
    };
    qa.onchange = qb.onchange = upd;
    card.querySelectorAll('.quim-cut').forEach(x => { x.onclick = () => { corte = x.dataset.c; upd(); }; });
    upd();
    card.querySelector('.quim-make').onclick = async ev => {
      const a = creatureById(qa.value), b = creatureById(qb.value);
      if (!a || !b || a.id === b.id) return toast('Elige dos criaturas distintas');
      if (save.coins < QUIM_COST) return toast('No tienes todocoins suficientes');
      ev.currentTarget.disabled = true;
      await drawQuimera(cv, a, b, corte);
      let img = cv.toDataURL('image/webp', 0.8);
      if (!img.startsWith('data:image/webp') || img.length > 60000) img = cv.toDataURL('image/jpeg', 0.8);
      const q = { id: 'q' + Date.now().toString(36), nombre: (nm.value.trim() || mixName(a.name, b.name)).slice(0, 24), img, a: a.id, b: b.id, t: Date.now() };
      save.coins -= QUIM_COST; save.stats.quimeras = (save.stats.quimeras || 0) + 1;
      save.quimeras.push(q); if (save.quimeras.length > 30) save.quimeras.shift();
      persist(); updateHud(); sfx.success();
      toast(`🧬 ¡Ha nacido ${q.nombre}!`, 3500);
      if (signedIn()) {
        try {
          await Cloud.put('quimeras', q.id + '_' + Cloud.user.uid, { nombre: q.nombre, img: q.img, a: q.a, b: q.b,
            nick: (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user), votos: [] });
          shareActivity('quimera', null, { nombre: q.nombre }, true);
        } catch (e) { console.warn(e); toast('Creada, pero no se pudo compartir (¿faltan las reglas nuevas de Firebase?)'); }
      }
      openQuimeras();
    };
  }
  if (signedIn()) loadGaleria();
}
async function loadGaleria() {
  const box = $('.quim-gal'); if (!box) return;
  try {
    quimGaleria = (await Cloud.recent('quimeras', Date.now() - 14 * 864e5, 40)).filter(q => typeof q.img === 'string' && q.img.startsWith('data:image/'));
    const semana = quimGaleria.filter(q => q.t > Date.now() - 7 * 864e5);
    const top = semana.slice().sort((a, b) => (b.votos || []).length - (a.votos || []).length)[0];
    const lista = quimGaleria.slice().sort((a, b) => b.t - a.t);
    box.innerHTML = `<div class="sec-h">Galería de los amigos</div>
      ${top && (top.votos || []).length ? `<div class="quim-week">${quimHtml(top, { top: true, autor: true, votar: true, propia: top.from === Cloud.user.uid })}<small>Quimera de la semana</small></div>` : ''}
      <div class="quim-grid">${lista.length ? lista.map(q => quimHtml(q, { autor: true, votar: true, propia: q.from === Cloud.user.uid })).join('') : '<div class="muted">Nadie ha compartido quimeras todavía.</div>'}</div>`;
  } catch (e) { console.warn(e); box.innerHTML = '<div class="muted">No se pudo cargar la galería.</div>'; }
}
document.addEventListener('click', async e => {
  const b = e.target.closest('.quim-vote'); if (!b || b.disabled) return;
  e.stopPropagation();
  const q = quimGaleria.find(x => x.id === b.dataset.id); if (!q) return;
  const me = Cloud.user.uid, votos = (q.votos || []).filter(v => v !== me);
  if (!(q.votos || []).includes(me)) votos.push(me);
  b.disabled = true;
  try { await Cloud.patch('quimeras', q.id, { votos }); q.votos = votos; loadGaleria(); }
  catch (err) { console.warn(err); b.disabled = false; toast('No se pudo votar (¿sin conexión?)'); }
}, true);

// ---------------------------------------------------------------- Reto semanal entre amigos
// Cada semana toca un reto (el mismo para todos): más capturas, más km, más paradas o más raras.
// Clasificación en directo en Jugadores y premio por llegar a la meta.
const RETOS = [
  { k: 'captures', t: 'Más capturas',                  u: 'capturas', meta: 40 },
  { k: 'km',       t: 'Más kilómetros andados',        u: 'km',       meta: 8 },
  { k: 'stops',    t: 'Más paradas visitadas',         u: 'paradas',  meta: 20 },
  { k: 'rare',     t: 'Más criaturas raras o mejores', u: 'raras',    meta: 12 }
];
function weekId(d = new Date()) {   // semana ISO, p. ej. 2026-W48
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return `${x.getUTCFullYear()}-W${String(Math.ceil(((x - y0) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}
function weekState() {
  const id = weekId();
  if (!save.week || save.week.id !== id) save.week = { id, prog: { captures: 0, stops: 0, rare: 0 }, km0: save.walked, premio: false };
  return save.week;
}
const retoActual = () => RETOS[Math.floor(seeded('reto' + weekState().id)() * RETOS.length)];
function retoValues() {
  const w = weekState();
  return { captures: w.prog.captures, stops: w.prog.stops, rare: w.prog.rare, km: Math.round((save.walked - w.km0) * 10) / 10 };
}
function daysLeftWeek() { const d = new Date().getDay() || 7; return 8 - d; }
function checkReto() {
  const w = weekState(), r = retoActual();
  if (w.premio || retoValues()[r.k] < r.meta) return;
  w.premio = true;
  save.coins += 40; save.items.super += 5;
  persist(); updateHud();
  setTimeout(() => { toast(`🏆 ¡Meta del reto semanal conseguida! +40 todocoins y 5 superorbes`, 5000); sfx.success(); }, 4500);
  shareActivity('reto', null, { reto: r.t }, true);
}
function retoHtml(others) {
  const r = retoActual(), w = weekState(), mine = retoValues()[r.k];
  const rows = [{ nick: (myProfile && myProfile.nick) || 'Tú', v: mine, me: true }]
    .concat(others.filter(p => p.stats && p.stats.semana && p.stats.semana.id === w.id)
      .map(p => ({ nick: p.nick || 'Jugador', v: +(p.stats.semana[r.k] || 0) })))
    .sort((a, b) => b.v - a.v).slice(0, 6);
  const fmt = v => String(v).replace('.', ',');
  return `<div class="sec-h">🏆 Reto de la semana</div>
    <div class="reto nested"><div class="reto-head"><b>${r.t}</b><span class="tag">${daysLeftWeek() === 1 ? 'Último día' : `Quedan ${daysLeftWeek()} días`}</span></div>
      <div class="reto-meta">Tu marca: <b>${fmt(mine)}</b> / ${r.meta} ${r.u}${w.premio ? ' · ✅ premio conseguido' : ' · meta: 40 todocoins + 5 superorbes'}</div>
      <div class="bar"><i style="width:${Math.min(100, 100 * mine / r.meta).toFixed(0)}%"></i></div>
      <ol class="reto-rank">${rows.map((x, i) => `<li class="${x.me ? 'me' : ''}"><span>${['🥇', '🥈', '🥉'][i] || i + 1 + '.'}</span>
        <b>${esc(x.nick)}${x.me ? ' (tú)' : ''}</b><em>${fmt(x.v)} ${r.u}</em></li>`).join('')}</ol></div>`;
}

// ---------------------------------------------------------------- Títulos para el perfil
const TITULOS = [
  { t: 'Novato/a',              ok: () => true },
  { t: 'Cazador/a',             ok: () => !!save.logros.cazador },
  { t: 'Leyenda de la caza',    ok: () => !!save.logros.leyenda },
  { t: 'Coleccionista',         ok: () => !!save.logros.colec10 },
  { t: 'Enciclopedia viviente', ok: () => !!save.logros.colec30 },
  { t: 'Buscador/a de brillos', ok: () => !!save.logros.brillo },
  { t: 'Leyenda viva',          ok: () => !!save.logros.legend },
  { t: 'Detective',             ok: () => !!save.logros.secreto },
  { t: 'Andarín',               ok: () => !!save.logros.andarin },
  { t: 'Maratoniano/a',         ok: () => !!save.logros.maraton },
  { t: 'Guardián del barrio',   ok: () => !!save.logros.barrio },
  { t: 'Alma generosa',         ok: () => !!save.logros.generoso },
  { t: 'Buen/a compañero/a',    ok: () => !!save.logros.chivato },
  { t: 'Veterano/a',            ok: () => !!save.logros.nivel10 },
  { t: 'Racha de fuego 🔥',     ok: () => save.streak && save.streak.count >= 7 },
  { t: 'Campeón/a semanal 🏆',  ok: () => save.week && save.week.premio }
];
const titulosDisponibles = () => [''].concat(TITULOS.filter(x => x.ok()).map(x => x.t));

// ---------------------------------------------------------------- Logros y medallas
// Se desbloquean solos; cada uno da 15 todocoins, sale en las novedades de tus amigos y se ve en tu perfil.
const rarIdx = r => RAR_ORDER.indexOf(r);
const discovered = () => Object.keys(save.first).map(creatureById).filter(Boolean);
const LOGROS = [
  { id: 'primera',    i: '🎯', n: 'Primera captura',     d: 'Captura tu primera criatura',        ok: () => save.stats.captures >= 1 },
  { id: 'cazador',    i: '🏹', n: 'Cazador',             d: 'Haz 50 capturas',                     ok: () => save.stats.captures >= 50 },
  { id: 'leyenda',    i: '🗡️', n: 'Leyenda de la caza',  d: 'Haz 250 capturas',                    ok: () => save.stats.captures >= 250 },
  { id: 'colec10',    i: '📖', n: 'Coleccionista',       d: 'Descubre 10 criaturas distintas',     ok: () => Object.keys(save.first).length >= 10 },
  { id: 'colec30',    i: '📚', n: 'Enciclopedia',        d: 'Descubre 30 criaturas distintas',     ok: () => Object.keys(save.first).length >= 30 },
  { id: 'brillo',     i: '✨', n: '¡Qué brillo!',        d: 'Consigue una criatura brillante',     ok: () => Object.keys(save.shiny).length >= 1 },
  { id: 'legend',     i: '👑', n: 'Legendario',          d: 'Descubre una criatura legendaria o mejor', ok: () => discovered().some(c => rarIdx(c.rarity) >= rarIdx('legendario')) },
  { id: 'secreto',    i: '🕵️', n: 'Secreto revelado',    d: 'Descubre una criatura secreta',       ok: () => discovered().some(c => c.rarity === 'secreto') },
  { id: 'andarin',    i: '👟', n: 'Andarín',             d: 'Anda 10 km',                          ok: () => save.walked >= 10 },
  { id: 'maraton',    i: '🏃', n: 'Maratón',             d: 'Anda 42 km',                          ok: () => save.walked >= 42 },
  { id: 'paradas',    i: '📍', n: 'Turista',             d: 'Visita 25 paradas distintas',         ok: () => Object.keys(save.visited).length >= 25 },
  { id: 'huevo',      i: '🐣', n: 'Criador',             d: 'Abre tu primer huevo',                ok: () => save.stats.hatched >= 1 },
  { id: 'fusion',     i: '⚗️', n: 'Alquimista',          d: 'Fusiona 5 criaturas en un huevo',     ok: () => save.stats.fused >= 1 },
  { id: 'barrio',     i: '🏘️', n: 'Rey del barrio',      d: 'Sube un barrio a Oro',                ok: () => Object.values(save.barrios).some(b => masteryLevel(b.pts) >= 4) },
  { id: 'generoso',   i: '🎁', n: 'Generoso',            d: 'Envía 5 regalos a amigos',            ok: () => (save.stats.giftsSent || 0) >= 5 },
  { id: 'chivato',    i: '📣', n: 'Buen compañero',      d: 'Avisa 3 veces a tus amigos de una rara', ok: () => (save.stats.avisos || 0) >= 3 },
  { id: 'buscador',   i: '🫣', n: 'Buscatesoros',        d: 'Encuentra 3 escondites de amigos',    ok: () => (save.stats.hallados || 0) >= 3 },
  { id: 'cerebrito',  i: '🧠', n: 'Cerebrito',           d: 'Acierta 7 veces el ¿Quién es?',       ok: () => (save.stats.quienOk || 0) >= 7 },
  { id: 'gladiador',  i: '⚔️', n: 'Gladiador',           d: 'Gana 5 duelos contra amigos',         ok: () => (save.stats.duelosGanados || 0) >= 5 },
  { id: 'jefazo',     i: '👹', n: 'Matajefes',           d: 'Derrota a un jefe de la semana',      ok: () => (save.stats.jefes || 0) >= 1 },
  { id: 'zahori',     i: '📡', n: 'Zahorí',              d: 'Encuentra 5 criaturas ocultas con el sensor', ok: () => (save.stats.ocultas || 0) >= 5 },
  { id: 'pandilla',   i: '👯', n: 'La pandilla',         d: 'Caza 60 minutos junto a amigos',      ok: () => Object.values(save.amistad).reduce((a, x) => a + (x.min || 0), 0) >= 60 },
  { id: 'imparable',  i: '⚡', n: 'Imparable',           d: 'Haz un combo de 10 capturas seguidas', ok: () => (save.stats.comboMax || 0) >= 10 },
  { id: 'pintor',     i: '🎨', n: 'Ojo de pintor',       d: 'Consigue 5 cazas de color',           ok: () => (save.stats.colores || 0) >= 5 },
  { id: 'cientifico', i: '🧬', n: 'Científico loco',     d: 'Crea 3 quimeras',                     ok: () => (save.stats.quimeras || 0) >= 3 },
  { id: 'nivel10',    i: '🔟', n: 'Veterano',            d: 'Llega al nivel 10',                   ok: () => levelOf(save.xp) >= 10 }
];
let checkingLogros = false;
function checkLogros() {
  if (checkingLogros || !creatures.length) return;
  checkingLogros = true;
  try {
    const nuevos = LOGROS.filter(l => !save.logros[l.id] && l.ok());
    if (!nuevos.length) return;
    for (const l of nuevos) { save.logros[l.id] = Date.now(); save.coins += 15; }
    persist();
    $('#coinCount').textContent = save.coins;
    nuevos.forEach((l, i) => setTimeout(() => {
      toast(`🏅 ¡Logro conseguido! ${l.i} ${l.n} · +15 todocoins`, 4000);
      sfx.success();
      shareActivity('logro', null, { logro: `${l.i} ${l.n}` }, true);
    }, 3000 + i * 4200));
  } finally { checkingLogros = false; }
}
function logrosHtml(p, mine) {
  const have = new Set(mine ? Object.keys(save.logros) : (p.logros || []));
  const list = mine ? LOGROS : LOGROS.filter(l => have.has(l.id));
  if (!list.length) return '';
  return `<div class="sec-mini">Logros <small>${have.size}/${LOGROS.length}</small></div>
    <div class="medals">${list.map(l => `<span class="medal ${have.has(l.id) ? '' : 'locked'}" title="${esc(l.n)}: ${esc(l.d)}">${l.i}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- Criatura compañera
// Una criatura del álbum camina contigo en el mapa. Cada km juntos te encuentra algo, y tus amigos la ven en tu perfil.
const buddyKm = () => save.buddy ? Math.max(0, save.walked - save.buddy.km0) : 0;
let buddyMarker = null;
function setBuddy(c) {
  save.buddy = { id: c.id, km0: save.walked, found: 0 };
  persist();
  if (buddyMarker) { map.removeLayer(buddyMarker); buddyMarker = null; }
  updateBuddyMarker();
  toast(`🐾 ¡${c.name} ahora camina contigo! Cada km juntas te encontrará algo.`, 4000);
  sfx.success();
}
function updateBuddyMarker() {
  const c = save.buddy && creatureById(save.buddy.id);
  if (!c || !player) { if (buddyMarker) { map.removeLayer(buddyMarker); buddyMarker = null; } return; }
  const pos = [player.lat + 0.00004, player.lng + 0.00009]; // un pasito a tu lado
  if (!buddyMarker) {
    buddyMarker = L.marker(pos, { interactive: false, zIndexOffset: 1200,
      icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 36], html: `<div class="buddy r-${c.rarity}"><img src="${esc(c.url)}" alt=""></div>` }) }).addTo(map);
  } else buddyMarker.setLatLng(pos);
}
function checkBuddy() {
  const b = save.buddy, c = b && creatureById(b.id);
  if (!c) return;
  const due = Math.floor(buddyKm());
  while (b.found < due) {
    b.found++;
    const r = b.found % 4;
    const prize = r === 1 ? (save.items.candy += 1, '1 caramelo') : r === 2 ? (save.coins += 8, '8 todocoins')
      : r === 3 ? (save.orbs = Math.min(CFG.orbsMax, save.orbs + 5), '5 orbes') : (save.items.gold += 1, '1 caramelo dorado');
    toast(`🐾 ${c.name} ha encontrado ${prize} (${b.found} km juntas)`, 4000);
  }
  if (due) { persist(); updateHud(); }
}
function buddyLineHtml(p, mine) {
  const id = mine ? (save.buddy && save.buddy.id) : (p.stats && p.stats.buddy);
  const c = creatureById(id);
  if (!c) return mine ? '<div class="buddy-line muted">🐾 Sin compañera: elige una en el álbum («Hacer compañera»)</div>' : '';
  const km = mine ? buddyKm() : (p.stats.buddyKm || 0);
  return `<div class="buddy-line r-${c.rarity}"><img src="${esc(c.url)}" alt=""><span>🐾 Compañera: <b>${esc(c.name)}</b> · ${String(Math.round(km * 10) / 10).replace('.', ',')} km juntas</span></div>`;
}

// ---------------------------------------------------------------- Comparar álbumes con un amigo
function compareHtml(p) {
  const his = new Set((p.stats && p.stats.album) || []), mine = new Set(Object.keys(save.first));
  if (!his.size) return '<div class="muted">Tu amigo aún no ha compartido su álbum (aparece cuando juegue con la versión nueva).</div>';
  const hasHe = [...his].filter(id => !mine.has(id)).map(creatureById).filter(Boolean);
  const hasMe = [...mine].filter(id => !his.has(id)).map(creatureById).filter(Boolean);
  const both = [...mine].filter(id => his.has(id)).length;
  const sort = l => l.sort((a, b) => RAR_ORDER.indexOf(b.rarity) - RAR_ORDER.indexOf(a.rarity));
  // Lo que él tiene y tú no se ve en silueta (¡así sabes qué buscar!)
  const cell = (c, sil) => `<div class="cmp-cell r-${c.rarity}" title="${sil ? esc(RAR[c.rarity].label) : esc(c.name)}">
    ${sil && c.rarity === 'secreto' ? '<i>?</i>' : `<img src="${esc(c.url)}" alt="" class="${sil ? 'sil' : ''}">`}<span>${sil ? '???' : esc(c.name)}</span></div>`;
  return `<div class="cmp-sum"><div><b>${both}</b><span>en común</span></div><div><b>${hasHe.length}</b><span>tiene y tú no</span></div><div><b>${hasMe.length}</b><span>tienes y no</span></div></div>
    ${hasHe.length ? `<div class="sec-mini">@${esc(p.nick || 'amigo')} tiene y tú no</div><div class="cmp-grid">${sort(hasHe).slice(0, 24).map(c => cell(c, true)).join('')}</div>` : ''}
    ${hasMe.length ? `<div class="sec-mini">Tú tienes y @${esc(p.nick || 'amigo')} no</div><div class="cmp-grid">${sort(hasMe).slice(0, 24).map(c => cell(c, false)).join('')}</div>` : ''}`;
}

// ---------------------------------------------------------------- Reacciones a perfiles
const REACCIONES = ['❤️', '🔥', '😂', '👏', '😮'];
let myReacts = [];
function countReacts(list) { const c = {}; for (const r of list) if (REACCIONES.includes(r.emoji)) c[r.emoji] = (c[r.emoji] || 0) + 1; return c; }
function reactsSummaryHtml(list) {
  const c = countReacts(list);
  return `<div class="reacts">${REACCIONES.filter(e => c[e]).map(e => `<span>${e} <b>${c[e]}</b></span>`).join('')}</div>`;
}
async function loadReactBar(p) {
  const bar = $('#reactBar'); if (!bar) return;
  let list = [];
  try { list = await Cloud.where('reacciones', 'to', p.uid); } catch (e) { console.warn(e); }
  const draw = () => {
    const c = countReacts(list), mine = (list.find(r => r.from === Cloud.user.uid) || {}).emoji;
    bar.innerHTML = `<span class="muted">Reacciona:</span>${REACCIONES.map(e =>
      `<button class="rx ${mine === e ? 'on' : ''}" data-e="${e}">${e}<b>${c[e] || ''}</b></button>`).join('')}`;
  };
  draw();
  bar.onclick = async ev => {
    const b = ev.target.closest('.rx'); if (!b) return;
    const id = `${p.uid}_${Cloud.user.uid}`, mine = list.find(r => r.from === Cloud.user.uid);
    try {
      if (mine && mine.emoji === b.dataset.e) {        // quitar la reacción
        await Cloud.remove('reacciones', id);
        list = list.filter(r => r !== mine);
      } else {
        await Cloud.put('reacciones', id, { to: p.uid, emoji: b.dataset.e });
        list = list.filter(r => r.from !== Cloud.user.uid).concat([{ from: Cloud.user.uid, to: p.uid, emoji: b.dataset.e }]);
        b.classList.add('pop'); dailyInc('reacts');
      }
      draw();
    } catch (e) { console.warn(e); toast('No se pudo reaccionar (¿faltan las reglas nuevas de Firebase?)'); }
  };
}

// ---------------------------------------------------------------- Duelos entre amigos
// Retas a un amigo con un equipo de 3 criaturas (en orden). Él ve solo la rareza de las tuyas y elige su equipo y su
// orden: se enfrentan 1ª contra 1ª, 2ª contra 2ª y 3ª contra 3ª. Cada una tiene poder según su rareza (+ brillante,
// + copias) y en cada ronda hay un poco de suerte (igual para los dos móviles). Gana quien gane más rondas.
const DUEL_POWER = { comun: 10, raro: 14, superraro: 19, epico: 25, legendario: 32, mitico: 40, astral: 50, secreto: 60 };
let duelsIn = [];
function duelPower(c) {
  return (DUEL_POWER[c.rarity] || 10) + ((save.shiny[c.id] || 0) ? 5 : 0) + Math.min(5, save.caught[c.id] || 0);
}
function myTeamOptions() {
  return discovered().filter(c => (save.caught[c.id] || 0) > 0).sort((a, b) => duelPower(b) - duelPower(a));
}
function teamSelectsHtml(cls) {
  const opts = myTeamOptions();
  return [0, 1, 2].map(i => `<label class="field duel-slot">${i + 1}ª <select class="${cls}">${opts.map((c, j) =>
    `<option value="${esc(c.id)}" ${j === i ? 'selected' : ''}>${esc(c.name)} · ⚔️${duelPower(c)}</option>`).join('')}</select></label>`).join('');
}
function readTeam(box, cls) {
  const ids = [...box.querySelectorAll('.' + cls)].map(x => x.value);
  if (new Set(ids).size !== 3) { toast('Elige 3 criaturas distintas'); return null; }
  const cs = ids.map(creatureById);
  if (cs.some(c => !c)) return null;
  return { ids, poder: cs.map(duelPower) };
}
function duelForm(box, p) {
  if (myTeamOptions().length < 3) { box.innerHTML = '<div class="muted">Necesitas al menos 3 criaturas distintas para luchar.</div>'; return; }
  box.innerHTML = `<b>⚔️ Duelo con @${esc(p.nick || 'amigo')}</b>
    <div class="muted">Tu amigo solo verá la rareza de tus criaturas. ¡El orden importa!</div>
    ${teamSelectsHtml('duel-sel')}
    <button class="btn duel-send">Enviar reto</button>`;
  box.querySelector('.duel-send').onclick = async ev => {
    const t = readTeam(box, 'duel-sel'); if (!t) return;
    const b = ev.currentTarget; b.disabled = true;
    try {
      await Cloud.add('duelos', { to: p.uid, nick: (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user), toNick: p.nick || '',
        equipo: t.ids, poder: t.poder, rarezas: t.ids.map(id => creatureById(id).rarity), estado: 'pendiente' });
      box.innerHTML = '<div class="muted">✅ ¡Reto enviado! Cuando tu amigo luche verás el resultado.</div>';
    } catch (e) { console.warn(e); b.disabled = false; toast('No se pudo enviar (¿faltan las reglas nuevas de Firebase?)'); }
  };
}
// Resultado (lo calculan igual los dos móviles a partir del id del duelo)
function resolveDuel(d) {
  const rounds = [0, 1, 2].map(i => {
    const r = seeded(d.id + ':' + i), a = (+d.poder[i] || 0) + r() * 15, b = (+d.poder2[i] || 0) + r() * 15;
    return { a: Math.round(a), b: Math.round(b), w: a > b ? 'from' : b > a ? 'to' : '' };
  });
  const wa = rounds.filter(x => x.w === 'from').length, wb = rounds.filter(x => x.w === 'to').length;
  return { rounds, ganador: wa > wb ? 'from' : wb > wa ? 'to' : 'empate' };
}
function duelReward(d, soy) {
  if (save.duelosVistos[d.id]) return '';
  save.duelosVistos[d.id] = Date.now();
  const res = resolveDuel(d);
  let txt;
  if (res.ganador === soy) {
    save.coins += 25; save.xp += Math.round(100 * eventMult('xp'));
    save.stats.duelosGanados = (save.stats.duelosGanados || 0) + 1;
    txt = '¡Has ganado! +25 todocoins +100 XP';
    shareActivity('duelo', null, { con: soy === 'from' ? d.toNick || '' : d.nick || '' }, true);
  } else if (res.ganador === 'empate') { save.coins += 10; txt = '¡Empate! +10 todocoins'; }
  else { save.coins += 5; txt = 'Has perdido… +5 todocoins por luchar'; }
  persist(); updateHud();
  return txt;
}
function showDuel(d, soy, premio) {
  const res = resolveDuel(d), mine = soy === 'from' ? d.equipo : d.equipo2, his = soy === 'from' ? d.equipo2 : d.equipo;
  const rival = soy === 'from' ? d.toNick : d.nick;
  const card = $('#modalCard');
  card.className = 'card duel-card';
  card.innerHTML = `<h3>⚔️ Duelo contra @${esc(rival || '?')}</h3>
    <div class="duel-rounds">${res.rounds.map((r, i) => {
      const a = creatureById(mine[i]), b = creatureById(his[i]);
      const pa = soy === 'from' ? r.a : r.b, pb = soy === 'from' ? r.b : r.a, gano = r.w === soy;
      return `<div class="duel-round" style="animation-delay:${i * 0.6}s">
        <div class="dside ${gano ? 'win' : ''} r-${a ? a.rarity : 'comun'}">${a ? creatureImg(a, false) : ''}<small>${a ? esc(a.name) : '?'}</small><b>${pa}</b></div>
        <span class="dvs">${gano ? '🏆' : r.w ? '💥' : '🤝'}</span>
        <div class="dside ${r.w && !gano ? 'win' : ''} r-${b ? b.rarity : 'comun'}">${b ? creatureImg(b, false) : ''}<small>${b ? esc(b.name) : '?'}</small><b>${pb}</b></div></div>`;
    }).join('')}</div>
    <div class="duel-final" style="animation-delay:1.9s">${res.ganador === soy ? '🏆 ¡Victoria!' : res.ganador === 'empate' ? '🤝 Empate' : '😵 Derrota'}
      ${premio ? `<small>${esc(premio)}</small>` : ''}</div>
    <button class="btn ok">Vale</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  $('#modal').hidden = false;
  if (res.ganador === soy) setTimeout(() => sfx.success(), 1900);
}
async function pollDuelos() {
  if (!signedIn()) return;
  try {
    const [inn, out] = await Promise.all([Cloud.forMe('duelos'), Cloud.fromMe('duelos')]);
    duelsIn = inn.filter(d => d.estado === 'pendiente' && Array.isArray(d.equipo) && d.equipo.length === 3);
    for (const d of out) {
      if (d.estado !== 'hecho' || !Array.isArray(d.equipo2)) continue;
      if (!save.duelosVistos[d.id]) {
        const premio = duelReward(d, 'from');
        if ($('#modal').hidden) showDuel(d, 'from', premio);
        else toast(`⚔️ @${d.toNick || 'tu amigo'} ha aceptado tu duelo: ${premio}`, 5000);
      }
      Cloud.remove('duelos', d.id).catch(() => {});
    }
    $('.level').classList.toggle('has-duel', duelsIn.length > 0);
    if (!$('#social').hidden) renderSocial();
  } catch (e) { console.warn('duelos', e); }
}
setInterval(pollDuelos, 120000);
function duelosHtml() {
  if (!duelsIn.length) return '';
  return `<div class="sec-h">⚔️ Duelos para ti</div>${duelsIn.map(d => `<div class="duel-item nested" data-id="${esc(d.id)}">
    <div><b>@${esc(d.nick || '?')}</b> te reta con:</div>
    <div class="duel-rival">${(d.rarezas || []).slice(0, 3).map((r, i) => `<span class="dq r-${RAR[r] ? r : 'comun'}"><i>${i + 1}ª</i>?<small>${RAR[r] ? RAR[r].label : '?'}</small></span>`).join('')}</div>
    ${myTeamOptions().length >= 3 ? `${teamSelectsHtml('duel-me')}
      <div class="lf-row"><button class="btn small duel-fight">⚔️ ¡Luchar!</button><button class="btn small secondary duel-no">Rechazar</button></div>`
      : '<div class="muted">Necesitas 3 criaturas distintas para luchar.</div><button class="btn small secondary duel-no">Rechazar</button>'}
  </div>`).join('')}`;
}
$('#socialBody').addEventListener('click', async e => {
  const f = e.target.closest('.duel-fight'), no = e.target.closest('.duel-no');
  if (!f && !no) return;
  e.stopPropagation();
  const box = (f || no).closest('.duel-item'), d = duelsIn.find(x => x.id === box.dataset.id); if (!d) return;
  try {
    if (no) { await Cloud.remove('duelos', d.id); }
    else {
      const t = readTeam(box, 'duel-me'); if (!t) return;
      f.disabled = true;
      const nd = { ...d, equipo2: t.ids, poder2: t.poder };
      const res = resolveDuel(nd);
      await Cloud.patch('duelos', d.id, { estado: 'hecho', equipo2: t.ids, poder2: t.poder, ganador: res.ganador,
        nick2: (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user) });
      const premio = duelReward(nd, 'to');
      showDuel(nd, 'to', premio);
    }
    duelsIn = duelsIn.filter(x => x.id !== d.id);
    $('.level').classList.toggle('has-duel', duelsIn.length > 0);
    renderSocial();
  } catch (err) { console.warn(err); if (f) f.disabled = false; toast('No se pudo (¿sin conexión?)'); }
}, true);

// ---------------------------------------------------------------- Intercambios entre amigos
// Ofreces una criatura repetida (te quedas al menos con una) a cambio de una del álbum de tu amigo.
let tradesIn = [];
function tradeForm(box, p) {
  const mine = creatures.filter(c => (save.caught[c.id] || 0) >= 2);
  const his = ((p.stats && p.stats.album) || []).map(creatureById).filter(Boolean);
  if (!mine.length) { box.innerHTML = '<div class="muted">Necesitas alguna criatura repetida (2 copias o más) para ofrecer.</div>'; return; }
  if (!his.length) { box.innerHTML = '<div class="muted">Tu amigo aún no ha compartido su álbum.</div>'; return; }
  const opt = (c, show) => `<option value="${esc(c.id)}">${show ? esc(c.name) : '???'} · ${RAR[c.rarity].label}${show && save.caught[c.id] ? ` (tienes ${save.caught[c.id]})` : ''}</option>`;
  box.innerHTML = `<b>🔄 Intercambio con @${esc(p.nick || 'amigo')}</b>
    <label class="field">Ofreces (repetidas) <select class="trd-of">${mine.map(c => opt(c, true)).join('')}</select></label>
    <label class="field">Pides <select class="trd-pi">${his.map(c => opt(c, known(c))).join('')}</select></label>
    <button class="btn trd-send">Enviar propuesta</button>`;
  box.querySelector('.trd-send').onclick = async ev => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      await Cloud.add('intercambios', { to: p.uid, nick: (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user), toNick: p.nick || '',
        ofrece: box.querySelector('.trd-of').value, pide: box.querySelector('.trd-pi').value, estado: 'pendiente' });
      box.innerHTML = '<div class="muted">✅ Propuesta enviada. Cuando tu amigo la acepte, se hará el cambio.</div>';
    } catch (e) { console.warn(e); b.disabled = false; toast('No se pudo enviar (¿faltan las reglas nuevas de Firebase?)'); }
  };
}
function addCreature(id) {
  save.caught[id] = (save.caught[id] || 0) + 1;
  if (!save.first[id]) save.first[id] = Date.now();
}
async function pollTrades() {
  if (!signedIn()) return;
  try {
    const [inn, out] = await Promise.all([Cloud.forMe('intercambios'), Cloud.fromMe('intercambios')]);
    tradesIn = inn.filter(t => t.estado === 'pendiente');
    // Propuestas mías ya resueltas por mi amigo
    for (const t of out) {
      if (t.estado === 'aceptado' && !t.aplicado) {
        save.caught[t.ofrece] = Math.max(0, (save.caught[t.ofrece] || 0) - 1);
        addCreature(t.pide); persist();
        await Cloud.patch('intercambios', t.id, { aplicado: true });
        const c = creatureById(t.pide);
        toast(`🔄 ¡@${t.toNick || 'tu amigo'} aceptó el intercambio! Has recibido ${c ? c.name : 'una criatura'}`, 5000);
        sfx.success(); shareActivity('intercambio', c, { con: t.toNick || '' }, true);
      } else if (t.estado === 'rechazado' || (t.estado === 'aceptado' && t.aplicado)) {
        if (t.estado === 'rechazado') toast(`🔄 @${t.toNick || 'tu amigo'} ha rechazado tu intercambio`, 4000);
        Cloud.remove('intercambios', t.id).catch(() => {});
      }
    }
    $('.level').classList.toggle('has-trade', tradesIn.length > 0);
    if (!$('#social').hidden) renderSocial();
  } catch (e) { console.warn('intercambios', e); }
}
setInterval(pollTrades, 120000);
function tradesHtml() {
  if (!tradesIn.length) return '';
  return `<div class="sec-h">🔄 Intercambios para ti</div>${tradesIn.map(t => {
    const of = creatureById(t.ofrece), pi = creatureById(t.pide);
    if (!of || !pi) return '';
    const can = (save.caught[pi.id] || 0) >= 1;
    return `<div class="trade-item nested">
      <div class="trade-who"><b>@${esc(t.nick || '?')}</b> te ofrece:</div>
      <div class="trade-swap"><div class="tcell r-${of.rarity}">${creatureImg(of, false)}<span>${esc(of.name)}</span></div><b>⇄</b>
        <div class="tcell r-${pi.rarity}">${creatureImg(pi, false)}<span>${esc(pi.name)}</span></div></div>
      <div class="muted">A cambio de tu ${esc(pi.name)}${can ? ` (tienes ${save.caught[pi.id]})` : ' — ya no la tienes'}</div>
      <div class="lf-row"><button class="btn small trd-ok" data-id="${esc(t.id)}" ${can ? '' : 'disabled'}>Aceptar</button>
        <button class="btn small secondary trd-no" data-id="${esc(t.id)}">Rechazar</button></div></div>`;
  }).join('')}`;
}
$('#socialBody').addEventListener('click', async e => {
  const ok = e.target.closest('.trd-ok'), no = e.target.closest('.trd-no');
  if (!ok && !no) return;
  e.stopPropagation();
  const id = (ok || no).dataset.id, t = tradesIn.find(x => x.id === id); if (!t) return;
  (ok || no).disabled = true;
  try {
    if (ok) {
      if ((save.caught[t.pide] || 0) < 1) return toast('Ya no tienes esa criatura');
      await Cloud.patch('intercambios', id, { estado: 'aceptado' });
      save.caught[t.pide]--; addCreature(t.ofrece); persist();
      const c = creatureById(t.ofrece);
      toast(`🔄 ¡Intercambio hecho! Has recibido ${c ? c.name : 'una criatura'}`, 4000); sfx.success();
    } else {
      await Cloud.patch('intercambios', id, { estado: 'rechazado' });
    }
    tradesIn = tradesIn.filter(x => x.id !== id);
    $('.level').classList.toggle('has-trade', tradesIn.length > 0);
    renderSocial();
  } catch (err) { console.warn(err); toast('No se pudo (¿sin conexión?)'); }
}, true);

// ---------------------------------------------------------------- Regalos entre amigos
// Las paradas dan regalos que solo se pueden enviar a amigos. Quien lo recibe lo abre y le toca algo al azar.
let giftsCache = [];
async function pollGifts() {
  if (!signedIn()) return;
  try {
    giftsCache = (await Cloud.forMe('regalos')).filter(g => !g.abierto && !save.giftsOpened[g.id]).sort((a, b) => b.t - a.t);
    $('.level').classList.toggle('has-gift', giftsCache.length > 0);
    if (!$('#social').hidden) renderSocial();
  } catch (e) { console.warn('regalos', e); }
}
setInterval(pollGifts, 120000);
function giftsHtml() {
  if (!giftsCache.length) return '';
  return `<div class="sec-h">🎁 Regalos para ti</div><div class="gifts">${giftsCache.map(g => `
    <div class="gift-item nested"><div class="gift-box">🎁</div>
      <div class="gift-txt"><b>De @${esc(g.nick || '?')}</b>${g.mensaje ? `<span>«${esc(g.mensaje)}»</span>` : ''}<small>${timeAgo(g.t)}</small></div>
      <button class="btn small gift-open" data-id="${esc(g.id)}">Abrir</button></div>`).join('')}</div>`;
}
function rollGift(from) {
  const r = Math.random();
  if (r < 0.45) { const n = 5 + Math.floor(Math.random() * 6); save.orbs = Math.min(CFG.orbsMax, save.orbs + n); return `${n} orbes`; }
  if (r < 0.65) { const n = 8 + Math.floor(Math.random() * 10); save.coins += n; return `${n} todocoins`; }
  if (r < 0.80) { const n = 2 + Math.floor(Math.random() * 2); save.items.candy += n; return `${n} caramelos`; }
  if (r < 0.88) { save.items.gold += 1; return '1 caramelo dorado'; }
  if (r < 0.95) { const n = 2 + Math.floor(Math.random() * 2); save.items.super += n; return `${n} superorbes`; }
  // ¡Un huevo! De una familia al azar, raro
  const fams = [...new Set(creatures.map(c => c.category))];
  const fam = fams[Math.floor(Math.random() * fams.length)] || 'Otros';
  save.eggs.push({ id: 'e' + Date.now().toString(36), family: fam, rarity: 'raro', km: EGG_KM.raro, from: null, fromName: '',
    gift: from, created: Date.now(), start: null });
  fillIncubators(); updateEggBadge();
  return `un huevo raro de «${fam}»`;
}
async function openGift(id) {
  const g = giftsCache.find(x => x.id === id); if (!g || save.giftsOpened[id]) return;
  save.giftsOpened[id] = Date.now();
  const prize = rollGift(g.nick || 'amigo');
  persist(); updateHud();
  giftsCache = giftsCache.filter(x => x.id !== id);
  $('.level').classList.toggle('has-gift', giftsCache.length > 0);
  try { await Cloud.patch('regalos', id, { abierto: true }); await Cloud.remove('regalos', id); } catch (e) { console.warn(e); }
  const card = $('#modalCard');
  card.className = 'card';
  card.innerHTML = `<div class="gift-big">🎁</div><h3>¡Regalo de @${esc(g.nick || '?')}!</h3>
    ${g.mensaje ? `<p class="cdesc">«${esc(g.mensaje)}»</p>` : ''}
    <div class="stats">Te ha tocado: <b class="gift-prize"></b></div><button class="btn ok">¡Gracias!</button>`;
  card.querySelector('.gift-prize').textContent = prize;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  $('#modal').hidden = false;
  sfx.success();
  renderSocial();
}
$('#socialBody').addEventListener('click', e => {
  const b = e.target.closest('.gift-open'); if (b) { e.stopPropagation(); openGift(b.dataset.id); }
}, true);

// ---------------------------------------------------------------- Notas en paradas
// Deja un mensaje en una parada (estando en ella) y tus amigos lo leen al abrirla. Una nota por persona y parada
// (la nueva sustituye a la anterior); duran 30 días. Las paradas con notas de amigos llevan un 💬.

function stopKey(st) { return String(st.id).replace(/[^\w.-]/g, '_').slice(0, 100); }
function notasDe(st) { return notasCache.get(stopKey(st)) || []; }
function mineNota(n) { return !!(window.Cloud && Cloud.user && n.from === Cloud.user.uid); }
function setNotas(list) {
  const lim = Date.now() - NOTA_DIAS * 864e5;
  notasCache = new Map();
  for (const n of list) {
    if (!(n.t > lim) || typeof n.stop !== 'string' || typeof n.texto !== 'string') continue;
    if (!notasCache.has(n.stop)) notasCache.set(n.stop, []);
    notasCache.get(n.stop).push(n);
  }
  for (const arr of notasCache.values()) arr.sort((a, b) => b.t - a.t);
}
async function pollNotas() {
  if (!signedIn()) return;
  try {
    setNotas(await Cloud.recent('notas', Date.now() - NOTA_DIAS * 864e5, 200));
    // Limpiar las notas leídas que ya caducaron
    const lim = Date.now() - (NOTA_DIAS + 1) * 864e5;
    for (const k in save.notasVistas) if (save.notasVistas[k] < lim) delete save.notasVistas[k];
    refreshStops();
  } catch (e) { console.warn('notas', e); }
}
setInterval(pollNotas, 300000);
function avisarNotasCerca(list) {
  if (!player || !notasCache.size) return;
  for (const st of list) {
    if (distM(player, st) > CFG.catchRadius) continue;
    const n = notasDe(st).find(x => !mineNota(x) && !save.notasVistas[x.id] && !notaAvisada.has(x.id));
    if (!n) continue;
    notaAvisada.add(n.id);
    toast(`💬 @${n.nick || '?'} dejó una nota en «${st.nombre}». ¡Abre la parada para leerla!`, 4500);
    return;
  }
}
function renderNotas(st, refresh) {
  const box = $('#notasBox');
  if (!box) return;
  if (!signedIn()) { box.innerHTML = cloudEnabled ? '<div class="muted notas-off">💬 Entra con tu usuario para leer y dejar notas a tus amigos.</div>' : ''; return; }
  const list = notasDe(st).slice(0, 6), mine = list.find(mineNota);
  for (const n of list) if (!mineNota(n)) save.notasVistas[n.id] = Date.now();
  persist();
  box.innerHTML = `<div class="notas-h">💬 Notas de amigos</div>
    ${list.length ? list.map(n => `<div class="nota ${mineNota(n) ? 'mine' : ''}"><b>@${esc(n.nick || '?')}${mineNota(n) ? ' (tú)' : ''}</b>
      <span>${esc(n.texto)}</span><small>${timeAgo(n.t)}</small>${mineNota(n) ? '<button class="nota-del" aria-label="Borrar mi nota">✕</button>' : ''}</div>`).join('')
      : '<div class="muted">Nadie ha dejado notas aquí. ¡Sé el primero!</div>'}
    <div class="nota-form"><input class="nota-txt" maxlength="${NOTA_MAX}" placeholder="${mine ? 'Cambiar tu nota…' : 'Deja una nota para tus amigos…'}">
      <button class="btn small nota-go">Dejar</button></div>`;
  box.querySelector('.nota-go').onclick = () => sendNota(st);
  box.querySelector('.nota-txt').onkeydown = e => { if (e.key === 'Enter') sendNota(st); };
  const del = box.querySelector('.nota-del');
  if (del) del.onclick = async () => {
    del.disabled = true;
    try { await Cloud.remove('notas', `${stopKey(st)}_${Cloud.user.uid}`); notasCache.set(stopKey(st), notasDe(st).filter(n => !mineNota(n))); renderNotas(st); }
    catch (e) { console.warn(e); del.disabled = false; toast('No se pudo borrar (¿sin conexión?)'); }
  };
  if (refresh) Cloud.where('notas', 'stop', stopKey(st), 30).then(arr => {
    const lim = Date.now() - NOTA_DIAS * 864e5;
    notasCache.set(stopKey(st), arr.filter(n => n.t > lim && typeof n.texto === 'string').sort((a, b) => b.t - a.t));
    if (openStopData === st) renderNotas(st);
  }).catch(e => console.warn('notas', e));
}
async function sendNota(st) {
  const box = $('#notasBox'), inp = box.querySelector('.nota-txt'), b = box.querySelector('.nota-go');
  const texto = inp.value.trim().slice(0, NOTA_MAX);
  if (!texto) return inp.focus();
  if (player && distM(player, st) > CFG.catchRadius && !save.dev) return toast('Tienes que estar en la parada para dejar una nota.');
  b.disabled = true;
  try {
    const nick = (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user), id = `${stopKey(st)}_${Cloud.user.uid}`;
    await Cloud.put('notas', id, { stop: stopKey(st), nombre: String(st.nombre || '').slice(0, 60), nick, texto });
    const arr = notasDe(st).filter(n => !mineNota(n));
    arr.unshift({ id, stop: stopKey(st), nick, texto, from: Cloud.user.uid, t: Date.now() });
    notasCache.set(stopKey(st), arr);
    renderNotas(st); refreshStops(); sfx.success();
    toast('💬 ¡Nota dejada! Tus amigos la verán al pasar por aquí.');
    shareActivity('nota', null, { parada: String(st.nombre || '').slice(0, 60) });
  } catch (e) { console.warn(e); b.disabled = false; toast('No se pudo dejar la nota (¿sin conexión o faltan las reglas nuevas de Firebase?)'); }
}

// ---------------------------------------------------------------- Cazar juntos
// Si lo activas en Ajustes, tus amigos saben que estás jugando cerca (solo la zona, redondeada a ~100 m, y solo
// mientras tienes el juego abierto). Si un amigo está a menos de 250 m: XP ×1,5 y el doble de brillantes para
// los dos, y vais subiendo vuestra amistad (minutos cazando juntos).
const JUNTOS_R = 250, JUNTOS_FRESCO = 5 * 60e3;
let juntosAvisado = {};
function amistadNivel(min) {
  return min >= 300 ? 'Mejores amigos 💖' : min >= 120 ? 'Grandes amigos 💛' : min >= 30 ? 'Buenos amigos 💚' : 'Amigos 🤍';
}
async function pollJuntos() {
  const antes = juntos.map(j => j.uid).join();
  if (!signedIn() || !save.juntos || !player) {
    juntos = [];
    if (signedIn() && !save.juntos) Cloud.remove('presencia', Cloud.user.uid).catch(() => {});
  } else {
    try {
      const nick = (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user);
      await Cloud.put('presencia', Cloud.user.uid, { nick, lat: +player.lat.toFixed(3), lng: +player.lng.toFixed(3) });
      const list = await Cloud.recent('presencia', Date.now() - JUNTOS_FRESCO, 40);
      juntos = list.filter(x => x.id !== Cloud.user.uid && typeof x.lat === 'number' && typeof x.lng === 'number'
        && distM(player, x) <= JUNTOS_R).map(x => ({ uid: x.id, nick: String(x.nick || 'amigo').slice(0, 24) }));
      for (const j of juntos) {
        const a = save.amistad[j.uid] || (save.amistad[j.uid] = { nick: j.nick, min: 0 });
        a.nick = j.nick; a.min += 1;
        if (juntosAvisado[j.uid] !== today()) {
          juntosAvisado[j.uid] = today();
          shareActivity('juntos', null, { con: j.nick });
        }
      }
      persist();
    } catch (e) { console.warn('juntos', e); juntos = []; }
  }
  $('#hud-top').classList.toggle('juntos-on', juntos.length > 0);
  if (antes !== juntos.map(j => j.uid).join()) { announceEvents(); updateHud(); }
}
setInterval(pollJuntos, 60000);

// ---------------------------------------------------------------- Combo de capturas
// Cada captura a menos de 3 minutos de la anterior sube el combo (hasta ×10): +10 % de XP por cada paso.
// Si una criatura huye, se pierde. El récord sale en el perfil y en la clasificación (⚡ Combo).
function comboVivo() { return Date.now() - save.combo.last < COMBO_MS ? save.combo.n : 0; }
const comboMult = n => 1 + 0.1 * Math.max(0, Math.min(COMBO_MAX, n) - 1);
function comboHit() {
  const n = comboVivo() + 1;
  save.combo = { n, last: Date.now() };
  if (n > (save.stats.comboMax || 0)) {
    save.stats.comboMax = n;
    if (n >= 5) shareActivity('combo', null, { combo: n }, true);
  }
  persist(); renderCombo();
  return n;
}
function comboBreak() { save.combo = { n: 0, last: 0 }; persist(); renderCombo(); }
let comboT = null;
function renderCombo() {
  clearTimeout(comboT);
  const el = $('#combo'), n = comboVivo();
  if (n < 2) { el.hidden = true; return; }
  const left = Math.max(0, COMBO_MS - (Date.now() - save.combo.last));
  el.hidden = false;
  el.innerHTML = `⚡ ×${n} <small>${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}</small>`;
  el.classList.toggle('ending', left < 30000);
  comboT = setTimeout(renderCombo, 1000);
}
setTimeout(renderCombo, 1500);

// ---------------------------------------------------------------- Sensor de criaturas ocultas
// Además de las normales hay criaturas ocultas (más raras): no salen en el mapa ni en la barra de raras.
// Solo las detecta el sensor, y solo mientras andas: el móvil vibra (y pita, y el 📡 late) más deprisa y más
// fuerte cuanto más cerca estás. Sin flechas ni distancias: tendrás que probar direcciones. A 25 m la encuentras.
const SENSOR_R = 150, SENSOR_FOUND = 25;
function hiddenSpawns(pos) {
  if (!creatures.length || !pos) return [];
  const cs0 = CFG.cellSize, cx0 = Math.floor(pos.lat / cs0), cy0 = Math.floor(pos.lng / cs0);
  const slot = Math.floor(Date.now() / (CFG.slotMinutes * 60e3)), out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const cx = cx0 + dx, cy = cy0 + dy, r = seeded(`oculta|${cx}|${cy}|${slot}|${creatures.length}`);
    if (r() > 0.3) continue;                                   // ~1 de cada 3 zonas tiene una
    const id = `oc_${cx}_${cy}_${slot}`;
    if (save.gone[id]) continue;
    const lat = (cx + r()) * cs0, lng = (cy + r()) * cs0;
    const a = pickCreature(r), b = pickCreature(r);            // la mejor de dos: suelen ser más raras
    const creature = rarIdx(b.rarity) > rarIdx(a.rarity) ? b : a;
    out.push({ id, lat, lng, creature, shiny: isShiny('brillo' + id), oculta: true });
  }
  return out;
}
function sensorPulse(k) {
  const el = $('#sensor');
  el.hidden = false;
  el.style.setProperty('--k', k.toFixed(2));
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  try { if (navigator.vibrate) navigator.vibrate(Math.round(25 + 140 * k)); } catch {}
  sfx.ping(k);
}
function sensorTick() {
  clearTimeout(sensorT);
  const walking = Date.now() - lastWalkAt < 20000;
  if (!player || !walking || cs || openStopData || !$('#catch').hidden) {
    sensorOn = false; $('#sensor').hidden = true;
    if (walking) sensorT = setTimeout(sensorTick, 2000);    // en la captura o en una parada: espera
    return;
  }
  sensorOn = true;
  const near = hiddenSpawns(player).map(h => ({ h, d: distM(player, h) })).filter(x => x.d <= SENSOR_R && !sensorFired.has(x.h.id))
    .sort((a, b) => a.d - b.d)[0];
  if (!near) { $('#sensor').hidden = true; sensorT = setTimeout(sensorTick, 2500); return; }
  if (near.d <= SENSOR_FOUND) {
    sensorFired.add(near.h.id);
    $('#sensor').hidden = true;
    try { if (navigator.vibrate) navigator.vibrate([120, 70, 120, 70, 400]); } catch {}
    sfx.success();
    toast('📡 ¡El sensor ha encontrado una criatura oculta!', 2500);
    setTimeout(() => { if (!cs && !openStopData) openCatch(near.h); }, 1100);
    sensorT = setTimeout(sensorTick, 4000);
    return;
  }
  const k = 1 - (near.d - SENSOR_FOUND) / (SENSOR_R - SENSOR_FOUND);   // 0 lejos … 1 encima
  sensorPulse(k);
  sensorT = setTimeout(sensorTick, Math.round(300 + 2700 * (1 - k)));
}

// ---------------------------------------------------------------- Escondites (esconde una criatura para tus amigos)
// Escondes una copia repetida justo donde estás, con una pista. A tus amigos (a menos de 3 km) les sale en la barra
// de raras con una zona aproximada; al llegar (60 m) aparece un 🫣 en el mapa y quien lo toca se queda una copia.
// Cada amigo puede encontrarlo una vez; tú ganas todocoins por cada uno que lo encuentre. Dura 7 días.
const HIDE_DAYS = 7, HIDE_MAX = 3, PISTA_MAX = 80;
let escondites = [];
const hideMarkers = new Map();
const activeHides = () => Object.entries(save.hides).filter(([, h]) => h.hasta > Date.now());
function hideForm(c) {
  if (activeHides().length >= HIDE_MAX) return toast(`Ya tienes ${HIDE_MAX} escondites activos. Espera a que caduquen.`);
  if (!player) return toast('Necesito saber dónde estás para esconderla.');
  const card = $('#modalCard');
  card.className = `card r-${c.rarity}`;
  card.innerHTML = `<div class="card-pic">${creatureImg(c, false)}</div><h3>🫣 Esconder ${esc(c.name)}</h3>
    <p class="cdesc">Se queda escondida <b>aquí mismo</b> durante ${HIDE_DAYS} días. Tus amigos verán la zona aproximada
      y, quien la encuentre, se lleva una copia. Tú ganas 15 todocoins por cada amigo que la encuentre.</p>
    <label class="field">Pista (opcional) <input class="hide-pista" maxlength="${PISTA_MAX}" placeholder="Ej.: junto a la fuente"></label>
    <button class="btn hide-go">Esconder (gastas 1 de tus ${save.caught[c.id]})</button>
    <button class="btn secondary ok">Cancelar</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
  card.querySelector('.hide-go').onclick = async ev => {
    const b = ev.currentTarget;
    if ((save.caught[c.id] || 0) < 2) return toast('Necesitas al menos 2 copias (te quedas una).');
    b.disabled = true;
    const pista = card.querySelector('.hide-pista').value.trim().slice(0, PISTA_MAX);
    try {
      const hasta = Date.now() + HIDE_DAYS * 864e5;
      const id = await Cloud.add('escondites', { nick: (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user), cid: c.id,
        rarity: c.rarity, lat: +player.lat.toFixed(5), lng: +player.lng.toFixed(5), pista, hasta });
      save.caught[c.id]--; save.hides[id] = { cid: c.id, t: Date.now(), hasta, found: [] };
      save.stats.escondidos = (save.stats.escondidos || 0) + 1;
      persist(); updateHud();
      $('#modal').hidden = true; sfx.success();
      toast(`🫣 ¡${c.name} escondida! Tus amigos ya pueden buscarla.`, 4000);
      shareActivity('escondite', null, {}, true);
    } catch (e) { console.warn(e); b.disabled = false; toast('No se pudo esconder (¿sin conexión o faltan las reglas nuevas de Firebase?)'); }
  };
  $('#modal').hidden = false;
}
async function pollEscondites() {
  if (!signedIn() || !creatures.length) return;
  try {
    const [list, hallazgos] = await Promise.all([
      Cloud.recent('escondites', Date.now() - HIDE_DAYS * 864e5, 60),
      Cloud.forMe('hallazgos').catch(() => [])]);
    escondites = list.filter(h => h.from !== Cloud.user.uid && h.hasta > Date.now() && !save.foundHides[h.id]
      && typeof h.lat === 'number' && typeof h.lng === 'number' && creatureById(h.cid));
    // Amigos que han encontrado mis escondites: premio para mí
    for (const f of hallazgos) {
      const h = save.hides[f.esc];
      if (h && !h.found.includes(f.nick)) {
        h.found.push(String(f.nick || '?').slice(0, 24)); save.coins += 15; persist(); updateHud();
        const c = creatureById(h.cid);
        toast(`🫣 ¡@${f.nick || 'Un amigo'} ha encontrado tu ${c ? c.name : 'criatura'} escondida! +15 todocoins`, 5000);
        sfx.success();
      }
      Cloud.remove('hallazgos', f.id).catch(() => {});
    }
    // Mis escondites caducados: se borran
    for (const [id, h] of Object.entries(save.hides)) if (h.hasta < Date.now() - 864e5) {
      delete save.hides[id]; persist(); Cloud.remove('escondites', id).catch(() => {});
    }
    refreshSpawns();
  } catch (e) { console.warn('escondites', e); }
}
setInterval(pollEscondites, 120000);
function mergeEscondites(list) {
  if (!player) return list;
  const out = list.slice();
  for (const h of escondites) {
    const d = distM(player, h);
    if (d > 3000 || d <= CFG.revealRadius || save.foundHides[h.id]) continue;
    out.push({ id: 'esc_' + h.id, lat: h.lat, lng: h.lng, creature: creatureById(h.cid), d, aviso: h.nick || '?', hide: true, pista: h.pista || '' });
  }
  return out;
}
function refreshHideMarkers() {
  const show = new Set();
  for (const h of escondites) {
    if (save.foundHides[h.id] || !player || distM(player, h) > CFG.revealRadius) continue;
    show.add(h.id);
    if (hideMarkers.has(h.id)) continue;
    const c = creatureById(h.cid);
    const m = L.marker([h.lat, h.lng], { zIndexOffset: 850, icon: L.divIcon({ className: '', iconSize: [56, 56], iconAnchor: [28, 52],
      html: `<div class="hide-pin r-${c.rarity}"><span class="hide-sil"><img src="${esc(c.url)}" alt=""></span><b>🫣</b></div>` }) }).addTo(map);
    m.on('click', () => findHide(h.id));
    hideMarkers.set(h.id, m);
    if (radarSel === 'esc_' + h.id) clearRadarSel();
    toast(`🫣 ¡El escondite de @${h.nick || '?'} está aquí cerca! Tócalo en el mapa.`, 4000);
  }
  for (const [id, m] of hideMarkers) if (!show.has(id)) { map.removeLayer(m); hideMarkers.delete(id); }
}
async function findHide(id) {
  const h = escondites.find(x => x.id === id); if (!h || save.foundHides[id] || cs) return;
  const d = distM(player, h);
  if (d > CFG.catchRadius && !save.dev) return toast(`Está a ${Math.round(d)} m. ¡Acércate más!`);
  const c = creatureById(h.cid);
  save.foundHides[id] = Date.now();
  const isNew = !save.first[c.id];
  addCreature(c.id);
  const gained = Math.round((100 + (isNew ? 500 : 0)) * eventMult('xp'));
  save.xp += gained; save.coins += 10;
  save.stats.hallados = (save.stats.hallados || 0) + 1;
  persist(); updateHud(); sfx.success(); try { if (save.sound && navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch {}
  escondites = escondites.filter(x => x.id !== id);
  refreshSpawns();
  showCard(c, { isNew, gained });
  const tag = document.createElement('div');
  tag.className = 'new hide-found';
  tag.textContent = `🫣 Escondida por @${h.nick || '?'} · +10 todocoins`;
  $('#modalCard').prepend(tag);
  try {
    await Cloud.put('hallazgos', `${id}_${Cloud.user.uid}`, { to: h.from, esc: id, cid: c.id,
      nick: (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user) });
  } catch (e) { console.warn('hallazgo', e); }
  shareActivity('hallazgo', c, { con: h.nick || '' }, true);
}
function escondidosHtml() {
  const mine = activeHides();
  if (!mine.length) return '';
  return `<div class="sec-h">🫣 Tus escondites</div><div class="hides nested">${mine.map(([, h]) => {
    const c = creatureById(h.cid); if (!c) return '';
    const dias = Math.max(1, Math.ceil((h.hasta - Date.now()) / 864e5));
    return `<div class="hide-item"><div class="feed-pic r-${c.rarity}">${creatureImg(c, false)}</div>
      <div class="feed-txt"><b>${esc(c.name)}</b> ${h.found.length ? `encontrada por ${h.found.map(n => '@' + esc(n)).join(', ')}` : 'nadie la ha encontrado aún'}
      <small>quedan ${dias} ${dias === 1 ? 'día' : 'días'}</small></div></div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- Avisos de raras entre amigos
// Al encontrar una criatura épica o mejor puedes avisar a tus amigos (📣): les sale en su barra de raras
// con tu nombre y la zona exacta, hasta que cambian las apariciones (cada 15 min).
let avisos = [];
const avisosVistos = new Set();
const slotEnd = () => (Math.floor(Date.now() / (CFG.slotMinutes * 60e3)) + 1) * CFG.slotMinutes * 60e3;
function mergeAvisos(rares, visibles) {
  const out = rares.map(r => ({ ...r }));
  if (!player) return out;
  for (const a of avisos) {
    if (a.hasta < Date.now() || save.gone[a.spawnId] || visibles.has(a.spawnId)) continue;
    const mine = out.find(r => r.id === a.spawnId);
    if (mine) { mine.aviso = a.nick; continue; }
    const c = creatureById(a.cid);
    const d = distM(player, a);
    if (!c || d > 3000) continue;
    out.push({ id: a.spawnId, lat: a.lat, lng: a.lng, creature: c, d, aviso: a.nick, exact: true });
  }
  return out;
}
async function pollAvisos() {
  if (!signedIn() || !creatures.length) return;
  try {
    const list = await Cloud.recent('avisos', Date.now() - 30 * 60e3, 40);
    avisos = list.filter(a => a.from !== Cloud.user.uid && a.hasta > Date.now() && typeof a.lat === 'number' && typeof a.lng === 'number');
    for (const a of avisos) {
      if (avisosVistos.has(a.id)) continue;
      avisosVistos.add(a.id);
      const c = creatureById(a.cid);
      if (!c || !player || distM(player, a) > 3000) continue;
      toast(`📣 @${a.nick} ha visto algo ${RAR[c.rarity].label.toLowerCase()} a ~${Math.max(100, Math.round(distM(player, a) / 100) * 100)} m. ¡Búscalo en la barra de raras!`, 5000);
      sfx.curve();
    }
    refreshSpawns();
  } catch (e) { console.warn('avisos', e); }
}
setInterval(pollAvisos, 60000);
async function sendAviso() {
  if (!cs || !signedIn()) return;
  const c = cs.cr, sp = cs.spawn, b = $('#btnAviso');
  b.disabled = true;
  try {
    await Cloud.add('avisos', { nick: (myProfile && myProfile.nick) || Cloud.userOf(Cloud.user), cid: c.id, rarity: c.rarity,
      lat: +sp.lat.toFixed(6), lng: +sp.lng.toFixed(6), spawnId: sp.id, hasta: slotEnd() });
    b.textContent = '📣 ✓'; toast('📣 ¡Aviso enviado a tus amigos!');
    save.stats.avisos = (save.stats.avisos || 0) + 1; persist(); updateHud();
    if (typeof shareActivity === 'function') shareActivity('aviso', c);
  } catch (e) { console.warn(e); b.disabled = false; toast('No se pudo avisar (¿sin conexión o faltan las reglas nuevas de Firebase?)'); }
}
$('#btnAviso').onclick = sendAviso;

// ---------------------------------------------------------------- Entrar / crear cuenta (usuario + contraseña)
function loginFormHtml(k) {
  return `<form class="login-form" id="lf-${k}" autocomplete="on">
    <input name="usuario" placeholder="Usuario" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required>
    <input name="clave" type="password" placeholder="Contraseña (mín. 6)" autocomplete="current-password" minlength="6" maxlength="64" required>
    <div class="lf-err muted" hidden></div>
    <div class="lf-row"><button class="btn" type="submit" data-act="login">Entrar</button>
      <button class="btn secondary" type="button" data-act="register">Crear cuenta</button></div>
    <div class="muted lf-note">Usuario de 3 a 20 letras, números, «.» o «_». Es único: nadie más puede usarlo.
      Apúntate la contraseña: si se te olvida no se puede recuperar.</div>
  </form>`;
}
function bindLoginForm(box, k) {
  const f = box.querySelector('#lf-' + k), err = f.querySelector('.lf-err');
  const go = async act => {
    const name = f.usuario.value, pass = f.clave.value;
    err.hidden = true;
    if (!Cloud.validUser(name)) { err.textContent = Cloud.errorText({ code: 'fc/usuario-invalido' }); err.hidden = false; return; }
    if (pass.length < 6) { err.textContent = Cloud.errorText({ code: 'auth/weak-password' }); err.hidden = false; return; }
    f.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      if (act === 'register') { await Cloud.register(name, pass); toast(`¡Bienvenido/a, @${Cloud.normUser(name)}! 🎉`); }
      else { await Cloud.login(name, pass); toast(`Hola de nuevo, @${Cloud.normUser(name)} 👋`); }
    } catch (e) {
      console.warn(e);
      err.textContent = Cloud.errorText(e); err.hidden = false;
      f.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  };
  f.onsubmit = e => { e.preventDefault(); go('login'); };
  f.querySelector('[data-act=register]').onclick = () => go('register');
}
function changePasswordDialog() {
  const card = $('#modalCard');
  card.className = 'card edit-card';
  card.innerHTML = `<h3>Cambiar contraseña</h3>
    <form class="login-form" id="pwForm">
      <input name="vieja" type="password" placeholder="Contraseña actual" autocomplete="current-password" required>
      <input name="nueva" type="password" placeholder="Contraseña nueva (mín. 6)" autocomplete="new-password" minlength="6" required>
      <div class="lf-err muted" hidden></div>
      <button class="btn" type="submit">Guardar</button><button class="btn secondary" type="button" id="pwCancel">Cancelar</button>
    </form>`;
  const f = card.querySelector('#pwForm'), err = f.querySelector('.lf-err');
  card.querySelector('#pwCancel').onclick = () => { $('#modal').hidden = true; };
  f.onsubmit = async e => {
    e.preventDefault(); err.hidden = true;
    try { await Cloud.changePassword(f.vieja.value, f.nueva.value); $('#modal').hidden = true; toast('Contraseña cambiada ✓'); }
    catch (x) { err.textContent = Cloud.errorText(x); err.hidden = false; }
  };
  $('#modal').hidden = false;
}

// ---------------------------------------------------------------- Bienvenida (tutorial para jugadores nuevos)
const TUTORIAL = [
  { i: '👋', t: '¡Bienvenido/a a FotoCaza!', d: 'Sal a la calle y caza las criaturas que tú y tus amigos subís al juego. Cuanto más andes, más encontrarás.' },
  { i: '🗺️', t: 'Explora el mapa', d: 'Las criaturas solo aparecen cuando estás cerca (unos 90 m). Las raras salen arriba, en la barra 📡: tócalas y verás la zona donde buscar.' },
  { i: '🔵', t: 'Captura', d: 'Desliza el orbe hacia arriba. Acierta cuando el anillo sea pequeño y gira el orbe en círculos para lanzar con curva. ¡Algunas son brillantes ✨!' },
  { i: '📍', t: 'Paradas', d: 'Los postes azules son paradas: dan orbes, todocoins y regalos 🎁. Con todocoins puedes abonarlas 🌱 o comprar en la tienda.' },
  { i: '👥', t: 'Juega con tus amigos', d: 'Crea tu cuenta en Ajustes. Podrás avisar de raras 📣, enviar regalos, intercambiar, reaccionar a perfiles y competir en el reto semanal 🏆.' },
  { i: '📋', t: 'Cada día, algo nuevo', d: 'Mira tus misiones diarias en 📋 (las mismas para todos) y mantén tu racha 🔥. ¡Toma 5 superorbes para empezar!' }
];
function openTutorial(step = 0) {
  const st = TUTORIAL[step], last = step === TUTORIAL.length - 1;
  const card = $('#modalCard');
  card.className = 'card tuto';
  card.innerHTML = `<div class="tuto-ico">${st.i}</div><h3>${st.t}</h3><p class="tuto-txt">${st.d}</p>
    <div class="tuto-dots">${TUTORIAL.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
    <button class="btn tuto-next">${last ? '¡A jugar!' : 'Siguiente'}</button>
    ${last ? '' : '<button class="link tuto-skip">Saltar</button>'}`;
  card.querySelector('.tuto-next').onclick = () => last ? finishTutorial() : openTutorial(step + 1);
  const sk = card.querySelector('.tuto-skip'); if (sk) sk.onclick = finishTutorial;
  $('#modal').hidden = false;
}
function finishTutorial() {
  $('#modal').hidden = true;
  if (!save.tutorial) {
    save.tutorial = Date.now(); save.items.super += 5; persist();
    toast('🎁 ¡Toma 5 superorbes de bienvenida!', 3500);
  }
}
$('#btnTutorial').onclick = () => { $('#settings').hidden = true; openTutorial(0); };
// Primera vez que se abre el juego (si ya tenía progreso de antes, no se le molesta)
if (!save.tutorial && !save.xp && !Object.keys(save.first).length) setTimeout(() => { if ($('#modal').hidden) openTutorial(0); }, 1200);
else if (!save.tutorial) { save.tutorial = Date.now(); }

// ---------------------------------------------------------------- Arranque
updateHud();
updateEggBadge();
setStatus('Cargando imágenes…');
if (window.Cloud) Cloud.init(CFG.firebase, onCloudUser)
  .then(ok => { cloudEnabled = ok; if (!ok) cloudLoading = false; renderAccount(); })
  .catch(e => { console.warn(e); cloudLoading = false; renderAccount(); });
Promise.all([initCreatures(false), loadParadas(), loadEventos()]).then(() => {
  announceEvents();
  renderMisBadge();
  startGeo();
  setInterval(refreshSpawns, 20000); // las apariciones se renuevan
  setInterval(refreshStops, 5000);   // recargas de paradas y criaturas brotadas
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
  navigator.serviceWorker.register('sw.js').catch(() => {});

// Para pruebas desde la consola
window.fotocaza = { save, parse: parseCreature, _social: { openSocial, loadMyProfile, pollAvisos, pollFeed, shareActivity, pollGifts, pollTrades, pollEscondites, findHide, pollNotas, pollDuelos, pollJuntos, get juntos() { return juntos; } }, _barrio: { creditBarrio, openBarrios, updateCurrentBarrio }, _eventos: { activeEvents, eventMult, get custom() { return customEvents; }, set custom(v) { customEvents = v; } }, get creatures() { return creatures; }, get player() { return player; }, refreshSpawns, _quim: { openQuimeras, mixName }, _sol: { sunTimes, horaDorada }, _color: { dominantHue, analizarFoto, colorDelDia, creatureHues, openColor }, _sensor: { hiddenSpawns, sensorTick, get map() { return map; } }, openCatch, throwOrb: (vx, vy) => cs && throwOrb(vx, vy), get state() { return cs; } };
})();
