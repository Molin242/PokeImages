/* FotoCaza — juego de captura geolocalizado con imágenes de un repositorio de GitHub */
(() => {
'use strict';

const CFG = Object.assign({
  owner: '', repo: '', branch: '', folder: 'imagenes',
  catchRadius: 60, cellSize: 0.0015, cellRange: 2, slotMinutes: 15,
  defaultLocation: [40.4168, -3.7038],
  orbsStart: 30, orbsMax: 100, stopCooldownMin: 5, autoParadas: true, stopViewRadius: 1500,
  coinsStart: 10, coinsPerHour: 1,
  revealRadius: 90, radarRange: 4, hintRadius: 150
}, window.FOTOCAZA_CONFIG || {});

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------------------------------------------------------------- Rarezas
// weight = probabilidad relativa de aparecer (cada una es más rara que la anterior)
// catch = probabilidad base de captura · flee = probabilidad de huir al escaparse del orbe
const RAR = {
  comun:      { label: 'Común',      weight: 50,   catch: 0.85, flee: 0.05, xp: 100 },
  raro:       { label: 'Raro',       weight: 25,   catch: 0.65, flee: 0.10, xp: 200 },
  superraro:  { label: 'Superraro',  weight: 12,   catch: 0.50, flee: 0.14, xp: 350 },
  epico:      { label: 'Épico',      weight: 7,    catch: 0.40, flee: 0.18, xp: 600 },
  legendario: { label: 'Legendario', weight: 3.5,  catch: 0.28, flee: 0.24, xp: 1200 },
  mitico:     { label: 'Mítico',     weight: 1.6,  catch: 0.20, flee: 0.30, xp: 2000 },
  astral:     { label: 'Astral',     weight: 0.7,  catch: 0.13, flee: 0.36, xp: 3500 },
  secreto:    { label: 'Secreto',    weight: 0.2,  catch: 0.08, flee: 0.45, xp: 6000 }
};
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
// Estadísticas para el perfil (en partidas antiguas, las capturas se estiman con lo que hay en el álbum)
save.stats = Object.assign({ captures: Object.values(save.caught).reduce((a, n) => a + n, 0), hatched: 0, fused: 0 }, save.stats);
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
  const total = avail.reduce((s, k) => s + RAR[k].weight, 0);
  let x = r() * total, rar = avail[0];
  for (const k of avail) { x -= RAR[k].weight; if (x <= 0) { rar = k; break; } }
  const pool = creatures.filter(c => c.rarity === rar);
  return pool[Math.floor(r() * pool.length)];
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
        if (!save.gone[id]) out.push({ id, lat, lng, creature });
      }
    }
  return out;
}

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
}

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
  }
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
  const coins = 2 + Math.floor(Math.random() * 3) + (first ? 5 : 0);
  const xp = 50 + (first ? 250 : 0), prevLvl = levelOf(save.xp);
  save.orbs += n; save.coins += coins; save.xp += xp; save.stops[s.id] = Date.now(); save.visited[s.id] = true;
  persist(); updateHud();
  const disc = $('#stopDisc');
  disc.classList.remove('spin'); void disc.offsetWidth; disc.classList.add('spin');
  const g = $('#stopGain');
  g.innerHTML = `+${n} <i class="mini-orb"></i> · +${coins} <i class="coin"></i> · +${xp} XP` +
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
    lat: s.lat, lng: s.lng, nombre: s.nombre };
  persist(); updateHud(); fertUI = null;
  toast(`🌱 Parada abonada. Vuelve en ${h} ${fertUnit()}`);
  updateStopPanel(); refreshStops();
}
function fertSpawn(stopId) {
  const f = save.fert[stopId];
  const creature = creatures.find(c => c.id === f.cid) || creatures.find(c => c.rarity === f.rarity) || creatures[0];
  return { id: 'fert_' + stopId, stopId, fert: true, lat: f.lat + 0.00012, lng: f.lng + 0.00012, creature };
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
      html: `<div class="spawn fert r-${sp.creature.rarity}"><img src="${esc(sp.creature.url)}" alt="" draggable="false"></div>` }) }).addTo(map);
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
        html: `<div class="spawn reveal r-${s.creature.rarity}"><img src="${esc(s.creature.url)}" alt="" draggable="false"></div>` })
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
  renderRadar(rares);
  setStatus(`${save.dev ? '<span class="dev">PRUEBA</span>' : ''}${near && !save.dev ? `✨ ${near} al alcance · ` : ''}👀 ${markers.size} a la vista`);
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
  const key = list.map(s => s.id + ':' + Math.round(s.d / 100)).join('|') + '|' + radarSel;
  if (key === radarKey) return;
  radarKey = key;
  const box = $('#radar');
  box.hidden = !list.length;
  $('#radarList').innerHTML = list.map(s => {
    const c = s.creature, secret = c.rarity === 'secreto' && !known(c);
    return `<button class="radar-item r-${c.rarity} ${s.id === radarSel ? 'on' : ''}" data-id="${esc(s.id)}" title="${esc(RAR[c.rarity].label)}">
      ${secret ? '<i class="radar-q">?</i>' : `<img src="${esc(c.url)}" alt="" draggable="false">`}
      <small>~${Math.max(100, Math.round(s.d / 100) * 100)} m</small></button>`;
  }).join('');
}
$('#radarList').onclick = e => {
  const b = e.target.closest('.radar-item'); if (!b) return;
  if (radarSel === b.dataset.id) { clearRadarSel(); return; }
  const s = radarList.find(x => x.id === b.dataset.id); if (!s) return;
  clearRadarSel();
  radarSel = s.id; b.classList.add('on');
  const c = s.creature, center = hintCenter(s), col = RC[c.rarity];
  const secretIcon = c.rarity === 'secreto' && !known(c);
  radarCircle = L.layerGroup([
    L.circle(center, { radius: CFG.hintRadius, color: col, weight: 4, dashArray: '10 8',
      fillColor: col, fillOpacity: 0.22, interactive: false, className: 'hint-zone' }),
    L.marker(center, { interactive: false, zIndexOffset: 900, icon: L.divIcon({ className: '', iconSize: [56, 56],
      html: `<div class="hint-pin r-${c.rarity}">${secretIcon ? '' : `<img src="${esc(c.url)}" alt="">`}<b>?</b></div>` }) })
  ]).addTo(map);
  follow = false;
  map.fitBounds(L.latLng(center).toBounds(CFG.hintRadius * 2).extend([player.lat, player.lng]),
    { paddingTopLeft: [40, 150], paddingBottomRight: [40, 130], maxZoom: 17 });
  const secret = c.rarity === 'secreto' && !known(c);
  toast(`${secret ? 'Algo secreto' : `${c.name} (${RAR[c.rarity].label})`} anda por esta zona. ¡Acércate para verlo!`, 4000);
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
  target.className = `r-${c.rarity}`; arena.className = `r-${c.rarity}`; ring.style.opacity = ''; ringMax.style.opacity = '';
  target.classList.remove('candied'); $('#candyMenu').hidden = true;
  $('#catchName').innerHTML = `${esc(c.name)} <span class="tag r-${c.rarity}">${RAR[c.rarity].label}</span>
    <small>${esc(c.category || 'Otros')}${spawn.fert ? ' · 🌱 brotada' : ''}</small>`;
  catchEl.hidden = false; cMsg.classList.remove('show'); document.body.classList.add('catching');
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
  if (curve) { bonus *= CURVE_BONUS; label += ' + ¡Curva!'; }
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
    flash(`¡${cs.cr.name} ha huido!`, 1600); sfx.flee();
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
  const gained = R.xp + (isNew ? 500 : 0);
  save.xp += gained;
  removeSpawn(cs.spawn);
  updateHud();
  await sleep(1600); if (cs !== token) return;
  closeCatch();
  showCard(c, { isNew, gained, levelUp: levelOf(save.xp) > prevLvl });
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
}

// ---------------------------------------------------------------- Álbum / modal
const known = c => !!(save.caught[c.id] || save.first[c.id]);
function albumCell(c) {
  const n = save.caught[c.id] || 0, k = known(c);
  // Las secretas ni siquiera muestran la silueta hasta capturarlas
  const pic = !k && c.rarity === 'secreto'
    ? '<div class="mystery">?</div>'
    : `<img src="${esc(c.url)}" loading="lazy" alt="" draggable="false">`;
  return `<button class="cell r-${c.rarity} ${k ? '' : 'unknown'} ${n >= FUSE_N ? 'fusable' : ''}" data-id="${esc(c.id)}" title="${k ? esc(RAR[c.rarity].label) : ''}">
    ${pic}<span>${k ? esc(c.name) : '???'}</span>${k ? `<b>×${n}</b>` : ''}<i class="rdot"></i>${n >= FUSE_N ? '<i class="fuse-badge">🥚</i>' : ''}</button>`;
}
function renderAlbum() {
  const got = list => list.filter(known).length;
  $('#albumCount').textContent = `${got(creatures)} / ${creatures.length}`;
  if (!creatures.length) { $('#albumGrid').innerHTML = '<div class="empty">No hay imágenes todavía.</div>'; return; }
  const groups = new Map();
  for (const c of creatures) {
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(c);
  }
  const cats = [...groups.keys()].sort((a, b) => (a === 'Otros') - (b === 'Otros') || a.localeCompare(b, 'es'));
  const chips = cats.length > 1
    ? `<nav class="chips">${cats.map((cat, i) => `<button class="chip" data-sec="sec${i}">${esc(cat)}</button>`).join('')}</nav>` : '';
  $('#albumGrid').innerHTML = chips + cats.map((cat, i) => {
    const list = groups.get(cat).sort((a, b) =>
      RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name, 'es'));
    return `<section class="album-sec" id="sec${i}">
      <h3 class="album-h"><span>${esc(cat)}</span><span class="tag">${got(list)} / ${list.length}</span></h3>
      <div class="album-grid">${list.map(albumCell).join('')}</div></section>`;
  }).join('');
}
$('#albumGrid').onclick = e => {
  const chip = e.target.closest('.chip');
  if (chip) { document.getElementById(chip.dataset.sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const cell = e.target.closest('.cell'); if (!cell) return;
  const c = creatures.find(x => x.id === cell.dataset.id);
  if (!c) return;
  if (!known(c)) return toast('Aún no has capturado esta criatura.');
  showCard(c, {});
};

function showCard(c, { isNew, gained, levelUp, hatched }) {
  const n = save.caught[c.id] || 0, first = save.first[c.id];
  const card = $('#modalCard');
  card.className = `card r-${c.rarity}`;
  const canFuse = n >= FUSE_N && !gained;
  card.innerHTML = `${hatched ? '<div class="new">¡HA ECLOSIONADO!</div>' : isNew ? '<div class="new">¡NUEVA CRIATURA!</div>' : ''}
    <img src="${esc(c.url)}" alt="">
    <h3>${esc(c.name)}</h3><span class="tag">${RAR[c.rarity].label}</span> <span class="tag cat">${esc(c.category || 'Otros')}</span>
    <div class="stats">${gained ? `+${gained} XP<br>` : ''}${levelUp ? `<b>¡Subes a nivel ${levelOf(save.xp)}!</b><br>` : ''}
    Tienes ${n} ${n === 1 ? 'copia' : 'copias'}${first ? `<br>Primera vez: ${new Date(first).toLocaleDateString('es-ES')}` : ''}</div>
    ${canFuse ? `<button class="btn fuse">🥚 Fusionar ${FUSE_N} en un huevo</button>
      <div class="muted fuse-info">Huevo ${RAR[c.rarity].label.toLowerCase()} de «${esc(c.category || 'Otros')}» · hay que andar ${EGG_KM[c.rarity]} km</div>` :
      n > 0 && !gained ? `<div class="muted fuse-info">Consigue ${FUSE_N} copias para fusionarlas en un huevo (${n}/${FUSE_N}).</div>` : ''}
    <button class="btn ${canFuse ? 'secondary' : ''} ok">Vale</button>`;
  card.querySelector('.ok').onclick = () => { $('#modal').hidden = true; };
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
  save.walked += m / 1000;
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
      <div class="muted">De 5 × ${esc(e.fromName)} · ${e.km} km</div>
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
  showCard(c, { isNew, gained, levelUp: levelOf(save.xp) > prevLvl, hatched: true });
}

// ---------------------------------------------------------------- Paneles y ajustes
$('#btnAlbum').onclick = () => { renderAlbum(); $('#album').hidden = false; };
$('#btnSettings').onclick = () => {
  $('#sourceInfo').textContent = `${sourceName} — ${creatures.length} criaturas`;
  $('#chkDev').checked = save.dev;
  renderAccount();
  $('#chkSound').checked = save.sound;
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
$('#btnReload').onclick = async () => {
  $('#sourceInfo').textContent = 'Cargando…';
  await initCreatures(true);
  $('#sourceInfo').textContent = `${sourceName} — ${creatures.length} criaturas`;
  toast('Imágenes actualizadas');
};
$('#btnReset').onclick = () => {
  if (!confirm('¿Seguro? Se borrarán tus capturas y tu experiencia.')) return;
  save.caught = {}; save.first = {}; save.xp = 0; save.gone = {};
  save.orbs = CFG.orbsStart; save.stops = {}; save.visited = {}; save.coins = CFG.coinsStart; save.fert = {}; save.eggs = []; save.walked = 0; save.items = { super: 0, ultra: 0, candy: 0, gold: 0 }; save.ball = 'orb'; save.stats = { captures: 0, hatched: 0, fused: 0 }; persist(); updateEggBadge();
  updateHud(); refreshSpawns(); refreshStops(); toast('Progreso borrado');
};

async function initCreatures(force) {
  const res = await loadCreatures(force);
  creatures = res.list; sourceName = res.source;
  for (const m of markers.values()) map.removeLayer(m);
  markers.clear();
  refreshSpawns();
}

// ---------------------------------------------------------------- Cuenta con Google y guardado en la nube
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
    if (myProfile) Cloud.saveProfile({ stats: profileStats(), updated: Date.now() }).catch(e => console.warn('perfil', e));
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
    box.innerHTML = `<div><b>Cuenta</b><div class="muted">Inicia sesión para guardar tu partida y seguir en otro móvil.</div>
      <button class="btn google" id="btnLogin"><span class="g-logo">G</span> Iniciar sesión con Google</button></div>`;
    $('#btnLogin').onclick = async () => {
      try { await Cloud.signIn(); }
      catch (e) { console.warn(e); toast('No se pudo iniciar sesión: ' + (e.code || e.message), 5000); }
    };
    return;
  }
  box.innerHTML = `<div class="account"><img class="avatar" alt="" hidden><div class="acc-info"><b class="acc-name"></b>
      <div class="muted" id="cloudState"></div></div></div>
    <button class="btn secondary small" id="btnLogout">Cerrar sesión</button>`;
  box.querySelector('.acc-name').textContent = u.displayName || u.email || 'Tu cuenta';
  if (u.photoURL && /^https:\/\//.test(u.photoURL)) { const img = box.querySelector('.avatar'); img.src = u.photoURL; img.hidden = false; }
  setCloudState(cloudState || 'Conectado');
  const bp = document.createElement('button');
  bp.className = 'btn small'; bp.textContent = '👥 Jugadores'; bp.onclick = openSocial;
  $('#btnLogout').before(bp);
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
const defaultNick = u => ((u.displayName || 'Jugador').trim().split(/\s+/)[0] || 'Jugador').slice(0, NICK_MAX);

function profileStats() {
  const ids = Object.keys(save.first);
  const best = ids.map(creatureById).filter(Boolean)
    .sort((a, b) => RAR_ORDER.indexOf(b.rarity) - RAR_ORDER.indexOf(a.rarity))[0];
  return { level: levelOf(save.xp), xp: save.xp, discovered: ids.length, total: creatures.length,
    captures: save.stats.captures, hatched: save.stats.hatched, fused: save.stats.fused,
    km: Math.round(save.walked * 100) / 100, stops: Object.keys(save.visited).length, best: best ? best.id : null };
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
    </div>
    ${best ? `<div class="pbest">La más rara: <img src="${esc(best.url)}" alt=""> <b>${esc(best.name)}</b> <span class="tag r-${best.rarity}">${RAR[best.rarity].label}</span></div>` : ''}`;
}
function profileCardHtml(p, mine) {
  return `<div class="pcard nested">
    <div class="phead">${avatarHtml(p, 64)}
      <div class="pid"><b class="pnick">${esc(p.nick || 'Jugador')}</b>
        <div class="muted">${p.bio ? esc(p.bio) : mine ? 'Toca «Editar perfil» para poner una frase.' : ''}</div></div></div>
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
  try { profilesCache = await Cloud.loadProfiles(); renderSocial(); }
  catch (e) {
    console.warn(e);
    $('#socialList').innerHTML = `<div class="empty">No se pudieron cargar los perfiles${e.code === 'permission-denied'
      ? ': falta actualizar las reglas de Firebase (mira el README)' : ''}.</div>`;
  }
}
function renderSocial() {
  const box = $('#socialBody');
  if (!cloudEnabled) {
    box.innerHTML = '<div class="empty">Para ver a tus amigos hay que activar las cuentas con Google (Firebase).</div>';
    return;
  }
  if (!signedIn()) {
    box.innerHTML = `<div class="empty">Inicia sesión con Google para tener perfil y ver el de tus amigos.
      <button class="btn google" id="socialLogin"><span class="g-logo">G</span> Iniciar sesión con Google</button></div>`;
    $('#socialLogin').onclick = () => Cloud.signIn().catch(e => toast('No se pudo iniciar sesión: ' + (e.code || e.message), 5000));
    return;
  }
  const me = { ...(myProfile || { nick: defaultNick(Cloud.user), favs: [] }), stats: profileStats() };
  const others = profilesCache.filter(p => p.uid !== Cloud.user.uid);
  const ranking = [{ ...me, uid: Cloud.user.uid, me: true }, ...others]
    .sort((a, b) => (b.stats?.xp || 0) - (a.stats?.xp || 0));
  const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  box.innerHTML = `<div class="sec-h">Tu perfil</div>${profileCardHtml(me, true)}
    <div class="sec-h">Clasificación</div>
    <div id="socialList">${others.length || profilesCache.length ? ranking.map((p, i) => `
      <button class="prow nested ${p.me ? 'me' : ''}" data-uid="${esc(p.uid)}">
        <span class="pos">${medal(i)}</span>${avatarHtml(p, 44)}
        <span class="prow-info"><b>${esc(p.nick || 'Jugador')}${p.me ? ' (tú)' : ''}</b>
          <small>Nivel ${p.stats?.level ?? 1} · ${p.stats?.discovered ?? 0} criaturas · ${p.stats?.xp ?? 0} XP</small></span>
      </button>`).join('') : '<div class="empty">Cuando tus amigos inicien sesión aparecerán aquí.</div>'}</div>`;
  $('#btnEditProfile').onclick = editProfile;
}
$('#socialBody').onclick = e => {
  const row = e.target.closest('.prow'); if (!row) return;
  if (row.classList.contains('me')) { $('.pcard')?.scrollIntoView({ behavior: 'smooth' }); return; }
  const p = profilesCache.find(x => x.uid === row.dataset.uid); if (!p) return;
  const card = $('#modalCard');
  card.className = 'card pmodal';
  card.innerHTML = profileCardHtml(p, false) + '<button class="btn secondary ok">Cerrar</button>';
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
    const btn = card.querySelector('.save'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await Cloud.saveProfile({ nick, bio, favs, stats: profileStats(), updated: Date.now() });
      myProfile = { ...myProfile, nick, bio, favs };
      $('#modal').hidden = true; renderSocial(); toast('Perfil guardado ✓');
    } catch (e) {
      console.warn(e); btn.disabled = false; btn.textContent = 'Guardar';
      toast(e.code === 'permission-denied' ? 'Firebase no deja guardar: actualiza las reglas (README).' : 'No se pudo guardar el perfil.', 5000);
    }
  };
  $('#modal').hidden = false;
}
$('.level').onclick = openSocial;

// ---------------------------------------------------------------- Arranque
updateHud();
updateEggBadge();
setStatus('Cargando imágenes…');
if (window.Cloud) Cloud.init(CFG.firebase, onCloudUser)
  .then(ok => { cloudEnabled = ok; if (!ok) cloudLoading = false; renderAccount(); })
  .catch(e => { console.warn(e); cloudLoading = false; renderAccount(); });
Promise.all([initCreatures(false), loadParadas()]).then(() => {
  startGeo();
  setInterval(refreshSpawns, 20000); // las apariciones se renuevan
  setInterval(refreshStops, 5000);   // recargas de paradas y criaturas brotadas
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
  navigator.serviceWorker.register('sw.js').catch(() => {});

// Para pruebas desde la consola
window.fotocaza = { save, parse: parseCreature, _social: { openSocial, loadMyProfile }, get creatures() { return creatures; }, openCatch, throwOrb: (vx, vy) => cs && throwOrb(vx, vy), get state() { return cs; } };
})();
