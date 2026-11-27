/* Cuentas con Google y guardado en la nube (Firebase Authentication + Firestore).
   Solo se activa si config.js tiene la configuración de Firebase. Cada jugador guarda su partida
   en jugadores/{uid}; las reglas de seguridad impiden leer o escribir la de otro. */
window.Cloud = (() => {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  let auth = null, db = null, user = null;

  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });

  async function init(cfg, onUser) {
    if (!cfg || !cfg.apiKey || !cfg.projectId) return false;
    await loadScript(SDK + 'firebase-app-compat.js');
    await Promise.all([loadScript(SDK + 'firebase-auth-compat.js'), loadScript(SDK + 'firebase-firestore-compat.js')]);
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    auth.languageCode = 'es';
    db = firebase.firestore();
    auth.onAuthStateChanged(u => { user = u; onUser(u); });
    return true;
  }

  // ---- Cuentas con usuario y contraseña ----
  // Firebase necesita un "correo": se usa uno interno hecho con el nombre de usuario (no es un correo real).
  // Como Firebase no deja repetir correos, cada nombre de usuario es único.
  const DOMINIO = '@jugadores.fotocaza.app';
  const USER_RE = /^[a-z0-9_.]{3,20}$/;
  const normUser = u => String(u || '').trim().toLowerCase();
  const validUser = u => USER_RE.test(normUser(u)) && !/^[._]|[._]$|\.\./.test(normUser(u));
  const userOf = u => (u && (u.displayName || (u.email || '').replace(DOMINIO, ''))) || '';

  async function register(name, pass) {
    const n = normUser(name);
    if (!validUser(n)) throw { code: 'fc/usuario-invalido' };
    const cred = await auth.createUserWithEmailAndPassword(n + DOMINIO, pass);
    await cred.user.updateProfile({ displayName: n });
    return cred.user;
  }
  async function login(name, pass) {
    const n = normUser(name);
    if (!validUser(n)) throw { code: 'fc/usuario-invalido' };
    return (await auth.signInWithEmailAndPassword(n + DOMINIO, pass)).user;
  }
  async function changePassword(oldPass, newPass) {
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, oldPass);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(newPass);
  }
  // Mensajes de error en español
  function errorText(e) {
    const c = (e && e.code) || '';
    return ({
      'fc/usuario-invalido': 'El usuario debe tener de 3 a 20 letras (a-z), números, puntos o guiones bajos.',
      'auth/email-already-in-use': 'Ese nombre de usuario ya está cogido. Prueba otro.',
      'auth/weak-password': 'La contraseña es muy corta: mínimo 6 caracteres.',
      'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
      'auth/wrong-password': 'Usuario o contraseña incorrectos.',
      'auth/user-not-found': 'Usuario o contraseña incorrectos.',
      'auth/invalid-login-credentials': 'Usuario o contraseña incorrectos.',
      'auth/too-many-requests': 'Demasiados intentos. Espera un poco y vuelve a probar.',
      'auth/network-request-failed': 'Sin conexión a internet.',
      'auth/operation-not-allowed': 'Falta activar «Correo electrónico/contraseña» en Firebase (mira el README).',
      'auth/requires-recent-login': 'Por seguridad, cierra sesión y vuelve a entrar antes de cambiar la contraseña.'
    })[c] || ('No se pudo: ' + (c || (e && e.message) || 'error desconocido'));
  }

  const signOut = () => auth.signOut();
  const ref = () => db.collection('jugadores').doc(user.uid);

  async function load() {
    const d = await ref().get();
    if (!d.exists) return null;
    try { return JSON.parse(d.data().partida); } catch { return null; }
  }
  async function save(data) {
    await ref().set({ partida: JSON.stringify(data), guardado: data.savedAt || Date.now(), version: 1 });
  }

  // Perfiles públicos (solo para quien haya iniciado sesión)
  const pref = uid => db.collection('perfiles').doc(uid || user.uid);
  async function loadProfile(uid) { const d = await pref(uid).get(); return d.exists ? d.data() : null; }
  async function saveProfile(data) { await pref().set(data, { merge: true }); }
  async function loadProfiles() {
    const q = await db.collection('perfiles').limit(100).get();
    return q.docs.map(d => ({ uid: d.id, ...d.data() }));
  }

  // ---- Funciones comunes para lo social (avisos, actividad, regalos, reacciones, intercambios) ----
  // Todo lo que se crea lleva el autor (from) y la hora (t); las reglas de Firebase comprueban el autor.
  const col = name => db.collection(name);
  async function add(name, data) { return (await col(name).add({ ...data, from: user.uid, t: Date.now() })).id; }
  async function put(name, id, data) { await col(name).doc(id).set({ ...data, from: user.uid, t: Date.now() }); }
  async function patch(name, id, data) { await col(name).doc(id).update(data); }
  async function remove(name, id) { await col(name).doc(id).delete(); }
  const docs = q => q.docs.map(d => ({ id: d.id, ...d.data() }));
  // Lo más reciente de una colección (desde una hora dada)
  async function recent(name, since = 0, limit = 60) {
    return docs(await col(name).where('t', '>=', since).orderBy('t', 'desc').limit(limit).get());
  }
  // Lo que va dirigido a mí (regalos, intercambios…)
  async function forMe(name, limit = 60) { return docs(await col(name).where('to', '==', user.uid).limit(limit).get()); }
  async function fromMe(name, limit = 60) { return docs(await col(name).where('from', '==', user.uid).limit(limit).get()); }
  async function where(name, field, value, limit = 100) { return docs(await col(name).where(field, '==', value).limit(limit).get()); }

  return { init, register, login, changePassword, errorText, validUser, normUser, userOf, signOut, load, save, loadProfile, saveProfile, loadProfiles, add, put, patch, remove, recent, forMe, fromMe, where, get user() { return user; }, get ready() { return !!auth; } };
})();
