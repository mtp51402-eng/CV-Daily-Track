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
    ADMIN_HASH: 8032031086151853, // cyrb53("cv313") — the code itself is not stored in plain text
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
      madrasas: {
        m_seed1: { id: "m_seed1", name: "ദാറുൽ ഹുദാ മദ്രസ", code: "MDR101", openJoin: true, deleted: false, updatedAt: 0 },
        m_seed2: { id: "m_seed2", name: "നൂറുൽ ഇസ്ലാം മദ്രസ", code: "MDR202", openJoin: true, deleted: false, updatedAt: 0 }
      },
      ustads: {
        u_seed1: { id: "u_seed1", name: "ഉസ്താദ് അഹമ്മദ്", code: "UST101", mid: "m_seed1", deleted: false, updatedAt: 0 }
      },
      students: {}, // students[mid][sid]
      records: {}, // records[mid][sid][date]
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

  async function loadState() {
    const base = defaultState();
    let saved = null;
    try { saved = await withTimeout(idbGet("state"), 3000); } catch (e) { /* fall through to localStorage */ }
    if (!saved) {
      try { const raw = localStorage.getItem("mt_state_v2"); if (raw) saved = JSON.parse(raw); } catch (e) { /* ignore */ }
    }
    if (saved && typeof saved === "object") {
      state = Object.assign(base, saved);
      state.ui = Object.assign(base.ui, saved.ui || {});
      ["madrasas", "ustads", "students", "records", "dirty"].forEach((k) => { if (!state[k] || typeof state[k] !== "object") state[k] = base[k]; });
    }
    // Always open on today's date
    state.ui.date = todayIso();
    state.ui.lbDate = todayIso();
    state.ui.lbMonth = todayIso().slice(0, 7);
  }

  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 250);
  }
  async function persistNow() {
    clearTimeout(persistTimer);
    try {
      await withTimeout(idbSet("state", JSON.parse(JSON.stringify(state))), 4000);
    } catch (e) {
      try { localStorage.setItem("mt_state_v2", JSON.stringify(state)); } catch (e2) { /* storage full */ }
    }
  }

  /* =====================================================================
     4. DATA ACCESS (registry, records, scoring)
     ===================================================================== */
  const liveMadrasas = () => Object.values(state.madrasas).filter((m) => !m.deleted).sort((a, b) => a.name.localeCompare(b.name, "ml"));
  const getMadrasa = (id) => state.madrasas[id] || null;
  const liveMadrasa = (id) => { const m = state.madrasas[id]; return m && !m.deleted ? m : null; };
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
  function isAdminCode(raw) {
    const t = normName(raw).replace(/\s+/g, "");
    return t.length > 0 && cyrb53(t) === CFG.ADMIN_HASH;
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

  function calc(entry) {
    if (!entry) return 0;
    let t = 0;
    const ex = entry.exemption || {};
    const full = !!(ex.pattilla && ex.poornamayum);
    const exSet = full ? new Set(PRAYERS.map((p) => p.id)) : rangeExempt(entry);
    if (!full) {
      PRAYERS.forEach((p) => {
        if (exSet.has(p.id)) return;
        const st = (entry.fardh && entry.fardh[p.id]) || "none";
        if (st === "jamaah") t += W.jamaah; else if (st === "prayed") t += W.prayed; else if (st === "qada") t += W.qada;
      });
      const su = entry.sunnah || {};
      if (su.witr) t += W.witr;
      if (su.duha) t += W.duha;
      if (su.tahajjud) t += W.tahajjud;
      Object.values(su.rawatib || {}).forEach((r) => {
        const n = Number(r) || 0;
        if (n > 0 && n !== 1 && n !== 3) t += (n / 2) * W.rawatibPerTwo;
      });
      const q = entry.quran || {};
      if (q.classDone) t += W.quranClassDone;
      if (q.surahMulk) t += W.surahMulk;
      if (q.surahWaqiah) t += W.surahWaqiah;
      if (isFriday(entry.date)) {
        const f = entry.friday || {};
        if (f.kahf) t += W.fridayKahf;
        if (f.salawat) t += W.fridaySalawat;
        if (f.nails) t += W.fridayNails;
      }
    }
    const d = entry.dhikr || {};
    if (d.haddad) t += W.haddad;
    if (d.istighfar100) t += W.istighfar100;
    if (d.salawat100) t += W.salawat100;
    const h = entry.habits || {};
    t += (W.mobile[h.mobileUsage] || 0) + (W.book[Number(h.bookReading)] || 0);
    return t;
  }

  function dayScore(mid, sid, date) { return calc(recordOf(mid, sid, date)); }
  function monthScore(mid, sid, month) {
    const by = (state.records[mid] && state.records[mid][sid]) || {};
    let t = 0;
    for (const d in by) if (d.slice(0, 7) === month) t += calc(by[d]);
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

  function url(path) {
    return CFG.DB + "/" + CFG.ROOT + (path ? "/" + path : "") + ".json";
  }
  async function fetchJson(path) {
    const r = await fetch(url(path), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
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
    return ch;
  }

  async function pull() {
    const s = state.session;
    let changed = false;
    if (!s || s.role === "admin") {
      if (!s) {
        const [m, u] = await Promise.all([fetchJson("madrasas"), fetchJson("ustads")]);
        changed = mergeRemote({ madrasas: m, ustads: u });
      } else {
        changed = mergeRemote(await fetchJson(""));
      }
    } else {
      const jobs = [fetchJson("madrasas"), fetchJson("students/" + s.mid), fetchJson("records/" + s.mid)];
      if (s.role === "ustad") jobs.push(fetchJson("ustads"));
      const r = await Promise.all(jobs);
      changed = mergeRemote({
        madrasas: r[0],
        students: r[1] ? { [s.mid]: r[1] } : null,
        records: r[2] ? { [s.mid]: r[2] } : null,
        ustads: r[3] || null
      });
    }
    return changed;
  }

  async function push() {
    const paths = Object.keys(state.dirty);
    for (let i = 0; i < paths.length; i += 4) {
      const chunk = paths.slice(i, i + 4);
      await Promise.all(chunk.map(async (p) => {
        const val = getPath(p);
        if (val === undefined) { delete state.dirty[p]; return; }
        const stamp = val.updatedAt;
        const r = await fetch(url(p), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(val) });
        if (!r.ok) throw new Error("HTTP " + r.status);
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
    if (syncing) return manual ? "busy" : undefined;
    if (!online()) { updateStrip(); return "offline"; }
    syncing = true;
    syncState = "busy";
    updateStrip();
    let changed = false;
    syncErr = "";
    // Push first (so local work is never blocked by a failing read), then pull.
    try { await push(); } catch (e) { syncErr = String((e && e.message) || e); }
    try { changed = await pull(); } catch (e) { syncErr = syncErr || String((e && e.message) || e); }
    if (syncErr) syncState = "err";
    else { state.lastSync = Date.now(); syncState = "ok"; validateSession(); }
    syncing = false;
    persist();
    updateStrip();
    if (changed && syncState === "ok" && !modal) render();
    return syncState;
  }

  // If the account was removed remotely, sign out
  function validateSession() {
    const s = state.session;
    if (!s || s.role === "admin") return;
    let bad = false;
    if (!liveMadrasa(s.mid)) bad = true;
    if (s.role === "ustad") { const u = state.ustads[s.userId]; if (!u || u.deleted) bad = true; }
    if (s.role === "student") { const st = state.students[s.mid] && state.students[s.mid][s.userId]; if (st && st.deleted) bad = true; }
    if (bad) {
      state.session = null;
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
      let html = (s.role === "student" ? quoteCard() : "") + sessionCard();
      if (s.role === "student") html += tab === "rank" ? rankView() : trackerView();
      else if (tab === "students") html += studentsView();
      else if (tab === "ustads" && s.role === "admin") html += ustadsView();
      else if (tab === "madrasas" && s.role === "admin") html += madrasasView();
      else if (tab === "settings" && s.role === "ustad") html += settingsView();
      else html += rankView();
      app.innerHTML = html;
    }
    window.scrollTo(0, y);
    updateStrip();
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
      '<div class="hero"><img class="logo" src="icons/icon-192.png" alt="" /><h2>മദ്രസ പ്രവേശനം</h2><p class="muted">വിദ്യാർത്ഥികൾ പേരും ക്ലാസ്സും മദ്രസ കോഡും നൽകുക</p></div>' +
      '<div class="stack" style="gap:6px"><label class="field" for="inName">പേര്</label>' +
      '<div class="input-plus"><input id="inName" class="input" type="text" autocomplete="off" placeholder="പേര്" />' +
      '<button type="button" class="btn" data-act="login" aria-label="പ്രവേശനം">+</button></div>' +
      '<p class="muted">ഉസ്താദ് / അഡ്മിൻ ആണെങ്കിൽ നിങ്ങളുടെ കോഡ് ഇവിടെ നൽകുക.</p>' +
      '<p id="errName" class="err" hidden></p></div>' +
      '<label class="field">ക്ലാസ്സ്<select id="inClass" class="select">' + CLASSES.map((c) => "<option>" + c + "</option>").join("") + "</select></label>" +
      '<div class="stack" style="gap:8px"><label class="field" for="inCode">മദ്രസ കോഡ്</label>' +
      '<input id="inCode" class="input" type="password" autocomplete="off" placeholder="മദ്രസ കോഡ് നൽകുക" />' +
      '<div id="resolved" class="resolved" hidden><span>മദ്രസ:</span><span id="resolvedName"></span></div>' +
      '<p id="errCode" class="err" hidden></p></div>' +
      '<button type="button" class="btn block" data-act="login">പ്രവേശനം</button></section>';
  }

  function loginSubmit() {
    const nameEl = $("#inName"), codeEl = $("#inCode");
    const errName = $("#errName"), errCode = $("#errCode");
    errName.hidden = true; errCode.hidden = true;
    const raw = cleanName(nameEl.value);
    if (!raw) { errName.textContent = "പേര് നൽകുക."; errName.hidden = false; nameEl.focus(); return; }

    if (isAdminCode(raw)) {
      startSession({ role: "admin", userId: "admin", mid: "", name: "അഡ്മിൻ", cls: "" }, "rank");
      showToast("അഡ്മിൻ പാനൽ തുറന്നു.");
      return;
    }
    const u = findUstadByCode(raw);
    if (u) {
      const m = liveMadrasa(u.mid);
      if (!m) { errName.textContent = "ഈ ഉസ്താദിന്റെ മദ്രസ ഇപ്പോൾ സജീവമല്ല."; errName.hidden = false; return; }
      startSession({ role: "ustad", userId: u.id, mid: m.id, name: u.name, cls: "" }, "rank");
      showToast(u.name + " — ഉസ്താദ് പാനൽ തുറന്നു.");
      return;
    }

    const m = findMadrasaByCode(codeEl.value);
    if (!m) {
      errCode.textContent = online() || Object.keys(state.madrasas).length > 2
        ? "ശരിയായ മദ്രസ കോഡ് നൽകുക."
        : "ശരിയായ മദ്രസ കോഡ് നൽകുക. ആദ്യമായി ഉപയോഗിക്കുമ്പോൾ ഇന്റർനെറ്റ് ആവശ്യമാണ്.";
      errCode.hidden = false; codeEl.focus(); return;
    }
    const cls = $("#inClass").value || CLASSES[0];
    const id = studentId(m.id, cls, raw);
    const ex = state.students[m.id] && state.students[m.id][id];
    if (ex && ex.deleted) { errName.textContent = "നിങ്ങളെ ഈ മദ്രസയിൽ നിന്ന് നീക്കം ചെയ്തിരിക്കുന്നു. ഉസ്താദിനെ ബന്ധപ്പെടുക."; errName.hidden = false; return; }
    if (!ex) {
      if (m.openJoin === false) { errName.textContent = "ഈ പേര് ഈ ക്ലാസ്സിൽ രജിസ്റ്റർ ചെയ്തിട്ടില്ല. ഉസ്താദിനോട് ചേർക്കാൻ ആവശ്യപ്പെടുക."; errName.hidden = false; return; }
      saveStudent({ id, mid: m.id, name: raw, cls, deleted: false });
    }
    startSession({ role: "student", userId: id, mid: m.id, name: ex ? ex.name : raw, cls }, "tracker");
    showToast(raw + " — സ്വാഗതം.");
  }

  function startSession(sess, tab) {
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
    const e = currentEntry(false);
    const ex = e.exemption;
    const pat = !!ex.pattilla;
    const full = pat && !!ex.poornamayum;
    const exSet = full ? new Set(PRAYERS.map((p) => p.id)) : rangeExempt(e);
    const fri = isFriday(date);
    const score = calc(e);

    let h = '<section class="total"><div><div class="lbl">' + (date === todayIso() ? "ഇന്നത്തെ പോയിന്റ്" : "ഈ ദിവസത്തെ പോയിന്റ്") + '</div><div class="num">' + score + '</div><div class="lbl" style="margin-top:4px">' + esc(fmtDate(date)) + '</div></div>' +
      '<input type="date" data-ui="date" value="' + date + '" max="' + todayIso() + '" aria-label="തീയതി"></section>';

    // Exemption
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

    if (!full) {
      // Fardh
      h += '<section class="card stack"><h2>ഫർള് നിസ്കാരങ്ങൾ</h2>' + PRAYERS.map((p) => {
        const exm = exSet.has(p.id);
        const cur = e.fardh[p.id] || "none";
        const b = (st, label, extra) => '<button type="button" class="choice ' + (extra || "") + (!exm && cur === st ? " on" : "") + '" data-act="fardh" data-p="' + p.id + '" data-s="' + st + '"' + (exm ? " disabled" : "") + ">" + label + "</button>";
        return '<div class="sub stack" style="gap:10px"><div class="row between"><b style="font-size:.9rem">' + p.label + "</b>" + (exm ? '<span class="pill">ഇളവ്</span>' : "") + "</div>" +
          '<div class="status-grid">' + b("qada", "ഖളാഅ്", "qada") + b("missed", "നിസ്കരിച്ചിട്ടില്ല", "miss") + b("prayed", "നിസ്കരിച്ചു") + b("jamaah", "ജമാഅത്ത്") + "</div></div>";
      }).join("") + "</section>";

      // Sunnah
      h += '<section class="card stack"><h2>സുന്നത്ത് നിസ്കാരങ്ങൾ</h2><div class="grid3">' +
        chk("sunnah.witr", "വിത്ർ", e.sunnah.witr, "col") + chk("sunnah.duha", "ളുഹാ", e.sunnah.duha, "col") + chk("sunnah.tahajjud", "തഹജ്ജുദ്", e.sunnah.tahajjud, "col") + "</div>" +
        '<div class="grid2">' + RAWATIB.map((c) => {
          const cur = Number(e.sunnah.rawatib[c.id]) || 0;
          return '<label class="sub field">' + c.label + '<select class="select sm" data-ep="sunnah.rawatib.' + c.id + '" data-num="1">' +
            c.choices.map((v) => '<option value="' + v + '"' + (cur === v ? " selected" : "") + ">" + (v === 0 ? "നിസ്കരിച്ചിട്ടില്ല" : v + " റക്അത്ത്") + "</option>").join("") + "</select></label>";
        }).join("") + "</div></section>";
    }

    // Dhikr
    h += '<section class="card stack"><h2>ദിക്ർ &amp; ഔറാദ്</h2><div class="grid2 keep" style="grid-template-columns:1fr">' +
      chk("dhikr.haddad", "ഹദ്ദാദ്", e.dhikr.haddad) + chk("dhikr.istighfar100", "ഇസ്തിഗ്ഫാർ 100", e.dhikr.istighfar100) + chk("dhikr.salawat100", "സ്വലാത്ത് 100", e.dhikr.salawat100) + "</div></section>";

    // Quran — tick only
    if (!full) {
      h += '<section class="card stack"><h2>ഖുർആൻ &amp; സൂറത്തുകൾ</h2>' +
        chk("quran.classDone", "ഖുർആൻ — ഇന്ന് ക്ലാസിൽ എടുത്ത ഭാഗം", e.quran.classDone) +
        chk("quran.surahMulk", "സൂറത്തുൽ മുൽക്ക്", e.quran.surahMulk) +
        chk("quran.surahWaqiah", "സൂറത്തുൽ വാഖിയ", e.quran.surahWaqiah) + "</section>";
    }

    // Friday (only on Fridays)
    if (fri && !full) {
      h += '<section class="card stack"><div class="row between"><h2>വെള്ളിയാഴ്ച</h2><span class="role-tag">ജുമുഅ ദിനം</span></div>' +
        chk("friday.kahf", "സൂറത്തുൽ കഹ്ഫ്", e.friday.kahf) + chk("friday.salawat", "പ്രത്യേക സ്വലാത്ത്", e.friday.salawat) + chk("friday.nails", "നഖം വെട്ടുക", e.friday.nails) + "</section>";
    } else if (fri && full) {
      h += "";
    }

    // Habits
    const mo = e.habits.mobileUsage, bk = Number(e.habits.bookReading) || 0;
    h += '<section class="card"><h2 style="margin-bottom:12px">ദൈനംദിന ശീലങ്ങൾ</h2><div class="grid2">' +
      '<label class="sub field">മൊബൈൽ ഉപയോഗം<select class="select sm" data-ep="habits.mobileUsage">' +
      [["none", "ഉപയോഗിച്ചിട്ടില്ല"], ["under30", "30 മിനിറ്റിൽ താഴെ"], ["30to60", "30 - 60 മിനിറ്റ്"], ["over60", "1 മണിക്കൂറിൽ കൂടുതൽ"]].map((o) => '<option value="' + o[0] + '"' + (mo === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label>" +
      '<label class="sub field">പുസ്തകം വായിച്ച സമയം<select class="select sm" data-ep="habits.bookReading" data-num="1">' +
      [[0, "വായിച്ചില്ല"], [15, "15 മിനിറ്റ്"], [30, "30 മിനിറ്റ്"], [45, "45+ മിനിറ്റ്"]].map((o) => '<option value="' + o[0] + '"' + (bk === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></label></div></section>";

    h += '<section class="card stack"><button type="button" class="btn block" data-act="save">' + ICON.download.replace("M12 3v12M7 10l5 5 5-5M5 21h14", "M5 12l5 5 9-10") + "ഇന്നത്തെ രേഖ സേവ് ചെയ്യുക</button>" +
      '<p class="muted" style="text-align:center">മാറ്റങ്ങൾ ഓരോന്നും ഫോണിൽ ഉടൻ സേവ് ആകും. ഇന്റർനെറ്റ് കിട്ടുമ്പോൾ സ്വയം അയയ്ക്കും.</p></section>';
    return h;
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
    markDirty("records/" + s.mid + "/" + s.userId + "/" + state.ui.date);
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
        '<button type="button" class="icon-btn danger" data-act="del-student" data-mid="' + esc(st.mid) + '" data-id="' + esc(st.id) + '" aria-label="നീക്കം ചെയ്യുക">' + ICON.trash + "</button></div>").join("");
    });
    h += total ? body : '<div class="empty">വിദ്യാർത്ഥികളില്ല.</div>';
    h += "</section>";
    return h;
  }

  /* ---------- Admin: madrasas ---------- */
  function madrasasView() {
    let h = '<section class="card stack"><h3>പുതിയ മദ്രസ ചേർക്കുക</h3><input id="mdName" class="input" type="text" placeholder="മദ്രസയുടെ പേര്" autocomplete="off"><input id="mdCode" class="input" type="text" placeholder="മദ്രസ കോഡ്" autocomplete="off"><button type="button" class="btn block" data-act="add-madrasa">' + ICON.plus + "മദ്രസ ചേർക്കുക</button></section>";
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
  function settingsView() {
    const m = liveMadrasa(state.session.mid);
    if (!m) return '<section class="card empty">മദ്രസ കണ്ടെത്താൻ കഴിഞ്ഞില്ല.</section>';
    return '<section class="card stack"><div class="card-head" style="margin:0"><div><h3>എന്റെ മദ്രസ കോഡ്</h3><p class="muted">നിങ്ങളുടെ മദ്രസയുടെ കോഡ് മാത്രമേ ഇവിടെ കാണാനും മാറ്റാനും സാധിക്കൂ.</p></div></div>' +
      '<div class="sub" style="font-weight:800">' + esc(m.name) + '</div><input id="ownCode" class="input" type="text" value="' + esc(m.code) + '" placeholder="മദ്രസ കോഡ്" autocomplete="off"><button type="button" class="btn block" data-act="save-own-code">മദ്രസ കോഡ് സേവ് ചെയ്യുക</button></section>' +
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

  const actions = {
    login: loginSubmit,
    logout() { state.session = null; persist(); render(); },
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
      markDirty("records/" + sess.mid + "/" + sess.userId + "/" + state.ui.date);
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

    "add-ustad"() {
      const name = cleanName($("#usName").value), code = cleanName($("#usCode").value), mid = $("#usMid").value;
      if (!name || !code || !mid) return showToast("ഉസ്താദിന്റെ പേര്, കോഡ്, മദ്രസ എന്നിവ നൽകുക.", true);
      if (isAdminCode(code)) return showToast("ഈ കോഡ് ഉപയോഗിക്കാൻ കഴിയില്ല.", true);
      if (codeTakenByUstad(code)) return showToast("ഈ ഉസ്താദ് കോഡ് നിലവിലുണ്ട്.", true);
      saveUstad({ id: uid("u"), name, code, mid, deleted: false });
      showToast("ഉസ്താദിനെ സേവ് ചെയ്തു.");
      render();
    },
    "edit-ustad"(el) {
      const u = state.ustads[el.dataset.id];
      if (!u) return;
      openModal({
        title: "ഉസ്താദ് എഡിറ്റ് ചെയ്യുക",
        body: '<label class="field">പേര്<input id="mf_name" class="input" value="' + esc(u.name) + '"></label><label class="field">ഉസ്താദ് കോഡ്<input id="mf_code" class="input" value="' + esc(u.code) + '"></label>' +
          '<label class="field">മദ്രസ<select id="mf_mid" class="select">' + liveMadrasas().map((m) => '<option value="' + esc(m.id) + '"' + (m.id === u.mid ? " selected" : "") + ">" + esc(m.name) + "</option>").join("") + "</select></label>",
        onOk() {
          const name = cleanName(mv("name")), code = cleanName(mv("code"));
          if (!name || !code) return modalError("പേരും കോഡും നൽകുക."), false;
          if (isAdminCode(code)) return modalError("ഈ കോഡ് ഉപയോഗിക്കാൻ കഴിയില്ല."), false;
          if (codeTakenByUstad(code, u.id)) return modalError("ഈ കോഡ് മറ്റൊരു ഉസ്താദിനുണ്ട്."), false;
          u.name = name; u.code = code; u.mid = mv("mid") || u.mid;
          saveUstad(u); showToast("ഉസ്താദ് അപ്ഡേറ്റ് ചെയ്തു."); render();
        }
      });
    },
    "del-ustad"(el) {
      const u = state.ustads[el.dataset.id];
      if (!u) return;
      openModal({
        title: "ഉസ്താദിനെ നീക്കം ചെയ്യണോ?", text: u.name + " — ഈ കോഡ് ഉപയോഗിച്ച് ഇനി പ്രവേശിക്കാൻ കഴിയില്ല.", ok: "നീക്കം ചെയ്യുക", danger: true,
        onOk() { u.deleted = true; saveUstad(u); showToast("ഉസ്താദിനെ നീക്കം ചെയ്തു."); render(); }
      });
    },

    "save-own-code"() {
      if (state.session.role !== "ustad") return;
      const m = liveMadrasa(state.session.mid);
      const code = cleanName($("#ownCode").value);
      if (!m) return showToast("മദ്രസ കണ്ടെത്താൻ കഴിഞ്ഞില്ല.", true);
      if (!code) return showToast("മദ്രസ കോഡ് നൽകുക.", true);
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
      if (el.dataset && el.dataset.join) {
        const m = getMadrasa(el.dataset.join);
        if (m) { m.openJoin = el.checked; saveMadrasa(m); showToast(el.checked ? "കുട്ടികൾക്ക് കോഡ് ഉപയോഗിച്ച് ചേരാം." : "ചേർത്ത വിദ്യാർത്ഥികൾക്ക് മാത്രം പ്രവേശനം."); }
      }
    });

    document.addEventListener("input", (ev) => {
      if (ev.target.id === "inCode") {
        const m = findMadrasaByCode(ev.target.value);
        const box = $("#resolved");
        if (m) { $("#resolvedName").textContent = m.name; box.hidden = false; } else box.hidden = true;
        $("#errCode").hidden = true;
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && modal) { closeModal(); return; }
      if (ev.key === "Enter" && !state.session && (ev.target.id === "inName" || ev.target.id === "inCode")) { ev.preventDefault(); loginSubmit(); }
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
