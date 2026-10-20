'use strict';

/* =========================================================
   Chrono Todo — todo + chronomètre par tâche
   Données stockées sur l'appareil (localStorage). Synchro facultative
   entre appareils : données chiffrées dans l'app avant l'envoi (worker.js).
   ========================================================= */

const VERSION = '1.5.0';
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
    active: null,    // { taskId, start }
    deleted: {},     // id supprimé (ou "timer:…" pour un chrono arrêté) → date, pour la synchro
    ui: {
      tab: 'tasks', filter: 'all', subfilter: 'all', showDone: false,
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
  s.active = data.active && data.active.taskId && data.active.start ? data.active : null;
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
  shadow = { items, timer: timerKey(state.active) };
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
  const timer = timerKey(state.active);
  if (timer !== shadow.timer) {
    if (shadow.timer) state.deleted[shadow.timer] = t; // chrono arrêté ou remplacé
    shadow.timer = timer;
    changed = true;
  }
  return changed;
}

// À appeler après chaque modification des données.
function save() {
  if (stamp()) {
    state.ui.pristine = false;
    if (syncConf.code) { state.ui.syncDirty = true; scheduleSync(); }
  }
  writeLocal();
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

const activeElapsed = () => (state.active ? Math.max(0, now() - state.active.start) : 0);
const overlap = (s, a, b) => Math.max(0, Math.min(s.end, b) - Math.max(s.start, a));

function taskTotals() {
  const m = new Map();
  for (const s of state.sessions) if (s.taskId) m.set(s.taskId, (m.get(s.taskId) || 0) + (s.end - s.start));
  return m;
}

// Sessions enregistrées + la session en cours (pour les stats).
function allSessions() {
  const list = state.sessions.slice();
  const a = state.active;
  if (a) {
    const t = getTask(a.taskId);
    list.push({ id: 'live', taskId: a.taskId, title: t?.title, projectId: t?.projectId, subprojectId: t?.subprojectId, start: a.start, end: now() });
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

// Arrête le chrono en cours et l'enregistre dans le journal. Renvoie la session créée.
function finishActive() {
  const a = state.active;
  if (!a) return null;
  state.active = null;
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

// Un seul chrono à la fois : lancer une tâche arrête la précédente.
function startTimer(taskId) {
  if (state.active?.taskId === taskId) return null;
  const done = finishActive();
  state.active = { taskId, start: now() };
  const t = getTask(taskId);
  if (t?.done) { t.done = false; t.doneAt = null; }
  save(); render(); buzz(); persistStorage();
  return done;
}

function stopTimer() {
  const done = finishActive();
  save(); render(); buzz();
  return done;
}

// Après un arrêt : si la session est très longue, on propose de la corriger.
function afterTimer(done, reopenTaskId) {
  if (done && done.end - done.start > LONG_SESSION) openSessionSheet(done.id, { warn: true, back: reopenTaskId });
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
      const info = s?.active ? '⏱ chrono en cours' : open ? `${open} tâche${open > 1 ? 's' : ''} à faire` : 'Commencer';
      return `<button type="button" class="who-btn" data-action="pick-profile" data-value="${p.id}" style="--c:${p.color}">
        <span class="avatar">${esc(p.name.slice(0, 2))}</span>
        <span class="who-name">${esc(p.name)}<small>${esc(info)}</small></span>${ICON.right}
      </button>`;
    }).join('')}</div>
  </div>`;
}

function selectProfile(id) {
  if (!getProfile(id)) return;
  profile = id;
  state = load(id);
  snapshot();
  Object.assign(temp, { openProject: null, keys: null });
  temp.statsOpen.clear();
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

function render() {
  if (!profile) { renderProfiles(); return; }
  document.body.dataset.screen = 'app';
  $('#profiles').hidden = true;
  const me = getProfile(profile);
  const pill = $('#who');
  pill.style.setProperty('--c', me.color);
  pill.innerHTML = `<i></i>${esc(me.name)}`;
  const tab = state.ui.tab;
  const openP = tab === 'projects' ? getProject(temp.openProject) : null;
  if (!openP) temp.openProject = null;
  document.body.dataset.tab = tab;
  if (openP) document.body.dataset.inProject = '1'; else delete document.body.dataset.inProject;
  if (tab !== 'plan') temp.placing = null;
  document.body.classList.toggle('placing', !!temp.placing);
  $('#title').textContent = openP ? openP.name : { tasks: 'Tâches', plan: 'Planning', projects: 'Projets', stats: 'Statistiques' }[tab];
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.value === tab));
  renderBanner();
  $('#view').innerHTML = openP ? viewProject(openP) : tab === 'projects' ? viewProjects() : tab === 'stats' ? viewStats() : tab === 'plan' ? viewPlan() : viewTasks();
  tick();
}

function tick() {
  const el = activeElapsed();
  for (const n of $$('[data-tick]')) {
    const v = Number(n.dataset.base || 0) + el;
    n.textContent = n.dataset.tick === 'clock' ? fmtClock(v) : fmtDur(v);
  }
  if (state.active) $('#banner').classList.toggle('long', el > LONG_SESSION);
  document.title = state.active ? `${fmtClock(el)} · ${getTask(state.active.taskId)?.title || 'Chrono Todo'}` : 'Chrono Todo';
}

function renderBanner() {
  const el = $('#banner');
  const a = state.active;
  if (!a) { el.hidden = true; el.innerHTML = ''; return; }
  const t = getTask(a.taskId);
  const long = activeElapsed() > LONG_SESSION;
  el.hidden = false;
  el.classList.toggle('long', long);
  el.innerHTML = `
    <div class="banner-info" role="button" tabindex="0" data-action="open-task" data-id="${a.taskId}">
      <div class="banner-label"><span class="pulse"></span>${long ? 'Chrono oublié ? Arrête pour corriger' : esc(t ? pathLabel(t.projectId, t.subprojectId) : 'En cours')}</div>
      <div class="banner-title">${esc(t?.title || 'Tâche')}</div>
    </div>
    <div class="banner-time" data-tick="clock" data-base="0">${fmtClock(activeElapsed())}</div>
    <button type="button" class="round-btn stop" data-action="stop" aria-label="Arrêter le chrono">${ICON.stop}</button>`;
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

// Temps du jour / de la semaine, avec la partie "en cours" ajoutée en direct par tick().
function liveTotal(a, b) {
  let closed = 0;
  for (const s of state.sessions) closed += overlap(s, a, b);
  const act = state.active;
  if (!act) return { base: closed, live: false };
  return { base: closed - Math.max(0, a - act.start), live: true };
}

function summaryCard() {
  const n = new Date();
  const day = +startOfDay(n);
  const week = +new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
  const end = day + 2 * 864e5;
  const cell = (label, { base, live }) =>
    `<div><small>${label}</small><b${live ? ` data-tick="dur" data-base="${base}"` : ''}>${fmtDur(base + (live ? activeElapsed() : 0))}</b></div>`;
  return `<button type="button" class="card summary" data-action="go-stats">
    ${cell('Aujourd’hui', liveTotal(day, end))}${cell('Cette semaine', liveTotal(week, end))}
  </button>`;
}

function taskCard(t, totals, { tag = true } = {}) {
  const running = state.active?.taskId === t.id;
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
        ${total || running ? `<span class="spent">${ICON.clock}<b${running ? ` data-tick="dur" data-base="${total}"` : ''}>${fmtDur(total + (running ? activeElapsed() : 0))}</b></span>` : ''}
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
  const act = state.active?.taskId;
  const list = open.filter(match).sort((a, b) => !!b.starred - !!a.starred || (b.id === act) - (a.id === act) || cmpDeadline(a, b) || b.createdAt - a.createdAt);
  const done = state.tasks.filter((t) => t.done && match(t)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  let html = installHint() + summaryCard();

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
    return `<button type="button" class="proj-row" data-action="open-project" data-id="${p.id}" style="--c:${p.color}">
      <span class="dot"></span>
      <span class="proj-name">${esc(p.name)}<small>${esc(subs || 'Aucun sous-projet')}</small></span>
      <span class="proj-stats"><b>${total ? fmtDur(total) : '—'}</b><small>${n ? `${n} à faire` : 'rien à faire'}</small></span>
    </button>`;
  };
  const active = state.projects.filter((p) => !p.archived);
  const archived = state.projects.filter((p) => p.archived);
  return `<div class="stack-gap">
    ${active.length ? `<div class="card">${active.map(row).join('')}</div>` : '<div class="empty"><b>Aucun projet</b>Crée un projet pour classer tes tâches.</div>'}
    <button type="button" class="btn primary wide" data-action="new-project">${ICON.plus} Nouveau projet</button>
    ${archived.length ? `<div class="section-title">Archivés</div><div class="card">${archived.map(row).join('')}</div>` : ''}
    <p class="hint center">Touche un projet pour voir ses tâches et en ajouter.</p>
  </div>`;
}

// Page d'un projet : ses tâches rangées par sous-projet, avec un bouton « Ajouter » dans chaque groupe.
function viewProject(p) {
  const totals = taskTotals();
  const act = state.active?.taskId;
  const mine = state.tasks.filter((t) => t.projectId === p.id);
  const open = mine.filter((t) => !t.done).sort((a, b) => !!b.starred - !!a.starred || (b.id === act) - (a.id === act) || cmpDeadline(a, b) || b.createdAt - a.createdAt);
  const done = mine.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const subs = subsOf(p.id);
  let spent = 0;
  for (const s of state.sessions) if (s.projectId === p.id) spent += s.end - s.start;
  const running = !!act && getTask(act)?.projectId === p.id;

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
      <div><small>Temps passé</small><b${running ? ` data-tick="dur" data-base="${spent}"` : ''}>${fmtDur(spent + (running ? activeElapsed() : 0))}</b></div>
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
    const first = state.sessions.reduce((m, s) => Math.min(m, s.start), state.active ? state.active.start : now());
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
  const live = s.id === 'live';
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

function ask({ title, text = '', input = false, value = '', placeholder = '', ok = 'OK', danger = false, code = false }) {
  const d = $('#ask');
  d.innerHTML = `<form class="ask-form">
    <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
    ${input ? `<input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="60" autocomplete="off" autofocus enterkeyhint="done"${code ? ' class="code" autocapitalize="characters" autocorrect="off" spellcheck="false"' : ''}>` : ''}
    <div class="ask-actions"><button type="button" class="btn ghost" data-ask="cancel">Annuler</button><button class="btn ${danger ? 'danger solid' : 'primary'}">${esc(ok)}</button></div>
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

function projectOptions(selected) {
  const list = state.projects.filter((p) => !p.archived || p.id === selected);
  return `<option value="">Sans projet</option>${list.map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__new">＋ Nouveau projet…</option>`;
}

function subOptions(projectId, selected) {
  if (!projectId) return '<option value="">—</option>';
  return `<option value="">Aucun</option>${subsOf(projectId).map((s) => `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="__new">＋ Nouveau sous-projet…</option>`;
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
  const running = !isNew && state.active?.taskId === id;
  const sessions = isNew ? [] : state.sessions.filter((s) => s.taskId === id).sort((x, y) => y.start - x.start);
  const total = sessions.reduce((n, s) => n + (s.end - s.start), 0);

  const footer = isNew
    ? `<div class="sheet-actions">
        <button class="btn" value="create">Créer</button>
        <button class="btn primary grow" value="start">${ICON.play} Créer et lancer</button>
      </div>`
    : `<section class="time-box">
        <div class="time-head">
          <div><small>Temps passé</small><b${running ? ` data-tick="dur" data-base="${total}"` : ''}>${fmtDur(total + (running ? activeElapsed() : 0))}</b></div>
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

  openSheet(`<form class="sheet-body" data-form="task" data-id="${id || ''}" data-pp="${t.projectId || ''}" autocomplete="off">
    ${head(isNew ? 'Nouvelle tâche' : 'Tâche')}
    <label class="field"><span>Tâche</span><input class="big" name="title" value="${esc(t.title)}" placeholder="Ex. Préparer le cours S2" maxlength="200" required enterkeyhint="done"${isNew ? ' autofocus' : ''}></label>
    <label class="toggle star-toggle"><input type="checkbox" name="starred"${t.starred ? ' checked' : ''}> ${ICON.star} Prioritaire (affichée en premier)</label>
    <div class="row2">
      <label class="field"><span>Projet</span><select name="projectId">${projectOptions(t.projectId)}</select></label>
      <label class="field"><span>Sous-projet</span><select name="subprojectId"${t.projectId ? '' : ' disabled'}>${subOptions(t.projectId, t.subprojectId)}</select></label>
    </div>
    <label class="field"><span>Échéance (facultatif)</span><input type="date" name="deadline" value="${esc(t.deadline || '')}"></label>
    <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="Détails, étapes, liens…">${esc(t.notes || '')}</textarea></label>
    ${footer}
  </form>`);
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
  const t = { id: uid(), ...v, done: false, doneAt: null, createdAt: now() };
  state.tasks.push(t);
  Object.assign(state.ui, { lastProjectId: t.projectId || '', lastSubId: t.subprojectId || '' });
  if (state.ui.filter !== 'all' && state.ui.filter !== (t.projectId || 'none')) Object.assign(state.ui, { filter: 'all', subfilter: 'all' });
  closeSheet();
  persistStorage();
  if (start) { afterTimer(startTimer(t.id), null); toast('C’est parti, chrono lancé'); }
  else { save(); render(); toast('Tâche ajoutée'); }
}

sheet.addEventListener('change', async (e) => {
  const form = e.target.closest('form[data-form="task"]');
  if (!form) return;
  const ps = form.elements.projectId;
  const ss = form.elements.subprojectId;
  if (e.target === ps) {
    if (ps.value === '__new') {
      const name = await ask({ title: 'Nouveau projet', input: true, placeholder: 'Nom du projet', ok: 'Créer' });
      if (name) { const p = addProject(name); save(); ps.innerHTML = projectOptions(p.id); }
      else ps.value = form.dataset.pp;
    }
    form.dataset.pp = ps.value;
    ss.innerHTML = subOptions(ps.value, null);
    ss.disabled = !ps.value;
  } else if (e.target === ss && ss.value === '__new') {
    const name = await ask({ title: 'Nouveau sous-projet', text: `Dans « ${getProject(ps.value)?.name || ''} »`, input: true, placeholder: 'Nom du sous-projet', ok: 'Créer' });
    if (name) { const s = addSub(ps.value, name); save(); ss.innerHTML = subOptions(ps.value, s.id); }
    else ss.value = '';
  }
  if (form.dataset.id && form.isConnected) { commitTaskForm(form); render(); }
});

/* ----- Projet ----- */

function subRow(name, value) {
  return `<div class="sub-row"><div class="field" style="flex:1;margin:0"><input name="${name}" value="${esc(value)}" placeholder="Nom du sous-projet" maxlength="60"></div>
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
    <label class="field"><span>Nom</span><input class="big" name="name" value="${esc(p?.name || '')}" placeholder="Ex. Pro, Agreg, Famille…" maxlength="60" required${isNew ? ' autofocus' : ''}></label>
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
  else if (form.dataset.form === 'event') saveEvent(form);
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

async function seal(text, key) {
  const gzip = typeof CompressionStream === 'function';
  let data = new TextEncoder().encode(text);
  if (gzip) data = await pipeBytes(data, new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head = new Uint8Array([gzip ? 2 : 1, ...iv]);
  return new Blob([head, await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, key, data)]);
}

async function unseal(buf, key) {
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
const docText = (d) => JSON.stringify({ v: 1, ...Object.fromEntries(SYNCED.map((c) => [c, d[c]])), active: d.active, deleted: d.deleted });

function readDoc(text) {
  const d = JSON.parse(text);
  const out = { active: null, deleted: {} };
  for (const c of SYNCED) out[c] = Array.isArray(d[c]) ? d[c].filter((x) => x && typeof x.id === 'string') : [];
  if (d.active?.taskId && d.active.start) out.active = { taskId: String(d.active.taskId), start: Number(d.active.start) };
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

  const timer = timerKey(state.active);
  state.active = mergeTimers(state.active, remote.active);
  out.changed ||= timerKey(state.active) !== timer || !same(del, delBefore);
  out.differs ||= timerKey(state.active) !== timerKey(remote.active) || !same(del, remote.deleted);
  return out;
}

// Un seul chrono à la fois. Si deux appareils en ont lancé un chacun sans connexion,
// le plus récent continue et l'autre est enregistré comme arrêté à ce moment-là.
function mergeTimers(a, b) {
  const del = state.deleted;
  const live = [a, b].filter((x) => x && !del[timerKey(x)]);
  if (!live.length) return null;
  live.sort((x, y) => y.start - x.start || (timerKey(x) < timerKey(y) ? 1 : -1));
  const [win, lose] = live;
  if (lose && timerKey(lose) !== timerKey(win)) {
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
  return { taskId: win.taskId, start: win.start };
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

async function api(method, id, { body, base, have } = {}) {
  const url = `api/sync/${id}${have ? `?have=${encodeURIComponent(have)}` : ''}`;
  let res;
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined; // réseau bloqué : on n'attend pas indéfiniment
    res = await fetch(url, { method, body, signal, cache: 'no-store', headers: base === undefined ? {} : { 'x-base-rev': base } });
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

function syncNow() {
  clearTimeout(syncTimer);
  if (!syncConf.code || !profile) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  if (editing()) { scheduleSync(3000); return Promise.resolve(); }
  syncing = (async () => {
    try {
      if (await syncOnce()) Object.assign(syncConf, { last: now(), error: '' });
    } catch (e) {
      syncConf.error = e.offline ? 'offline' : e.message;
    }
    saveSyncConf();
  })().finally(() => {
    syncing = null;
    refreshSyncUi();
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  });
  return syncing;
}

// Récupère les données des autres appareils, fusionne, puis envoie le résultat si besoin.
async function syncOnce() {
  const { code } = syncConf;
  const prof = profile;
  if (!crypto.subtle) throw new SyncError('connexion non sécurisée (https requis)');
  const { id, key } = await syncKeys(code, prof);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await api('GET', id, { have: state.ui.syncRev });
    let rev = state.ui.syncRev;
    let remote = null;
    if (res.status === 200) {
      rev = res.headers.get('x-rev') || '';
      remote = readDoc(await unseal(await res.arrayBuffer(), key));
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
      state.active = null;
    }
    if (remote) ui.pristine = false;
    if (remote) {
      const adopted = !ui.syncRev && adoptNames(remote); // première fusion : pas de projets en double
      const { changed, differs } = mergeRemote(remote);
      if (changed || adopted) { snapshot(); render(); }
      push = differs;
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
      const put = await api('PUT', id, { body, base: rev });
      if (put.status === 200) { state.ui.syncRev = (await put.json()).rev; sent = true; return true; }
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
  const input = await ask({
    title: 'Code de synchro', text: 'Saisis le code affiché sur ton autre appareil (Réglages › Synchronisation).',
    input: true, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX', ok: 'Valider', code: true,
  });
  if (!input) return;
  const code = readCode(input);
  if (!code) { toast(`Code incomplet ou mal saisi (${CODE_LEN} caractères)`); return; }

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
    Object.assign(state.ui, { syncRev: '', syncDirty: true, pristine: false });
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
    Object.assign(state, { active: null, deleted: {} });
  } else {
    const ok = await ask({
      title: 'Regrouper les données ?',
      text: `Cet appareil contient déjà ${state.tasks.length} tâche(s) et ${state.sessions.length} session(s). Elles seront ajoutées à celles de ton autre appareil.`,
      ok: 'Regrouper',
    });
    if (!ok) return;
    adoptNames(remote);
  }
  mergeRemote(remote);
  snapshot();
  Object.assign(state.ui, { syncRev: rev, syncDirty: !fresh, pristine: false });
  writeLocal();
  syncConf = { code, last: now(), error: '' };
  saveSyncConf();
  render();
  refreshSyncUi();
  toast('Synchro activée ✓');
  if (!fresh) syncNow();
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
      <code>${temp.showCode ? fmtCode(syncConf.code) : fmtCode('•'.repeat(CODE_LEN))}</code>
      <button type="button" class="link" data-action="sync-reveal">${temp.showCode ? 'Masquer' : 'Afficher'}</button>
    </div>
    <p class="hint">Sur ton autre appareil : <b>Réglages › Synchronisation › J’ai déjà un code</b>, puis saisis ce code. Garde-le pour toi : il donne accès à tes données.</p>
    <button type="button" class="btn wide" data-action="sync-copy">Copier le code</button>
    <button type="button" class="btn wide" data-action="sync-now">Synchroniser maintenant</button>
    <button type="button" class="btn wide ghost danger" data-action="sync-off">Désactiver sur cet appareil</button>`;
}

function refreshSyncUi() {
  const box = $('#sync-box');
  if (box) box.innerHTML = syncSection();
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

function plansOn(day) {
  const a = dateAt(day, 0);
  const b = dateAt(day, DAY_MIN);
  return state.plans.filter((p) => p.end > a && p.start < b && getTask(p.taskId));
}

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
  for (const p of state.plans) if (p.taskId === taskId && p.end > t && (!best || p.start < best.start)) best = p;
  return best;
}

function planLabel(p) {
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
    const n = plansOn(key).length;
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
        const running = state.active?.taskId === t.id;
        return `<div class="plan-block${t.done ? ' done' : ''}${running ? ' running' : ''}" data-action="open-plan" data-id="${it.p.id}" style="${boxStyle(it)};--c:${colorOf(t.projectId)}">
          <b>${t.starred ? '★ ' : ''}${esc(t.title)}</b><span>${shortLabel(it.s0)}–${shortLabel(it.e)}</span>
          <i class="plan-resize" aria-hidden="true"></i></div>`;
      }).join('')}
      ${key === today && nowMin >= VIEW_START ? `<div class="now-line" style="top:${posPct(nowMin)}%"></div>` : ''}
    </div>`;
  }).join('');

  const tray = trayTasks(weekStart, weekEnd);
  const placing = getTask(temp.placing);
  const sideOpen = ui.planSide !== false;
  const side = `<aside class="side${sideOpen ? ' open' : ''}" aria-label="Tâches à planifier">
      <div class="side-head"><b>À planifier</b><small>${tray.length}</small>
        <button type="button" class="icon-btn side-close" data-action="side-toggle" aria-label="Masquer la liste">${ICON.right}</button></div>
      ${tray.length ? `<p class="side-hint">Glisse une tâche dans le planning, ou touche-la puis touche un créneau.</p>
      <div class="side-list">${tray.map(({ t, planned }) => `<button type="button" class="side-task${planned ? ' planned' : ''}${temp.placing === t.id ? ' on' : ''}" data-action="pick-tray" data-drag-task="${t.id}" style="--c:${colorOf(t.projectId)}">
        <span class="side-title">${t.starred ? ICON.star : ''}${esc(t.title)}</span>
        <small>${planned ? '✓ déjà planifiée' : esc(getProject(t.projectId)?.name || 'Sans projet')}</small></button>`).join('')}</div>`
        : '<p class="side-hint">Aucune tâche à faire. Ajoute-en dans l’onglet Tâches.</p>'}
    </aside>`;
  const floating = placing
    ? `<div class="place-bar"><span>Touche un créneau pour placer <b>« ${esc(placing.title)} »</b></span><button type="button" class="btn small" data-action="cancel-placing">Annuler</button></div>`
    : `<button type="button" class="side-handle${sideOpen ? '' : ' show'}" data-action="side-toggle">${ICON.list}<span>À planifier</span><b>${tray.length}</b></button>`;

  return `<div class="plan-bar">
      <div class="seg-mini" role="group" aria-label="Affichage">
        <button type="button" class="${isDay ? '' : 'on'}" data-action="plan-view" data-value="week">Semaine</button>
        <button type="button" class="${isDay ? 'on' : ''}" data-action="plan-view" data-value="day">Jour</button>
      </div>
      <button type="button" class="btn small" data-action="new-event">${ICON.plus} Événement</button>
    </div>
    <div class="plan-nav">
      <button type="button" class="icon-btn" data-action="plan-move" data-value="-1" aria-label="Précédent">${ICON.left}</button>
      <button type="button" class="plan-range" data-action="plan-today">${range}</button>
      <button type="button" class="icon-btn" data-action="plan-move" data-value="1" aria-label="Suivant">${ICON.right}</button>
    </div>
    ${state.events.length ? '' : '<p class="hint plan-hint">Astuce : ajoute tes horaires fixes (travail, cours…) avec <b>+ Événement</b>, puis cale tes tâches autour.</p>'}
    <div class="plan-layout">
    <div class="cal${isDay ? ' is-day' : ''}">
      <div class="cal-head"><div class="cal-gutter"></div><div class="cal-days" style="--n:7">${heads}</div></div>
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

// Créneau touché dans une colonne : minute de la journée (arrondie à la demi-heure).
function slotAt(col, y) {
  const r = col.getBoundingClientRect();
  const m = VIEW_START + ((y - r.top) / r.height) * VIEW_SPAN;
  return Math.max(VIEW_START, Math.min(DAY_MIN - 30, Math.floor(m / 30) * 30));
}

// Barre latérale : fixe à droite sur grand écran, volet qui glisse depuis la droite sur téléphone.
const sideDocked = () => matchMedia('(min-width: 760px)').matches;
function closeSideOnPhone() {
  if (sideDocked() || state.ui.planSide === false) return;
  state.ui.planSide = false;
  writeLocal();
  $('.side')?.classList.remove('open');
}
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
  if (!chip && !block) return;
  const kind = chip ? 'new' : e.target.closest('.plan-resize') ? 'resize' : 'move';
  drag.pending = { kind, el: chip || block, id: chip ? chip.dataset.dragTask : block.dataset.id, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  if (e.pointerType !== 'mouse') drag.pending.timer = setTimeout(beginDrag, 260); // appui long
  else e.preventDefault(); // pas de sélection de texte à la souris
});

window.addEventListener('pointermove', (e) => {
  if (drag.active) { moveDrag(e.clientX, e.clientY); return; }
  const p = drag.pending;
  if (!p) return;
  Object.assign(p, { x: e.clientX, y: e.clientY });
  const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
  if (p.type === 'mouse' && dist > 5) beginDrag();
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
  if (p.kind === 'new') {
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
  pv.style.top = `${posPct(target.start)}%`;
  pv.style.height = `${((target.end - target.start) / VIEW_SPAN) * 100}%`;
  pv.textContent = `${minLabel(target.start)}–${minLabel(target.end)}`;
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
  $('.plan-preview')?.remove();
  document.body.classList.remove('is-dragging', 'drag-move', 'drop-hover');
  temp.suppressClick = true; // le relâchement ne doit pas compter comme un « toucher »
  setTimeout(() => { temp.suppressClick = false; }, 350);
  const tg = drop ? a.target : null;
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
  const d = new Date(p.start);
  const day = ymd(d);
  const running = state.active?.taskId === t.id;
  openSheet(`<form class="sheet-body" data-form="plan" data-id="${id}">
    ${head('Créneau planifié')}
    <button type="button" class="plan-task" data-action="open-task" data-id="${t.id}" style="--c:${colorOf(t.projectId)}">
      <span class="dot"></span><span class="plan-task-name">${t.starred ? '★ ' : ''}${esc(t.title)}<small>${esc(pathLabel(t.projectId, t.subprojectId))}</small></span>${ICON.right}
    </button>
    <label class="field"><span>Jour</span><input type="date" name="date" value="${day}" required></label>
    <div class="row2">
      <label class="field"><span>Début</span><input type="time" name="start" value="${hhmm(minOfDay(p.start, day))}" step="300" required></label>
      <label class="field"><span>Fin</span><input type="time" name="end" value="${hhmm(minOfDay(p.end, day) % DAY_MIN)}" step="300" required></label>
    </div>
    <div class="sheet-actions">
      ${t.done ? '' : `<button type="button" class="btn ${running ? 'stop' : 'primary'} grow" data-action="toggle-timer" data-id="${t.id}">${running ? `${ICON.stop} Arrêter` : `${ICON.play} Lancer le chrono`}</button>`}
      <button type="button" class="btn grow" data-action="toggle-done" data-id="${t.id}">${t.done ? 'Rouvrir' : `${ICON.check} Terminée`}</button>
    </div>
    <button type="button" class="btn ghost danger wide" data-action="delete-plan" data-id="${id}">${ICON.trash} Retirer du planning</button>
  </form>`);
}

function commitPlanForm(form) {
  const p = state.plans.find((x) => x.id === form.dataset.id);
  const day = form.elements.date.value;
  if (!p || !day) return;
  const s = toMin(form.elements.start.value);
  let e = toMin(form.elements.end.value);
  if (e <= s) e = e === 0 ? DAY_MIN : Math.min(DAY_MIN, s + PLAN_DUR); // fin avant le début : on corrige
  Object.assign(p, { start: dateAt(day, s), end: dateAt(day, e) });
  form.elements.end.value = hhmm(e % DAY_MIN);
  save(); render();
}

function openSlotSheet(day, min) {
  const d = parseYmd(day);
  const tasks = trayTasks(0, 0);
  openSheet(`<div class="sheet-body">
    ${head(`${cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'short' }))} · ${minLabel(min)}`)}
    ${tasks.length ? `<p class="hint">Quelle tâche faire à ce moment-là ?</p>
      <div class="card pick-list">${tasks.map(({ t }) => `<button type="button" class="pick" data-action="plan-here" data-id="${t.id}" data-day="${day}" data-min="${min}" style="--c:${colorOf(t.projectId)}">
        <span class="dot"></span><span class="pick-title">${t.starred ? '★ ' : ''}${esc(t.title)}<small>${esc(pathLabel(t.projectId, t.subprojectId))}</small></span>${ICON.plus}</button>`).join('')}</div>`
      : '<p class="hint">Aucune tâche à faire pour l’instant.</p>'}
    <button type="button" class="btn wide" style="margin-top:12px" data-action="new-event" data-day="${day}" data-min="${min}">${ICON.plus} Événement fixe à cette heure (travail, cours…)</button>
  </div>`);
}

function openEventSheet(id, preset = {}) {
  const found = state.events.find((x) => x.id === id);
  const iso = preset.day ? String(((parseYmd(preset.day).getDay() + 6) % 7) + 1) : '';
  const ev = found || { title: '', color: EVENT_COLORS[0], days: iso || '12345', date: '', start: preset.min ?? 480, end: Math.min(DAY_MIN - 5, (preset.min ?? 480) + (preset.min != null ? 120 : 540)) };
  const once = !!ev.date;
  openSheet(`<form class="sheet-body" data-form="event" data-id="${found ? id : ''}" autocomplete="off">
    ${head(found ? 'Événement fixe' : 'Nouvel événement fixe')}
    <p class="hint" style="margin-top:0">Un créneau qui n’est pas une tâche (travail, cours, sport…). Il s’affiche en fond du planning pour caler tes tâches autour.</p>
    <label class="field"><span>Nom</span><input class="big" name="title" value="${esc(ev.title)}" placeholder="Ex. Travail" maxlength="60" required${found ? '' : ' autofocus'}></label>
    <div class="seg2">
      <label><input type="radio" name="repeat" value="weekly"${once ? '' : ' checked'}><span>Chaque semaine</span></label>
      <label><input type="radio" name="repeat" value="once"${once ? ' checked' : ''}><span>Une seule fois</span></label>
    </div>
    <div class="field when-weekly"><span>Jours</span><div class="daypick">${'LMMJVSD'.split('').map((l, i) => `<label><input type="checkbox" name="day" value="${i + 1}"${String(ev.days || '').includes(String(i + 1)) ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
    <label class="field when-once"><span>Date</span><input type="date" name="date" value="${esc(ev.date || preset.day || ymd(new Date()))}"></label>
    <div class="row2">
      <label class="field"><span>Début</span><input type="time" name="start" value="${hhmm(ev.start)}" step="300" required></label>
      <label class="field"><span>Fin</span><input type="time" name="end" value="${hhmm(ev.end)}" step="300" required></label>
    </div>
    <div class="field"><span>Couleur</span><div class="swatches">${EVENT_COLORS.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}"${c === (ev.color || EVENT_COLORS[0]) ? ' checked' : ''}><i></i></label>`).join('')}</div></div>
    <div class="sheet-actions">
      ${found ? `<button type="button" class="btn ghost danger" data-action="delete-event" data-id="${id}">${ICON.trash} Supprimer</button>` : ''}
      <button class="btn primary grow">${found ? 'Enregistrer' : 'Ajouter au planning'}</button>
    </div>
  </form>`);
}

function saveEvent(form) {
  const fd = new FormData(form);
  const title = String(fd.get('title') || '').trim();
  if (!title) return;
  const start = toMin(fd.get('start'));
  let end = toMin(fd.get('end'));
  if (end === 0) end = DAY_MIN;
  if (end <= start) { toast('L’heure de fin doit être après le début'); return; }
  const once = fd.get('repeat') === 'once';
  const days = fd.getAll('day').join('');
  if (!once && !days) { toast('Choisis au moins un jour'); return; }
  let ev = state.events.find((x) => x.id === form.dataset.id);
  if (!ev) { ev = { id: uid() }; state.events.push(ev); }
  Object.assign(ev, { title, color: String(fd.get('color') || EVENT_COLORS[0]), start, end, days: once ? '' : days, date: once ? String(fd.get('date') || ymd(new Date())) : '' });
  save(); closeSheet(); render();
  toast(once ? 'Événement ajouté' : 'Événement ajouté chaque semaine');
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
  if (temp.suppressClick && e.target.closest('.cal, .side')) { e.preventDefault(); e.stopPropagation(); }
}, true);
// Un nouveau toucher n'est jamais ignoré.
document.addEventListener('pointerdown', () => { temp.suppressClick = false; }, true);

setInterval(() => {
  const line = $('.now-line');
  if (line && !drag.active) line.style.top = `${posPct(new Date().getHours() * 60 + new Date().getMinutes())}%`;
}, 60e3);

new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${$('.top').offsetHeight}px`)).observe($('.top'));

/* ---------- Actions ---------- */

const actions = {
  'plan-view'(el) { state.ui.planView = el.dataset.value; writeLocal(); render(); scrollPlanToHour(); },
  'plan-day'(el) {
    // En semaine : toucher un jour l'ouvre en vue Jour. En vue Jour : change de jour.
    Object.assign(state.ui, { planDate: el.dataset.value, planView: 'day' });
    writeLocal(); render();
  },
  'plan-move'(el) {
    const d = parseYmd(state.ui.planDate || ymd(new Date()));
    const step = (state.ui.planView === 'day' ? 1 : 7) * Number(el.dataset.value);
    state.ui.planDate = ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + step));
    writeLocal(); render();
  },
  'plan-today'() { state.ui.planDate = ymd(new Date()); writeLocal(); render(); scrollPlanToHour(); },
  'pick-tray'(el) {
    const id = el.dataset.dragTask;
    temp.placing = temp.placing === id ? null : id;
    if (temp.placing) closeSideOnPhone();
    document.body.classList.toggle('placing', !!temp.placing);
    render();
  },
  'side-toggle'() { state.ui.planSide = state.ui.planSide === false; writeLocal(); render(); },
  'cancel-placing'() { temp.placing = null; document.body.classList.remove('placing'); render(); },
  slot(el, e) {
    if (placeHere(el, e)) return;
    openSlotSheet(el.dataset.day, slotAt(el, e.clientY));
  },
  'open-plan'(el, e) { if (!placeHere(el, e)) openPlanSheet(el.dataset.id); },
  'open-event'(el, e) { if (!placeHere(el, e)) openEventSheet(el.dataset.id); },
  'plan-here'(el) { closeSheet(); createPlan(el.dataset.id, el.dataset.day, Number(el.dataset.min)); },
  'new-event'(el) {
    openEventSheet(null, el.dataset.day ? { day: el.dataset.day, min: Number(el.dataset.min) } : {});
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
    const done = state.active?.taskId === id ? stopTimer() : startTimer(id);
    afterTimer(done, inSheet ? id : null);
  },
  stop() { afterTimer(stopTimer(), null); },
  'toggle-star'(el) {
    const t = getTask(el.dataset.id);
    if (!t) return;
    t.starred = !t.starred;
    save(); render(); buzz();
  },
  'pick-profile'(el) { selectProfile(el.dataset.value); },
  'switch-profile'() { leaveProfile(); },

  'toggle-done'(el) {
    const t = getTask(el.dataset.id);
    if (!t) return;
    const inSheet = !!el.closest('#sheet');
    if (inSheet) closeSheet(); // enregistre aussi les modifications du formulaire
    const done = !t.done && state.active?.taskId === t.id ? finishActive() : null;
    t.done = !t.done;
    t.doneAt = t.done ? now() : null;
    save(); render(); buzz();
    if (t.done) toast('Tâche terminée', { label: 'Annuler', fn: () => { t.done = false; t.doneAt = null; save(); render(); } });
    afterTimer(done, null);
  },
  'open-task'(el) { openTaskSheet(el.dataset.id); },
  'new-task'(el) {
    // Depuis la page d'un projet : la tâche est déjà rangée dans ce projet (et ce sous-projet).
    const projectId = el.dataset.project || temp.openProject;
    openTaskSheet(null, projectId ? { projectId, subprojectId: el.dataset.sub || null } : undefined);
  },
  async 'delete-task'(el) {
    const t = getTask(el.dataset.id);
    if (!t) return;
    const ok = await ask({ title: 'Supprimer cette tâche ?', text: 'Le temps déjà passé reste comptabilisé dans les statistiques.', ok: 'Supprimer', danger: true });
    if (!ok) return;
    if (state.active?.taskId === t.id) finishActive();
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
setInterval(() => { if (state.active && !document.hidden) tick(); }, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { render(); syncNow(); }
  else if (state.ui.syncDirty) syncNow(); // envoie les dernières modifications avant que l'app passe en arrière-plan
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
