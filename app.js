// app.js - 即売会バイヤー メインロジック
// ビュー管理・リスト操作・マップ操作・データ永続化を統括

const db = new DoujinDB();
let allCircles = [];
let allAreas = [];
let currentAreaId = null;
let pinMode = false;
let pendingPinPos = null;

// マップ状態
let mapScale = 1;
let mapX = 0, mapY = 0;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let lastMapPos = { x: 0, y: 0 };

// ステータス定義
const STATUS = {
  unbought: { label: '未購入', color: 'var(--blue)' },
  bought:   { label: '購入済み', color: 'var(--green)' },
  soldout:  { label: '売り切れ', color: 'var(--red)' },
  online:   { label: '通販', color: 'var(--purple)' }
};

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', async () => {
  await db.init();
  await loadAllData();
  setupEventListeners();
  renderList();
  renderAreaTabs();
  updateStats();
  // PWA登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});

async function loadAllData() {
  allCircles = await db.getAllCircles();
  allAreas = await db.getAllAreas();
}

// ===== タブ切替 =====
function setupEventListeners() {
  // ボトムタブ
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'settingsView') updateSettingsStats();
    });
  });

  // 検索 & フィルタ
  document.getElementById('searchInput').addEventListener('input', renderList);
  document.getElementById('filterStatus').addEventListener('change', renderList);
  document.getElementById('filterTarget').addEventListener('change', renderList);

  // FAB
  document.getElementById('fabAdd').addEventListener('click', () => openCircleModal());

  // サークルモーダル
  document.getElementById('btnCancelCircle').addEventListener('click', () => closeModal('circleModal'));
  document.getElementById('btnSaveCircle').addEventListener('click', saveCircle);
  document.getElementById('btnDeleteCircle').addEventListener('click', deleteCircle);

  // エリアモーダル
  document.getElementById('btnCancelArea').addEventListener('click', () => closeModal('areaModal'));
  document.getElementById('btnSaveArea').addEventListener('click', saveArea);
  document.getElementById('btnDeleteArea').addEventListener('click', deleteArea);

  // ピンモーダル
  document.getElementById('btnCancelPin').addEventListener('click', () => { closeModal('pinLinkModal'); pendingPinPos = null; });
  document.getElementById('btnSavePin').addEventListener('click', savePin);

  // マップ操作
  document.getElementById('btnPinMode').addEventListener('click', togglePinMode);
  document.getElementById('btnZoomIn').addEventListener('click', () => zoomMap(1.3));
  document.getElementById('btnZoomOut').addEventListener('click', () => zoomMap(0.7));
  document.getElementById('btnFitMap').addEventListener('click', fitMap);

  // マップタッチ/マウス操作
  const wrap = document.getElementById('mapImgWrap');
  wrap.addEventListener('pointerdown', onMapPointerDown);
  wrap.addEventListener('pointermove', onMapPointerMove);
  wrap.addEventListener('pointerup', onMapPointerUp);
  wrap.addEventListener('pointercancel', onMapPointerUp);

  // 設定
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', importData);
  document.getElementById('btnDeleteAll').addEventListener('click', deleteAllData);

  // モーダル背景クリックで閉じる
  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', (e) => { if (e.target === o) o.classList.remove('open'); });
  });
}

// ===== リストビュー =====
function renderList() {
  const query = document.getElementById('searchInput').value.toLowerCase();
  const statusF = document.getElementById('filterStatus').value;
  const targetF = document.getElementById('filterTarget').value;

  let filtered = allCircles.filter(c => {
    if (query && !c.name.toLowerCase().includes(query)) return false;
    if (statusF !== 'all' && c.status !== statusF) return false;
    if (targetF !== 'all' && c.target !== targetF) return false;
    return true;
  });

  // スペース番号順ソート
  filtered.sort((a, b) => (a.space || '').localeCompare(b.space || '', 'ja'));

  const container = document.getElementById('circleList');
  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">
      <div style="font-size:40px;margin-bottom:12px">📭</div>
      <p>${query || statusF !== 'all' || targetF !== 'all' ? '条件に一致するサークルがありません' : 'サークルを追加しましょう！'}</p></div>`;
    return;
  }

  container.innerHTML = filtered.map(c => {
    const area = allAreas.find(a => a.id === c.area);
    const areaName = area ? area.name : '';
    return `
    <div class="circle-card status-${c.status}" data-id="${c.id}" onclick="openCircleModal(${c.id})">
      <div class="cc-top">
        <span class="cc-name">${esc(c.name)}</span>
        <span class="cc-space">${esc(c.space || '未設定')}</span>
      </div>
      <div class="cc-tags">
        ${c.type === 'new' ? '<span class="cc-tag new">📕 新刊</span>' : '<span class="cc-tag">📗 既刊</span>'}
        ${c.target === 'friend' ? '<span class="cc-tag friend">🤝 友人分</span>' : ''}
        ${areaName ? `<span class="cc-tag">📍 ${esc(areaName)}</span>` : ''}
      </div>
      ${c.item ? `<div class="cc-item">📦 ${esc(c.item)}</div>` : ''}
      ${c.note ? `<div class="cc-note">💬 ${esc(c.note)}</div>` : ''}
      <div class="status-btns" onclick="event.stopPropagation()">
        ${Object.entries(STATUS).map(([k, v]) =>
          `<button class="status-btn ${c.status === k ? 'active' : ''}" data-s="${k}" onclick="setStatus(${c.id},'${k}')">${v.label}</button>`
        ).join('')}
      </div>
    </div>`;
  }).join('');
}

async function setStatus(id, status) {
  const c = allCircles.find(x => x.id === id);
  if (c) {
    c.status = status;
    await db.updateCircle(c);
    renderList();
    updateStats();
    renderMapPins();
  }
}

// ===== サークルモーダル =====
async function openCircleModal(id) {
  const modal = document.getElementById('circleModal');
  const title = document.getElementById('circleModalTitle');
  const delBtn = document.getElementById('btnDeleteCircle');

  // エリアセレクト更新
  const areaSelect = document.getElementById('fArea');
  areaSelect.innerHTML = '<option value="">未指定</option>' + allAreas.map(a =>
    `<option value="${a.id}">${esc(a.name)}</option>`
  ).join('');

  if (id) {
    const c = await db.getCircle(id);
    if (!c) return;
    title.textContent = 'サークルを編集';
    document.getElementById('editCircleId').value = c.id;
    document.getElementById('fCircleName').value = c.name;
    document.getElementById('fSpace').value = c.space || '';
    document.getElementById('fArea').value = c.area || '';
    document.getElementById('fItem').value = c.item || '';
    document.getElementById('fType').value = c.type || 'new';
    document.getElementById('fTarget').value = c.target || 'self';
    document.getElementById('fNote').value = c.note || '';
    delBtn.style.display = '';
  } else {
    title.textContent = 'サークルを追加';
    document.getElementById('editCircleId').value = '';
    document.getElementById('fCircleName').value = '';
    document.getElementById('fSpace').value = '';
    document.getElementById('fArea').value = currentAreaId || '';
    document.getElementById('fItem').value = '';
    document.getElementById('fType').value = 'new';
    document.getElementById('fTarget').value = 'self';
    document.getElementById('fNote').value = '';
    delBtn.style.display = 'none';
  }
  modal.classList.add('open');
}

async function saveCircle() {
  const name = document.getElementById('fCircleName').value.trim();
  if (!name) { showToast('サークル名を入力してください'); return; }
  const idVal = document.getElementById('editCircleId').value;
  const areaVal = document.getElementById('fArea').value;
  const data = {
    name,
    space: document.getElementById('fSpace').value.trim(),
    area: areaVal ? Number(areaVal) : null,
    item: document.getElementById('fItem').value.trim(),
    type: document.getElementById('fType').value,
    target: document.getElementById('fTarget').value,
    note: document.getElementById('fNote').value.trim(),
    status: 'unbought'
  };
  if (idVal) {
    const existing = await db.getCircle(Number(idVal));
    data.id = Number(idVal);
    data.status = existing ? existing.status : 'unbought';
  }
  await db.addCircle(data);
  await loadAllData();
  renderList();
  updateStats();
  renderMapPins();
  closeModal('circleModal');
  showToast(idVal ? '更新しました' : '追加しました');
}

async function deleteCircle() {
  const idVal = document.getElementById('editCircleId').value;
  if (!idVal) return;
  if (!confirm('このサークルを削除しますか？')) return;
  // 紐づくピンも削除
  if (currentAreaId) {
    const pins = await db.getPinsByArea(currentAreaId);
    for (const p of pins) { if (p.circleId === Number(idVal)) await db.deletePin(p.id); }
  }
  await db.deleteCircle(Number(idVal));
  await loadAllData();
  renderList();
  updateStats();
  renderMapPins();
  closeModal('circleModal');
  showToast('削除しました');
}

// ===== エリアタブ =====
function renderAreaTabs() {
  const container = document.getElementById('areaTabs');
  container.innerHTML = allAreas.map(a => {
    const count = allCircles.filter(c => c.area === a.id).length;
    return `<button class="area-tab ${a.id === currentAreaId ? 'active' : ''}" data-id="${a.id}" onclick="selectArea(${a.id})">
      ${esc(a.name)}<span class="area-count">(${count})</span>
    </button>`;
  }).join('') + `<button class="add-area-btn" onclick="openAreaModal()">＋</button>`;

  // エリアが1つもない場合、マップにプレースホルダー表示
  if (allAreas.length === 0) {
    document.getElementById('mapPlaceholder').style.display = '';
    document.getElementById('mapPlaceholder').querySelector('p').innerHTML = 'エリアを追加して<br>マップ画像を設定しましょう';
    document.getElementById('mapImgWrap').style.display = 'none';
    document.getElementById('mapTools').style.display = 'none';
  } else if (!currentAreaId && allAreas.length > 0) {
    selectArea(allAreas[0].id);
  }
}

async function selectArea(areaId) {
  currentAreaId = areaId;
  document.querySelectorAll('.area-tab').forEach(t => t.classList.toggle('active', Number(t.dataset.id) === areaId));
  const area = allAreas.find(a => a.id === areaId);
  if (area && area.mapImage) {
    document.getElementById('mapPlaceholder').style.display = 'none';
    document.getElementById('mapImgWrap').style.display = '';
    document.getElementById('mapTools').style.display = '';
    const img = document.getElementById('mapImg');
    img.src = area.mapImage;
    img.onload = () => { fitMap(); renderMapPins(); };
  } else {
    document.getElementById('mapPlaceholder').style.display = '';
    document.getElementById('mapPlaceholder').querySelector('p').innerHTML = area
      ? `「${esc(area.name)}」にマップ画像が未設定です<br><button onclick="openAreaModal(${areaId})" style="background:var(--accent);color:#fff;padding:10px 20px;border:none;border-radius:12px;margin-top:8px;font-weight:600">画像を設定</button>`
      : 'エリアを追加してください';
    document.getElementById('mapImgWrap').style.display = 'none';
    document.getElementById('mapTools').style.display = 'none';
  }
  renderMapPins();
}

// ===== エリアモーダル =====
async function openAreaModal(id) {
  const modal = document.getElementById('areaModal');
  const title = document.getElementById('areaModalTitle');
  const delBtn = document.getElementById('btnDeleteArea');
  if (id) {
    const area = allAreas.find(a => a.id === id);
    if (!area) return;
    title.textContent = 'エリアを編集';
    document.getElementById('editAreaId').value = area.id;
    document.getElementById('fAreaName').value = area.name;
    delBtn.style.display = '';
  } else {
    title.textContent = 'エリアを追加';
    document.getElementById('editAreaId').value = '';
    document.getElementById('fAreaName').value = '';
    delBtn.style.display = 'none';
  }
  document.getElementById('fAreaMap').value = '';
  modal.classList.add('open');
}

async function saveArea() {
  const name = document.getElementById('fAreaName').value.trim();
  if (!name) { showToast('エリア名を入力してください'); return; }
  const idVal = document.getElementById('editAreaId').value;
  const fileInput = document.getElementById('fAreaMap');
  let mapImage = null;

  if (fileInput.files.length > 0) {
    mapImage = await fileToBase64(fileInput.files[0]);
  } else if (idVal) {
    const existing = allAreas.find(a => a.id === Number(idVal));
    mapImage = existing ? existing.mapImage : null;
  }

  const data = { name, mapImage };
  if (idVal) data.id = Number(idVal);
  await db.addArea(data);
  await loadAllData();
  renderAreaTabs();
  if (idVal) selectArea(Number(idVal));
  else if (allAreas.length > 0) selectArea(allAreas[allAreas.length - 1].id);
  // サークルモーダルのエリアセレクトも更新
  closeModal('areaModal');
  showToast(idVal ? '更新しました' : 'エリアを追加しました');
}

async function deleteArea() {
  const idVal = document.getElementById('editAreaId').value;
  if (!idVal || !confirm('このエリアと紐づくデータを削除しますか？')) return;
  await db.deleteArea(Number(idVal));
  currentAreaId = null;
  await loadAllData();
  renderAreaTabs();
  renderList();
  updateStats();
  closeModal('areaModal');
  showToast('エリアを削除しました');
}

// ===== マップ操作 =====
function fitMap() {
  const container = document.getElementById('mapContainer');
  const img = document.getElementById('mapImg');
  if (!img.naturalWidth) return;
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  mapScale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
  mapX = (cw - img.naturalWidth * mapScale) / 2;
  mapY = (ch - img.naturalHeight * mapScale) / 2;
  applyMapTransform();
}

function zoomMap(factor) {
  const container = document.getElementById('mapContainer');
  const cx = container.clientWidth / 2;
  const cy = container.clientHeight / 2;
  mapX = cx - (cx - mapX) * factor;
  mapY = cy - (cy - mapY) * factor;
  mapScale *= factor;
  applyMapTransform();
}

function applyMapTransform() {
  const img = document.getElementById('mapImg');
  img.style.transform = `translate(${mapX}px, ${mapY}px) scale(${mapScale})`;
  updatePinPositions();
}

// ポインター操作（パン）
const pointers = new Map();
let lastPinchDist = 0;

function onMapPointerDown(e) {
  if (pinMode && pointers.size === 0) {
    // ピン配置モード
    const rect = document.getElementById('mapContainer').getBoundingClientRect();
    const imgX = (e.clientX - rect.left - mapX) / mapScale;
    const imgY = (e.clientY - rect.top - mapY) / mapScale;
    const img = document.getElementById('mapImg');
    if (imgX >= 0 && imgX <= img.naturalWidth && imgY >= 0 && imgY <= img.naturalHeight) {
      pendingPinPos = { x: imgX / img.naturalWidth, y: imgY / img.naturalHeight };
      openPinLinkModal();
    }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    lastMapPos = { x: mapX, y: mapY };
  }
  if (pointers.size === 2) {
    const pts = [...pointers.values()];
    lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  }
  e.target.setPointerCapture(e.pointerId);
}

function onMapPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1 && isDragging) {
    mapX = lastMapPos.x + (e.clientX - dragStart.x);
    mapY = lastMapPos.y + (e.clientY - dragStart.y);
    applyMapTransform();
  }
  if (pointers.size === 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (lastPinchDist > 0) {
      const factor = dist / lastPinchDist;
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const rect = document.getElementById('mapContainer').getBoundingClientRect();
      const mx = cx - rect.left, my = cy - rect.top;
      mapX = mx - (mx - mapX) * factor;
      mapY = my - (my - mapY) * factor;
      mapScale *= factor;
      applyMapTransform();
    }
    lastPinchDist = dist;
  }
}

function onMapPointerUp(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) lastPinchDist = 0;
  if (pointers.size === 0) isDragging = false;
}

function togglePinMode() {
  pinMode = !pinMode;
  document.getElementById('btnPinMode').classList.toggle('active', pinMode);
  showToast(pinMode ? 'ピン配置モード ON: マップをタップしてピンを配置' : 'ピン配置モード OFF');
}

// ===== ピン表示 =====
async function renderMapPins() {
  // 既存ピンを削除
  document.querySelectorAll('.map-pin').forEach(p => p.remove());
  document.getElementById('pinPopup').classList.remove('open');
  if (!currentAreaId) return;

  const pins = await db.getPinsByArea(currentAreaId);
  for (const pin of pins) {
    const circle = pin.circleId ? allCircles.find(c => c.id === pin.circleId) : null;
    const el = document.createElement('div');
    el.className = `map-pin status-${circle ? circle.status : 'unbought'}`;
    el.dataset.pinId = pin.id;
    el.dataset.rx = pin.x;
    el.dataset.ry = pin.y;
    el.innerHTML = `<span class="pin-label">${circle ? esc(circle.name) : '未紐付け'}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); showPinPopup(pin, circle, el); });
    document.getElementById('mapImgWrap').appendChild(el);
  }
  updatePinPositions();
}

function updatePinPositions() {
  document.querySelectorAll('.map-pin').forEach(el => {
    const img = document.getElementById('mapImg');
    const rx = parseFloat(el.dataset.rx);
    const ry = parseFloat(el.dataset.ry);
    el.style.left = (mapX + rx * img.naturalWidth * mapScale) + 'px';
    el.style.top = (mapY + ry * img.naturalHeight * mapScale) + 'px';
  });
}

function showPinPopup(pin, circle, pinEl) {
  const popup = document.getElementById('pinPopup');
  const rect = pinEl.getBoundingClientRect();
  const containerRect = document.getElementById('mapContainer').getBoundingClientRect();

  popup.innerHTML = circle
    ? `<div class="pp-name">${esc(circle.name)}</div>
       <div class="pp-space">${esc(circle.space || '')} ${circle.type === 'new' ? '📕新刊' : '📗既刊'} ${circle.target === 'friend' ? '🤝友人分' : ''}</div>
       <div class="status-btns">
         ${Object.entries(STATUS).map(([k, v]) =>
           `<button class="status-btn ${circle.status === k ? 'active' : ''}" data-s="${k}" onclick="setStatus(${circle.id},'${k}');renderMapPins()">${v.label}</button>`
         ).join('')}
       </div>
       <button style="margin-top:8px;color:var(--red);font-size:12px" onclick="deletePinById(${pin.id})">🗑 ピンを削除</button>`
    : `<div class="pp-name">未紐付けピン</div>
       <button style="color:var(--red);font-size:12px" onclick="deletePinById(${pin.id})">🗑 削除</button>`;

  popup.style.left = (rect.left - containerRect.left) + 'px';
  popup.style.top = (rect.bottom - containerRect.top + 8) + 'px';
  popup.classList.add('open');

  // 外側クリックで閉じる
  setTimeout(() => {
    const handler = (e) => { if (!popup.contains(e.target) && !pinEl.contains(e.target)) { popup.classList.remove('open'); document.removeEventListener('click', handler); }};
    document.addEventListener('click', handler);
  }, 100);
}

async function deletePinById(id) {
  await db.deletePin(id);
  renderMapPins();
  showToast('ピンを削除しました');
}

// ===== ピン紐付けモーダル =====
function openPinLinkModal() {
  const select = document.getElementById('fPinCircle');
  const areaCircles = allCircles.filter(c => !c.area || c.area === currentAreaId);
  select.innerHTML = '<option value="">（紐付けなし）</option>' + areaCircles.map(c =>
    `<option value="${c.id}">${esc(c.name)} [${esc(c.space || '?')}]</option>`
  ).join('');
  document.getElementById('pinLinkModal').classList.add('open');
}

async function savePin() {
  if (!pendingPinPos || !currentAreaId) return;
  const circleIdVal = document.getElementById('fPinCircle').value;
  await db.addPin({
    areaId: currentAreaId,
    x: pendingPinPos.x,
    y: pendingPinPos.y,
    circleId: circleIdVal ? Number(circleIdVal) : null
  });
  pendingPinPos = null;
  pinMode = false;
  document.getElementById('btnPinMode').classList.remove('active');
  closeModal('pinLinkModal');
  renderMapPins();
  showToast('ピンを配置しました');
}

// ===== 統計 =====
function updateStats() {
  const total = allCircles.length;
  const bought = allCircles.filter(c => c.status === 'bought').length;
  document.getElementById('headerStats').textContent = `${bought} / ${total} 購入済み`;
}

function updateSettingsStats() {
  const total = allCircles.length;
  const bought = allCircles.filter(c => c.status === 'bought').length;
  const soldout = allCircles.filter(c => c.status === 'soldout').length;
  const online = allCircles.filter(c => c.status === 'online').length;
  const selfCount = allCircles.filter(c => c.target === 'self').length;
  const friendCount = allCircles.filter(c => c.target === 'friend').length;
  document.getElementById('settingsStats').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px">
      <div>📋 登録数: <b>${total}</b></div>
      <div>✅ 購入済み: <b style="color:var(--green)">${bought}</b></div>
      <div>❌ 売り切れ: <b style="color:var(--red)">${soldout}</b></div>
      <div>📦 通販: <b style="color:var(--purple)">${online}</b></div>
      <div>🙋 自分用: <b>${selfCount}</b></div>
      <div>🤝 友人分: <b>${friendCount}</b></div>
      <div>🗺️ エリア数: <b>${allAreas.length}</b></div>
    </div>`;
}

// ===== データ import/export =====
async function exportData() {
  const data = { circles: allCircles, areas: allAreas.map(a => ({...a, mapImage: a.mapImage || null})) };
  // ピンも全エリア分
  const allPins = [];
  for (const a of allAreas) {
    const pins = await db.getPinsByArea(a.id);
    allPins.push(...pins);
  }
  data.pins = allPins;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `doujin-buyer-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('データをエクスポートしました');
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!confirm('現在のデータを上書きしますか？')) return;
    // 全削除
    for (const c of allCircles) await db.deleteCircle(c.id);
    for (const a of allAreas) await db.deleteArea(a.id);
    // インポート
    for (const a of (data.areas || [])) await db.addArea(a);
    for (const c of (data.circles || [])) await db.addCircle(c);
    for (const p of (data.pins || [])) await db.addPin(p);
    currentAreaId = null;
    await loadAllData();
    renderList();
    renderAreaTabs();
    updateStats();
    showToast('データをインポートしました');
  } catch (err) {
    showToast('インポートに失敗しました');
  }
  e.target.value = '';
}

async function deleteAllData() {
  if (!confirm('全データを削除します。よろしいですか？')) return;
  if (!confirm('本当に削除しますか？この操作は元に戻せません。')) return;
  for (const c of allCircles) await db.deleteCircle(c.id);
  for (const a of allAreas) await db.deleteArea(a.id);
  currentAreaId = null;
  await loadAllData();
  renderList();
  renderAreaTabs();
  updateStats();
  showToast('全データを削除しました');
}

// ===== ユーティリティ =====
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
