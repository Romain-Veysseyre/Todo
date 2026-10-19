'use strict';

/* =========================================================
   Chrono Todo — todo + chronomètre par tâche
   Données stockées sur l'appareil (localStorage), aucun serveur.
   ========================================================= */

const VERSION = '1.0.0';
const STORE_KEY = 'chronotodo:v1';
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
};

/* ---------- Données ---------- */

function blankState() {
  return {
    version: 1,
    projects: [],    // { id, name, color, archived, createdAt }
    subprojects: [], // { id, projectId, name }
    tasks: [],       // { id, title, notes, projectId, subprojectId, deadline, done, doneAt, createdAt }
    sessions: [],    // { id, taskId, title, projectId, subprojectId, start, end }
    active: null,    // { taskId, start }
    ui: {
      tab: 'tasks', filter: 'all', subfilter: 'all', showDone: false,
      period: 'week', offset: 0, lastProjectId: '', lastSubId: '', lastBackup: 0, hideInstall: false,
    },
  };
}

// Projets repris de la liste déroulante du fichier Excel.
function seedState() {
  const s = blankState();
  const add = (name, subs = []) => {
    const p = { id: uid(), name, color: COLORS[s.projects.length % COLORS.length], archived: false, createdAt: now() };
    s.projects.push(p);
    subs.forEach((n) => s.subprojects.push({ id: uid(), projectId: p.id, name: n }));
  };
  add('Pro', ['Prépa cours', 'Correction', 'Prof principal']);
  ['Admin', 'Agreg', 'Famille / Social', 'Couple', 'Vbarthe', 'CookOnce', 'DP', 'Opti Todo', 'Pause'].forEach((n) => add(n));
  return s;
}

function normalize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) throw new Error('format');
  const s = blankState();
  for (const k of ['projects', 'subprojects', 'tasks', 'sessions']) if (Array.isArray(data[k])) s[k] = data[k];
  s.active = data.active && data.active.taskId && data.active.start ? data.active : null;
  Object.assign(s.ui, data.ui || {});
  return s;
}

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    // Données illisibles : on les met de côté plutôt que de les écraser.
    if (raw) try { localStorage.setItem(`${STORE_KEY}:backup-${now()}`, raw); } catch (_) { /* plein */ }
  }
  return seedState();
}

let state = load();
const temp = { statsOpen: new Set(), installEvt: null };

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('Impossible d’enregistrer sur cet appareil'); }
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
    id: uid(), taskId: a.taskId, title: t?.title || 'Tâche',
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

function render() {
  const tab = state.ui.tab;
  document.body.dataset.tab = tab;
  $('#title').textContent = { tasks: 'Tâches', projects: 'Projets', stats: 'Statistiques' }[tab];
  $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.value === tab));
  renderBanner();
  $('#view').innerHTML = tab === 'projects' ? viewProjects() : tab === 'stats' ? viewStats() : viewTasks();
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

function taskCard(t, totals) {
  const running = state.active?.taskId === t.id;
  const total = totals.get(t.id) || 0;
  const due = !t.done && dueInfo(t.deadline);
  const notes = (t.notes || '').split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean).join(' · ');
  return `<article class="task${running ? ' running' : ''}${t.done ? ' done' : ''}" style="--c:${colorOf(t.projectId)}">
    <button type="button" class="check" data-action="toggle-done" data-id="${t.id}" aria-label="${t.done ? 'Rouvrir' : 'Marquer comme faite'}">${ICON.check}</button>
    <div class="task-main" role="button" tabindex="0" data-action="open-task" data-id="${t.id}">
      <div class="task-title">${esc(t.title)}</div>
      ${notes ? `<div class="task-notes">${esc(notes)}</div>` : ''}
      <div class="task-meta">
        ${t.projectId ? `<span class="tag"><i></i>${esc(pathLabel(t.projectId, t.subprojectId))}</span>` : ''}
        ${due ? `<span class="due ${due.cls}">${esc(due.text)}</span>` : ''}
        ${total || running ? `<span class="spent">${ICON.clock}<b${running ? ` data-tick="dur" data-base="${total}"` : ''}>${fmtDur(total + (running ? activeElapsed() : 0))}</b></span>` : ''}
      </div>
    </div>
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
  const list = open.filter(match).sort((a, b) => (b.id === act) - (a.id === act) || cmpDeadline(a, b) || b.createdAt - a.createdAt);
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
    <p class="hint center">Touche un projet pour le renommer, changer sa couleur ou gérer ses sous-projets.</p>
  </div>`;
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
window.addEventListener('popstate', () => { if (sheet.open) sheet.close(); });
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

function ask({ title, text = '', input = false, value = '', placeholder = '', ok = 'OK', danger = false }) {
  const d = $('#ask');
  d.innerHTML = `<form class="ask-form">
    <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
    ${input ? `<input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="60" autocomplete="off" autofocus enterkeyhint="done">` : ''}
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
  return { title: '', projectId, subprojectId, deadline: '', notes: '' };
}

function openTaskSheet(id) {
  const isNew = !id;
  const t = isNew ? newTaskDefaults() : getTask(id);
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
  openSheet(`<form class="sheet-body" data-form="project" data-id="${p?.id || ''}" autocomplete="off">
    ${head(isNew ? 'Nouveau projet' : 'Projet')}
    <label class="field"><span>Nom</span><input class="big" name="name" value="${esc(p?.name || '')}" placeholder="Ex. Pro, Agreg, Famille…" maxlength="60" required${isNew ? ' autofocus' : ''}></label>
    <div class="field"><span>Couleur</span><div class="swatches">${COLORS.map((c) => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}"${c === color ? ' checked' : ''}><i></i></label>`).join('')}</div></div>
    <div class="field"><span>Sous-projets</span>
      <div class="subs">${isNew ? '' : subsOf(p.id).map((s) => subRow(`sub:${s.id}`, s.name)).join('')}</div>
      <button type="button" class="btn ghost small" style="align-self:flex-start" data-action="add-sub">${ICON.plus} Ajouter un sous-projet</button>
    </div>
    ${isNew ? '' : `<label class="toggle"><input type="checkbox" name="archived"${p.archived ? ' checked' : ''}> Archiver (masqué des listes, gardé dans les stats)</label>`}
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
  openSheet(`<div class="sheet-body">
    ${head('Réglages')}
    <section class="set-group"><h3>Application</h3>
      ${isStandalone() ? '<p class="hint">✓ L’app est installée sur cet appareil.</p>' : installHelp()}
    </section>
    <section class="set-group"><h3>Sauvegarde</h3>
      <p class="hint">Tes données restent sur cet appareil : rien n’est envoyé sur internet. Fais une sauvegarde de temps en temps (dernière : <b>${last}</b>).</p>
      <button type="button" class="btn wide" data-action="export-json">Sauvegarder mes données (.json)</button>
      <button type="button" class="btn wide" data-action="import-json">Restaurer une sauvegarde</button>
      <button type="button" class="btn wide" data-action="export-csv">Exporter le journal pour Excel (.csv)</button>
    </section>
    <section class="set-group"><h3>Zone sensible</h3>
      <button type="button" class="btn wide danger" data-action="reset-all">${ICON.trash} Tout effacer</button>
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
  if (await shareOrDownload(`chrono-todo-${ymd(new Date())}.json`, data, 'application/json')) {
    state.ui.lastBackup = now();
    save(); closeSheet(); toast('Sauvegarde créée');
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
      text: `${data.tasks.length} tâche(s), ${data.projects.length} projet(s), ${data.sessions.length} session(s). Les données actuelles seront remplacées.`,
      ok: 'Restaurer', danger: true,
    });
    if (!ok) return;
    data.ui.tab = state.ui.tab;
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
  shareOrDownload(`chrono-todo-journal-${ymd(new Date())}.csv`, `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`, 'text/csv');
}

async function resetAll() {
  const ok = await ask({ title: 'Tout effacer ?', text: 'Tâches, projets et temps seront supprimés de cet appareil. Fais une sauvegarde avant si besoin.', ok: 'Tout effacer', danger: true });
  if (!ok) return;
  state = seedState();
  save(); closeSheet(); render(); toast('Données effacées');
}

/* ---------- Actions ---------- */

const actions = {
  tab(el) { state.ui.tab = el.dataset.value; save(); render(); window.scrollTo(0, 0); },
  'go-stats'() { Object.assign(state.ui, { tab: 'stats', period: 'day', offset: 0 }); save(); render(); window.scrollTo(0, 0); },
  filter(el) { Object.assign(state.ui, { filter: el.dataset.value, subfilter: 'all' }); save(); render(); },
  subfilter(el) { state.ui.subfilter = el.dataset.value; save(); render(); },

  'toggle-timer'(el) {
    const id = el.dataset.id;
    const inSheet = !!el.closest('#sheet');
    const f = taskFormOpen();
    if (f?.dataset.id) commitTaskForm(f);
    const done = state.active?.taskId === id ? stopTimer() : startTimer(id);
    afterTimer(done, inSheet ? id : null);
  },
  stop() { afterTimer(stopTimer(), null); },

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
  'new-task'() { openTaskSheet(null); },
  async 'delete-task'(el) {
    const t = getTask(el.dataset.id);
    if (!t) return;
    const ok = await ask({ title: 'Supprimer cette tâche ?', text: 'Le temps déjà passé reste comptabilisé dans les statistiques.', ok: 'Supprimer', danger: true });
    if (!ok) return;
    if (state.active?.taskId === t.id) finishActive();
    state.tasks = state.tasks.filter((x) => x !== t);
    save(); closeSheet(); render(); toast('Tâche supprimée');
  },
  'toggle-done-list'() { state.ui.showDone = !state.ui.showDone; save(); render(); },
  async 'clear-done'() {
    const n = state.tasks.filter((t) => t.done).length;
    const ok = await ask({ title: `Effacer ${n} tâche(s) terminée(s) ?`, text: 'Le temps passé reste dans les statistiques.', ok: 'Effacer', danger: true });
    if (!ok) return;
    state.tasks = state.tasks.filter((t) => !t.done);
    save(); render();
  },
  'close-sheet'() { closeSheet(); },

  'open-project'(el) { openProjectSheet(el.dataset.id); },
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

  period(el) { Object.assign(state.ui, { period: el.dataset.value, offset: 0 }); temp.statsOpen.clear(); save(); render(); },
  offset(el) {
    const v = Number(el.dataset.value);
    state.ui.offset = v === 0 ? 0 : Math.min(0, state.ui.offset + v);
    save(); render();
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
  'hide-install'() { state.ui.hideInstall = true; save(); render(); },
  'export-json'() { exportJson(); },
  'import-json'() { importJson(); },
  'export-csv'() { exportCsv(); },
  'reset-all'() { resetAll(); },
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// Synchronise si l'app est ouverte dans deux onglets.
window.addEventListener('storage', (e) => {
  if (e.key !== STORE_KEY || !e.newValue) return;
  try { state = normalize(JSON.parse(e.newValue)); render(); } catch (_) { /* ignoré */ }
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
