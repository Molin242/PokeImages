/* FotoCaza — juego de captura geolocalizado con imágenes de un repositorio de GitHub */
(() => {
'use strict';

const CFG = Object.assign({
  owner: '', repo: '', branch: '', folder: 'imagenes',
  catchRadius: 60, cellSize: 0.0015, cellRange: 2, slotMinutes: 15,
  defaultLocation: [40.4168, -3.7038]
}, window.FOTOCAZA_CONFIG || {});

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------------------------------------------------------------- Rarezas
const RAR = {
  comun:      { label: 'Común',      weight: 60, catch: 0.85, flee: 0.05, xp: 100 },
  raro:       { label: 'Raro',       weight: 25, catch: 0.60, flee: 0.12, xp: 250 },
  epico:      { label: 'Épico',      weight: 12, catch: 0.40, flee: 0.20, xp: 600 },
  legendario: { label: 'Legendario', weight: 3,  catch: 0.20, flee: 0.30, xp: 1500 }
};
const RAR_ORDER = ['comun', 'raro', 'epico', 'legendario'];
const RAR_ALIAS = { comun:'comun', comunes:'comun', raro:'raro', rara:'raro', raros:'raro', raras:'raro',
  epico:'epico', epica:'epico', epicos:'epico', epicas:'epico',
  legendario:'legendario', legendaria:'legendario', legendarios:'legendario', legendarias:'legendario' };
// [amplitud horizontal (fracción de pantalla), velocidad]
const MOVE = { comun: [0.06, 0.7], raro: [0.14, 1.0], epico: [0.22, 1.3], legendario: [0.28, 1.7] };

// ---------------------------------------------------------------- Partida guardada
const SAVE_KEY = 'fotocaza_v1';
let save;
try { save = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch { save = {}; }
save = Object.assign({ caught: {}, first: {}, xp: 0, gone: {}, dev: false, cam: false }, save);
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

function parseCreature(relPath, url) {
  const parts = relPath.split('/');
  const file = parts.pop().normalize('NFC');
  let base = file.replace(IMG_RE, '');
  let rarity = 'comun';
  const m = stripAccents(base.toLowerCase()).match(/[_\- ]([a-z]+)$/);
  if (m && RAR_ALIAS[m[1]]) { rarity = RAR_ALIAS[m[1]]; base = base.slice(0, base.length - m[0].length); }
  else for (const p of parts) { const r = RAR_ALIAS[stripAccents(p.toLowerCase())]; if (r) rarity = r; }
  let name = base.replace(/[_\-]+/g, ' ').trim() || 'Sin nombre';
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return { id: relPath, name, rarity, url };
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
    try { cache = JSON.parse(localStorage.getItem('fotocaza_cache') || 'null'); } catch {}
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
      localStorage.setItem('fotocaza_cache', JSON.stringify({ key, t: Date.now(), list }));
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
  const defs = [['Burbujín','comun','#4fc3f7'],['Musgoso','comun','#81c784'],['Chispín','comun','#ffd54f'],
    ['Rocaldo','comun','#a1887f'],['Nebulina','raro','#9575cd'],['Coralia','raro','#f06292'],
    ['Glaciar','epico','#80deea'],['Magmo','epico','#ff7043'],['Aurora','legendario','#ffca28']];
  return defs.map(([name, rarity, color], i) => ({ id: 'demo/' + name, name, rarity, url: blobSvg(color, i) }));
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
}

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
  if (cs || !player) return;
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
  $('#catchName').innerHTML = `${esc(c.name)} <span class="tag r-${c.rarity}">${RAR[c.rarity].label}</span>`;
  catchEl.hidden = false; $('#catchHint').hidden = false; cMsg.classList.remove('show');
  layout(); resetOrb();
  if (save.cam) startCam();
  cs.raf = requestAnimationFrame(loop);
}

function closeCatch() {
  if (!cs) return;
  cancelAnimationFrame(cs.raf);
  cs = null; drag = null;
  stopCam(); catchEl.hidden = true;
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
  orb.style.transition = ''; orb.style.opacity = '';
  orbIn.className = 'orb-inner';
  btnRun.disabled = false;
  setOrb(cs.rest.x, cs.rest.y);
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
  if (Math.random() < RAR[cs.cr.rarity].flee + cs.throws * 0.02) {
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
}

// ---------------------------------------------------------------- Álbum / modal
function renderAlbum() {
  const sorted = [...creatures].sort((a, b) =>
    RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
  $('#albumCount').textContent = `${creatures.filter(c => save.caught[c.id]).length} / ${creatures.length}`;
  $('#albumGrid').innerHTML = sorted.length ? sorted.map(c => {
    const n = save.caught[c.id] || 0;
    return `<button class="cell r-${c.rarity} ${n ? '' : 'unknown'}" data-id="${esc(c.id)}">
      <img src="${esc(c.url)}" loading="lazy" alt="" draggable="false"><span>${n ? esc(c.name) : '???'}</span>${n ? `<b>×${n}</b>` : ''}</button>`;
  }).join('') : '<div class="empty">No hay imágenes todavía.</div>';
}
$('#albumGrid').onclick = e => {
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
    <h3>${esc(c.name)}</h3><span class="tag">${RAR[c.rarity].label}</span>
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
  refreshSpawns();
};
$('#btnReload').onclick = async () => {
  $('#sourceInfo').textContent = 'Cargando…';
  await initCreatures(true);
  $('#sourceInfo').textContent = `${sourceName} — ${creatures.length} criaturas`;
  toast('Imágenes actualizadas');
};
$('#btnReset').onclick = () => {
  if (!confirm('¿Seguro? Se borrarán tus capturas y tu experiencia.')) return;
  save.caught = {}; save.first = {}; save.xp = 0; save.gone = {}; persist();
  updateHud(); refreshSpawns(); toast('Progreso borrado');
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
initCreatures(false).then(() => {
  startGeo();
  setInterval(refreshSpawns, 20000); // las apariciones rotan cada pocos minutos
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
  navigator.serviceWorker.register('sw.js').catch(() => {});

// Para pruebas desde la consola
window.fotocaza = { save, get creatures() { return creatures; }, openCatch, throwOrb: (vx, vy) => cs && throwOrb(vx, vy), get state() { return cs; } };
})();
