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
    auth.getRedirectResult().catch(e => console.warn('Inicio de sesión (redirección):', e));
    auth.onAuthStateChanged(u => { user = u; onUser(u); });
    return true;
  }

  async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      // En algunas apps instaladas o navegadores las ventanas emergentes no funcionan: se usa redirección
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code))
        return auth.signInWithRedirect(provider);
      if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) return;
      throw e;
    }
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

  return { init, signIn, signOut, load, save, loadProfile, saveProfile, loadProfiles, get user() { return user; }, get ready() { return !!auth; } };
})();
