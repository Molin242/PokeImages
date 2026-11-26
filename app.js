/* FotoCaza — juego de captura geolocalizado con imágenes de un repositorio de GitHub */
(() => {
'use strict';

const CFG = Object.assign({
  owner: '', repo: '', branch: '', folder: 'imagenes',
  catchRadius: 60, cellSize: 0.0015, cellRange: 2, slotMinutes: 15,
  defaultLocation: [40.4168, -3.7038],
  orbsStart: 30, orbsMax: 100, stopCooldownMin: 5, autoParadas: true, stopViewRadius: 1500,
  coinsStart: 10, coinsPerHour: 1
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
  orbs: CFG.orbsStart, stops: {}, visited: {}, coins: CFG.coinsStart, fert: {} }, save);
for (const k in save.gone) if (Date.now() - save.gone[k] > 864e5) delete save.gone[k];
const persist = () => localStorage.setItem(SAVE_KEY, JSON.stringify(save));

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

function computeSpawns(pos) {
  if (!creatures.length) return [];
  const cs = CFG.cellSize, cx0 = Math.floor(pos.lat / cs), cy0 = Math.floor(pos.lng / cs);
  const slot = Math.floor(Date.now() / (CFG.slotMinutes * 60e3)), out = [];
  for (let dx = -CFG.cellRange; dx <= CFG.cellRange; dx++)
    for (let dy = -CFG.cellRange; dy <= CFG.cellRange; dy++) {
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
  const near = s => distM(player, s) <= CFG.stopViewRadius;
  const custom = customStops.filter(near);
  let auto = [];
  if (autoStops) auto = OSM.enCeldas(OSM.celdasAlrededor(player.lat, player.lng))
    .filter(s => near(s) && !hiddenStops.has(s.id) && customStops.every(c => OSM.metros(c, s) > 40));
  return custom.concat(auto);
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
  for (const [id, m] of fertMarkers) if (!save.fert[id] || save.fert[id].ready > now) { map.removeLayer(m); fertMarkers.delete(id); }
  if (!creatures.length) return;
  for (const id in save.fert) {
    const f = save.fert[id];
    if (f.ready > now || fertMarkers.has(id)) continue;
    if (!f.notified) { f.notified = true; persist(); toast(`✨ ¡Ha brotado algo en ${f.nombre}!`, 4500); }
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

function refreshSpawns() {
  if (!player) return;
  const spawns = computeSpawns(player), ids = new Set(spawns.map(s => s.id));
  for (const [id, m] of markers) if (!ids.has(id)) { map.removeLayer(m); markers.delete(id); }
  for (const s of spawns) if (!markers.has(s.id)) {
    const m = L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', iconSize: [58, 58], iconAnchor: [29, 54],
        html: `<div class="spawn r-${s.creature.rarity}"><img src="${esc(s.creature.url)}" alt="" draggable="false"></div>` })
    }).addTo(map);
    m.spawn = s;
    m.on('click', () => tryEncounter(s));
    markers.set(s.id, m);
  }
  let near = 0;
  for (const m of markers.values()) {
    const isNear = save.dev || distM(player, m.spawn) <= CFG.catchRadius;
    if (isNear) near++;
    m.getElement()?.firstElementChild?.classList.toggle('near', isNear && !save.dev);
  }
  setStatus(`${save.dev ? '<span class="dev">PRUEBA</span>' : ''}${near && !save.dev ? `✨ ${near} al alcance · ` : ''}${markers.size} cerca`);
}

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
    if (!manualPos) setPlayer(p.coords.latitude, p.coords.longitude);
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
const catchEl = $('#catch'), target = $('#target'), cImg = $('#creatureImg'), ring = $('#ring');
const orb = $('#orb'), orbIn = orb.firstElementChild, cMsg = $('#catchMsg'), cam = $('#cam'), btnRun = $('#btnRun');
const FR = 38; // fotogramas hasta que el orbe llega a la criatura
let cs = null, drag = null, camStream = null;

function openCatch(spawn) {
  const c = spawn.creature;
  cs = { spawn, cr: c, phase: 'aim', t0: performance.now(), throws: 0, last: 0, ringS: 1 };
  cImg.src = c.url; cImg.className = '';
  target.className = `r-${c.rarity}`; ring.style.opacity = '';
  $('#catchName').innerHTML = `${esc(c.name)} <span class="tag r-${c.rarity}">${RAR[c.rarity].label}</span>
    <small>${esc(c.category || 'Otros')}</small>`;
  catchEl.hidden = false; cMsg.classList.remove("show"); document.body.classList.add("catching");
  const hint = $('#catchHint');
  hint.hidden = false; hint.innerHTML = 'Desliza el orbe hacia arriba para lanzarlo.<br>¡Acierta cuando el anillo sea pequeño!';
  layout(); resetOrb();
  if (save.cam) startCam();
  cs.raf = requestAnimationFrame(loop);
}

function closeCatch() {
  if (!cs) return;
  cancelAnimationFrame(cs.raf);
  cs = null; drag = null;
  stopCam(); catchEl.hidden = true; document.body.classList.remove("catching");
  refreshSpawns();
}

function layout() {
  if (!cs) return;
  cs.W = catchEl.clientWidth; cs.H = catchEl.clientHeight;
  cs.size = Math.min(cs.W * 0.55, cs.H * 0.32, 280);
  target.style.width = target.style.height = cs.size + 'px';
  cs.rest = { x: cs.W / 2, y: cs.H - 110 };
  if (cs.phase === 'aim' && !drag) setOrb(cs.rest.x, cs.rest.y);
}
addEventListener('resize', layout);

function setOrb(x, y, s = 1, rot = 0) {
  cs.ox = x; cs.oy = y;
  orb.style.transform = `translate(${x}px,${y}px) scale(${s}) rotate(${rot}deg)`;
}
function resetOrb() {
  if (!cs) return;
  cs.phase = 'aim'; cs.fl = null;
  orb.style.transition = ''; orb.style.opacity = save.orbs > 0 ? '' : '0.25';
  orbIn.className = 'orb-inner';
  btnRun.disabled = false;
  setOrb(cs.rest.x, cs.rest.y);
  $('#orbLeft').textContent = `◉ ×${save.orbs}`;
  if (save.orbs <= 0) {
    const h = $('#catchHint');
    h.hidden = false; h.innerHTML = '<b>¡No te quedan orbes!</b><br>Visita una parada del mapa para recargar.';
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
    const [amp, spd] = MOVE[cs.cr.rarity], t = (now - cs.t0) / 1000;
    cs.cx = cs.W / 2 + (Math.sin(t * spd) + 0.3 * Math.sin(t * spd * 2.3)) * amp * cs.W;
    cs.cy = cs.H * 0.42 + Math.sin(t * 2.1) * 8;
    target.style.transform = `translate(${cs.cx - cs.size / 2}px,${cs.cy - cs.size / 2}px)`;
    const P = 2200, ph = ((now - cs.t0) % P) / P;
    cs.ringS = 1 - 0.72 * ph;
    ring.style.transform = `scale(${cs.ringS})`;
  }
  if (cs.phase === 'flying') stepFlight(k);
  if (cs) cs.raf = requestAnimationFrame(loop);
}

function throwOrb(vxms, vyms) {
  // vxms / vyms: velocidad del dedo en px/ms. Dirección = hacia dónde va. Fuerza = si llega o se pasa.
  const x0 = cs.ox, y0 = cs.oy, g = cs.H * 0.0009;
  const dy = cs.cy - y0;                                  // negativo (hacia arriba)
  const vyNeed = (dy - 0.5 * g * FR * FR) / FR;           // velocidad exacta para llegar
  const power = clamp(-vyms / 2, 0.45, 1.8);              // ~2 px/ms = lanzamiento perfecto
  const vy = vyNeed * (0.7 + 0.3 * power);
  const vx = clamp((vxms / -vyms) * (-dy) / FR, -30, 30);
  cs.fl = { x: x0, y: y0, vx, vy, g, f: 0, rot: 0, checked: false };
  cs.phase = 'flying';
  save.orbs = Math.max(0, save.orbs - 1); persist(); updateHud();
  $('#orbLeft').textContent = `◉ ×${save.orbs}`;
  $('#catchHint').hidden = true;
}

function stepFlight(k) {
  const f = cs.fl;
  f.x += f.vx * k; f.y += f.vy * k; f.vy += f.g * k; f.f += k; f.rot += (12 + f.vx) * k;
  setOrb(f.x, f.y, 1 - 0.5 * Math.min(1, f.f / FR), f.rot);
  if (!f.checked && f.f >= FR) {
    f.checked = true;
    if (Math.hypot(f.x - cs.cx, f.y - cs.cy) < cs.size * 0.45) { cs.phase = 'capture'; onHit(); return; }
  }
  const out = f.y > cs.H + 80 || f.y < -120 || f.x < -80 || f.x > cs.W + 80;
  if ((f.checked && f.f > FR + 30) || out) { cs.throws++; flash('¡Fallaste!'); resetOrb(); }
}

async function onHit() {
  const token = cs, q = cs.ringS;
  let bonus = 1, label = '¡Bien!';
  if (q < 0.45) { bonus = 1.8; label = '¡Excelente!'; } else if (q < 0.7) { bonus = 1.4; label = '¡Genial!'; }
  btnRun.disabled = true;
  flash(label);
  ring.style.opacity = '0'; cImg.className = 'absorb';
  setOrb(cs.cx, cs.cy, 0.5);
  await sleep(450); if (cs !== token) return;
  orb.style.transition = 'transform .4s cubic-bezier(.5,0,.75,1.5)';
  setOrb(cs.cx, cs.cy + cs.size * 0.38, 0.5);
  await sleep(500); if (cs !== token) return;
  orb.style.transition = '';
  const p = Math.min(0.97, RAR[cs.cr.rarity].catch * bonus), perShake = Math.pow(p, 1 / 3);
  for (let i = 0; i < 3; i++) {
    orbIn.classList.remove('shake'); void orbIn.offsetWidth; orbIn.classList.add('shake');
    await sleep(1000); if (cs !== token) return;
    if (Math.random() > perShake) return breakOut(token);
  }
  success(token);
}

async function breakOut(token) {
  orbIn.className = 'orb-inner burst';
  cImg.className = ''; ring.style.opacity = '';
  flash('¡Se ha escapado del orbe!');
  cs.throws++;
  await sleep(900); if (cs !== token) return;
  if (!cs.spawn.fert && Math.random() < RAR[cs.cr.rarity].flee + cs.throws * 0.02) { // las brotadas no huyen
    cs.phase = 'done'; cImg.className = 'flee'; orb.style.opacity = '0'; ring.style.opacity = '0';
    flash(`¡${cs.cr.name} ha huido!`, 1600);
    removeSpawn(cs.spawn);
    await sleep(1700); if (cs === token) closeCatch();
    return;
  }
  resetOrb();
}

async function success(token) {
  cs.phase = 'done';
  orbIn.className = 'orb-inner caught';
  flash('¡Capturado!', 1400);
  const c = cs.cr, R = RAR[c.rarity], isNew = !save.caught[c.id], prevLvl = levelOf(save.xp);
  save.caught[c.id] = (save.caught[c.id] || 0) + 1;
  if (isNew) save.first[c.id] = Date.now();
  const gained = R.xp + (isNew ? 500 : 0);
  save.xp += gained;
  removeSpawn(cs.spawn);
  updateHud();
  await sleep(1400); if (cs !== token) return;
  closeCatch();
  showCard(c, { isNew, gained, levelUp: levelOf(save.xp) > prevLvl });
}

// Arrastrar y lanzar el orbe
orb.addEventListener('pointerdown', e => {
  if (!cs || cs.phase !== 'aim') return;
  e.preventDefault();
  if (save.orbs <= 0) { flash('¡Sin orbes!'); return; }
  orb.setPointerCapture(e.pointerId);
  drag = { s: [{ x: e.clientX, y: e.clientY, t: performance.now() }], dx: e.clientX - cs.ox, dy: e.clientY - cs.oy };
});
orb.addEventListener('pointermove', e => {
  if (!drag || !cs) return;
  const t = performance.now();
  drag.s.push({ x: e.clientX, y: e.clientY, t });
  while (drag.s.length > 2 && t - drag.s[0].t > 90) drag.s.shift();
  setOrb(e.clientX - drag.dx, e.clientY - drag.dy);
});
orb.addEventListener('pointerup', e => {
  if (!drag || !cs) return;
  const t = performance.now();
  drag.s.push({ x: e.clientX, y: e.clientY, t });
  while (drag.s.length > 2 && t - drag.s[0].t > 90) drag.s.shift();
  const a = drag.s[0], b = drag.s[drag.s.length - 1], dt = Math.max(1, b.t - a.t);
  drag = null;
  const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
  if (vy < -0.5) throwOrb(vx, vy); else resetOrb();
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
function albumCell(c) {
  const n = save.caught[c.id] || 0;
  // Las secretas ni siquiera muestran la silueta hasta capturarlas
  const pic = !n && c.rarity === 'secreto'
    ? '<div class="mystery">?</div>'
    : `<img src="${esc(c.url)}" loading="lazy" alt="" draggable="false">`;
  return `<button class="cell r-${c.rarity} ${n ? '' : 'unknown'}" data-id="${esc(c.id)}" title="${n ? esc(RAR[c.rarity].label) : ''}">
    ${pic}<span>${n ? esc(c.name) : '???'}</span>${n ? `<b>×${n}</b>` : ''}<i class="rdot"></i></button>`;
}
function renderAlbum() {
  const got = list => list.filter(c => save.caught[c.id]).length;
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
  if (!save.caught[c.id]) return toast('Aún no has capturado esta criatura.');
  showCard(c, {});
};

function showCard(c, { isNew, gained, levelUp }) {
  const n = save.caught[c.id] || 0, first = save.first[c.id];
  const card = $('#modalCard');
  card.className = `card r-${c.rarity}`;
  card.innerHTML = `${isNew ? '<div class="new">¡NUEVA CRIATURA!</div>' : ''}
    <img src="${esc(c.url)}" alt="">
    <h3>${esc(c.name)}</h3><span class="tag">${RAR[c.rarity].label}</span> <span class="tag cat">${esc(c.category || 'Otros')}</span>
    <div class="stats">${gained ? `+${gained} XP<br>` : ''}${levelUp ? `<b>¡Subes a nivel ${levelOf(save.xp)}!</b><br>` : ''}
    Capturada ${n} ${n === 1 ? 'vez' : 'veces'}${first ? `<br>Primera vez: ${new Date(first).toLocaleDateString('es-ES')}` : ''}</div>
    <button class="btn">Vale</button>`;
  card.querySelector('.btn').onclick = () => { $('#modal').hidden = true; };
  $('#modal').hidden = false;
}

// ---------------------------------------------------------------- Paneles y ajustes
$('#btnAlbum').onclick = () => { renderAlbum(); $('#album').hidden = false; };
$('#btnSettings').onclick = () => {
  $('#sourceInfo').textContent = `${sourceName} — ${creatures.length} criaturas`;
  $('#chkDev').checked = save.dev;
  $('#folderName').textContent = CFG.folder || '(raíz)';
  $('#settings').hidden = false;
};
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { $('#' + b.dataset.close).hidden = true; });
$('#chkDev').onchange = e => {
  save.dev = e.target.checked; persist();
  if (!save.dev && manualPos) { manualPos = false; toast('Volviendo a tu ubicación GPS…'); }
  refreshSpawns(); refreshStops();
};
$('#btnReload').onclick = async () => {
  $('#sourceInfo').textContent = 'Cargando…';
  await initCreatures(true);
  $('#sourceInfo').textContent = `${sourceName} — ${creatures.length} criaturas`;
  toast('Imágenes actualizadas');
};
$('#btnReset').onclick = () => {
  if (!confirm('¿Seguro? Se borrarán tus capturas y tu experiencia.')) return;
  save.caught = {}; save.first = {}; save.xp = 0; save.gone = {};
  save.orbs = CFG.orbsStart; save.stops = {}; save.visited = {}; save.coins = CFG.coinsStart; save.fert = {}; persist();
  updateHud(); refreshSpawns(); refreshStops(); toast('Progreso borrado');
};

async function initCreatures(force) {
  const res = await loadCreatures(force);
  creatures = res.list; sourceName = res.source;
  for (const m of markers.values()) map.removeLayer(m);
  markers.clear();
  refreshSpawns();
}

// ---------------------------------------------------------------- Arranque
updateHud();
setStatus('Cargando imágenes…');
Promise.all([initCreatures(false), loadParadas()]).then(() => {
  startGeo();
  setInterval(refreshSpawns, 20000); // las apariciones se renuevan
  setInterval(refreshStops, 5000);   // recargas de paradas y criaturas brotadas
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
  navigator.serviceWorker.register('sw.js').catch(() => {});

// Para pruebas desde la consola
window.fotocaza = { save, parse: parseCreature, get creatures() { return creatures; }, openCatch, throwOrb: (vx, vy) => cs && throwOrb(vx, vy), get state() { return cs; } };
})();
