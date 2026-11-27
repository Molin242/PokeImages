/* FotoCaza — editor de criaturas (para usar desde el ordenador).
   Lee las imágenes del repositorio y imagenes/criaturas.json, deja editar nombre, rareza, familia, etiquetas
   y descripción, añadir criaturas nuevas y descargar un ZIP listo para subir a GitHub. */
(() => {
'use strict';

const CFG = Object.assign({ owner: '', repo: '', branch: '', folder: 'imagenes' }, window.FOTOCAZA_CONFIG || {});
const FOLDER = (CFG.folder || '').replace(/^\/+|\/+$/g, '');
const PREFIX = FOLDER ? FOLDER + '/' : '';
const DRAFT = 'fotocaza_criaturas_borrador';
const MAX_PX = 600;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

let toastT;
function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- Rarezas (igual que en el juego)
const RAR = { comun: 'Común', raro: 'Raro', superraro: 'Superraro', epico: 'Épico', legendario: 'Legendario',
  mitico: 'Mítico', astral: 'Astral', secreto: 'Secreto' };
const RAR_ORDER = Object.keys(RAR);
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
const rarKey = s => RAR_ALIAS[stripAccents(String(s).toLowerCase()).replace(/[\s_\-]+/g, '')] || null;
const pretty = s => { s = s.replace(/[_\-]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

// Lo que dice el nombre del archivo (misma regla que el juego)
function parse(relPath) {
  const parts = relPath.split('/');
  const file = parts.pop().normalize('NFC');
  let base = file.replace(IMG_RE, ''), rarity = null, category = null, folder = null;
  for (const re of [/[_\- ]([^_\- ]+[_\- ][^_\- ]+)$/, /[_\- ]([^_\- ]+)$/]) {
    const m = base.match(re);
    if (m && rarKey(m[1])) { rarity = rarKey(m[1]); base = base.slice(0, base.length - m[0].length); break; }
  }
  for (const p of parts) {
    const r = rarKey(p);
    if (r) { if (!rarity) rarity = r; }
    else if (!category) { category = pretty(p.normalize('NFC')); folder = p; }
  }
  return { name: pretty(base) || 'Sin nombre', rarity: rarity || 'comun', category: category || 'Otros', folder: folder || '' };
}

// ---------------------------------------------------------------- Cargar criaturas y criaturas.json
function detectRepo() {
  let { owner, repo } = CFG;
  if ((!owner || !repo) && location.hostname.endsWith('.github.io')) {
    owner = owner || location.hostname.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    repo = repo || (seg && !seg.includes('.') ? seg : `${owner}.github.io`);
  }
  return owner && repo ? { owner, repo } : null;
}
async function loadList() {
  const src = detectRepo();
  if (src) {
    const api = `https://api.github.com/repos/${src.owner}/${src.repo}`;
    let branch = CFG.branch;
    if (!branch) {
      const r = await fetch(api);
      if (!r.ok) throw new Error(r.status === 404 ? 'repositorio no encontrado o privado' : `GitHub ${r.status}`);
      branch = (await r.json()).default_branch;
    }
    const r = await fetch(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    if (!r.ok) throw new Error(r.status === 403 ? 'límite de GitHub alcanzado, prueba en un rato' : `GitHub ${r.status}`);
    const data = await r.json();
    return { source: `GitHub · ${src.owner}/${src.repo}`, list: data.tree
      .filter(n => n.type === 'blob' && n.path.startsWith(PREFIX) && IMG_RE.test(n.path))
      .map(n => ({ id: n.path.slice(PREFIX.length),
        url: `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${encodeURIComponent(branch)}/${n.path.split('/').map(encodeURIComponent).join('/')}` })) };
  }
  try { // Sin GitHub (probando en el ordenador): imagenes/lista.json
    const r = await fetch(`${PREFIX}lista.json`, { cache: 'no-store' });
    if (r.ok) return { source: `Local · ${PREFIX}lista.json`, list: (await r.json()).map(p => ({ id: p, url: PREFIX + p.split('/').map(encodeURIComponent).join('/') })) };
  } catch {}
  return { source: 'Sin repositorio: abre el editor desde tu web de GitHub Pages para ver tus criaturas', list: [] };
}
async function loadMeta() {
  const src = detectRepo(), file = PREFIX + 'criaturas.json', urls = [file];
  if (src) urls.push(`https://raw.githubusercontent.com/${src.owner}/${src.repo}/HEAD/${file.split('/').map(encodeURIComponent).join('/')}`);
  for (const u of urls) {
    try { const r = await fetch(u + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch {}
  }
  return {};
}

// ---------------------------------------------------------------- Estado
let base = [];          // criaturas del repositorio: { id, url, parsed }
let meta = {};          // criaturas.json tal y como está ahora en el editor
let metaOrig = {};      // criaturas.json tal y como está publicado
let news = [];          // criaturas nuevas: { key, dataUrl, nombre, rareza, categoria, etiquetas, descripcion }
let sel = null;         // { type: 'base'|'new', id }
let dirty = false;

const clean = m => {
  const o = {};
  if (m.nombre) o.nombre = m.nombre;
  if (m.rareza) o.rareza = m.rareza;
  if (m.categoria) o.categoria = m.categoria;
  if (m.etiquetas && m.etiquetas.length) o.etiquetas = m.etiquetas;
  if (m.descripcion) o.descripcion = m.descripcion;
  return o;
};
// Criatura tal y como la verá el juego
function eff(b) {
  const m = meta[b.id] || {};
  return { name: m.nombre || b.parsed.name, rarity: RAR[m.rareza] ? m.rareza : b.parsed.rarity,
    category: m.categoria || b.parsed.category, tags: m.etiquetas || [], desc: m.descripcion || '' };
}
// Carpeta de cada familia que ya existe (para guardar ahí las nuevas)
function folderFor(cat) {
  const hit = base.find(b => eff(b).category === cat && b.parsed.folder) || base.find(b => b.parsed.category === cat && b.parsed.folder);
  return hit ? hit.parsed.folder : cat.replace(/[\/\\:*?"<>|]+/g, '').trim();
}
const fileSafe = s => s.normalize('NFC').replace(/[\/\\:*?"<>|#%{}^~\[\]`]+/g, '').trim().replace(/\s+/g, '_') || 'criatura';
// Ruta que tendrá una criatura nueva (carpeta de su familia + nombre + rareza)
function allNewPaths() { // se reparten en orden para que nunca se repita un nombre
  const used = new Set(base.map(b => b.id)), out = new Map();
  for (const n of news) {
    const folder = folderFor(n.categoria || 'Otros');
    const suffix = n.rareza && n.rareza !== 'comun' ? '_' + n.rareza : '';
    let name = fileSafe(n.nombre || 'criatura'), path, i = 1;
    do { path = `${folder ? folder + '/' : ''}${name}${i > 1 ? '_' + i : ''}${suffix}.png`; i++; } while (used.has(path));
    used.add(path); out.set(n.key, path);
  }
  return out;
}
const newPath = n => allNewPaths().get(n.key);

function changes() {
  const edited = Object.keys({ ...meta, ...metaOrig }).filter(id =>
    base.some(b => b.id === id) && JSON.stringify(clean(meta[id] || {})) !== JSON.stringify(clean(metaOrig[id] || {}))).length;
  return { edited, added: news.length };
}
function markDirty() {
  dirty = true;
  try {
    localStorage.setItem(DRAFT, JSON.stringify({ meta, news }));
  } catch { toast('⚠ Las imágenes nuevas ocupan mucho para guardar el borrador: descarga los cambios pronto.', 5000); }
  updatePending();
}
function updatePending() {
  const { edited, added } = changes();
  $('#pending').textContent = edited || added
    ? `● ${added} nueva${added === 1 ? '' : 's'} · ${edited} editada${edited === 1 ? '' : 's'} (sin descargar)` : 'Sin cambios';
}
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- Lista
function allItems() {
  const items = base.map(b => ({ type: 'base', id: b.id, url: b.url, ...eff(b),
    modified: JSON.stringify(clean(meta[b.id] || {})) !== JSON.stringify(clean(metaOrig[b.id] || {})) }));
  for (const n of news) items.push({ type: 'new', id: n.key, url: n.dataUrl, name: n.nombre || 'Sin nombre',
    rarity: n.rareza || 'comun', category: n.categoria || 'Otros', tags: n.etiquetas || [], desc: n.descripcion || '' });
  return items;
}
function renderList() {
  const q = stripAccents($('#q').value.trim().toLowerCase()), fr = $('#fRar').value;
  const norm = t => stripAccents(String(t).toLowerCase());
  const items = allItems().filter(it => (!fr || it.rarity === fr) &&
    (!q || norm(it.name).includes(q) || norm(it.category).includes(q) || it.tags.some(t => norm(t).includes(q))));
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.category)) groups.set(it.category, []); groups.get(it.category).push(it); }
  const cats = [...groups.keys()].sort((a, b) => (a === 'Otros') - (b === 'Otros') || a.localeCompare(b, 'es'));
  $('#list').innerHTML = cats.length ? cats.map(cat => `<div class="fam">${esc(cat)} <span class="tag">${groups.get(cat).length}</span></div>
    <div class="grid">${groups.get(cat).sort((a, b) => RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name, 'es'))
      .map(it => `<div class="it r-${it.rarity} ${sel && sel.id === it.id ? 'sel' : ''}" data-type="${it.type}" data-id="${esc(it.id)}">
        ${it.type === 'new' ? '<span class="flag">NUEVA</span>' : it.modified ? '<span class="flag mod">EDITADA</span>' : ''}
        <img src="${esc(it.url)}" alt="" loading="lazy"><b>${esc(it.name)}</b>
        <span class="tag r-${it.rarity}">${RAR[it.rarity]}</span>
        ${it.tags.length ? `<span class="mini-etq">${it.tags.map(t => '#' + esc(t)).join(' ')}</span>` : ''}</div>`).join('')}</div>`).join('')
    : '<div class="empty">No hay criaturas que coincidan. Pulsa <b>Añadir criatura</b> para subir una.</div>';
  // sugerencias de familias y etiquetas
  const all = allItems();
  $('#cats').innerHTML = [...new Set(all.map(i => i.category))].sort().map(c => `<option value="${esc(c)}">`).join('');
  $('#tagList').innerHTML = [...new Set(all.flatMap(i => i.tags))].sort().map(t => `<option value="${esc(t)}">`).join('');
}
$('#list').onclick = e => {
  const el = e.target.closest('.it'); if (!el) return;
  select({ type: el.dataset.type, id: el.dataset.id });
};
$('#q').oninput = renderList;
$('#fRar').onchange = renderList;

// ---------------------------------------------------------------- Formulario
let curTags = [];
function current() {
  if (!sel) return null;
  if (sel.type === 'new') return news.find(n => n.key === sel.id) || null;
  return base.find(b => b.id === sel.id) || null;
}
function select(s) {
  sel = s;
  const c = current();
  $('#form').hidden = !c; $('#fHint').hidden = !!c;
  if (!c) { $('#fTitle').textContent = 'Elige una criatura'; renderList(); return; }
  const isNew = sel.type === 'new';
  const v = isNew ? { name: c.nombre, rarity: c.rareza, category: c.categoria, tags: c.etiquetas, desc: c.descripcion } : eff(c);
  $('#fTitle').textContent = isNew ? 'Criatura nueva' : 'Editar criatura';
  $('#fName').value = v.name || ''; $('#fRarity').value = v.rarity || 'comun';
  $('#fCat').value = v.category || ''; $('#fDesc').value = v.desc || '';
  curTags = [...(v.tags || [])]; paintTags();
  const img = isNew ? c.dataUrl : c.url;
  $('#dropImg').hidden = !img; if (img) $('#dropImg').src = img; $('#dropTxt').hidden = !!img;
  $('#drop').style.cursor = isNew ? 'pointer' : 'default';
  $('#btnRemove').hidden = !isNew;
  $('#btnReset').hidden = isNew;
  showPath();
  renderList();
}
function showPath() {
  const c = current(); if (!c) return;
  $('#fPath').innerHTML = sel.type === 'new'
    ? `Se guardará como <b>${esc(PREFIX + newPath(c))}</b>`
    : `Archivo: <b>${esc(PREFIX + c.id)}</b><br>El archivo no cambia de nombre: los datos nuevos van a <code>criaturas.json</code>, así nadie pierde sus capturas.`;
}
function paintTags() {
  const box = $('#tagsBox'), input = $('#fTag');
  box.querySelectorAll('.chip-e').forEach(x => x.remove());
  for (const t of curTags) {
    const s = document.createElement('span'); s.className = 'chip-e';
    s.append('#' + t);
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '×'; b.title = 'Quitar';
    b.onclick = () => { curTags = curTags.filter(x => x !== t); paintTags(); save(); };
    s.append(b); box.insertBefore(s, input);
  }
}
function addTag(raw) {
  const t = raw.replace(/^#/, '').trim().toLowerCase().slice(0, 24);
  if (!t || curTags.includes(t)) return;
  if (curTags.length >= 12) { toast('Máximo 12 etiquetas'); return; }
  curTags.push(t); paintTags(); save();
}
$('#fTag').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(e.target.value); e.target.value = ''; }
  else if (e.key === 'Backspace' && !e.target.value && curTags.length) { curTags.pop(); paintTags(); save(); }
});
$('#fTag').addEventListener('change', e => { if (e.target.value) { addTag(e.target.value); e.target.value = ''; } });

// Guardar lo escrito en el formulario
function save() {
  const c = current(); if (!c) return;
  const v = { nombre: $('#fName').value.trim(), rareza: $('#fRarity').value, categoria: $('#fCat').value.trim(),
    etiquetas: [...curTags], descripcion: $('#fDesc').value.trim() };
  if (sel.type === 'new') Object.assign(c, v);
  else {
    // Solo se guarda lo que cambia respecto al nombre del archivo
    const p = c.parsed, m = {};
    if (v.nombre && v.nombre !== p.name) m.nombre = v.nombre;
    if (v.rareza !== p.rarity) m.rareza = v.rareza;
    if (v.categoria && v.categoria !== p.category) m.categoria = v.categoria;
    if (v.etiquetas.length) m.etiquetas = v.etiquetas;
    if (v.descripcion) m.descripcion = v.descripcion;
    if (Object.keys(m).length) meta[c.id] = m; else delete meta[c.id];
  }
  showPath(); renderList(); markDirty();
}
['#fName', '#fCat', '#fDesc'].forEach(id => { $(id).oninput = save; });
$('#fRarity').onchange = save;

$('#btnReset').onclick = () => {
  const c = current(); if (!c || sel.type !== 'base') return;
  if (metaOrig[c.id]) meta[c.id] = JSON.parse(JSON.stringify(metaOrig[c.id])); else delete meta[c.id];
  select(sel); markDirty(); toast('Cambios deshechos');
};
$('#btnRemove').onclick = () => {
  const c = current(); if (!c || sel.type !== 'new') return;
  if (!confirm(`¿Quitar «${c.nombre || 'criatura nueva'}»?`)) return;
  news = news.filter(n => n !== c); select(null); markDirty();
};

// ---------------------------------------------------------------- Criaturas nuevas (imagen)
function resizeToPng(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, MAX_PX / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      res(cv.toDataURL('image/png'));            // PNG: conserva la transparencia
    };
    img.onerror = () => rej(new Error('Ese archivo no es una imagen válida'));
    img.src = URL.createObjectURL(file);
  });
}
async function useFile(file) {
  if (!file) return;
  try {
    const dataUrl = await resizeToPng(file);
    if (sel && sel.type === 'new') {
      const c = current(); c.dataUrl = dataUrl;
      if (!c.nombre) c.nombre = pretty(file.name.replace(IMG_RE, '').replace(/[_\-]+/g, ' '));
      select(sel); markDirty();
    } else {
      const nombre = pretty(file.name.replace(IMG_RE, ''));
      const p = parse(file.name);  // si el archivo ya trae rareza en el nombre, se aprovecha
      const n = { key: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), dataUrl,
        nombre: p.name || nombre, rareza: p.rarity, categoria: ($('#q').value && allItems().some(i => i.category === $('#q').value)) ? $('#q').value : (allItems()[0]?.category || 'Otros'),
        etiquetas: [], descripcion: '' };
      news.push(n); select({ type: 'new', id: n.key }); markDirty();
      toast('Imagen añadida: revisa nombre, rareza y familia');
    }
  } catch (e) { toast(e.message); }
}
$('#btnNew').onclick = () => { sel = null; $('#file').click(); };
$('#drop').onclick = () => { if (!sel || sel.type === 'new') $('#file').click(); };
$('#file').onchange = e => { useFile(e.target.files[0]); e.target.value = ''; };
const drop = $('#drop');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (!sel || sel.type === 'new') useFile(e.dataTransfer.files[0]); };
// También se pueden soltar imágenes en cualquier parte de la página para crear criaturas nuevas
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  if (e.target.closest('#drop')) return;
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
  (async () => { for (const f of files) { sel = null; await useFile(f); } })();
});

// ---------------------------------------------------------------- ZIP (sin librerías)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) { // files: [{ name, data: Uint8Array }] — sin comprimir (las PNG ya van comprimidas)
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    central.push(c.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
  e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
const dataUrlBytes = u => Uint8Array.from(atob(u.split(',')[1]), ch => ch.charCodeAt(0));

function buildExport() {
  const out = {};
  for (const [id, m] of Object.entries(meta)) if (base.some(b => b.id === id)) { const c = clean(m); if (Object.keys(c).length) out[id] = c; }
  const files = [];
  for (const n of news) {
    if (!n.dataUrl) continue;
    const path = newPath(n);
    const p = parse(path), c = clean({
      nombre: n.nombre && n.nombre !== p.name ? n.nombre : '',
      rareza: n.rareza !== p.rarity ? n.rareza : '',
      categoria: n.categoria && n.categoria !== p.category ? n.categoria : '',
      etiquetas: n.etiquetas, descripcion: n.descripcion });
    if (Object.keys(c).length) out[path] = c;
    files.push({ name: PREFIX + path, data: dataUrlBytes(n.dataUrl) });
  }
  const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
  files.unshift({ name: PREFIX + 'criaturas.json', data: new TextEncoder().encode(JSON.stringify(sorted, null, 1) + '\n') });
  return files;
}
$('#btnZip').onclick = () => {
  const { edited, added } = changes();
  if (!edited && !added && !confirm('No hay cambios. ¿Descargar igualmente criaturas.json?')) return;
  const blob = makeZip(buildExport());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'fotocaza-criaturas.zip';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  dirty = false; updatePending();
  toast('ZIP descargado. Descomprímelo y sube la carpeta «imagenes» a GitHub.', 5000);
};

// ---------------------------------------------------------------- Arranque
$('#fRarity').innerHTML = RAR_ORDER.map(k => `<option value="${k}">${RAR[k]}</option>`).join('');
$('#fRar').innerHTML += RAR_ORDER.map(k => `<option value="${k}">${RAR[k]}</option>`).join('');
(async () => {
  let res;
  try { res = await loadList(); } catch (e) { res = { source: 'No se pudo leer el repositorio: ' + e.message, list: [] }; }
  $('#src').textContent = `${res.source} — ${res.list.length} criaturas`;
  base = res.list.map(x => ({ ...x, parsed: parse(x.id) }));
  metaOrig = await loadMeta();
  meta = JSON.parse(JSON.stringify(metaOrig));
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch {}
  if (draft && ((draft.news || []).length || JSON.stringify(draft.meta || {}) !== JSON.stringify(metaOrig))) {
    meta = draft.meta || meta; news = draft.news || [];
    const b = $('#banner'); b.hidden = false;
    b.innerHTML = 'Has recuperado los cambios que no habías descargado. <button id="discard">Descartarlos</button>';
    $('#discard').onclick = () => {
      if (!confirm('Se perderán esos cambios. ¿Seguir?')) return;
      localStorage.removeItem(DRAFT); meta = JSON.parse(JSON.stringify(metaOrig)); news = [];
      dirty = false; b.hidden = true; select(null); updatePending();
    };
  }
  renderList(); updatePending();
})();

// Para pruebas desde la consola
window.criaturasEditor = { buildExport, makeZip, get state() { return { base, meta, news, sel }; } };
})();
