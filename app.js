/* ===== Selectors ===== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ===== Constants ===== */
const STORAGE_KEY = 'violin-practice-log';
const SESSION_KEY = 'violin-practice-active';
const SWIPE_THRESHOLD = 80;

/* ===== State ===== */
let data = { version: 1, pool: [], sessions: [], archive: [] };
let activeSession = null;
let swipeResults = { completed: [], workedOn: [] };
let undoTimer = null;
let nameMap = new Map();

/* ===== DOM Cache ===== */
let dom = {};

function cacheDom() {
  dom = {
    viewPool: $('#view-pool'),
    viewSwipe: $('#view-swipe'),
    viewHistory: $('#view-history'),
    viewArchive: $('#view-archive'),
    tabBar: $('#tab-bar'),
    tabs: $$('.tab'),
    tabDotPool: $('#tab-dot-pool'),
    poolList: $('#pool-list'),
    poolInput: $('#pool-input'),
    practiceBtn: $('#practice-btn'),
    practiceIndicator: $('#practice-indicator'),
    swipeList: $('#swipe-list'),
    swipeDoneBtn: $('#swipe-done-btn'),
    totalTime: $('#total-time'),
    historyList: $('#history-list'),
    historyEmpty: $('#history-empty'),
    archiveList: $('#archive-list'),
    archiveEmpty: $('#archive-empty'),
    exportBtn: $('#export-btn'),
    importBtn: $('#import-btn'),
    importFile: $('#import-file'),
    recoverDialog: $('#recover-dialog'),
    recoverInfo: $('#recover-info'),
    recoverResume: $('#recover-resume'),
    recoverDiscard: $('#recover-discard'),
    confirmDialog: $('#confirm-dialog'),
    confirmMsg: $('#confirm-msg'),
    confirmOk: $('#confirm-ok'),
    confirmCancel: $('#confirm-cancel'),
    undoToast: $('#undo-toast'),
    undoToastMsg: $('#undo-toast-msg'),
    undoToastBtn: $('#undo-toast-btn'),
  };
}

/* ===== Persistence ===== */
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) data = JSON.parse(raw);
    data.pool.forEach(p => { if (p.workedCount == null) p.workedCount = 0; });
  } catch (e) { /* use default */ }
}

function saveActiveSession() {
  if (activeSession) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(activeSession));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function loadActiveSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

/* ===== Name Map ===== */
function rebuildNameMap() {
  nameMap.clear();
  data.pool.forEach(p => nameMap.set(p.id, p.text));
  data.archive.forEach(a => nameMap.set(a.id, a.text));
}

function getItemName(pid) {
  return nameMap.get(pid) || '(削除済み)';
}

/* ===== HTML Escaping ===== */
const _escDiv = document.createElement('div');

function esc(str) {
  _escDiv.textContent = str;
  return _escDiv.innerHTML;
}

function escAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ===== Tab Navigation ===== */
function switchView(name) {
  const views = {
    pool: dom.viewPool, history: dom.viewHistory,
    archive: dom.viewArchive, swipe: dom.viewSwipe,
  };
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
  dom.tabs.forEach(t => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'history') renderHistory();
  if (name === 'archive') renderArchive();
}

/* ===== Pool Rendering ===== */
function renderPool() {
  const list = dom.poolList;
  list.innerHTML = '';

  if (data.pool.length === 0) {
    list.innerHTML = '<p class="empty-msg">課題を追加しましょう</p>';
    return;
  }

  data.pool.forEach(item => {
    const el = document.createElement('div');
    el.className = 'pool-item';
    el.dataset.id = item.id;

    const badge = (item.workedCount || 0) > 0
      ? `<span class="pool-badge">${item.workedCount}</span>` : '';

    el.innerHTML = `
      ${badge}
      <span class="pool-item-text">${esc(item.text)}</span>
      <button class="pool-item-delete" data-id="${escAttr(item.id)}">&times;</button>
    `;
    list.appendChild(el);
  });
}

function addPoolItem() {
  const text = dom.poolInput.value.trim();
  if (!text) return;

  data.pool.push({
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    text: text,
    createdAt: new Date().toISOString(),
    workedCount: 0,
  });

  save();
  rebuildNameMap();
  renderPool();
  dom.poolInput.value = '';
  dom.poolInput.focus();
}

function confirmDeletePoolItem(id) {
  const item = data.pool.find(p => p.id === id);
  if (!item) return;
  showConfirm(`「${item.text}」を削除しますか？`, () => {
    data.pool = data.pool.filter(p => p.id !== id);
    save();
    renderPool();
  });
}

/* ===== Confirm Dialog ===== */
function showConfirm(msg, onOk) {
  dom.confirmMsg.textContent = msg;
  dom.confirmDialog.classList.remove('hidden');
  dom.confirmOk.onclick = () => {
    dom.confirmDialog.classList.add('hidden');
    onOk();
  };
  dom.confirmCancel.onclick = () => {
    dom.confirmDialog.classList.add('hidden');
  };
}

/* ===== Practice Start / Stop ===== */
function startPractice() {
  activeSession = {
    id: 's_' + Date.now(),
    startedAt: new Date().toISOString(),
  };
  saveActiveSession();
  updatePracticeUI();
}

function stopPractice() {
  if (!activeSession) return;
  activeSession.endedAt = new Date().toISOString();
  activeSession.duration = Math.round(
    (new Date(activeSession.endedAt) - new Date(activeSession.startedAt)) / 1000
  );
  beginSwipe();
}

function updatePracticeUI() {
  const running = !!activeSession;
  dom.practiceBtn.textContent = running ? '練習ストップ' : '練習スタート';
  dom.practiceBtn.classList.toggle('recording', running);
  dom.practiceIndicator.classList.toggle('hidden', !running);
  dom.tabDotPool.classList.toggle('hidden', !running);
}

/* ===== Swipe (List-based) ===== */
function beginSwipe() {
  swipeResults = { completed: [], workedOn: [] };

  if (data.pool.length === 0) {
    finishSwipe();
    return;
  }

  switchView('swipe');
  renderSwipeList();
}

function renderSwipeList() {
  const list = dom.swipeList;
  list.innerHTML = '';

  data.pool.forEach(item => {
    if (swipeResults.completed.includes(item.id)) return;

    const el = document.createElement('div');
    el.className = 'swipe-item';
    el.dataset.id = item.id;

    const isWorked = swipeResults.workedOn.includes(item.id);
    if (isWorked) el.classList.add('worked');

    el.innerHTML = `
      <div class="swipe-item-bg"><span>完了 ✓</span></div>
      <div class="swipe-item-content">
        <span class="swipe-item-text">${esc(item.text)}</span>
        ${isWorked ? '<span class="swipe-item-badge">取り組んだ</span>' : ''}
      </div>
    `;
    list.appendChild(el);
  });
}

/* ===== Swipe Gestures (delegated on swipe-list) ===== */
let activeDrag = null;

function initSwipeGestures() {
  const list = dom.swipeList;
  list.addEventListener('touchstart', onSwipeDragStart, { passive: true });
  list.addEventListener('touchmove', onSwipeDragMove, { passive: false });
  list.addEventListener('touchend', onSwipeDragEnd);
  list.addEventListener('mousedown', onSwipeDragStart);
  window.addEventListener('mousemove', onSwipeDragMove);
  window.addEventListener('mouseup', onSwipeDragEnd);
}

function getX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
function getY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }

function onSwipeDragStart(e) {
  const item = e.target.closest('.swipe-item');
  if (!item || item.classList.contains('removing')) return;

  const x = getX(e);
  // Avoid conflict with iOS browser back gesture
  if (x < 30) return;

  activeDrag = {
    el: item,
    content: item.querySelector('.swipe-item-content'),
    bg: item.querySelector('.swipe-item-bg'),
    startX: x,
    startY: getY(e),
    currentX: x,
    dirLocked: false,
    isHorizontal: null,
  };
  activeDrag.content.classList.remove('returning');
}

function onSwipeDragMove(e) {
  if (!activeDrag) return;

  const dx = getX(e) - activeDrag.startX;
  const dy = getY(e) - activeDrag.startY;

  if (!activeDrag.dirLocked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
    activeDrag.isHorizontal = Math.abs(dx) > Math.abs(dy);
    activeDrag.dirLocked = true;
  }

  if (!activeDrag.isHorizontal) return;
  if (e.cancelable) e.preventDefault();

  activeDrag.currentX = getX(e);
  const clampedDx = Math.max(0, dx);
  activeDrag.content.style.transform = `translateX(${clampedDx}px)`;
  activeDrag.bg.style.opacity = Math.min(1, clampedDx / SWIPE_THRESHOLD);
}

function onSwipeDragEnd() {
  if (!activeDrag) return;

  const dx = activeDrag.currentX - activeDrag.startX;
  const dy = (activeDrag.currentX !== activeDrag.startX || activeDrag.startY !== activeDrag.startY) ? 0 : 0;
  const item = activeDrag.el;
  const content = activeDrag.content;
  const bg = activeDrag.bg;
  const id = item.dataset.id;

  if (activeDrag.isHorizontal && dx >= SWIPE_THRESHOLD) {
    completeSwipeItem(item, id);
  } else if (!activeDrag.dirLocked || !activeDrag.isHorizontal) {
    // Tap: toggle worked-on
    toggleWorkedOn(item, id);
    resetSwipeItemPos(content, bg);
  } else {
    resetSwipeItemPos(content, bg);
  }

  activeDrag = null;
}

function resetSwipeItemPos(content, bg) {
  content.classList.add('returning');
  content.style.transform = '';
  bg.style.opacity = '0';
}

function completeSwipeItem(item, id) {
  swipeResults.workedOn = swipeResults.workedOn.filter(x => x !== id);
  swipeResults.completed.push(id);

  const content = item.querySelector('.swipe-item-content');
  content.style.transition = 'transform 0.3s ease-out';
  content.style.transform = 'translateX(110%)';
  item.classList.add('removing');

  setTimeout(() => {
    item.style.maxHeight = item.offsetHeight + 'px';
    // Force reflow
    item.offsetHeight;
    item.classList.add('removing');
  }, 250);

  setTimeout(() => { item.remove(); }, 500);

  const itemData = data.pool.find(p => p.id === id);
  showUndo(`「${itemData?.text || ''}」を完了`, () => {
    swipeResults.completed = swipeResults.completed.filter(x => x !== id);
    renderSwipeList();
  });
}

function toggleWorkedOn(item, id) {
  const idx = swipeResults.workedOn.indexOf(id);
  if (idx >= 0) {
    swipeResults.workedOn.splice(idx, 1);
    item.classList.remove('worked');
    const badge = item.querySelector('.swipe-item-badge');
    if (badge) badge.remove();
  } else {
    swipeResults.workedOn.push(id);
    item.classList.add('worked');
    const content = item.querySelector('.swipe-item-content');
    if (!content.querySelector('.swipe-item-badge')) {
      const badge = document.createElement('span');
      badge.className = 'swipe-item-badge';
      badge.textContent = '取り組んだ';
      content.appendChild(badge);
    }
  }
}

function finishSwipe() {
  const session = {
    id: activeSession.id,
    startedAt: activeSession.startedAt,
    endedAt: activeSession.endedAt || new Date().toISOString(),
    duration: activeSession.duration || 0,
    completed: [...swipeResults.completed],
    workedOn: [...swipeResults.workedOn],
    note: '',
  };

  data.sessions.unshift(session);

  swipeResults.completed.forEach(pid => {
    const item = data.pool.find(p => p.id === pid);
    if (item) {
      data.archive.push({
        id: item.id, text: item.text,
        completedAt: new Date().toISOString(),
      });
    }
  });
  data.pool = data.pool.filter(p => !swipeResults.completed.includes(p.id));

  swipeResults.workedOn.forEach(pid => {
    const item = data.pool.find(p => p.id === pid);
    if (item) item.workedCount = (item.workedCount || 0) + 1;
  });

  save();
  rebuildNameMap();
  activeSession = null;
  saveActiveSession();
  updatePracticeUI();
  renderPool();
  hideUndo();
  switchView('history');
}

/* ===== Undo Toast ===== */
function showUndo(msg, callback) {
  clearTimeout(undoTimer);
  dom.undoToastMsg.textContent = msg;
  dom.undoToast.classList.remove('hidden');
  dom.undoToastBtn.onclick = () => { callback(); hideUndo(); };
  undoTimer = setTimeout(hideUndo, 4000);
}

function hideUndo() {
  clearTimeout(undoTimer);
  dom.undoToast.classList.add('hidden');
}

/* ===== History ===== */
function renderHistory() {
  const list = dom.historyList;
  list.innerHTML = '';

  if (data.sessions.length === 0) {
    dom.historyEmpty.classList.remove('hidden');
    dom.totalTime.textContent = '';
    return;
  }

  dom.historyEmpty.classList.add('hidden');

  const totalSec = data.sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  dom.totalTime.textContent = `累計練習時間: ${formatDuration(totalSec)}`;

  data.sessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'session-card';

    const completedTags = (session.completed || []).map(pid =>
      `<span class="session-tag completed">${esc(getItemName(pid))}</span>`
    ).join('');

    const workedTags = (session.workedOn || []).map(pid =>
      `<span class="session-tag worked">${esc(getItemName(pid))}</span>`
    ).join('');

    card.innerHTML = `
      <div class="session-header">
        <span class="session-date">${formatDate(session.startedAt)}</span>
        <span class="session-duration">${formatDuration(session.duration)}</span>
      </div>
      <div class="session-summary">${buildSummary(session)}</div>
      <div class="session-tags">${completedTags}${workedTags}</div>
      <textarea class="session-note" placeholder="メモ" rows="1"
        data-session-id="${escAttr(session.id)}">${esc(session.note || '')}</textarea>
      <button class="session-delete" data-session-id="${escAttr(session.id)}">&times;</button>
    `;

    list.appendChild(card);
  });

  list.querySelectorAll('.session-note').forEach(ta => {
    autoResize(ta);
    ta.addEventListener('input', () => autoResize(ta));
    ta.addEventListener('blur', () => {
      const sid = ta.dataset.sessionId;
      const session = data.sessions.find(s => s.id === sid);
      if (session) { session.note = ta.value; save(); }
    });
  });
}

function buildSummary(session) {
  const c = (session.completed || []).length;
  const w = (session.workedOn || []).length;
  const parts = [];
  if (c > 0) parts.push(`${c}件 完了`);
  if (w > 0) parts.push(`${w}件 取り組み`);
  return parts.length === 0 ? '記録のみ' : parts.join('、');
}

function deleteSession(id) {
  showConfirm('このセッションを削除しますか？', () => {
    data.sessions = data.sessions.filter(s => s.id !== id);
    save();
    renderHistory();
  });
}

/* ===== Archive ===== */
function renderArchive() {
  const list = dom.archiveList;
  list.innerHTML = '';

  if (data.archive.length === 0) {
    dom.archiveEmpty.classList.remove('hidden');
    return;
  }

  dom.archiveEmpty.classList.add('hidden');

  [...data.archive].reverse().forEach(item => {
    const el = document.createElement('div');
    el.className = 'archive-item';
    el.innerHTML = `
      <span class="archive-item-text">${esc(item.text)}</span>
      <span class="archive-item-date">${formatShortDate(item.completedAt)}</span>
    `;
    list.appendChild(el);
  });
}

/* ===== Export / Import ===== */
function exportData() {
  const payload = {
    appName: 'violin-practice-log',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { pool: data.pool, sessions: data.sessions, archive: data.archive },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `practice-log_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (payload.appName !== 'violin-practice-log' || !payload.data) {
        alert('無効なファイルです');
        return;
      }
      if (!confirm('現在のデータを上書きしますか？')) return;
      data.pool = payload.data.pool || [];
      data.sessions = payload.data.sessions || [];
      data.archive = payload.data.archive || [];
      data.pool.forEach(p => { if (p.workedCount == null) p.workedCount = 0; });
      save();
      rebuildNameMap();
      renderPool();
      renderHistory();
      renderArchive();
      alert('インポート完了');
    } catch (e) {
      alert('ファイルの読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
}

/* ===== Session Recovery ===== */
function checkRecovery() {
  const saved = loadActiveSession();
  if (!saved) return;

  const elapsed = Math.round((Date.now() - new Date(saved.startedAt).getTime()) / 1000);
  dom.recoverInfo.textContent = `開始: ${formatDate(saved.startedAt)}（${formatDuration(elapsed)} 経過）`;
  dom.recoverDialog.classList.remove('hidden');

  dom.recoverResume.onclick = () => {
    activeSession = saved;
    dom.recoverDialog.classList.add('hidden');
    updatePracticeUI();
  };

  dom.recoverDiscard.onclick = () => {
    activeSession = null;
    saveActiveSession();
    dom.recoverDialog.classList.add('hidden');
    updatePracticeUI();
  };
}

/* ===== Helpers ===== */
function formatDuration(sec) {
  if (!sec || sec < 0) return '0分';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分`;
  return `${sec}秒`;
}

function formatDate(iso) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function formatShortDate(iso) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

/* ===== beforeunload ===== */
window.addEventListener('beforeunload', (e) => {
  if (activeSession) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ===== Event Bindings ===== */
function bindEvents() {
  dom.tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchView(tab.dataset.view);
  });

  dom.poolInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPoolItem(); }
  });

  dom.poolList.addEventListener('click', (e) => {
    const btn = e.target.closest('.pool-item-delete');
    if (btn) confirmDeletePoolItem(btn.dataset.id);
  });

  dom.practiceBtn.addEventListener('click', () => {
    if (activeSession) stopPractice();
    else startPractice();
  });

  dom.swipeDoneBtn.addEventListener('click', finishSwipe);

  initSwipeGestures();

  dom.historyList.addEventListener('click', (e) => {
    const btn = e.target.closest('.session-delete');
    if (btn) deleteSession(btn.dataset.sessionId);
  });

  dom.exportBtn.addEventListener('click', exportData);
  dom.importBtn.addEventListener('click', () => dom.importFile.click());
  dom.importFile.addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  load();
  rebuildNameMap();
  bindEvents();
  renderPool();
  updatePracticeUI();
  checkRecovery();
});
