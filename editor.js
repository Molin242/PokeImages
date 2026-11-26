/* FotoCaza — editor de paradas (para usar desde el ordenador) */
(() => {
'use strict';

const CFG = Object.assign({ defaultLocation: [40.4168, -3.7038], autoParadas: true }, window.FOTOCAZA_CONFIG || {});
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DRAFT = 'fotocaza_editor_borrador';

let state = { auto: CFG.autoParadas !== false, ocultas: new Set(), paradas: [] };
let selected = null, dirty = false, popupClosedAt = 0;
const markers = new Map(), autoMarkers = new Map();

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
const newId = () => 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------- Datos
function fromData(d) {
  d = d || {};
  const arr = Array.isArray(d) ? d : (d.paradas || []);
  return {
    auto: Array.isArray(d) ? true : d.auto !== false,
    ocultas: new Set(Array.isArray(d) ? [] : (d.ocultas || [])),
    paradas: arr.filter(p => isFinite(p.lat) && isFinite(p.lng)).map(p => ({
      id: String(p.id || newId()), nombre: p.nombre || '', descripcion: p.descripcion || '',
      lat: +p.lat, lng: +p.lng, foto: p.foto || '' }))
  };
}
function toData() {
  return {
    auto: state.auto,
    ocultas: [...state.ocultas],
    paradas: state.paradas.map(p => ({ id: p.id, nombre: p.nombre.trim() || 'Parada sin nombre',
      descripcion: p.descripcion.trim(), lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), foto: p.foto }))
  };
}
function markDirty() {
  dirty = true;
  try { localStorage.setItem(DRAFT, JSON.stringify(toData())); }
  catch { toast('⚠ Las fotos ocupan mucho para guardar el borrador: descarga el archivo pronto.', 5000); }
  updateDirty();
}
function updateDirty() {
  $('#dirty').textContent = dirty ? '● Tienes cambios sin descargar' : '';
}
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- Mapa
const map = L.map('map', { zoomControl: false }).setView(CFG.defaultLocation, 16);
L.control.zoom({ position: 'topright' }).addTo(map);
// El panel flota sobre el mapa: dejar sitio a la izquierda al encuadrar
const panelPad = () => innerWidth > 800 ? [410, 30] : [30, 30];
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

function stopIcon(p) {
  return L.divIcon({ className: '', iconSize: [44, 66], iconAnchor: [22, 64],
    html: `<div class="stop ${p === selected ? 'sel' : ''}"><div class="disc">${p.foto
      ? `<img src="${esc(p.foto)}" alt="" onerror="this.remove()">` : ''}<span>★</span></div><div class="pole"></div></div>` });
}
function addMarker(p) {
  const m = L.marker([p.lat, p.lng], { icon: stopIcon(p), draggable: true, zIndexOffset: 500, title: p.nombre }).addTo(map);
  m.on('click', () => select(p));
  m.on('dragstart', () => select(p));
  m.on('dragend', () => {
    const ll = m.getLatLng(); p.lat = ll.lat; p.lng = ll.lng;
    if (selected === p) showCoords();
    markDirty(); refreshAuto();
  });
  markers.set(p.id, m);
}
const refreshIcon = p => markers.get(p.id)?.setIcon(stopIcon(p));

map.on('popupclose', () => { popupClosedAt = Date.now(); });
map.on('click', e => {
  if (Date.now() - popupClosedAt < 300) return; // el clic solo cerraba un globo
  const p = { id: newId(), nombre: '', descripcion: '', lat: e.latlng.lat, lng: e.latlng.lng, foto: '' };
  state.paradas.push(p);
  addMarker(p); select(p); markDirty();
  $('#fNombre').focus();
});
map.on('moveend', () => refreshAuto());

// ---------------------------------------------------------------- Selección y formulario
function select(p) {
  const prev = selected;
  selected = p;
  if (prev && prev !== p) refreshIcon(prev);
  if (p) refreshIcon(p);
  renderList();
  $('#form').hidden = !p;
  if (!p) return;
  $('#fNombre').value = p.nombre;
  $('#fDesc').value = p.descripcion;
  $('#fFotoUrl').value = p.foto.startsWith('data:') ? '' : p.foto;
  showPhoto(); showCoords();
}
function showCoords() {
  $('#fCoords').textContent = `📍 ${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`;
}
function showPhoto() {
  const img = $('#fPhotoImg'), has = !!selected?.foto;
  img.hidden = !has; $('#fPhotoTxt').hidden = has;
  if (has) img.src = selected.foto; else img.removeAttribute('src');
}
function setFoto(url) {
  if (!selected) return;
  selected.foto = url;
  showPhoto(); refreshIcon(selected); renderList(); markDirty();
}

$('#fNombre').oninput = e => { if (!selected) return; selected.nombre = e.target.value; renderList(); markDirty(); };
$('#fDesc').oninput = e => { if (!selected) return; selected.descripcion = e.target.value; markDirty(); };
$('#fFotoUrl').onchange = e => setFoto(e.target.value.trim());
$('#fQuitarFoto').onclick = () => { $('#fFotoUrl').value = ''; setFoto(''); };
$('#fBorrar').onclick = () => {
  if (!selected) return;
  if (!confirm(`¿Borrar la parada "${selected.nombre || 'sin nombre'}"?`)) return;
  const p = selected;
  map.removeLayer(markers.get(p.id)); markers.delete(p.id);
  state.paradas = state.paradas.filter(x => x !== p);
  select(null); markDirty(); refreshAuto();
};
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) select(null);
});

// Fotos: se reducen a 800 px y se guardan dentro del propio paradas.json
function fileToDataURL(file, max = 800) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => rej(new Error('No es una imagen válida'));
    img.src = URL.createObjectURL(file);
  });
}
async function usePhotoFile(file) {
  if (!file || !selected) return;
  try { $('#fFotoUrl').value = ''; setFoto(await fileToDataURL(file)); }
  catch (e) { toast(e.message); }
}
const box = $('#photoBox');
box.onclick = () => $('#fFile').click();
$('#fFile').onchange = e => { usePhotoFile(e.target.files[0]); e.target.value = ''; };
box.ondragover = e => { e.preventDefault(); box.classList.add('over'); };
box.ondragleave = () => box.classList.remove('over');
box.ondrop = e => { e.preventDefault(); box.classList.remove('over'); usePhotoFile(e.dataTransfer.files[0]); };
addEventListener('paste', e => {
  const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
  if (f && selected) { e.preventDefault(); usePhotoFile(f); }
});

// ---------------------------------------------------------------- Lista
function renderList() {
  $('#count').textContent = state.paradas.length;
  $('#list').innerHTML = state.paradas.length ? state.paradas.map(p =>
    `<button class="ed-item ${p === selected ? 'sel' : ''}" data-id="${esc(p.id)}">
      <span class="th">${p.foto ? `<img src="${esc(p.foto)}" alt="" onerror="this.remove()">` : '★'}</span>
      <span class="nm">${esc(p.nombre || 'Parada sin nombre')}</span></button>`).join('')
    : '<div class="muted">Aún no hay paradas. Haz clic en el mapa para crear la primera.</div>';
}
$('#list').onclick = e => {
  const b = e.target.closest('.ed-item'); if (!b) return;
  const p = state.paradas.find(x => x.id === b.dataset.id); if (!p) return;
  select(p);
  // centrar la parada en la parte del mapa que no tapa el panel
  const z = Math.max(map.getZoom(), 17), off = innerWidth > 800 ? panelPad()[0] / 2 : 0;
  const pt = map.project([p.lat, p.lng], z).subtract([off, 0]);
  map.flyTo(map.unproject(pt, z), z, { duration: 0.6 });
};

// ---------------------------------------------------------------- Paradas automáticas (OpenStreetMap)
function autoHtml(s) {
  return `<div class="auto-stop ${state.ocultas.has(s.id) ? 'off' : ''}">${s.foto
    ? `<img src="${esc(s.foto)}" alt="" onerror="this.remove()">` : ''}★</div>`;
}
function autoPopup(s) {
  const off = state.ocultas.has(s.id);
  return `<div class="ed-pop">${s.foto ? `<img src="${esc(s.foto)}" alt="" onerror="this.remove()">` : ''}
    <b>${esc(s.nombre)}</b><div class="muted">${esc(s.descripcion)} · automática</div>
    ${off ? '<div class="off-txt">Oculta: no saldrá en el juego</div>' : ''}
    <button data-act="own" data-id="${esc(s.id)}">✏️ Hacerla mía (editable)</button>
    <button data-act="toggle" data-id="${esc(s.id)}">${off ? '👁 Volver a mostrar' : '🚫 Ocultar del juego'}</button></div>`;
}
function clearAuto() { for (const m of autoMarkers.values()) map.removeLayer(m); autoMarkers.clear(); }

function refreshAuto() {
  const status = $('#autoStatus');
  if (!state.auto) { clearAuto(); status.textContent = 'Desactivadas: en el juego solo saldrán tus paradas.'; return; }
  if (map.getZoom() < 15) { clearAuto(); status.textContent = 'Acerca más el mapa para ver las paradas automáticas.'; return; }
  const b = map.getBounds();
  const cells = OSM.celdasEnCaja(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
  if (cells.length > 16) { clearAuto(); status.textContent = 'Acerca más el mapa para ver las paradas automáticas.'; return; }
  OSM.asegurar(cells, refreshAuto, (h, t) => { if (h < t) status.textContent = `Buscando sitios chulos… ${h}/${t}`; });
  const list = OSM.enCeldas(cells).filter(s => state.paradas.every(c => OSM.metros(c, s) > 40));
  const ids = new Set(list.map(s => s.id));
  for (const [id, m] of autoMarkers) if (!ids.has(id)) { map.removeLayer(m); autoMarkers.delete(id); }
  for (const s of list) {
    let m = autoMarkers.get(s.id);
    if (!m) {
      m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', iconSize: [28, 28], html: autoHtml(s) }), title: s.nombre });
      m.stop = s;
      m.bindPopup(() => autoPopup(m.stop));
      m.addTo(map);
      autoMarkers.set(s.id, m);
    } else m.getElement()?.firstElementChild?.classList.toggle('off', state.ocultas.has(s.id));
  }
  const hidden = list.filter(s => state.ocultas.has(s.id)).length;
  status.textContent = `${list.length} sitios automáticos en esta zona (en gris)${hidden ? `, ${hidden} ocultos` : ''}.`;
}

map.on('popupopen', e => {
  e.popup.getElement().onclick = ev => {
    const btn = ev.target.closest('button[data-act]'); if (!btn) return;
    const s = autoMarkers.get(btn.dataset.id)?.stop; if (!s) return;
    map.closePopup();
    if (btn.dataset.act === 'toggle') {
      state.ocultas.has(s.id) ? state.ocultas.delete(s.id) : state.ocultas.add(s.id);
      markDirty(); refreshAuto();
    } else {
      const p = { id: newId(), nombre: s.nombre, descripcion: s.descripcion, lat: s.lat, lng: s.lng, foto: s.foto };
      state.ocultas.add(s.id);
      state.paradas.push(p); addMarker(p); select(p); markDirty(); refreshAuto();
    }
  };
});
$('#chkAuto').onchange = e => { state.auto = e.target.checked; markDirty(); refreshAuto(); };

// ---------------------------------------------------------------- Buscar sitio
$('#search').onsubmit = async e => {
  e.preventDefault();
  const q = $('#q').value.trim(); if (!q) return;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(q)}`);
    const d = await r.json();
    if (!d.length) return toast('No he encontrado ese sitio');
    map.setView([+d[0].lat, +d[0].lon], 17);
  } catch { toast('No se pudo buscar ahora mismo'); }
};

// ---------------------------------------------------------------- Abrir / descargar
function renderAll(fit) {
  for (const m of markers.values()) map.removeLayer(m);
  markers.clear(); clearAuto();
  selected = null;
  state.paradas.forEach(addMarker);
  $('#chkAuto').checked = state.auto;
  select(null);
  if (fit && state.paradas.length)
    map.fitBounds(L.latLngBounds(state.paradas.map(p => [p.lat, p.lng])).pad(0.1),
      { maxZoom: 17, paddingTopLeft: panelPad(), paddingBottomRight: [30, 30] });
  refreshAuto();
}

$('#btnDownload').onclick = () => {
  const blob = new Blob([JSON.stringify(toData(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'paradas.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  dirty = false; updateDirty();
  toast('Descargado. Ahora súbelo a tu repositorio (Add file → Upload files).', 4500);
};
$('#btnOpen').onclick = () => $('#openFile').click();
$('#openFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { state = fromData(JSON.parse(await f.text())); renderAll(true); markDirty(); toast(`Abierto: ${state.paradas.length} paradas`); }
  catch { toast('Ese archivo no es un paradas.json válido'); }
};

function banner(html) { const b = $('#banner'); b.innerHTML = html; b.hidden = !html; }

async function loadFromRepo() {
  try {
    const r = await fetch('paradas.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

async function init() {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch {}
  if (draft) {
    state = fromData(draft);
    banner('Has recuperado tu último trabajo en este ordenador.<br><button id="discard">Descartarlo y cargar el paradas.json publicado</button>');
    $('#discard').onclick = async () => {
      if (!confirm('Se perderán los cambios que no hayas subido. ¿Seguir?')) return;
      localStorage.removeItem(DRAFT);
      const d = await loadFromRepo();
      state = fromData(d); dirty = false; updateDirty(); banner(''); renderAll(true);
    };
  } else {
    const d = await loadFromRepo();
    if (!d) banner('No se encontró <code>paradas.json</code> (pasa si abres el archivo con doble clic en vez de desde la web). Empiezas con el mapa vacío.');
    state = fromData(d);
  }
  renderAll(true);
  updateDirty();
}
init();
})();
