'use strict';

/* =========================================================
   Chrono Todo — todo + chronomètre par tâche
   Données stockées sur l'appareil (localStorage). Synchro facultative
   entre appareils : données chiffrées dans l'app avant l'envoi (worker.js).
   ========================================================= */

const VERSION = '2.8.0';
const STORE_KEY = 'chronotodo:v1';
const SYNC_KEY = 'chronotodo:sync';
// Chaque personne a ses propres tâches, projets, chronos et stats.
// Romain garde l'emplacement d'origine des données (aucune migration nécessaire).
const PROFILES = [
  { id: 'romain', name: 'Romain', color: '#4f46e5' },
  { id: 'rebecca', name: 'Rebecca', color: '#db2777' },
];
const getProfile = (id) => PROFILES.find((p) => p.id === id);
const storeKey = (p) => (p === 'romain' ? STORE_KEY : `${STORE_KEY}:${p}`);
const LONG_SESSION = 4 * 3600e3; // au-delà : on propose de corriger (chrono oublié)
const MIN_SESSION = 3e3;         // en dessous : clic accidentel, ignoré
const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#84cc16', '#64748b'];
const NO_COLOR = '#94a3b8';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const now = () => Date.now();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const buzz = () => navigator.vibrate?.(15);

const svg = (body, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${body}</svg>`;
const ICON = {
  play: svg('<path d="M8 5.2v13.6L19 12z"/>', 'fill'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/>', 'fill'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
  star: svg('<path d="M12 3.6l2.55 5.2 5.7.83-4.13 4.02.98 5.68L12 16.65l-5.1 2.68.98-5.68L3.75 9.63l5.7-.83z"/>'),
  cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  smile: svg('<circle cx="12" cy="12" r="8.6"/><path d="M8.6 14.2a4.3 4.3 0 0 0 6.8 0"/><circle cx="9.3" cy="10" r=".9" class="fill"/><circle cx="14.7" cy="10" r=".9" class="fill"/>'),
  grip: svg('<circle cx="9" cy="6.5" r="1.6"/><circle cx="15" cy="6.5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="17.5" r="1.6"/><circle cx="15" cy="17.5" r="1.6"/>', 'fill'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  cloud: svg('<path d="M7.2 18.5h10.3a4 4 0 0 0 .5-7.97 6 6 0 0 0-11.6-1.2A4.6 4.6 0 0 0 7.2 18.5z"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>'),
};

/* ---------- Données ---------- */

function blankState() {
  return {
    version: 1,
    projects: [],    // { id, name, color, archived, createdAt }
    subprojects: [], // { id, projectId, name }
    tasks: [],       // { id, title, notes, projectId, subprojectId, deadline, done, doneAt, createdAt }
    sessions: [],    // { id, taskId, title, projectId, subprojectId, start, end }
    plans: [],       // créneaux du planning : { id, taskId, start, end }
    events: [],      // événements fixes : { id, title, color, start, end (minutes), days ('12345' = lun→ven) ou date }
    // (chaque élément a aussi updatedAt, ajouté par stamp() pour la synchro)
    timers: [],      // chronos en cours : { taskId, start } (plusieurs en parallèle possible, un par tâche)
    deleted: {},     // id supprimé (ou "timer:…" pour un chrono arrêté) → date, pour la synchro
    ui: {
      tab: 'today', filter: 'all', subfilter: 'all', showDone: false,
      period: 'week', offset: 0, lastProjectId: '', lastSubId: '', lastBackup: 0, hideInstall: false,
      syncRev: '',       // version du serveur déjà fusionnée dans ces données
      syncDirty: false,  // modifications pas encore envoyées
      pristine: false,   // projets de départ jamais modifiés (remplacés par ceux d'un autre appareil à la 1re synchro)
    },
  };
}

// Romain : projets repris de la liste déroulante du fichier Excel. Rebecca : quelques projets de départ.
function seedState(p) {
  const s = blankState();
  const add = (name, subs = []) => {
    const pr = { id: uid(), name, color: COLORS[s.projects.length % COLORS.length], archived: false, createdAt: now() };
    s.projects.push(pr);
    subs.forEach((n) => s.subprojects.push({ id: uid(), projectId: pr.id, name: n }));
  };
  if (p === 'romain') {
    add('Pro', ['Prépa cours', 'Correction', 'Prof principal']);
    ['Admin', 'Agreg', 'Famille / Social', 'Couple', 'Vbarthe', 'CookOnce', 'DP', 'Opti Todo', 'Pause'].forEach((n) => add(n));
  } else {
    ['Pro', 'Perso', 'Maison', 'Famille / Social'].forEach((n) => add(n));
  }
  s.ui.pristine = true;
  return s;
}

function normalize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) throw new Error('format');
  const s = blankState();
  for (const k of ['projects', 'subprojects', 'tasks', 'sessions', 'plans', 'events']) if (Array.isArray(data[k])) s[k] = data[k];
  s.timers = timerList(data);
  if (data.deleted && typeof data.deleted === 'object') s.deleted = { ...data.deleted };
  Object.assign(s.ui, data.ui || {});
  return s;
}

function load(p) {
  let raw = null;
  try {
    raw = localStorage.getItem(storeKey(p));
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    // Données illisibles : on les met de côté plutôt que de les écraser.
    if (raw) try { localStorage.setItem(`${storeKey(p)}:backup-${now()}`, raw); } catch (_) { /* plein */ }
  }
  return seedState(p);
}

// Lecture sans créer de données (écran de choix du profil).
function peek(p) {
  try { const raw = localStorage.getItem(storeKey(p)); return raw ? normalize(JSON.parse(raw)) : null; } catch (e) { return null; }
}

let profile = null;       // personne choisie à l'ouverture de l'app
let state = blankState(); // ses données (vide tant que personne n'est choisi)
const temp = { statsOpen: new Set(), installEvt: null, showCode: false, keys: null, openProject: null, showProjectDone: false };

/* ----- Suivi des modifications (pour la synchro) ----- */

const SYNCED = ['projects', 'subprojects', 'tasks', 'sessions', 'plans', 'events'];
const timerKey = (a) => (a ? `timer:${a.taskId}@${a.start}` : '');
// Chronos en cours d'un document (ancien format : un seul chrono, champ « active »).
function timerList(d) {
  const list = Array.isArray(d.timers) ? d.timers : d.active ? [d.active] : [];
  return list.filter((a) => a && a.taskId && a.start).map((a) => ({ taskId: String(a.taskId), start: Number(a.start) }));
}
const timerKeys = (list) => list.map(timerKey).sort().join('|');
// Id fixe pour la session d'un chrono : deux appareils qui l'enregistrent produisent la même session.
const timerSessionId = (a) => `s${a.start.toString(36)}-${a.taskId}`;
// Deux objets « plats » (valeurs simples) identiques ? On peut ignorer un champ.
function same(a, b, skip) {
  let n = 0;
  for (const k in a) if (k !== skip) { if (a[k] !== b[k]) return false; n++; }
  for (const k in b) if (k !== skip) n--;
  return n === 0;
}

const withoutDate = ({ updatedAt, ...rest }) => rest;

let shadow; // contenu de chaque élément au dernier enregistrement, pour repérer ce qui change

function snapshot() {
  const items = new Map();
  for (const c of SYNCED) for (const x of state[c]) items.set(x.id, withoutDate(x));
  shadow = { items, timers: new Set(state.timers.map(timerKey)) };
}
snapshot();

// Date (updatedAt) ce qui a été créé ou modifié depuis le dernier enregistrement et note les suppressions.
function stamp() {
  const t = now();
  const seen = new Set();
  let changed = false;
  for (const c of SYNCED) {
    for (const x of state[c]) {
      const old = shadow.items.get(x.id);
      seen.add(x.id);
      if (!old || !same(x, old, 'updatedAt')) { x.updatedAt = t; shadow.items.set(x.id, withoutDate(x)); changed = true; }
    }
  }
  for (const id of shadow.items.keys()) {
    if (!seen.has(id)) { state.deleted[id] = t; shadow.items.delete(id); changed = true; }
  }
  const timers = new Set(state.timers.map(timerKey));
  for (const k of shadow.timers) if (!timers.has(k)) { state.deleted[k] = t; changed = true; } // chrono arrêté
  for (const k of timers) if (!shadow.timers.has(k)) changed = true;
  shadow.timers = timers;
  return changed;
}

// À appeler après chaque modification des données.
function save() {
  if (stamp()) {
    state.ui.pristine = false;
    if (syncConf.code) { state.ui.syncDirty = true; scheduleSync(); }
  }
  writeLocal();
  syncBadge();
}

// Écrit sur l'appareil sans dater : suffit quand seul l'affichage change (onglet, filtres…).
function writeLocal() {
  if (!profile) return;
  try { localStorage.setItem(storeKey(profile), JSON.stringify(state)); } catch (e) { toast('Impossible d’enregistrer sur cet appareil'); }
}

function persistStorage() {
  navigator.storage?.persist?.().catch(() => {});
}

const getProject = (id) => (id ? state.projects.find((p) => p.id === id) : undefined);
const getSub = (id) => (id ? state.subprojects.find((s) => s.id === id) : undefined);
const getTask = (id) => (id ? state.tasks.find((t) => t.id === id) : undefined);
const subsOf = (projectId) => state.subprojects.filter((s) => s.projectId === projectId);
const colorOf = (projectId) => getProject(projectId)?.color || NO_COLOR;

function pathLabel(projectId, subprojectId) {
  const p = getProject(projectId);
  if (!p) return 'Sans projet';
  const sp = getSub(subprojectId);
  return sp ? `${p.name} › ${sp.name}` : p.name;
}

function addProject(name, color) {
  const used = new Set(state.projects.map((p) => p.color));
  const p = {
    id: uid(), name, archived: false, createdAt: now(),
    color: color || COLORS.find((c) => !used.has(c)) || COLORS[state.projects.length % COLORS.length],
    order: Math.max(-1, ...state.projects.map((x, i) => x.order ?? i)) + 1,
  };
  state.projects.push(p);
  return p;
}

function addSub(projectId, name) {
  const s = { id: uid(), projectId, name };
  state.subprojects.push(s);
  return s;
}

function deleteSub(id) {
  for (const x of [...state.tasks, ...state.sessions]) if (x.subprojectId === id) x.subprojectId = null;
  state.subprojects = state.subprojects.filter((s) => s.id !== id);
  if (state.ui.subfilter === id) state.ui.subfilter = 'all';
}

// Projets sans aucune tâche (même terminée) ni temps enregistré.
function unusedProjects() {
  const used = new Set([...state.tasks, ...state.sessions, ...state.plans.map((p) => getTask(p.taskId) || {})].map((x) => x.projectId).filter(Boolean));
  return state.projects.filter((p) => !used.has(p.id));
}

function deleteProject(id) {
  for (const x of [...state.tasks, ...state.sessions]) {
    if (x.projectId === id) { x.projectId = null; x.subprojectId = null; }
  }
  state.subprojects = state.subprojects.filter((s) => s.projectId !== id);
  state.projects = state.projects.filter((p) => p.id !== id);
  if (state.ui.filter === id) { state.ui.filter = 'all'; state.ui.subfilter = 'all'; }
}

/* ---------- Temps ---------- */

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d, o) => new Intl.DateTimeFormat('fr-FR', o).format(d);
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function fmtDur(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (h) return `${h}h${pad(m)}`;
  if (m) return `${m} min`;
  return t ? `${t} s` : '0 min';
}

function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const mmss = `${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
  return h ? `${h}:${mmss}` : mmss;
}

const timerOf = (taskId) => state.timers.find((a) => a.taskId === taskId);
const sinceOf = (taskId) => { const a = timerOf(taskId); return a ? [a.start] : []; };
const elapsedSince = (since) => since.reduce((n, x) => n + Math.max(0, now() - x), 0);
// Attributs d'un compteur qui avance chaque seconde (tick) : base + temps écoulé depuis chaque début.
const tickAttr = (kind, base, since) => (since.length ? ` data-tick="${kind}" data-base="${base}" data-since="${since.join(',')}"` : '');
const liveDur = (base, since) => `<b${tickAttr('dur', base, since)}>${fmtDur(base + elapsedSince(since))}</b>`;
const overlap = (s, a, b) => Math.max(0, Math.min(s.end, b) - Math.max(s.start, a));

function taskTotals() {
  const m = new Map();
  for (const s of state.sessions) if (s.taskId) m.set(s.taskId, (m.get(s.taskId) || 0) + (s.end - s.start));
  return m;
}

// Sessions enregistrées + la session en cours (pour les stats).
function allSessions() {
  const list = state.sessions.slice();
  for (const a of state.timers) {
    const t = getTask(a.taskId);
    list.push({ id: `live:${a.taskId}`, live: true, taskId: a.taskId, title: t?.title, projectId: t?.projectId, subprojectId: t?.subprojectId, start: a.start, end: now() });
  }
  return list;
}

function dueInfo(deadline) {
  if (!deadline) return null;
  const d = parseYmd(deadline);
  const diff = Math.round((d - startOfDay(new Date())) / 864e5);
  if (diff < 0) return { cls: 'late', text: `En retard · ${fmt(d, { day: 'numeric', month: 'short' })}` };
  if (diff === 0) return { cls: 'today', text: 'Aujourd’hui' };
  if (diff === 1) return { cls: 'soon', text: 'Demain' };
  if (diff < 7) return { cls: 'soon', text: cap(fmt(d, { weekday: 'long' })) };
  return { cls: '', text: fmt(d, { day: 'numeric', month: 'short' }) };
}

/* ---------- Chronomètre ---------- */

// Arrête le chrono d'une tâche et l'enregistre dans le journal. Renvoie la session créée.
function finishTimer(taskId) {
  const a = timerOf(taskId);
  if (!a) return null;
  state.timers = state.timers.filter((x) => x !== a);
  const end = now();
  if (end - a.start < MIN_SESSION) return null;
  const t = getTask(a.taskId);
  const s = {
    id: timerSessionId(a), taskId: a.taskId, title: t?.title || 'Tâche',
    projectId: t?.projectId || null, subprojectId: t?.subprojectId || null, start: a.start, end,
  };
  state.sessions.push(s);
  return s;
}

// Lancer une tâche ne coupe pas les autres chronos : ils tournent en parallèle.
function startTimer(taskId) {
  if (timerOf(taskId)) return;
  state.timers.unshift({ taskId, start: now() });
  const t = getTask(taskId);
  if (t?.done) { t.done = false; t.doneAt = null; }
  save(); render(); buzz(); persistStorage();
}

function stopTimer(taskId) {
  const done = finishTimer(taskId);
  save(); render(); buzz();
  return done;
}

// Après un arrêt : si une session est très longue, on propose de la corriger.
function afterTimer(done, reopenTaskId) {
  const long = [].concat(done || []).find((s) => s.end - s.start > LONG_SESSION);
  if (long) openSessionSheet(long.id, { warn: true, back: reopenTaskId });
  else if (reopenTaskId) openTaskSheet(reopenTaskId);
}

/* ---------- Rendu ---------- */

// Écran d'accueil : choix de la personne (Romain ou Rebecca).
function renderProfiles() {
  document.body.dataset.screen = 'profiles';
  document.title = 'Chrono Todo';
  const box = $('#profiles');
  box.hidden = false;
  box.innerHTML = `<div class="who">
    <img class="who-logo" src="icons/icon-192.png" alt="">
    <h1>Chrono Todo</h1>
    <p>Qui utilise l’app ?</p>
    <div class="who-list">${PROFILES.map((p) => {
      const s = peek(p.id);
      const open = s ? s.tasks.filter((t) => !t.done).length : 0;
      const n = s ? s.timers.length : 0;
      const info = n ? `⏱ ${n > 1 ? `${n} chronos` : 'chrono'} en cours` : open ? `${open} tâche${open > 1 ? 's' : ''} à faire` : 'Commencer';
      return `<button type="button" class="who-btn" data-action="pick-profile" data-value="${p.id}" style="--c:${p.color}">
        <span class="avatar">${esc(p.name.slice(0, 2))}</span>
        <span class="who-name">${esc(p.name)}<small>${esc(info)}</small></span>${ICON.right}
      </button>`;
    }).join('')}</div>
    <p class="who-sync${syncConf.code ? ' on' : ''}">${syncConf.code ? '☁️ Synchro activée sur cet appareil' : 'Synchro non activée sur cet appareil (Réglages › Synchronisation)'}</p>
  </div>`;
}

function selectProfile(id) {
  if (!getProfile(id)) return;
  profile = id;
  state = load(id);
  snapshot();
  Object.assign(temp, { openProject: null, keys: null });
  temp.statsOpen.clear();
  state.ui.tab = 'today'; // la journée est la page d'accueil
  writeLocal();
  render();
  window.scrollTo(0, 0);
  persistStorage();
  syncNow();
}

// Retour à l'écran de choix : on envoie d'abord les dernières modifications du profil.
async function leaveProfile() {
  if (temp.leaving) return;
  temp.leaving = true;
  try {
    const f = taskFormOpen();
    if (f?.dataset.id) commitTaskForm(f);
    closeSheet();
    if (syncConf.code && state.ui.syncDirty) await syncNow();
    if (syncing) await syncing.catch(() => {});
    clearTimeout(syncTimer);
    profile = null;
    state = blankState();
    snapshot();
    temp.openProject = null;
    render();
  } finally {
    temp.leaving = false;
  }
}

// Les projets suivent l'ordre choisi par glisser-déposer (champ « order », synchronisé).
function sortProjects() {
  const idx = new Map(state.projects.map((x, i) => [x.id, i]));
  state.projects.sort((a, b) => (a.order ?? idx.get(a.id)) - (b.order ?? idx.get(b.id)));
}

function render() {
  if (!profile) { renderProfiles(); return; }
  sortProjects();
  document.body.dataset.screen = 'app';
  $('#profiles').hidden = true;
  const me = getProfile(profile);
  const pill = $('#who');
  pill.style.setProperty('--c', me.color);
  pill.innerHTML = `<i></i>${esc(me.name)}`;
  syncBadge();
  const tab = state.ui.tab;
  const openP = tab === 'projects' ? getProject(temp.openProject) : null;
  if (!openP) temp.openProject = null;
  document.body.dataset.tab = tab;
  if (openP) document.body.dataset.inProject = '1'; else delete document.body.dataset.inProject;
  if (tab !== 'plan') temp.placing = null;
  document.body.classList.toggle('placing', !!temp.placing);
  $('#title').textContent = openP ? openP.name : { today: 'Ma journée', tasks: 'Tâches', plan: 'Planning', projects: 'Projets', stats: 'Statistiques' }[tab];
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.value === tab));
  renderBanner();
  const sideScroll = $('.side-list')?.scrollTop || 0;
  $('#view').innerHTML = openP ? viewProject(openP) : tab === 'projects' ? viewProjects() : tab === 'stats' ? viewStats() : tab === 'plan' ? viewPlan() : tab === 'today' ? viewToday() : viewTasks();
  if (sideScroll && $('.side-list')) $('.side-list').scrollTop = sideScroll;
  tick();
}

// Chronos en cours, le plus récent d'abord.
const runningTimers = () => state.timers.slice().sort((a, b) => b.start - a.start);

function tick() {
  for (const n of $$('[data-tick]')) {
    const since = (n.dataset.since || '').split(',').filter(Boolean).map(Number);
    const v = Number(n.dataset.base || 0) + elapsedSince(since);
    n.textContent = n.dataset.tick === 'clock' ? fmtClock(v) : fmtDur(v);
  }
  let long = false;
  for (const r of $$('#banner .bn')) {
    const l = now() - Number(r.dataset.start) > LONG_SESSION;
    r.classList.toggle('long', l);
    long ||= l;
  }
  $('#banner').classList.toggle('long', long);
  const list = runningTimers();
  const more = list.length > 1 ? ` +${list.length - 1}` : '';
  document.title = list.length ? `${fmtClock(now() - list[0].start)} · ${getTask(list[0].taskId)?.title || 'Chrono Todo'}${more}` : 'Chrono Todo';
}

// Bandeau des chronos en cours : une ligne par chrono, chacune avec son bouton « Arrêter ».
function renderBanner() {
  const el = $('#banner');
  const list = runningTimers();
  if (!list.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.classList.toggle('multi', list.length > 1);
  el.innerHTML = list.map((a) => {
    const t = getTask(a.taskId);
    const long = now() - a.start > LONG_SESSION;
    return `<div class="bn${long ? ' long' : ''}" data-start="${a.start}">
      <div class="banner-info" role="button" tabindex="0" data-action="open-task" data-id="${a.taskId}">
        <div class="banner-label"><span class="pulse"></span>${long ? 'Chrono oublié ? Arrête pour corriger' : esc(t ? pathLabel(t.projectId, t.subprojectId) : 'En cours')}</div>
        <div class="banner-title">${esc(t?.title || 'Tâche')}</div>
      </div>
      <div class="banner-time"${tickAttr('clock', 0, [a.start])}>${fmtClock(now() - a.start)}</div>
      <button type="button" class="round-btn stop" data-action="stop" data-id="${a.taskId}" aria-label="Arrêter le chrono de « ${esc(t?.title || 'Tâche')} »">${ICON.stop}</button>
    </div>`;
  }).join('');
  el.classList.toggle('long', !!$('.bn.long', el));
}

/* ----- Onglet Tâches ----- */

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installHint() {
  if (isStandalone() || state.ui.hideInstall) return '';
  if (!temp.installEvt && !matchMedia('(pointer: coarse)').matches) return '';
  return `<div class="hint-card">
    <img src="icons/icon-192.png" alt="">
    <div><b>Installe l’app sur ton téléphone</b><button type="button" class="link" data-action="install">${temp.installEvt ? 'Installer maintenant' : 'Voir comment'}</button></div>
    <button type="button" class="icon-btn" data-action="hide-install" aria-label="Masquer">${ICON.close}</button>
  </div>`;
}

// Temps du jour / de la semaine, avec la partie "en cours" (chaque chrono) ajoutée en direct par tick().
function liveTotal(a, b) {
  let closed = 0;
  for (const s of state.sessions) closed += overlap(s, a, b);
  for (const x of state.timers) closed -= Math.max(0, a - x.start); // partie d'avant la période
  return { base: closed, since: state.timers.map((x) => x.start) };
}

function summaryCard() {
  const n = new Date();
  const day = +startOfDay(n);
  const week = +new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
  const end = day + 2 * 864e5;
  const cell = (label, { base, since }) => `<div><small>${label}</small>${liveDur(base, since)}</div>`;
  return `<button type="button" class="card summary" data-action="go-stats">
    ${cell('Aujourd’hui', liveTotal(day, end))}${cell('Cette semaine', liveTotal(week, end))}
  </button>`;
}

function taskCard(t, totals, { tag = true } = {}) {
  const running = !!timerOf(t.id);
  const total = totals.get(t.id) || 0;
  const due = !t.done && dueInfo(t.deadline);
  const plan = !t.done && nextPlanOf(t.id);
  const notes = (t.notes || '').split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean).join(' · ');
  return `<article class="task${running ? ' running' : ''}${t.done ? ' done' : ''}${t.starred && !t.done ? ' starred' : ''}" style="--c:${colorOf(t.projectId)}">
    <button type="button" class="check" data-action="toggle-done" data-id="${t.id}" aria-label="${t.done ? 'Rouvrir' : 'Marquer comme faite'}">${ICON.check}</button>
    <div class="task-main" role="button" tabindex="0" data-action="open-task" data-id="${t.id}">
      <div class="task-title">${esc(t.title)}</div>
      ${notes ? `<div class="task-notes">${esc(notes)}</div>` : ''}
      <div class="task-meta">
        ${tag && t.projectId ? `<span class="tag"><i></i>${esc(pathLabel(t.projectId, t.subprojectId))}</span>` : ''}
        ${due ? `<span class="due ${due.cls}">${esc(due.text)}</span>` : ''}
        ${plan ? `<span class="planned">${ICON.cal}${esc(planLabel(plan))}</span>` : ''}
        ${total || running ? `<span class="spent">${ICON.clock}${liveDur(total, sinceOf(t.id))}</span>` : ''}
      </div>
    </div>
    ${t.done ? '' : `<button type="button" class="star${t.starred ? ' on' : ''}" data-action="toggle-star" data-id="${t.id}" aria-pressed="${!!t.starred}" aria-label="${t.starred ? 'Retirer des prioritaires' : 'Mettre en prioritaire'}">${ICON.star}</button>`}
    ${t.done ? '' : `<button type="button" class="play" data-action="toggle-timer" data-id="${t.id}" aria-label="${running ? 'Arrêter' : 'Lancer le chrono'}">${running ? ICON.stop : ICON.play}</button>`}
  </article>`;
}

const cmpDeadline = (a, b) => {
  if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
  return a.deadline ? -1 : b.deadline ? 1 : 0;
};

function viewTasks() {
  const ui = state.ui;
  const totals = taskTotals();
  const open = state.tasks.filter((t) => !t.done);
  const key = (t) => t.projectId || 'none';
  const subKey = (t) => t.subprojectId || 'none';

  const counts = new Map();
  open.forEach((t) => counts.set(key(t), (counts.get(key(t)) || 0) + 1));
  const showChips = counts.size >= 2;
  const filter = showChips && counts.has(ui.filter) ? ui.filter : 'all';

  let subCounts = new Map();
  if (filter !== 'all' && filter !== 'none') {
    open.filter((t) => key(t) === filter).forEach((t) => subCounts.set(subKey(t), (subCounts.get(subKey(t)) || 0) + 1));
  }
  const showSubChips = subCounts.size >= 2;
  const subfilter = showSubChips && subCounts.has(ui.subfilter) ? ui.subfilter : 'all';

  const match = (t) => (filter === 'all' || key(t) === filter) && (subfilter === 'all' || subKey(t) === subfilter);
  const list = open.filter(match).sort((a, b) => !!b.starred - !!a.starred || !!timerOf(b.id) - !!timerOf(a.id) || cmpDeadline(a, b) || b.createdAt - a.createdAt);
  const done = state.tasks.filter((t) => t.done && match(t)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  let html = summaryCard();

  if (showChips) {
    const chip = (value, label, color, n) =>
      `<button type="button" class="chip${filter === value ? ' on' : ''}" data-action="filter" data-value="${value}"${color ? ` style="--c:${color}"` : ''}>${color ? '<i></i>' : ''}${esc(label)} <small>${n}</small></button>`;
    html += `<div class="chips">${chip('all', 'Tout', '', open.length)}${state.projects
      .filter((p) => counts.has(p.id))
      .map((p) => chip(p.id, p.name, p.color, counts.get(p.id)))
      .join('')}${counts.has('none') ? chip('none', 'Sans projet', '', counts.get('none')) : ''}</div>`;
  }
  if (showSubChips) {
    const color = colorOf(filter);
    const chip = (value, label, n) =>
      `<button type="button" class="chip${subfilter === value ? ' on' : ''}" data-action="subfilter" data-value="${value}" style="--c:${color}">${esc(label)} <small>${n}</small></button>`;
    html += `<div class="chips sub">${chip('all', 'Tout', subCounts.get('all') || [...subCounts.values()].reduce((a, b) => a + b, 0))}${subsOf(filter)
      .filter((s) => subCounts.has(s.id))
      .map((s) => chip(s.id, s.name, subCounts.get(s.id)))
      .join('')}${subCounts.has('none') ? chip('none', 'Autre', subCounts.get('none')) : ''}</div>`;
  }

  if (!state.tasks.length) {
    html += `<div class="empty"><b>Aucune tâche pour l’instant</b>Touche <b style="display:inline">+</b> pour ajouter ta première tâche.</div>`;
  } else if (!list.length) {
    html += `<div class="empty"><b>Rien à faire ici ✓</b>Touche + pour ajouter une tâche.</div>`;
  } else {
    html += `<div class="list">${list.map((t) => taskCard(t, totals)).join('')}</div>`;
  }

  if (done.length) {
    html += `<div class="section-title"><span>Terminées · ${done.length}</span><button type="button" data-action="toggle-done-list">${ui.showDone ? 'Masquer' : 'Afficher'}</button></div>`;
    if (ui.showDone) {
      html += `<div class="list">${done.slice(0, 60).map((t) => taskCard(t, totals)).join('')}</div>
        <button type="button" class="btn ghost danger wide" data-action="clear-done">${ICON.trash} Effacer les tâches terminées</button>`;
    }
  }
  return html;
}

/* ----- Onglet Projets ----- */

function viewProjects() {
  const totals = new Map();
  for (const s of state.sessions) if (s.projectId) totals.set(s.projectId, (totals.get(s.projectId) || 0) + (s.end - s.start));
  const openCount = new Map();
  for (const t of state.tasks) if (!t.done && t.projectId) openCount.set(t.projectId, (openCount.get(t.projectId) || 0) + 1);

  const row = (p) => {
    const subs = subsOf(p.id).map((s) => s.name).join(' · ');
    const n = openCount.get(p.id) || 0;
    const total = totals.get(p.id) || 0;
    return `<div class="proj-item" data-id="${p.id}" style="--c:${p.color}">
      <span class="proj-grip" title="Glisser pour changer l’ordre" aria-label="Déplacer ${esc(p.name)}">${ICON.grip}</span>
      <button type="button" class="proj-row" data-action="open-project" data-id="${p.id}">
        <span class="dot"></span>
        <span class="proj-name">${esc(p.name)}<small>${esc(subs || 'Aucun sous-projet')}</small></span>
        <span class="proj-stats"><b>${total ? fmtDur(total) : '—'}</b><small>${n ? `${n} à faire` : 'rien à faire'}</small></span>
      </button>
    </div>`;
  };
  const active = state.projects.filter((p) => !p.archived);
  const archived = state.projects.filter((p) => p.archived);
  return `<div class="stack-gap">
    ${active.length ? `<div class="card proj-list">${active.map(row).join('')}</div>` : '<div class="empty"><b>Aucun projet</b>Crée un projet pour classer tes tâches.</div>'}
    <button type="button" class="btn primary wide" data-action="new-project">${ICON.plus} Nouveau projet</button>
    ${archived.length ? `<div class="section-title">Archivés</div><div class="card proj-list">${archived.map(row).join('')}</div>` : ''}
    ${unusedProjects().length ? `<button type="button" class="btn ghost wide clean-btn" data-action="clean-projects">🧹 Nettoyer les projets inutilisés (${unusedProjects().length})</button>` : ''}
    <p class="hint center">Touche un projet pour voir ses tâches. Glisse la poignée ⋮⋮ pour changer l’ordre.</p>
  </div>`;
}

// Page d'un projet : ses tâches rangées par sous-projet, avec un bouton « Ajouter » dans chaque groupe.
function viewProject(p) {
  const totals = taskTotals();
  const mine = state.tasks.filter((t) => t.projectId === p.id);
  const open = mine.filter((t) => !t.done).sort((a, b) => !!b.starred - !!a.starred || !!timerOf(b.id) - !!timerOf(a.id) || cmpDeadline(a, b) || b.createdAt - a.createdAt);
  const done = mine.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const subs = subsOf(p.id);
  let spent = 0;
  for (const s of state.sessions) if (s.projectId === p.id) spent += s.end - s.start;
  const since = state.timers.filter((a) => getTask(a.taskId)?.projectId === p.id).map((a) => a.start);

  const section = (title, subId, list, always) => {
    if (!list.length && !always) return '';
    return `<div class="section-title"><span>${esc(title)}${list.length ? ` · ${list.length}` : ''}</span>
        <button type="button" data-action="new-task" data-project="${p.id}" data-sub="${subId}">${ICON.plus} Ajouter</button></div>
      ${list.length ? `<div class="list">${list.map((t) => taskCard(t, totals, { tag: false })).join('')}</div>` : '<p class="hint section-empty">Aucune tâche.</p>'}`;
  };

  let html = `<div class="proj-nav">
      <button type="button" class="link back" data-action="close-project">${ICON.left} Projets</button>
      <button type="button" class="btn small" data-action="edit-project" data-id="${p.id}">Modifier</button>
    </div>
    ${p.archived ? '<p class="hint">Projet archivé : masqué des listes, gardé dans les stats.</p>' : ''}
    <div class="card summary proj-summary" style="--c:${p.color}">
      <div><small>Temps passé</small>${liveDur(spent, since)}</div>
      <div><small>À faire</small><b>${open.length}</b></div>
    </div>`;
  if (subs.length) {
    for (const s of subs) html += section(s.name, s.id, open.filter((t) => t.subprojectId === s.id), true);
    html += section('Sans sous-projet', '', open.filter((t) => !getSub(t.subprojectId)), false);
  } else {
    html += section('Tâches', '', open, true);
  }
  if (done.length) {
    html += `<div class="section-title"><span>Terminées · ${done.length}</span><button type="button" data-action="toggle-project-done">${temp.showProjectDone ? 'Masquer' : 'Afficher'}</button></div>`;
    if (temp.showProjectDone) html += `<div class="list">${done.slice(0, 60).map((t) => taskCard(t, totals, { tag: false })).join('')}</div>`;
  }
  return html;
}

// Transforme un projet en sous-projet d'un autre : ses tâches et son temps y passent.
// Ses éventuels sous-projets sont regroupés dans ce nouveau sous-projet (deux niveaux maximum).
function convertProject(srcId, targetId, name) {
  const norm = (s) => s.trim().toLowerCase();
  const sp = subsOf(targetId).find((s) => norm(s.name) === norm(name)) || addSub(targetId, name);
  for (const x of [...state.tasks, ...state.sessions]) {
    if (x.projectId === srcId) Object.assign(x, { projectId: targetId, subprojectId: sp.id });
  }
  state.subprojects = state.subprojects.filter((s) => s.projectId !== srcId);
  state.projects = state.projects.filter((p) => p.id !== srcId);
  if (state.ui.filter === srcId) Object.assign(state.ui, { filter: targetId, subfilter: sp.id });
  if (state.ui.lastProjectId === srcId) Object.assign(state.ui, { lastProjectId: targetId, lastSubId: sp.id });
  if (temp.openProject === srcId) temp.openProject = targetId;
  return sp;
}

/* ----- Onglet Stats ----- */

const PERIODS = [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['term', 'Trimestre'], ['year', 'Année'], ['all', 'Tout']];
// Comme dans le fichier Excel : année scolaire d'août à juillet, trimestres de 3 mois à partir d'août.
const schoolYear = (d) => (d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1);

function periodRange(kind, offset) {
  const n = new Date();
  const Y = n.getFullYear(), M = n.getMonth(), D = n.getDate();
  let a, b, label, sub = '';
  if (kind === 'day') {
    a = new Date(Y, M, D + offset); b = new Date(Y, M, D + offset + 1);
    label = offset === 0 ? 'Aujourd’hui' : offset === -1 ? 'Hier' : cap(fmt(a, { weekday: 'long' }));
    sub = fmt(a, { day: 'numeric', month: 'long', year: 'numeric' });
  } else if (kind === 'week') {
    const monday = D - ((n.getDay() + 6) % 7) + 7 * offset;
    a = new Date(Y, M, monday); b = new Date(Y, M, monday + 7);
    label = offset === 0 ? 'Cette semaine' : offset === -1 ? 'Semaine dernière' : `Semaine du ${fmt(a, { day: 'numeric', month: 'short' })}`;
    sub = `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(new Date(b - 1), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } else if (kind === 'month') {
    a = new Date(Y, M + offset, 1); b = new Date(Y, M + offset + 1, 1);
    label = cap(fmt(a, { month: 'long', year: 'numeric' }));
    sub = offset === 0 ? 'Ce mois-ci' : '';
  } else if (kind === 'term') {
    const start = M - (((M - 7 + 12) % 12) % 3) + 3 * offset;
    a = new Date(Y, start, 1); b = new Date(Y, start + 3, 1);
    const sy = schoolYear(a);
    label = `Trimestre ${Math.floor(((a.getMonth() - 7 + 12) % 12) / 3) + 1} · ${sy}-${sy + 1}`;
    sub = `${fmt(a, { month: 'long' })} → ${fmt(new Date(b - 1), { month: 'long' })}`;
  } else if (kind === 'year') {
    const sy = schoolYear(n) + offset;
    a = new Date(sy, 7, 1); b = new Date(sy + 1, 7, 1);
    label = `Année ${sy}-${sy + 1}`;
    sub = 'août → juillet';
  } else {
    const first = state.sessions.reduce((m, s) => Math.min(m, s.start), Math.min(now(), ...state.timers.map((a) => a.start)));
    a = startOfDay(new Date(first)); b = new Date(Y, M, D + 1);
    label = 'Depuis le début';
    sub = `depuis le ${fmt(a, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  return { a: +a, b: +b, label, sub };
}

function buckets(kind, a, b) {
  const out = [];
  const A = new Date(a);
  if (kind === 'week' || kind === 'month') {
    for (let i = 0; ; i++) {
      const d0 = new Date(A.getFullYear(), A.getMonth(), A.getDate() + i);
      if (+d0 >= b) break;
      const d1 = new Date(A.getFullYear(), A.getMonth(), A.getDate() + i + 1);
      const label = kind === 'week' ? 'LMMJVSD'[i] : i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : '';
      out.push({ a: +d0, b: +d1, label, title: fmt(d0, { weekday: 'long', day: 'numeric', month: 'long' }) });
    }
  } else if (kind === 'term') {
    let w = new Date(A.getFullYear(), A.getMonth(), A.getDate() - ((A.getDay() + 6) % 7));
    let lastMonth = -1;
    while (+w < b) {
      const w1 = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7);
      const m = Math.max(+w, a) === a ? A.getMonth() : w.getMonth();
      out.push({ a: Math.max(+w, a), b: Math.min(+w1, b), label: m !== lastMonth ? fmt(new Date(2000, m, 1), { month: 'short' }) : '', title: `Semaine du ${fmt(w, { day: 'numeric', month: 'short' })}` });
      lastMonth = m;
      w = w1;
    }
  } else if (kind === 'year') {
    for (let i = 0; i < 12; i++) {
      const m0 = new Date(A.getFullYear(), A.getMonth() + i, 1);
      const m1 = new Date(A.getFullYear(), A.getMonth() + i + 1, 1);
      out.push({ a: +m0, b: +m1, label: fmt(m0, { month: 'narrow' }), title: cap(fmt(m0, { month: 'long', year: 'numeric' })) });
    }
  }
  return out;
}

function sessRow(s) {
  const live = !!s.live;
  const title = getTask(s.taskId)?.title || s.title || 'Tâche';
  const attrs = live ? `data-action="open-task" data-id="${s.taskId}"` : `data-action="open-session" data-id="${s.id}"`;
  return `<button type="button" class="sess${live ? ' live' : ''}" ${attrs} style="--c:${colorOf(s.projectId)}">
    <span class="sess-time">${hm(new Date(s.start))}–${live ? '…' : hm(new Date(s.end))}</span>
    <span class="sess-title">${esc(title)}<small>${esc(pathLabel(s.projectId, s.subprojectId))}</small></span>
    <b>${live ? 'en cours' : fmtDur(s.end - s.start)}</b>
  </button>`;
}

function viewStats() {
  const ui = state.ui;
  const isAll = ui.period === 'all';
  const r = periodRange(ui.period, isAll ? 0 : ui.offset);
  const inRange = allSessions().map((s) => ({ s, ms: overlap(s, r.a, r.b) })).filter((x) => x.ms > 0);
  const total = inRange.reduce((n, x) => n + x.ms, 0);
  const pk = (s) => (getProject(s.projectId) ? s.projectId : 'none');

  // Regroupement projet → sous-projets / tâches
  const groups = new Map();
  for (const { s, ms } of inRange) {
    const k = pk(s);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { ms: 0, subs: new Map(), tasks: new Map() }));
    g.ms += ms;
    const sk = getSub(s.subprojectId) ? s.subprojectId : 'none';
    g.subs.set(sk, (g.subs.get(sk) || 0) + ms);
    const tk = s.taskId || s.title;
    const cur = g.tasks.get(tk) || { title: getTask(s.taskId)?.title || s.title || 'Tâche', ms: 0 };
    cur.ms += ms;
    g.tasks.set(tk, cur);
  }
  const sorted = [...groups.entries()].sort((x, y) => y[1].ms - x[1].ms);
  const max = sorted.length ? sorted[0][1].ms : 1;
  const activeDays = new Set(inRange.map(({ s }) => ymd(new Date(Math.max(s.start, r.a))))).size;

  // Graphique en colonnes empilées
  let chart = '';
  const bk = buckets(ui.period, r.a, r.b);
  if (bk.length && total) {
    const t = now();
    const cols = bk.map((c) => {
      const per = new Map();
      let sum = 0;
      for (const { s } of inRange) {
        const ms = overlap(s, c.a, c.b);
        if (ms) { per.set(pk(s), (per.get(pk(s)) || 0) + ms); sum += ms; }
      }
      return { ...c, per, sum };
    });
    const top = Math.max(...cols.map((c) => c.sum), 1);
    chart = `<div class="card chart"><div class="cols">${cols.map((c) => `
      <div class="col${t >= c.a && t < c.b ? ' now' : ''}" title="${esc(c.title)} · ${fmtDur(c.sum)}">
        <div class="bar" style="height:calc((100% - 17px) * ${(c.sum / top).toFixed(4)})">${[...c.per.entries()]
          .map(([k, ms]) => `<i style="flex:${ms} 0 0;background:${colorOf(k)}"></i>`).join('')}</div>
        <span>${esc(c.label)}</span>
      </div>`).join('')}</div></div>`;
  }

  const bars = sorted.map(([k, g]) => {
    const p = getProject(k);
    const pct = Math.round((g.ms / total) * 100);
    let html = `<button type="button" class="bar-row" data-action="stats-toggle" data-id="${k}" style="--c:${colorOf(k)}">
      <div class="bar-top"><span class="dot"></span><span class="name">${esc(p?.name || 'Sans projet')}</span><b>${fmtDur(g.ms)}</b><small>${pct}%</small></div>
      <div class="track"><i style="width:${((g.ms / max) * 100).toFixed(1)}%"></i></div>
    </button>`;
    if (temp.statsOpen.has(k)) {
      const subs = [...g.subs.entries()].sort((x, y) => y[1] - x[1]);
      const showSubs = subs.some(([sk]) => sk !== 'none');
      const tasks = [...g.tasks.values()].sort((x, y) => y.ms - x.ms).slice(0, 15);
      html += `<div class="breakdown">
        ${showSubs ? `<h4>Sous-projets</h4>${subs.map(([sk, ms]) => `<div><span>${esc(getSub(sk)?.name || 'Sans sous-projet')}</span><b>${fmtDur(ms)}</b></div>`).join('')}` : ''}
        <h4>Tâches</h4>${tasks.map((x) => `<div><span>${esc(x.title)}</span><b>${fmtDur(x.ms)}</b></div>`).join('')}
      </div>`;
    }
    return html;
  }).join('');

  // Journal des sessions, groupé par jour
  const byDay = new Map();
  for (const { s } of inRange.sort((x, y) => y.s.start - x.s.start).slice(0, 300)) {
    const k = ymd(new Date(s.start));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const journal = [...byDay.entries()].map(([k, list]) => `
    <div class="day-head"><span>${fmt(parseYmd(k), { weekday: 'long', day: 'numeric', month: 'long' })}</span><span>${fmtDur(list.reduce((n, s) => n + (s.end - s.start), 0))}</span></div>
    <div class="card">${list.map(sessRow).join('')}</div>`).join('');

  return `
    <div class="seg">${PERIODS.map(([k, l]) => `<button type="button" class="chip${ui.period === k ? ' on' : ''}" data-action="period" data-value="${k}">${l}</button>`).join('')}</div>
    <div class="period">
      ${isAll ? '' : `<button type="button" class="icon-btn" data-action="offset" data-value="-1" aria-label="Période précédente">${ICON.left}</button>`}
      <button type="button" class="period-label" data-action="offset" data-value="0"><b>${esc(r.label)}</b><small>${esc(r.sub)}</small></button>
      ${isAll ? '' : `<button type="button" class="icon-btn" data-action="offset" data-value="1"${ui.offset >= 0 ? ' disabled' : ''} aria-label="Période suivante">${ICON.right}</button>`}
    </div>
    <div class="card total-card"><b>${fmtDur(total)}</b><span>${activeDays ? `${activeDays} jour${activeDays > 1 ? 's' : ''} actif${activeDays > 1 ? 's' : ''}` : 'Aucun temps enregistré'}</span></div>
    ${chart}
    ${sorted.length ? `<div class="card bars">${bars}</div><p class="hint center">Touche un projet pour voir le détail.</p>` : ''}
    ${journal ? `<div class="section-title">Journal</div>${journal}` : ''}`;
}

/* ---------- Feuilles (dialogues) ---------- */

const sheet = $('#sheet');
const head = (title) => `<div class="grabber"></div><div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-action="close-sheet" aria-label="Fermer">${ICON.close}</button></div>`;
const taskFormOpen = () => (sheet.open ? $('form[data-form="task"]', sheet) : null);

function openSheet(html) {
  // la fiche d'une tâche ouverte juste avant est enregistrée avant d'être remplacée
  const prev = $('form[data-form="task"]', sheet);
  if (prev?.dataset.id) commitTaskForm(prev);
  sheet.innerHTML = html;
  if (!sheet.open) {
    sheet.showModal();
    history.pushState({ sheet: true }, ''); // le bouton retour du téléphone ferme la feuille
  }
  sheet.scrollTop = 0;
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

sheet.addEventListener('close', () => {
  if (sheet.open) return; // une autre fiche s'est déjà rouverte entre-temps
  $$('.plan-preview.range').forEach((x) => x.remove());
  const f = $('form[data-form="task"]', sheet);
  if (f?.dataset.id) { commitTaskForm(f); render(); }
  sheet.innerHTML = '';
  if (history.state?.sheet) history.back();
});
window.addEventListener('popstate', () => {
  if (sheet.open) { sheet.close(); return; }
  // Bouton retour du téléphone sur la page d'un projet : revient à la liste des projets.
  if (temp.openProject && !history.state?.project) { temp.openProject = null; render(); }
});
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

function ask({ title, text = '', input = false, value = '', placeholder = '', ok = 'OK', cancel = 'Annuler', danger = false, code = false, emoji = false }) {
  const d = $('#ask');
  d.innerHTML = `<form class="ask-form">
    <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
    ${input ? (emoji ? emojiField : (h) => h)(`<input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="60" autocomplete="off" autofocus enterkeyhint="done"${code ? ' class="code" autocapitalize="characters" autocorrect="off" spellcheck="false"' : ''}>`) : ''}
    <div class="ask-actions"><button type="button" class="btn ghost" data-ask="cancel">${esc(cancel)}</button><button class="btn ${danger ? 'danger solid' : 'primary'}">${esc(ok)}</button></div>
  </form>`;
  return new Promise((resolve) => {
    const form = $('form', d);
    let settled = false;
    const done = (val) => { if (settled) return; settled = true; if (d.open) d.close(); resolve(val); };
    form.onsubmit = (e) => { e.preventDefault(); done(input ? form.elements.v.value.trim() || null : true); };
    $('[data-ask="cancel"]', d).onclick = () => done(input ? null : false);
    d.onclose = () => done(input ? null : false);
    d.showModal();
  });
}

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) $('button', t).onclick = () => { t.classList.remove('show'); action.fn(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
}

/* ----- Tâche ----- */

// Projet et sous-projet d'une fiche : boutons qui ouvrent un menu (comme la barre « À planifier »).
const projBtn = (pid) => {
  const p = getProject(pid);
  return `<i style="--c:${p ? p.color : 'transparent'}"></i><span>${esc(p ? p.name : 'Sans projet')}</span>${ICON.down}`;
};
const subBtn = (pid, sid) => `<span>${esc(getSub(sid)?.name || (pid ? 'Aucun' : '—'))}</span>${ICON.down}`;

function pickFields(projectId, subprojectId) {
  return `<div class="row2">
      <div class="field pick-field"><span>Projet</span><input type="hidden" name="projectId" value="${projectId || ''}">
        <button type="button" class="pick-btn" data-action="pf-open" data-field="project" aria-haspopup="menu">${projBtn(projectId)}</button></div>
      <div class="field pick-field"><span>Sous-projet</span><input type="hidden" name="subprojectId" value="${projectId && subprojectId ? subprojectId : ''}">
        <button type="button" class="pick-btn" data-action="pf-open" data-field="sub" aria-haspopup="menu"${projectId ? '' : ' disabled'}>${subBtn(projectId, subprojectId)}</button></div>
    </div>`;
}

function pfMenu(form, field) {
  const pid = form.elements.projectId.value;
  const sid = form.elements.subprojectId.value;
  const opt = (value, label, color, n, on) => `<button type="button" role="menuitemradio" aria-checked="${on}" class="proj-opt${on ? ' on' : ''}" data-action="pf-choose" data-field="${field}" data-value="${value}" style="--c:${color}">
      <i></i><span>${esc(label)}</span>${n ? `<small>${n}</small>` : ''}</button>`;
  if (field === 'project') {
    const counts = new Map();
    for (const t of state.tasks) if (!t.done && t.projectId) counts.set(t.projectId, (counts.get(t.projectId) || 0) + 1);
    return `<div class="pf-menu" role="menu">
      ${opt('', 'Sans projet', 'transparent', 0, !pid)}
      ${state.projects.filter((p) => !p.archived || p.id === pid).map((p) => opt(p.id, p.name, p.color, counts.get(p.id), p.id === pid)).join('')}
      <button type="button" class="proj-opt pf-new" data-action="pf-choose" data-field="project" data-value="__new">${ICON.plus}<span>Nouveau projet…</span></button>
    </div>`;
  }
  const color = getProject(pid)?.color || NO_COLOR;
  return `<div class="pf-menu" role="menu">
    ${opt('', 'Aucun sous-projet', 'transparent', 0, !sid)}
    ${subsOf(pid).map((x) => opt(x.id, x.name, color, 0, x.id === sid)).join('')}
    <button type="button" class="proj-opt pf-new" data-action="pf-choose" data-field="sub" data-value="__new">${ICON.plus}<span>Nouveau sous-projet…</span></button>
  </div>`;
}

function pfRefresh(form) {
  const pid = form.elements.projectId.value;
  const [pb, sb] = form.querySelectorAll('.pick-btn');
  pb.innerHTML = projBtn(pid);
  sb.innerHTML = subBtn(pid, form.elements.subprojectId.value);
  sb.disabled = !pid;
}

function newTaskDefaults() {
  const ui = state.ui;
  const fromFilter = getProject(ui.filter);
  const last = getProject(ui.lastProjectId);
  const projectId = fromFilter ? fromFilter.id : last && !last.archived ? last.id : null;
  let subprojectId = null;
  if (fromFilter && getSub(ui.subfilter)?.projectId === projectId) subprojectId = ui.subfilter;
  else if (!fromFilter && getSub(ui.lastSubId)?.projectId === projectId) subprojectId = ui.lastSubId;
  return { title: '', projectId, subprojectId, deadline: '', notes: '', starred: false };
}

// preset : { projectId, subprojectId } pour une tâche créée depuis la page d'un projet.
function openTaskSheet(id, preset) {
  const isNew = !id;
  const t = isNew ? { ...newTaskDefaults(), ...preset } : getTask(id);
  if (!t) return;
  const running = !isNew && !!timerOf(id);
  const sessions = isNew ? [] : state.sessions.filter((s) => s.taskId === id).sort((x, y) => y.start - x.start);
  const total = sessions.reduce((n, s) => n + (s.end - s.start), 0);

  const footer = isNew
    ? `<div class="sheet-actions">
        <button class="btn" value="create">Créer</button>
        <button class="btn primary grow" value="start">${ICON.play} Créer et lancer</button>
      </div>`
    : `<section class="time-box">
        <div class="time-head">
          <div><small>Temps passé</small>${liveDur(total, sinceOf(id))}</div>
          <button type="button" class="btn ${running ? 'stop' : 'primary'}" data-action="toggle-timer" data-id="${id}">${running ? `${ICON.stop} Arrêter` : `${ICON.play} Lancer`}</button>
        </div>
        ${sessions.length ? `<ul class="sessions">${sessions.slice(0, 40).map((s) => `<li><button type="button" data-action="open-session" data-id="${s.id}" data-back="${id}">
          <span>${fmt(new Date(s.start), { weekday: 'short', day: 'numeric', month: 'short' })} · ${hm(new Date(s.start))}–${hm(new Date(s.end))}</span><b>${fmtDur(s.end - s.start)}</b></button></li>`).join('')}</ul>`
          : '<p class="hint">Aucune session pour l’instant.</p>'}
        <button type="button" class="btn ghost small" data-action="add-session" data-id="${id}">${ICON.plus} Ajouter du temps à la main</button>
      </section>
      <div class="sheet-actions">
        <button type="button" class="btn ghost danger" data-action="delete-task" data-id="${id}" aria-label="Supprimer la tâche">${ICON.trash}</button>
        <button type="button" class="btn grow" data-action="toggle-done" data-id="${id}">${t.done ? 'Rouvrir' : `${ICON.check} Terminée`}</button>
        <button type="button" class="btn primary grow" data-action="close-sheet">OK</button>
      </div>`;

  openSheet(`<form class="sheet-body" data-form="task" data-id="${id || ''}" autocomplete="off">
    ${head(isNew ? 'Nouvelle tâche' : 'Tâche')}
    <label class="field"><span>Tâche</span>${emojiField(`<input class="big" name="title" value="${esc(t.title)}" placeholder="Ex. Préparer le cours S2" maxlength="200" required enterkeyhint="done"${isNew ? ' autofocus' : ''}>`)}</label>
    <label class="toggle star-toggle"><input type="checkbox" name="starred"${t.starred ? ' checked' : ''}> ${ICON.star} Prioritaire (affichée en premier)</label>
    ${pickFields(t.projectId, t.subprojectId)}
    <label class="field"><span>Échéance (facultatif)</span><input type="date" name="deadline" value="${esc(t.deadline || '')}"></label>
    <div class="quick-dates">
      <button type="button" data-action="set-deadline" data-value="0">Aujourd’hui</button>
      <button type="button" data-action="set-deadline" data-value="1">Demain</button>
      <button type="button" data-action="set-deadline" data-value="7">Dans 1 semaine</button>
      <button type="button" data-action="set-deadline" data-value="">Aucune</button>
    </div>
    ${ppSection(isNew ? null : id)}
    <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="Détails, étapes, liens…">${esc(t.notes || '')}</textarea></label>
    ${footer}
  </form>`);
  // Création : suggestions de titre et de projet (depuis la page d'un projet, ce projet reste fixé).
  if (isNew) suggestInit($('form', sheet), preset?.projectId ? { p: preset.projectId, s: preset.subprojectId || '' } : {});
}

function readTaskForm(form) {
  const fd = new FormData(form);
  const clean = (v) => (v && v !== '__new' ? String(v) : null);
  const projectId = clean(fd.get('projectId'));
  return {
    title: String(fd.get('title') || '').trim(),
    projectId,
    subprojectId: projectId ? clean(fd.get('subprojectId')) : null,
    deadline: fd.get('deadline') || null,
    notes: String(fd.get('notes') || '').trim(),
    starred: fd.get('starred') === 'on',
  };
}

function commitTaskForm(form) {
  const t = getTask(form.dataset.id);
  if (!t) return;
  const v = readTaskForm(form);
  if (!v.title) v.title = t.title;
  const moved = v.projectId !== t.projectId || v.subprojectId !== t.subprojectId || v.title !== t.title;
  Object.assign(t, v);
  if (moved) {
    // Le temps déjà passé suit la tâche dans son nouveau projet.
    for (const s of state.sessions) {
      if (s.taskId === t.id) Object.assign(s, { projectId: t.projectId, subprojectId: t.subprojectId, title: t.title });
    }
  }
  save();
}

function createTask(form, start) {
  const v = readTaskForm(form);
  if (!v.title) return;
  // Quand : créneau touché dans l'agenda, ou bloc « Planifier dans l'agenda » de la fiche
  const slotDay = form.dataset.slotDay;
  const pp = form.querySelector('.pp[data-on="1"]');
  const pv = pp && ppValues(pp);
  const when = slotDay ? whenValues($('.when', form), slotDay) : pv && pv.day && (pv.hasTime || pv.when.multi) ? pv.when : null;
  if (when && whenInvalid($('.when', form), when)) return;
  const t = { id: uid(), ...v, done: false, doneAt: null, createdAt: now() };
  state.tasks.push(t);
  Object.assign(state.ui, { lastProjectId: t.projectId || '', lastSubId: t.subprojectId || '' });
  if (state.ui.filter !== 'all' && state.ui.filter !== (t.projectId || 'none')) Object.assign(state.ui, { filter: 'all', subfilter: 'all' });
  closeSheet();
  persistStorage();
  if (slotDay) { // créée depuis un créneau de l'agenda : planifiée à cette heure (ou en série, ou sur plusieurs jours)
    const made = planWith(t.id, slotDay, Number(form.dataset.slotMin), when);
    if (form.dataset.event) eventConverted(form.dataset.event, t, made);
    return;
  }
  let planned = '';
  if (when) {
    const made = addPlans(t.id, pv.day, pv.min, when);
    const msg = whenDone(when, pv.day, pv.min, made.length);
    planned = ` · ${msg.charAt(0).toLowerCase()}${msg.slice(1)}`;
  }
  if (start) { startTimer(t.id); toast(`C’est parti, chrono lancé${planned}`); }
  else { save(); render(); toast(`Tâche ajoutée${planned}`); }
}

// Fiche d'une tâche existante : chaque modification est enregistrée aussitôt.
sheet.addEventListener('change', (e) => {
  const form = e.target.closest('form[data-form="task"]');
  if (form?.dataset.id && form.isConnected) { commitTaskForm(form); render(); }
});

/* ----- Projet ----- */

function subRow(name, value) {
  return `<div class="sub-row"><div class="field" style="flex:1;margin:0">${emojiField(`<input name="${name}" value="${esc(value)}" placeholder="Nom du sous-projet" maxlength="60">`)}</div>
    <button type="button" class="icon-btn danger" data-action="remove-sub-row" aria-label="Supprimer le sous-projet">${ICON.trash}</button></div>`;
}

function openProjectSheet(id) {
  const p = getProject(id);
  const isNew = !p;
  const used = new Set(state.projects.map((x) => x.color));
  const color = p?.color || COLORS.find((c) => !used.has(c)) || COLORS[0];
  const others = isNew ? [] : state.projects.filter((x) => x.id !== p.id && !x.archived);
  const convert = others.length ? `<div class="field"><span>Transformer en sous-projet</span>
      <p class="hint" style="margin:0">Range ce projet dans un autre projet, avec ses tâches et son temps. Il y devient un sous-projet.</p>
      <div class="sub-row">
        <div class="field" style="flex:1;margin:0"><select name="moveTo"><option value="">Choisir le projet…</option>${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></div>
        <button type="button" class="btn small" data-action="convert-project" data-id="${p.id}">Transformer</button>
      </div>
    </div>` : '';
  openSheet(`<form class="sheet-body" data-form="project" data-id="${p?.id || ''}" autocomplete="off">
    ${head(isNew ? 'Nouveau projet' : 'Projet')}
    <label class="field"><span>Nom</span>${emojiField(`<input class="big" name="name" value="${esc(p?.name || '')}" placeholder="Ex. Pro, Agreg, Famille…" maxlength="60" required${isNew ? ' autofocus' : ''}>`)}</label>
    <div class="field"><span>Couleur</span><div class="swatches">${COLORS.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}"${c === color ? ' checked' : ''}><i></i></label>`).join('')}</div></div>
    <div class="field"><span>Sous-projets</span>
      <div class="subs">${isNew ? '' : subsOf(p.id).map((s) => subRow(`sub:${s.id}`, s.name)).join('')}</div>
      <button type="button" class="btn ghost small" style="align-self:flex-start" data-action="add-sub">${ICON.plus} Ajouter un sous-projet</button>
    </div>
    ${isNew ? '' : `<label class="toggle"><input type="checkbox" name="archived"${p.archived ? ' checked' : ''}> Archiver (masqué des listes, gardé dans les stats)</label>`}
    ${convert}
    <div class="sheet-actions">
      ${isNew ? '' : `<button type="button" class="btn ghost danger" data-action="delete-project" data-id="${p.id}">${ICON.trash} Supprimer</button>`}
      <button class="btn primary grow">${isNew ? 'Créer le projet' : 'Enregistrer'}</button>
    </div>
  </form>`);
}

function saveProject(form) {
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  if (!name) return;
  const p = getProject(form.dataset.id) || addProject(name, fd.get('color'));
  Object.assign(p, { name, color: fd.get('color') || p.color, archived: fd.get('archived') === 'on' });
  for (const [k, v] of fd.entries()) {
    const val = String(v).trim();
    if (k === 'del') deleteSub(val);
    else if (k.startsWith('sub:new')) { if (val) addSub(p.id, val); }
    else if (k.startsWith('sub:')) { const s = getSub(k.slice(4)); if (s && val) s.name = val; }
  }
  if (p.archived && state.ui.filter === p.id) Object.assign(state.ui, { filter: 'all', subfilter: 'all' });
  save(); closeSheet(); render();
}

/* ----- Session (temps) ----- */

function openSessionSheet(sid, opts = {}) {
  const t0 = now();
  const s = sid ? state.sessions.find((x) => x.id === sid) : { taskId: opts.taskId, start: t0 - 30 * 60e3, end: t0 };
  if (!s) return;
  const t = getTask(s.taskId);
  const mins = Math.round((s.end - s.start) / 60e3);
  const d = new Date(s.start);
  openSheet(`<form class="sheet-body" data-form="session" data-id="${sid || ''}" data-task="${esc(s.taskId || '')}" data-back="${esc(opts.back || '')}">
    ${head(sid ? 'Session' : 'Ajouter du temps')}
    ${opts.warn ? `<p class="warn">Le chrono a tourné ${fmtDur(s.end - s.start)}. Un oubli ? Corrige la durée si besoin.</p>` : ''}
    <p class="hint"><b>${esc(t?.title || s.title || 'Tâche')}</b> · ${esc(pathLabel(t ? t.projectId : s.projectId, t ? t.subprojectId : s.subprojectId))}</p>
    <div class="row2">
      <label class="field"><span>Jour</span><input type="date" name="date" value="${ymd(d)}" required></label>
      <label class="field"><span>Début</span><input type="time" name="time" value="${hm(d)}" required></label>
    </div>
    <div class="row2">
      <label class="field"><span>Heures</span><input type="number" name="h" min="0" max="99" inputmode="numeric" value="${Math.floor(mins / 60)}"></label>
      <label class="field"><span>Minutes</span><input type="number" name="m" min="0" max="59" inputmode="numeric" value="${mins % 60}"></label>
    </div>
    <div class="sheet-actions">
      ${sid ? `<button type="button" class="btn ghost danger" data-action="delete-session" data-id="${sid}">${ICON.trash} Supprimer</button>` : ''}
      <button class="btn primary grow">${sid ? 'Enregistrer' : 'Ajouter'}</button>
    </div>
  </form>`);
}

function afterSessionSheet(back) {
  if (back && getTask(back)) openTaskSheet(back);
  else closeSheet();
  render();
}

function saveSession(form) {
  const fd = new FormData(form);
  const date = String(fd.get('date') || '');
  const time = String(fd.get('time') || '');
  if (!date || !time) return;
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mi] = time.split(':').map(Number);
  let start = +new Date(y, mo - 1, d, hh, mi);
  const mins = (parseInt(fd.get('h'), 10) || 0) * 60 + (parseInt(fd.get('m'), 10) || 0);
  if (mins <= 0) { toast('Indique une durée (heures ou minutes)'); return; }

  const s = state.sessions.find((x) => x.id === form.dataset.id);
  if (s) {
    const old = new Date(s.start);
    if (ymd(old) === date && hm(old) === time) start = s.start; // garde les secondes si rien n'a changé
    const dur = Math.round((s.end - s.start) / 60e3) === mins ? s.end - s.start : mins * 60e3;
    Object.assign(s, { start, end: start + dur });
  } else {
    const t = getTask(form.dataset.task);
    state.sessions.push({
      id: uid(), taskId: t?.id || null, title: t?.title || 'Tâche',
      projectId: t?.projectId || null, subprojectId: t?.subprojectId || null, start, end: start + mins * 60e3,
    });
  }
  save();
  afterSessionSheet(form.dataset.back);
}

sheet.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.dataset.form === 'task') {
    if (form.dataset.id) closeSheet();
    else createTask(form, e.submitter?.value === 'start');
  } else if (form.dataset.form === 'project') saveProject(form);
  else if (form.dataset.form === 'session') saveSession(form);
  else if (form.dataset.form === 'clean') {
    const ids = new Set(new FormData(form).getAll('drop'));
    if (!ids.size) { closeSheet(); return; }
    const removed = { projects: state.projects.filter((p) => ids.has(p.id)), subs: state.subprojects.filter((x) => ids.has(x.projectId)) };
    for (const id of ids) deleteProject(id);
    save(); closeSheet(); render();
    toast(`${ids.size} projet${ids.size > 1 ? 's supprimés' : ' supprimé'}`, {
      label: 'Annuler', fn: () => { state.projects.push(...removed.projects); state.subprojects.push(...removed.subs); save(); render(); },
    });
  }
  else if (form.dataset.form === 'plan') closeSheet();
});

/* ----- Réglages, sauvegarde ----- */

function installHelp() {
  if (temp.installEvt) return `<button type="button" class="btn primary wide" data-action="install">${ICON.plus} Installer l’application</button>`;
  if (isIOS()) {
    return `<p class="hint">Sur iPhone, dans <b>Safari</b> :</p>
      <ol class="steps"><li>Touche le bouton <b>Partager</b> (carré avec une flèche)</li><li>Choisis <b>Sur l’écran d’accueil</b></li><li>Touche <b>Ajouter</b></li></ol>`;
  }
  return `<p class="hint">Sur Android, dans <b>Chrome</b> :</p>
    <ol class="steps"><li>Touche le menu <b>⋮</b> en haut à droite</li><li>Choisis <b>Installer l’application</b> (ou <b>Ajouter à l’écran d’accueil</b>)</li></ol>`;
}

function openSettings() {
  const last = state.ui.lastBackup ? fmt(new Date(state.ui.lastBackup), { day: 'numeric', month: 'long', year: 'numeric' }) : 'jamais';
  temp.showCode = false;
  openSheet(`<div class="sheet-body">
    ${head('Réglages')}
    <section class="set-group"><h3>Profil</h3>
      <p class="hint">Tu utilises l’app en tant que <b>${esc(getProfile(profile)?.name)}</b>. Chaque profil a ses propres tâches, projets, chronos et stats.</p>
      <button type="button" class="btn wide" data-action="switch-profile">Changer de profil</button>
    </section>
    <section class="set-group"><h3>Application</h3>
      ${isStandalone() ? '<p class="hint">✓ L’app est installée sur cet appareil.</p>' : installHelp()}
    </section>
    <section class="set-group"><h3>Synchronisation</h3><div id="sync-box">${syncSection()}</div></section>
    <section class="set-group"><h3>Sauvegarde</h3>
      <p class="hint">${syncConf.code ? 'Tes données sont enregistrées sur cet appareil et synchronisées (chiffrées).' : 'Tes données restent sur cet appareil : rien n’est envoyé sur internet.'} Fais une sauvegarde de temps en temps (dernière : <b>${last}</b>).</p>
      <button type="button" class="btn wide" data-action="export-json">Sauvegarder mes données (.json)</button>
      <button type="button" class="btn wide" data-action="import-json">Restaurer une sauvegarde</button>
      <button type="button" class="btn wide" data-action="export-csv">Exporter le journal pour Excel (.csv)</button>
    </section>
    <section class="set-group"><h3>Zone sensible</h3>
      <button type="button" class="btn wide danger" data-action="reset-all">${ICON.trash} Tout effacer (profil ${esc(getProfile(profile)?.name)})</button>
    </section>
    <p class="hint center">Chrono Todo · v${VERSION}</p>
  </div>`);
}

async function shareOrDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const file = new File([blob], filename, { type: mime });
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function exportJson() {
  const data = JSON.stringify({ ...state, app: 'chrono-todo', exportedAt: new Date().toISOString() });
  if (await shareOrDownload(`chrono-todo-${profile}-${ymd(new Date())}.json`, data, 'application/json')) {
    state.ui.lastBackup = now();
    writeLocal(); closeSheet(); toast('Sauvegarde créée');
  }
}

function importJson() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    let data;
    try { data = normalize(JSON.parse(await file.text())); } catch (e) { toast('Ce fichier n’est pas une sauvegarde valide'); return; }
    const ok = await ask({
      title: 'Restaurer cette sauvegarde ?',
      text: `${data.tasks.length} tâche(s), ${data.projects.length} projet(s), ${data.sessions.length} session(s). Les données actuelles seront remplacées${syncConf.code ? ', aussi sur tes autres appareils synchronisés' : ''}.`,
      ok: 'Restaurer', danger: true,
    });
    if (!ok) return;
    Object.assign(data.ui, { tab: state.ui.tab, syncRev: '', syncDirty: false });
    data.deleted = state.deleted; // ce qui manque dans la sauvegarde sera supprimé (aussi via la synchro)
    state = data;
    save(); closeSheet(); render(); toast('Sauvegarde restaurée');
  };
  input.click();
}

function exportCsv() {
  const cell = (v) => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['Date', 'Début', 'Fin', 'Projet', 'Sous-projet', 'Tâche', 'Durée (h)', 'Durée']];
  for (const s of [...state.sessions].sort((a, b) => a.start - b.start)) {
    const a = new Date(s.start);
    rows.push([
      fmt(a, { day: '2-digit', month: '2-digit', year: 'numeric' }), hm(a), hm(new Date(s.end)),
      getProject(s.projectId)?.name || '', getSub(s.subprojectId)?.name || '', getTask(s.taskId)?.title || s.title || '',
      ((s.end - s.start) / 3600e3).toFixed(2).replace('.', ','), fmtDur(s.end - s.start),
    ]);
  }
  shareOrDownload(`chrono-todo-journal-${profile}-${ymd(new Date())}.csv`, `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`, 'text/csv');
}

async function resetAll() {
  const where = syncConf.code ? 'de cet appareil et de tes autres appareils synchronisés' : 'de cet appareil';
  const who = getProfile(profile)?.name;
  const ok = await ask({ title: `Tout effacer pour ${who} ?`, text: `Les tâches, projets et temps de ${who} seront supprimés ${where}. L’autre profil n’est pas touché. Fais une sauvegarde avant si besoin.`, ok: 'Tout effacer', danger: true });
  if (!ok) return;
  const { deleted } = state;
  state = seedState(profile);
  state.deleted = deleted;
  save(); closeSheet(); render(); toast('Données effacées');
}

/* ---------- Synchronisation entre appareils ----------
   Un « code de synchro » secret, généré par l'app, est saisi sur chaque appareil.
   Il donne l'identifiant de stockage et la clé de chiffrement : le serveur (worker.js)
   ne reçoit que des données chiffrées. Chaque appareil garde toutes ses données et
   fusionne celles des autres élément par élément (la version la plus récente gagne). */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 (faciles à confondre)
const CODE_LEN = 20;                                    // 100 bits : impossible à deviner
const SYNC_DELAY = 2500;                                // regroupe les modifications rapprochées
const SYNC_EVERY = 30e3;                                // vérifie les autres appareils quand l'app est ouverte
const FORGET_DELETED = 180 * 864e5;                     // durée de conservation des marqueurs de suppression

let syncConf = loadSyncConf(); // { code, last, error } ; la version fusionnée est dans state.ui
let syncing = null;
let syncAgain = false;
let syncTimer = 0;

function loadSyncConf() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; }
}

function saveSyncConf() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncConf)); } catch (e) { /* plein */ }
}

function newCode() {
  return [...crypto.getRandomValues(new Uint8Array(CODE_LEN))].map((b) => CODE_CHARS[b & 31]).join('');
}

const fmtCode = (c) => c.match(/.{1,4}/g).join('-');
const maskCode = (c) => `${c.slice(0, 4)}-••••-••••-••••-${c.slice(-4)}`; // début et fin visibles pour comparer

function readCode(input) {
  const c = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  return c.length === CODE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null;
}

// Un seul code pour le foyer ; chaque profil a son propre espace de stockage chiffré.
// Romain garde l'identifiant d'origine (synchro déjà en place avant les profils).
async function syncKeys(code, prof = profile) {
  if (temp.keys?.code === code && temp.keys.prof === prof) return temp.keys;
  const tag = prof === 'romain' ? '' : `:${prof}`;
  const hash = (s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const id = [...new Uint8Array(await hash(`chronotodo:id:${code}${tag}`))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', await hash(`chronotodo:key:${code}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return (temp.keys = { code, prof, id, key });
}

// Chiffrement AES-GCM (après compression gzip si le navigateur sait le faire).
const pipeBytes = (bytes, stream) => new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();

// Envoi sans compression : les iPhone avant iOS 16.4 ne savent pas décompresser,
// et ne pourraient alors ni lire ni envoyer leurs données.
async function seal(text, key) {
  const data = new TextEncoder().encode(text);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head = new Uint8Array([1, ...iv]);
  return new Blob([head, await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, key, data)]);
}

async function unseal(buf, key) {
  if (new Uint8Array(buf, 0, 1)[0] === 2 && typeof DecompressionStream !== 'function') {
    throw new Error('données compressées par un autre appareil : elles seront relues dès sa prochaine synchro');
  }
  try {
    const head = new Uint8Array(buf, 0, 13);
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: head.slice(1), additionalData: head }, key, new Uint8Array(buf, 13));
    return new TextDecoder().decode(head[0] === 2 ? await pipeBytes(data, new DecompressionStream('gzip')) : data);
  } catch (e) {
    throw new Error('données de synchro illisibles');
  }
}

// Données envoyées : tout sauf l'affichage (onglet, filtres…), propre à chaque appareil.
// L'ordre des listes est conservé (ordre des projets, des sous-projets).
// « active » (le chrono le plus récent) reste écrit pour les appareils pas encore à jour.
const docText = (d) => JSON.stringify({ v: 1, ...Object.fromEntries(SYNCED.map((c) => [c, d[c]])), timers: d.timers, active: runningOf(d)[0] || null, deleted: d.deleted });
const runningOf = (d) => d.timers.slice().sort((a, b) => b.start - a.start);

function readDoc(text) {
  const d = JSON.parse(text);
  const out = { timers: timerList(d), deleted: {} };
  for (const c of SYNCED) out[c] = Array.isArray(d[c]) ? d[c].filter((x) => x && typeof x.id === 'string') : [];
  for (const [k, t] of Object.entries(d.deleted || {})) if (typeof t === 'number') out.deleted[k] = t;
  return out;
}

// La version la plus récente gagne ; à égalité, un choix arbitraire mais le même sur tous les appareils.
const canon = (x) => JSON.stringify(x, Object.keys(x).sort());
const newerThan = (a, b) => ((a.updatedAt || 0) !== (b.updatedAt || 0) ? (a.updatedAt || 0) > (b.updatedAt || 0) : canon(a) > canon(b));

// Fusionne dans l'état local les données d'un autre appareil. Renvoie
// changed : l'état local a changé ; differs : le résultat diffère des données reçues (à renvoyer).
function mergeRemote(remote) {
  const out = { changed: false, differs: false };
  const del = state.deleted;
  const delBefore = { ...del };
  for (const [k, t] of Object.entries(remote.deleted)) if (!(del[k] >= t)) del[k] = t;
  for (const [k, t] of Object.entries(del)) if (t < now() - FORGET_DELETED) delete del[k];

  for (const c of SYNCED) {
    const theirs = new Map(remote[c].map((x) => [x.id, x]));
    const merged = [];
    // Une suppression l'emporte sur les versions plus anciennes de l'élément.
    const keep = (x, inLocal, inRemote, asLocal, asRemote) => {
      if (del[x.id] >= (x.updatedAt || 0)) { out.changed ||= inLocal; out.differs ||= inRemote; return; }
      out.changed ||= !asLocal;
      out.differs ||= !asRemote;
      merged.push(x);
    };
    for (const x of state[c]) {
      const r = theirs.get(x.id);
      theirs.delete(x.id);
      if (!r) keep(x, true, false, true, false);
      else if (same(x, r)) keep(x, true, true, true, true);
      else if (newerThan(r, x)) {
        for (const k of Object.keys(x)) delete x[k];
        Object.assign(x, r); // garde le même objet (références en cours dans l'interface)
        keep(x, true, true, false, true);
      } else keep(x, true, true, true, false);
    }
    for (const r of theirs.values()) keep(r, false, true, false, true);
    state[c] = merged;
  }

  const timers = timerKeys(state.timers);
  state.timers = mergeTimers(state.timers, remote.timers);
  out.changed ||= timerKeys(state.timers) !== timers || !same(del, delBefore);
  out.differs ||= timerKeys(state.timers) !== timerKeys(remote.timers) || !same(del, remote.deleted);
  return out;
}

// Chronos des deux appareils, sauf ceux qui ont été arrêtés. Un seul chrono par tâche : si deux appareils
// ont lancé la même tâche chacun sans connexion, le plus récent continue et l'autre est enregistré
// comme arrêté à ce moment-là.
function mergeTimers(mine, theirs) {
  const del = state.deleted;
  const byTask = new Map();
  for (const x of [...mine, ...theirs]) {
    if (del[timerKey(x)]) continue;
    const other = byTask.get(x.taskId);
    if (!other) { byTask.set(x.taskId, x); continue; }
    if (timerKey(other) === timerKey(x)) continue;
    const xWins = x.start !== other.start ? x.start > other.start : timerKey(x) > timerKey(other);
    const [win, lose] = xWins ? [x, other] : [other, x];
    byTask.set(x.taskId, win);
    del[timerKey(lose)] = win.start;
    const id = timerSessionId(lose);
    if (win.start - lose.start >= MIN_SESSION && !del[id] && !state.sessions.some((s) => s.id === id)) {
      const t = getTask(lose.taskId);
      state.sessions.push({
        id, taskId: lose.taskId, title: t?.title || 'Tâche', projectId: t?.projectId || null,
        subprojectId: t?.subprojectId || null, start: lose.start, end: win.start, updatedAt: win.start,
      });
    }
  }
  return [...byTask.values()].map(({ taskId, start }) => ({ taskId, start })).sort((a, b) => b.start - a.start);
}

// Première fusion avec les autres appareils : les projets jamais utilisés de cet appareil
// (projets de départ, par exemple) ne sont pas envoyés aux autres.
function pruneUnusedLocal(remote) {
  if (!remote.projects.length) return false;
  const remoteIds = new Set(remote.projects.map((p) => p.id));
  const used = new Set([...state.tasks, ...state.sessions].map((x) => x.projectId).filter(Boolean));
  const drop = new Set(state.projects.filter((p) => !remoteIds.has(p.id) && !used.has(p.id)).map((p) => p.id));
  if (!drop.size) return false;
  state.projects = state.projects.filter((p) => !drop.has(p.id));
  state.subprojects = state.subprojects.filter((x) => !drop.has(x.projectId));
  return true;
}

// Avant une première fusion : les projets et sous-projets de même nom ne sont pas dédoublés.
function adoptNames(remote) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const alive = (x) => !(remote.deleted[x.id] >= (x.updatedAt || 0) || state.deleted[x.id] >= (x.updatedAt || 0));
  const theirIds = new Set([...remote.projects, ...remote.subprojects].map((x) => x.id));
  const map = new Map();
  for (const p of state.projects) {
    const twin = !theirIds.has(p.id) && remote.projects.find((r) => alive(r) && norm(r.name) === norm(p.name));
    if (twin) map.set(p.id, twin.id);
  }
  for (const s of state.subprojects) {
    const projectId = map.get(s.projectId) || s.projectId;
    const twin = !theirIds.has(s.id) && remote.subprojects.find((r) => alive(r) && r.projectId === projectId && norm(r.name) === norm(s.name));
    if (twin) map.set(s.id, twin.id);
    else s.projectId = projectId;
  }
  if (!map.size) return false;
  state.projects = state.projects.filter((p) => !map.has(p.id));
  state.subprojects = state.subprojects.filter((s) => !map.has(s.id));
  for (const x of [...state.tasks, ...state.sessions]) {
    if (map.has(x.projectId)) x.projectId = map.get(x.projectId);
    if (map.has(x.subprojectId)) x.subprojectId = map.get(x.subprojectId);
  }
  return true;
}

class SyncError extends Error {
  constructor(message, offline = false) { super(message); this.offline = offline; }
}

async function api(method, id, { body, base, have, keepalive = false } = {}) {
  const url = `api/sync/${id}${have ? `?have=${encodeURIComponent(have)}` : ''}`;
  let res;
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined; // réseau bloqué : on n'attend pas indéfiniment
    res = await fetch(url, { method, body, signal, keepalive, cache: 'no-store', headers: base === undefined ? {} : { 'x-base-rev': base } });
  } catch (e) {
    throw new SyncError('hors ligne', true);
  }
  if (res.ok || res.status === 404 || res.status === 409) return res;
  const why = { 413: 'données trop volumineuses', 503: 'serveur de synchro indisponible' }[res.status];
  throw new SyncError(why || `erreur du serveur (${res.status})`);
}

// Formulaire ouvert : on attend qu'il soit fermé pour ne pas modifier les données sous les doigts.
const editing = () => (sheet.open && !!$('form', sheet)) || $('#ask').open || !!drag.active || !!drag.pending;

function scheduleSync(delay = SYNC_DELAY) {
  clearTimeout(syncTimer);
  if (syncConf.code) syncTimer = setTimeout(syncNow, delay);
}

// opts.keepalive : l'app passe en arrière-plan (l'envoi doit aboutir même si elle est fermée).
function syncNow(opts = {}) {
  clearTimeout(syncTimer);
  if (!syncConf.code || !profile) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  if (editing()) { scheduleSync(3000); return Promise.resolve(); }
  syncing = (async () => {
    try {
      if (await syncOnce(opts)) Object.assign(syncConf, { last: now(), error: '' });
    } catch (e) {
      syncConf.error = e.offline ? 'offline' : e.message;
    }
    saveSyncConf();
  })().finally(() => {
    syncing = null;
    refreshSyncUi();
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  });
  syncBadge();
  return syncing;
}

// Récupère les données des autres appareils, fusionne, puis envoie le résultat si besoin.
async function syncOnce(opts = {}) {
  const { code } = syncConf;
  const prof = profile;
  if (!crypto.subtle) throw new SyncError('connexion non sécurisée (https requis)');
  const { id, key } = await syncKeys(code, prof);
  for (let attempt = 0; attempt < 4; attempt++) {
    // Tant que le nouveau format n'est pas confirmé, on retélécharge tout (pour repérer l'ancien format).
    const res = await api('GET', id, { have: state.ui.syncFmt === 2 ? state.ui.syncRev : '' });
    let rev = state.ui.syncRev;
    let remote = null;
    let legacy = false;
    if (res.status === 200) {
      rev = res.headers.get('x-rev') || '';
      const buf = await res.arrayBuffer();
      legacy = new Uint8Array(buf, 0, 1)[0] === 2; // ancien format compressé : on le réécrit lisible par tous
      remote = readDoc(await unseal(buf, key));
    } else if (res.status === 404) {
      rev = '';
      remote = readDoc('{}');
    }
    if (syncConf.code !== code || profile !== prof) return false; // synchro désactivée ou profil changé entre-temps
    if (editing()) { scheduleSync(3000); return false; }

    const ui = state.ui;
    let push = ui.syncDirty;
    if (res.status === 200 && ui.pristine) {
      // Profil jamais utilisé sur cet appareil : on reprend ses données telles qu'elles sont ailleurs
      // (sans y ajouter les projets de départ).
      for (const c of SYNCED) state[c] = [];
      state.timers = [];
    }
    if (remote) ui.pristine = false;
    if (remote) {
      const pruned = !ui.syncRev && pruneUnusedLocal(remote);
      const adopted = (!ui.syncRev && adoptNames(remote)) || pruned; // première fusion : pas de projets en double
      const { changed, differs } = mergeRemote(remote);
      if (changed || adopted) { snapshot(); render(); }
      push = differs || legacy;
      if (res.status === 200 && !legacy) ui.syncFmt = 2;
    }
    if (!push) {
      if (remote || ui.syncDirty || ui.syncRev !== rev) { Object.assign(ui, { syncRev: rev, syncDirty: false }); writeLocal(); }
      return true;
    }

    // syncDirty repasse à true si on modifie quelque chose pendant l'envoi.
    Object.assign(ui, { syncRev: rev, syncDirty: false });
    let sent = false;
    try {
      const body = await seal(docText(state), key);
      if (profile !== prof) return false;
      const put = await api('PUT', id, { body, base: rev, keepalive: !!opts.keepalive && body.size < 60000 });
      if (put.status === 200) { Object.assign(state.ui, { syncRev: (await put.json()).rev, syncFmt: 2 }); sent = true; return true; }
      // 409 : un autre appareil vient d'envoyer ses données ; on refusionne et on réessaie.
      if (put.status !== 409) throw new SyncError(`erreur du serveur (${put.status})`);
    } finally {
      if (profile === prof) {
        if (!sent) state.ui.syncDirty = true;
        writeLocal();
      }
    }
  }
  throw new SyncError('trop de modifications simultanées, nouvel essai bientôt');
}

async function enableSync() {
  if (!crypto.subtle) { toast('Synchro possible uniquement sur la version en ligne (https)'); return; }
  syncConf = { code: newCode(), last: 0, error: '' };
  saveSyncConf();
  Object.assign(state.ui, { syncRev: '', syncDirty: true });
  writeLocal();
  temp.showCode = true;
  refreshSyncUi();
  await syncNow();
  toast(syncConf.error ? 'Synchro activée, envoi en attente' : 'Synchro activée ✓');
}

async function joinSync() {
  if (!crypto.subtle) { toast('Synchro possible uniquement sur la version en ligne (https)'); return; }
  const switching = !!syncConf.code;
  const input = await ask({
    title: switching ? 'Code de l’autre appareil' : 'Code de synchro',
    text: switching
      ? 'Saisis le code affiché sur ton autre appareil. Les données de cet appareil seront regroupées avec les siennes, et les deux utiliseront ce code.'
      : 'Saisis le code affiché sur ton autre appareil (Réglages › Synchronisation).',
    input: true, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX', ok: 'Valider', code: true,
  });
  if (!input) return;
  const code = readCode(input);
  if (!code) { toast(`Code incomplet ou mal saisi (${CODE_LEN} caractères)`); return; }
  if (code === syncConf.code) { toast('C’est déjà le code de cet appareil ✓'); return; }

  let remote = null;
  let rev = '';
  try {
    const { id, key } = await syncKeys(code);
    const res = await api('GET', id);
    if (res.status === 404) {
      // Ce profil n'a peut-être encore rien envoyé : le code est bon si l'autre profil a des données.
      let known = false;
      for (const p of PROFILES) {
        if (p.id !== profile && (await api('GET', (await syncKeys(code, p.id)).id)).status !== 404) { known = true; break; }
      }
      if (!known) { toast('Code inconnu : vérifie-le sur ton autre appareil'); return; }
    } else {
      rev = res.headers.get('x-rev') || '';
      remote = readDoc(await unseal(await res.arrayBuffer(), key));
    }
  } catch (e) {
    toast(e.offline ? 'Pas de connexion internet' : `Synchro impossible : ${e.message}`);
    return;
  }

  if (!remote) {
    // Rien encore pour ce profil : on envoie simplement ses données actuelles.
    syncConf = { code, last: 0, error: '' };
    saveSyncConf();
    resetOtherProfiles();
    Object.assign(state.ui, { syncRev: '', syncFmt: 0, syncDirty: true, pristine: false });
    writeLocal();
    refreshSyncUi();
    toast('Synchro activée ✓');
    syncNow();
    return;
  }

  const fresh = state.ui.pristine || (!state.tasks.length && !state.sessions.length);
  if (fresh) {
    // Appareil neuf : on reprend simplement les données de l'autre appareil.
    for (const c of SYNCED) state[c] = [];
    Object.assign(state, { timers: [], deleted: {} });
  } else {
    const ok = await ask({
      title: 'Regrouper les données ?',
      text: `Cet appareil contient déjà ${state.tasks.length} tâche(s) et ${state.sessions.length} session(s). Elles seront ajoutées à celles de ton autre appareil.`,
      ok: 'Regrouper',
    });
    if (!ok) return;
    pruneUnusedLocal(remote);
    adoptNames(remote);
  }
  mergeRemote(remote);
  snapshot();
  Object.assign(state.ui, { syncRev: rev, syncFmt: 0, syncDirty: !fresh, pristine: false });
  writeLocal();
  syncConf = { code, last: now(), error: '' };
  saveSyncConf();
  resetOtherProfiles();
  render();
  refreshSyncUi();
  toast('Synchro activée ✓');
  if (!fresh) syncNow();
}

// Nouveau code : l'autre profil de cet appareil repartira de zéro avec ce code à sa prochaine ouverture
// (première fusion sans doublons ; projets de départ jamais utilisés remplacés par ceux de l'autre appareil).
function resetOtherProfiles() {
  for (const pr of PROFILES) {
    if (pr.id === profile) continue;
    const st = peek(pr.id);
    if (!st) continue;
    const unused = !st.tasks.length && !st.sessions.length;
    Object.assign(st.ui, { syncRev: '', syncFmt: 0, syncDirty: true, pristine: unused || st.ui.pristine });
    try { localStorage.setItem(storeKey(pr.id), JSON.stringify(st)); } catch (e) { /* plein */ }
  }
}

async function disableSync() {
  const ok = await ask({
    title: 'Désactiver la synchro ?',
    text: 'Cet appareil ne sera plus synchronisé, pour les deux profils. Les données restent ici et sur vos autres appareils.',
    ok: 'Désactiver',
  });
  if (!ok) return;
  syncConf = {};
  saveSyncConf();
  Object.assign(state.ui, { syncRev: '', syncDirty: false });
  writeLocal();
  temp.keys = null;
  refreshSyncUi();
  toast('Synchro désactivée');
}

function ago(t) {
  const s = (now() - t) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  const d = new Date(t);
  return ymd(d) === ymd(new Date()) ? `aujourd’hui à ${hm(d)}` : `le ${fmt(d, { day: 'numeric', month: 'long' })} à ${hm(d)}`;
}

function syncStatus() {
  if (syncConf.error === 'offline') return ['off', 'Hors ligne : la synchro reprendra dès le retour du réseau.'];
  if (syncConf.error) return ['err', `Problème de synchro : ${syncConf.error}.`];
  if (syncConf.last) return ['ok', `✓ Synchronisé ${ago(syncConf.last)}`];
  return ['', 'Synchronisation…'];
}

function syncSection() {
  if (!syncConf.code) {
    return `<p class="hint">Retrouve tes tâches, tes projets et tes temps sur ton téléphone et ton ordinateur. Un seul code pour le foyer : Romain et Rebecca gardent chacun leurs données. Si la synchro est déjà activée sur un autre appareil, choisis <b>J’ai déjà un code</b>.</p>
      <button type="button" class="btn primary wide" data-action="sync-enable">Activer la synchro</button>
      <button type="button" class="btn wide" data-action="sync-join">J’ai déjà un code</button>`;
  }
  const [cls, text] = syncStatus();
  return `<p class="sync-state ${cls}">${esc(text)}</p>
    <div class="code-box">
      <code>${temp.showCode ? fmtCode(syncConf.code) : maskCode(syncConf.code)}</code>
      <button type="button" class="link" data-action="sync-reveal">${temp.showCode ? 'Masquer' : 'Afficher'}</button>
    </div>
    <p class="hint">Tous vos appareils doivent avoir <b>le même code</b> (compare le début et la fin). Si ton autre appareil affiche un code différent, touche <b>Utiliser le code d’un autre appareil</b> sur l’un des deux et saisis le code de l’autre. Garde-le pour toi : il donne accès à vos données.</p>
    <button type="button" class="btn wide" data-action="sync-copy">Copier le code</button>
    <button type="button" class="btn wide" data-action="sync-join">Utiliser le code d’un autre appareil</button>
    <button type="button" class="btn wide" data-action="sync-now">Synchroniser maintenant</button>
    <button type="button" class="btn wide ghost danger" data-action="sync-off">Désactiver sur cet appareil</button>`;
}

function refreshSyncUi() {
  const box = $('#sync-box');
  if (box) box.innerHTML = syncSection();
  syncBadge();
}

// Nuage dans l'en-tête : état de la synchro d'un coup d'œil (le toucher synchronise tout de suite).
function syncBadge() {
  const el = $('#sync');
  if (!el || !profile) return;
  let st;
  if (!syncConf.code) st = ['off', 'Synchro non activée sur cet appareil'];
  else if (syncing) st = ['busy', 'Synchronisation…'];
  else if (syncConf.error === 'offline') st = ['offline', 'Hors ligne : envoi dès le retour du réseau'];
  else if (syncConf.error) st = ['err', `Problème de synchro : ${syncConf.error}`];
  else if (state.ui.syncDirty) st = ['pending', 'Modifications en attente d’envoi'];
  else st = ['ok', syncConf.last ? `Synchronisé ${ago(syncConf.last)}` : 'Synchronisé'];
  if (syncConf.code) st[1] += ` · code ${syncConf.code.slice(0, 4)}…${syncConf.code.slice(-4)}`;
  el.className = `sync-dot ${st[0]}`;
  el.title = st[1];
  el.setAttribute('aria-label', st[1]);
  if (!el.firstChild) el.innerHTML = `${ICON.cloud}<i></i>`;
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(fmtCode(syncConf.code));
    toast('Code copié');
  } catch (e) {
    temp.showCode = true;
    refreshSyncUi();
    toast('Copie impossible : recopie le code affiché');
  }
}

/* ---------- Planning (emploi du temps de la semaine) ---------- */

const DAY_MIN = 1440;
const VIEW_START = 6 * 60;               // la grille commence à 6h
const VIEW_SPAN = DAY_MIN - VIEW_START;
const posPct = (m) => (((m - VIEW_START) / VIEW_SPAN) * 100).toFixed(3);
const SNAP = 15;          // les créneaux se calent au quart d'heure
const PLAN_DUR = 60;      // durée par défaut d'une tâche planifiée
const EVENT_COLORS = ['#64748b', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
const minLabel = (m) => `${Math.floor(m / 60)}h${pad(m % 60)}`;
const shortLabel = (m) => (m % 60 ? minLabel(m) : `${m / 60}h`); // « 8h », « 13h30 »
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const dateAt = (day, m) => { const [y, mo, d] = day.split('-').map(Number); return +new Date(y, mo - 1, d, 0, m); };
// Minute de la journée (heure locale) d'un instant, ou 1440 pour minuit le lendemain.
const minOfDay = (t, day) => (ymd(new Date(t)) === day ? new Date(t).getHours() * 60 + new Date(t).getMinutes() : t > dateAt(day, 0) ? DAY_MIN : 0);

function dropOrphanPlans() {
  state.plans = state.plans.filter((p) => getTask(p.taskId));
}

function planDays() {
  const anchor = parseYmd(state.ui.planDate || ymd(new Date()));
  const monday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - ((anchor.getDay() + 6) % 7));
  const week = [...Array(7)].map((_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  return { anchor, week, shown: state.ui.planView === 'day' ? [anchor] : week };
}

function eventsOn(d) {
  const iso = String(((d.getDay() + 6) % 7) + 1);
  const key = ymd(d);
  return state.events.filter((ev) => (ev.date ? ev.date === key : String(ev.days || '').includes(iso)));
}

// Créneaux à heure fixe d'un jour (les tâches sur plusieurs jours sont à part : spansOn).
function plansOn(day) {
  const a = dateAt(day, 0);
  const b = dateAt(day, DAY_MIN);
  return state.plans.filter((p) => !p.allDay && p.end > a && p.start < b && getTask(p.taskId));
}

// Tâches sur plusieurs jours (journées entières, ex. un voyage) qui touchent la période [a, b[.
const spansIn = (a, b) => state.plans.filter((p) => p.allDay && p.end > a && p.start < b && getTask(p.taskId));
const spansOn = (day) => spansIn(dateAt(day, 0), dateAt(day, DAY_MIN));

// Range les blocs qui se chevauchent côte à côte.
function pack(items) {
  items.sort((x, y) => x.s - y.s || y.e - x.e);
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of group) {
      let c = cols.findIndex((end) => end <= it.s);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = it.e;
      it.col = c;
    }
    for (const it of group) it.ncol = cols.length;
    group = [];
  };
  for (const it of items) {
    if (group.length && it.s >= groupEnd) { flush(); groupEnd = -1; }
    group.push(it);
    groupEnd = Math.max(groupEnd, it.e);
  }
  if (group.length) flush();
  return items;
}

const boxStyle = (it) => `top:${posPct(it.s)}%;height:${(((it.e - it.s) / VIEW_SPAN) * 100).toFixed(3)}%;`
  + `left:calc(${((it.col / it.ncol) * 100).toFixed(2)}% + 2px);width:calc(${(100 / it.ncol).toFixed(2)}% - 4px)`;

// Tâches à planifier : prioritaires d'abord, puis celles pas encore planifiées cette semaine.
function trayTasks(weekStart, weekEnd) {
  const planned = new Set(state.plans.filter((p) => p.end > weekStart && p.start < weekEnd).map((p) => p.taskId));
  return state.tasks
    .filter((t) => !t.done)
    .map((t) => ({ t, planned: planned.has(t.id) }))
    .sort((a, b) => !!b.t.starred - !!a.t.starred || a.planned - b.planned || cmpDeadline(a.t, b.t) || b.t.createdAt - a.t.createdAt);
}

function nextPlanOf(taskId) {
  const t = now();
  let best = null;
  for (const p of state.plans) if (p.taskId === taskId && !p.done && p.end > t && (!best || p.start < best.start)) best = p;
  return best;
}

function planLabel(p) {
  if (p.allDay) {
    const first = ymd(new Date(p.start));
    const last = ymd(new Date(p.end - 1));
    const short = (day) => fmt(parseYmd(day), { weekday: 'short', day: 'numeric' });
    if (p.start <= now()) return `Jusqu’au ${short(last)}`;
    return first === last ? `${dayWord(first)} · journée` : `${short(first)} → ${short(last)}`;
  }
  if (p.start <= now()) return 'En ce moment';
  const d = new Date(p.start);
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
  const day = diff === 0 ? 'Aujourd’hui' : diff === 1 ? 'Demain' : fmt(d, { weekday: 'short', day: 'numeric' });
  return `${day} ${minLabel(d.getHours() * 60 + d.getMinutes())}`;
}

function viewPlan() {
  const ui = state.ui;
  const { anchor, week, shown } = planDays();
  const isDay = ui.planView === 'day';
  const today = ymd(new Date());
  const weekStart = +week[0];
  const weekEnd = +new Date(week[6].getFullYear(), week[6].getMonth(), week[6].getDate() + 1);
  const thisWeek = now() >= weekStart && now() < weekEnd;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const range = isDay
    ? `<b>${esc(cap(fmt(anchor, { weekday: 'long', day: 'numeric', month: 'short' })))}</b>${ymd(anchor) === today ? '<small>Aujourd’hui</small>' : '<small>Revenir à aujourd’hui</small>'}`
    : `<b>${fmt(week[0], { day: 'numeric', month: week[0].getMonth() === week[6].getMonth() ? undefined : 'short' })} – ${fmt(week[6], { day: 'numeric', month: 'short' })}</b>${thisWeek ? '<small>Cette semaine</small>' : '<small>Revenir à cette semaine</small>'}`;

  const heads = (isDay ? week : shown).map((d) => {
    const key = ymd(d);
    const n = plansOn(key).length + spansOn(key).length;
    return `<button type="button" class="cal-day${key === today ? ' today' : ''}${isDay && key === ymd(anchor) ? ' on' : ''}" data-action="plan-day" data-value="${key}">
      <small>${esc(fmt(d, { weekday: 'short' }).replace('.', ''))}</small><b>${d.getDate()}</b><i>${n ? '•'.repeat(Math.min(n, 3)) : ''}</i></button>`;
  }).join('');

  const cols = shown.map((d) => {
    const key = ymd(d);
    // Ce qui commence avant 6h est coupé à 6h ; ce qui finit avant 6h n'apparaît pas.
    const visible = (it) => ({ ...it, s0: it.s, s: Math.max(it.s, VIEW_START) });
    const evs = pack(eventsOn(d).map((ev) => visible({ ev, s: ev.start, e: Math.max(ev.end, ev.start + SNAP) })).filter((it) => it.e > it.s));
    const pls = pack(plansOn(key).map((p) => visible({ p, s: minOfDay(p.start, key), e: Math.max(minOfDay(p.end, key), minOfDay(p.start, key) + SNAP) })).filter((it) => it.e > it.s));
    return `<div class="cal-col${key === today ? ' today' : ''}" data-action="slot" data-day="${key}">
      ${evs.map((it) => `<div class="ev-block" data-action="open-event" data-id="${it.ev.id}" style="${boxStyle(it)};--c:${it.ev.color || EVENT_COLORS[0]}">
        <b>${esc(it.ev.title)}</b><span>${shortLabel(it.ev.start)}–${shortLabel(it.ev.end)}</span></div>`).join('')}
      ${pls.map((it) => {
        const t = getTask(it.p.taskId);
        const running = !!timerOf(t.id);
        return `<div class="plan-block${t.done || it.p.done ? ' done' : ''}${running ? ' running' : ''}" data-action="open-plan" data-id="${it.p.id}" style="${boxStyle(it)};--c:${colorOf(t.projectId)}">
          <b>${t.starred ? '★ ' : ''}${esc(t.title)}</b><span>${it.p.series ? '↻ ' : ''}${shortLabel(it.s0)}–${shortLabel(it.e)}</span>
          <i class="plan-resize" aria-hidden="true"></i></div>`;
      }).join('')}
      ${key === today && nowMin >= VIEW_START ? `<div class="now-line" style="top:${posPct(nowMin)}%"></div>` : ''}
    </div>`;
  }).join('');

  // Tâches sur plusieurs jours : une barre au-dessus des heures, sur tous leurs jours.
  const dayIdx = (t) => Math.round((startOfDay(new Date(t)) - shown[0]) / 864e5);
  const rowEnds = [];
  const bars = spansIn(+shown[0], dateAt(ymd(shown[shown.length - 1]), DAY_MIN))
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .map((p) => {
      const s = dayIdx(p.start);
      const e = dayIdx(p.end - 1);
      const a = Math.max(0, s);
      const b = Math.min(shown.length - 1, e);
      let row = rowEnds.findIndex((end) => end < a);
      if (row < 0) { row = rowEnds.length; rowEnds.push(b); } else rowEnds[row] = b;
      const t = getTask(p.taskId);
      return `<button type="button" class="span-bar${planDone(p) ? ' done' : ''}${s < a ? ' cut-l' : ''}${e > b ? ' cut-r' : ''}" data-action="open-plan" data-id="${p.id}" style="grid-column:${a + 1} / ${b + 2};grid-row:${row + 1};--c:${colorOf(t.projectId)}">${t.starred ? '★ ' : ''}${esc(t.title)}</button>`;
    }).join('');
  const lane = bars ? `<div class="cal-spans"><div class="cal-gutter"></div><div class="spans-grid" style="--n:${shown.length}">${bars}</div></div>` : '';

  const tray = trayTasks(weekStart, weekEnd);
  const placing = getTask(temp.placing);
  const zoom = ui[isDay ? 'zoomDay' : 'zoomWeek'];
  const slide = temp.slideFrom;
  temp.slideFrom = null;
  const dockOpen = !!ui.dockOpen; // téléphone : bandeau du bas agrandi

  // Catégories de la barre : ★ Favoris d'abord, puis Tout, puis chaque projet qui a des tâches à faire.
  const starredN = tray.filter((x) => x.t.starred).length;
  const cats = [];
  if (starredN) cats.push({ key: 'star', label: '★ Favoris', n: starredN });
  cats.push({ key: 'all', label: 'Tout', n: tray.length });
  for (const pr of state.projects) {
    const n = tray.filter((x) => x.t.projectId === pr.id).length;
    if (n) cats.push({ key: pr.id, label: pr.name, color: pr.color, n });
  }
  const noneN = tray.filter((x) => !getProject(x.t.projectId)).length;
  if (noneN) cats.push({ key: 'none', label: 'Sans projet', n: noneN });
  const cat = cats.some((c) => c.key === ui.sideCat) ? ui.sideCat : starredN ? 'star' : 'all';
  const projCat = cat !== 'star' && cat !== 'all' ? cats.find((c) => c.key === cat) : null;
  const inCat = ({ t }) => (cat === 'all' ? true : cat === 'star' ? t.starred : cat === 'none' ? !getProject(t.projectId) : t.projectId === cat);
  const list = tray.filter(inCat);

  const row = ({ t, planned }) => `<button type="button" class="side-row${planned ? ' planned' : ''}${temp.placing === t.id ? ' on' : ''}" data-action="pick-tray" data-drag-task="${t.id}" style="--c:${colorOf(t.projectId)}" title="${esc(t.title)} · ${esc(pathLabel(t.projectId, t.subprojectId))}">
      <i class="side-dot"></i><span class="side-row-title">${esc(t.title)}</span>
      ${t.starred && cat !== 'star' ? `<span class="side-star">${ICON.star}</span>` : ''}${planned ? '<em title="Déjà planifiée cette semaine">✓</em>' : ''}</button>`;

  // Téléphone (bandeau réduit) : une ligne de pastilles qui défile au doigt.
  const chip = ({ t, planned }) => `<button type="button" class="strip-task${planned ? ' planned' : ''}${temp.placing === t.id ? ' on' : ''}" data-action="pick-tray" data-drag-task="${t.id}" style="--c:${colorOf(t.projectId)}">
      ${t.starred && cat !== 'star' ? ICON.star : ''}<span>${esc(t.title)}</span>${planned ? '<em>✓</em>' : ''}</button>`;
  const curCat = cats.find((c) => c.key === cat);
  const strip = `<div class="side-strip">
      <button type="button" class="strip-cat${temp.catMenu ? ' open' : ''}" data-action="cat-menu" aria-haspopup="menu"${curCat.color ? ` style="--c:${curCat.color}"` : ''}>
        ${curCat.color ? '<i></i>' : ''}<span>${esc(curCat.label)}</span><small>${curCat.n}</small>${ICON.down}</button>
      ${list.map(chip).join('')}
    </div>
    ${temp.catMenu ? `<div class="cat-menu" role="menu">${cats.map((c) => `<button type="button" role="menuitemradio" aria-checked="${c.key === cat}" class="proj-opt${c.key === cat ? ' on' : ''}" data-action="side-cat" data-value="${c.key}" style="--c:${c.color || 'var(--accent)'}">
        ${c.color ? '<i></i>' : ''}<span>${esc(c.label)}</span><small>${c.n}</small></button>`).join('')}</div>` : ''}`;

  const side = `<aside class="side${dockOpen ? ' open' : ''}" aria-label="Tâches à planifier">
      <button type="button" class="dock-grab" data-action="dock-toggle" aria-label="${dockOpen ? 'Réduire la liste' : 'Agrandir la liste'}"><span></span></button>
      <div class="side-head"><b>À planifier</b><small>${tray.length}</small></div>
      ${tray.length ? `<div class="side-cats">
        ${cats.filter((c) => c.key === 'star' || c.key === 'all').map((c) => `<button type="button" class="side-cat${c.key === cat ? ' on' : ''}" data-action="side-cat" data-value="${c.key}">${esc(c.label)}<small>${c.n}</small></button>`).join('')}
        <div class="proj-pick">
          <button type="button" class="side-cat side-proj${projCat ? ' on' : ''}${temp.projMenu ? ' open' : ''}" data-action="proj-menu" aria-haspopup="menu" aria-expanded="${!!temp.projMenu}"${projCat?.color ? ` style="--c:${projCat.color}"` : ''}>
            ${projCat?.color ? '<i></i>' : ''}<span>${esc(projCat ? projCat.label : 'Projets')}</span>${projCat ? `<small>${projCat.n}</small>` : ''}${ICON.down}</button>
          ${temp.projMenu ? `<div class="proj-menu" role="menu">${cats.filter((c) => c.key !== 'star' && c.key !== 'all').map((c) => `<button type="button" role="menuitemradio" aria-checked="${c.key === cat}" class="proj-opt${c.key === cat ? ' on' : ''}" data-action="side-cat" data-value="${c.key}" style="--c:${c.color || NO_COLOR}">
            <i></i><span>${esc(c.label)}</span><small>${c.n}</small></button>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="side-list">${list.map(row).join('')}</div>
      <p class="side-hint">Glisse une tâche dans le planning, ou touche-la puis touche un créneau.</p>
      ${strip}`
        : '<p class="side-empty">Aucune tâche à faire. Ajoute-en dans l’onglet Tâches.</p>'}
    </aside>`;
  const floating = placing
    ? `<div class="place-bar"><span>Touche un créneau pour placer <b>« ${esc(placing.title)} »</b></span><button type="button" class="btn small" data-action="cancel-placing">Annuler</button></div>`
    : '';

  return `<div class="plan-bar">
      <div class="seg-mini" role="group" aria-label="Affichage">
        <button type="button" class="${isDay ? '' : 'on'}" data-action="plan-view" data-value="week">Semaine</button>
        <button type="button" class="${isDay ? 'on' : ''}" data-action="plan-view" data-value="day">Jour</button>
      </div>
      <div class="plan-nav">
        <button type="button" class="icon-btn" data-action="plan-move" data-value="-1" aria-label="Précédent">${ICON.left}</button>
        <button type="button" class="plan-range" data-action="plan-today">${range}</button>
        <button type="button" class="icon-btn" data-action="plan-move" data-value="1" aria-label="Suivant">${ICON.right}</button>
      </div>
    </div>
    ${state.events.length ? '<p class="ev-note">🔁 Les événements fixes (rayés) deviennent des tâches : touche-en un pour le transformer.</p>' : ''}
    <div class="plan-layout">
    <div class="cal${isDay ? ' is-day' : ''}${slide ? ` slide-from-${slide}` : ''}"${zoom ? ` style="--hour:${zoom}px"` : ''}>
      <div class="cal-head"><div class="cal-gutter"></div><div class="cal-days" style="--n:7">${heads}</div>${lane}</div>
      <div class="cal-body">
        <div class="cal-hours">${[...Array(17)].map((_, i) => `<span style="top:${posPct((i + 7) * 60)}%">${i + 7}h</span>`).join('')}</div>
        <div class="cal-cols" style="--n:${shown.length}">${cols}</div>
      </div>
    </div>
    ${side}
    </div>
    ${floating}
    <div class="drop-remove">${ICON.trash} Déposer ici pour retirer du planning</div>`;
}

// Fait défiler la grille vers le début de journée (ou l'heure actuelle cette semaine).
function scrollPlanToHour() {
  const col = $('.cal-col');
  if (!col) return;
  const r = col.getBoundingClientRect();
  const showsToday = !!$('.cal-col.today');
  const hour = showsToday ? Math.max(6, new Date().getHours() - 1) : 7;
  const head = $('.top').offsetHeight + $('.cal-head').offsetHeight;
  window.scrollTo(0, Math.max(0, window.scrollY + r.top + ((hour * 60 - VIEW_START) / VIEW_SPAN) * r.height - head - 6));
}

function createPlan(taskId, day, startMin, dur = PLAN_DUR) {
  const s = Math.max(0, Math.min(DAY_MIN - SNAP, startMin));
  const p = { id: uid(), taskId, start: dateAt(day, s), end: dateAt(day, Math.min(DAY_MIN, s + dur)) };
  state.plans.push(p);
  save(); render(); buzz();
  const d = parseYmd(day);
  toast(`Planifiée ${fmt(d, { weekday: 'short', day: 'numeric' })} · ${minLabel(s)}`, {
    label: 'Annuler', fn: () => { state.plans = state.plans.filter((x) => x.id !== p.id); save(); render(); },
  });
  return p;
}

/* ----- Quand : durée, plusieurs jours, répétition chaque semaine ----- */

const isoDay = (day) => String(((parseYmd(day).getDay() + 6) % 7) + 1); // « 1 » = lundi
const addDays = (day, n) => { const d = parseYmd(day); d.setDate(d.getDate() + n); return ymd(d); };
const dShort = (day) => fmt(parseYmd(day), { weekday: 'short', day: 'numeric', month: 'short' });
const DAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

// « 135 » → « lun., mer. et ven. »
function daysWord(days) {
  if (days === '1234567') return 'tous les jours';
  if (days === '12345') return 'du lundi au vendredi';
  const names = [...days].map((c) => DAY_SHORT[c - 1]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0] || '';
}

// Jours d'une série : les jours cochés, à partir de « day » et pendant N semaines.
function seriesDays(day, days, weeks) {
  const out = [];
  for (let i = 0; i < weeks * 7; i++) { const d = addDays(day, i); if (days.includes(isoDay(d))) out.push(d); }
  return out;
}

// Durée (ou « Plusieurs jours ») puis répétition : fiche d'un créneau et bloc « Planifier » d'une tâche.
function whenFields(day, durs, pick, { days = isoDay(day), weekly = false, auto = true } = {}) {
  return `<div class="when" data-day="${day}" data-auto="${auto ? 1 : 0}">
    <div class="field"><span>Durée</span><div class="dur-pick">${durs.map((x) => `<label><input type="radio" name="dur" value="${x}"${x === pick ? ' checked' : ''}><span>${fmtDur(x * 60e3)}</span></label>`).join('')}
      <label class="multi"><input type="radio" name="dur" value="days"><span>📅 Plusieurs jours (voyage…)</span></label></div></div>
    <label class="field when-days"><span>Jusqu’au (inclus)</span><input type="date" name="span_to" min="${day}" value="${addDays(day, 2)}"></label>
    <div class="field rep"><span>Répéter</span>
      <div class="seg2">
        <label><input type="radio" name="rep" value="once"${weekly ? '' : ' checked'}><span>Une seule fois</span></label>
        <label><input type="radio" name="rep" value="weekly"${weekly ? ' checked' : ''}><span>↻ Chaque semaine</span></label>
      </div>
      <div class="rep-detail">
        <div class="daypick">${'LMMJVSD'.split('').map((l, i) => `<label><input type="checkbox" name="rep_day" value="${i + 1}"${days.includes(String(i + 1)) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <div class="rep-weeks"><span>Pendant</span>
          <button type="button" class="step" data-action="rep-step" data-value="-1" aria-label="Une semaine de moins">−</button>
          <input type="number" name="rep_weeks" value="4" min="1" max="52" inputmode="numeric" aria-label="Nombre de semaines">
          <button type="button" class="step" data-action="rep-step" data-value="1" aria-label="Une semaine de plus">+</button>
          <span class="rep-unit">semaines</span></div>
      </div>
    </div>
    <p class="when-sum"></p>
  </div>`;
}

function whenValues(box, day) {
  const durV = box.querySelector('[name="dur"]:checked')?.value;
  const multi = durV === 'days';
  const weekly = !multi && box.querySelector('[name="rep"]:checked')?.value === 'weekly';
  const days = [...box.querySelectorAll('[name="rep_day"]:checked')].map((x) => x.value).join('');
  const weeks = Math.max(1, Math.min(52, Math.round(Number(box.querySelector('[name="rep_weeks"]').value) || 1)));
  const to = box.querySelector('[name="span_to"]').value;
  return {
    dur: Number(durV) || PLAN_DUR, multi, weekly, days, weeks, to: to && to >= day ? to : day,
    dates: weekly ? seriesDays(day, days, weeks) : [day],
  };
}

// Résumé sous les réglages (nombre de créneaux, dates), mis à jour à chaque changement.
function whenRefresh(box, day = box?.dataset.day) {
  if (!box || !day) return;
  box.dataset.day = day;
  if (box.dataset.auto === '1') for (const c of box.querySelectorAll('[name="rep_day"]')) c.checked = c.value === isoDay(day);
  const to = box.querySelector('[name="span_to"]');
  to.min = day;
  if (to.dataset.auto !== '0' || !to.value || to.value < day) to.value = addDays(day, 2); // 3 jours par défaut
  const w = whenValues(box, day);
  box.querySelector('.rep-unit').textContent = w.weeks > 1 ? 'semaines' : 'semaine';
  const sum = box.querySelector('.when-sum');
  const n = Math.round((parseYmd(w.to) - parseYmd(day)) / 864e5) + 1;
  sum.classList.toggle('warn', w.weekly && !w.dates.length);
  sum.textContent = w.multi
    ? (n > 1 ? `${n} jours · du ${dShort(day)} au ${dShort(w.to)}` : `Toute la journée · ${dShort(day)}`)
    : w.weekly
      ? (w.dates.length ? `↻ ${w.dates.length} créneau${w.dates.length > 1 ? 'x' : ''} · ${daysWord(w.days)} · jusqu’au ${dShort(w.dates[w.dates.length - 1])}` : 'Choisis au moins un jour')
      : '';
}

// Série sans aucun jour coché : on le signale (une fiche ouverte cache les messages du bas).
function whenInvalid(box, w) {
  if (!w.weekly || w.dates.length) return false;
  const sum = box.querySelector('.when-sum');
  sum.classList.remove('shake');
  void sum.offsetWidth;
  sum.classList.add('shake');
  return true;
}

// Crée les créneaux d'une tâche : un seul, un par jour coché pendant N semaines, ou plusieurs jours d'affilée.
function addPlans(taskId, day, min, w) {
  let made;
  if (w.multi) {
    made = [{ id: uid(), taskId, allDay: true, start: dateAt(day, 0), end: dateAt(w.to, DAY_MIN) }];
  } else {
    const s = Math.max(0, Math.min(DAY_MIN - SNAP, min));
    const series = w.weekly && w.dates.length > 1 ? uid() : '';
    made = w.dates.map((d) => ({ id: uid(), taskId, start: dateAt(d, s), end: dateAt(d, Math.min(DAY_MIN, s + w.dur)), ...(series ? { series } : {}) }));
  }
  state.plans.push(...made);
  return made;
}

const whenDone = (w, day, min, n) => (w.multi
  ? (w.to === day ? `Planifiée ${dShort(day)} · toute la journée` : `Planifiée du ${dShort(day)} au ${dShort(w.to)}`)
  : w.weekly ? `${n} créneau${n > 1 ? 'x planifiés' : ' planifié'} · ${daysWord(w.days)}`
    : `Planifiée ${fmt(parseYmd(day), { weekday: 'short', day: 'numeric' })} · ${minLabel(min)}`);

// Planifie puis propose « Annuler ».
function planWith(taskId, day, min, w) {
  const made = addPlans(taskId, day, min, w);
  save(); render(); buzz();
  const ids = new Set(made.map((p) => p.id));
  toast(whenDone(w, day, min, made.length), { label: 'Annuler', fn: () => { state.plans = state.plans.filter((p) => !ids.has(p.id)); save(); render(); } });
  return made;
}

// Un événement fixe devenu tâche disparaît du planning (« Annuler » remet tout comme avant).
function eventConverted(evId, t, made) {
  const ev = state.events.find((x) => x.id === evId);
  if (!ev) return;
  state.events = state.events.filter((x) => x !== ev);
  save(); render();
  const ids = new Set(made.map((p) => p.id));
  toast(`« ${t.title} » est maintenant une tâche`, {
    label: 'Annuler',
    fn: () => {
      state.tasks = state.tasks.filter((x) => x !== t);
      state.plans = state.plans.filter((p) => !ids.has(p.id));
      state.events.push(ev);
      save(); render();
    },
  });
}

// Jours ou date de fin choisis à la main : on ne les cale plus sur le jour du créneau.
// (sur « input », avant le rafraîchissement du bloc « Planifier » qui écoute aussi cet événement)
sheet.addEventListener('input', (e) => {
  const box = e.target.closest('.when');
  if (!box) return;
  if (e.target.name === 'rep_day') box.dataset.auto = '0';
  if (e.target.name === 'span_to') e.target.dataset.auto = '0';
  if (e.target.name === 'rep_weeks') whenRefresh(box);
});
sheet.addEventListener('change', (e) => { const box = e.target.closest('.when'); if (box) whenRefresh(box); });

// Créneau touché dans une colonne : minute de la journée (arrondie à la demi-heure).
function slotAt(col, y) {
  const r = col.getBoundingClientRect();
  const m = VIEW_START + ((y - r.top) / r.height) * VIEW_SPAN;
  return Math.max(VIEW_START, Math.min(DAY_MIN - 30, Math.floor(m / 30) * 30));
}

// « À planifier » : barre fixe à droite sur grand écran, bandeau en bas (réduit ou agrandi) sur téléphone.
const sideDocked = () => matchMedia('(min-width: 760px)').matches;
function closeSideOnPhone() {
  temp.catMenu = false;
  if (sideDocked() || !state.ui.dockOpen) return;
  state.ui.dockOpen = false;
  writeLocal();
  $('.side')?.classList.remove('open');
}

/* ----- Gestes sur la grille : balayer pour changer de semaine, pincer pour zoomer les heures ----- */

const HOUR_MIN = 24;   // hauteur d'une heure (px) : dézoom maximal…
const HOUR_MAX = 160;  // … et zoom maximal
const gest = { mode: null };
const zoomKey = () => (state.ui.planView === 'day' ? 'zoomDay' : 'zoomWeek');
const hourPx = () => parseFloat(getComputedStyle($('.cal')).getPropertyValue('--hour')) || 46;

// Semaine (ou jour) suivante / précédente. « from » : côté d'où arrive le nouveau contenu.
function changePeriod(step, from) {
  const d = parseYmd(state.ui.planDate || ymd(new Date()));
  const days = (state.ui.planView === 'day' ? 1 : 7) * step;
  state.ui.planDate = ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
  temp.slideFrom = from;
  writeLocal(); render(); buzz();
}

// Change la hauteur des heures en gardant sous les doigts (ou la souris) la même heure.
function setHour(px, focalY) {
  const cal = $('.cal');
  const col = $('.cal-col');
  if (!cal || !col) return;
  const r = col.getBoundingClientRect();
  const m = VIEW_START + ((focalY - r.top) / r.height) * VIEW_SPAN;
  const topPage = r.top + scrollY;
  const h = Math.max(HOUR_MIN, Math.min(HOUR_MAX, px));
  cal.style.setProperty('--hour', `${h}px`);
  state.ui[zoomKey()] = Math.round(h);
  window.scrollTo(0, topPage + ((m - VIEW_START) / VIEW_SPAN) * (18 * h) - focalY);
}

function swipeShift(dx) {
  for (const el of $$('.cal-cols, .cal-days, .spans-grid')) el.style.transform = dx ? `translateX(${dx}px)` : '';
  $('.cal')?.classList.toggle('swiping', !!dx);
}

document.addEventListener('touchstart', (e) => {
  if (state.ui.tab !== 'plan' || !profile || drag.active) return;
  const onCal = !!e.target.closest('.cal');
  if (e.touches.length === 2 && (onCal || gest.mode)) {
    const [a, b] = e.touches;
    cancelPending();
    swipeShift(0);
    Object.assign(gest, { mode: 'pinch', d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), h0: hourPx() });
    return;
  }
  if (e.touches.length === 1 && onCal) {
    Object.assign(gest, { mode: 'swipe', x0: e.touches[0].clientX, y0: e.touches[0].clientY, lock: null, dx: 0 });
  } else if (e.touches.length === 1) gest.mode = null;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!gest.mode || state.ui.tab !== 'plan') return;
  if (drag.active) { gest.mode = null; swipeShift(0); return; }
  if (gest.mode === 'pinch' && e.touches.length === 2) {
    e.preventDefault(); // la page ne zoome pas : seule la grille change
    const [a, b] = e.touches;
    setHour(gest.h0 * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / gest.d0), (a.clientY + b.clientY) / 2);
    return;
  }
  if (gest.mode === 'swipe' && e.touches.length === 1) {
    const dx = e.touches[0].clientX - gest.x0;
    const dy = e.touches[0].clientY - gest.y0;
    if (!gest.lock) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) gest.lock = 'x';
      else if (Math.abs(dy) > 12) { gest.mode = null; return; } // défilement vertical normal
    }
    if (gest.lock === 'x') {
      e.preventDefault();
      cancelPending();
      gest.dx = dx;
      swipeShift(dx * 0.45);
    }
  }
}, { passive: false });

document.addEventListener('touchend', (e) => {
  if (gest.mode === 'pinch') {
    if (e.touches.length < 2) { gest.mode = null; writeLocal(); }
    return;
  }
  if (gest.mode === 'swipe' && gest.lock === 'x') {
    const { dx } = gest;
    gest.mode = null;
    swipeShift(0);
    // Sens habituel (comme Calendrier sur iPhone) : vers la gauche → semaine suivante ; vers la droite → précédente.
    if (Math.abs(dx) > 60) changePeriod(dx < 0 ? 1 : -1, dx < 0 ? 'right' : 'left');
    return;
  }
  gest.mode = null;
}, { passive: true });
document.addEventListener('touchcancel', () => { gest.mode = null; swipeShift(0); });

// iPhone : bloque le zoom de toute la page quand on pince le planning.
for (const ev of ['gesturestart', 'gesturechange']) {
  document.addEventListener(ev, (e) => { if (state.ui.tab === 'plan' && profile) e.preventDefault(); }, { passive: false });
}

// Ordinateur : pincer sur le pavé tactile (ou Ctrl + molette) zoome la grille ;
// glisser à deux doigts sur le côté change de semaine.
document.addEventListener('wheel', (e) => {
  if (state.ui.tab !== 'plan' || !profile || !e.target.closest('.cal')) return;
  if (e.ctrlKey) {
    e.preventDefault();
    setHour(hourPx() * Math.exp(-e.deltaY * 0.01), e.clientY);
    clearTimeout(gest.wsave);
    gest.wsave = setTimeout(writeLocal, 300);
    return;
  }
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
    e.preventDefault();
    gest.wx = (gest.wx || 0) + e.deltaX;
    clearTimeout(gest.wreset);
    gest.wreset = setTimeout(() => { gest.wx = 0; }, 250);
    if (Math.abs(gest.wx) > 120 && !(gest.wcool > Date.now())) {
      changePeriod(gest.wx > 0 ? 1 : -1, gest.wx > 0 ? 'right' : 'left');
      gest.wx = 0;
      gest.wcool = Date.now() + 700;
    }
  }
}, { passive: false });

// Poignée du bandeau : glisser vers le haut pour l'agrandir, vers le bas pour le réduire.
document.addEventListener('pointerdown', (e) => { if (e.target.closest('.dock-grab')) temp.grabY = e.clientY; });
window.addEventListener('pointerup', (e) => {
  if (temp.grabY == null) return;
  const dy = e.clientY - temp.grabY;
  temp.grabY = null;
  if (Math.abs(dy) < 25) return; // simple toucher : géré par le clic
  state.ui.dockOpen = dy < 0;
  temp.skipGrabClick = true;
  setTimeout(() => { temp.skipGrabClick = false; }, 350);
  writeLocal(); render();
});
// Bas de la zone où l'on peut déposer (au-dessus de la barre d'onglets ou de la zone « retirer »).
function gridBottom() {
  const rm = $('.drop-remove');
  const r = rm && getComputedStyle(rm).display !== 'none' ? rm.getBoundingClientRect() : $('.tabbar').getBoundingClientRect();
  return r.top;
}

/* ----- Glisser-déposer (souris : tout de suite ; tactile : appui long puis glisser) ----- */

const drag = { pending: null, active: null, raf: 0 };

document.addEventListener('pointerdown', (e) => {
  if (state.ui.tab !== 'plan' || !profile || drag.active) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const chip = e.target.closest('[data-drag-task]');
  const block = e.target.closest('.plan-block');
  // Plage vide (ou événement fixe) : glisser pour dessiner un créneau
  const col = !chip && !block && !temp.placing ? e.target.closest('.cal-col') : null;
  if (!chip && !block && !col) return;
  const kind = chip ? 'new' : block ? (e.target.closest('.plan-resize') ? 'resize' : 'move') : 'range';
  drag.pending = { kind, el: chip || block || col, id: chip ? chip.dataset.dragTask : block?.dataset.id, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  if (e.pointerType !== 'mouse') drag.pending.timer = setTimeout(beginDrag, kind === 'range' ? 350 : 260); // appui long
  else e.preventDefault(); // pas de sélection de texte à la souris
});

window.addEventListener('pointermove', (e) => {
  if (drag.active) { moveDrag(e.clientX, e.clientY); return; }
  const p = drag.pending;
  if (!p) return;
  Object.assign(p, { x: e.clientX, y: e.clientY });
  const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
  if (p.type === 'mouse' && (p.kind === 'range' ? Math.abs(e.clientY - p.y0) > 10 : dist > 5)) beginDrag();
  else if (p.type !== 'mouse' && dist > 10) cancelPending(); // il fait défiler la page
});

window.addEventListener('pointerup', () => { if (drag.active) endDrag(true); else cancelPending(); });
window.addEventListener('pointercancel', () => { if (drag.active) endDrag(false); else cancelPending(); });
// Pendant un glisser au doigt, la page ne doit pas défiler.
document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (drag.active || drag.pending || e.target.closest('.cal, .side')) e.preventDefault(); });

function cancelPending() {
  if (drag.pending) clearTimeout(drag.pending.timer);
  drag.pending = null;
}

function beginDrag() {
  const p = drag.pending;
  if (!p) return;
  clearTimeout(p.timer);
  drag.pending = null;
  const a = { ...p, dur: PLAN_DUR, grab: 0 };
  if (p.kind === 'range') {
    const r = p.el.getBoundingClientRect();
    const at = VIEW_START + ((p.y0 - r.top) / r.height) * VIEW_SPAN;
    Object.assign(a, { col: p.el, day: p.el.dataset.day, color: 'var(--accent)' });
    a.anchor = Math.max(VIEW_START, Math.min(DAY_MIN - SNAP, Math.floor(at / SNAP) * SNAP));
    document.body.classList.add('ranging');
  } else if (p.kind === 'new') {
    const t = getTask(p.id);
    if (!t) return;
    a.color = colorOf(t.projectId);
    a.ghost = Object.assign(document.createElement('div'), { className: 'drag-ghost', textContent: t.title });
    a.ghost.style.setProperty('--c', a.color);
    document.body.appendChild(a.ghost);
    temp.placing = null;
    closeSideOnPhone(); // le volet s'efface pour laisser toute la grille
  } else {
    const plan = state.plans.find((x) => x.id === p.id);
    const col = p.el.closest('.cal-col');
    if (!plan || !col) return;
    const day = col.dataset.day;
    a.plan = plan;
    a.day = day;
    a.startMin = minOfDay(plan.start, day);
    a.dur = Math.max(SNAP, minOfDay(plan.end, day) - a.startMin);
    a.color = colorOf(getTask(plan.taskId)?.projectId);
    const r = col.getBoundingClientRect();
    a.grab = VIEW_START + ((p.y0 - r.top) / r.height) * VIEW_SPAN - a.startMin;
    p.el.classList.add('dragging');
    if (p.kind === 'move') document.body.classList.add('drag-move');
  }
  drag.active = a;
  document.body.classList.add('is-dragging');
  buzz();
  moveDrag(a.x, a.y);
  drag.raf = requestAnimationFrame(autoScroll);
}

function dropTarget(x, y) {
  const a = drag.active;
  if (a.kind === 'range') { // créneau dessiné : de l'appui jusqu'au doigt, dans la même colonne
    const r = a.col.getBoundingClientRect();
    const c = Math.max(VIEW_START, Math.min(DAY_MIN, Math.round((VIEW_START + ((y - r.top) / r.height) * VIEW_SPAN) / SNAP) * SNAP));
    const [start, end] = c >= a.anchor + SNAP ? [a.anchor, c] : c <= a.anchor ? [c, a.anchor + SNAP] : [a.anchor, a.anchor + SNAP];
    return { col: a.col, day: a.day, start, end };
  }
  const inside = (el) => { const r = el?.getBoundingClientRect(); return r && r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  // Bloc déposé sur la zone « retirer » (ou sur la barre latérale fixe) : on le retire du planning.
  // (sur téléphone, le volet s'efface pendant le glisser : on n'en tient pas compte)
  const overSide = sideDocked() && inside($('.side'));
  if (a.kind === 'move' && (inside($('.drop-remove')) || overSide)) return { tray: true };
  if (overSide || y >= gridBottom()) return null;
  const headBottom = $('.cal-head')?.getBoundingClientRect().bottom ?? 0;
  if (y < headBottom) return null;
  for (const col of $$('.cal-col')) {
    const r = col.getBoundingClientRect();
    if (x < r.left - 1 || x > r.right + 1) continue;
    const at = VIEW_START + ((y - r.top) / r.height) * VIEW_SPAN;
    if (a.kind === 'resize') {
      if (col.dataset.day !== a.day) return null;
      const end = Math.max(a.startMin + SNAP, Math.min(DAY_MIN, Math.round(at / SNAP) * SNAP));
      return { col, day: a.day, start: a.startMin, end };
    }
    const start = Math.max(VIEW_START, Math.min(DAY_MIN - a.dur, Math.round((at - a.grab) / SNAP) * SNAP));
    return { col, day: col.dataset.day, start, end: start + a.dur };
  }
  return null;
}

function moveDrag(x, y) {
  const a = drag.active;
  Object.assign(a, { x, y });
  if (a.ghost) a.ghost.style.transform = `translate(${x}px, ${y}px)`;
  const target = dropTarget(x, y);
  a.target = target;
  document.body.classList.toggle('drop-hover', !!target?.tray && a.kind === 'move');
  let pv = $('.plan-preview');
  if (!target?.col) { pv?.remove(); return; }
  if (!pv || pv.parentElement !== target.col) {
    pv?.remove();
    pv = Object.assign(document.createElement('div'), { className: 'plan-preview' });
    target.col.appendChild(pv);
  }
  pv.style.setProperty('--c', a.color);
  pv.classList.toggle('range', a.kind === 'range');
  pv.style.top = `${posPct(target.start)}%`;
  pv.style.height = `${((target.end - target.start) / VIEW_SPAN) * 100}%`;
  pv.textContent = a.kind === 'range'
    ? `${minLabel(target.start)} – ${minLabel(target.end)} · ${fmtDur((target.end - target.start) * 60e3)}`
    : `${minLabel(target.start)}–${minLabel(target.end)}`;
}

// Près du haut ou du bas de l'écran, la grille défile toute seule.
function autoScroll() {
  const a = drag.active;
  if (!a) return;
  const tray = gridBottom();
  const head = $('.cal-head')?.getBoundingClientRect().bottom ?? 0;
  let dy = 0;
  if (a.y < head + 50 && a.y > head - 80) dy = -Math.ceil((head + 50 - a.y) / 6);
  else if (a.y > tray - 50 && a.y < tray + 10) dy = Math.ceil((a.y - (tray - 50)) / 6);
  if (dy) { window.scrollBy(0, dy); moveDrag(a.x, a.y); }
  drag.raf = requestAnimationFrame(autoScroll);
}

function endDrag(drop) {
  const a = drag.active;
  drag.active = null;
  cancelAnimationFrame(drag.raf);
  a.ghost?.remove();
  if (a.kind !== 'range') $('.plan-preview')?.remove();
  document.body.classList.remove('is-dragging', 'drag-move', 'drop-hover', 'ranging');
  temp.suppressClick = true; // le relâchement ne doit pas compter comme un « toucher »
  setTimeout(() => { temp.suppressClick = false; }, 350);
  const tg = drop ? a.target : null;
  if (a.kind === 'range') { // le créneau dessiné reste affiché pendant que la fiche est ouverte
    if (tg?.col) { buzz(); openSlotSheet(tg.day, tg.start, undefined, tg.end - tg.start); } else $('.plan-preview')?.remove();
    return;
  }
  if (a.kind === 'new' && tg?.col) { createPlan(a.id, tg.day, tg.start, a.dur); return; }
  if (a.kind === 'move' && tg?.tray) {
    const old = { ...a.plan };
    state.plans = state.plans.filter((x) => x.id !== a.plan.id);
    save(); render();
    toast('Retirée du planning', { label: 'Annuler', fn: () => { state.plans.push(old); save(); render(); } });
    return;
  }
  if ((a.kind === 'move' || a.kind === 'resize') && tg?.col) {
    Object.assign(a.plan, { start: dateAt(tg.day, tg.start), end: dateAt(tg.day, tg.end) });
    save(); buzz();
  }
  render();
}

/* ----- Fiches : créneau planifié, créneau vide, événement fixe ----- */

function openPlanSheet(id) {
  const p = state.plans.find((x) => x.id === id);
  const t = getTask(p?.taskId);
  if (!p || !t) return;
  const day = ymd(new Date(p.start));
  const running = !!timerOf(t.id);
  const series = p.series ? state.plans.filter((x) => x.series === p.series).sort((a, b) => a.start - b.start) : [];
  const after = series.filter((x) => x.start > p.start);
  const fields = p.allDay
    ? `<div class="row2">
        <label class="field"><span>Du</span><input type="date" name="date" value="${day}" required></label>
        <label class="field"><span>Au (inclus)</span><input type="date" name="to" value="${ymd(new Date(p.end - 1))}" min="${day}" required></label>
      </div>`
    : `<label class="field"><span>Jour</span><input type="date" name="date" value="${day}" required></label>
      <div class="row2">
        <label class="field"><span>Début</span><input type="time" name="start" value="${hhmm(minOfDay(p.start, day))}" step="300" required></label>
        <label class="field"><span>Fin</span><input type="time" name="end" value="${hhmm(minOfDay(p.end, day) % DAY_MIN)}" step="300" required></label>
      </div>`;
  const weekdays = [...new Set(series.map((x) => isoDay(ymd(new Date(x.start)))))].sort().join('');
  const rep = series.length > 1 ? `<div class="series-box">
      <span>↻ ${esc(cap(daysWord(weekdays)))} · ${series.length} créneaux, jusqu’au ${esc(dShort(ymd(new Date(series[series.length - 1].start))))}</span>
      ${after.length ? `<button type="button" class="btn small" data-action="series-apply" data-id="${id}">Mettre cet horaire aux ${after.length} suivants</button>` : ''}
    </div>` : '';
  openSheet(`<form class="sheet-body" data-form="plan" data-id="${id}">
    ${head(p.allDay ? 'Sur plusieurs jours' : series.length > 1 ? 'Créneau régulier' : 'Créneau planifié')}
    <button type="button" class="plan-task" data-action="open-task" data-id="${t.id}" style="--c:${colorOf(t.projectId)}">
      <span class="dot"></span><span class="plan-task-name">${t.starred ? '★ ' : ''}${esc(t.title)}<small>${esc(pathLabel(t.projectId, t.subprojectId))}</small></span>${ICON.right}
    </button>
    ${fields}
    ${rep}
    <div class="sheet-actions">
      ${t.done ? '' : `<button type="button" class="btn ${running ? 'stop' : 'primary'} grow" data-action="toggle-timer" data-id="${t.id}">${running ? `${ICON.stop} Arrêter` : `${ICON.play} Lancer le chrono`}</button>`}
      <button type="button" class="btn grow" data-action="toggle-done" data-id="${t.id}">${t.done ? 'Rouvrir' : `${ICON.check} Terminée`}</button>
    </div>
    <button type="button" class="btn ghost danger wide" data-action="delete-plan" data-id="${id}">${ICON.trash} ${after.length ? 'Retirer ce créneau' : 'Retirer du planning'}</button>
    ${after.length ? `<button type="button" class="btn ghost danger wide" data-action="delete-series" data-id="${id}">${ICON.trash} Retirer celui-ci et les ${after.length} suivants</button>` : ''}
  </form>`);
}

function commitPlanForm(form) {
  const p = state.plans.find((x) => x.id === form.dataset.id);
  const day = form.elements.date.value;
  if (!p || !day) return;
  if (p.allDay) { // du … au … (inclus)
    let to = form.elements.to.value;
    if (!to || to < day) { to = day; form.elements.to.value = day; }
    form.elements.to.min = day;
    Object.assign(p, { start: dateAt(day, 0), end: dateAt(to, DAY_MIN) });
    save(); render();
    return;
  }
  const s = toMin(form.elements.start.value);
  let e = toMin(form.elements.end.value);
  if (e <= s) e = e === 0 ? DAY_MIN : Math.min(DAY_MIN, s + PLAN_DUR); // fin avant le début : on corrige
  Object.assign(p, { start: dateAt(day, s), end: dateAt(day, e) });
  form.elements.end.value = hhmm(e % DAY_MIN);
  save(); render();
}

// Fiche d'un créneau vide : créer une tâche à cette heure, ou y placer une tâche existante.
// maxDur : place disponible (créneau libre de « Aujourd'hui »), pour proposer la bonne durée.
// dur : durée dessinée dans la grille (proposée et choisie d'office).
// conv : événement fixe à transformer en tâche (nom, jours et horaire repris).
function openSlotSheet(day, min, maxDur = DAY_MIN - min, dur = 0, conv = null) {
  const d = parseYmd(day);
  const tasks = conv ? [] : trayTasks(0, 0);
  const def = newTaskDefaults();
  let durs = [30, 60, 90, 120].filter((x) => x <= Math.max(30, maxDur));
  if (dur && !durs.includes(dur)) durs = [...durs, dur].sort((a, b) => a - b);
  const pick = dur || (durs.includes(PLAN_DUR) ? PLAN_DUR : durs[durs.length - 1]);
  openSheet(`<div class="sheet-body">
    ${head(conv ? 'Transformer en tâche' : `${cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'short' }))} · ${minLabel(min)}${dur ? ` → ${minLabel(min + dur)}` : ''}`)}
    ${conv ? `<p class="hint" style="margin-top:0">« ${esc(conv.title)} » (${minLabel(min)} → ${minLabel(min + dur)}) devient une tâche : tu pourras la chronométrer et la valider dans « Ma journée ».</p>` : ''}
    <form class="slot-new" data-form="task" data-slot-day="${day}" data-slot-min="${min}"${conv ? ` data-event="${conv.id}"` : ''} autocomplete="off">
      <label class="field"><span>${conv ? 'Tâche' : `Nouvelle tâche à ${minLabel(min)}`}</span>${emojiField(`<input class="big" name="title" value="${esc(conv?.title || '')}" placeholder="Ex. Appeler le garage" maxlength="200" required enterkeyhint="done"${!conv && matchMedia('(pointer: fine)').matches ? ' autofocus' : ''}>`)}</label>
      ${pickFields(def.projectId, def.subprojectId)}
      ${whenFields(day, durs, pick, conv ? { days: conv.days, weekly: conv.weekly, auto: false } : {})}
      <button class="btn primary wide">${conv ? '🔁 Transformer en tâche' : `${ICON.plus} Créer et planifier`}</button>
    </form>
    ${tasks.length ? `<p class="hint slot-or">Ou placer une tâche existante :</p>
      <div class="card pick-list">${tasks.map(({ t }) => `<button type="button" class="pick" data-action="plan-here" data-id="${t.id}" data-day="${day}" data-min="${min}" style="--c:${colorOf(t.projectId)}">
        <span class="dot"></span><span class="pick-title">${t.starred ? '★ ' : ''}${esc(t.title)}<small>${esc(pathLabel(t.projectId, t.subprojectId))}</small></span>${ICON.plus}</button>`).join('')}</div>`
      : ''}
    ${conv ? `<button type="button" class="btn ghost danger wide" style="margin-top:12px" data-action="delete-event" data-id="${conv.id}">${ICON.trash} Supprimer l’événement</button>` : ''}
  </div>`);
  whenRefresh($('#sheet .when'));
  suggestInit($('#sheet .slot-new'));
}

// Les événements fixes deviennent des tâches : on reprend leur nom, leurs jours et leur horaire.
function openEventSheet(id) {
  const ev = state.events.find((x) => x.id === id);
  if (!ev) return;
  const today = ymd(new Date());
  const day = ev.date || (ev.end > nowMin() ? today : addDays(today, 1));
  const dur = Math.max(SNAP, Math.min(ev.end, DAY_MIN) - ev.start);
  openSlotSheet(day, ev.start, DAY_MIN - ev.start, dur, { id: ev.id, title: ev.title, days: ev.date ? isoDay(day) : String(ev.days || isoDay(day)), weekly: !ev.date });
}

sheet.addEventListener('change', (e) => {
  const form = e.target.closest('form[data-form="plan"]');
  if (form) commitPlanForm(form);
});

// Toucher un créneau, un bloc ou un événement pendant qu'une tâche est « en main » : on la place là.
function placeHere(el, e) {
  const col = el.closest('.cal-col');
  if (!temp.placing || !col) return false;
  const id = temp.placing;
  temp.placing = null;
  document.body.classList.remove('placing');
  createPlan(id, col.dataset.day, slotAt(col, e.clientY));
  return true;
}

// Avant le reste : un relâchement de glisser-déposer ne doit pas déclencher d'action.
document.addEventListener('click', (e) => {
  if (temp.suppressClick && e.target.closest('.cal, .side, .day-card')) { e.preventDefault(); e.stopPropagation(); }
}, true);
// Un nouveau toucher n'est jamais ignoré.
document.addEventListener('pointerdown', () => { temp.suppressClick = false; }, true);

setInterval(() => {
  const line = $('.now-line');
  if (line && !drag.active) line.style.top = `${posPct(new Date().getHours() * 60 + new Date().getMinutes())}%`;
}, 60e3);

new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${$('.top').offsetHeight}px`)).observe($('.top'));

/* ---------- Emojis dans les noms (tâches, projets, sous-projets, événements) ---------- */

// [catégorie, icône, « emoji mots-clés | emoji mots-clés … »] : la recherche se fait en français.
const EMOJIS = [
  ['Travail', '💼', '💼 travail pro bureau boulot|📚 cours livre école lecture|📝 copie note corriger écrire|✏️ crayon écrire dessin|🧑‍🏫 prof classe élève enseigner|🎓 diplôme agreg examen concours|🏫 lycée école collège|📊 stats tableau graphique|📈 progrès hausse|🗂️ classer dossier archive|📎 pièce jointe trombone|💻 ordinateur code appli site|📧 mail email|📞 appel téléphone appeler|🎤 oral micro discours|📻 radio émission|🖨️ imprimer impression|📋 liste checklist|🔍 chercher recherche|💡 idée|🧪 science expérience|🌐 site web internet'],
  ['Maison', '🏠', '🏠 maison logement|🧹 ménage balai nettoyer|🧺 linge lessive|🍳 cuisine repas cuisiner|🛒 courses supermarché|🔧 réparer bricolage outil|🪴 plante jardin|🛏️ lit chambre dormir|🚿 douche salle de bain|🗑️ poubelle déchets|📦 colis carton déménagement|🔑 clé|🐶 chien|🐱 chat|🚗 voiture garage|🧸 enfant jouet'],
  ['Famille', '❤️', '❤️ amour couple cœur|👨‍👩‍👧 famille|👶 bébé enfant|🎂 anniversaire gâteau|🎁 cadeau|💬 message discuter|🤝 rendez-vous réunion|👫 amis|💍 mariage|🥂 fête apéro soirée|📸 photo|✉️ lettre courrier|🏖️ vacances plage|✈️ voyage avion|🚆 train|🗺️ carte voyage'],
  ['Sport', '🏃', '🏃 course running trail|🚴 vélo|🏊 natation piscine|🏋️ muscu salle sport|🧘 yoga méditation|⚽ foot|🎾 tennis|🥾 rando randonnée montagne|💪 force motivation|🍎 manger sain fruit|💊 médicament santé|🩺 médecin docteur|🦷 dentiste|😴 sommeil repos|💧 eau boire|🧠 cerveau mental'],
  ['Argent', '💶', '💶 argent euro|💳 carte paiement|🏦 banque|🧾 facture ticket|📑 papiers documents administratif|🖋️ signer signature contrat|🏛️ impôts administration|📬 courrier boîte|🛡️ assurance|💰 épargne économies|🔒 sécurité mot de passe|🪪 identité carte|⚖️ juridique droit|🧮 calcul compta comptes'],
  ['Loisirs', '🎉', '🎉 fête|🎮 jeu vidéo|🎨 peinture art dessin|🎵 musique chanson|🎸 guitare|📖 lire roman|🎬 film cinéma série|📺 télé|🎭 théâtre|🧩 puzzle|🍿 popcorn|🍕 pizza resto|☕ café pause|🍷 vin|🧑‍🍳 cuisiner recette batch|🌍 monde'],
  ['Symboles', '✅', '✅ fait validé|⭐ étoile|🔥 urgent feu|⚠️ attention|❗ important|❓ question|🚀 lancer projet|🎯 objectif but|⏳ attente|⏰ deadline réveil|📌 épingle|🔁 répéter|🔴 rouge|🟠 orange|🟢 vert|🔵 bleu|🟣 violet|💤 plus tard|🏆 victoire|✨ nouveau'],
].map(([label, icon, list]) => ({ label, icon, items: list.split('|').map((x) => { const [e, ...k] = x.split(' '); return { e, k: k.join(' ') }; }) }));
const EMOJI_RECENT = 'chronotodo:emoji';
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function recentEmojis() {
  try { return JSON.parse(localStorage.getItem(EMOJI_RECENT)) || []; } catch (e) { return []; }
}

// Champ de nom avec un bouton 🙂 qui ouvre le sélecteur juste en dessous.
function emojiField(inputHtml) {
  return `<div class="emoji-field">${inputHtml}<button type="button" class="emoji-btn" data-action="emoji" aria-label="Ajouter un emoji" title="Ajouter un emoji">${ICON.smile}</button></div>`;
}

function toggleEmojiPanel(field) {
  const anchor = field.closest('label.field, .sub-row') || field;
  const open = anchor.nextElementSibling?.classList.contains('emoji-panel');
  $$('.emoji-panel').forEach((x) => x.remove());
  if (open) return;
  const input = $('input', field);
  input.id ||= `in-${uid()}`;
  const panel = document.createElement('div');
  panel.className = 'emoji-panel';
  panel.dataset.for = input.id;
  const recent = recentEmojis();
  panel.innerHTML = `<div class="emoji-top">
      <input class="emoji-search" type="search" placeholder="Chercher : sport, école, banque…" autocomplete="off" enterkeyhint="search" aria-label="Chercher un emoji">
      <button type="button" class="icon-btn" data-action="emoji-close" aria-label="Fermer">${ICON.close}</button>
    </div>
    <div class="emoji-tabs">${recent.length ? '<button type="button" data-action="emoji-tab" data-value="recent" title="Récents">🕘</button>' : ''}${EMOJIS.map((c, i) => `<button type="button" data-action="emoji-tab" data-value="${i}" title="${c.label}">${c.icon}</button>`).join('')}</div>
    <div class="emoji-grid"></div>`;
  anchor.insertAdjacentElement('afterend', panel);
  fillEmojiPanel(panel, recent.length ? 'recent' : '0');
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function fillEmojiPanel(panel, tab, query = '') {
  let items;
  if (query) {
    const q = fold(query.trim());
    items = EMOJIS.flatMap((c) => c.items).filter((x) => fold(x.k).includes(q) || x.e === query.trim());
  } else if (tab === 'recent') {
    items = recentEmojis().map((e) => ({ e, k: '' }));
  } else {
    items = EMOJIS[Number(tab)]?.items || [];
  }
  $$('.emoji-tabs button', panel).forEach((b) => b.classList.toggle('on', !query && b.dataset.value === String(tab)));
  $('.emoji-grid', panel).innerHTML = items.length
    ? items.map((x) => `<button type="button" data-action="emoji-pick" data-e="${x.e}" title="${esc(x.k)}">${x.e}</button>`).join('')
    : '<p class="emoji-none">Aucun emoji pour cette recherche.</p>';
}

// Insère l'emoji là où était le curseur (au début du nom si le champ n'a pas encore été touché).
function pickEmoji(btn) {
  const panel = btn.closest('.emoji-panel');
  const input = document.getElementById(panel.dataset.for);
  const e = btn.dataset.e;
  if (!input) return;
  const v = input.value;
  const caret = input.dataset.caret;
  let pos;
  if (caret == null) {
    input.value = v ? `${e} ${v.replace(/^\s+/, '')}` : `${e} `;
    pos = e.length + 1;
  } else {
    const at = Math.min(Number(caret), v.length);
    const before = v.slice(0, at);
    const ins = (before && !/\s$/.test(before) ? ' ' : '') + e + (v.slice(at).startsWith(' ') ? '' : ' ');
    input.value = before + ins + v.slice(at);
    pos = at + ins.length;
  }
  input.dataset.caret = pos;
  try { localStorage.setItem(EMOJI_RECENT, JSON.stringify([e, ...recentEmojis().filter((x) => x !== e)].slice(0, 18))); } catch (err) { /* plein */ }
  panel.remove();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true })); // enregistre aussitôt dans une fiche déjà créée
  if (matchMedia('(pointer: fine)').matches) { input.focus(); input.setSelectionRange(pos, pos); }
}

document.addEventListener('focusout', (e) => {
  if (e.target.matches?.('.emoji-field input')) e.target.dataset.caret = e.target.selectionStart ?? e.target.value.length;
});
document.addEventListener('input', (e) => {
  if (e.target.matches?.('.emoji-search')) fillEmojiPanel(e.target.closest('.emoji-panel'), '', e.target.value);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('.emoji-search')) {
    e.preventDefault(); // ne pas valider le formulaire
    $('.emoji-grid button', e.target.closest('.emoji-panel'))?.click();
  }
  if (e.key === 'Escape' && (temp.projMenu || temp.catMenu)) { Object.assign(temp, { projMenu: false, catMenu: false }); render(); }
});

/* ---------- Suggestions à la création d'une tâche : titres déjà utilisés, projet et sous-projet probables ---------- */
// Tout se calcule sur l'appareil, à partir des tâches et du journal : rien n'est envoyé ni enregistré en plus.
// 1) L'historique passe d'abord : tâches et sessions passées dont le nom ressemble à celui qu'on tape.
// 2) Puis le bon sens : un lexique relie des mots (footing, copies, impôts…) à des notions (course à pied,
//    correction, administratif…), elles-mêmes reconnues dans les NOMS des projets et sous-projets de la personne.

// Mots sans intérêt pour deviner un projet.
const STOP_WORDS = new Set(('a au aux avec c ce ces cet cette chez d dans de des du elle elles en et eux il ils j je l la le les leur leurs '
  + 'lui m ma mais me mes moi mon n ne nos notre nous on ou par pas pour qu que qui s sa se ses son sur ta te tes toi ton tu un une vos '
  + 'votre vous y ca cela ceci plus tres bien faire fait refaire etre avoir aller va vais puis alors donc car si ni tout tous toute toutes '
  + 'autre autres meme chaque entre vers sans sous apres avant pendant depuis jusqu ici encore deja aussi comme quand truc trucs chose '
  + 'choses etc via').split(' '));
// Mots qui finissent par s ou x au singulier : on ne leur retire pas ce « pluriel » (cours ≠ course).
const KEEP_S = new Set(('cours temps fois mois prix choix repas corps bras bus dos pas avis colis tapis jus frais souris gaz permis paris '
  + 'progres proces acces succes stress fitness tennis travaux').split(' '));
// Familles de mots (sans accents ni pluriel) ramenées à un seul mot.
const SAME_WORD = Object.fromEntries(Object.entries({
  mail: 'email mel courriel gmail outlook',
  correc: 'corriger corrige corrigee correction corr',
  prepar: 'prepa prepare preparer preparee preparation prep',
  appel: 'appeler rappeler rappel tel telephone telephoner phoner call',
  rdv: 'rendez',
  evalua: 'eval evaluer evaluation',
  revis: 'reviser revision revoir',
  achat: 'acheter achete',
  ranger: 'rangement range',
  paieme: 'payer paiement paye regler reglement',
  banque: 'bancaire',
  impot: 'fiscal fiscale taxe',
  medeci: 'docteur medecin',
  annive: 'anniv anniversaire',
  velo: 'bike',
  footin: 'footing jogging running run',
  muscu: 'musculation',
  philo: 'philosophie',
  geo: 'geographie',
  math: 'maths mathematique',
  termin: 'tle term terminale',
  '2nde': '2de seconde',
  '1re': '1ere premiere',
  '6e': '6eme sixieme',
  '5e': '5eme cinquieme',
  '4e': '4eme quatrieme',
  '3e': '3eme troisieme',
  diapo: 'diaporama',
  classm: 'classer classement',
}).flatMap(([k, list]) => list.split(' ').map((w) => [w, k])));

// Texte comparable : minuscules, sans accents, emojis ni ponctuation.
const plain = (s) => fold(s).replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^a-z0-9]+/g, ' ').trim();
const plainWords = (s) => { const p = plain(s); return p ? p.split(' ') : []; };
const isUseful = (w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w);

// Forme de base d'un mot (sans pluriel, famille de mots ramenée à un mot) ; la clé (6 lettres) rapproche
// en plus les mots de même racine, pour comparer avec l'historique (préparatifs / préparer).
function wordBase(w) {
  if (w.length > 3 && !KEEP_S.has(w)) {
    if (w.endsWith('eaux')) w = w.slice(0, -1);
    else if (w.endsWith('aux') && w.length > 5) w = `${w.slice(0, -3)}al`;
    else if (/[sx]$/.test(w)) w = w.slice(0, -1);
  }
  return SAME_WORD[w] || w;
}
const wordKey = (w) => wordBase(w).slice(0, 6);

// Notions de bon sens. p : notion parente (plus générale).
// names : mots qui désignent la notion dans un NOM de projet ou de sous-projet.
// s / m / f : mots du titre qui l'évoquent (fort, moyen, faible). « | » sépare les entrées, une entrée peut faire
// plusieurs mots ; « =mot » : ce mot exactement (« =courses » ≠ « course »).
// ctx : vocabulaire scolaire, pleinement pris en compte avec un indice scolaire (niveau, matière…) ;
// hint : simple indice (niveaux, matières), jamais un projet à lui seul ; not : mots qui annulent la notion.
const NOTIONS = [
  { id: 'perso', names: 'perso|personnel|prive|vie perso|vie privee|quotidien' },
  { id: 'travail', names: 'pro|travail|boulot|job|taf|work|bureau|professionnel|entreprise|agence|cabinet|societe',
    s: 'teletravail|seminaire|compte rendu|ordre du jour|point hebdo|rdv client',
    m: 'reunion|visio|teams|zoom|client|collegue|rapport|presentation|deadline|entretien|manager|chef|boss|devis|tableur|excel|powerpoint|formation',
    f: 'mail|appel|dossier|projet|document|doc' },
  { id: 'enseignement', p: 'travail', names: 'enseignement|ecole|lycee|college|education|professeur|classe|eleve|scolaire',
    s: 'lycee|college|pronote|eleve|classe|proviseur|cpe|inspection|inspecteur|salle des profs|vie scolaire|cahier de textes|ent|education nationale',
    m: 'prof|devoirs|programme|cantine|surveillance|sortie scolaire' },
  { id: 'ecole', p: 'enseignement', hint: 1,
    s: '6e|5e|4e|3e|2nde|1re|termin|bts|dgemc|hggsp|emc|ses|svt|snt|nsi|llce|hlp|histoire geo|hg|grand oral|bac|brevet|dnb|spe|specialite|bac blanc|enseignement scientifique',
    m: 'histoire|geo|philo|francais|math|physique|chimie|anglais|espagnol|allemand|latin|eps|sciences|groupe|demi groupe' },
  { id: 'prepa', p: 'enseignement', ctx: 1, names: 'prepa|preparation|cours|sequence|seance|lecon|pedagogie|preparer',
    s: 'prepar|sequence|seance|diapo|td|tp|chapitre|progression|polycopie|poly|plan de cours|support de cours|cours',
    m: 'lecon|fiche|activite|exercice|manuel|support|photocopie|document',
    not: 'paie|salaire|avenir|valise|sport|vacances|voyage' },
  { id: 'correction', p: 'enseignement', ctx: 1, names: 'correction|corriger|copie|evaluation|note|correc',
    s: 'copie|correc|bareme|annotation|annoter|paquet de copies',
    m: 'evalua|controle|ds|dm|interro|interrogation|note|noter|dissertation|dissert|commentaire|compo|composition|bac blanc|examen|partiel|epreuve',
    not: 'frais|technique|cle|medical' },
  { id: 'profprincipal', p: 'enseignement', names: 'prof principal|professeur principal|pp|vie de classe|suivi eleve|suivi des eleves',
    s: 'conseil de classe|bulletin|appreciation|parcoursup|orientation|fiche avenir|delegue|heure de vie de classe|hvc|vie de classe|pp|convocation|reunion parents|rencontre parents|parents d eleves|reunion parents profs',
    m: 'parent|conseil|stage|voeux|carnet|sanction|exclusion|absence|retard',
    not: 'paie|salaire' },
  { id: 'agreg', p: 'enseignement', names: 'agreg|agregation|capes|concours|prepa concours',
    s: 'agreg|agregation|capes|concours|jury|annales|oral blanc',
    m: 'lecon|ecrit|revis|dissertation|commentaire|memoire|bibliographie|biblio|fiche de lecture' },
  { id: 'admin', p: 'perso', names: 'admin|administratif|administration|papiers|paperasse|demarches|gestion',
    s: 'impot|declaration|caf|urssaf|ameli|secu|securite sociale|mutuelle|assurance|prefecture|passeport|cni|carte grise|carte d identite|attestation|justificatif|formulaire|resiliation|resilier|notaire|avocat|recommande|procuration|bulletin de paie|bulletin de salaire|fiche de paie|mairie|administratif|papiers|demarche|pole emploi|france travail|retraite|carte vitale|note de frais',
    m: 'courrier|lettre|contrat|abonnement|signer|signature|scanner|imprimer|dossier|inscription|inscrire|renouveler|renouvellement|remboursement|facture|banque|virement' },
  { id: 'argent', p: 'admin', names: 'argent|finance|budget|banque|compta|comptes|epargne|investissement|bourse|depenses',
    s: 'virement|pret|credit|epargne|budget|compte bancaire|livret|placement|remboursement|rembourser|cheque|rib|paypal|loyer|salaire|paieme|depense|facture|banque',
    m: 'frais|comptes|achat|prix|argent' },
  { id: 'maison', p: 'perso', names: 'maison|logement|appart|appartement|domicile|foyer|menage|home|intendance|chez nous|travaux|interieur',
    s: 'menage|aspirateur|serpilliere|poussiere|vaisselle|lessive|linge|repassage|etendre|poubelle|bricolage|bricoler|plombier|plomberie|electricien|jardin|jardinage|tondre|pelouse|arroser|plante|demenagement|demenager|travaux|meuble|ikea|chauffage|chaudiere|frigo|lave linge|lave vaisselle|salle de bain|ampoule',
    m: 'ranger|nettoy|trier|reparer|reparation|peinture|deco|decoration|cle|cave|grenier|garage|colis|maison|tri' },
  { id: 'courses', p: 'maison', names: '=courses|achats|approvisionnement|liste de courses',
    s: '=courses|supermarche|drive|carrefour|leclerc|auchan|lidl|intermarche|monoprix|franprix|biocoop|super u|liste de courses|faire les courses|hypermarche',
    m: 'achat|commande|commander|marche' },
  { id: 'cuisine', p: 'maison', names: 'cuisine|repas|recette|batch|cook|food|menu|popote|cuisiner',
    s: 'recette|cuisiner|batch|batch cooking|meal prep|gateau|patisserie|confiture|soupe|menu de la semaine|menus|cuisine',
    m: 'repas|diner|dejeuner|menu|plat|four|gouter' },
  { id: 'famille', p: 'perso', names: 'famille|family|proches|enfants|enfant',
    s: 'maman|papa|mere|pere|frere|soeur|mamie|papi|papy|grand mere|grand pere|grands parents|enfant|fils|fille|neveu|niece|cousin|cousine|tante|oncle|bebe|belle mere|beau pere|belle famille|bapteme|famille|nounou|creche|baby sitting|garde d enfant',
    m: 'parent|annive|cadeau|noel|fete des meres|fete des peres',
    not: 'eleve|classe|conseil|pronote' },
  { id: 'social', p: 'perso', names: 'social|sociale|amis|sorties|potes|copains|vie sociale',
    s: 'amis|ami|copain|copine|pote|apero|soiree|resto|restaurant|boire un verre|invitation|inviter|pot de depart|bar',
    m: 'sortie|verre|diner|annive|fete|week end|weekend|brunch' },
  { id: 'couple', p: 'perso', names: 'couple|amour|nous deux|a deux|amoureux',
    s: 'couple|amoureux|amoureuse|cherie|cheri|saint valentin|en amoureux|tete a tete|diner romantique|week end a deux|anniversaire de mariage' },
  { id: 'sante', p: 'perso', names: 'sante|medical|soins|bien etre|forme',
    s: 'medeci|generaliste|dentiste|kine|kinesitherapeute|osteo|osteopathe|ophtalmo|ophtalmologue|dermato|dermatologue|gyneco|gynecologue|pediatre|psy|psychologue|pharmacie|ordonnance|medicament|vaccin|prise de sang|analyses|radio|irm|echographie|hopital|urgences|orthodontiste|orthophoniste|podologue|sage femme|laboratoire',
    m: 'rdv medical|bilan|sante|mutuelle|lunettes|lentilles|sommeil|regime' },
  { id: 'sport', p: 'perso', names: 'sport|forme|fitness|activite physique|entrainement|muscu',
    s: 'sport|muscu|salle de sport|gym|fitness|crossfit|abdos|gainage|pilates|stretching|etirement|entrainement|tennis|football|foot|basket|handball|rugby|badminton|squash|padel|ping pong|escalade|ski|surf|boxe|judo|karate|danse|zumba',
    m: 'match|seance de sport|coach|=course|exercice physique' },
  { id: 'running', p: 'sport', names: 'running|trail|footing|jogging|course a pied|cap|courir|marathon',
    s: 'footin|trail|course a pied|courir|fractionne|marathon|semi marathon|10 km|vma|sortie longue|endurance fondamentale|cross',
    m: '=course|cap|piste' },
  { id: 'velo', p: 'sport', names: 'velo|cyclisme|vtt|bike', s: 'velo|vtt|cyclisme|home trainer|spinning|gravel|velotaf' },
  { id: 'natation', p: 'sport', names: 'natation|piscine|nage', s: 'natation|piscine|nager|nage|brasse|crawl|longueurs|aquagym' },
  { id: 'yoga', p: 'sport', names: 'yoga|meditation|zen|bien etre', s: 'yoga|meditation|mediter|relaxation|sophrologie|coherence cardiaque', m: 'respiration' },
  { id: 'rando', p: 'sport', names: 'rando|randonnee|marche|montagne|plein air', s: 'rando|randonnee|trek|trekking|montagne', m: 'marche|balade|promenade' },
  { id: 'loisirs', p: 'perso', names: 'loisirs|loisir|detente|fun|hobbies|hobby|culture|passions|passion',
    s: 'film|cinema|serie|netflix|lecture|livre|roman|bd|manga|musique|concert|guitare|piano|batterie|chant|chorale|jeu video|console|switch|playstation|theatre|expo|exposition|musee|dessin|tricot|couture|crochet|spectacle|festival|podcast|jeu de societe',
    m: 'jeu|sortie|peinture|photo' },
  { id: 'voyage', p: 'loisirs', names: 'voyage|vacances|trip|escapade|week end|weekend',
    s: 'voyage|vacances|valise|billet|train|avion|vol|hotel|airbnb|camping|road trip|sejour|itineraire|visa|gite|week end|weekend',
    m: 'reserv|passeport|aeroport|gare|location' },
  { id: 'dev', names: 'dev|code|appli|app|application|site|informatique|tech|logiciel|startup|side project|web',
    s: 'code|coder|dev|developpement|developper|bug|debug|deployer|deploiement|github|git|commit|cloudflare|api|base de donnees|maquette|ux|ui|fonctionnalite|feature|serveur|prompt|claude|chatgpt|ia|appli|application|site web|landing page|beta',
    m: 'test|design|site|app|version|mise a jour|ordinateur|ordi' },
  { id: 'pause', names: 'pause|break|repos|detente|temps calme',
    s: 'pause|sieste|break|recre|recreation|pause cafe|pause dejeuner',
    m: 'cafe|dejeuner|repos|souffler' },
  { id: 'animaux', p: 'maison', names: 'animaux|animal|chien|chat', s: 'chien|chat|veto|veterinaire|litiere|croquettes|toilettage|promener le chien|vermifuge' },
  { id: 'voiture', p: 'maison', names: 'voiture|auto|vehicule|moto',
    s: 'voiture|controle technique|vidange|pneus|garagiste|carrosserie|essence|carburant|plein d essence|parking|lavage voiture', m: 'garage|plein|moto' },
];
// Les emojis du sélecteur (et leurs mots-clés) rattachés aux notions : un emoji dans le titre est un indice fort.
const EMOJI_NOTION = {
  '💼': 'travail', '📚': 'prepa', '📝': 'correction', '🧑‍🏫': 'enseignement', '🎓': 'agreg', '🏫': 'enseignement', '📊': 'travail',
  '🗂️': 'admin', '💻': 'dev', '🌐': 'dev', '📧': 'travail', '📞': 'travail', '🖨️': 'admin', '🤝': 'travail',
  '🏠': 'maison', '🧹': 'maison', '🧺': 'maison', '🍳': 'cuisine', '🛒': 'courses', '🔧': 'maison', '🪴': 'maison', '🛏️': 'maison',
  '🗑️': 'maison', '📦': 'maison', '🐶': 'animaux', '🐱': 'animaux', '🚗': 'voiture', '🧸': 'famille',
  '❤️': 'couple', '👨‍👩‍👧': 'famille', '👶': 'famille', '🎂': 'famille', '🎁': 'famille', '👫': 'social', '💍': 'famille', '🥂': 'social',
  '📸': 'loisirs', '🏖️': 'voyage', '✈️': 'voyage', '🚆': 'voyage', '🗺️': 'voyage', '✉️': 'admin',
  '🏃': 'running', '🚴': 'velo', '🏊': 'natation', '🏋️': 'sport', '🧘': 'yoga', '⚽': 'sport', '🎾': 'sport', '🥾': 'rando',
  '💊': 'sante', '🩺': 'sante', '🦷': 'sante', '😴': 'sante',
  '💶': 'argent', '💳': 'argent', '🏦': 'argent', '🧾': 'argent', '📑': 'admin', '🖋️': 'admin', '🏛️': 'admin', '📬': 'admin',
  '🛡️': 'admin', '🪪': 'admin', '⚖️': 'admin', '🧮': 'argent', '💰': 'argent',
  '🎮': 'loisirs', '🎨': 'loisirs', '🎵': 'loisirs', '🎸': 'loisirs', '📖': 'loisirs', '🎬': 'loisirs', '📺': 'loisirs', '🎭': 'loisirs',
  '🧩': 'loisirs', '☕': 'pause', '🧑‍🍳': 'cuisine', '🍕': 'social', '🍷': 'social',
};
const EMOJI_SKIP = new Set(['ecrire', 'lire', 'note', 'course', 'courses', 'salle']); // mots-clés d'emojis trop vagues ou ambigus
const TEACH = new Set(['enseignement', 'ecole', 'prepa', 'correction', 'profprincipal', 'agreg']);
const LEVEL = [1, 0.8, 0.6, 0.45, 0.35]; // une notion plus générale (parent, grand-parent…) compte moins

let LEX = null;
function lexicon() {
  if (LEX) return LEX;
  const L = { byId: new Map(), byBase: new Map(), byKey: new Map(), exact: new Map(), phrases: [], surfaces: new Map(), known: new Set() };
  const push = (map, k, v) => (map.get(k) || map.set(k, []).get(k)).push(v);
  const entries = (str) => (str || '').split('|').map((x) => x.trim()).filter(Boolean);
  const addWord = (n, entry, w) => {
    if (entry.includes(' ')) {
      L.phrases.push({ text: ` ${entry} `, n, w, word: entry });
      entry.split(' ').forEach((x) => L.known.add(wordBase(x)));
      return;
    }
    if (entry.startsWith('=')) {
      const e = entry.slice(1);
      push(L.exact, e, { n, w });
      push(L.surfaces, e, { n, w });
      L.known.add(wordBase(e));
      return;
    }
    const b = wordBase(entry);
    push(L.byBase, b, { n, w });
    if (b.length >= 6) push(L.byKey, b.slice(0, 6), { n, w });
    push(L.surfaces, entry, { n, w });
    L.known.add(b);
  };
  for (const d of NOTIONS) {
    const n = {
      id: d.id, parent: d.p || '', ctx: !!d.ctx, hint: !!d.hint, not: new Set(entries(d.not).map(wordBase)),
      nameBases: new Set(), nameExact: new Set(), namePhrases: [], nameWords: [], strong: new Set(),
    };
    for (const e of entries(d.names)) {
      if (e.includes(' ')) n.namePhrases.push(e);
      else if (e.startsWith('=')) n.nameExact.add(e.slice(1));
      else { n.nameBases.add(wordBase(e)); n.nameWords.push(e); }
      e.replace('=', '').split(' ').forEach((x) => L.known.add(wordBase(x)));
    }
    L.byId.set(n.id, n);
    for (const [f, w] of [['s', 1], ['m', 0.7], ['f', 0.45]]) {
      for (const e of entries(d[f])) {
        addWord(n.id, e, w);
        if (w === 1 && !e.includes(' ')) n.strong.add(wordBase(e.replace('=', '')));
      }
    }
  }
  for (const cat of EMOJIS) {
    for (const it of cat.items) {
      const n = EMOJI_NOTION[it.e];
      if (n) for (const x of plainWords(it.k)) if (isUseful(x) && !EMOJI_SKIP.has(x)) addWord(n, x, 0.5);
    }
  }
  LEX = L;
  return L;
}

// Distance d'une notion à l'un de ses ancêtres (0 : la même ; -1 : pas un ancêtre).
function notionDist(a, b) {
  const L = lexicon();
  let d = 0;
  for (let x = a; x; x = L.byId.get(x)?.parent, d++) if (x === b) return d;
  return -1;
}
const related = (a, b) => notionDist(a, b) >= 0 || notionDist(b, a) >= 0;

// Ce que désigne un nom de projet ou de sous-projet : notion → justesse (0 à 1), et ses notions principales.
function nameNotions(name) {
  const L = lexicon();
  const ws = plainWords(name).filter(isUseful);
  const pt = ` ${plain(name)} `;
  const fit = new Map();
  const own = new Map();
  for (const n of L.byId.values()) {
    let best = 0;
    const hit = new Set();
    for (const ph of n.namePhrases) if (pt.includes(` ${ph} `)) { best = 1; ph.split(' ').forEach((x) => hit.add(x)); }
    for (const w of ws) {
      const b = wordBase(w);
      let m = 0;
      if (n.nameExact.has(w) || n.nameBases.has(b)) m = 1;
      else if (n.strong.has(b)) m = 0.8;
      else if (n.nameWords.some((x) => x.length >= 4 && w.length >= x.length + 3 && w.startsWith(x))) m = 0.85; // « CookOnce » → cook (mais « course » n'est pas « cours »)
      if (m) { best = Math.max(best, m); hit.add(w); }
    }
    if (best) own.set(n.id, { best, hit });
  }
  for (const [id, o] of own) {
    // mots du nom expliqués par cette notion, ou par une autre sans rapport (« Famille / Social » : deux sujets)
    const covered = new Set(o.hit);
    for (const [id2, o2] of own) if (id2 !== id && !related(id, id2)) o2.hit.forEach((x) => covered.add(x));
    const share = ws.length ? ws.filter((w) => covered.has(w)).length / ws.length : 1;
    fit.set(id, o.best * (0.6 + 0.4 * share));
  }
  const max = Math.max(0, ...fit.values());
  const focus = new Set([...fit].filter(([, v]) => v >= max * 0.95).map(([id]) => id));
  return { ws, fit, focus };
}

// Justesse d'un nom pour une notion, réduite de moitié si le nom vise surtout autre chose de plus précis
// (« Prof principal » n'est pas le bon endroit pour n'importe quelle tâche d'enseignement).
function fitFor(N, n) {
  const v = N.fit.get(n);
  if (!v) return 0;
  return [...N.focus].some((f) => notionDist(n, f) >= 0) ? v : v * 0.5;
}

// Découpage d'un titre, gardé en mémoire : il ne change pas d'une fiche à l'autre.
const parsedTitles = new Map();
function parseTitle(title) {
  let p = parsedTitles.get(title);
  if (!p) {
    const ws = plainWords(title);
    const wk = ws.map(wordKey);
    const uw = [];
    const uk = [];
    ws.forEach((w, i) => { if (isUseful(w)) { uw.push(w); uk.push(wk[i]); } });
    p = { plain: ws.join(' '), ws, wk, uw, uk, keys: [...new Set(uk)] };
    parsedTitles.set(title, p);
  }
  return p;
}

// L'index n'est refait que si les données ont changé (empreinte des dates de modification).
let sugCache = null;
function suggestIndexCached() {
  let h = 0;
  for (const list of [state.tasks, state.sessions, state.projects, state.subprojects]) {
    h = (h * 31 + list.length) | 0;
    for (const x of list) h = (h * 31 + ((x.updatedAt || x.createdAt || x.end || 0) % 1e9)) | 0;
  }
  const key = `${profile}|${h}`;
  if (sugCache?.key !== key) sugCache = { key, ix: suggestIndex() };
  return sugCache.ix;
}

// Index de la personne : ses projets, et son historique pour comparer les titres.
function suggestIndex() {
  const node = (id, name) => ({ id, name, ...nameNotions(name) });
  const projects = state.projects.filter((p) => !p.archived)
    .map((p) => ({ ...node(p.id, p.name), subs: subsOf(p.id).map((s) => node(s.id, s.name)) }));
  const byP = new Map(projects.map((P) => [P.id, P]));
  const pairOk = (pid, sid) => {
    const P = byP.get(pid);
    return P ? { pid, sid: sid && P.subs.some((S) => S.id === sid) ? sid : '' } : null;
  };
  // Vocabulaire scolaire plus sûr pour quelqu'un qui a des projets d'enseignement.
  const teacher = projects.some((P) => [P, ...P.subs].some((N) => [...N.fit].some(([id, v]) => TEACH.has(id) && v >= 0.8)));
  const partners = PROFILES.filter((x) => x.id !== profile).map((x) => plain(x.name));

  // Exemples : chaque tâche, puis les tâches supprimées dont il reste des sessions dans le journal.
  const ex = [];
  const add = (title, pid, sid, t, open) => {
    const p = parseTitle(title);
    ex.push({ title, plain: p.plain, ws: p.ws, wk: p.wk, uw: p.uw, uk: p.uk, keys: p.keys, pid: pid || '', sid: sid || '', t: t || 0, open });
  };
  for (const t of state.tasks) add(t.title, t.projectId, t.subprojectId, Math.max(t.updatedAt || 0, t.doneAt || 0, t.createdAt || 0), !t.done);
  const ids = new Set(state.tasks.map((t) => t.id));
  const gone = new Map();
  for (const s of state.sessions) {
    if (s.taskId && ids.has(s.taskId)) continue;
    const k = s.taskId || `${plain(s.title || '')}|${s.projectId || ''}`;
    if (!(gone.get(k)?.end >= s.end)) gone.set(k, s);
  }
  for (const s of gone.values()) add(s.title || '', s.projectId, s.subprojectId, s.end, false);

  const df = new Map();
  const inv = new Map();
  const surf = new Map(); // mot tel qu'écrit → clé (pour compléter un mot en cours de frappe)
  ex.forEach((e, i) => {
    for (const k of e.keys) { df.set(k, (df.get(k) || 0) + 1); (inv.get(k) || inv.set(k, []).get(k)).push(i); }
    e.uw.forEach((w, j) => surf.set(w, e.uk[j]));
  });
  const N = ex.length;
  const idf = (k) => (df.has(k) ? Math.log(1 + N / df.get(k)) : 0.7); // un mot rare compte plus
  for (const e of ex) e.idfSum = e.keys.reduce((n, k) => n + idf(k), 0) || 1;

  // Titres déjà utilisés (regroupés), avec le projet / sous-projet le plus fréquent pour chacun.
  const groups = new Map();
  for (const e of ex) {
    if (!e.plain) continue;
    let g = groups.get(e.plain);
    if (!g) groups.set(e.plain, g = { plain: e.plain, ws: e.ws, wk: e.wk, title: e.title, t: -1, n: 0, open: false, pairs: new Map() });
    g.n++;
    g.open ||= e.open;
    if (e.t >= g.t) { g.t = e.t; g.title = e.title; }
    const pair = pairOk(e.pid, e.sid) || { pid: '', sid: '' };
    const pk = `${pair.pid}|${pair.sid}`;
    const c = g.pairs.get(pk) || { ...pair, n: 0, t: 0 };
    c.n++;
    c.t = Math.max(c.t, e.t);
    g.pairs.set(pk, c);
  }
  const titles = [...groups.values()].map((g) => {
    const best = [...g.pairs.values()].sort((a, b) => b.n - a.n || b.t - a.t)[0];
    return { ...g, pid: best.pid, sid: best.sid };
  });
  return { projects, byP, pairOk, teacher, partners, ex, inv, idf, surf, titles };
}

/* ----- 1) L'historique ----- */

// Mots utiles du titre tapé ; le dernier, en cours de frappe, vaut aussi pour les mots qui le prolongent.
function queryTokens(q, ix, partial) {
  const ws = plainWords(q);
  const toks = [];
  ws.forEach((w, i) => {
    if (!isUseful(w)) return;
    const isLast = partial && i === ws.length - 1;
    if (isLast && w.length < 3) return;
    const keys = new Set([wordKey(w)]);
    if (isLast) for (const [s, k] of ix.surf) if (s.startsWith(w)) keys.add(k);
    toks.push({ keys, weight: Math.max(...[...keys].map(ix.idf)) });
  });
  return toks;
}

// Projets / sous-projets des tâches passées qui ressemblent au titre : mots communs (surtout les rares),
// tâches fréquentes et récentes. Un titre identique compte beaucoup.
function historyRank(q, ix, lock, partial) {
  const toks = queryTokens(q, ix, partial);
  if (!toks.length) return [];
  const qPlain = plainWords(q).join(' ');
  const total = toks.reduce((n, t) => n + t.weight, 0);
  const found = new Map(); // exemple → { w : poids des mots tapés retrouvés, e : poids de ses propres mots retrouvés }
  for (const t of toks) {
    const seen = new Set();
    for (const k of t.keys) {
      for (const i of ix.inv.get(k) || []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const m = found.get(i) || { w: 0, e: 0 };
        m.w += t.weight;
        m.e += ix.idf(k);
        found.set(i, m);
      }
    }
  }
  const pairs = new Map();
  for (const [i, m] of found) {
    const e = ix.ex[i];
    if (lock.p && e.pid !== lock.p) continue;
    const pair = ix.pairOk(e.pid, e.sid);
    if (!pair) continue;
    const same = e.plain === qPlain;
    const sim = same ? 1.5 : (m.w / total) * (0.55 + 0.45 * Math.min(1, m.e / e.idfSum));
    if (sim < 0.2) continue;
    const recent = 0.6 + 0.4 * Math.exp(-(now() - e.t) / (90 * 864e5));
    const k = `${pair.pid}|${pair.sid}`;
    const c = pairs.get(k) || { ...pair, score: 0, n: 0, same: 0 };
    c.score += sim * sim * recent;
    if (sim >= 0.35) c.n++;
    if (same) c.same++;
    pairs.set(k, c);
  }
  return [...pairs.values()].sort((a, b) => b.score - a.score);
}

/* ----- 2) Le bon sens ----- */

// Notions évoquées par le titre : notion → force (0 à 1), et le mot qui l'a évoquée.
function titleNotions(q, ix, partial) {
  const L = lexicon();
  const pt = ` ${plain(q)} `;
  const ws = plainWords(q);
  const last = partial ? ws[ws.length - 1] || '' : '';
  const hits = new Map();
  const add = (n, w, word) => { const k = `${n}|${word}`; if (!(hits.get(k)?.w >= w)) hits.set(k, { n, w, word }); };
  // Un mot pris dans une expression n'évoque rien d'autre (« sortie longue » n'est pas une sortie entre amis).
  const used = new Set();
  for (const ph of L.phrases) if (pt.includes(ph.text)) { add(ph.n, ph.w, ph.word); ph.word.split(' ').forEach((x) => used.add(x)); }
  for (const w of ws) {
    if (used.has(w)) continue;
    for (const h of L.exact.get(w) || []) add(h.n, h.w, w);
    if (!isUseful(w)) continue;
    const b = wordBase(w);
    const direct = L.byBase.get(b);
    if (direct) direct.forEach((h) => add(h.n, h.w, w));
    else if (b.length >= 6) (L.byKey.get(b.slice(0, 6)) || []).forEach((h) => add(h.n, h.w * 0.85, w));
    // mot en cours de frappe : « footi » → footing
    if (w === last && w.length >= 4 && !direct) {
      for (const [s, list] of L.surfaces) if (s.length > w.length && s.startsWith(w)) list.forEach((h) => add(h.n, h.w * 0.75, w));
    }
  }
  for (const [e, n] of Object.entries(EMOJI_NOTION)) if (q.includes(e)) add(n, 0.9, e);
  for (const name of ix.partners) if (ws.includes(name)) add('couple', 1, name); // le prénom de l'autre profil
  const list = [...hits.values()];
  // Indice scolaire (niveau, matière…), ou au moins deux mots du métier : le vocabulaire scolaire compte pleinement.
  const school = list.some((h) => h.n === 'ecole') || new Set(list.filter((h) => TEACH.has(h.n)).map((h) => h.word)).size >= 2;
  if (school && ws.includes('t')) list.push({ n: 'ecole', w: 0.6, word: 't' }); // « T » = terminale, seulement dans ce cas
  const ctxF = school ? 1 : ix.teacher ? 0.85 : 0.6;
  const bases = new Set(ws.map(wordBase));
  const raw = new Map();
  const why = new Map();
  const top = new Map();
  for (const h of list) {
    const n = L.byId.get(h.n);
    if ([...n.not].some((x) => bases.has(x))) continue;
    const w = h.w * (n.ctx ? ctxF : 1) * (n.hint && !ix.teacher ? 0.5 : 1); // niveaux, matières : l'école des enfants ?
    raw.set(h.n, 1 - (1 - (raw.get(h.n) || 0)) * (1 - w));
    if (w > (top.get(h.n) || 0)) { top.set(h.n, w); why.set(h.n, h.word); }
  }
  return { raw, why };
}

// Projets / sous-projets dont le NOM correspond aux notions du titre (ou est cité tel quel dans le titre).
function logicRank(q, ix, lock, partial) {
  const L = lexicon();
  const { raw, why } = titleNotions(q, ix, partial);
  const qws = plainWords(q).filter(isUseful);
  const last = partial ? qws[qws.length - 1] : '';
  const topics = [...raw].filter(([id]) => !L.byId.get(id).hint);
  const contrib = (N) => {
    let direct = 0;
    let up = 0;
    let best = 0;
    let word = '';
    for (const [t, st] of raw) {
      // un autre sujet, sans rapport et nettement plus évoqué, rend celui-ci moins probable
      const stronger = topics.some(([t2, s2]) => s2 >= st + 0.1 && !related(t, t2));
      for (let n = t, d = 0; n; n = L.byId.get(n).parent, d++) {
        const f = fitFor(N, n);
        if (!f) continue;
        const c = st * f * LEVEL[Math.min(d, LEVEL.length - 1)] * (stronger ? 0.7 : 1);
        if (d === 0) direct = 1 - (1 - direct) * (1 - c); else up = Math.max(up, c);
        if (c > best) { best = c; word = why.get(t); }
        break; // la notion la plus précise que ce nom désigne
      }
    }
    // Nom cité dans le titre (« Vbarthe », « Opti Todo ») : fort s'il s'agit d'un mot propre au projet.
    for (const w of qws) {
      for (const nw of N.ws) {
        // mot courant (déjà pris en compte par les notions) : seulement tel quel, sans s'ajouter ;
        // mot propre au projet : aussi au pluriel ou en cours de frappe, et il s'ajoute
        const known = L.known.has(wordBase(nw));
        const m = w === nw ? 1 : known || w.length < 3 ? 0 : wordBase(w) === wordBase(nw) ? 1 : w === last && nw.startsWith(w) ? 0.85 : 0;
        if (!m) continue;
        const v = m * (known ? 0.55 : 0.9);
        direct = known ? Math.max(direct, v) : 1 - (1 - direct) * (1 - v);
        if (v > best) { best = v; word = w; }
      }
    }
    return { score: Math.max(direct, up), word };
  };
  const out = new Map();
  const put = (c) => { const k = `${c.pid}|${c.sid}`; if (c.score > 0 && !(out.get(k)?.score >= c.score)) out.set(k, c); };
  for (const P of ix.projects) {
    if (lock.p && P.id !== lock.p) continue;
    const pc = contrib(P);
    if (!lock.p) put({ pid: P.id, sid: '', score: pc.score, own: pc.score, word: pc.word });
    for (const S of P.subs) {
      const sc = contrib(S);
      if (sc.score) put({ pid: P.id, sid: S.id, score: 1 - (1 - sc.score) * (1 - 0.5 * pc.score), own: sc.score, word: sc.word });
    }
  }
  // Un sous-projet bien désigné remplace son projet seul.
  for (const c of [...out.values()]) {
    const p = out.get(`${c.pid}|`);
    if (c.sid && p && c.own >= 0.7 * p.score) out.delete(`${c.pid}|`);
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

/* ----- Assemblage ----- */

const H_SHOW = 0.3;  // historique : pastille
const H_AUTO = 1.2;  // historique : présélection (≈ un même nom, ou 2 à 3 tâches très proches)
const L_SHOW = 0.4;  // bon sens : pastille
const L_AUTO = 0.75; // bon sens : présélection

// Choix à présélectionner : l'historique s'il est net ; sinon le bon sens, s'il est net et ne contredit pas l'historique.
function pickAuto(hist, logic) {
  const h = hist[0];
  const l = logic[0];
  if (h) {
    const total = hist.reduce((n, c) => n + c.score, 0);
    if ((h.score >= H_AUTO || (h.n >= 3 && h.score >= 0.8)) && h.score / total >= 0.6) return h;
    const byP = new Map();
    for (const c of hist) byP.set(c.pid, (byP.get(c.pid) || 0) + c.score);
    const [pid, ps] = [...byP].sort((a, b) => b[1] - a[1])[0];
    if (ps >= H_AUTO && ps / total >= 0.7) return { pid, sid: '' }; // projet sûr, sous-projets partagés
    if (l && l.score >= L_AUTO && l.pid === h.pid && (!h.sid || h.sid === l.sid)) return l;
    return null;
  }
  if (!l || l.score < L_AUTO) return null;
  const rival = logic.find((c) => c.pid !== l.pid);
  if (rival && l.score - rival.score < 0.15) return null;
  const twin = logic.find((c) => c !== l && c.pid === l.pid && c.sid && c.sid !== l.sid);
  if (l.sid && twin && l.score - twin.score < 0.1) return { pid: l.pid, sid: '' };
  return l;
}

// Titres déjà utilisés qui correspondent à ce qui est tapé (début de mot, dans n'importe quel ordre).
function titleMatches(q, ix, lock) {
  const qp = plainWords(q);
  const qw = qp.filter((w) => !STOP_WORDS.has(w));
  if (!qw.length || qw.join('').length < 3) return [];
  const partial = !/\s$/.test(q);
  const qPlain = qp.join(' ');
  const out = [];
  for (const g of ix.titles) {
    if ((lock.p && g.pid !== lock.p) || (lock.s && g.sid !== lock.s) || g.plain === qPlain) continue;
    let sc = 0;
    for (let i = 0; i < qw.length; i++) {
      const w = qw[i];
      const k = wordKey(w);
      const isLast = partial && i === qw.length - 1;
      let best = 0;
      g.ws.forEach((tw, j) => {
        if (tw === w) best = 1;
        else if (tw.startsWith(w) && (isLast || w.length >= 3)) best = Math.max(best, 0.8);
        else if (w.length >= 4 && g.wk[j] === k) best = Math.max(best, 0.9);
      });
      if (!best) { sc = 0; break; }
      sc += best;
    }
    if (!sc) continue;
    if (g.plain.startsWith(qPlain)) sc += 1;
    sc += Math.log2(1 + g.n) * 0.4 + 0.4 * Math.exp(-(now() - g.t) / (45 * 864e5));
    out.push({ ...g, sc });
  }
  return out.sort((a, b) => b.sc - a.sc).slice(0, 3);
}

// Titre encore vide : les tâches qui reviennent souvent (sauf celles déjà en cours), pour les reprendre d'un toucher.
function recentTitles(ix, lock) {
  const w = (g) => g.n * (0.5 + Math.exp(-(now() - g.t) / (30 * 864e5)));
  return ix.titles.filter((g) => g.n >= 2 && !g.open && (!lock.p || g.pid === lock.p) && (!lock.s || g.sid === lock.s))
    .sort((a, b) => w(b) - w(a)).slice(0, 3);
}

function suggest(q, st) {
  const { ix, lock } = st;
  const res = { list: [], auto: null, titles: [], recent: [] };
  if (!q.trim()) { res.recent = recentTitles(ix, lock); return res; }
  if (plain(q).replace(/ /g, '').length < 3) return res; // une ou deux lettres : rien
  res.titles = titleMatches(q, ix, lock);
  if (lock.s) return res; // projet et sous-projet déjà fixés
  const partial = !/[\s.,;:!?)]$/.test(q);
  const keep = (c) => !lock.p || c.sid; // projet fixé : seul le sous-projet se propose
  const hist = historyRank(q, ix, lock, partial).filter((c) => c.score >= H_SHOW && keep(c));
  const logic = logicRank(q, ix, lock, partial).filter((c) => c.score >= L_SHOW && keep(c));
  const list = hist.map((c) => ({
    ...c, why: c.same ? `même nom${c.same > 1 ? ` ×${c.same}` : ''}` : `${c.n || 1} tâche${c.n > 1 ? 's' : ''} similaire${c.n > 1 ? 's' : ''}`,
  }));
  // le mot tel qu'il a été tapé (avec ses accents) pour expliquer la suggestion
  const typed = new Map();
  for (const tok of q.split(/[^\p{L}\p{N}]+/u)) { const p = plain(tok); if (p && !typed.has(p)) typed.set(p, tok.toLowerCase()); }
  const pretty = (w) => w.split(' ').map((x) => typed.get(x) || x).join(' ');
  for (const c of logic) {
    if (list.some((h) => h.pid === c.pid && (h.sid === c.sid || !c.sid))) continue;
    list.push({ ...c, why: `mot-clé « ${pretty(c.word)} »` });
  }
  res.list = list.slice(0, 3);
  res.auto = pickAuto(hist, logic);
  return res;
}

/* ----- Dans les fiches ----- */

const sugForms = new WeakMap(); // fiche de création → état des suggestions

// Branche les suggestions sur une fiche de création. lock : projet (et sous-projet) déjà fixés.
function suggestInit(form, lock = {}) {
  const input = form?.elements.title;
  if (!input) return;
  const st = {
    ix: null, lock: { p: lock.p || '', s: lock.s || '' },
    // default : projet par défaut ; auto : choisi par l'app ; manual : choisi à la main ; declined : suggestion refusée
    mode: 'default', def: { pid: form.elements.projectId.value, sid: form.elements.subprojectId.value },
    list: [], titles: [], recent: [], auto: null, sel: -1, timer: 0, row: '', ac: '',
  };
  sugForms.set(form, st);
  const row = document.createElement('div');
  row.className = 'sug';
  row.setAttribute('aria-live', 'polite');
  input.closest('label.field').insertAdjacentElement('afterend', row);
  sugRender(form);
  // L'index se prépare juste après l'affichage de la fiche (aussitôt prêt si les données n'ont pas changé).
  setTimeout(() => {
    if (!form.isConnected) return;
    st.ix = suggestIndexCached();
    suggestRefresh(form, document.activeElement === input && !!input.value.trim());
  }, 20);
}

function suggestRefresh(form, showList) {
  const st = sugForms.get(form);
  if (!st || !st.ix || !form.isConnected) return;
  Object.assign(st, suggest(form.elements.title.value, st));
  if (st.mode === 'default' || st.mode === 'auto') {
    if (st.auto) sugApply(form, st.auto, 'auto');
    else if (st.mode === 'auto') sugApply(form, st.def, 'default'); // plus de suggestion nette : retour au choix par défaut
  }
  sugRender(form);
  sugList(form, showList);
}

// Met ce projet / sous-projet dans la fiche.
function sugApply(form, c, mode) {
  const st = sugForms.get(form);
  const el = form.elements;
  const pid = st.lock.p || c.pid || '';
  const sid = st.lock.s || (c.pid === pid ? c.sid || '' : '');
  const changed = el.projectId.value !== pid || el.subprojectId.value !== sid;
  el.projectId.value = pid;
  el.subprojectId.value = sid;
  st.mode = mode;
  form.dataset.auto = mode !== 'auto' ? '' : st.lock.p ? 's' : sid ? 'ps' : 'p';
  if (!changed) return;
  pfRefresh(form);
  if (mode === 'auto') {
    for (const b of form.querySelectorAll('.pick-btn')) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
  }
}

// Projet choisi à la main (menu) : il n'est plus jamais remplacé.
function sugManual(form) {
  const st = sugForms.get(form);
  if (!st) return;
  st.mode = 'manual';
  form.dataset.auto = '';
  sugRender(form);
}

// Pastilles sous le titre : projets suggérés, ou titres fréquents tant que le titre est vide.
function sugRender(form) {
  const st = sugForms.get(form);
  const box = form.querySelector('.sug');
  if (!st || !box) return;
  const cur = { pid: form.elements.projectId.value, sid: form.elements.subprojectId.value };
  const empty = !form.elements.title.value.trim();
  let html = '';
  if (st.list.length) {
    html = st.list.map((c) => {
      const P = getProject(c.pid);
      const S = getSub(c.sid);
      if (!P) return '';
      const on = c.pid === cur.pid && (c.sid || '') === cur.sid;
      const label = st.lock.p ? S?.name || '' : S ? `${P.name} › ${S.name}` : P.name;
      const mark = on && st.mode === 'auto' ? ICON.close : on ? ICON.check : '';
      return `<button type="button" class="sug-chip${on ? ' on' : ''}" data-action="sug-pick" data-p="${c.pid}" data-s="${c.sid || ''}" style="--c:${P.color}"
        title="${esc(`${label} · ${c.why}`)}${on && st.mode === 'auto' ? ' · touche pour annuler' : ''}"><i></i><span>${esc(label)}</span><small>${esc(c.why)}</small>${mark}</button>`;
    }).join('');
  } else if (empty && st.recent.length) {
    html = `<span class="sug-lead" title="Tâches fréquentes">↺</span>${st.recent.map((g, i) => `<button type="button" class="sug-chip title" data-action="sug-title" data-from="recent" data-i="${i}" style="--c:${colorOf(g.pid)}"><i></i><span>${esc(g.title)}</span></button>`).join('')}`;
  } else if (empty && !st.lock.s) {
    html = `<span class="sug-hint">✨ Le ${st.lock.p ? 'sous-projet' : 'projet'} se proposera d’après le nom</span>`;
  }
  if (html !== st.row) { st.row = html; box.innerHTML = html; }
}

// Liste des titres déjà utilisés, sous le champ (seulement pendant la frappe).
function sugList(form, show) {
  const st = sugForms.get(form);
  const input = form.elements.title;
  const field = input.closest('.emoji-field');
  let ac = field.querySelector('.ac');
  if (!show || !st.titles.length || document.activeElement !== input) {
    ac?.remove();
    st.sel = -1;
    st.ac = '';
    return;
  }
  const qw = plainWords(input.value).filter((w) => !STOP_WORDS.has(w));
  const bold = (title) => title.split(/(\s+)/).map((part) => {
    const words = plainWords(part);
    return words.length && words.some((x) => qw.some((w) => x.startsWith(w))) ? `<b>${esc(part)}</b>` : esc(part);
  }).join('');
  const html = `<div class="ac-head">Déjà utilisées</div>${st.titles.map((g, i) => {
    const P = getProject(g.pid);
    const S = getSub(g.sid);
    return `<button type="button" role="option" aria-selected="${i === st.sel}" class="ac-row${i === st.sel ? ' on' : ''}" data-action="sug-title" data-from="list" data-i="${i}">
      <span class="ac-title">${bold(g.title)}</span>
      <span class="ac-meta"><i style="--c:${P ? P.color : 'transparent'}"></i>${esc(P ? (S ? `${P.name} › ${S.name}` : P.name) : 'Sans projet')}${g.n > 1 ? ` · ${g.n} fois` : ''}</span></button>`;
  }).join('')}`;
  if (!ac) {
    ac = document.createElement('div');
    ac.className = 'ac';
    ac.setAttribute('role', 'listbox');
    field.appendChild(ac);
  }
  if (html !== st.ac) { st.ac = html; ac.innerHTML = html; }
}

sheet.addEventListener('input', (e) => {
  const form = e.target.name === 'title' && e.target.form;
  const st = form && sugForms.get(form);
  if (!st) return;
  st.sel = -1;
  clearTimeout(st.timer);
  st.timer = setTimeout(() => suggestRefresh(form, e.isTrusted), 90); // emoji ajouté par le sélecteur : pas de liste
});
sheet.addEventListener('focusin', (e) => {
  const form = e.target.name === 'title' && e.target.form;
  if (form && sugForms.has(form)) sugList(form, true);
});
sheet.addEventListener('focusout', (e) => {
  const form = e.target.name === 'title' && e.target.form;
  if (form && sugForms.has(form)) setTimeout(() => { if (document.activeElement !== e.target) sugList(form, false); }, 150);
});
// Toucher la liste ne retire pas le clavier.
sheet.addEventListener('mousedown', (e) => { if (e.target.closest('.ac')) e.preventDefault(); });
sheet.addEventListener('keydown', (e) => {
  const form = e.target.name === 'title' && e.target.form;
  const st = form && sugForms.get(form);
  if (!st || !form.querySelector('.ac')) return;
  const n = st.titles.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    st.sel = e.key === 'ArrowDown' ? (st.sel + 1 >= n ? -1 : st.sel + 1) : (st.sel - 1 < -1 ? n - 1 : st.sel - 1);
    sugList(form, true);
  } else if (e.key === 'Enter' && st.sel >= 0) {
    e.preventDefault();
    form.querySelector(`.ac-row[data-i="${st.sel}"]`)?.click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    sugList(form, false);
  }
});

/* ---------- Ordre des projets (glisser la poignée ⋮⋮) ---------- */

const sortDrag = { active: null };

document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('.proj-grip');
  if (!grip || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault();
  const item = grip.closest('.proj-item');
  const items = $$('.proj-item', item.parentElement);
  const from = items.indexOf(item);
  sortDrag.active = {
    item, items, from, to: from, y0: e.clientY + scrollY,
    centers: items.map((el) => { const r = el.getBoundingClientRect(); return r.top + scrollY + r.height / 2; }),
    h: item.getBoundingClientRect().height,
  };
  item.classList.add('sorting');
  document.body.classList.add('is-sorting');
  buzz();
});

window.addEventListener('pointermove', (e) => {
  const s = sortDrag.active;
  if (!s) return;
  if (e.clientY < 110) scrollBy(0, -10); else if (e.clientY > innerHeight - 120) scrollBy(0, 10);
  const dy = e.clientY + scrollY - s.y0;
  s.item.style.transform = `translateY(${dy}px)`;
  const center = s.centers[s.from] + dy;
  s.to = s.centers.filter((c, j) => j !== s.from && c < center).length;
  s.items.forEach((el, j) => {
    if (j === s.from) return;
    const off = s.from < s.to && j > s.from && j <= s.to ? -s.h : s.to < s.from && j >= s.to && j < s.from ? s.h : 0;
    el.style.transform = off ? `translateY(${off}px)` : '';
  });
});

function endSort() {
  const s = sortDrag.active;
  if (!s) return;
  sortDrag.active = null;
  document.body.classList.remove('is-sorting');
  if (s.to !== s.from) {
    const ids = s.items.map((el) => el.dataset.id);
    ids.splice(s.to, 0, ids.splice(s.from, 1)[0]);
    const queue = ids.map(getProject);
    const set = new Set(ids);
    state.projects = state.projects.map((x) => (set.has(x.id) ? queue.shift() : x));
    state.projects.forEach((x, i) => { x.order = i; });
    save(); buzz();
  }
  render();
}
window.addEventListener('pointerup', endSort);
window.addEventListener('pointercancel', endSort);

/* ---------- Onglet « Aujourd'hui » : la journée en blocs à valider (page d'accueil) ---------- */

const DAY_WINDOW_END = 23 * 60; // créneaux libres proposés jusqu'à 23h
const SWIPE_GO = 90;            // distance de balayage (px) pour valider / reporter
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const planDone = (p) => !!p.done || !!getTask(p.taskId)?.done;
const greeting = () => { const h = new Date().getHours(); return h >= 18 || h < 5 ? 'Bonsoir' : h < 12 ? 'Bonjour' : 'Bon après-midi'; };

// Événements fixes et créneaux planifiés d'un jour, dans l'ordre (minutes depuis minuit).
function dayAgenda(day) {
  const evs = eventsOn(parseYmd(day)).map((ev) => ({ kind: 'event', ev, s: ev.start, e: Math.min(ev.end, DAY_MIN) }));
  const pls = plansOn(day).map((p) => ({ kind: 'plan', p, t: getTask(p.taskId), s: minOfDay(p.start, day), e: minOfDay(p.end, day) || DAY_MIN }));
  return [...evs, ...pls].sort((a, b) => a.s - b.s || (a.kind === 'event' ? -1 : 1));
}

// Créneaux libres (30 min et plus) entre « from » et 23h.
function freeGaps(items, from, to = DAY_WINDOW_END) {
  const gaps = [];
  let cur = from;
  for (const { s, e } of [...items].sort((a, b) => a.s - b.s)) {
    if (cur >= to) break;
    if (e <= cur) continue;
    if (s - cur >= 30) gaps.push({ s: cur, e: Math.min(s, to) });
    cur = Math.max(cur, e);
  }
  if (to - cur >= 30) gaps.push({ s: cur, e: to });
  return gaps.filter((g) => g.e - g.s >= 30);
}

function nextFreeSlot(day) {
  const from = Math.max(VIEW_START, Math.ceil(nowMin() / 15) * 15);
  const gap = freeGaps(dayAgenda(day), from)[0];
  return gap ? { s: gap.s, dur: Math.min(PLAN_DUR, gap.e - gap.s) } : null;
}

// Tout ce qui concerne aujourd'hui : agenda, tâches à faire, prioritaires, progression.
function todayModel() {
  const day = ymd(new Date());
  const d0 = dateAt(day, 0);
  const d1 = dateAt(day, DAY_MIN);
  const items = dayAgenda(day);
  const blocks = items.filter((i) => i.kind === 'plan');
  const spans = spansOn(day).filter((p) => !planDone(p)).map((p) => ({ p, t: getTask(p.taskId) }));
  const plannedIds = new Set([...blocks, ...spans].map((i) => i.t.id));
  const due = state.tasks
    .filter((t) => !t.done && t.deadline && t.deadline <= day && !plannedIds.has(t.id))
    .sort((a, b) => !!b.starred - !!a.starred || cmpDeadline(a, b) || a.createdAt - b.createdAt);
  const prio = state.tasks
    .filter((t) => !t.done && t.starred && !plannedIds.has(t.id) && !(t.deadline && t.deadline <= day))
    .sort((a, b) => cmpDeadline(a, b) || b.createdAt - a.createdAt);
  const extraDone = state.tasks.filter((t) => t.done && t.doneAt >= d0 && t.doneAt < d1 && !plannedIds.has(t.id));
  const total = blocks.length + due.length + extraDone.length;
  const doneN = blocks.filter((i) => planDone(i.p)).length + extraDone.length;
  return { day, d0, d1, items, blocks, spans, due, prio, extraDone, total, doneN };
}

// Bloc de tâche à valider (agenda, « à faire aujourd'hui », « terminé »).
// note : texte à la place de la durée (tâche sur plusieurs jours : « Jour 2 sur 3 »).
function todayCard({ t, p, dur, done, totals, note = '' }) {
  const running = !!timerOf(t.id);
  const kind = p ? 'plan' : 'task';
  const id = p ? p.id : t.id;
  const late = !p && !done && dueInfo(t.deadline);
  const spent = totals.get(t.id) || 0;
  return `<div class="swipe-wrap">
    <div class="swipe-bg" aria-hidden="true"><span class="sw-done">${ICON.check} Fait</span><span class="sw-later">Demain ↷</span></div>
    <div class="day-card${done ? ' done' : ''}${running ? ' running' : ''}" data-swipe="${kind}" data-id="${id}" style="--c:${colorOf(t.projectId)}">
      <button type="button" class="check" data-action="today-done" data-kind="${kind}" data-id="${id}" aria-label="${done ? 'Annuler la validation' : 'Valider'}">${ICON.check}</button>
      <div class="day-main" role="button" tabindex="0" data-action="${p ? 'open-plan' : 'open-task'}" data-id="${id}">
        <div class="day-title">${t.starred ? `<span class="day-star">${ICON.star}</span>` : ''}${esc(t.title)}</div>
        <div class="day-meta">
          ${t.projectId ? `<span class="tag"><i></i>${esc(pathLabel(t.projectId, t.subprojectId))}</span>` : ''}
          ${p ? `<span>${note ? esc(note) : `${p.series ? '↻ ' : ''}${fmtDur(dur * 60e3)}`}</span>` : ''}
          ${late && late.cls === 'late' ? `<span class="due late">${esc(late.text)}</span>` : ''}
          ${spent || running ? `<span class="spent">${ICON.clock}${liveDur(spent, sinceOf(t.id))}</span>` : ''}
        </div>
      </div>
      ${done ? '' : `${p ? '' : `<button type="button" class="mini-btn" data-action="today-fit" data-id="${t.id}" title="Caler dans le prochain créneau libre" aria-label="Caler dans le prochain créneau libre">${ICON.cal}</button>`}
      ${note ? '' : `<button type="button" class="mini-btn later-btn" data-action="today-later" data-kind="${kind}" data-id="${id}" title="Reporter à demain" aria-label="Reporter à demain">↷</button>`}
      <button type="button" class="play" data-action="toggle-timer" data-id="${t.id}" aria-label="${running ? 'Arrêter' : 'Lancer le chrono'}">${running ? ICON.stop : ICON.play}</button>`}
    </div>
  </div>`;
}

function viewToday() {
  const m = todayModel();
  const nm = nowMin();
  const me = getProfile(profile);
  const totals = taskTotals();
  const today = new Date();
  const allDone = m.total > 0 && m.doneN === m.total;
  const pct = m.total ? Math.round((m.doneN / m.total) * 100) : 0;

  // Temps chronométré aujourd'hui, par projet
  const per = new Map();
  for (const s of allSessions()) {
    const ms = overlap(s, m.d0, m.d1);
    if (ms) { const k = getProject(s.projectId) ? s.projectId : 'none'; per.set(k, (per.get(k) || 0) + ms); }
  }
  const perSorted = [...per.entries()].sort((a, b) => b[1] - a[1]);
  const lt = liveTotal(m.d0, m.d1);
  const mood = allDone ? '🎉' : nm < 12 * 60 ? '☀️' : nm < 18 * 60 ? '👋' : '🌙';

  const hero = `<section class="today-hero">
      <div class="hero-text">
        <p class="hero-date">${esc(cap(fmt(today, { weekday: 'long', day: 'numeric', month: 'long' })))}</p>
        <h2>${greeting()} ${esc(me.name)} ${mood}</h2>
        <p class="hero-sub">${allDone ? 'Journée bouclée, bravo !' : m.total ? `${m.total - m.doneN} à faire · ${m.doneN} ${m.doneN > 1 ? 'faites' : 'faite'}` : 'Rien de prévu pour l’instant'}</p>
      </div>
      <div class="ring${allDone ? ' full' : ''}" role="img" aria-label="${m.doneN} sur ${m.total} faites">
        <svg viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="15.9155"/><circle class="fg" cx="18" cy="18" r="15.9155" stroke-dasharray="${pct} 100"/></svg>
        <b>${m.total ? `${m.doneN}/${m.total}` : '–'}</b>
      </div>
    </section>
    <div class="card today-time">
      <div class="tt-head">${ICON.clock}${liveDur(lt.base, lt.since)} chronométrées aujourd’hui</div>
      ${perSorted.length ? `<div class="mix">${perSorted.map(([k, ms]) => `<i style="flex:${ms} 0 0;background:${colorOf(k)}"></i>`).join('')}</div>
      <div class="mix-legend">${perSorted.slice(0, 3).map(([k, ms]) => `<span style="--c:${colorOf(k)}"><i></i>${esc(getProject(k)?.name || 'Sans projet')} · ${fmtDur(ms)}</span>`).join('')}</div>` : ''}
    </div>`;

  // Carte « Maintenant » : créneau en cours, sinon le prochain
  const open = (i) => i.kind === 'plan' && !planDone(i.p);
  const current = m.items.find((i) => open(i) && i.s <= nm && nm < i.e);
  const next = m.items.find((i) => open(i) && i.s > nm);
  const busyEvent = m.items.find((i) => i.kind === 'event' && i.s <= nm && nm < i.e);
  const focus = current || next;
  let nowCard = '';
  if (focus) {
    const t = focus.t;
    const running = !!timerOf(t.id);
    const isNow = focus === current;
    const label = isNow
      ? `Maintenant · ${minLabel(focus.s)}–${minLabel(focus.e)}`
      : `Ensuite · ${minLabel(focus.s)} (dans ${fmtDur((focus.s - nm) * 60e3)})`;
    nowCard = `<section class="now-card${running ? ' running' : ''}" style="--c:${colorOf(t.projectId)}">
      <div class="now-label"><span class="pulse"></span>${label}</div>
      <div class="now-title" role="button" tabindex="0" data-action="open-plan" data-id="${focus.p.id}">${t.starred ? '★ ' : ''}${esc(t.title)}</div>
      <div class="now-meta">${esc(pathLabel(t.projectId, t.subprojectId))}${isNow ? ` · reste ${fmtDur((focus.e - nm) * 60e3)}` : busyEvent ? ` · après « ${esc(busyEvent.ev.title)} »` : ''}</div>
      ${isNow ? `<div class="now-progress"><i style="width:${Math.round(((nm - focus.s) / (focus.e - focus.s)) * 100)}%"></i></div>` : ''}
      <div class="now-actions">
        <button type="button" class="btn ${running ? 'stop' : 'primary'} grow" data-action="toggle-timer" data-id="${t.id}">${running ? `${ICON.stop} <span${tickAttr('clock', 0, sinceOf(t.id))}>${fmtClock(elapsedSince(sinceOf(t.id)))}</span>` : `${ICON.play} ${isNow ? 'Lancer le chrono' : 'Commencer'}`}</button>
        <button type="button" class="btn grow" data-action="today-done" data-kind="plan" data-id="${focus.p.id}">${ICON.check} Fait</button>
      </div>
    </section>`;
  }

  // Programme : agenda + créneaux libres + ligne « maintenant »
  const from = Math.max(VIEW_START, Math.ceil(nm / 15) * 15);
  const rows = [...m.items, ...freeGaps(m.items, from).map((g) => ({ kind: 'gap', ...g }))]
    .sort((a, b) => a.s - b.s || (a.kind === 'gap' ? 1 : -1));
  const nowRule = `<li class="ag-now"><time>${minLabel(nm)}</time><div class="rule"></div></li>`;
  let placed = false;
  const agenda = rows.map((i) => {
    let html = '';
    const isCur = i.kind !== 'gap' && i.s <= nm && nm < i.e;
    if (!placed && (isCur || i.s > nm)) { placed = true; if (!isCur) html += nowRule; }
    if (i.kind === 'gap') {
      return `${html}<li class="ag ag-gap"><time>${minLabel(i.s)}</time><div class="gap-card" role="button" tabindex="0" data-action="gap-plan" data-min="${i.s}" data-max="${i.e - i.s}">
        <span><b>Libre</b> · ${fmtDur((i.e - i.s) * 60e3)}<small>${minLabel(i.s)} – ${minLabel(i.e)}</small></span>
        <span class="btn small">${ICON.plus} Ajouter</span></div></li>`;
    }
    const past = i.e <= nm;
    if (i.kind === 'event') {
      return `${html}<li class="ag ag-ev${past ? ' past' : ''}${isCur ? ' current' : ''}" style="--c:${i.ev.color || EVENT_COLORS[0]}"><time>${minLabel(i.s)}</time>
        <div class="ev-card" role="button" tabindex="0" data-action="open-event" data-id="${i.ev.id}"><b>${esc(i.ev.title)}</b><span>${shortLabel(i.ev.start)}–${shortLabel(i.ev.end)}</span></div></li>`;
    }
    const done = planDone(i.p);
    return `${html}<li class="ag ag-plan${past ? ' past' : ''}${isCur && !done ? ' current' : ''}" style="--c:${colorOf(i.t.projectId)}"><time>${minLabel(i.s)}</time>
      ${todayCard({ t: i.t, p: i.p, dur: i.e - i.s, done, totals })}</li>`;
  }).join('') + (placed || !rows.length ? '' : nowRule);

  const agendaHtml = `<div class="section-title"><span>Programme</span><button type="button" data-action="go-day" data-value="${m.day}">Planning ${ICON.right}</button></div>
    ${rows.length ? `<ol class="agenda">${agenda}</ol>`
      : `<div class="card empty-day"><b>Plus de créneau aujourd’hui</b><span>La suite se prépare dans le planning.</span></div>`}`;

  const spanNote = (p) => {
    const first = ymd(new Date(p.start));
    const last = ymd(new Date(p.end - 1));
    const n = Math.round((parseYmd(last) - parseYmd(first)) / 864e5) + 1;
    const k = Math.round((parseYmd(m.day) - parseYmd(first)) / 864e5) + 1;
    return n > 1 ? `Jour ${k} sur ${n} · jusqu’au ${fmt(parseYmd(last), { weekday: 'short', day: 'numeric' })}` : 'Toute la journée';
  };
  const spansHtml = m.spans.length ? `<div class="section-title"><span>Sur plusieurs jours</span></div>
    <div class="list">${m.spans.map(({ p, t }) => todayCard({ t, p, totals, note: spanNote(p) })).join('')}</div>` : '';

  const dueHtml = m.due.length ? `<div class="section-title"><span>À faire aujourd’hui · ${m.due.length}</span>${m.due.length > 1 && nextFreeSlot(m.day) ? `<button type="button" data-action="today-fit-all">✨ Tout caler</button>` : ''}</div>
    <div class="list">${m.due.map((t) => todayCard({ t, totals })).join('')}</div>` : '';

  const prioShown = temp.showAllPrio ? m.prio : m.prio.slice(0, 4);
  const prioHtml = m.prio.length ? `<div class="section-title"><span>★ Prioritaires à caser</span></div>
    <div class="card prio-list">${prioShown.map((t) => `<div class="prio-row" style="--c:${colorOf(t.projectId)}">
        <span class="dot"></span>
        <button type="button" class="prio-title" data-action="open-task" data-id="${t.id}">${esc(t.title)}<small>${esc(pathLabel(t.projectId, t.subprojectId))}</small></button>
        <button type="button" class="btn small" data-action="today-add" data-id="${t.id}">${ICON.plus} Aujourd’hui</button>
      </div>`).join('')}
      ${m.prio.length > 4 ? `<button type="button" class="prio-more" data-action="toggle-prio">${temp.showAllPrio ? 'Voir moins' : `Voir les ${m.prio.length - 4} autres`}</button>` : ''}
    </div>` : '';

  const doneItems = [
    ...m.blocks.filter((i) => planDone(i.p)).map((i) => ({ t: i.t, p: i.p, dur: i.e - i.s })),
    ...m.extraDone.map((t) => ({ t })),
  ];
  const doneHtml = doneItems.length ? `<div class="section-title"><span>Terminé aujourd’hui · ${doneItems.length}</span><button type="button" data-action="toggle-today-done">${temp.showTodayDone ? 'Masquer' : 'Afficher'}</button></div>
    ${temp.showTodayDone ? `<div class="list">${doneItems.map((x) => todayCard({ ...x, done: true, totals })).join('')}</div>` : ''}` : '';

  const tm = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const tk = ymd(tm);
  const tPlans = plansOn(tk).length + spansOn(tk).length;
  const tDue = state.tasks.filter((t) => !t.done && t.deadline === tk).length;
  const tEv = eventsOn(tm).length;
  const tomorrow = `<button type="button" class="card tomorrow" data-action="go-day" data-value="${tk}">
      <span class="tm-icon" aria-hidden="true">🌙</span>
      <span class="tm-text"><b>Demain · ${esc(fmt(tm, { weekday: 'long', day: 'numeric' }))}</b>
        <small>${[tPlans && `${tPlans} créneau${tPlans > 1 ? 'x' : ''}`, tDue && `${tDue} échéance${tDue > 1 ? 's' : ''}`, tEv && `${tEv} événement${tEv > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'Rien de prévu pour l’instant'}</small></span>
      ${ICON.right}</button>`;

  const hint = !state.ui.hideSwipeHint && (m.due.length || m.blocks.some((i) => !planDone(i.p)))
    ? `<div class="swipe-hint"><span>👆 Balaie une tâche <b>vers la droite</b> pour la valider, <b>vers la gauche</b> pour la reporter à demain.</span><button type="button" class="icon-btn" data-action="hide-swipe-hint" aria-label="Masquer l’astuce">${ICON.close}</button></div>`
    : '';

  return `${installHint()}${hero}${nowCard}${hint}${spansHtml}${agendaHtml}${dueHtml}${prioHtml}${doneHtml}${tomorrow}`;
}

/* ----- Valider, reporter, caler ----- */

function celebrate() {
  buzz();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = Object.assign(document.createElement('div'), { className: 'confetti' });
  const em = ['🎉', '✨', '🎊', '⭐', '💪', '🥳'];
  for (let i = 0; i < 24; i++) {
    const sp = Object.assign(document.createElement('span'), { textContent: em[i % em.length] });
    sp.style.setProperty('--x', `${Math.round((Math.random() * 2 - 1) * 44)}vw`);
    sp.style.setProperty('--y', `${-Math.round(25 + Math.random() * 45)}vh`);
    sp.style.setProperty('--r', `${Math.round((Math.random() * 2 - 1) * 360)}deg`);
    sp.style.animationDelay = `${Math.random() * 0.15}s`;
    box.appendChild(sp);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1700);
}

// Valider (ou dévalider) un bloc ou une tâche de la journée.
async function validateToday(kind, id) {
  const before = todayModel();
  if (kind === 'plan') {
    const p = state.plans.find((x) => x.id === id);
    const t = getTask(p?.taskId);
    if (!p || !t) return;
    if (planDone(p)) { // annuler la validation
      p.done = false;
      if (t.done) { t.done = false; t.doneAt = null; }
      save(); render();
      return;
    }
    const extra = await askPlannedTime(t, plannedToCount(t, p));
    const prev = { pDone: !!p.done, tDone: t.done, tAt: t.doneAt };
    const stopped = finishTimer(t.id);
    p.done = true;
    state.sessions.push(...extra);
    // Si la tâche a d'autres créneaux à venir, seul ce créneau est validé.
    const later = state.plans.filter((x) => x.taskId === t.id && x !== p && !x.done && x.start > now()).sort((a, b) => a.start - b.start)[0];
    if (!later) { t.done = true; t.doneAt = now(); }
    save(); render();
    doneToast(before, `${later ? `Créneau validé · suite ${planLabel(later)}` : 'Bravo, tâche terminée ✓'}${countedLabel(extra)}`, () => {
      Object.assign(p, { done: prev.pDone });
      Object.assign(t, { done: prev.tDone, doneAt: prev.tAt });
      state.sessions = state.sessions.filter((s) => !extra.includes(s));
      save(); render();
    });
    afterTimer(stopped, null);
  } else {
    const t = getTask(id);
    if (!t) return;
    if (t.done) { t.done = false; t.doneAt = null; save(); render(); return; }
    const extra = await askPlannedTime(t, plannedToCount(t));
    const stopped = finishTimer(t.id);
    t.done = true;
    t.doneAt = now();
    state.sessions.push(...extra);
    save(); render();
    doneToast(before, `Bravo, tâche terminée ✓${countedLabel(extra)}`, () => {
      t.done = false; t.doneAt = null;
      state.sessions = state.sessions.filter((s) => !extra.includes(s));
      save(); render();
    });
    afterTimer(stopped, null);
  }
}

// Tâche terminée sans temps chronométré mais planifiée : créneaux dont on peut compter le temps prévu.
// Rien si un chrono tourne (sa durée réelle passe avant). p : créneau validé dans « Ma journée »
// (pour une tâche régulière, on regarde seulement ce jour-là) ; sinon les créneaux déjà commencés (ou le prochain).
function plannedToCount(t, p) {
  if (timerOf(t.id)) return [];
  if (p) {
    if (p.allDay) return [];
    const day = ymd(new Date(p.start));
    const [a, b] = p.series ? [dateAt(day, 0), dateAt(day, DAY_MIN)] : [-Infinity, Infinity];
    return state.sessions.some((s) => s.taskId === t.id && s.end > a && s.start < b) ? [] : [p];
  }
  if (state.sessions.some((s) => s.taskId === t.id)) return [];
  const mine = state.plans.filter((x) => x.taskId === t.id && !x.allDay && !x.done).sort((x, y) => x.start - y.start);
  const started = mine.filter((x) => x.start <= now());
  return started.length ? started : mine.slice(0, 1);
}

// Demande s'il faut enregistrer le temps prévu ; renvoie les sessions à ajouter (aucune si « Non »).
// Un créneau à venir (tâche finie en avance) est compté comme se terminant maintenant.
async function askPlannedTime(t, plans) {
  if (!plans.length) return [];
  const total = plans.reduce((n, x) => n + (x.end - x.start), 0);
  const slot = (x) => `${fmt(new Date(x.start), { weekday: 'short', day: 'numeric' })} · ${hm(new Date(x.start)).replace(':', 'h')}–${hm(new Date(x.end)).replace(':', 'h')}`;
  const ok = await ask({
    title: 'Enregistrer le temps prévu ?',
    text: `Aucun temps chronométré pour « ${t.title} ». Compter ${fmtDur(total)}, la durée prévue au planning (${plans.length > 1 ? `${plans.length} créneaux` : slot(plans[0])}) ?`,
    ok: `Enregistrer ${fmtDur(total)}`,
    cancel: 'Non',
  });
  if (!ok) return [];
  const n = now();
  return plans.map((x) => {
    const [start, end] = x.start > n ? [n - (x.end - x.start), n] : [x.start, x.end];
    return { id: uid(), taskId: t.id, title: t.title, projectId: t.projectId || null, subprojectId: t.subprojectId || null, start, end };
  });
}
const countedLabel = (list) => (list.length ? ` · ${fmtDur(list.reduce((n, s) => n + (s.end - s.start), 0))} comptée${list.length > 1 ? 's' : ''}` : '');

// Un seul message (avec « Annuler ») ; s'il bouclait la journée, on fête ça.
function doneToast(before, msg, undo) {
  const after = todayModel();
  const finished = after.total && after.doneN === after.total && before.doneN < before.total;
  if (finished) celebrate();
  toast(finished ? 'Journée bouclée, bravo ! 🎉' : msg, { label: 'Annuler', fn: undo });
}

// Reporter à demain : le créneau garde la même heure ; une échéance passe à demain.
function postponeToday(kind, id) {
  const tm = new Date();
  tm.setDate(tm.getDate() + 1);
  if (kind === 'plan') {
    const p = state.plans.find((x) => x.id === id);
    if (!p) return;
    const old = { start: p.start, end: p.end };
    const shift = (v) => { const d = new Date(v); d.setDate(d.getDate() + 1); return +d; };
    Object.assign(p, { start: shift(p.start), end: shift(p.end) });
    save(); render();
    toast(p.allDay ? 'Décalé d’un jour' : `Reporté à demain ${minLabel(minOfDay(p.start, ymd(new Date(p.start))))}`, { label: 'Annuler', fn: () => { Object.assign(p, old); save(); render(); } });
  } else {
    const t = getTask(id);
    if (!t) return;
    const old = t.deadline;
    t.deadline = ymd(tm);
    save(); render();
    toast('Reporté à demain', { label: 'Annuler', fn: () => { t.deadline = old; save(); render(); } });
  }
}

/* ----- Balayer une tâche : vers la droite = valider, vers la gauche = reporter ----- */

const cs = { card: null };

function resetCardSwipe(c) {
  if (!c) return;
  c.style.transition = '';
  c.style.transform = '';
  const wrap = c.parentElement;
  if (wrap) { wrap.dataset.dir = ''; wrap.classList.remove('armed'); }
}

document.addEventListener('touchstart', (e) => {
  cs.card = null;
  if (state.ui.tab !== 'today' || !profile || e.touches.length !== 1) return;
  const card = e.target.closest('.day-card[data-swipe]');
  if (!card || card.classList.contains('done') || e.target.closest('.play, .check, .mini-btn')) return;
  Object.assign(cs, { card, x0: e.touches[0].clientX, y0: e.touches[0].clientY, lock: null, dx: 0 });
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  const c = cs.card;
  if (!c) return;
  if (e.touches.length !== 1) { resetCardSwipe(c); cs.card = null; return; }
  const dx = e.touches[0].clientX - cs.x0;
  const dy = e.touches[0].clientY - cs.y0;
  if (!cs.lock) {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) cs.lock = 'x';
    else if (Math.abs(dy) > 10) { cs.card = null; return; } // défilement vertical normal
    else return;
  }
  e.preventDefault();
  cs.dx = dx;
  c.style.transition = 'none';
  c.style.transform = `translateX(${dx}px)`;
  const wrap = c.parentElement;
  wrap.dataset.dir = dx > 0 ? 'done' : 'later';
  wrap.classList.toggle('armed', Math.abs(dx) > SWIPE_GO);
}, { passive: false });

document.addEventListener('touchend', () => {
  const c = cs.card;
  cs.card = null;
  if (!c || cs.lock !== 'x') return;
  const { dx } = cs;
  temp.suppressClick = true; // le relâchement ne doit pas ouvrir la fiche
  setTimeout(() => { temp.suppressClick = false; }, 350);
  if (Math.abs(dx) < SWIPE_GO) { resetCardSwipe(c); return; }
  c.style.transition = '';
  c.style.transform = `translateX(${dx > 0 ? 110 : -110}%)`;
  buzz();
  const { swipe: kind, id } = c.dataset;
  setTimeout(() => (dx > 0 ? validateToday(kind, id) : postponeToday(kind, id)), 200);
});
document.addEventListener('touchcancel', () => { resetCardSwipe(cs.card); cs.card = null; });

// L'écran se met à jour chaque minute (ligne « maintenant », temps restant, créneau en cours).
setInterval(() => {
  if (state.ui.tab === 'today' && profile && !document.hidden && !sheet.open && !$('#ask').open && !cs.card) render();
}, 60e3);

/* ----- Planifier une tâche depuis sa fiche : suggestions de créneaux libres + frise du jour ----- */

// Prochains créneaux libres (aujourd'hui, demain, après-demain) pour une durée donnée.
function slotSuggestions(dur = PLAN_DUR) {
  const out = [];
  for (let k = 0; k < 3; k++) {
    const d = new Date();
    d.setDate(d.getDate() + k);
    const day = ymd(d);
    const from = k === 0 ? Math.max(VIEW_START, Math.ceil(nowMin() / 15) * 15) : 8 * 60;
    const gaps = freeGaps(dayAgenda(day), from).filter((g) => g.e - g.s >= dur);
    const picks = [];
    if (gaps[0]) picks.push(gaps[0].s);
    // une 2e idée : l'après-midi (demain et après) ou le créneau libre suivant (aujourd'hui)
    const pm = k > 0 && gaps.find((g) => g.e - Math.max(g.s, 14 * 60) >= dur);
    if (pm) picks.push(Math.max(pm.s, 14 * 60));
    else if (gaps[1]) picks.push(gaps[1].s);
    for (const min of [...new Set(picks)].slice(0, k === 2 ? 1 : 2)) out.push({ day, min, k });
  }
  return out.slice(0, 5);
}

const dayWord = (day) => {
  const diff = Math.round((parseYmd(day) - startOfDay(new Date())) / 864e5);
  return diff === 0 ? 'Aujourd’hui' : diff === 1 ? 'Demain' : cap(fmt(parseYmd(day), { weekday: 'short' }).replace('.', ''));
};

// Bloc « Planifier dans l'agenda » de la fiche d'une tâche (taskId : tâche existante).
function ppSection(taskId) {
  const upcoming = taskId ? state.plans.filter((p) => p.taskId === taskId && !p.done && p.end > now()).sort((a, b) => a.start - b.start) : [];
  const seen = new Set(); // une série n'affiche que son prochain créneau
  return `<section class="pp" data-on="0">
    <div class="pp-head"><span>${ICON.cal} ${taskId ? 'Créneaux dans l’agenda' : 'Planifier dans l’agenda'}</span>
      <button type="button" class="pp-off" data-action="pp-off" aria-label="Ne pas planifier">${ICON.close}</button></div>
    ${upcoming.length ? `<div class="pp-list">${upcoming.filter((p) => !p.series || (!seen.has(p.series) && seen.add(p.series))).map((p) => {
      const d = new Date(p.start);
      const left = p.series ? upcoming.filter((x) => x.series === p.series).length : 0;
      const label = p.allDay ? planLabel(p) : `${dayWord(ymd(d))} · ${minLabel(d.getHours() * 60 + d.getMinutes())}–${hm(new Date(p.end)).replace(':', 'h')}`;
      return `<span class="pp-plan"><button type="button" data-action="open-plan" data-id="${p.id}">${label}${left > 1 ? ` · ↻ ${left}` : ''}</button>
        <button type="button" class="pp-x" data-action="pp-remove" data-id="${p.id}" data-task="${taskId}" aria-label="Retirer ce créneau">${ICON.close}</button></span>`;
    }).join('')}</div>` : ''}
    <div class="pp-sugg">${slotSuggestions().map((s) => `<button type="button" class="pp-chip" data-action="pp-pick" data-day="${s.day}" data-min="${s.min}">
        <small>${dayWord(s.day)}</small><b>${minLabel(s.min)}</b></button>`).join('')}
      <button type="button" class="pp-chip other" data-action="pp-other"><small>Autre</small><b>📆 jour</b></button></div>
    <div class="pp-detail">
      <div class="row2">
        <label class="field"><span>Jour</span><input type="date" name="plan_date"></label>
        <label class="field pp-time"><span>Début</span><input type="time" name="plan_time" step="300"></label>
      </div>
      ${whenFields(ymd(new Date()), [30, 60, 90, 120], PLAN_DUR)}
      <div class="pp-bar"></div>
      ${taskId ? `<button type="button" class="btn primary wide pp-add" data-action="pp-add" data-id="${taskId}">${ICON.plus} Ajouter ce créneau</button>` : ''}
    </div>
  </section>`;
}

function ppValues(pp) {
  const day = pp.querySelector('[name="plan_date"]').value;
  const when = whenValues(pp.querySelector('.when'), day || ymd(new Date()));
  return {
    day, when, dur: when.dur,
    min: toMin(pp.querySelector('[name="plan_time"]').value),
    hasTime: !!pp.querySelector('[name="plan_time"]').value,
  };
}

// Frise du jour choisi (6h → 24h) : occupé en couleur, créneau choisi entouré, alerte s'il chevauche.
function ppBar(pp) {
  const v = ppValues(pp);
  if (!v.day || !v.hasTime) return '';
  const items = dayAgenda(v.day);
  const pos = (m) => (((Math.max(VIEW_START, Math.min(DAY_MIN, m)) - VIEW_START) / VIEW_SPAN) * 100).toFixed(2);
  const s = v.min;
  const e = Math.min(DAY_MIN, s + v.dur);
  const clash = items.find((i) => i.s < e && i.e > s);
  return `<div class="ppb-track" data-action="pp-bar" title="Touche la frise pour choisir l’heure">
      ${items.map((i) => `<i class="${i.kind}" style="left:${pos(i.s)}%;width:${(pos(i.e) - pos(i.s)).toFixed(2)}%;--c:${i.kind === 'event' ? i.ev.color || EVENT_COLORS[0] : colorOf(i.t.projectId)}"></i>`).join('')}
      <b class="ppb-sel${clash ? ' clash' : ''}" style="left:${pos(s)}%;width:${Math.max(1.2, pos(e) - pos(s)).toFixed(2)}%"></b>
    </div>
    <div class="ppb-scale"><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
    <p class="ppb-sum${clash ? ' clash' : ''}">${clash
      ? `⚠︎ Chevauche « ${esc(clash.kind === 'event' ? clash.ev.title : clash.t.title)} »`
      : `${esc(cap(fmt(parseYmd(v.day), { weekday: 'long', day: 'numeric', month: 'long' })))} · ${minLabel(s)} → ${minLabel(e)}`}</p>`;
}

// Met à jour la frise, la suggestion surlignée et le libellé du bouton « Créer ».
function ppRefresh(pp) {
  const v = ppValues(pp);
  whenRefresh(pp.querySelector('.when'), v.day || ymd(new Date()));
  pp.classList.toggle('multi', v.when.multi); // plusieurs jours : pas d'heure ni de frise
  pp.querySelector('.pp-bar').innerHTML = v.when.multi ? '' : ppBar(pp);
  let matched = false;
  for (const c of pp.querySelectorAll('.pp-chip[data-day]')) {
    const on = pp.dataset.on === '1' && c.dataset.day === v.day && Number(c.dataset.min) === v.min && v.hasTime;
    c.classList.toggle('on', on);
    matched ||= on;
  }
  pp.querySelector('.pp-chip.other').classList.toggle('on', pp.dataset.on === '1' && !matched);
  const create = pp.closest('form')?.querySelector('button[value="create"]');
  if (create) create.textContent = pp.dataset.on === '1' ? 'Créer et planifier' : 'Créer';
}

function ppOpen(pp, day, min) {
  pp.dataset.on = '1';
  pp.querySelector('[name="plan_date"]').value = day;
  pp.querySelector('[name="plan_time"]').value = hhmm(min);
  ppRefresh(pp);
}

sheet.addEventListener('change', (e) => { const pp = e.target.closest('.pp'); if (pp) ppRefresh(pp); });
sheet.addEventListener('input', (e) => { const pp = e.target.closest('.pp'); if (pp && e.target.type !== 'radio') ppRefresh(pp); });

/* ---------- Actions ---------- */

const actions = {
  'plan-view'(el) { state.ui.planView = el.dataset.value; writeLocal(); render(); scrollPlanToHour(); },
  'plan-day'(el) {
    // En semaine : toucher un jour l'ouvre en vue Jour. En vue Jour : change de jour.
    Object.assign(state.ui, { planDate: el.dataset.value, planView: 'day' });
    writeLocal(); render();
  },
  'plan-move'(el) {
    const step = Number(el.dataset.value);
    changePeriod(step, step > 0 ? 'right' : 'left');
  },
  'plan-today'() { state.ui.planDate = ymd(new Date()); writeLocal(); render(); scrollPlanToHour(); },
  'pick-tray'(el) {
    const id = el.dataset.dragTask;
    temp.placing = temp.placing === id ? null : id;
    if (temp.placing) closeSideOnPhone();
    document.body.classList.toggle('placing', !!temp.placing);
    render();
  },
  'dock-toggle'() {
    if (temp.skipGrabClick) return;
    state.ui.dockOpen = !state.ui.dockOpen;
    temp.catMenu = false;
    writeLocal(); render();
  },
  'cat-menu'() { temp.catMenu = !temp.catMenu; render(); },
  'side-cat'(el) {
    Object.assign(temp, { projMenu: false, catMenu: false });
    state.ui.sideCat = el.dataset.value;
    writeLocal(); render();
    $('.side-list')?.scrollTo(0, 0);
    $('.side-strip')?.scrollTo(0, 0);
  },
  'proj-menu'() { temp.projMenu = !temp.projMenu; render(); },
  emoji(el) { el.closest('.emoji-field').querySelector('.ac')?.remove(); toggleEmojiPanel(el.closest('.emoji-field')); },
  // Pastille de projet suggéré : la choisir ; toucher celle que l'app a présélectionnée la retire.
  'sug-pick'(el) {
    const form = el.closest('form');
    const st = sugForms.get(form);
    if (!st) return;
    if (el.classList.contains('on')) {
      if (st.mode === 'auto') sugApply(form, st.def, 'declined');
    } else sugApply(form, { pid: el.dataset.p, sid: el.dataset.s }, 'manual');
    sugRender(form);
  },
  // Titre déjà utilisé : reprend aussi son projet et son sous-projet.
  'sug-title'(el) {
    const form = el.closest('form');
    const st = sugForms.get(form);
    const g = st && (el.dataset.from === 'recent' ? st.recent : st.titles)[Number(el.dataset.i)];
    if (!g) return;
    const input = form.elements.title;
    input.value = g.title;
    if (!st.lock.s && st.ix.byP.has(g.pid) && (!st.lock.p || g.pid === st.lock.p)) sugApply(form, g, 'manual');
    sugList(form, false);
    suggestRefresh(form, false);
    if (matchMedia('(pointer: fine)').matches) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  },
  'emoji-tab'(el) { const panel = el.closest('.emoji-panel'); $('.emoji-search', panel).value = ''; fillEmojiPanel(panel, el.dataset.value); },
  'emoji-pick'(el) { pickEmoji(el); },
  'emoji-close'(el) { el.closest('.emoji-panel')?.remove(); },
  'cancel-placing'() { temp.placing = null; document.body.classList.remove('placing'); render(); },
  slot(el, e) {
    if (placeHere(el, e)) return;
    openSlotSheet(el.dataset.day, slotAt(el, e.clientY));
  },
  'open-plan'(el, e) { if (!placeHere(el, e)) openPlanSheet(el.dataset.id); },
  'open-event'(el, e) { if (!placeHere(el, e)) openEventSheet(el.dataset.id); },
  'plan-here'(el) { // même durée / répétition que celles réglées pour une nouvelle tâche
    const box = $('#sheet .when');
    const w = whenValues(box, el.dataset.day);
    if (whenInvalid(box, w)) return;
    closeSheet();
    planWith(el.dataset.id, el.dataset.day, Number(el.dataset.min), w);
  },
  'rep-step'(el) {
    const input = el.closest('.when').querySelector('[name="rep_weeks"]');
    input.value = Math.max(1, Math.min(52, (Number(input.value) || 1) + Number(el.dataset.value)));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },
  'series-apply'(el) { // l'horaire de ce créneau pour toute la suite de la série
    const p = state.plans.find((x) => x.id === el.dataset.id);
    if (!p) return;
    const day = ymd(new Date(p.start));
    const s = minOfDay(p.start, day);
    const e = minOfDay(p.end, day) || DAY_MIN;
    const after = state.plans.filter((x) => x.series && x.series === p.series && x.start > p.start);
    const old = after.map((x) => ({ x, start: x.start, end: x.end }));
    for (const x of after) { const d = ymd(new Date(x.start)); Object.assign(x, { start: dateAt(d, s), end: dateAt(d, e) }); }
    save(); closeSheet(); render();
    toast(`${minLabel(s)} → ${minLabel(e)} pour les ${after.length} suivants`, { label: 'Annuler', fn: () => { old.forEach((o) => Object.assign(o.x, { start: o.start, end: o.end })); save(); render(); } });
  },
  'delete-series'(el) {
    const p = state.plans.find((x) => x.id === el.dataset.id);
    if (!p) return;
    const gone = state.plans.filter((x) => x.series && x.series === p.series && x.start >= p.start);
    const ids = new Set(gone.map((x) => x.id));
    state.plans = state.plans.filter((x) => !ids.has(x.id));
    save(); closeSheet(); render();
    toast(`${gone.length} créneaux retirés`, { label: 'Annuler', fn: () => { state.plans.push(...gone); save(); render(); } });
  },
  'delete-plan'(el) {
    const old = state.plans.find((x) => x.id === el.dataset.id);
    if (!old) return;
    state.plans = state.plans.filter((x) => x !== old);
    save(); closeSheet(); render();
    toast('Retirée du planning', { label: 'Annuler', fn: () => { state.plans.push(old); save(); render(); } });
  },
  async 'delete-event'(el) {
    const ev = state.events.find((x) => x.id === el.dataset.id);
    if (!ev) return;
    const ok = await ask({ title: `Supprimer « ${ev.title} » ?`, text: ev.date ? 'Cet événement sera retiré du planning.' : 'Il sera retiré de toutes les semaines.', ok: 'Supprimer', danger: true });
    if (!ok) return;
    state.events = state.events.filter((x) => x !== ev);
    save(); closeSheet(); render();
  },
  tab(el) {
    state.ui.tab = el.dataset.value;
    Object.assign(temp, { openProject: null, placing: null });
    writeLocal(); render(); window.scrollTo(0, 0);
    if (state.ui.tab === 'plan') scrollPlanToHour();
  },
  'go-stats'() { Object.assign(state.ui, { tab: 'stats', period: 'day', offset: 0 }); writeLocal(); render(); window.scrollTo(0, 0); },
  filter(el) { Object.assign(state.ui, { filter: el.dataset.value, subfilter: 'all' }); writeLocal(); render(); },
  subfilter(el) { state.ui.subfilter = el.dataset.value; writeLocal(); render(); },

  'toggle-timer'(el) {
    const id = el.dataset.id;
    const inSheet = !!el.closest('form[data-form="task"]');
    if (el.closest('form[data-form="plan"]')) closeSheet(); // depuis un créneau du planning : on referme
    const f = taskFormOpen();
    if (f?.dataset.id) commitTaskForm(f);
    if (timerOf(id)) afterTimer(stopTimer(id), inSheet ? id : null);
    else { startTimer(id); if (inSheet) openTaskSheet(id); }
  },
  stop(el) { afterTimer(stopTimer(el.dataset.id), null); },
  'toggle-star'(el) {
    const t = getTask(el.dataset.id);
    if (!t) return;
    t.starred = !t.starred;
    save(); render(); buzz();
  },
  'pick-profile'(el) { selectProfile(el.dataset.value); },
  'switch-profile'() { leaveProfile(); },

  async 'toggle-done'(el) {
    const t = getTask(el.dataset.id);
    if (!t) return;
    const inSheet = !!el.closest('#sheet');
    if (inSheet) closeSheet(); // enregistre aussi les modifications du formulaire
    const extra = t.done ? [] : await askPlannedTime(t, plannedToCount(t));
    const done = t.done ? null : finishTimer(t.id);
    t.done = !t.done;
    t.doneAt = t.done ? now() : null;
    state.sessions.push(...extra);
    save(); render(); buzz();
    if (t.done) {
      toast(`Tâche terminée${countedLabel(extra)}`, { label: 'Annuler', fn: () => {
        t.done = false; t.doneAt = null;
        state.sessions = state.sessions.filter((s) => !extra.includes(s));
        save(); render();
      } });
    }
    afterTimer(done, null);
  },
  'open-task'(el) { openTaskSheet(el.dataset.id); },
  'new-task'(el) {
    // Depuis la page d'un projet : la tâche est déjà rangée dans ce projet (et ce sous-projet).
    // Depuis « Aujourd'hui » : la tâche est pour aujourd'hui.
    const projectId = el.dataset.project || temp.openProject;
    if (projectId) openTaskSheet(null, { projectId, subprojectId: el.dataset.sub || null });
    else openTaskSheet(null, state.ui.tab === 'today' ? { deadline: ymd(new Date()) } : undefined);
  },
  'today-done'(el) {
    const { kind, id } = el.dataset;
    const card = el.closest('.day-card');
    const already = kind === 'plan' ? planDone(state.plans.find((x) => x.id === id) || {}) : !!getTask(id)?.done;
    if (card && !already) { // petite animation avant de passer la tâche en « fait »
      card.classList.add('validating');
      buzz();
      setTimeout(() => validateToday(kind, id), 380);
    } else validateToday(kind, id);
  },
  'today-later'(el) { postponeToday(el.dataset.kind, el.dataset.id); },
  'pf-open'(el) {
    const field = el.closest('.pick-field');
    const open = field.querySelector('.pf-menu');
    $$('.pf-menu').forEach((m) => m.remove());
    if (!open) field.insertAdjacentHTML('beforeend', pfMenu(el.closest('form'), el.dataset.field));
  },
  async 'pf-choose'(el) {
    const form = el.closest('form');
    const { field } = el.dataset;
    let val = el.dataset.value;
    el.closest('.pf-menu').remove();
    if (field === 'project') {
      if (val === '__new') {
        const name = await ask({ title: 'Nouveau projet', input: true, placeholder: 'Nom du projet', ok: 'Créer', emoji: true });
        if (!name) return;
        val = addProject(name).id;
        save();
      }
      if (val !== form.elements.projectId.value) form.elements.subprojectId.value = '';
      form.elements.projectId.value = val;
    } else {
      if (val === '__new') {
        const pid = form.elements.projectId.value;
        const name = await ask({ title: 'Nouveau sous-projet', text: `Dans « ${getProject(pid)?.name || ''} »`, input: true, placeholder: 'Nom du sous-projet', ok: 'Créer', emoji: true });
        if (!name) return;
        val = addSub(pid, name).id;
        save();
      }
      form.elements.subprojectId.value = val;
    }
    pfRefresh(form);
    sugManual(form);
    if (form.dataset.id && form.isConnected) { commitTaskForm(form); render(); }
  },
  'clean-projects'() {
    const list = unusedProjects();
    if (!list.length) return;
    openSheet(`<form class="sheet-body" data-form="clean">
      ${head('Projets inutilisés')}
      <p class="hint" style="margin-top:0">Ces projets n’ont ni tâche ni temps enregistré. Décoche ceux que tu veux garder.</p>
      <div class="card clean-list">${list.map((p) => `<label class="clean-row" style="--c:${p.color}"><input type="checkbox" name="drop" value="${p.id}" checked>
        <span class="dot"></span><span>${esc(p.name)}${subsOf(p.id).length ? `<small>${esc(subsOf(p.id).map((x) => x.name).join(' · '))}</small>` : ''}</span></label>`).join('')}</div>
      <div class="sheet-actions"><button class="btn danger solid grow">${ICON.trash} Supprimer la sélection</button></div>
    </form>`);
  },
  'pp-pick'(el) { ppOpen(el.closest('.pp'), el.dataset.day, Number(el.dataset.min)); },
  'pp-other'(el) {
    const pp = el.closest('.pp');
    const v = ppValues(pp);
    const tm = new Date();
    tm.setDate(tm.getDate() + 1);
    ppOpen(pp, v.day || ymd(tm), v.hasTime ? v.min : 9 * 60);
    pp.dataset.on = '1';
    ppRefresh(pp);
    if (matchMedia('(pointer: fine)').matches) pp.querySelector('[name="plan_date"]').focus();
  },
  'pp-off'(el) { const pp = el.closest('.pp'); pp.dataset.on = '0'; ppRefresh(pp); },
  'pp-bar'(el, e) {
    const pp = el.closest('.pp');
    const r = el.getBoundingClientRect();
    const v = ppValues(pp);
    let m = VIEW_START + ((e.clientX - r.left) / r.width) * VIEW_SPAN;
    m = Math.max(VIEW_START, Math.min(DAY_MIN - v.dur, Math.round(m / 15) * 15));
    pp.querySelector('[name="plan_time"]').value = hhmm(m);
    ppRefresh(pp);
  },
  'pp-add'(el) {
    const pp = el.closest('.pp');
    const v = ppValues(pp);
    if (!v.day || !(v.hasTime || v.when.multi) || whenInvalid(pp.querySelector('.when'), v.when)) return;
    const f = taskFormOpen();
    if (f?.dataset.id) commitTaskForm(f);
    addPlans(el.dataset.id, v.day, v.min, v.when);
    save(); render(); buzz();
    openTaskSheet(el.dataset.id); // la fiche affiche le nouveau créneau
  },
  'pp-remove'(el) {
    const old = state.plans.find((p) => p.id === el.dataset.id);
    if (!old) return;
    const f = taskFormOpen();
    if (f?.dataset.id) commitTaskForm(f);
    state.plans = state.plans.filter((p) => p !== old);
    save(); render();
    openTaskSheet(el.dataset.task);
    toast('Créneau retiré', { label: 'Annuler', fn: () => { state.plans.push(old); save(); render(); if (sheet.open) openTaskSheet(old.taskId); } });
  },

  'today-fit'(el) {
    const day = ymd(new Date());
    const slot = nextFreeSlot(day);
    if (!slot) { toast('Plus de créneau libre aujourd’hui (jusqu’à 23h)'); return; }
    createPlan(el.dataset.id, day, slot.s, slot.dur);
  },
  'today-fit-all'() {
    const day = ymd(new Date());
    const created = [];
    for (const t of todayModel().due) {
      const slot = nextFreeSlot(day);
      if (!slot) break;
      const p = { id: uid(), taskId: t.id, start: dateAt(day, slot.s), end: dateAt(day, slot.s + slot.dur) };
      state.plans.push(p);
      created.push(p);
    }
    if (!created.length) { toast('Plus de créneau libre aujourd’hui (jusqu’à 23h)'); return; }
    save(); render(); buzz();
    const ids = new Set(created.map((p) => p.id));
    toast(`${created.length} tâche${created.length > 1 ? 's calées' : ' calée'} dans ta journée`, {
      label: 'Annuler', fn: () => { state.plans = state.plans.filter((p) => !ids.has(p.id)); save(); render(); },
    });
  },
  'today-add'(el) {
    const t = getTask(el.dataset.id);
    if (!t) return;
    const old = t.deadline;
    t.deadline = ymd(new Date());
    save(); render(); buzz();
    toast('Ajoutée à ta journée', { label: 'Annuler', fn: () => { t.deadline = old; save(); render(); } });
  },
  'gap-plan'(el) { openSlotSheet(ymd(new Date()), Number(el.dataset.min), Number(el.dataset.max) || undefined); },
  'go-day'(el) {
    Object.assign(state.ui, { tab: 'plan', planView: 'day', planDate: el.dataset.value });
    writeLocal(); render(); window.scrollTo(0, 0); scrollPlanToHour();
  },
  'toggle-today-done'() { temp.showTodayDone = !temp.showTodayDone; render(); },
  'toggle-prio'() { temp.showAllPrio = !temp.showAllPrio; render(); },
  'hide-swipe-hint'() { state.ui.hideSwipeHint = true; writeLocal(); render(); },
  'set-deadline'(el) {
    const input = el.closest('form').elements.deadline;
    if (el.dataset.value === '') input.value = '';
    else { const d = new Date(); d.setDate(d.getDate() + Number(el.dataset.value)); input.value = ymd(d); }
    input.dispatchEvent(new Event('change', { bubbles: true })); // enregistre aussitôt une tâche existante
  },

  async 'delete-task'(el) {
    const t = getTask(el.dataset.id);
    if (!t) return;
    const ok = await ask({ title: 'Supprimer cette tâche ?', text: 'Le temps déjà passé reste comptabilisé dans les statistiques.', ok: 'Supprimer', danger: true });
    if (!ok) return;
    finishTimer(t.id);
    state.tasks = state.tasks.filter((x) => x !== t);
    dropOrphanPlans();
    save(); closeSheet(); render(); toast('Tâche supprimée');
  },
  'toggle-done-list'() { state.ui.showDone = !state.ui.showDone; writeLocal(); render(); },
  async 'clear-done'() {
    const n = state.tasks.filter((t) => t.done).length;
    const ok = await ask({ title: `Effacer ${n} tâche(s) terminée(s) ?`, text: 'Le temps passé reste dans les statistiques.', ok: 'Effacer', danger: true });
    if (!ok) return;
    state.tasks = state.tasks.filter((t) => !t.done);
    dropOrphanPlans();
    save(); render();
  },
  'close-sheet'() { closeSheet(); },

  'open-project'(el) {
    temp.openProject = el.dataset.id;
    temp.showProjectDone = false;
    history.pushState({ project: el.dataset.id }, '');
    render();
    window.scrollTo(0, 0);
  },
  'close-project'() {
    if (history.state?.project) history.back(); // le popstate referme la page
    else { temp.openProject = null; render(); }
  },
  'edit-project'(el) { openProjectSheet(el.dataset.id); },
  'toggle-project-done'() { temp.showProjectDone = !temp.showProjectDone; render(); },
  async 'convert-project'(el) {
    const p = getProject(el.dataset.id);
    const form = el.closest('form');
    const target = getProject(form.elements.moveTo.value);
    if (!p) return;
    if (!target) { form.elements.moveTo.focus(); toast('Choisis d’abord le projet de destination'); return; }
    const name = form.elements.name.value.trim() || p.name;
    const subs = subsOf(p.id);
    const n = state.tasks.filter((t) => t.projectId === p.id).length;
    const ok = await ask({
      title: `Ranger « ${name} » dans « ${target.name} » ?`,
      text: `${n} tâche(s) et leur temps passeront dans « ${target.name} › ${name} ».${subs.length ? ` Ses sous-projets (${subs.map((s) => s.name).join(', ')}) y seront regroupés.` : ''}`,
      ok: 'Transformer',
    });
    if (!ok) return;
    convertProject(p.id, target.id, name);
    save(); closeSheet(); render();
    toast(`« ${name} » est maintenant un sous-projet de « ${target.name} »`);
  },
  'new-project'() { openProjectSheet(null); },
  'add-sub'(el) {
    const box = $('.subs', el.closest('.field'));
    box.insertAdjacentHTML('beforeend', subRow(`sub:new${uid()}`, ''));
    $('input', box.lastElementChild).focus();
  },
  async 'remove-sub-row'(el) {
    const row = el.closest('.sub-row');
    const sid = $('input', row).name.slice(4);
    if (!sid.startsWith('new')) {
      const n = state.tasks.filter((t) => t.subprojectId === sid).length;
      const ok = await ask({
        title: 'Supprimer ce sous-projet ?',
        text: `${n ? `${n} tâche(s) resteront dans le projet, sans sous-projet. ` : ''}Le temps passé reste compté dans le projet. (Appliqué à l’enregistrement.)`,
        ok: 'Supprimer', danger: true,
      });
      if (!ok) return;
      row.insertAdjacentHTML('afterend', `<input type="hidden" name="del" value="${esc(sid)}">`);
    }
    row.remove();
  },
  async 'delete-project'(el) {
    const p = getProject(el.dataset.id);
    if (!p) return;
    const n = state.tasks.filter((t) => t.projectId === p.id).length;
    const ok = await ask({
      title: `Supprimer « ${p.name} » ?`,
      text: `${n ? `${n} tâche(s) passeront en « Sans projet ». ` : ''}Le temps passé reste dans les stats, sans projet. Pour simplement le masquer, utilise plutôt « Archiver ».`,
      ok: 'Supprimer', danger: true,
    });
    if (!ok) return;
    deleteProject(p.id);
    save(); closeSheet(); render();
  },

  'open-session'(el) {
    const f = taskFormOpen();
    if (f?.dataset.id) commitTaskForm(f);
    openSessionSheet(el.dataset.id, { back: el.dataset.back });
  },
  'add-session'(el) {
    const f = taskFormOpen();
    if (f?.dataset.id) commitTaskForm(f);
    openSessionSheet(null, { taskId: el.dataset.id, back: el.dataset.id });
  },
  async 'delete-session'(el) {
    const back = el.closest('form').dataset.back;
    const ok = await ask({ title: 'Supprimer cette session ?', text: 'Ce temps sera retiré des statistiques.', ok: 'Supprimer', danger: true });
    if (!ok) return;
    state.sessions = state.sessions.filter((s) => s.id !== el.dataset.id);
    save();
    afterSessionSheet(back);
  },

  period(el) { Object.assign(state.ui, { period: el.dataset.value, offset: 0 }); temp.statsOpen.clear(); writeLocal(); render(); },
  offset(el) {
    const v = Number(el.dataset.value);
    state.ui.offset = v === 0 ? 0 : Math.min(0, state.ui.offset + v);
    writeLocal(); render();
  },
  'stats-toggle'(el) {
    const k = el.dataset.id;
    if (temp.statsOpen.has(k)) temp.statsOpen.delete(k); else temp.statsOpen.add(k);
    render();
  },

  'open-settings'() { openSettings(); },
  async install() {
    if (!temp.installEvt) { openSettings(); return; }
    const evt = temp.installEvt;
    closeSheet();
    evt.prompt();
    await evt.userChoice.catch(() => {});
    temp.installEvt = null;
    render();
  },
  'hide-install'() { state.ui.hideInstall = true; writeLocal(); render(); },
  'export-json'() { exportJson(); },
  'import-json'() { importJson(); },
  'export-csv'() { exportCsv(); },
  'reset-all'() { resetAll(); },
  'sync-enable'() { enableSync(); },
  async 'sync-badge'() {
    if (!syncConf.code) {
      openSettings();
      setTimeout(() => $('#sync-box')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
      return;
    }
    await syncNow();
    const err = syncConf.error;
    toast(!err ? 'Synchronisé ✓' : err === 'offline' ? 'Hors ligne : la synchro reprendra au retour du réseau' : `Problème de synchro : ${err}`);
  },
  'sync-join'() { joinSync(); },
  'sync-off'() { disableSync(); },
  'sync-copy'() { copyCode(); },
  'sync-reveal'() { temp.showCode = !temp.showCode; refreshSyncUi(); },
  async 'sync-now'(el) {
    el.disabled = true;
    el.textContent = 'Synchronisation…';
    await syncNow();
    if (!syncConf.error) toast('Synchronisé ✓');
    refreshSyncUi();
  },
};

document.addEventListener('click', (e) => {
  const pf = $('.pf-menu');
  if (pf && !e.target.closest('.pf-menu, [data-action="pf-open"]')) pf.remove();
  if (temp.projMenu && !e.target.closest('.proj-pick')) { temp.projMenu = false; $('.proj-menu')?.remove(); $('.side-proj')?.classList.remove('open'); }
  if (temp.catMenu && !e.target.closest('.strip-cat, .cat-menu')) { temp.catMenu = false; $('.cat-menu')?.remove(); $('.strip-cat')?.classList.remove('open'); }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) {
    e.preventDefault();
    e.target.click();
  }
});

/* ---------- Démarrage ---------- */

history.replaceState(null, '');
render();
setInterval(() => { if (state.timers.length && !document.hidden) tick(); }, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { render(); syncNow(); }
  else if (state.ui.syncDirty) syncNow({ keepalive: true }); // envoie les dernières modifications avant que l'app passe en arrière-plan
});

// Synchro entre appareils : au démarrage, au retour du réseau et régulièrement quand l'app est ouverte.
syncNow();
window.addEventListener('online', () => syncNow());
setInterval(() => { if (!document.hidden) syncNow(); }, SYNC_EVERY);

// Synchronise si l'app est ouverte dans deux onglets.
window.addEventListener('storage', (e) => {
  if (e.key === SYNC_KEY) { syncConf = loadSyncConf(); refreshSyncUi(); return; }
  if (!profile) { if (e.key?.startsWith(STORE_KEY)) render(); return; }
  if (e.key !== storeKey(profile) || !e.newValue) return;
  try { state = normalize(JSON.parse(e.newValue)); snapshot(); render(); } catch (_) { /* ignoré */ }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  temp.installEvt = e;
  render();
});
window.addEventListener('appinstalled', () => { temp.installEvt = null; render(); toast('App installée ✓'); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
if (isStandalone()) persistStorage();
