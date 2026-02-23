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
    poolAddBtn: $('#pool-add-btn'),
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

function addPoolItems() {
  const text = dom.poolInput.value.trim();
  if (!text) return;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach(line => {
    data.pool.push({
      id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      text: line,
      createdAt: new Date().toISOString(),
      workedCount: 0,
    });
  });

  save();
  rebuildNameMap();
  renderPool();
  dom.poolInput.value = '';
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
      <div class="swipe-item-bg bg-right"><span>完了 ✓</span></div>
      <div class="swipe-item-bg bg-left"><span>取り組んだ</span></div>
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
    bgRight: item.querySelector('.bg-right'),
    bgLeft: item.querySelector('.bg-left'),
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
  activeDrag.content.style.transform = `translateX(${dx}px)`;

  if (dx > 0) {
    activeDrag.bgRight.style.opacity = Math.min(1, dx / SWIPE_THRESHOLD);
    activeDrag.bgLeft.style.opacity = '0';
  } else {
    activeDrag.bgLeft.style.opacity = Math.min(1, -dx / SWIPE_THRESHOLD);
    activeDrag.bgRight.style.opacity = '0';
  }
}

function onSwipeDragEnd() {
  if (!activeDrag) return;

  const dx = activeDrag.currentX - activeDrag.startX;
  const item = activeDrag.el;
  const id = item.dataset.id;

  if (activeDrag.isHorizontal && dx >= SWIPE_THRESHOLD) {
    completeSwipeItem(item, id);
  } else if (activeDrag.isHorizontal && dx <= -SWIPE_THRESHOLD) {
    workedOnSwipeItem(item, id);
  } else {
    resetSwipeItemPos();
  }

  activeDrag = null;
}

function resetSwipeItemPos() {
  if (!activeDrag) return;
  activeDrag.content.classList.add('returning');
  activeDrag.content.style.transform = '';
  activeDrag.bgRight.style.opacity = '0';
  activeDrag.bgLeft.style.opacity = '0';
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

function workedOnSwipeItem(item, id) {
  if (!swipeResults.workedOn.includes(id)) {
    swipeResults.workedOn.push(id);
  }

  const content = item.querySelector('.swipe-item-content');

  // Animate: snap left briefly, then bounce back with orange border
  content.style.transition = 'transform 0.2s ease-out';
  content.style.transform = 'translateX(-40px)';

  setTimeout(() => {
    content.style.transition = 'transform 0.25s ease';
    content.style.transform = '';
    item.classList.add('worked');

    if (!content.querySelector('.swipe-item-badge')) {
      const badge = document.createElement('span');
      badge.className = 'swipe-item-badge';
      badge.textContent = '取り組んだ';
      content.appendChild(badge);
    }

    // Reset bg
    item.querySelector('.bg-left').style.opacity = '0';
    item.querySelector('.bg-right').style.opacity = '0';
  }, 200);
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

    let tagsHtml = '';

    if ((session.completed || []).length > 0) {
      const tags = session.completed.map(pid =>
        `<span class="session-tag completed">${esc(getItemName(pid))}</span>`
      ).join('');
      tagsHtml += `
        <div class="session-group">
          <div class="session-group-label completed">✓ 完了</div>
          <div class="session-tags">${tags}</div>
        </div>`;
    }

    if ((session.workedOn || []).length > 0) {
      const tags = session.workedOn.map(pid =>
        `<span class="session-tag worked">${esc(getItemName(pid))}</span>`
      ).join('');
      tagsHtml += `
        <div class="session-group">
          <div class="session-group-label worked">→ 取り組んだ</div>
          <div class="session-tags">${tags}</div>
        </div>`;
    }

    const shareIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';

    card.innerHTML = `
      <div class="session-header">
        <span class="session-date">${formatDate(session.startedAt)}</span>
        <span class="session-duration">${formatDuration(session.duration)}</span>
      </div>
      ${tagsHtml}
      <textarea class="session-note" placeholder="メモ" rows="1"
        data-session-id="${escAttr(session.id)}">${esc(session.note || '')}</textarea>
      <div class="session-actions-row">
        <button class="session-share" data-session-id="${escAttr(session.id)}">${shareIcon} 共有</button>
      </div>
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

function shareSession(id) {
  const session = data.sessions.find(s => s.id === id);
  if (!session) return;

  let text = `🎻 練習記録 ${formatDate(session.startedAt)}\n`;
  text += `⏱ ${formatDuration(session.duration)}\n`;

  if ((session.completed || []).length > 0) {
    text += `\n✓ 完了:\n`;
    session.completed.forEach(pid => { text += `  ${getItemName(pid)}\n`; });
  }
  if ((session.workedOn || []).length > 0) {
    text += `\n→ 取り組んだ:\n`;
    session.workedOn.forEach(pid => { text += `  ${getItemName(pid)}\n`; });
  }
  if (session.note) {
    text += `\n📝 ${session.note}\n`;
  }

  navigator.clipboard.writeText(text.trim()).then(() => {
    showUndo('クリップボードにコピーしました', () => {});
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text.trim();
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showUndo('クリップボードにコピーしました', () => {});
  });
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

  const workedItems = data.pool.filter(p => (p.workedCount || 0) > 0);
  const hasCompleted = data.archive.length > 0;
  const hasWorked = workedItems.length > 0;

  if (!hasCompleted && !hasWorked) {
    dom.archiveEmpty.classList.remove('hidden');
    return;
  }

  dom.archiveEmpty.classList.add('hidden');

  // Worked-on section (still in pool)
  if (hasWorked) {
    const label = document.createElement('div');
    label.className = 'archive-section-label worked';
    label.textContent = `→ 取り組み中（${workedItems.length}）`;
    list.appendChild(label);

    workedItems.forEach(item => {
      const el = document.createElement('div');
      el.className = 'archive-item worked';
      el.innerHTML = `
        <span class="archive-item-text">${esc(item.text)}</span>
        <div class="archive-item-meta">
          <span class="archive-item-count">${item.workedCount}回</span>
        </div>
      `;
      list.appendChild(el);
    });
  }

  // Completed section
  if (hasCompleted) {
    const label = document.createElement('div');
    label.className = 'archive-section-label completed';
    label.textContent = `✓ 完了（${data.archive.length}）`;
    list.appendChild(label);

    [...data.archive].reverse().forEach(item => {
      const el = document.createElement('div');
      el.className = 'archive-item completed';
      el.innerHTML = `
        <span class="archive-item-text">${esc(item.text)}</span>
        <div class="archive-item-meta">
          <span class="archive-item-date">${formatShortDate(item.completedAt)}</span>
        </div>
      `;
      list.appendChild(el);
    });
  }
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

  dom.poolAddBtn.addEventListener('click', addPoolItems);

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
    const delBtn = e.target.closest('.session-delete');
    if (delBtn) { deleteSession(delBtn.dataset.sessionId); return; }
    const shareBtn = e.target.closest('.session-share');
    if (shareBtn) { shareSession(shareBtn.dataset.sessionId); return; }
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
