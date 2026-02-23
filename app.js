/* ===== Selectors ===== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ===== State ===== */
const STORAGE_KEY = 'violin-practice-log';

let data = { version: 1, pool: [], sessions: [], archive: [] };
let activeSession = null;   // { id, startedAt } — persisted to sessionStorage
let swipeQueue = [];         // pool items to swipe through
let swipeIndex = 0;
let swipeResults = { completed: [], workedOn: [] };

/* ===== DOM Cache ===== */
let dom = {};

function cacheDom() {
  dom = {
    // Views
    viewPool: $('#view-pool'),
    viewSwipe: $('#view-swipe'),
    viewHistory: $('#view-history'),
    viewArchive: $('#view-archive'),
    // Tabs
    tabBar: $('#tab-bar'),
    tabs: $$('.tab'),
    tabDotPool: $('#tab-dot-pool'),
    // Pool
    poolList: $('#pool-list'),
    poolInput: $('#pool-input'),
    poolAddBtn: $('#pool-add-btn'),
    practiceBtn: $('#practice-btn'),
    practiceIndicator: $('#practice-indicator'),
    // Swipe
    swipeArea: $('#swipe-area'),
    swipeCard: $('#swipe-card'),
    swipeCardText: $('#swipe-card-text'),
    swipeSkipBtn: $('#swipe-skip-btn'),
    swipeDoneBtn: $('#swipe-done-btn'),
    swipeProgress: $('#swipe-progress'),
    // History
    totalTime: $('#total-time'),
    historyList: $('#history-list'),
    historyEmpty: $('#history-empty'),
    // Archive
    archiveList: $('#archive-list'),
    archiveEmpty: $('#archive-empty'),
    exportBtn: $('#export-btn'),
    importBtn: $('#import-btn'),
    importFile: $('#import-file'),
    // Recover
    recoverDialog: $('#recover-dialog'),
    recoverInfo: $('#recover-info'),
    recoverResume: $('#recover-resume'),
    recoverDiscard: $('#recover-discard'),
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
  } catch (e) { /* use default */ }
}

function saveSession() {
  if (activeSession) {
    sessionStorage.setItem('practice-active', JSON.stringify(activeSession));
  } else {
    sessionStorage.removeItem('practice-active');
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem('practice-active');
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

/* ===== Tab Navigation ===== */
function switchView(name) {
  // Don't allow switching to swipe directly from tab bar
  const views = { pool: dom.viewPool, history: dom.viewHistory, archive: dom.viewArchive, swipe: dom.viewSwipe };
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
    el.innerHTML = `
      <span class="pool-item-text">${esc(item.text)}</span>
      <button class="pool-item-delete" data-id="${item.id}">&times;</button>
    `;
    list.appendChild(el);
  });
}

function addPoolItems() {
  const text = dom.poolInput.value.trim();
  if (!text) return;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach(line => {
    data.pool.push({
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      text: line,
      createdAt: new Date().toISOString(),
    });
  });

  save();
  renderPool();
  dom.poolInput.value = '';
  dom.poolInput.style.height = 'auto';
}

function deletePoolItem(id) {
  data.pool = data.pool.filter(p => p.id !== id);
  save();
  renderPool();
}

/* ===== Practice Start / Stop ===== */
function startPractice() {
  activeSession = {
    id: 's_' + Date.now(),
    startedAt: new Date().toISOString(),
  };
  saveSession();
  updatePracticeUI();
}

function stopPractice() {
  if (!activeSession) return;

  const endedAt = new Date().toISOString();
  const duration = Math.round((new Date(endedAt) - new Date(activeSession.startedAt)) / 1000);

  activeSession.endedAt = endedAt;
  activeSession.duration = duration;

  // Enter swipe mode
  beginSwipe();
}

function updatePracticeUI() {
  const running = !!activeSession;
  dom.practiceBtn.textContent = running ? '練習ストップ' : '練習スタート';
  dom.practiceBtn.classList.toggle('recording', running);
  dom.practiceIndicator.classList.toggle('hidden', !running);

  // Red dot on pool tab when practicing and on another view
  dom.tabDotPool.classList.toggle('hidden', !running);
}

/* ===== Swipe ===== */
function beginSwipe() {
  swipeQueue = [...data.pool];
  swipeIndex = 0;
  swipeResults = { completed: [], workedOn: [] };

  if (swipeQueue.length === 0) {
    finishSwipe();
    return;
  }

  switchView('swipe');
  showSwipeCard();
}

function showSwipeCard() {
  if (swipeIndex >= swipeQueue.length) {
    showSwipeEmpty();
    return;
  }

  const item = swipeQueue[swipeIndex];
  dom.swipeCardText.textContent = item.text;
  dom.swipeCard.className = 'swipe-card';
  dom.swipeCard.style.transform = '';
  dom.swipeCard.style.borderColor = '';
  dom.swipeProgress.textContent = `${swipeIndex + 1} / ${swipeQueue.length}`;
}

function showSwipeEmpty() {
  dom.swipeCardText.textContent = 'すべて仕分け済み';
  dom.swipeCard.className = 'swipe-card empty';
  dom.swipeCard.style.transform = '';
  dom.swipeCard.style.borderColor = '';
  dom.swipeProgress.textContent = '';
}

function swipeRight() {
  const item = swipeQueue[swipeIndex];
  if (!item) return;
  swipeResults.completed.push(item.id);
  flyCard('right', () => { swipeIndex++; showSwipeCard(); });
}

function swipeLeft() {
  const item = swipeQueue[swipeIndex];
  if (!item) return;
  swipeResults.workedOn.push(item.id);
  flyCard('left', () => { swipeIndex++; showSwipeCard(); });
}

function swipeSkip() {
  if (swipeIndex >= swipeQueue.length) return;
  // No animation, just advance
  swipeIndex++;
  showSwipeCard();
}

function flyCard(direction, cb) {
  const card = dom.swipeCard;
  card.classList.add(direction === 'right' ? 'fly-right' : 'fly-left');
  setTimeout(() => {
    card.classList.remove('fly-right', 'fly-left');
    cb();
  }, 350);
}

function finishSwipe() {
  // Build session
  const session = {
    id: activeSession.id,
    startedAt: activeSession.startedAt,
    endedAt: activeSession.endedAt,
    duration: activeSession.duration,
    completed: swipeResults.completed,
    workedOn: swipeResults.workedOn,
    note: '',
  };

  data.sessions.unshift(session);

  // Move completed items to archive
  swipeResults.completed.forEach(pid => {
    const item = data.pool.find(p => p.id === pid);
    if (item) {
      data.archive.push({
        id: item.id,
        text: item.text,
        completedAt: new Date().toISOString(),
      });
    }
  });
  data.pool = data.pool.filter(p => !swipeResults.completed.includes(p.id));

  save();
  activeSession = null;
  saveSession();
  updatePracticeUI();
  renderPool();
  switchView('history');
}

/* ===== Swipe Gesture (Touch + Mouse) ===== */
let dragState = null;

function initSwipeGestures() {
  const card = dom.swipeCard;
  const area = dom.swipeArea;

  // Touch
  area.addEventListener('touchstart', onDragStart, { passive: true });
  area.addEventListener('touchmove', onDragMove, { passive: false });
  area.addEventListener('touchend', onDragEnd);

  // Mouse
  area.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function getPointerX(e) {
  if (e.touches) return e.touches[0].clientX;
  return e.clientX;
}

function onDragStart(e) {
  if (swipeIndex >= swipeQueue.length) return;
  if (dom.swipeCard.classList.contains('fly-right') || dom.swipeCard.classList.contains('fly-left')) return;

  const x = getPointerX(e);
  dragState = { startX: x, currentX: x };
  dom.swipeCard.classList.remove('returning');
}

function onDragMove(e) {
  if (!dragState) return;
  if (e.cancelable) e.preventDefault();

  dragState.currentX = getPointerX(e);
  const dx = dragState.currentX - dragState.startX;
  const rotation = dx * 0.08;
  const maxRot = 25;
  const clampedRot = Math.max(-maxRot, Math.min(maxRot, rotation));

  dom.swipeCard.style.transform = `translateX(${dx}px) rotate(${clampedRot}deg)`;

  // Color feedback
  const threshold = 60;
  if (dx > threshold) {
    dom.swipeCard.style.borderColor = `var(--ok)`;
  } else if (dx < -threshold) {
    dom.swipeCard.style.borderColor = `var(--warn)`;
  } else {
    dom.swipeCard.style.borderColor = '';
  }
}

function onDragEnd() {
  if (!dragState) return;

  const dx = dragState.currentX - dragState.startX;
  const swipeThreshold = 100;

  if (dx > swipeThreshold) {
    swipeRight();
  } else if (dx < -swipeThreshold) {
    swipeLeft();
  } else {
    // Return to center
    dom.swipeCard.classList.add('returning');
    dom.swipeCard.style.transform = '';
    dom.swipeCard.style.borderColor = '';
  }

  dragState = null;
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

  // Total time
  const totalSec = data.sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  dom.totalTime.textContent = `累計練習時間: ${formatDuration(totalSec)}`;

  data.sessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'session-card';

    const completedTags = (session.completed || []).map(pid => {
      const name = findItemName(pid);
      return `<span class="session-tag completed">${esc(name)}</span>`;
    }).join('');

    const workedTags = (session.workedOn || []).map(pid => {
      const name = findItemName(pid);
      return `<span class="session-tag worked">${esc(name)}</span>`;
    }).join('');

    const summary = buildSummary(session);

    card.innerHTML = `
      <div class="session-header">
        <span class="session-date">${formatDate(session.startedAt)}</span>
        <span class="session-duration">${formatDuration(session.duration)}</span>
      </div>
      <div class="session-summary">${summary}</div>
      <div>${completedTags}${workedTags}</div>
      <textarea class="session-note" placeholder="メモ" rows="1"
        data-session-id="${session.id}">${esc(session.note || '')}</textarea>
    `;

    list.appendChild(card);
  });

  // Auto-resize and blur-save for note textareas
  list.querySelectorAll('.session-note').forEach(ta => {
    autoResize(ta);
    ta.addEventListener('input', () => autoResize(ta));
    ta.addEventListener('blur', () => {
      const sid = ta.dataset.sessionId;
      const session = data.sessions.find(s => s.id === sid);
      if (session) {
        session.note = ta.value;
        save();
      }
    });
  });
}

function buildSummary(session) {
  const c = (session.completed || []).length;
  const w = (session.workedOn || []).length;
  const parts = [];
  if (c > 0) parts.push(`${c}件 完了`);
  if (w > 0) parts.push(`${w}件 取り組み`);
  if (parts.length === 0) return '記録のみ';
  return parts.join('、');
}

function findItemName(pid) {
  const inPool = data.pool.find(p => p.id === pid);
  if (inPool) return inPool.text;
  const inArchive = data.archive.find(a => a.id === pid);
  if (inArchive) return inArchive.text;
  return '(削除済み)';
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

  // Show newest first
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
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `practice-log_${dateStr}.json`;
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
      save();
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
  const saved = loadSession();
  if (!saved) return;

  const started = new Date(saved.startedAt);
  const elapsed = Math.round((Date.now() - started.getTime()) / 1000);
  dom.recoverInfo.textContent = `開始: ${formatDate(saved.startedAt)}（${formatDuration(elapsed)} 経過）`;
  dom.recoverDialog.classList.remove('hidden');

  dom.recoverResume.onclick = () => {
    activeSession = saved;
    dom.recoverDialog.classList.add('hidden');
    updatePracticeUI();
  };

  dom.recoverDiscard.onclick = () => {
    activeSession = null;
    saveSession();
    dom.recoverDialog.classList.add('hidden');
    updatePracticeUI();
  };
}

/* ===== Helpers ===== */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

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
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

/* ===== Event Bindings ===== */
function bindEvents() {
  // Tab bar
  dom.tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchView(tab.dataset.view);
  });

  // Pool add
  dom.poolAddBtn.addEventListener('click', addPoolItems);
  dom.poolInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addPoolItems();
    }
  });

  // Pool delete (delegated)
  dom.poolList.addEventListener('click', (e) => {
    const btn = e.target.closest('.pool-item-delete');
    if (btn) deletePoolItem(btn.dataset.id);
  });

  // Practice start/stop
  dom.practiceBtn.addEventListener('click', () => {
    if (activeSession) {
      stopPractice();
    } else {
      startPractice();
    }
  });

  // Swipe buttons
  dom.swipeSkipBtn.addEventListener('click', swipeSkip);
  dom.swipeDoneBtn.addEventListener('click', finishSwipe);

  // Swipe gestures
  initSwipeGestures();

  // Export / Import
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
  bindEvents();
  renderPool();
  updatePracticeUI();
  checkRecovery();
});
