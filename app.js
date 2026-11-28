/* മദ്രസ ദൈനംദിന ട്രാക്കർ — offline-first PWA
   Data: IndexedDB (local) ⇄ Firebase Realtime Database (REST, when online) */
(function () {
  "use strict";

  /* =====================================================================
     1. CONFIG & CONSTANTS
     ===================================================================== */
  const CFG = {
    DB: "https://cv-daily-track-default-rtdb.asia-southeast1.firebasedatabase.app",
    ROOT: "madrasa-v2", // new namespace (old single-blob data under /cv-daily-track is left untouched)
    // ---- Firebase Authentication (fill these three; see README) ----
    API_KEY: "AIzaSyCOEAVkxIu_P5lwi0eNOhEZstA_tOraqPU",          // Project settings → General → Web API Key
    ADMIN_EMAIL: "cvhakeem313@gmail.com",  // the admin's Firebase Auth e-mail
    ADMIN_UID: "uxAj1ihB1eUoQdUs0T3Xt3dIr073",      // Authentication → Users → User UID
    IDB: "madrasa-tracker",
    SYNC_DEBOUNCE: 1500
  };

  const PRAYERS = [
    { id: "subh", label: "സുബ്ഹ്" },
    { id: "zuhur", label: "ളുഹ്ർ" },
    { id: "asr", label: "അസ്വർ" },
    { id: "maghrib", label: "മഗ്രിബ്" },
    { id: "isha", label: "ഇശാ" }
  ];

  // Rawatib rak'ah choices — never 1 or 3
  const RAWATIB = [
    { id: "subh_before", label: "സുബ്ഹ് മുമ്പ് (സുന്നത്ത്)", choices: [0, 2] },
    { id: "zuhur_before", label: "ളുഹ്ർ മുമ്പ് (സുന്നത്ത്)", choices: [0, 2, 4] },
    { id: "zuhur_after", label: "ളുഹ്ർ ശേഷം (സുന്നത്ത്)", choices: [0, 2, 4] },
    { id: "asr_before", label: "അസ്വർ മുമ്പ് (സുന്നത്ത്)", choices: [0, 2, 4] },
    { id: "maghrib_after", label: "മഗ്രിബ് ശേഷം (സുന്നത്ത്)", choices: [0, 2] },
    { id: "isha_before", label: "ഇശാ മുമ്പ് (സുന്നത്ത്)", choices: [0, 2] },
    { id: "isha_after", label: "ഇശാ ശേഷം (സുന്നത്ത്)", choices: [0, 2] }
  ];

  // Internal point weights (never shown next to individual items)
  const W = {
    qada: 5, missed: 0, prayed: 35, jamaah: 60,
    witr: 20, duha: 20, tahajjud: 25, rawatibPerTwo: 10,
    haddad: 20, istighfar100: 15, salawat100: 15,
    quranClassDone: 25, surahMulk: 20, surahWaqiah: 20,
    fridayKahf: 25, fridaySalawat: 20, fridayNails: 15,
    mobile: { none: 20, under30: 15, "30to60": 5, over60: 0 },
    book: { 0: 0, 15: 10, 30: 20, 45: 30 }
  };

  const CLASSES = ["ക്ലാസ്സ് 1", "ക്ലാസ്സ് 2", "ക്ലാസ്സ് 3", "ക്ലാസ്സ് 4", "ക്ലാസ്സ് 5", "ക്ലാസ്സ് 6", "ക്ലാസ്സ് 7", "ക്ലാസ്സ് 8", "ക്ലാസ്സ് 9", "ക്ലാസ്സ് 10", "പ്ലസ് വൺ", "പ്ലസ് ടു"];
  const MONTHS = ["ജനുവരി", "ഫെബ്രുവരി", "മാർച്ച്", "ഏപ്രിൽ", "മേയ്", "ജൂൺ", "ജൂലൈ", "ഓഗസ്റ്റ്", "സെപ്റ്റംബർ", "ഒക്ടോബർ", "നവംബർ", "ഡിസംബർ"];
  const WEEKDAYS = ["ഞായർ", "തിങ്കൾ", "ചൊവ്വ", "ബുധൻ", "വ്യാഴം", "വെള്ളി", "ശനി"];
  const FONT = '"Noto Sans Malayalam","Noto Sans","Manjari","Meera","Nirmala UI","Kartika",system-ui,sans-serif';

  /* =====================================================================
     2. SMALL HELPERS
     ===================================================================== */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function normName(s) {
    return String(s || "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  }
  function cleanName(s) {
    return String(s || "").normalize("NFC").trim().replace(/\s+/g, " ");
  }
  function cyrb53(str, seed) {
    seed = seed || 0;
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function parseIso(iso) {
    const p = String(iso || "").split("-").map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }
  function isFriday(iso) { return parseIso(iso).getDay() === 5; }
  function fmtDate(iso) {
    const d = parseIso(iso);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() + ", " + WEEKDAYS[d.getDay()];
  }
  function fmtDateShort(iso) {
    const d = parseIso(iso);
    return d.getDate() + " " + MONTHS[d.getMonth()];
  }
  function fmtMonth(key) {
    const p = String(key).split("-").map(Number);
    return MONTHS[(p[1] || 1) - 1] + " " + p[0];
  }
  function segments(s) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter("ml", { granularity: "grapheme" }).segment(s), (x) => x.segment);
    }
    return Array.from(s);
  }
  function initial(name) {
    const g = segments(String(name || "?").trim());
    return g[0] || "?";
  }
  function setDeep(obj, path, val) {
    const keys = path.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!o[keys[i]] || typeof o[keys[i]] !== "object") o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = val;
  }

  const ICON = (() => {
    const p = {
      trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
      download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
      bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>',
      bellOff: '<path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M18 14.7c.6-1.8.9-4 .9-6.7a6 6 0 0 0-9.7-4.7M10 21a2 2 0 0 0 4 0M2 2l20 20"/>',
      list: '<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
      school: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
      sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
      shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
      edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
      crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z"/>',
      logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
      file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"/>'
    };
    const out = {};
    Object.keys(p).forEach((k) => {
      out[k] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p[k] + "</svg>";
    });
    return out;
  })();

  /* =====================================================================
     3. STATE & LOCAL PERSISTENCE (IndexedDB)
     ===================================================================== */
  function defaultState() {
    return {
      v: 2,
      madrasas: {},
      ustads: {},
      students: {}, // students[mid][sid]
      records: {}, // records[mid][sid][date]
      board: {}, // board[mid][sid][date] = {s: score, updatedAt} — public leaderboard numbers only
      hasPin: {}, // hasPin[mid][sid] = true (staff view)
      auth: null, // {idToken, refreshToken, exp, uid} for admin / ustad
      dirty: {}, // { "records/m/s/date": 1 } — waiting to be pushed
      session: null, // {role, userId, mid, name, cls}
      ui: { tab: "tracker", date: todayIso(), lbScope: "day", lbDate: todayIso(), lbMonth: todayIso().slice(0, 7), cls: "all", mid: "all" },
      reminder: true,
      lastRemind: "",
      lastSync: 0
    };
  }

  let state = defaultState();
  let persistTimer = null;
  let dbPromise = null;

  function idb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error("no idb"));
        const req = indexedDB.open(CFG.IDB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore("kv");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  async function idbGet(key) {
    const db = await withTimeout(idb(), 2500);
    return new Promise((resolve, reject) => {
      const r = db.transaction("kv", "readonly").objectStore("kv").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, val) {
    const db = await withTimeout(idb(), 2500);
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  let loadOk = true, idbErr = "", idbSkip = false;
  const lsOnly = () => { try { return localStorage.getItem("mt_lsonly") === "1"; } catch (e) { return false; } };
  async function loadState() {
    const base = defaultState();
    // IndexedDB + localStorage രണ്ടിലും സേവ് ചെയ്യുന്നു; വായിക്കാൻ 3 തവണ ശ്രമിക്കും; പുതിയ കോപ്പി എടുക്കും
    let a = { ok: false };
    for (let i = 0; i < 3 && !a.ok && !lsOnly(); i++) {
      try { a = { ok: true, v: await withTimeout(idbGet("state"), 5000) }; } catch (e) { idbErr = String((e && (e.name || e.message)) || e); dbPromise = null; await new Promise((r) => setTimeout(r, 400)); }
    }
    let b = null;
    try { const raw = localStorage.getItem("mt_state_v2"); if (raw) b = JSON.parse(raw); } catch (e) { /* ignore */ }
    const ta = a.ok && a.v && typeof a.v === "object" ? (a.v.savedAt || 1) : 0;
    const tb = b && typeof b === "object" ? (b.savedAt || 1) : 0;
    let saved = ta || tb ? (ta >= tb ? a.v : b) : null;
    if (!a.ok) idbSkip = true; // IndexedDB തകരാറിലാണെങ്കിൽ മുന്നറിയിപ്പില്ലാതെ localStorage ഉപയോഗിക്കും // വായിക്കാൻ കഴിഞ്ഞില്ല: ശൂന്യമായ ഡാറ്റ കൊണ്ട് മുകളിലെഴുതില്ല
    if (saved && typeof saved === "object") {
      state = Object.assign(base, saved);
      state.ui = Object.assign(base.ui, saved.ui || {});
      ["madrasas", "ustads", "students", "records", "board", "hasPin", "dirty"].forEach((k) => { if (!state[k] || typeof state[k] !== "object") state[k] = base[k]; });
    }
    // സേവ് ചെയ്ത ഡാറ്റയിൽ ലോഗിൻ ഇല്ലെങ്കിൽ പ്രത്യേക കോപ്പിയിൽ നിന്ന് തിരിച്ചെടുക്കും
    if (!state.session) {
      try { const mr = JSON.parse(localStorage.getItem("mt_sess") || "null"); if (mr && mr.session && mr.session.role) { state.session = mr.session; state.auth = mr.auth || null; } } catch (e) { /* ignore */ }
    }
    ["m_seed1", "m_seed2"].forEach((k) => { if (state.madrasas[k] && !state.madrasas[k].updatedAt) delete state.madrasas[k]; });
    if (state.ustads.u_seed1 && !state.ustads.u_seed1.updatedAt) delete state.ustads.u_seed1;
    // Always open on today's date
    state.ui.date = todayIso();
    state.ui.lbDate = todayIso();
    state.ui.lbMonth = todayIso().slice(0, 7);
  }

  const clearMirror = () => { try { localStorage.removeItem("mt_sess"); } catch (e) { /* ignore */ } };
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 250);
  }
  async function persistNow() {
    clearTimeout(persistTimer);
    if (!loadOk) return;
    // ലോഗിൻ വിവരം പ്രത്യേകം ഒരു ചെറിയ കോപ്പിയായും സൂക്ഷിക്കുന്നു (ലോഗൗട്ട് ബട്ടൺ അമർത്തുന്നത് വരെ)
    try { if (state.session) localStorage.setItem("mt_sess", JSON.stringify({ session: state.session, auth: state.auth })); else localStorage.removeItem("mt_sess"); } catch (e) { /* ignore */ }
    state.savedAt = Date.now();
    try { localStorage.setItem("mt_state_v2", JSON.stringify(state)); } catch (e) { /* storage full */ }
    if (lsOnly() || idbSkip) return;
    try { await withTimeout(idbSet("state", JSON.parse(JSON.stringify(state))), 4000); } catch (e) { /* localStorage copy remains */ }
  }

  /* =====================================================================
     4. DATA ACCESS (registry, records, scoring)
     ===================================================================== */
  const liveMadrasas = () => Object.values(state.madrasas).filter((m) => !m.deleted).sort((a, b) => a.name.localeCompare(b.name, "ml"));
  const getMadrasa = (id) => state.madrasas[id] || null;
  const liveMadrasa = (id) => { const m = state.madrasas[id]; return m && !m.deleted ? m : null; };
  // Per-madrasa tracker setup by the ustad: hide built-in sections, add own tick items
  const SECS = { dhikr: "ദിക്ർ & ഔറാദ്", quran: "ഖുർആൻ & സൂറത്തുകൾ", habits: "ദൈനംദിന ശീലങ്ങൾ" };
  // Notice from the ustad to every student of the madrasa
  const noticeOf = (mid) => { const m = mid ? liveMadrasa(mid) : null; return m && m.notice && m.notice.text ? m.notice : null; };
  function noticeBanner(mid) {
    const n = noticeOf(mid); if (!n) return "";
    return '<section class="notice"><div class="nh">📢 അറിയിപ്പ്' + (n.by ? " • " + esc(n.by) : "") + (n.at ? '<span>' + esc(fmtDateShort(todayIsoOf(n.at))) + "</span>" : "") + '</div><div class="nt">' + esc(n.text) + "</div></section>";
  }
  const todayIsoOf = (ts) => { const d = new Date(ts); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  function noticeComposer(mid) {
    const n = noticeOf(mid);
    return '<section class="card stack"><div><h3>📢 വിദ്യാർത്ഥികൾക്ക് അറിയിപ്പ്</h3><p class="muted">ഇവിടെ എഴുതി അയച്ചാൽ ഈ മദ്രസയിലെ എല്ലാ കുട്ടികൾക്കും അടുത്ത തവണ ആപ്പ് തുറക്കുമ്പോൾ ഒരു അറിയിപ്പായി കാണും.</p></div>' +
      (n ? '<div class="notice"><div class="nh">നിലവിലെ അറിയിപ്പ്<span>' + esc(fmtDateShort(todayIsoOf(n.at))) + '</span></div><div class="nt">' + esc(n.text) + "</div></div>" : "") +
      '<textarea id="ntText" class="input" rows="3" maxlength="500" placeholder="അറിയിപ്പ് / നിർദ്ദേശം ടൈപ്പ് ചെയ്യുക…">' + "</textarea>" +
      '<div class="grid2 keep"><button type="button" class="btn" data-act="send-notice">അയയ്ക്കുക</button>' + (n ? '<button type="button" class="btn ghost" data-act="clear-notice">അറിയിപ്പ് നീക്കുക</button>' : "") + "</div></section>";
  }
  function maybeShowNotice() {
    const s = state.session;
    if (!s || s.role !== "student" || modal) return;
    const n = noticeOf(s.mid); if (!n) return;
    if (!state.seen) state.seen = {};
    if (state.seen[s.mid] === n.id) return;
    state.seen[s.mid] = n.id; persist();
    openModal({ title: "📢 അറിയിപ്പ്" + (n.by ? " — " + n.by : ""), text: n.text, ok: "ശരി", focus: false, onOk() {} });
  }
  // Every tick / choice a student can mark. key -> [label, legacySection]
  const ITEM_GROUPS = [
    ["ഇളവ്", [["exempt", "നിസ്കാര ഇളവ് / പറ്റില്ല", ""]]],
    ["ഫർള് നിസ്കാരങ്ങൾ", PRAYERS.map((p) => ["f_" + p.id, p.label, ""])],
    ["സുന്നത്ത് നിസ്കാരങ്ങൾ", [["witr", "വിത്ർ", ""], ["duha", "ളുഹാ", ""], ["tahajjud", "തഹജ്ജുദ്", ""]].concat(RAWATIB.map((c) => ["r_" + c.id, c.label, ""]))],
    ["ദിക്ർ & ഔറാദ്", [["haddad", "ഹദ്ദാദ്", "dhikr"], ["istighfar100", "ഇസ്തിഗ്ഫാർ 100", "dhikr"], ["salawat100", "സ്വലാത്ത് 100", "dhikr"]]],
    ["ഖുർആൻ & സൂറത്തുകൾ", [["classDone", "ഖുർആൻ — ക്ലാസിൽ എടുത്ത ഭാഗം", "quran"], ["surahMulk", "സൂറത്തുൽ മുൽക്ക്", "quran"], ["surahWaqiah", "സൂറത്തുൽ വാഖിയ", "quran"]]],
    ["വെള്ളിയാഴ്ച", [["kahf", "സൂറത്തുൽ കഹ്ഫ്", ""], ["fsalawat", "പ്രത്യേക സ്വലാത്ത്", ""], ["nails", "നഖം വെട്ടുക", ""]]],
    ["ദൈനംദിന ശീലങ്ങൾ", [["mobile", "മൊബൈൽ ഉപയോഗം", "habits"], ["book", "പുസ്തകം വായിച്ച സമയം", "habits"]]]
  ];
  const LEGACY_SEC = {};
  ITEM_GROUPS.forEach((g) => g[1].forEach((i) => { LEGACY_SEC[i[0]] = i[2]; }));
  // Is item visible for this madrasa + class? class rule > "all classes" rule > legacy section flag > visible
  function isVis(mid, cls, key) {
    const m = mid ? liveMadrasa(mid) : null;
    if (!m) return true;
    const v = m.vis && m.vis[key];
    if (v) {
      if (cls && v[cls] !== undefined) return !!v[cls];
      if (v["*"] !== undefined) return !!v["*"];
    }
    const sec = LEGACY_SEC[key];
    return !(sec && m.hide && m.hide[sec]);
  }
  function mcfg(mid, cls) {
    const m = mid ? liveMadrasa(mid) : null;
    const customs = m && m.custom ? Object.values(m.custom).filter((c) => c && !c.deleted && (!cls || !c.cls || c.cls === "*" || c.cls === cls)).sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
    return { customs };
  }
  const clsOf = (mid, sid) => { const st = state.students[mid] && state.students[mid][sid]; return st ? st.cls : ""; };
  const liveUstads = () => Object.values(state.ustads).filter((u) => !u.deleted && liveMadrasa(u.mid));
  const studentsOf = (mid) => Object.values(state.students[mid] || {}).filter((s) => !s.deleted);

  function findMadrasaByCode(code) {
    const t = normName(code);
    if (!t) return null;
    return liveMadrasas().find((m) => normName(m.code) === t) || null;
  }
  function findUstadByCode(code) {
    const t = normName(code);
    if (!t) return null;
    return Object.values(state.ustads).find((u) => !u.deleted && normName(u.code) === t) || null;
  }
  function studentId(mid, cls, name) {
    return "st_" + cyrb53(mid + "|" + cls + "|" + normName(name)).toString(36);
  }

  function getPath(path) {
    const parts = path.split("/");
    let o = state;
    for (const p of parts) { if (o == null) return undefined; o = o[p]; }
    return o;
  }
  function markDirty(path) {
    state.dirty[path] = 1;
    persist();
    scheduleSync();
  }

  function saveMadrasa(m) { m.updatedAt = Date.now(); state.madrasas[m.id] = m; markDirty("madrasas/" + m.id); }
  function saveUstad(u) { u.updatedAt = Date.now(); state.ustads[u.id] = u; markDirty("ustads/" + u.id); }
  function saveStudent(s) {
    s.updatedAt = Date.now();
    if (!state.students[s.mid]) state.students[s.mid] = {};
    state.students[s.mid][s.id] = s;
    markDirty("students/" + s.mid + "/" + s.id);
  }

  function addStudent(mid, cls, rawName) {
    const name = cleanName(rawName);
    if (!name) return "empty";
    const id = studentId(mid, cls, name);
    const ex = state.students[mid] && state.students[mid][id];
    if (ex && !ex.deleted) return "dup";
    saveStudent({ id, mid, name, cls, deleted: false });
    return "ok";
  }

  function createDefaultEntry(date) {
    const per = {};
    PRAYERS.forEach((p) => { per[p.id] = { muthal: false, vare: false }; });
    return {
      date,
      exemption: { pattilla: false, poornamayum: false, perPrayer: per },
      fardh: { subh: "none", zuhur: "none", asr: "none", maghrib: "none", isha: "none" },
      sunnah: { witr: false, duha: false, tahajjud: false, rawatib: { subh_before: 0, zuhur_before: 0, zuhur_after: 0, asr_before: 0, maghrib_after: 0, isha_before: 0, isha_after: 0 } },
      dhikr: { haddad: false, istighfar100: false, salawat100: false },
      quran: { classDone: false, surahMulk: false, surahWaqiah: false },
      friday: { kahf: false, salawat: false, nails: false },
      habits: { mobileUsage: "none", bookReading: 0 },
      updatedAt: 0
    };
  }

  function recordOf(mid, sid, date) {
    return (state.records[mid] && state.records[mid][sid] && state.records[mid][sid][date]) || null;
  }
  // Entry for the logged-in student & selected date (not stored until first edit)
  function currentEntry(create) {
    const s = state.session;
    const date = state.ui.date;
    let e = recordOf(s.mid, s.userId, date);
    if (!e && create) {
      if (!state.records[s.mid]) state.records[s.mid] = {};
      if (!state.records[s.mid][s.userId]) state.records[s.mid][s.userId] = {};
      e = state.records[s.mid][s.userId][date] = createDefaultEntry(date);
    }
    return e || createDefaultEntry(date);
  }

  function rangeExempt(entry) {
    const out = new Set();
    const per = (entry.exemption && entry.exemption.perPrayer) || {};
    PRAYERS.forEach((p, i) => {
      const f = per[p.id] || {};
      if (f.muthal) for (let j = i; j < PRAYERS.length; j++) out.add(PRAYERS[j].id);
      if (f.vare) for (let j = 0; j <= i; j++) out.add(PRAYERS[j].id);
    });
    return out;
  }

  function calc(entry, mid, cls) {
    if (!entry) return 0;
    const iv = (k) => isVis(mid, cls, k);
    const cf = mcfg(mid, cls), ec = entry.custom || {};
    const cpts = (sec) => cf.customs.reduce((a, c) => a + (c.sec === sec && ec[c.id] === true ? (Number(c.points) || 0) : 0), 0);
    let t = 0;
    const exOn = iv("exempt");
    const ex = exOn ? (entry.exemption || {}) : {};
    const full = !!(ex.pattilla && ex.poornamayum);
    const exSet = !exOn ? new Set() : full ? new Set(PRAYERS.map((p) => p.id)) : rangeExempt(entry);
    if (!full) {
      PRAYERS.forEach((p) => {
        if (exSet.has(p.id) || !iv("f_" + p.id)) return;
        const st = (entry.fardh && entry.fardh[p.id]) || "none";
        if (st === "jamaah") t += W.jamaah; else if (st === "prayed") t += W.prayed; else if (st === "qada") t += W.qada;
      });
      const su = entry.sunnah || {};
      if (su.witr && iv("witr")) t += W.witr;
      if (su.duha && iv("duha")) t += W.duha;
      if (su.tahajjud && iv("tahajjud")) t += W.tahajjud;
      Object.keys(su.rawatib || {}).forEach((k) => {
        const n = Number(su.rawatib[k]) || 0;
        if (iv("r_" + k) && n > 0 && n !== 1 && n !== 3) t += (n / 2) * W.rawatibPerTwo;
      });
      const q = entry.quran || {};
      if (q.classDone && iv("classDone")) t += W.quranClassDone;
      if (q.surahMulk && iv("surahMulk")) t += W.surahMulk;
      if (q.surahWaqiah && iv("surahWaqiah")) t += W.surahWaqiah;
      t += cpts("quran");
      if (isFriday(entry.date)) {
        const f = entry.friday || {};
        if (f.kahf && iv("kahf")) t += W.fridayKahf;
        if (f.salawat && iv("fsalawat")) t += W.fridaySalawat;
        if (f.nails && iv("nails")) t += W.fridayNails;
      }
    }
    const d = entry.dhikr || {};
    if (d.haddad && iv("haddad")) t += W.haddad;
    if (d.istighfar100 && iv("istighfar100")) t += W.istighfar100;
    if (d.salawat100 && iv("salawat100")) t += W.salawat100;
    t += cpts("dhikr");
    const h = entry.habits || {};
    if (iv("mobile")) t += W.mobile[h.mobileUsage] || 0;
    if (iv("book")) t += W.book[Number(h.bookReading)] || 0;
    t += cpts("habits");
    return t;
  }

  const boardOf = (mid, sid) => (state.board[mid] && state.board[mid][sid]) || {};
  // Own/staff-visible full records give an exact score; everyone else only has the published board number.
  function dayScore(mid, sid, date) {
    const r = recordOf(mid, sid, date);
    if (r) return calc(r, mid, clsOf(mid, sid));
    const b = boardOf(mid, sid)[date];
    return b ? Number(b.s) || 0 : 0;
  }
  function monthScore(mid, sid, month) {
    const by = (state.records[mid] && state.records[mid][sid]) || {};
    const ds = new Set(Object.keys(by).concat(Object.keys(boardOf(mid, sid))));
    let t = 0;
    ds.forEach((d) => { if (d.slice(0, 7) === month) t += dayScore(mid, sid, d); });
    return t;
  }

  // Ranked list for one or more madrasas. cls = "all" | class label. scope = "day" | "month"
  function standings(mids, cls, scope, key) {
    const rows = [];
    mids.forEach((mid) => {
      studentsOf(mid).forEach((s) => {
        if (cls !== "all" && s.cls !== cls) return;
        rows.push({ s, mid, score: scope === "day" ? dayScore(mid, s.id, key) : monthScore(mid, s.id, key) });
      });
    });
    rows.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name, "ml"));
    let rank = 0, prev = null;
    rows.forEach((r, i) => { if (r.score !== prev) { rank = i + 1; prev = r.score; } r.rank = rank; });
    return rows;
  }
  const winnersOf = (rows) => rows.filter((r) => r.rank === 1 && r.score > 0);

  /* =====================================================================
     5. FIREBASE SYNC (offline queue → push, then pull & merge by updatedAt)
     ===================================================================== */
  let syncing = false;
  let syncTimer = null;
  let syncState = "idle"; // idle | busy | ok | err
  let syncErr = "";

  const online = () => navigator.onLine !== false;
  const pendingCount = () => Object.keys(state.dirty).length;

  const isPlaceholder = (v) => !v || /^PASTE_/.test(v);
  const enc = encodeURIComponent;
  const qBy = (field, value) => "orderBy=" + enc('"' + field + '"') + "&equalTo=" + enc(JSON.stringify(value));

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const pinKey = (mid, sid, pin) => sha256Hex("mt1|" + mid + "|" + sid + "|" + pin);

  /* ---- Firebase Authentication (admin & ustads only; students use a personal PIN) ---- */
  async function authCall(endpoint, body) {
    const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:" + endpoint + "?key=" + enc(CFG.API_KEY), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || "HTTP " + r.status);
    return j;
  }
  function setAuth(j) {
    state.auth = { idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + (Number(j.expiresIn) || 3600) * 1000, uid: j.localId };
    persist();
  }
  async function getToken() {
    const a = state.auth;
    if (!a) return null;
    if (a.exp - 60000 > Date.now() || !online()) return a.idToken;
    const r = await fetch("https://securetoken.googleapis.com/v1/token?key=" + enc(CFG.API_KEY), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=refresh_token&refresh_token=" + enc(a.refreshToken)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // യഥാർത്ഥത്തിൽ ടോക്കൺ അസാധുവായാൽ മാത്രം ലോഗൗട്ട്; നെറ്റ്‌വർക്ക്/സെർവർ തകരാറുകൾക്ക് ലോഗൗട്ട് ഇല്ല
      const code = String(((j || {}).error || {}).message || "");
      if (r.status === 400 && /INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND/.test(code)) { const e = new Error("AUTH"); e.status = 401; throw e; }
      const e2 = new Error("HTTP " + r.status); e2.status = r.status; throw e2;
    }
    state.auth = { idToken: j.id_token, refreshToken: j.refresh_token || a.refreshToken, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, uid: j.user_id || a.uid };
    persist();
    return state.auth.idToken;
  }

  function url(path, q) {
    return CFG.DB + "/" + CFG.ROOT + (path ? "/" + path : "") + ".json" + (q ? "?" + q : "");
  }
  async function dbReq(path, opt) {
    opt = opt || {};
    const q = opt.q ? [opt.q] : [];
    if (state.auth && (!state.session || state.session.role !== "student")) {
      const t = await getToken();
      if (t) q.push("auth=" + enc(t));
    }
    const hasBody = opt.body !== undefined;
    return fetch(url(path, q.join("&")), {
      method: opt.method || "GET", cache: "no-store",
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(opt.body) : undefined
    });
  }
  async function fetchJson(path, q) {
    const r = await dbReq(path, { q });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  function mergeNode(local, remote, depth, prefix) {
    let changed = false;
    if (!remote || typeof remote !== "object") return false;
    for (const k of Object.keys(remote)) {
      const rv = remote[k];
      if (rv == null || typeof rv !== "object") continue;
      if (depth === 0) {
        const lv = local[k];
        if (!lv || (rv.updatedAt || 0) > (lv.updatedAt || 0)) {
          local[k] = rv;
          delete state.dirty[prefix + k];
          changed = true;
        }
      } else {
        if (!local[k]) local[k] = {};
        if (mergeNode(local[k], rv, depth - 1, prefix + k + "/")) changed = true;
      }
    }
    return changed;
  }
  function mergeRemote(root) {
    if (!root) return false;
    let ch = false;
    if (mergeNode(state.madrasas, root.madrasas, 0, "madrasas/")) ch = true;
    if (mergeNode(state.ustads, root.ustads, 0, "ustads/")) ch = true;
    if (mergeNode(state.students, root.students, 1, "students/")) ch = true;
    if (mergeNode(state.records, root.records, 2, "records/")) ch = true;
    if (mergeNode(state.board, root.board, 2, "board/")) ch = true;
    return ch;
  }

  // Server stores a student's records under records/mid/sid/<64-hex key>/date (writable only with that key);
  // older data sits directly at records/mid/sid/date. Staff flatten both into mid→sid→date.
  function flattenRecords(byMid) {
    const out = {};
    Object.keys(byMid || {}).forEach((mid) => {
      out[mid] = {};
      const bySid = byMid[mid] || {};
      Object.keys(bySid).forEach((sid) => {
        const dst = out[mid][sid] = {};
        const put = (d, rec) => { if (rec && typeof rec === "object" && (!dst[d] || (rec.updatedAt || 0) > (dst[d].updatedAt || 0))) dst[d] = rec; };
        const node = bySid[sid] || {};
        Object.keys(node).forEach((k) => {
          const v = node[k];
          if (k.length === 64 && v && typeof v === "object" && !v.date) Object.keys(v).forEach((d) => put(d, v[d]));
          else put(k, v);
        });
      });
    });
    return out;
  }

  async function pull() {
    const s = state.session;
    if (!s) return false;
    let changed = false;
    if (s.role === "student") {
      const [m, st, bd, rc] = await Promise.all([
        fetchJson("madrasas", qBy("code", s.mcode)),
        fetchJson("students/" + s.mid),
        fetchJson("board/" + s.mid),
        fetchJson("records/" + s.mid + "/" + s.userId + "/" + s.key).catch((e) => {
          if (e.status === 401 || e.status === 403) { const x = new Error("KEY"); x.bad = true; throw x; }
          throw e;
        })
      ]);
      changed = mergeRemote({
        madrasas: m, students: st ? { [s.mid]: st } : null, board: bd ? { [s.mid]: bd } : null,
        records: rc ? { [s.mid]: { [s.userId]: rc } } : null
      });
    } else if (s.role === "ustad") {
      const [m, u, st, bd, rc, hp] = await Promise.all([
        fetchJson("madrasas/" + s.mid), fetchJson("ustads", qBy("mid", s.mid)), fetchJson("students/" + s.mid),
        fetchJson("board/" + s.mid), fetchJson("records/" + s.mid), fetchJson("hasPin/" + s.mid)
      ]);
      changed = mergeRemote({
        madrasas: m ? { [s.mid]: m } : null, ustads: u, students: st ? { [s.mid]: st } : null,
        board: bd ? { [s.mid]: bd } : null, records: rc ? flattenRecords({ [s.mid]: rc }) : null
      });
      state.hasPin[s.mid] = hp || {};
    } else {
      const [m, u, st, bd, rc, hp] = await Promise.all([
        fetchJson("madrasas"), fetchJson("ustads"), fetchJson("students"), fetchJson("board"), fetchJson("records"), fetchJson("hasPin")
      ]);
      changed = mergeRemote({ madrasas: m, ustads: u, students: st, board: bd, records: flattenRecords(rc) });
      state.hasPin = hp || {};
    }
    return changed;
  }

  // What this login may write (everything else stays queued for the right person)
  function pushable(p) {
    const s = state.session;
    if (!s) return false;
    const a = p.split("/");
    if (s.role === "student") {
      if (a[0] === "records" || a[0] === "board") return a[1] === s.mid && a[2] === s.userId;
      return a[0] === "students" && a[1] === s.mid && a[2] === s.userId;
    }
    return a[0] !== "records";
  }

  async function push() {
    const s = state.session;
    const paths = Object.keys(state.dirty).filter(pushable);
    for (let i = 0; i < paths.length; i += 4) {
      const chunk = paths.slice(i, i + 4);
      await Promise.all(chunk.map(async (p) => {
        const val = getPath(p);
        if (val === undefined) { delete state.dirty[p]; return; }
        const stamp = val.updatedAt;
        let rp = p;
        if (s.role === "student" && p.indexOf("records/") === 0) { const a = p.split("/"); rp = "records/" + a[1] + "/" + a[2] + "/" + s.key + "/" + a[3]; }
        const r = await dbReq(rp, { method: "PUT", body: val });
        if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
        const now = getPath(p);
        if (now && now.updatedAt === stamp) delete state.dirty[p];
      }));
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync(false), CFG.SYNC_DEBOUNCE);
    updateStrip();
  }

  async function sync(manual) {
    if (!state.session) return;
    if (syncing) return manual ? "busy" : undefined;
    if (!online()) { updateStrip(); return "offline"; }
    syncing = true;
    syncState = "busy";
    updateStrip();
    let changed = false, kicked = false;
    syncErr = "";
    const fail = (e) => {
      if (e && e.bad) kicked = "PIN മാറ്റിയിരിക്കുന്നു. പുതിയ പിൻ ഉപയോഗിച്ച് വീണ്ടും പ്രവേശിക്കുക.";
      else if (e && e.message === "AUTH") kicked = "സെഷൻ അവസാനിച്ചു. വീണ്ടും പ്രവേശിക്കുക.";
      syncErr = syncErr || String((e && e.message) || e);
    };
    // Push first (so local work is never blocked by a failing read), then pull.
    try { await push(); } catch (e) { fail(e); }
    try { changed = await pull(); } catch (e) { fail(e); }
    if (kicked) {
      state.session = null; state.auth = null; clearMirror();
      syncing = false; syncState = "idle";
      persist(); render();
      showToast(kicked, true);
      return "err";
    }
    if (syncErr) syncState = "err";
    else { state.lastSync = Date.now(); syncState = "ok"; validateSession(); }
    syncing = false;
    persist();
    updateStrip();
    if (changed && syncState === "ok" && !modal) render();
    return syncState;
  }

  // If the account was removed remotely (or a pre-PIN session is found), sign out
  let badStreak = 0;
  function validateSession() {
    const s = state.session;
    if (!s || s.role === "admin") return;
    let bad = false;
    if (!liveMadrasa(s.mid)) bad = true;
    if (s.role === "ustad") { const u = state.ustads[s.userId]; if (!u || u.deleted) bad = true; }
    if (s.role === "student") {
      if (!s.key) bad = true;
      const st = state.students[s.mid] && state.students[s.mid][s.userId]; if (st && st.deleted) bad = true;
    }
    if (!bad) { badStreak = 0; return; }
    if (++badStreak < 2) return; // ഒറ്റ തവണ ഡാറ്റ കിട്ടാതിരുന്നാൽ ലോഗൗട്ട് ചെയ്യരുത്
    if (bad) {
      state.session = null; state.auth = null; clearMirror();
      persist();
      showToast("ഈ അക്കൗണ്ട് ഇപ്പോൾ സജീവമല്ല. വീണ്ടും പ്രവേശിക്കുക.", true);
      render();
    }
  }

  /* =====================================================================
     6. UI PLUMBING: toast, modal, status strip
     ===================================================================== */
  let toastTimer = null;
  function showToast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast" + (isError ? " error" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
  }

  let modal = null;
  function openModal(opts) {
    modal = opts;
    renderModal();
    const first = $("#modalRoot input, #modalRoot select, #modalRoot textarea");
    if (first && opts.focus !== false) setTimeout(() => first.focus(), 60);
  }
  function closeModal() { modal = null; renderModal(); }
  function renderModal() {
    const root = $("#modalRoot");
    if (!modal) { root.innerHTML = ""; return; }
    root.innerHTML =
      '<div class="overlay" data-act="modal-bg"><div class="sheet" role="dialog" aria-modal="true">' +
      "<h3>" + esc(modal.title) + "</h3>" +
      (modal.text ? "<p>" + esc(modal.text) + "</p>" : "") +
      (modal.body || "") +
      '<p id="modalErr" class="err" hidden></p>' +
      '<div class="actions"><button type="button" class="btn ghost" data-act="modal-cancel">റദ്ദാക്കുക</button>' +
      '<button type="button" class="btn ' + (modal.danger ? "danger" : "") + '" data-act="modal-ok">' + esc(modal.ok || "സേവ്") + "</button></div></div></div>";
  }
  const mv = (id) => { const el = document.getElementById("mf_" + id); return el ? (el.type === "checkbox" ? el.checked : el.value) : ""; };
  function modalError(msg) { const e = $("#modalErr"); if (e) { e.textContent = msg; e.hidden = false; } }

  function updateStrip() {
    const dot = $("#syncDot"), txt = $("#syncText");
    if (!dot) return;
    const n = pendingCount();
    let cls = "dot", t;
    if (!online()) { cls += " off"; t = "ഓഫ്‌ലൈൻ" + (n ? " • " + n + " മാറ്റം അയക്കാനുണ്ട്" : " • ഫോണിൽ സേവ് ആകുന്നു"); }
    else if (syncState === "busy") { cls += " busy"; t = "സിങ്ക് ചെയ്യുന്നു…"; }
    else if (syncState === "err") { cls += " err"; t = "സെർവർ ലഭ്യമല്ല (" + syncErr + ")" + (n ? " • " + n + " മാറ്റം പിന്നീട് അയക്കും" : ""); }
    else if (n) { t = "ഓൺലൈൻ • " + n + " മാറ്റം അയക്കാനുണ്ട്"; }
    else { t = "ഓൺലൈൻ • സിങ്ക് പൂർത്തിയായി"; }
    dot.className = cls;
    txt.textContent = t;

    const bell = $("#btnBell");
    bell.className = "chip" + (state.reminder ? " on" : "");
    bell.innerHTML = (state.reminder ? ICON.bell : ICON.bellOff) + "<span>9:00 PM</span>";
    const inst = $("#btnInstall");
    inst.hidden = isStandalone();
  }
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  /* =====================================================================
     7. VIEWS
     ===================================================================== */
  function quoteCard() {
    return '<section class="quote" lang="ar"><div class="ar" dir="rtl">قُلِ الْحَقَّ وَإِنْ كَانَ مُرًّا</div><div class="ml" lang="ml">"അത് എത്ര തന്നെ കൈപ്പുള്ളതാണെങ്കിലും നീ സത്യം പറയുക." <span>(നബി വചനം)</span></div></section>';
  }

  function render() {
    const app = $("#app");
    const y = window.scrollY;
    const s = state.session;
    const nav = $("#bottomNav");
    document.body.classList.toggle("no-nav", !s);
    if (!s) {
      nav.hidden = true;
      app.innerHTML = quoteCard() + loginView();
    } else {
      renderNav();
      const tab = state.ui.tab;
      let html = (s.role === "student" ? quoteCard() : "") + sessionCard() + (s.role === "student" ? noticeBanner(s.mid) : "");
      if (s.role === "student") html += tab === "rank" ? rankView() : trackerView();
      else if (tab === "students") html += studentsView();
      else if (tab === "ustads" && s.role === "admin") html += ustadsView();
      else if (tab === "madrasas" && s.role === "admin") html += madrasasView();
      else if (tab === "settings" && s.role === "ustad") html += settingsView();
      else html += (s.role === "ustad" ? noticeComposer(s.mid) : "") + rankView();
      app.innerHTML = html;
    }
    window.scrollTo(0, y);
    updateStrip();
    maybeShowNotice();
  }

  function navItems() {
    const r = state.session.role;
    if (r === "student") return [["tracker", "ദൈനംദിനം", "list"], ["rank", "റാങ്കിംഗ്", "trophy"]];
    if (r === "ustad") return [["rank", "റാങ്കിംഗ്", "trophy"], ["students", "വിദ്യാർത്ഥികൾ", "users"], ["settings", "മദ്രസ", "sliders"]];
    return [["rank", "റാങ്കിംഗ്", "trophy"], ["students", "വിദ്യാർത്ഥികൾ", "users"], ["ustads", "ഉസ്താദുമാർ", "shield"], ["madrasas", "മദ്രസകൾ", "school"]];
  }
  function renderNav() {
    const nav = $("#bottomNav");
    const items = navItems();
    if (!items.some((i) => i[0] === state.ui.tab)) state.ui.tab = items[0][0];
    nav.innerHTML = items.map((i) => '<button type="button" data-act="tab" data-tab="' + i[0] + '" class="' + (state.ui.tab === i[0] ? "on" : "") + '">' + ICON[i[2]] + "<span>" + i[1] + "</span></button>").join("");
    nav.hidden = false;
  }

  function sessionCard() {
    const s = state.session;
    const roleLbl = s.role === "admin" ? "അഡ്മിൻ" : s.role === "ustad" ? "ഉസ്താദ്" : "വിദ്യാർത്ഥി";
    const m = liveMadrasa(s.mid);
    const sub = s.role === "admin" ? "എല്ലാ മദ്രസകളും നിയന്ത്രിക്കാം" : s.role === "ustad" ? (m ? m.name : "") : (m ? m.name : "") + " • " + s.cls;
    return '<section class="card session"><div class="row"><div class="avatar">' + esc(initial(s.name)) + '</div><div><div class="who">' + esc(s.name) + ' <span class="role-tag">' + roleLbl + '</span></div><div class="muted">' + esc(sub) + "</div></div></div>" +
      '<button type="button" class="btn ghost sm" data-act="logout">' + ICON.logout + "മാറുക</button></section>";
  }

  /* ---------- Login ---------- */
  function loginView() {
    return '<section class="card stack" style="gap:16px">' +
      '<div class="hero"><img class="logo" src="icons/icon-192.png" alt="" /><h2>മദ്രസ പ്രവേശനം</h2><p class="muted">പേര്, ക്ലാസ്സ്, മദ്രസ കോഡ്, നിങ്ങളുടെ സ്വന്തം പിൻ എന്നിവ നൽകുക</p></div>' +
      '<div class="stack" style="gap:6px"><label class="field" for="inName">പേര്</label>' +
      '<input id="inName" class="input" type="text" autocomplete="off" placeholder="പേര്" /></div>' +
      '<label class="field">ക്ലാസ്സ്<select id="inClass" class="select">' + CLASSES.map((c) => "<option>" + c + "</option>").join("") + "</select></label>" +
      '<div class="stack" style="gap:8px"><label class="field" for="inCode">മദ്രസ കോഡ്</label>' +
      '<input id="inCode" class="input" type="password" autocomplete="off" placeholder="മദ്രസ കോഡ് നൽകുക" /></div>' +
      '<div class="stack" style="gap:6px"><label class="field" for="inPin">എന്റെ പിൻ</label>' +
      '<input id="inPin" class="input" type="password" inputmode="text" autocomplete="off" placeholder="കുറഞ്ഞത് 6 അക്കം/അക്ഷരം" />' +
      '<p class="muted">ആദ്യമായി വരുന്നവർ ഇവിടെ ഒരു പിൻ ഉണ്ടാക്കുക. ഓർത്തുവെക്കണം — മറ്റാർക്കും പറഞ്ഞുകൊടുക്കരുത്. മറന്നാൽ ഉസ്താദ് റീസെറ്റ് ചെയ്യും.</p></div>' +
      '<p id="errLogin" class="err" hidden></p>' +
      '<button type="button" class="btn block" data-act="login">പ്രവേശനം</button>' +
      '<details class="bulk"><summary>ഉസ്താദ്</summary><div class="stack" style="margin-top:8px">' +
      '<input id="inStaff" class="input" type="password" autocomplete="off" placeholder="നിങ്ങളുടെ കോഡ്" />' +
      '<p id="errStaff" class="err" hidden></p>' +
      '<button type="button" class="btn block" data-act="login-staff">പ്രവേശിക്കുക</button>' +
      "</div></details></section>";
  }

  let loginBusy = false;
  function loginErr(id, msg) { const e = $(id); if (e) { e.textContent = msg; e.hidden = !msg; } }

  async function loginSubmit() {
    if (loginBusy) return;
    const err = (m) => loginErr("#errLogin", m);
    err("");
    const name = cleanName($("#inName").value), codeRaw = cleanName($("#inCode").value);
    const pin = String($("#inPin").value || "").trim(), cls = $("#inClass").value || CLASSES[0];
    if (!name) return err("പേര് നൽകുക.");
    if (!codeRaw) return err("മദ്രസ കോഡ് നൽകുക.");
    if (pin.length < 6) return err("പിൻ കുറഞ്ഞത് 6 അക്കം/അക്ഷരം വേണം.");
    if (!online()) return err("പ്രവേശിക്കാൻ ഇന്റർനെറ്റ് വേണം.");
    loginBusy = true;
    try {
      state.auth = null;
      const mj = await fetchJson("madrasas", qBy("code", codeRaw));
      const m = Object.values(mj || {}).find((x) => x && !x.deleted);
      if (!m) return err("ശരിയായ മദ്രസ കോഡ് നൽകുക.");
      state.madrasas[m.id] = m;
      const sid = studentId(m.id, cls, name);
      const [stRec, has] = await Promise.all([fetchJson("students/" + m.id + "/" + sid), fetchJson("hasPin/" + m.id + "/" + sid)]);
      if (stRec && stRec.deleted) return err("നിങ്ങളെ ഈ മദ്രസയിൽ നിന്ന് നീക്കം ചെയ്തിരിക്കുന്നു. ഉസ്താദിനെ ബന്ധപ്പെടുക.");
      if (!stRec && m.openJoin === false) return err("ഈ പേര് ഈ ക്ലാസ്സിൽ രജിസ്റ്റർ ചെയ്തിട്ടില്ല. ഉസ്താദിനോട് ചേർക്കാൻ ആവശ്യപ്പെടുക.");
      const key = await pinKey(m.id, sid, pin);
      const finish = async (newPin) => {
        try {
          if (!stRec) {
            const rec = { id: sid, mid: m.id, name, cls, deleted: false, updatedAt: Date.now() };
            const r = await dbReq("students/" + m.id + "/" + sid, { method: "PUT", body: rec });
            if (!r.ok) throw new Error("HTTP " + r.status);
            if (!state.students[m.id]) state.students[m.id] = {};
            state.students[m.id][sid] = rec;
          }
          if (newPin) {
            const r1 = await dbReq("pins/" + m.id + "/" + sid, { method: "PUT", body: key });
            if (!r1.ok) return err("ഈ പേരിൽ മറ്റൊരാൾ ഇതിനകം പിൻ ഉണ്ടാക്കിയിട്ടുണ്ട്. ഉസ്താദിനെ അറിയിക്കുക.");
            const r2 = await dbReq("hasPin/" + m.id + "/" + sid, { method: "PUT", body: true });
            if (!r2.ok) throw new Error("HTTP " + r2.status);
          } else {
            const r = await dbReq("records/" + m.id + "/" + sid + "/" + key);
            if (r.status === 401 || r.status === 403) return err("പിൻ തെറ്റാണ്.");
            if (!r.ok) throw new Error("HTTP " + r.status);
          }
          startSession({ role: "student", userId: sid, mid: m.id, name: stRec ? stRec.name : name, cls, key, mcode: m.code }, "tracker");
          showToast(name + " — സ്വാഗതം.");
        } catch (e) { err("പ്രവേശിക്കാൻ കഴിഞ്ഞില്ല (" + ((e && e.message) || e) + "). ഇന്റർനെറ്റ് പരിശോധിക്കുക."); }
      };
      if (has) { await finish(false); return; }
      openModal({
        title: "പിൻ ഉറപ്പിക്കുക", text: "ഇത് നിങ്ങളുടെ ആദ്യ പ്രവേശനമാണ്. തിരഞ്ഞെടുത്ത പിൻ ഒരിക്കൽ കൂടി നൽകുക.",
        body: '<input id="mf_pin2" class="input" type="password" autocomplete="off" placeholder="പിൻ ആവർത്തിക്കുക">', ok: "ഉറപ്പിക്കുക",
        onOk() {
          if (String(mv("pin2")).trim() !== pin) return modalError("പിൻ പൊരുത്തപ്പെടുന്നില്ല."), false;
          finish(true);
        }
      });
    } catch (e) {
      err("സെർവറുമായി ബന്ധപ്പെടാൻ കഴിഞ്ഞില്ല (" + ((e && e.message) || e) + ").");
    } finally { loginBusy = false; }
  }

  function authMsg(e) {
    const m = String((e && e.message) || e);
    if (/INVALID_LOGIN|INVALID_PASSWORD|EMAIL_NOT_FOUND|NOT_ADMIN/.test(m)) return "കോഡ് / പാസ്‌വേഡ് ശരിയല്ല.";
    if (/TOO_MANY/.test(m)) return "ഒരുപാട് ശ്രമങ്ങൾ. കുറച്ച് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക.";
    return "പ്രവേശിക്കാൻ കഴിഞ്ഞില്ല (" + m + ").";
  }
  async function staffLogin(kind) {
    if (loginBusy) return;
    const err = (m) => loginErr("#errStaff", m);
    err("");
    const code = cleanName($("#inStaff").value);
    if (!code) return err("കോഡ് നൽകുക.");
    if (isPlaceholder(CFG.API_KEY)) return err("ആപ്പ് സജ്ജീകരണം പൂർത്തിയായിട്ടില്ല (API key ചേർക്കണം).");
    if (!online()) return err("പ്രവേശിക്കാൻ ഇന്റർനെറ്റ് വേണം.");
    loginBusy = true;
    try {
      state.auth = null;
      // ഒറ്റ ഫീൽഡ്: ഉസ്താദ് കോഡ് ആണെങ്കിൽ ഉസ്താദ്, അല്ലെങ്കിൽ അഡ്മിൻ പാസ്‌വേഡ് ആയി പരിശോധിക്കും
      if (kind === "auto") {
        const mj0 = await fetchJson("ustads", qBy("code", code));
        kind = Object.values(mj0 || {}).some((x) => x && !x.deleted) ? "ustad" : "admin";
      }
      if (kind === "admin") {
        if (isPlaceholder(CFG.ADMIN_EMAIL)) return err("ആപ്പ് സജ്ജീകരണം പൂർത്തിയായിട്ടില്ല (admin e-mail ചേർക്കണം).");
        const j = await authCall("signInWithPassword", { email: CFG.ADMIN_EMAIL, password: code, returnSecureToken: true });
        if (!isPlaceholder(CFG.ADMIN_UID) && j.localId !== CFG.ADMIN_UID) throw new Error("NOT_ADMIN");
        setAuth(j);
        startSession({ role: "admin", userId: "admin", mid: "", name: "അഡ്മിൻ", cls: "" }, "rank");
        showToast("അഡ്മിൻ പാനൽ തുറന്നു.");
      } else {
        const mj = await fetchJson("ustads", qBy("code", code));
        const u = Object.values(mj || {}).find((x) => x && !x.deleted);
        if (!u) return err("ശരിയായ ഉസ്താദ് കോഡ് നൽകുക.");
        if (!u.authEmail) return err("ഈ കോഡ് ഇതുവരെ പുതുക്കിയിട്ടില്ല. അഡ്മിനോട് ഉസ്താദിന്റെ കോഡ് ഒരിക്കൽ കൂടി സേവ് ചെയ്യാൻ പറയുക.");
        const j = await authCall("signInWithPassword", { email: u.authEmail, password: code, returnSecureToken: true });
        setAuth(j);
        state.ustads[u.id] = u;
        const m = await fetchJson("madrasas/" + u.mid);
        if (!m || m.deleted) { state.auth = null; return err("ഈ ഉസ്താദിന്റെ മദ്രസ ഇപ്പോൾ സജീവമല്ല."); }
        state.madrasas[m.id || u.mid] = m;
        startSession({ role: "ustad", userId: u.id, mid: u.mid, name: u.name, cls: "" }, "rank");
        showToast(u.name + " — ഉസ്താദ് പാനൽ തുറന്നു.");
      }
    } catch (e) { state.auth = null; err(authMsg(e)); }
    finally { loginBusy = false; }
  }

  function startSession(sess, tab) {
    // Drop queued changes that belong to someone else on this phone
    Object.keys(state.dirty).forEach((p) => { state.session = sess; if (!pushable(p)) delete state.dirty[p]; });
    state.session = sess;
    state.ui.tab = tab;
    state.ui.date = todayIso();
    state.ui.cls = "all";
    state.ui.mid = "all";
    persist();
    render();
    sync(false);
  }

  /* ---------- Tracker (student) ---------- */
  function chk(path, label, checked, extra) {
    return '<label class="tile ' + (extra || "") + (checked ? " on" : "") + '"><span>' + label + '</span><input type="checkbox" data-ep="' + path + '"' + (checked ? " checked" : "") + '><i class="box"></i></label>';
  }

  function trackerView() {
    const date = state.ui.date;
    const mid = state.session.mid, cls = state.session.cls;
    const iv = (k) => isVis(mid, cls, k);
    const e = currentEntry(false);
    const exOn = iv("exempt");
    const ex = e.exemption;
    const pat = exOn && !!ex.pattilla;
    const full = pat && !!ex.poornamayum;
    const exSet = !exOn ? new Set() : full ? new Set(PRAYERS.map((p) => p.id)) : rangeExempt(e);
    const fri = isFriday(date);
    const score = calc(e, mid, cls);
    const cf = mcfg(mid, cls);
    const cTicks = (sec) => cf.customs.filter((c) => c.sec === sec).map((c) => chk("custom." + c.id, esc(c.label), !!(e.custom && e.custom[c.id]))).join("");

    let h = '<section class="total"><div><div class="lbl">' + (date === todayIso() ? "ഇന്നത്തെ പോയിന്റ്" : "ഈ ദിവസത്തെ പോയിന്റ്") + '</div><div class="num">' + score + '</div><div class="lbl" style="margin-top:4px">' + esc(fmtDate(date)) + '</div></div>' +
      '<input type="date" data-ui="date" value="' + date + '" max="' + todayIso() + '" aria-label="തീയതി"></section>';

    // Exemption
    if (exOn) {
      h += '<section class="card stack"><div class="card-head" style="margin:0"><h2>നിസ്കാര ഇളവ് / പറ്റില്ല</h2></div>' +
        chk("exemption.pattilla", "പറ്റില്ല", pat, "warn");
      if (pat) {
        h += chk("exemption.poornamayum", "പൂർണ്ണമായും", full, "amber");
        h += '<div class="grid2">' + PRAYERS.map((p) => {
          const f = (ex.perPrayer && ex.perPrayer[p.id]) || {};
          return '<div class="sub stack" style="gap:8px"><b style="font-size:.84rem">' + p.label + '</b><div class="range-row">' +
            '<label><input type="checkbox" data-ep="exemption.perPrayer.' + p.id + '.muthal"' + (!full && f.muthal ? " checked" : "") + (full ? " disabled" : "") + '> മുതൽ</label>' +
            '<label><input type="checkbox" data-ep="exemption.perPrayer.' + p.id + '.vare"' + (!full && f.vare ? " checked" : "") + (full ? " disabled" : "") + '> വരെ</label></div></div>';
        }).join("") + "</div>";
      }
      h += "</section>";
    }

    if (!full) {
      // Fardh
      const prs = PRAYERS.filter((p) => iv("f_" + p.id));
      if (prs.length) h += '<section class="card stack"><h2>ഫർള് നിസ്കാരങ്ങൾ</h2>' + prs.map((p) => {
        const exm = exSet.has(p.id);
        const cur = e.fardh[p.id] || "none";
        const b = (st, label, extra) => '<button type="button" class="choice ' + (extra || "") + (!exm && cur === st ? " on" : "") + '" data-act="fardh" data-p="' + p.id + '" data-s="' + st + '"' + (exm ? " disabled" : "") + ">" + label + "</button>";
        return '<div class="sub stack" style="gap:10px"><div class="row between"><b style="font-size:.9rem">' + p.label + "</b>" + (exm ? '<span class="pill">ഇളവ്</span>' : "") + "</div>" +
          '<div class="status-grid">' + b("qada", "ഖളാഅ്", "qada") + b("missed", "നിസ്കരിച്ചിട്ടില്ല", "miss") + b("prayed", "നിസ്കരിച്ചു") + b("jamaah", "ജമാഅത്ത്") + "</div></div>";
      }).join("") + "</section>";

      // Sunnah
      const sn = (k, label, path, val) => (iv(k) ? chk(path, label, val, "col") : "");
      const trio = sn("witr", "വിത്ർ", "sunnah.witr", e.sunnah.witr) + sn("duha", "ളുഹാ", "sunnah.duha", e.sunnah.duha) + sn("tahajjud", "തഹജ്ജുദ്", "sunnah.tahajjud", e.sunnah.tahajjud);
      const raws = RAWATIB.filter((c) => iv("r_" + c.id));
      if (trio || raws.length) h += '<section class="card stack"><h2>സുന്നത്ത് നിസ്കാരങ്ങൾ</h2>' + (trio ? '<div class="grid3">' + trio + "</div>" : "") +
        (raws.length ? '<div class="grid2">' + raws.map((c) => {
          const cur = Number(e.sunnah.rawatib[c.id]) || 0;
          return '<label class="sub field">' + c.label + '<select class="select sm" data-ep="sunnah.rawatib.' + c.id + '" data-num="1">' +
            c.choices.map((v) => '<option value="' + v + '"' + (cur === v ? " selected" : "") + ">" + (v === 0 ? "നിസ്കരിച്ചിട്ടില്ല" : v + " റക്അത്ത്") + "</option>").join("") + "</select></label>";
        }).join("") + "</div>" : "") + "</section>";
    }

    // Dhikr
    {
      const body = (iv("haddad") ? chk("dhikr.haddad", "ഹദ്ദാദ്", e.dhikr.haddad) : "") + (iv("istighfar100") ? chk("dhikr.istighfar100", "ഇസ്തിഗ്ഫാർ 100", e.dhikr.istighfar100) : "") + (iv("salawat100") ? chk("dhikr.salawat100", "സ്വലാത്ത് 100", e.dhikr.salawat100) : "") + cTicks("dhikr");
      if (body) h += '<section class="card stack"><h2>ദിക്ർ &amp; ഔറാദ്</h2><div class="grid2 keep" style="grid-template-columns:1fr">' + body + "</div></section>";
    }

    // Quran — tick only
    if (!full) {
      const body = (iv("classDone") ? chk("quran.classDone", "ഖുർആൻ — ഇന്ന് ക്ലാസിൽ എടുത്ത ഭാഗം", e.quran.classDone) : "") +
        (iv("surahMulk") ? chk("quran.surahMulk", "സൂറത്തുൽ മുൽക്ക്", e.quran.surahMulk) : "") +
        (iv("surahWaqiah") ? chk("quran.surahWaqiah", "സൂറത്തുൽ വാഖിയ", e.quran.surahWaqiah) : "") + cTicks("quran");
      if (body) h += '<section class="card stack"><h2>ഖുർആൻ &amp; സൂറത്തുകൾ</h2>' + body + "</section>";
    }

    // Friday (only on Fridays)
    if (fri && !full) {
      const body = (iv("kahf") ? chk("friday.kahf", "സൂറത്തുൽ കഹ്ഫ്", e.friday.kahf) : "") + (iv("fsalawat") ? chk("friday.salawat", "പ്രത്യേക സ്വലാത്ത്", e.friday.salawat) : "") + (iv("nails") ? chk("friday.nails", "നഖം വെട്ടുക", e.friday.nails) : "");
      if (body) h += '<section class="card stack"><div class="row between"><h2>വെള്ളിയാഴ്ച</h2><span class="role-tag">ജുമുഅ ദിനം</span></div>' + body + "</section>";
    }

    // Habits
    const mo = e.habits.mobileUsage, bk = Number(e.habits.bookReading) || 0;
    const mobSel = iv("mobile") ? '<label class="sub field">മൊബൈൽ ഉപയോഗം<select class="select sm" data-ep="habits.mobileUsage">' +
      [["none", "ഉപയോഗിച്ചിട്ടില്ല"], ["under30", "30 മിനിറ്റിൽ താഴെ"], ["30to60", "30 - 60 മിനിറ്റ്"], ["over60", "1 മണിക്കൂറിൽ കൂടുതൽ"]].map((o) => '<option value="' + o[0] + '"' + (mo === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label>" : "";
    const bookSel = iv("book") ? '<label class="sub field">പുസ്തകം വായിച്ച സമയം<select class="select sm" data-ep="habits.bookReading" data-num="1">' +
      [[0, "വായിച്ചില്ല"], [15, "15 മിനിറ്റ്"], [30, "30 മിനിറ്റ്"], [45, "45+ മിനിറ്റ്"]].map((o) => '<option value="' + o[0] + '"' + (bk === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label>" : "";
    const habBuiltin = mobSel || bookSel ? '<div class="grid2">' + mobSel + bookSel + "</div>" : "";
    if (habBuiltin || cTicks("habits")) h += '<section class="card stack"><h2>ദൈനംദിന ശീലങ്ങൾ</h2>' + habBuiltin + cTicks("habits") + "</section>";

    h += '<section class="card stack"><button type="button" class="btn block" data-act="save">' + ICON.download.replace("M12 3v12M7 10l5 5 5-5M5 21h14", "M5 12l5 5 9-10") + "ഇന്നത്തെ രേഖ സേവ് ചെയ്യുക</button>" +
      '<p class="muted" style="text-align:center">മാറ്റങ്ങൾ ഓരോന്നും ഫോണിൽ ഉടൻ സേവ് ആകും. ഇന്റർനെറ്റ് കിട്ടുമ്പോൾ സ്വയം അയയ്ക്കും.</p></section>';
    return h;
  }

  // Save a day's record (private, needs the student's PIN key) and publish only its total to the board
  function touchRecord(e) {
    const s = state.session, date = state.ui.date;
    markDirty("records/" + s.mid + "/" + s.userId + "/" + date);
    if (!state.board[s.mid]) state.board[s.mid] = {};
    if (!state.board[s.mid][s.userId]) state.board[s.mid][s.userId] = {};
    state.board[s.mid][s.userId][date] = { s: calc(e, s.mid, s.cls), updatedAt: e.updatedAt };
    markDirty("board/" + s.mid + "/" + s.userId + "/" + date);
  }
  function editEntry(path, value) {
    const s = state.session;
    const e = currentEntry(true);
    setDeep(e, path, value);
    // consistency rules
    if (path === "exemption.pattilla" && !value) {
      e.exemption.poornamayum = false;
      PRAYERS.forEach((p) => { e.exemption.perPrayer[p.id] = { muthal: false, vare: false }; });
    }
    if (path === "exemption.poornamayum" && value) {
      PRAYERS.forEach((p) => { e.exemption.perPrayer[p.id] = { muthal: false, vare: false }; });
    }
    if (path.indexOf("exemption.perPrayer.") === 0 && value) e.exemption.poornamayum = false;
    if (path.indexOf("sunnah.rawatib.") === 0 && (value === 1 || value === 3)) setDeep(e, path, 0);
    e.updatedAt = Date.now();
    touchRecord(e);
    render();
  }

  /* ---------- Ranking (all roles) ---------- */
  function winText(rows) {
    const w = winnersOf(rows);
    if (!w.length) return null;
    return { names: w.map((r) => r.s.name).join(", "), cls: w.length === 1 ? w[0].s.cls : "", score: w[0].score };
  }
  function winCard(kicker, rows, alt) {
    const w = winText(rows);
    return '<div class="win' + (alt ? " alt" : "") + '">' + ICON.crown.replace("<svg", '<svg class="crown"') +
      '<div class="kicker">' + esc(kicker) + "</div>" +
      (w ? '<div class="nm">' + esc(w.names) + '</div><div class="pt">' + (w.cls ? esc(w.cls) + " • " : "") + w.score + " പോയിന്റ്</div>" : '<div class="nm" style="font-size:.9rem;opacity:.7">ഇതുവരെ വിജയി ഇല്ല</div>') + "</div>";
  }

  function rankView() {
    const s = state.session, ui = state.ui;
    const isAdmin = s.role === "admin";
    const staff = s.role !== "student";
    if (isAdmin && ui.mid !== "all" && !liveMadrasa(ui.mid)) ui.mid = "all";
    const mids = isAdmin ? (ui.mid === "all" ? liveMadrasas().map((m) => m.id) : [ui.mid]) : [s.mid];
    const cls = ui.cls;
    const dayRows = standings(mids, cls, "day", ui.lbDate);
    const monthRows = standings(mids, cls, "month", ui.lbMonth);
    const scope = ui.lbScope;
    const rows = scope === "day" ? dayRows : monthRows;

    let h = '<section class="card stack"><div class="seg"><button type="button" data-act="ui" data-k="lbScope" data-v="day" class="' + (scope === "day" ? "on" : "") + '">ദിവസം</button><button type="button" data-act="ui" data-k="lbScope" data-v="month" class="' + (scope === "month" ? "on" : "") + '">മാസം</button></div>';
    h += '<div class="grid2 keep">' +
      (scope === "day" ? '<input class="input sm" type="date" data-ui="lbDate" value="' + ui.lbDate + '" max="' + todayIso() + '" aria-label="തീയതി">' : '<input class="input sm" type="month" data-ui="lbMonth" value="' + ui.lbMonth + '" max="' + todayIso().slice(0, 7) + '" aria-label="മാസം">') +
      '<select class="select sm" data-ui="cls" aria-label="ക്ലാസ്സ്"><option value="all">എല്ലാ ക്ലാസ്സും</option>' + CLASSES.map((c) => '<option' + (cls === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select></div>";
    if (isAdmin) {
      h += '<select class="select sm" data-ui="mid" aria-label="മദ്രസ"><option value="all">എല്ലാ മദ്രസകളും</option>' + liveMadrasas().map((m) => '<option value="' + esc(m.id) + '"' + (ui.mid === m.id ? " selected" : "") + ">" + esc(m.name) + "</option>").join("") + "</select>";
    }
    h += "</section>";

    h += '<section class="winners">' + winCard("ദിവസ വിജയി • " + fmtDateShort(ui.lbDate), dayRows, false) + winCard("മാസ വിജയി • " + fmtMonth(ui.lbMonth), monthRows, true) + "</section>";

    // Podium + list
    const top = rows.filter((r) => r.score > 0).slice(0, 3);
    h += '<section class="card stack"><div class="card-head" style="margin:0"><h3>' + (scope === "day" ? "ദിവസ റാങ്കിംഗ് • " + esc(fmtDateShort(ui.lbDate)) : "മാസ റാങ്കിംഗ് • " + esc(fmtMonth(ui.lbMonth))) + '</h3><span class="muted">' + rows.length + " പേർ</span></div>";
    if (!rows.length) {
      h += '<div class="empty">വിദ്യാർത്ഥികളെ ഇതുവരെ ചേർത്തിട്ടില്ല.</div>';
    } else {
      if (top.length) {
        const order = [1, 0, 2].filter((i) => top[i]);
        h += '<div class="podium-wrap"><div class="podium">' + order.map((i) => {
          const r = top[i];
          return '<div class="pod p' + (i + 1) + '"><div class="medal">' + r.rank + '</div><div class="name trunc">' + esc(r.s.name) + '</div><div class="cls trunc">' + esc(r.s.cls) + '</div><div class="score">' + r.score + "</div></div>";
        }).join("") + "</div></div>";
      }
      const rest = rows.slice(top.length);
      h += '<div class="stack" style="gap:8px">' + rest.map((r) => {
        const meta = isAdmin ? r.s.cls + " • " + ((getMadrasa(r.mid) || {}).name || "") : r.s.cls;
        const me = s.role === "student" && r.s.id === s.userId;
        return '<div class="rank-row' + (me ? " me" : "") + '"><span class="rank-no">' + r.rank + '</span><div class="grow"><div class="trunc" style="font-weight:800;font-size:.86rem">' + esc(r.s.name) + (me ? " (ഞാൻ)" : "") + '</div><div class="muted trunc">' + esc(meta) + '</div></div><span class="score-badge">' + r.score + "</span></div>";
      }).join("") + "</div>";
    }
    h += "</section>";

    // Class-wise winners
    const key = scope === "day" ? ui.lbDate : ui.lbMonth;
    const cw = CLASSES.map((c) => ({ c, rows: standings(mids, c, scope, key) })).filter((x) => x.rows.length);
    if (cls === "all" && cw.length) {
      h += '<section class="card stack"><h3>ക്ലാസ് തിരിച്ചുള്ള ' + (scope === "day" ? "ദിവസ" : "മാസ") + " വിജയികൾ</h3>" + cw.map((x) => {
        const w = winText(x.rows);
        return '<div class="list-row"><span class="code-badge" style="font-family:inherit">' + esc(x.c) + '</span><div class="grow trunc" style="font-weight:800;font-size:.84rem">' + (w ? esc(w.names) : '<span class="muted">—</span>') + "</div>" + (w ? '<span class="score-badge">' + w.score + "</span>" : "") + "</div>";
      }).join("") + "</section>";
    }

    // PDF for ustad/admin
    if (staff) {
      h += '<section class="card stack"><div class="row between"><h3>PDF റിപ്പോർട്ട്</h3><span class="muted">ഓഫ്‌ലൈനിലും ഡൗൺലോഡ് ചെയ്യാം</span></div>' +
        '<p class="muted">മദ്രസ വിജയി, ക്ലാസ് തിരിച്ചുള്ള വിജയികൾ, ടോപ്പ് ലിസ്റ്റുകൾ എന്നിവ ഉൾപ്പെടുന്നു.' + (isAdmin && ui.mid === "all" ? " (മുകളിൽ ഒരു മദ്രസ തിരഞ്ഞെടുക്കുക)" : "") + "</p>" +
        '<div class="grid2 keep"><button type="button" class="btn" data-act="pdf" data-scope="month">' + ICON.file + 'മാസ PDF</button><button type="button" class="btn ghost" data-act="pdf" data-scope="day">' + ICON.file + "ദിവസ PDF</button></div></section>";
    }
    return h;
  }

  /* ---------- Students management (ustad + admin) ---------- */
  function studentsView() {
    const s = state.session, ui = state.ui, isAdmin = s.role === "admin";
    const madrasas = liveMadrasas();
    if (isAdmin && ui.mid !== "all" && !liveMadrasa(ui.mid)) ui.mid = "all";
    const mids = isAdmin ? (ui.mid === "all" ? madrasas.map((m) => m.id) : [ui.mid]) : [s.mid];
    const addMid = isAdmin ? (ui.mid !== "all" ? ui.mid : (madrasas[0] || {}).id) : s.mid;
    const classOpts = CLASSES.map((c) => "<option>" + c + "</option>").join("");
    const madrasaOpts = (sel) => madrasas.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === sel ? " selected" : "") + ">" + esc(m.name) + "</option>").join("");

    let h = '<section class="card stack"><div class="card-head" style="margin:0"><h3>വിദ്യാർത്ഥിയെ ചേർക്കുക</h3></div>';
    if (isAdmin) h += '<select id="stMid" class="select">' + madrasaOpts(addMid) + "</select>";
    h += '<div class="grid2 keep"><input id="stName" class="input" type="text" autocomplete="off" placeholder="വിദ്യാർത്ഥിയുടെ പേര്"><select id="stClass" class="select">' + classOpts + "</select></div>" +
      '<button type="button" class="btn block" data-act="add-student">' + ICON.plus + "ചേർക്കുക</button>" +
      '<details class="bulk"><summary>ഒന്നിലധികം പേരെ ഒരുമിച്ച് ചേർക്കുക</summary><div class="stack" style="margin-top:8px"><textarea id="stBulk" class="textarea" placeholder="ഒരു വരിയിൽ ഒരു പേര്"></textarea><select id="stBulkClass" class="select">' + classOpts + '</select><button type="button" class="btn dark" data-act="bulk-add">എല്ലാവരെയും ചേർക്കുക</button></div></details></section>';

    h += '<section class="card stack"><div class="card-head" style="margin:0"><h3>വിദ്യാർത്ഥികൾ</h3></div><div class="grid2 keep">' +
      (isAdmin ? '<select class="select sm" data-ui="mid"><option value="all">എല്ലാ മദ്രസകളും</option>' + madrasas.map((m) => '<option value="' + esc(m.id) + '"' + (ui.mid === m.id ? " selected" : "") + ">" + esc(m.name) + "</option>").join("") + "</select>" : "<div></div>") +
      '<select class="select sm" data-ui="cls"><option value="all">എല്ലാ ക്ലാസ്സും</option>' + CLASSES.map((c) => '<option' + (ui.cls === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select></div>";

    let total = 0, body = "";
    CLASSES.forEach((c) => {
      if (ui.cls !== "all" && ui.cls !== c) return;
      const list = [];
      mids.forEach((mid) => studentsOf(mid).forEach((st) => { if (st.cls === c) list.push(st); }));
      if (!list.length) return;
      list.sort((a, b) => a.name.localeCompare(b.name, "ml"));
      total += list.length;
      body += '<div class="group-title"><span>' + esc(c) + "</span><span>" + list.length + "</span></div>" + list.map((st) =>
        '<div class="list-row"><span class="avatar" style="width:34px;height:34px;border-radius:11px;font-size:.8rem">' + esc(initial(st.name)) + '</span><div class="grow"><div class="trunc" style="font-weight:800;font-size:.86rem">' + esc(st.name) + "</div>" +
        (isAdmin ? '<div class="muted trunc">' + esc((getMadrasa(st.mid) || {}).name || "") + "</div>" : "") + "</div>" +
        (((state.hasPin[st.mid] || {})[st.id]) ? '<button type="button" class="icon-btn" data-act="reset-pin" data-mid="' + esc(st.mid) + '" data-id="' + esc(st.id) + '" aria-label="പിൻ റീസെറ്റ്" title="പിൻ റീസെറ്റ്">' + ICON.logout + "</button>" : "") +
        '<button type="button" class="icon-btn danger" data-act="del-student" data-mid="' + esc(st.mid) + '" data-id="' + esc(st.id) + '" aria-label="നീക്കം ചെയ്യുക">' + ICON.trash + "</button></div>").join("");
    });
    h += total ? body : '<div class="empty">വിദ്യാർത്ഥികളില്ല.</div>';
    h += "</section>";
    return h;
  }

  /* ---------- Admin: madrasas ---------- */
  function madrasasView() {
    let h = '<section class="card stack"><h3>പുതിയ മദ്രസ ചേർക്കുക</h3><input id="mdName" class="input" type="text" placeholder="മദ്രസയുടെ പേര്" autocomplete="off"><input id="mdCode" class="input" type="text" placeholder="മദ്രസ കോഡ്" autocomplete="off"><button type="button" class="btn block" data-act="add-madrasa">' + ICON.plus + "മദ്രസ ചേർക്കുക</button></section>";
    h += '<section class="card stack"><h3>റാങ്കിംഗ് പുതുക്കുക</h3><p class="muted">റാങ്കിംഗിലെ പോയിന്റുകൾ എല്ലാ കുട്ടികളുടെയും രേഖകളിൽ നിന്ന് വീണ്ടും കണക്കാക്കി പ്രസിദ്ധീകരിക്കുന്നു (ക്രമീകരണം മാറ്റിയാലോ പഴയ ഡാറ്റ ചേർക്കുമ്പോഴോ ഉപയോഗിക്കുക).</p><button type="button" class="btn block ghost" data-act="rebuild-board">റാങ്കിംഗ് പുതുക്കുക</button></section>';
    const list = liveMadrasas();
    h += '<section class="card stack"><div class="card-head" style="margin:0"><h3>മദ്രസകൾ</h3><span class="muted">' + list.length + "</span></div>" + (list.length ? list.map((m) => {
      const sc = studentsOf(m.id).length, uc = liveUstads().filter((u) => u.mid === m.id).length;
      return '<div class="list-row"><div class="grow"><div class="trunc" style="font-weight:800;font-size:.88rem">' + esc(m.name) + '</div><div class="muted">' + sc + " വിദ്യാർത്ഥികൾ • " + uc + " ഉസ്താദുമാർ" + (m.openJoin === false ? " • അടച്ച പ്രവേശനം" : "") + '</div></div><span class="code-badge">' + esc(m.code) + '</span>' +
        '<button type="button" class="icon-btn" data-act="edit-madrasa" data-id="' + esc(m.id) + '" aria-label="എഡിറ്റ്">' + ICON.edit + '</button><button type="button" class="icon-btn danger" data-act="del-madrasa" data-id="' + esc(m.id) + '" aria-label="നീക്കം ചെയ്യുക">' + ICON.trash + "</button></div>";
    }).join("") : '<div class="empty">മദ്രസകളില്ല.</div>') + "</section>";
    return h;
  }

  /* ---------- Admin: ustads ---------- */
  function ustadsView() {
    const madrasas = liveMadrasas();
    let h = '<section class="card stack"><h3>ഉസ്താദിനെ ചേർക്കുക</h3><input id="usName" class="input" type="text" placeholder="ഉസ്താദിന്റെ പേര്" autocomplete="off"><input id="usCode" class="input" type="text" placeholder="പ്രത്യേക ഉസ്താദ് കോഡ്" autocomplete="off"><select id="usMid" class="select">' +
      madrasas.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.name) + "</option>").join("") + '</select><button type="button" class="btn block" data-act="add-ustad">' + ICON.plus + "ഉസ്താദിനെ സേവ് ചെയ്യുക</button></section>";
    const list = liveUstads().sort((a, b) => a.name.localeCompare(b.name, "ml"));
    h += '<section class="card stack"><div class="card-head" style="margin:0"><h3>ഉസ്താദുമാർ</h3><span class="muted">' + list.length + "</span></div>" + (list.length ? list.map((u) =>
      '<div class="list-row"><div class="grow"><div class="trunc" style="font-weight:800;font-size:.88rem">' + esc(u.name) + '</div><div class="muted trunc">' + esc((getMadrasa(u.mid) || {}).name || "") + '</div></div><span class="code-badge">' + esc(u.code) + '</span>' +
      '<button type="button" class="icon-btn" data-act="edit-ustad" data-id="' + esc(u.id) + '" aria-label="എഡിറ്റ്">' + ICON.edit + '</button><button type="button" class="icon-btn danger" data-act="del-ustad" data-id="' + esc(u.id) + '" aria-label="നീക്കം ചെയ്യുക">' + ICON.trash + "</button></div>").join("") : '<div class="empty">ഉസ്താദുമാരെ ചേർത്തിട്ടില്ല.</div>') + "</section>";
    return h;
  }

  /* ---------- Ustad: own madrasa settings ---------- */
  function trackerSetupCard(m) {
    const sc = state.ui.cfgCls || "*";
    const cf = mcfg(m.id);
    const sw = (key, label) => {
      const on = sc === "*" ? isVis(m.id, "", key) : isVis(m.id, sc, key);
      return '<label class="switch"><span><b style="font-size:.84rem">' + esc(label) + '</b></span><input type="checkbox" data-vis="' + key + '"' + (on ? " checked" : "") + "></label>";
    };
    return '<section class="card stack"><div><h3>വിദ്യാർത്ഥികളുടെ ട്രാക്കർ ക്രമീകരണം</h3><p class="muted">ഓരോ ഇനവും കാണിക്കണോ ഒഴിവാക്കണോ എന്ന് തിരഞ്ഞെടുക്കുക. "എല്ലാ ക്ലാസും" തിരഞ്ഞെടുത്താൽ എല്ലാവർക്കും മാറും; ഒരു ക്ലാസ് തിരഞ്ഞെടുത്താൽ ആ ക്ലാസിന് മാത്രം. ഒഴിവാക്കിയ ഇനത്തിന്റെ പോയിന്റ് കണക്കിൽ ചേർക്കില്ല.</p></div>' +
      '<label class="sub field">ഏത് ക്ലാസിന്<select class="select sm" data-ui="cfgCls"><option value="*"' + (sc === "*" ? " selected" : "") + ">എല്ലാ ക്ലാസും</option>" + CLASSES.map((c) => '<option value="' + esc(c) + '"' + (sc === c ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select></label>" +
      ITEM_GROUPS.map((g) => '<div class="card-head" style="margin:8px 0 0"><h3 style="font-size:.9rem">' + esc(g[0]) + "</h3></div>" + g[1].map((i) => sw(i[0], i[1])).join("")).join("") +
      '<div class="card-head" style="margin:10px 0 0"><h3>സ്വന്തം ഇനങ്ങൾ ചേർക്കുക</h3></div>' +
      '<select id="cuSec" class="select">' + Object.keys(SECS).map((k) => '<option value="' + k + '">' + SECS[k] + "</option>").join("") + "</select>" +
      '<input id="cuLabel" class="input" type="text" placeholder="ഇനത്തിന്റെ പേര് (ഉദാ: സൂറത്തുൽ കഹ്ഫ്)" autocomplete="off">' +
      '<div class="grid2 keep"><label class="sub field">പോയിന്റ്<select id="cuPts" class="select sm">' + [5, 10, 15, 20, 25, 30].map((n) => '<option value="' + n + '"' + (n === 10 ? " selected" : "") + ">" + n + "</option>").join("") + '</select></label>' +
      '<label class="sub field">ക്ലാസ്<select id="cuCls" class="select sm"><option value="*">എല്ലാ ക്ലാസും</option>' + CLASSES.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("") + "</select></label></div>" +
      '<button type="button" class="btn block" data-act="add-custom">' + ICON.plus + "ഇനം ചേർക്കുക</button>" +
      (cf.customs.length ? cf.customs.map((c) => '<div class="row between" style="gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px"><div style="min-width:0"><div style="font-weight:800;font-size:.86rem">' + esc(c.label) + '</div><div class="muted">' + esc(SECS[c.sec] || "") + " • " + (Number(c.points) || 0) + " പോയിന്റ് • " + esc(!c.cls || c.cls === "*" ? "എല്ലാ ക്ലാസും" : c.cls) + '</div></div><button type="button" class="icon-btn" data-act="del-custom" data-id="' + esc(c.id) + '" aria-label="നീക്കുക">' + ICON.trash + "</button></div>").join("") : '<div class="muted">സ്വന്തം ഇനങ്ങൾ ഇല്ല.</div>') +
      "</section>";
  }
  function settingsView() {
    const m = liveMadrasa(state.session.mid);
    if (!m) return '<section class="card empty">മദ്രസ കണ്ടെത്താൻ കഴിഞ്ഞില്ല.</section>';
    return '<section class="card stack"><div class="card-head" style="margin:0"><div><h3>എന്റെ മദ്രസ കോഡ്</h3><p class="muted">നിങ്ങളുടെ മദ്രസയുടെ കോഡ് മാത്രമേ ഇവിടെ കാണാനും മാറ്റാനും സാധിക്കൂ.</p></div></div>' +
      '<div class="sub" style="font-weight:800">' + esc(m.name) + '</div><input id="ownCode" class="input" type="text" value="' + esc(m.code) + '" placeholder="മദ്രസ കോഡ്" autocomplete="off"><button type="button" class="btn block" data-act="save-own-code">മദ്രസ കോഡ് സേവ് ചെയ്യുക</button></section>' +
      trackerSetupCard(m) +
      '<section class="card"><label class="switch"><span><b style="font-size:.88rem">കോഡ് ഉപയോഗിച്ച് കുട്ടികൾക്ക് സ്വയം ചേരാം</b><br><span class="muted">ഓഫ് ചെയ്താൽ നിങ്ങൾ ചേർത്ത വിദ്യാർത്ഥികൾക്ക് മാത്രം പ്രവേശിക്കാം.</span></span><input type="checkbox" id="openJoin" data-join="' + esc(m.id) + '"' + (m.openJoin === false ? "" : " checked") + "></label></section>";
  }

  /* =====================================================================
     8. ACTIONS (management)
     ===================================================================== */
  function targetMid() {
    const s = state.session;
    return s.role === "admin" ? ($("#stMid") ? $("#stMid").value : "") : s.mid;
  }
  function codeTakenByMadrasa(code, exceptId) {
    const t = normName(code);
    return liveMadrasas().some((m) => m.id !== exceptId && normName(m.code) === t);
  }
  function codeTakenByUstad(code, exceptId) {
    const t = normName(code);
    return Object.values(state.ustads).some((u) => !u.deleted && u.id !== exceptId && normName(u.code) === t);
  }

  // Admin only: make a Firebase Auth account for the ustad (password = code), map its UID → madrasa, save the record.
  async function provisionUstad(u, old) {
    try {
      if (isPlaceholder(CFG.API_KEY)) throw new Error("API key ചേർത്തിട്ടില്ല");
      if (!online()) throw new Error("ഇന്റർനെറ്റ് വേണം");
      const rev = ((old && old.rev) || 0) + 1;
      const email = u.id + ".r" + rev + "@madrasa-tracker.app";
      const j = await authCall("signUp", { email, password: u.code, returnSecureToken: false });
      const r = await dbReq("staff/" + j.localId, { method: "PUT", body: u.mid });
      if (!r.ok) throw new Error("HTTP " + r.status);
      if (old && old.authUid) await dbReq("staff/" + old.authUid, { method: "DELETE" }).catch(() => {});
      u.authEmail = email; u.authUid = j.localId; u.rev = rev;
      saveUstad(u);
      if (old) Object.assign(old, u);
      return true;
    } catch (e) {
      const m = String((e && e.message) || e);
      showToast("ഉസ്താദിനെ സേവ് ചെയ്യാൻ കഴിഞ്ഞില്ല: " + (/WEAK_PASSWORD/.test(m) ? "കോഡ് ദുർബലം" : m), true);
      return false;
    }
  }

  const actions = {
    login: loginSubmit,
    async logout() {
      if (online() && state.session && Object.keys(state.dirty).some(pushable)) { try { await Promise.race([sync(true), new Promise((r) => setTimeout(r, 6000))]); } catch (e) { /* ignore */ } }
      state.session = null; state.auth = null; clearMirror(); persist(); render();
    },
    "login-staff"() { staffLogin("auto"); },
    "login-ustad"() { staffLogin("ustad"); },
    "login-admin"() { staffLogin("admin"); },
    tab(el) { state.ui.tab = el.dataset.tab; persist(); render(); window.scrollTo(0, 0); },
    ui(el) { state.ui[el.dataset.k] = el.dataset.v; render(); },

    fardh(el) {
      const e = currentEntry(false);
      const cur = e.fardh[el.dataset.p];
      editEntry("fardh." + el.dataset.p, cur === el.dataset.s ? "none" : el.dataset.s);
    },
    async save(el) {
      const sess = state.session;
      const e = currentEntry(true);
      e.updatedAt = Date.now();
      touchRecord(e);
      await persistNow();
      if (!online()) { showToast("ഓഫ്‌ലൈൻ: ഫോണിൽ സേവ് ചെയ്തു. ഓൺലൈൻ ആകുമ്പോൾ സ്വയം അയയ്ക്കും."); render(); return; }
      el.disabled = true;
      const r = await sync(true);
      el.disabled = false;
      showToast(r === "ok" ? "ഇന്നത്തെ രേഖ സേവ് ചെയ്തു." : "ഫോണിൽ സേവ് ചെയ്തു. സെർവർ പിശക്: " + syncErr, r !== "ok");
      render();
    },

    reminder: async function () {
      state.reminder = !state.reminder;
      if (state.reminder && "Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
      }
      persist(); updateStrip();
      showToast(state.reminder ? "രാത്രി 9:00 മണി ഓർമ്മപ്പെടുത്തൽ ഓൺ ആക്കി." : "രാത്രി 9:00 മണി ഓർമ്മപ്പെടുത്തൽ ഓഫ് ചെയ്തു.");
    },
    install: async function () {
      if (installPrompt) {
        installPrompt.prompt();
        try { await installPrompt.userChoice; } catch (e) { /* ignore */ }
        installPrompt = null;
      } else {
        showToast("ബ്രൗസർ മെനുവിലെ 'Add to Home Screen' / 'Install app' വഴി ഇൻസ്റ്റാൾ ചെയ്യാം.");
      }
    },

    "add-student"() {
      const mid = targetMid();
      if (!liveMadrasa(mid)) return showToast("മദ്രസ തിരഞ്ഞെടുക്കുക.", true);
      const name = $("#stName").value;
      const r = addStudent(mid, $("#stClass").value, name);
      if (r === "empty") return showToast("പേര് നൽകുക.", true);
      if (r === "dup") return showToast("ഈ വിദ്യാർത്ഥി ഈ ക്ലാസ്സിൽ നിലവിലുണ്ട്.", true);
      showToast(cleanName(name) + " — ചേർത്തു.");
      render();
    },
    "bulk-add"() {
      const mid = targetMid();
      if (!liveMadrasa(mid)) return showToast("മദ്രസ തിരഞ്ഞെടുക്കുക.", true);
      const cls = $("#stBulkClass").value;
      const lines = $("#stBulk").value.split(/\r?\n/).map(cleanName).filter(Boolean);
      if (!lines.length) return showToast("പേരുകൾ നൽകുക.", true);
      let ok = 0, dup = 0;
      lines.forEach((n) => { addStudent(mid, cls, n) === "ok" ? ok++ : dup++; });
      showToast(ok + " പേരെ ചേർത്തു" + (dup ? ", " + dup + " പേർ നേരത്തേ ഉണ്ട്" : "") + ".");
      render();
    },
    "del-student"(el) {
      const st = state.students[el.dataset.mid] && state.students[el.dataset.mid][el.dataset.id];
      if (!st) return;
      openModal({
        title: "വിദ്യാർത്ഥിയെ നീക്കം ചെയ്യണോ?", text: st.name + " (" + st.cls + ") — ഇവർക്ക് പിന്നീട് പ്രവേശിക്കാൻ കഴിയില്ല; റാങ്കിംഗിൽ നിന്നും ഒഴിവാകും.",
        ok: "നീക്കം ചെയ്യുക", danger: true,
        onOk() { st.deleted = true; saveStudent(st); showToast(st.name + " — നീക്കം ചെയ്തു."); render(); }
      });
    },

    "add-madrasa"() {
      const name = cleanName($("#mdName").value), code = cleanName($("#mdCode").value);
      if (!name || !code) return showToast("മദ്രസയുടെ പേരും കോഡും നൽകുക.", true);
      if (code.length < 6) return showToast("മദ്രസ കോഡ് കുറഞ്ഞത് 6 അക്ഷരം വേണം.", true);
      if (codeTakenByMadrasa(code)) return showToast("ഈ മദ്രസ കോഡ് നിലവിലുണ്ട്.", true);
      saveMadrasa({ id: uid("m"), name, code, openJoin: true, deleted: false });
      showToast("പുതിയ മദ്രസ ചേർത്തു.");
      render();
    },
    "edit-madrasa"(el) {
      const m = getMadrasa(el.dataset.id);
      if (!m) return;
      openModal({
        title: "മദ്രസ എഡിറ്റ് ചെയ്യുക",
        body: '<label class="field">പേര്<input id="mf_name" class="input" value="' + esc(m.name) + '"></label><label class="field">മദ്രസ കോഡ്<input id="mf_code" class="input" value="' + esc(m.code) + '"></label>' +
          '<label class="switch"><span style="font-size:.84rem;font-weight:800">കുട്ടികൾക്ക് കോഡ് ഉപയോഗിച്ച് സ്വയം ചേരാം</span><input id="mf_join" type="checkbox"' + (m.openJoin === false ? "" : " checked") + "></label>",
        onOk() {
          const name = cleanName(mv("name")), code = cleanName(mv("code"));
          if (!name || !code) return modalError("പേരും കോഡും നൽകുക."), false;
          if (code.length < 6) return modalError("മദ്രസ കോഡ് കുറഞ്ഞത് 6 അക്ഷരം വേണം."), false;
          if (codeTakenByMadrasa(code, m.id)) return modalError("ഈ കോഡ് മറ്റൊരു മദ്രസയിൽ ഉണ്ട്."), false;
          m.name = name; m.code = code; m.openJoin = !!mv("join");
          saveMadrasa(m); showToast("മദ്രസ അപ്ഡേറ്റ് ചെയ്തു."); render();
        }
      });
    },
    "del-madrasa"(el) {
      const m = getMadrasa(el.dataset.id);
      if (!m) return;
      openModal({
        title: "മദ്രസ നീക്കം ചെയ്യണോ?", text: m.name + " — ഈ മദ്രസയിലെ ഉസ്താദുമാർക്കും വിദ്യാർത്ഥികൾക്കും പ്രവേശിക്കാൻ കഴിയില്ല.", ok: "നീക്കം ചെയ്യുക", danger: true,
        onOk() { m.deleted = true; saveMadrasa(m); showToast("മദ്രസ നീക്കം ചെയ്തു."); render(); }
      });
    },

    "reset-pin"(el) {
      const st = state.students[el.dataset.mid] && state.students[el.dataset.mid][el.dataset.id];
      if (!st) return;
      openModal({
        title: "പിൻ റീസെറ്റ് ചെയ്യണോ?", text: st.name + " (" + st.cls + ") — അടുത്ത പ്രവേശനത്തിൽ പുതിയ പിൻ ഉണ്ടാക്കണം. (ഇതുവരെയുള്ള രേഖകൾ ഉസ്താദിന് കാണാം; കുട്ടിയുടെ സ്വന്തം പഴയ ചരിത്രം പുതിയ പിനിൽ കാണില്ല.)",
        ok: "റീസെറ്റ്", danger: true,
        onOk() {
          (async () => {
            try {
              if (!online()) throw new Error("ഓഫ്‌ലൈൻ");
              const a = await dbReq("pins/" + st.mid + "/" + st.id, { method: "DELETE" });
              const b = await dbReq("hasPin/" + st.mid + "/" + st.id, { method: "DELETE" });
              if (!a.ok || !b.ok) throw new Error("HTTP " + (a.ok ? b.status : a.status));
              if (state.hasPin[st.mid]) delete state.hasPin[st.mid][st.id];
              persist(); render();
              showToast(st.name + " — പിൻ റീസെറ്റ് ചെയ്തു.");
            } catch (e) { showToast("റീസെറ്റ് ചെയ്യാൻ കഴിഞ്ഞില്ല: " + ((e && e.message) || e), true); }
          })();
        }
      });
    },
    async "rebuild-board"(el) {
      if (state.session.role !== "admin") return;
      let n = 0;
      Object.keys(state.records).forEach((mid) => Object.keys(state.records[mid] || {}).forEach((sid) => {
        const cls = clsOf(mid, sid);
        Object.keys(state.records[mid][sid] || {}).forEach((d) => {
          const e = state.records[mid][sid][d];
          if (!e || typeof e !== "object") return;
          if (!state.board[mid]) state.board[mid] = {};
          if (!state.board[mid][sid]) state.board[mid][sid] = {};
          state.board[mid][sid][d] = { s: calc(e, mid, cls), updatedAt: Date.now() };
          state.dirty["board/" + mid + "/" + sid + "/" + d] = 1; n++;
        });
      }));
      persist(); scheduleSync();
      showToast(n + " ദിവസത്തെ പോയിന്റുകൾ പുതുക്കാൻ അയയ്ക്കുന്നു.");
      render();
    },

    // Ustad accounts are real Firebase Auth users, created by the admin (the code is the password)
    "add-ustad"() {
      const name = cleanName($("#usName").value), code = cleanName($("#usCode").value), mid = $("#usMid").value;
      if (!name || !code || !mid) return showToast("ഉസ്താദിന്റെ പേര്, കോഡ്, മദ്രസ എന്നിവ നൽകുക.", true);
      if (code.length < 8) return showToast("ഉസ്താദ് കോഡ് കുറഞ്ഞത് 8 അക്ഷരം വേണം.", true);
      if (codeTakenByUstad(code)) return showToast("ഈ ഉസ്താദ് കോഡ് നിലവിലുണ്ട്.", true);
      provisionUstad({ id: uid("u"), name, code, mid, deleted: false }, null).then((ok) => { if (ok) { showToast("ഉസ്താദിനെ സേവ് ചെയ്തു."); render(); } });
    },
    "edit-ustad"(el) {
      const u = state.ustads[el.dataset.id];
      if (!u) return;
      openModal({
        title: "ഉസ്താദ് എഡിറ്റ് ചെയ്യുക",
        body: '<label class="field">പേര്<input id="mf_name" class="input" value="' + esc(u.name) + '"></label><label class="field">ഉസ്താദ് കോഡ് (പാസ്‌വേഡ്)<input id="mf_code" class="input" value="' + esc(u.code) + '"></label>' +
          '<label class="field">മദ്രസ<select id="mf_mid" class="select">' + liveMadrasas().map((m) => '<option value="' + esc(m.id) + '"' + (m.id === u.mid ? " selected" : "") + ">" + esc(m.name) + "</option>").join("") + "</select></label>",
        onOk() {
          const name = cleanName(mv("name")), code = cleanName(mv("code")), mid = mv("mid") || u.mid;
          if (!name || !code) return modalError("പേരും കോഡും നൽകുക."), false;
          if (code.length < 8) return modalError("ഉസ്താദ് കോഡ് കുറഞ്ഞത് 8 അക്ഷരം വേണം."), false;
          if (codeTakenByUstad(code, u.id)) return modalError("ഈ കോഡ് മറ്റൊരു ഉസ്താദിനുണ്ട്."), false;
          const next = Object.assign({}, u, { name, code, mid });
          const needAcct = !u.authEmail || u.code !== code || u.mid !== mid;
          (needAcct ? provisionUstad(next, u) : Promise.resolve((saveUstad(Object.assign(u, { name })), true))).then((ok) => { if (ok) { showToast("ഉസ്താദ് അപ്ഡേറ്റ് ചെയ്തു."); render(); } });
        }
      });
    },
    "del-ustad"(el) {
      const u = state.ustads[el.dataset.id];
      if (!u) return;
      openModal({
        title: "ഉസ്താദിനെ നീക്കം ചെയ്യണോ?", text: u.name + " — ഈ കോഡ് ഉപയോഗിച്ച് ഇനി പ്രവേശിക്കാൻ കഴിയില്ല.", ok: "നീക്കം ചെയ്യുക", danger: true,
        onOk() {
          (async () => {
            try {
              if (u.authUid) { const r = await dbReq("staff/" + u.authUid, { method: "DELETE" }); if (!r.ok) throw new Error("HTTP " + r.status); }
              u.deleted = true; saveUstad(u); showToast("ഉസ്താദിനെ നീക്കം ചെയ്തു."); render();
            } catch (e) { showToast("നീക്കം ചെയ്യാൻ കഴിഞ്ഞില്ല: " + ((e && e.message) || e), true); }
          })();
        }
      });
    },

    "send-notice"() {
      if (state.session.role !== "ustad") return;
      const m = liveMadrasa(state.session.mid); if (!m) return;
      const t = String($("#ntText").value || "").replace(/\r/g, "").trim();
      if (!t) return showToast("അറിയിപ്പ് ടൈപ്പ് ചെയ്യുക.", true);
      m.notice = { id: uid("n"), text: t.slice(0, 500), at: Date.now(), by: state.session.name };
      saveMadrasa(m); showToast("അറിയിപ്പ് അയച്ചു. കുട്ടികൾക്ക് ഓൺലൈൻ ആകുമ്പോൾ കിട്ടും."); render();
    },
    "clear-notice"() {
      if (state.session.role !== "ustad") return;
      const m = liveMadrasa(state.session.mid); if (!m) return;
      m.notice = null; saveMadrasa(m); showToast("അറിയിപ്പ് നീക്കി."); render();
    },
    "add-custom"() {
      if (state.session.role !== "ustad") return;
      const m = liveMadrasa(state.session.mid); if (!m) return;
      const label = cleanName($("#cuLabel").value), sec = $("#cuSec").value, pts = Number($("#cuPts").value) || 10, ccls = $("#cuCls").value || "*";
      if (!label) return showToast("ഇനത്തിന്റെ പേര് നൽകുക.", true);
      if (!SECS[sec]) return;
      if (mcfg(m.id).customs.some((c) => c.sec === sec && normName(c.label) === normName(label))) return showToast("ഈ ഇനം ഇതിനകം ഉണ്ട്.", true);
      const id = uid("cu");
      if (!m.custom) m.custom = {};
      m.custom[id] = { id, label, sec, cls: ccls, points: pts, order: Date.now(), deleted: false };
      saveMadrasa(m); showToast("ഇനം ചേർത്തു."); render();
    },
    "del-custom"(el) {
      if (state.session.role !== "ustad") return;
      const m = liveMadrasa(state.session.mid), c = m && m.custom && m.custom[el.dataset.id]; if (!c) return;
      openModal({ title: "ഇനം നീക്കം ചെയ്യണോ?", text: c.label + " — കുട്ടികളുടെ പഴയ പോയിന്റിൽ നിന്ന് ഇത് ഒഴിവാകും.", ok: "നീക്കം ചെയ്യുക", danger: true, focus: false,
        onOk() { c.deleted = true; saveMadrasa(m); showToast("നീക്കം ചെയ്തു."); render(); } });
    },
    "save-own-code"() {
      if (state.session.role !== "ustad") return;
      const m = liveMadrasa(state.session.mid);
      const code = cleanName($("#ownCode").value);
      if (!m) return showToast("മദ്രസ കണ്ടെത്താൻ കഴിഞ്ഞില്ല.", true);
      if (!code) return showToast("മദ്രസ കോഡ് നൽകുക.", true);
      if (code.length < 6) return showToast("മദ്രസ കോഡ് കുറഞ്ഞത് 6 അക്ഷരം വേണം.", true);
      if (codeTakenByMadrasa(code, m.id)) return showToast("ഈ കോഡ് മറ്റൊരു മദ്രസയിൽ നിലവിലുണ്ട്.", true);
      m.code = code; saveMadrasa(m);
      showToast("നിങ്ങളുടെ മദ്രസ കോഡ് അപ്ഡേറ്റ് ചെയ്തു.");
    },

    async pdf(el) {
      const s = state.session;
      const mid = s.role === "admin" ? state.ui.mid : s.mid;
      if (!liveMadrasa(mid)) return showToast("PDF-ന് ഒരു മദ്രസ തിരഞ്ഞെടുക്കുക.", true);
      const scope = el.dataset.scope;
      const key = scope === "day" ? state.ui.lbDate : state.ui.lbMonth;
      el.disabled = true;
      showToast("PDF തയ്യാറാക്കുന്നു…");
      try {
        const bytes = await buildReport(mid, scope, key);
        downloadBytes(bytes, "madrasa-" + (scope === "day" ? "daily-" : "monthly-") + key + ".pdf");
        showToast("PDF ഡൗൺലോഡ് ചെയ്തു.");
      } catch (err) {
        showToast("PDF നിർമ്മിക്കാൻ കഴിഞ്ഞില്ല.", true);
      }
      el.disabled = false;
    },

    "modal-cancel": closeModal,
    "modal-ok"() {
      if (!modal) return;
      const r = modal.onOk && modal.onOk();
      if (r !== false) closeModal();
    }
  };

  /* =====================================================================
     9. PDF REPORT (canvas → JPEG → minimal PDF writer; works fully offline,
        and renders Malayalam correctly because the browser does the shaping)
     ===================================================================== */
  const PW = 1240, PH = 1754, MX = 80, TOP = 190, BOTTOM = 110;

  function fitText(ctx, str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    const g = segments(str);
    while (g.length > 1 && ctx.measureText(g.join("") + "…").width > maxW) g.pop();
    return g.join("") + "…";
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  class PdfDoc {
    constructor(title, subtitle) { this.title = title; this.subtitle = subtitle; this.pages = []; this.newPage(); }
    newPage() {
      const c = document.createElement("canvas");
      c.width = PW; c.height = PH;
      const x = c.getContext("2d");
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, PW, PH);
      const g = x.createLinearGradient(0, 0, PW, 0);
      g.addColorStop(0, "#047857"); g.addColorStop(1, "#10b981");
      x.fillStyle = g; x.fillRect(0, 0, PW, 160);
      this.c = c; this.x = x; this.pages.push(c);
      this.t("മദ്രസ ദൈനംദിന ട്രാക്കർ", MX, 38, { size: 22, weight: 600, color: "#a7f3d0", maxW: PW - 2 * MX });
      this.t(this.title, MX, 88, { size: 42, weight: 800, color: "#fff", maxW: PW - 2 * MX });
      this.t(this.subtitle, MX, 132, { size: 27, weight: 600, color: "#d1fae5", maxW: PW - 2 * MX });
      this.y = TOP;
    }
    t(str, x, y, o) {
      o = o || {};
      const ctx = this.x;
      ctx.font = (o.weight || 500) + " " + (o.size || 26) + "px " + FONT;
      ctx.fillStyle = o.color || "#0f172a";
      ctx.textAlign = o.align || "left";
      ctx.textBaseline = "middle";
      let s = String(str);
      if (o.maxW) s = fitText(ctx, s, o.maxW);
      ctx.fillText(s, x, y);
    }
    ensure(h) { if (this.y + h > PH - BOTTOM) this.newPage(); }
    heading(text) {
      this.ensure(110);
      this.y += 10;
      this.x.fillStyle = "#059669"; rr(this.x, MX, this.y, 10, 46, 5); this.x.fill();
      this.t(text, MX + 28, this.y + 24, { size: 33, weight: 800, color: "#064e3b", maxW: PW - 2 * MX - 28 });
      this.y += 70;
    }
    winnerCard(label, w) {
      this.ensure(240);
      const x = this.x, h = 200;
      x.fillStyle = "#fffbeb"; rr(x, MX, this.y, PW - 2 * MX, h, 28); x.fill();
      x.strokeStyle = "#fcd34d"; x.lineWidth = 3; x.stroke();
      x.fillStyle = "#f5b301"; x.beginPath(); x.arc(MX + 100, this.y + h / 2, 58, 0, Math.PI * 2); x.fill();
      this.t("1", MX + 100, this.y + h / 2 + 2, { size: 70, weight: 800, color: "#fff", align: "center" });
      const tx = MX + 190, mw = PW - MX - tx - 30;
      this.t(label, tx, this.y + 46, { size: 26, weight: 700, color: "#92400e", maxW: mw });
      if (w) {
        this.t(w.names, tx, this.y + 104, { size: 46, weight: 800, color: "#451a03", maxW: mw });
        this.t((w.cls ? w.cls + " • " : "") + w.score + " പോയിന്റ്", tx, this.y + 156, { size: 28, weight: 600, color: "#78350f", maxW: mw });
      } else {
        this.t("വിജയി ഇല്ല", tx, this.y + 112, { size: 36, weight: 700, color: "#a16207", maxW: mw });
      }
      this.y += h + 34;
    }
    table(cols, rows, gold) {
      const RH = 62, total = PW - 2 * MX;
      const drawHead = () => {
        this.ensure(RH * 2);
        this.x.fillStyle = "#d1fae5"; rr(this.x, MX, this.y, total, RH - 8, 14); this.x.fill();
        let cx = MX;
        cols.forEach((c) => {
          const w = c.w * total;
          this.t(c.label, c.align === "right" ? cx + w - 20 : c.align === "center" ? cx + w / 2 : cx + 20, this.y + (RH - 8) / 2, { size: 23, weight: 800, color: "#064e3b", align: c.align, maxW: w - 40 });
          cx += w;
        });
        this.y += RH;
      };
      drawHead();
      rows.forEach((r, i) => {
        if (this.y + RH > PH - BOTTOM) { this.newPage(); drawHead(); }
        const hot = gold && r.hot;
        this.x.fillStyle = hot ? "#fef3c7" : i % 2 ? "#f8fafc" : "#ffffff";
        this.x.fillRect(MX, this.y, total, RH);
        this.x.fillStyle = "#e2e8f0"; this.x.fillRect(MX, this.y + RH - 1, total, 1);
        let cx = MX;
        cols.forEach((c, ci) => {
          const w = c.w * total;
          this.t(r.cells[ci], c.align === "right" ? cx + w - 20 : c.align === "center" ? cx + w / 2 : cx + 20, this.y + RH / 2, { size: 26, weight: ci === 1 && hot ? 800 : c.bold ? 800 : 500, align: c.align, maxW: w - 40, color: c.color || "#0f172a" });
          cx += w;
        });
        this.y += RH;
      });
      this.y += 30;
    }
    finish() {
      const n = this.pages.length;
      this.pages.forEach((c, i) => {
        const x = c.getContext("2d");
        x.fillStyle = "#e2e8f0"; x.fillRect(MX, PH - 84, PW - 2 * MX, 2);
        x.font = "500 22px " + FONT; x.fillStyle = "#64748b"; x.textBaseline = "middle";
        x.textAlign = "left"; x.fillText("തയ്യാറാക്കിയത്: " + fmtDate(todayIso()), MX, PH - 50);
        x.textAlign = "right"; x.fillText("പേജ് " + (i + 1) + " / " + n, PW - MX, PH - 50);
      });
      return this.pages;
    }
  }

  async function ensureFonts() {
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.all([500, 600, 700, 800].map((w) => document.fonts.load(w + ' 26px "Noto Sans Malayalam"', "മലയാളം 1234")));
        await document.fonts.ready;
      }
    } catch (e) { /* system fallback fonts will be used */ }
  }

  function reportData(mid, scope, key) {
    return {
      all: standings([mid], "all", scope, key),
      classes: CLASSES.map((c) => ({ cls: c, rows: standings([mid], c, scope, key) })).filter((x) => x.rows.length)
    };
  }

  async function buildReport(mid, scope, key) {
    const m = getMadrasa(mid);
    const data = reportData(mid, scope, key);
    await ensureFonts();
    const isMonth = scope === "month";
    const doc = new PdfDoc(m.name, (isMonth ? "മാസ റിപ്പോർട്ട് • " + fmtMonth(key) : "ദിവസ റിപ്പോർട്ട് • " + fmtDate(key)) + " • " + data.all.length + " വിദ്യാർത്ഥികൾ");

    doc.winnerCard(isMonth ? "മദ്രസ മാസ വിജയി" : "മദ്രസ ദിവസ വിജയി", winText(data.all));

    doc.heading("ക്ലാസ് തിരിച്ചുള്ള " + (isMonth ? "മാസ" : "ദിവസ") + " വിജയികൾ");
    if (data.classes.length) {
      doc.table(
        [{ label: "ക്ലാസ്സ്", w: 0.24, bold: true }, { label: "വിജയി", w: 0.5 }, { label: "പോയിന്റ്", w: 0.14, align: "right", bold: true, color: "#047857" }, { label: "കുട്ടികൾ", w: 0.12, align: "right" }],
        data.classes.map((x) => { const w = winText(x.rows); return { cells: [x.cls, w ? w.names : "—", w ? String(w.score) : "—", String(x.rows.length)] }; })
      );
    } else {
      doc.t("വിദ്യാർത്ഥികളെ ചേർത്തിട്ടില്ല.", MX, doc.y + 20, { size: 26, color: "#64748b" }); doc.y += 60;
    }

    const top = data.all.filter((r) => r.score > 0).slice(0, 10);
    doc.heading("മദ്രസ ടോപ്പ് " + (top.length ? top.length : 10));
    if (top.length) {
      doc.table(
        [{ label: "റാങ്ക്", w: 0.12, align: "center", bold: true }, { label: "പേര്", w: 0.46 }, { label: "ക്ലാസ്സ്", w: 0.26 }, { label: "പോയിന്റ്", w: 0.16, align: "right", bold: true, color: "#047857" }],
        top.map((r) => ({ hot: r.rank === 1, cells: [String(r.rank), r.s.name, r.s.cls, String(r.score)] })), true
      );
    } else {
      doc.t("ഈ കാലയളവിൽ പോയിന്റുകൾ ഇല്ല.", MX, doc.y + 20, { size: 26, color: "#64748b" }); doc.y += 60;
    }

    data.classes.forEach((x) => {
      const rows = x.rows.filter((r) => r.score > 0).slice(0, 5);
      doc.heading(x.cls + " — ടോപ്പ് " + (rows.length || 5));
      if (rows.length) {
        doc.table(
          [{ label: "റാങ്ക്", w: 0.14, align: "center", bold: true }, { label: "പേര്", w: 0.64 }, { label: "പോയിന്റ്", w: 0.22, align: "right", bold: true, color: "#047857" }],
          rows.map((r) => ({ hot: r.rank === 1, cells: [String(r.rank), r.s.name, String(r.score)] })), true
        );
      } else {
        doc.t("പോയിന്റുകൾ ഇല്ല.", MX, doc.y + 10, { size: 24, color: "#64748b" }); doc.y += 56;
      }
    });

    return pdfFromCanvases(doc.finish());
  }

  function pdfFromCanvases(canvases) {
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let pos = 0;
    const push = (d) => { const b = typeof d === "string" ? enc.encode(d) : d; chunks.push(b); pos += b.length; };
    const obj = (n, fn) => { offsets[n] = pos; push(n + " 0 obj\n"); fn(); push("endobj\n"); };
    const n = canvases.length;
    const PWpt = 595.28, PHpt = 841.89;

    push("%PDF-1.4\n");
    obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>\n"));
    obj(2, () => {
      const kids = canvases.map((_, i) => (3 + i * 3) + " 0 R").join(" ");
      push("<< /Type /Pages /Kids [" + kids + "] /Count " + n + " >>\n");
    });
    canvases.forEach((c, i) => {
      const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
      const b64 = c.toDataURL("image/jpeg", 0.92).split(",")[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      obj(pg, () => push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PWpt + " " + PHpt + "] /Resources << /XObject << /Im0 " + im + " 0 R >> >> /Contents " + ct + " 0 R >>\n"));
      const content = "q " + PWpt + " 0 0 " + PHpt + " 0 0 cm /Im0 Do Q";
      obj(ct, () => push("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream\n"));
      obj(im, () => {
        push("<< /Type /XObject /Subtype /Image /Width " + c.width + " /Height " + c.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + bytes.length + " >>\nstream\n");
        push(bytes);
        push("\nendstream\n");
      });
    });
    const total = 3 + n * 3;
    const xref = pos;
    let x = "xref\n0 " + total + "\n0000000000 65535 f \n";
    for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    push(x + "trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF");

    const out = new Uint8Array(pos);
    let o = 0;
    chunks.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  }

  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  /* =====================================================================
     10. REMINDER (9:00 PM) & INSTALL
     ===================================================================== */
  let installPrompt = null;

  function checkReminder() {
    const s = state.session;
    if (!state.reminder || !s || s.role !== "student") return;
    const now = new Date();
    if (now.getHours() < 21) return;
    const today = todayIso();
    if (state.lastRemind === today) return;
    if (recordOf(s.mid, s.userId, today)) return; // already filled today
    state.lastRemind = today;
    persist();
    showToast("രാത്രി 9:00 മണിയായി! ഇന്നത്തെ മദ്രസ ദൈനംദിന രേഖ പൂരിപ്പിക്കുക.");
    if ("Notification" in window && Notification.permission === "granted") {
      const opts = { body: "ഇന്നത്തെ രേഖപ്പെടുത്തൽ പൂർത്തിയാക്കുക.", icon: "icons/icon-192.png", tag: "mt-9pm" };
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((r) => r.showNotification("മദ്രസ ദൈനംദിന ട്രാക്കർ", opts)).catch(() => { try { new Notification("മദ്രസ ദൈനംദിന ട്രാക്കർ", opts); } catch (e) { /* ignore */ } });
      } else {
        try { new Notification("മദ്രസ ദൈനംദിന ട്രാക്കർ", opts); } catch (e) { /* ignore */ }
      }
    }
  }

  /* =====================================================================
     11. EVENT WIRING & BOOT
     ===================================================================== */
  function wire() {
    document.addEventListener("click", (ev) => {
      const el = ev.target.closest("[data-act]");
      if (!el) return;
      const act = el.dataset.act;
      if (act === "modal-bg") { if (ev.target === el) closeModal(); return; }
      const fn = actions[act];
      if (fn) fn(el, ev);
    });

    document.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el.dataset && el.dataset.ep) {
        const v = el.type === "checkbox" ? el.checked : el.dataset.num ? Number(el.value) : el.value;
        editEntry(el.dataset.ep, v);
        return;
      }
      if (el.dataset && el.dataset.ui) {
        let v = el.value;
        if ((el.dataset.ui === "date" || el.dataset.ui === "lbDate") && (!v || v > todayIso())) v = todayIso();
        state.ui[el.dataset.ui] = v;
        persist(); render();
        return;
      }
      if (el.dataset && el.dataset.vis) {
        if (state.session && state.session.role === "ustad") {
          const m = liveMadrasa(state.session.mid), key = el.dataset.vis, sc = state.ui.cfgCls || "*";
          if (m) {
            // carry over old section-level hides into per-item rules once
            if (m.hide) { Object.keys(LEGACY_SEC).forEach((k) => { if (LEGACY_SEC[k] && m.hide[LEGACY_SEC[k]]) { m.vis = m.vis || {}; if (!m.vis[k]) m.vis[k] = { "*": false }; } }); m.hide = null; }
            m.vis = m.vis || {};
            const v = m.vis[key] = m.vis[key] || {};
            if (sc === "*") { Object.keys(v).forEach((k) => { delete v[k]; }); v["*"] = el.checked; }
            else v[sc] = el.checked;
            saveMadrasa(m); showToast(el.checked ? "കാണിക്കും." : "ഒഴിവാക്കി."); render();
          }
        }
        return;
      }
      if (el.dataset && el.dataset.join) {
        const m = getMadrasa(el.dataset.join);
        if (m) { m.openJoin = el.checked; saveMadrasa(m); showToast(el.checked ? "കുട്ടികൾക്ക് കോഡ് ഉപയോഗിച്ച് ചേരാം." : "ചേർത്ത വിദ്യാർത്ഥികൾക്ക് മാത്രം പ്രവേശനം."); }
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && modal) { closeModal(); return; }
      if (ev.key === "Enter" && !state.session && (ev.target.id === "inName" || ev.target.id === "inCode" || ev.target.id === "inPin")) { ev.preventDefault(); loginSubmit(); }
      if (ev.key === "Enter" && !state.session && ev.target.id === "inStaff") { ev.preventDefault(); staffLogin("auto"); }
      if (ev.key === "Enter" && modal && ev.target.tagName === "INPUT") { ev.preventDefault(); actions["modal-ok"](); }
    });

    window.addEventListener("online", () => { updateStrip(); sync(false); });
    window.addEventListener("offline", updateStrip);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") { checkReminder(); if (online() && (pendingCount() || Date.now() - state.lastSync > 60000)) sync(false); }
      else persistNow();
    });
    window.addEventListener("pagehide", persistNow);

    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; updateStrip(); });
    window.addEventListener("appinstalled", () => { installPrompt = null; updateStrip(); showToast("ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്തു."); });
  }

  async function boot() {
    await loadState();
    wire();
    validateSession();
    render();
    if (!loadOk) {
      const t = setInterval(async () => {
        try { await withTimeout(idbGet("state"), 5000); clearInterval(t); location.reload(); } catch (e) { dbPromise = null; }
      }, 4000);
      openModal({
        title: "ഡാറ്റ വായിക്കാൻ കഴിഞ്ഞില്ല", focus: false, ok: "ലളിതമായ സേവ് ഉപയോഗിക്കുക",
        text: "ഈ ഫോണിലെ പഴയ ഡാറ്റ ഇപ്പോൾ വായിക്കാൻ കഴിയുന്നില്ല (കാരണം: " + (idbErr || "സമയം കഴിഞ്ഞു") + "). ആപ്പ് പൂർണമായി അടച്ച് വീണ്ടും തുറന്ന് നോക്കുക. അപ്പോഴും വരുന്നുണ്ടെങ്കിൽ ഈ ബട്ടൺ അമർത്തുക: ഇനി മുതൽ ബ്രൗസറിന്റെ ലളിതമായ സ്റ്റോറേജിൽ സേവ് ചെയ്യും. പഴയ ഡാറ്റ തിരിച്ചുവരണമെന്നില്ല.",
        onOk() { try { localStorage.setItem("mt_lsonly", "1"); } catch (e) { /* ignore */ } clearInterval(t); loadOk = true; persistNow(); showToast("ഇനി സേവ് ചെയ്യാം."); }
      });
    }

    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    if (online()) sync(false);
    setInterval(() => { if (online() && pendingCount() && !syncing) sync(false); }, 60000);
    setInterval(checkReminder, 30000);
    checkReminder();

    if (window.__MT_TEST) {
      window.__MT = { state: () => state, calc, standings, addStudent, saveStudent, saveMadrasa, saveUstad, buildReport, reportData, createDefaultEntry, render, loginSubmit, mergeRemote, studentId, monthScore, dayScore, setState: (s) => { state = s; }, pdfFromCanvases };
    }
  }

  boot();
})();
