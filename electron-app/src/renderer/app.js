const { ipcRenderer } = require('electron');

const API = 'https://cosmolauncher-api.onrender.com/api';

let appVersion = '1.0.1';
ipcRenderer.invoke('get-app-version').then(v => {
  appVersion = v;
  // Показать версию в настройках
  const el = document.getElementById('app-version-display');
  if (el) el.textContent = `v${v}`;
});

let currentUser    = null;
let isLaunching    = false;
let allVersions    = [];
let consoleLines   = 0;
let profiles       = [];
let activeProfile  = null;
let editingProfile = null; // ID профиля при редактировании

// ─── Init ─────────────────────────────────────────

// ─── Auto Updater ─────────────────────────────────
function initUpdater() {
  const banner      = document.getElementById('update-banner');
  const title       = document.getElementById('update-title');
  const subtitle    = document.getElementById('update-subtitle');
  const btnDownload = document.getElementById('update-btn-download');
  const btnLater    = document.getElementById('update-btn-later');
  const progressWrap= document.getElementById('update-progress-wrap');
  const progressBar = document.getElementById('update-progress-bar');
  const progressPct = document.getElementById('update-progress-percent');
  const progressTxt = document.getElementById('update-progress-text');
  const speedEl     = document.getElementById('update-speed');

  // ── Найдено обновление ──
  ipcRenderer.on('update-available', (_, info) => {
    if (!banner) return;
    if (title)    title.textContent    = `🎉 Доступна версия ${info.version}!`;
    if (subtitle) subtitle.textContent =
      `Текущая: v${appVersion} → Новая: v${info.version}`;
    banner.style.display = 'block';
  });

  // ── Обновлений нет ──
  ipcRenderer.on('update-not-available', () => {
    showNotif('У вас последняя версия лаунчера ✅', 'success');
  });

  // ── Прогресс скачивания ──
  ipcRenderer.on('update-download-progress', (_, data) => {
    if (!progressWrap) return;
    progressWrap.style.display = 'block';
    if (progressBar) progressBar.style.width = `${data.percent}%`;
    if (progressPct) progressPct.textContent = `${data.percent}%`;
    if (progressTxt) progressTxt.textContent = 'Скачивание обновления...';
    if (speedEl && data.speed) {
      speedEl.textContent = `${formatBytes(data.speed)}/с`;
    }
  });

  // ── Скачано ──
  ipcRenderer.on('update-downloaded', (_, info) => {
    if (banner) banner.style.display = 'none';
    const modal = document.getElementById('update-ready-modal');
    const text  = document.getElementById('update-ready-text');
    if (text) text.innerHTML =
      `Версия <b>v${info.version}</b> загружена и готова к установке.<br>
       Лаунчер перезапустится автоматически.`;
    if (modal) modal.classList.add('show');
  });

  // ── Ошибка ──
  ipcRenderer.on('update-error', (_, msg) => {
    showNotif('Ошибка обновления: ' + msg, 'error');
    if (btnDownload) {
      btnDownload.disabled    = false;
      btnDownload.textContent = 'Повторить';
    }
    if (progressWrap) progressWrap.style.display = 'none';
  });

  // ── Кнопка скачать ──
  btnDownload?.addEventListener('click', async () => {
    btnDownload.disabled    = true;
    btnDownload.textContent = 'Скачиваю...';
    if (progressWrap) progressWrap.style.display = 'block';

    const result = await ipcRenderer.invoke('update-download');
    if (!result.success) {
      showNotif('Ошибка: ' + result.error, 'error');
      btnDownload.disabled    = false;
      btnDownload.textContent = 'Повторить';
      if (progressWrap) progressWrap.style.display = 'none';
    }
  });

  // ── Кнопка позже ──
  btnLater?.addEventListener('click', () => {
    if (banner) banner.style.display = 'none';
    showNotif('Обновление будет установлено при следующем запуске', 'info');
  });

  // ── Установить сейчас ──
  document.getElementById('update-install-btn')?.addEventListener('click', () => {
    ipcRenderer.send('update-install');
  });

  // ── Установить потом ──
  document.getElementById('update-install-later')?.addEventListener('click', () => {
    const modal = document.getElementById('update-ready-modal');
    if (modal) modal.classList.remove('show');
    showNotif('Обновление установится при следующем запуске', 'info');
  });
}

function formatBytes(bytes) {
  if (bytes < 1024)        return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

document.addEventListener('DOMContentLoaded', async () => {
  initWindowControls();
  initNavigation();
  initHomeControls();
  initAuth();
  initSettings();
  initConsole();
  initNewsPage();
  initVersionsPage();
  initProfilesPage();
  initUpdater(); // ← добавить сюда

  await restoreSession();
  await loadVersions();
  await loadProfiles();
  updateUI();
});

// ─── Window ───────────────────────────────────────
function initWindowControls() {
  document.getElementById('btn-minimize').onclick = () => ipcRenderer.send('window-minimize');
  document.getElementById('btn-maximize').onclick = () => ipcRenderer.send('window-maximize');
  document.getElementById('btn-close').onclick    = () => ipcRenderer.send('window-close');
}

// ─── Navigation ───────────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchPage(item.dataset.page));
  });
  document.getElementById('sidebar-profile')
    .addEventListener('click', () => switchPage('settings'));
}

function switchPage(name) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-page="${name}"]`)?.classList.add('active');
  document.getElementById(`page-${name}`)?.classList.add('active');
}

// ═══════════════════════════════════════════════════
// PROFILES
// ═══════════════════════════════════════════════════

function initProfilesPage() {
  // Кнопка создать профиль
  document.getElementById('btn-create-profile').addEventListener('click', () => {
    openProfileModal(null);
  });

  // Закрыть модалку
  document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);
  document.getElementById('pf-cancel-btn').addEventListener('click', closeProfileModal);

  // Клик вне модалки
  document.getElementById('profile-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('profile-modal')) {
      closeProfileModal();
    }
  });

  // Сохранить профиль
  document.getElementById('pf-save-btn').addEventListener('click', saveProfile);

  // Иконки
  document.querySelectorAll('.pf-icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pf-icon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('pf-icon-preview').textContent = btn.dataset.icon;
    });
  });
}

async function loadProfiles() {
  const saved = await ipcRenderer.invoke('store-get', 'profiles');
  const activeId = await ipcRenderer.invoke('store-get', 'activeProfileId');

  if (saved && Array.isArray(saved) && saved.length > 0) {
    profiles = saved;
  } else {
    // Создать дефолтный профиль
    profiles = [
      {
        id:         generateId(),
        icon:       '🎮',
        name:       'Стандартный',
        desc:       'Профиль по умолчанию',
        version:    '1.20.4',
        ram:        2048,
        java:       '',
        fullscreen: false,
        createdAt:  Date.now(),
      }
    ];
    await ipcRenderer.invoke('store-set', 'profiles', profiles);
  }

  // Установить активный профиль
  if (activeId) {
    activeProfile = profiles.find(p => p.id === activeId) || profiles[0];
  } else {
    activeProfile = profiles[0];
  }

  renderProfiles();
  updateActiveProfileBar();
  applyActiveProfile();
}

function renderProfiles() {
  const grid = document.getElementById('profiles-grid');
  if (!grid) return;

  if (profiles.length === 0) {
    grid.innerHTML = `
      <div class="profiles-empty">
        <div class="profiles-empty-icon">🎮</div>
        <h3>Нет профилей</h3>
        <p>Создайте профиль чтобы начать играть</p>
        <button class="btn-primary" style="width:auto;padding:10px 24px"
          onclick="document.getElementById('btn-create-profile').click()">
          Создать первый профиль
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = profiles.map(p => {
    const isActive = activeProfile?.id === p.id;
    return `
      <div class="profile-card ${isActive ? 'active-profile' : ''}"
           id="profile-card-${p.id}">
        ${isActive ? '<div class="pc-active-badge">✓ Активный</div>' : ''}

        <div class="pc-header">
          <div class="pc-icon">${p.icon}</div>
          <div class="pc-menu">
            <button class="pc-menu-btn" onclick="editProfile('${p.id}')" title="Редактировать">
              ✏️
            </button>
            <button class="pc-menu-btn delete" onclick="deleteProfile('${p.id}')" title="Удалить">
              🗑️
            </button>
          </div>
        </div>

        <div class="pc-name">${escHtml(p.name)}</div>
        <div class="pc-desc">${escHtml(p.desc || '')}</div>

        <div class="pc-tags">
          <span class="pc-tag">📦 ${p.version}</span>
          <span class="pc-tag ram">💾 ${formatRam(p.ram)}</span>
          ${p.fullscreen ? '<span class="pc-tag">🖥️ Fullscreen</span>' : ''}
          ${p.java ? '<span class="pc-tag">☕ Своя Java</span>' : ''}
        </div>

        <div class="pc-actions">
          <button class="pc-play-btn" onclick="launchProfile('${p.id}')">
            ▶ Играть
          </button>
          ${!isActive ? `
            <button class="pc-select-btn" onclick="setActiveProfile('${p.id}')">
              Выбрать
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function updateActiveProfileBar() {
  if (!activeProfile) return;
  const icon    = document.getElementById('apb-icon');
  const name    = document.getElementById('apb-name');
  const details = document.getElementById('apb-details');
  if (icon)    icon.textContent    = activeProfile.icon;
  if (name)    name.textContent    = activeProfile.name;
  if (details) details.textContent =
    `${activeProfile.version} · ${formatRam(activeProfile.ram)}`;
}

function applyActiveProfile() {
  if (!activeProfile) return;
  const sel    = document.getElementById('quick-version');
  const slider = document.getElementById('ram-slider');
  const disp   = document.getElementById('ram-display');

  if (sel) sel.value        = activeProfile.version;
  if (slider) slider.value  = activeProfile.ram;
  if (disp) disp.textContent = activeProfile.ram;
}

window.setActiveProfile = async function(id) {
  const profile = profiles.find(p => p.id === id);
  if (!profile) return;

  activeProfile = profile;
  await ipcRenderer.invoke('store-set', 'activeProfileId', id);

  renderProfiles();
  updateActiveProfileBar();
  applyActiveProfile();
  showNotif(`Профиль "${profile.name}" выбран`, 'success');
};

window.launchProfile = async function(id) {
  await setActiveProfile(id);
  switchPage('home');
  setTimeout(handleLaunch, 200);
};

window.editProfile = function(id) {
  const profile = profiles.find(p => p.id === id);
  if (!profile) return;
  openProfileModal(profile);
};

window.deleteProfile = async function(id) {
  if (profiles.length <= 1) {
    showNotif('Нельзя удалить единственный профиль', 'error');
    return;
  }

  const profile = profiles.find(p => p.id === id);
  if (!profile) return;

  // Подтверждение
  const confirmed = await showConfirm(
    `Удалить профиль "${profile.name}"?`
  );
  if (!confirmed) return;

  profiles = profiles.filter(p => p.id !== id);

  // Если удалили активный — переключить
  if (activeProfile?.id === id) {
    activeProfile = profiles[0];
    await ipcRenderer.invoke('store-set', 'activeProfileId', activeProfile.id);
    updateActiveProfileBar();
    applyActiveProfile();
  }

  await ipcRenderer.invoke('store-set', 'profiles', profiles);
  renderProfiles();
  showNotif(`Профиль "${profile.name}" удалён`, 'info');
};

function openProfileModal(profile) {
  editingProfile = profile ? profile.id : null;

  const modal = document.getElementById('profile-modal');
  const title = document.getElementById('profile-modal-title');

  title.textContent = profile ? 'Редактировать профиль' : 'Создать профиль';

  // Заполнить поля
  document.getElementById('pf-name').value       = profile?.name || '';
  document.getElementById('pf-desc').value       = profile?.desc || '';
  document.getElementById('pf-ram').value        = profile?.ram || 2048;
  document.getElementById('pf-java').value       = profile?.java || '';
  document.getElementById('pf-fullscreen').checked = profile?.fullscreen || false;

  // Иконка
  const iconPreview = document.getElementById('pf-icon-preview');
  const selectedIcon = profile?.icon || '🎮';
  iconPreview.textContent = selectedIcon;

  document.querySelectorAll('.pf-icon-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === selectedIcon);
  });

  // Версии
  const sel = document.getElementById('pf-version');
  sel.innerHTML = allVersions
    .filter(v => v.type === 'release')
    .map(v => `<option value="${v.id}" ${profile?.version === v.id ? 'selected' : ''}>
      ${v.id}${v.recommended ? ' ⭐' : ''}
    </option>`)
    .join('');

  if (profile?.version) sel.value = profile.version;

  modal.classList.add('show');
  document.getElementById('pf-name').focus();
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('show');
  editingProfile = null;
}

async function saveProfile() {
  const name       = document.getElementById('pf-name').value.trim();
  const desc       = document.getElementById('pf-desc').value.trim();
  const version    = document.getElementById('pf-version').value;
  const ram        = parseInt(document.getElementById('pf-ram').value);
  const java       = document.getElementById('pf-java').value.trim();
  const fullscreen = document.getElementById('pf-fullscreen').checked;
  const icon       = document.getElementById('pf-icon-preview').textContent;

  if (!name) {
    showNotif('Введите название профиля', 'error'); return;
  }
  if (!version) {
    showNotif('Выберите версию', 'error'); return;
  }

  if (editingProfile) {
    // Редактирование
    profiles = profiles.map(p => {
      if (p.id !== editingProfile) return p;
      return { ...p, icon, name, desc, version, ram, java, fullscreen };
    });
    showNotif(`Профиль "${name}" обновлён`, 'success');
  } else {
    // Создание
    const newProfile = {
      id:         generateId(),
      icon, name, desc, version, ram, java, fullscreen,
      createdAt:  Date.now(),
    };
    profiles.push(newProfile);

    // Если первый — сделать активным
    if (profiles.length === 1) {
      activeProfile = newProfile;
      await ipcRenderer.invoke('store-set', 'activeProfileId', newProfile.id);
    }

    showNotif(`Профиль "${name}" создан! 🎮`, 'success');
  }

  await ipcRenderer.invoke('store-set', 'profiles', profiles);

  // Обновить активный если редактировали его
  if (editingProfile && activeProfile?.id === editingProfile) {
    activeProfile = profiles.find(p => p.id === editingProfile);
    updateActiveProfileBar();
    applyActiveProfile();
  }

  closeProfileModal();
  renderProfiles();
}

// ─── Home Controls ────────────────────────────────
function initHomeControls() {
  const slider  = document.getElementById('ram-slider');
  const display = document.getElementById('ram-display');
  if (slider) slider.addEventListener('input', () => {
    display.textContent = slider.value;
  });
  document.getElementById('launch-btn')?.addEventListener('click', handleLaunch);
}

async function handleLaunch() {
  if (isLaunching) return;

  let username = currentUser?.username;
  if (!username) {
    username = await askOfflineUsername();
    if (!username) return;
  }

  // Берём настройки из активного профиля или из UI
  const version    = document.getElementById('quick-version').value;
  const ram        = parseInt(document.getElementById('ram-slider').value);
  const fullscreen = activeProfile?.fullscreen ||
    await ipcRenderer.invoke('store-get', 'fullscreen') || false;
  const javaPath   = activeProfile?.java ||
    await ipcRenderer.invoke('store-get', 'javaPath') || 'java';

  isLaunching = true;
  setLaunchBtnState('loading');
  showElement('download-progress');
  showElement('console-section');
  setProgress(0, 'Подготовка...');
  addLog(`▶ Запуск Minecraft ${version} для ${username}...`, 'success');
  if (activeProfile) {
    addLog(`📋 Профиль: ${activeProfile.name}`, '');
  }

  const result = await ipcRenderer.invoke('launch-minecraft', {
    username, version, ram, fullscreen, javaPath
  });

  if (!result.success) {
    showNotif('Ошибка: ' + result.error, 'error');
    addLog('❌ ' + result.error, 'error');
    isLaunching = false;
    setLaunchBtnState('idle');
    hideElement('download-progress');
  }
}

function setLaunchBtnState(state) {
  const btn  = document.getElementById('launch-btn');
  const txt  = btn?.querySelector('.btn-text');
  const icon = btn?.querySelector('.btn-icon');
  if (!btn) return;

  if (state === 'loading') {
    btn.classList.add('loading');
    if (txt)  txt.textContent  = 'Загрузка...';
    if (icon) icon.textContent = '⏳';
  } else {
    btn.classList.remove('loading');
    if (txt)  txt.textContent  = 'Играть';
    if (icon) icon.textContent = '▶';
  }
}

async function askOfflineUsername() {
  const stored = await ipcRenderer.invoke('store-get', 'offlineUsername');
  if (stored) return stored;

  return new Promise(resolve => {
    const modal = document.getElementById('offline-modal');
    const input = document.getElementById('offline-username');
    if (!modal || !input) { resolve(null); return; }

    modal.classList.add('show');
    input.value = '';
    input.focus();

    const confirm = async () => {
      const val = input.value.trim();
      if (!val || val.length < 3) {
        showNotif('Никнейм минимум 3 символа', 'error'); return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(val)) {
        showNotif('Только буквы, цифры и _', 'error'); return;
      }
      await ipcRenderer.invoke('store-set', 'offlineUsername', val);
      modal.classList.remove('show');
      resolve(val);
    };

    document.getElementById('offline-confirm').onclick = confirm;
    document.getElementById('offline-cancel').onclick  = () => {
      modal.classList.remove('show');
      resolve(null);
    };
    input.onkeydown = e => { if (e.key === 'Enter') confirm(); };
  });
}

// ─── Versions ─────────────────────────────────────
function getDefaultVersions() {
  return [
    { id: '1.20.4', type: 'release', recommended: true },
    { id: '1.20.2', type: 'release' },
    { id: '1.20.1', type: 'release' },
    { id: '1.19.4', type: 'release' },
    { id: '1.18.2', type: 'release' },
    { id: '1.17.1', type: 'release' },
    { id: '1.16.5', type: 'release' },
    { id: '1.12.2', type: 'release' },
    { id: '1.8.9',  type: 'release' },
    { id: '1.7.10', type: 'old_release' },
    { id: '1.5.2',  type: 'old_release' },
  ];
}

async function loadVersions() {
  showVersionsLoading();
  try {
    const res  = await fetch(
      'https://launchermeta.mojang.com/mc/game/version_manifest.json',
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    allVersions = data.versions.map(v => ({
      id:             v.id,
      type:           v.type,
      releaseTime:    v.releaseTime,
      recommended:    v.id === data.latest.release,
      latest:         v.id === data.latest.release,
      latestSnapshot: v.id === data.latest.snapshot,
    }));
  } catch {
    allVersions = getDefaultVersions();
  }
  populateVersionSelect();
  renderVersionsPage('release');
}

function showVersionsLoading() {
  const grid = document.getElementById('versions-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div style="grid-column:1/-1;display:flex;align-items:center;
      gap:12px;padding:40px;color:var(--text-secondary);font-size:14px">
      <div class="spinner"></div>
      Загрузка версий с серверов Mojang...
    </div>
  `;
}

function populateVersionSelect() {
  const sel = document.getElementById('quick-version');
  if (!sel) return;
  sel.innerHTML = allVersions
    .filter(v => v.type === 'release')
    .map(v => `<option value="${v.id}">${v.id}${v.recommended ? ' ⭐' : ''}</option>`)
    .join('');

  // Применить версию из активного профиля
  if (activeProfile?.version) sel.value = activeProfile.version;
}

function initVersionsPage() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const search = document.getElementById('version-search')?.value || '';
      renderVersionsPage(btn.dataset.filter, search);
    });
  });

  document.getElementById('version-search')?.addEventListener('input', e => {
    const active = document.querySelector('.filter-btn.active');
    renderVersionsPage(active?.dataset.filter || 'release', e.target.value);
  });
}

function renderVersionsPage(filter, search = '') {
  const grid = document.getElementById('versions-grid');
  if (!grid) return;

  let filtered = filter === 'release'
    ? allVersions.filter(v => v.type === 'release')
    : filter === 'snapshot'
    ? allVersions.filter(v => v.type === 'snapshot')
    : filter === 'old'
    ? allVersions.filter(v => ['old_beta','old_alpha','old_release'].includes(v.type))
    : allVersions;

  if (search.trim()) {
    filtered = filtered.filter(v =>
      v.id.toLowerCase().includes(search.toLowerCase())
    );
  }

  const counter = document.getElementById('versions-count');
  if (counter) counter.textContent = `Найдено: ${filtered.length} версий`;

  if (!filtered.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-muted)">
        ${search ? `Версия "${search}" не найдена` : 'Нет версий'}
      </div>`;
    return;
  }

  const typeLabels = {
    release:   'Release',
    snapshot:  'Snapshot',
    old_beta:  'Old Beta',
    old_alpha: 'Old Alpha',
  };
  const typeColors = {
    release:   'var(--accent-2)',
    snapshot:  '#f59e0b',
    old_beta:  '#6b7280',
    old_alpha: '#4b5563',
  };

  grid.innerHTML = filtered.map(v => `
    <div class="version-card ${v.recommended ? 'recommended' : ''}">
      ${v.recommended
        ? '<div class="version-badge">⭐ Рекомендуется</div>'
        : v.latestSnapshot
        ? '<div class="version-badge snapshot">🔧 Latest Snapshot</div>'
        : ''}
      <div class="version-number">${v.id}</div>
      <div class="version-type" style="color:${typeColors[v.type] || 'var(--text-muted)'}">
        ${typeLabels[v.type] || v.type}
      </div>
      <div class="version-date">
        ${v.releaseTime
          ? new Date(v.releaseTime).toLocaleDateString('ru-RU',
              {day:'2-digit',month:'short',year:'numeric'})
          : ''}
      </div>
      <div class="version-action">
        <button class="btn-play-small" onclick="launchVersion('${v.id}')">
          ▶ Играть
        </button>
      </div>
    </div>
  `).join('');
}

window.launchVersion = function(version) {
  document.getElementById('quick-version').value = version;
  switchPage('home');
  setTimeout(handleLaunch, 100);
};

// ─── Console ──────────────────────────────────────
function initConsole() {
  document.getElementById('console-clear')?.addEventListener('click', () => {
    const out = document.getElementById('console-output');
    if (out) out.innerHTML = '';
    consoleLines = 0;
  });

  ipcRenderer.on('minecraft-log', (_, data) => {
    if (data.type === 'progress') handleProgress(data.data);
    else addLog(String(data.message || '').slice(0, 300));
  });

  ipcRenderer.on('minecraft-closed', (_, code) => {
    isLaunching = false;
    setLaunchBtnState('idle');
    hideElement('download-progress');
    addLog(`■ Minecraft закрыт (код: ${code})`, code === 0 ? 'success' : 'error');
    showNotif(code === 0 ? 'Minecraft закрыт' : `Ошибка (код: ${code})`,
              code === 0 ? 'info' : 'error');
  });
}

function addLog(msg, type = '') {
  if (consoleLines > 500) {
    const out = document.getElementById('console-output');
    if (out) out.innerHTML = '';
    consoleLines = 0;
  }
  const out = document.getElementById('console-output');
  if (!out) return;
  const line = document.createElement('div');
  line.className   = `console-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
  consoleLines++;
}

function handleProgress(data) {
  if (!data) return;
  if (data.loaded && data.total) {
    setProgress(
      Math.round((data.loaded / data.total) * 100),
      { assets:'Загрузка ресурсов...', client:'Загрузка клиента...',
        natives:'Загрузка natives...', classes:'Загрузка библиотек...' }
      [data.type] || 'Загрузка...'
    );
  }
}

function setProgress(pct, label) {
  const bar  = document.getElementById('progress-bar');
  const pct2 = document.getElementById('progress-percent');
  const txt  = document.getElementById('progress-text');
  if (bar)  bar.style.width     = `${pct}%`;
  if (pct2) pct2.textContent    = `${pct}%`;
  if (txt)  txt.textContent     = label;
}

// ─── Auth ─────────────────────────────────────────
function initAuth() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('auth-form-login')?.classList.toggle('hidden', !isLogin);
      document.getElementById('auth-form-register')?.classList.toggle('hidden', isLogin);
    });
  });

  document.getElementById('btn-login')?.addEventListener('click', handleLogin);
  document.getElementById('btn-register')?.addEventListener('click', handleRegister);
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);

  document.getElementById('btn-offline')?.addEventListener('click', async () => {
    await ipcRenderer.invoke('store-delete', 'offlineUsername');
    const uname = await askOfflineUsername();
    if (uname) {
      currentUser = { username: uname, offline: true };
      await ipcRenderer.invoke('store-set', 'offlineUser', JSON.stringify(currentUser));
      updateUI();
      showNotif(`Привет, ${uname}! 🎮`, 'success');
      switchPage('home');
    }
  });
}

async function handleLogin() {
  const email    = document.getElementById('login-email')?.value.trim();
  const password = document.getElementById('login-password')?.value;
  if (!email || !password) { showNotif('Заполните все поля', 'error'); return; }

  const btn = document.getElementById('btn-login');
  setBtn(btn, 'Вхожу...', true);

  try {
    const res  = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    if (!res.ok) { showNotif(data.message || 'Ошибка', 'error'); return; }

    currentUser = data.user;
    await ipcRenderer.invoke('store-set', 'token', data.token);
    await ipcRenderer.invoke('store-set', 'user', JSON.stringify(data.user));
    await ipcRenderer.invoke('store-delete', 'offlineUser');
    await ipcRenderer.invoke('store-delete', 'offlineUsername');
    updateUI();
    showNotif(`Добро пожаловать, ${data.user.username}! 🎮`, 'success');
    switchPage('home');
  } catch {
    showNotif('Сервер недоступен', 'error');
  } finally {
    setBtn(btn, 'Войти в аккаунт', false);
  }
}

async function handleRegister() {
  const username  = document.getElementById('reg-username')?.value.trim();
  const email     = document.getElementById('reg-email')?.value.trim();
  const password  = document.getElementById('reg-password')?.value;
  const password2 = document.getElementById('reg-password2')?.value;

  if (!username || !email || !password) { showNotif('Заполните все поля', 'error'); return; }
  if (password !== password2) { showNotif('Пароли не совпадают', 'error'); return; }
  if (password.length < 8) { showNotif('Пароль минимум 8 символов', 'error'); return; }
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) { showNotif('Никнейм: 3-16 символов', 'error'); return; }

  const btn = document.getElementById('btn-register');
  setBtn(btn, 'Создаю...', true);

  try {
    const res  = await fetch(`${API}/auth/register`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username, email, password }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    if (!res.ok) { showNotif(data.message || 'Ошибка', 'error'); return; }

    currentUser = data.user;
    await ipcRenderer.invoke('store-set', 'token', data.token);
    await ipcRenderer.invoke('store-set', 'user', JSON.stringify(data.user));
    await ipcRenderer.invoke('store-delete', 'offlineUser');
    updateUI();
    showNotif(`Добро пожаловать, ${username}! 🎉`, 'success');
    switchPage('home');
  } catch {
    showNotif('Сервер недоступен', 'error');
  } finally {
    setBtn(btn, 'Создать аккаунт', false);
  }
}

async function handleLogout() {
  currentUser = null;
  await ipcRenderer.invoke('store-delete', 'token');
  await ipcRenderer.invoke('store-delete', 'user');
  await ipcRenderer.invoke('store-delete', 'offlineUser');
  await ipcRenderer.invoke('store-delete', 'offlineUsername');
  const e = document.getElementById('login-email');
  const p = document.getElementById('login-password');
  if (e) e.value = '';
  if (p) p.value = '';
  updateUI();
  showNotif('Вы вышли из аккаунта', 'info');
}

async function restoreSession() {
  try {
    const token      = await ipcRenderer.invoke('store-get', 'token');
    const userStr    = await ipcRenderer.invoke('store-get', 'user');
    const offlineStr = await ipcRenderer.invoke('store-get', 'offlineUser');

    if (token && userStr) {
      currentUser = JSON.parse(userStr);
      fetch(`${API}/auth/me`, {
        headers: {'Authorization': `Bearer ${token}`},
        signal: AbortSignal.timeout(5000)
      }).then(r => r.json()).then(async d => {
        if (d.user) {
          currentUser = d.user;
          await ipcRenderer.invoke('store-set', 'user', JSON.stringify(d.user));
          updateUI();
        }
      }).catch(() => {});
    } else if (offlineStr) {
      currentUser = JSON.parse(offlineStr);
    }
  } catch {}
}

// ─── Settings ─────────────────────────────────────
function initSettings() {
  loadSavedSettings();

  document.getElementById('default-ram')?.addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'defaultRam', e.target.value);
    const slider = document.getElementById('ram-slider');
    const disp   = document.getElementById('ram-display');
    if (slider) slider.value     = e.target.value;
    if (disp)   disp.textContent = e.target.value;
  });

  document.getElementById('java-path')?.addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'javaPath', e.target.value.trim());
  });

  document.getElementById('fullscreen-toggle')?.addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'fullscreen', e.target.checked);
  });

  document.getElementById('close-launcher-toggle')?.addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'closeLauncher', e.target.checked);
  });

  document.getElementById('open-game-folder')?.addEventListener('click', () => {
    ipcRenderer.send('open-minecraft-folder');
  });

  document.getElementById('check-updates-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('check-updates-btn');
    setBtn(btn, 'Проверяю...', true);
    try {
      const res  = await fetch(`${API}/launcher/latest`, {
        signal: AbortSignal.timeout(5000)
      });
      const data = await res.json();
      showNotif(
        data.version === '1.0.0'
          ? 'У вас последняя версия ✅'
          : `Доступна версия ${data.version}!`,
        'success'
      );
    } catch {
      showNotif('Не удалось проверить', 'error');
    } finally {
      setBtn(btn, 'Проверить обновления', false);
    }
  });

  // ── Темы ── добавить сюда
  initThemes();
}

// ─── Themes ───────────────────────────────────────
function initThemes() {
  // Загрузить сохранённую тему при старте
  ipcRenderer.invoke('store-get', 'theme').then(theme => {
    applyTheme(theme || 'purple', false);
  });

  // Клик по кнопке темы
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme, true);
    });
  });
}

function applyTheme(theme, save = true) {
  // Применяем к html элементу
  document.documentElement.setAttribute('data-theme', theme);

  // Обновляем активную кнопку
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

  // Сохраняем
  if (save) {
    ipcRenderer.invoke('store-set', 'theme', theme);
    showNotif('Тема изменена! 🎨', 'success');
  }
}

async function loadSavedSettings() {
  const ram   = await ipcRenderer.invoke('store-get', 'defaultRam');
  const java  = await ipcRenderer.invoke('store-get', 'javaPath');
  const fs    = await ipcRenderer.invoke('store-get', 'fullscreen');
  const close = await ipcRenderer.invoke('store-get', 'closeLauncher');

  if (ram) {
    const sel    = document.getElementById('default-ram');
    const slider = document.getElementById('ram-slider');
    const disp   = document.getElementById('ram-display');
    if (sel)    sel.value         = ram;
    if (slider) slider.value      = ram;
    if (disp)   disp.textContent  = ram;
  }
  if (java) { const el = document.getElementById('java-path'); if (el) el.value = java; }
  if (fs !== undefined) { const el = document.getElementById('fullscreen-toggle'); if (el) el.checked = fs; }
  const closeEl = document.getElementById('close-launcher-toggle');
  if (closeEl) closeEl.checked = close ?? true;
}

// ─── News ─────────────────────────────────────────
function initNewsPage() {
  const newsData = [
    { emoji:'🎮', color:'linear-gradient(135deg,#7c3aed,#4f46e5)',
      date:'15 декабря 2024', title:'CosmoLauncher 1.0 — релиз!',
      text:'Первый публичный релиз. Поддержка всех версий Minecraft.' },
    { emoji:'⚡', color:'linear-gradient(135deg,#a855f7,#7c3aed)',
      date:'10 декабря 2024', title:'Оптимизация производительности',
      text:'Встроенные JVM аргументы дают до +30% FPS.' },
    { emoji:'🔐', color:'linear-gradient(135deg,#4f46e5,#2563eb)',
      date:'5 декабря 2024', title:'Система аккаунтов',
      text:'Создай аккаунт CosmoLauncher и сохраняй настройки.' },
  ];
  const grid = document.getElementById('news-grid');
  if (!grid) return;
  grid.innerHTML = newsData.map(n => `
    <div class="news-card">
      <div class="news-img" style="background:${n.color}">
        <span style="font-size:3rem">${n.emoji}</span>
      </div>
      <div class="news-body">
        <div class="news-date">${n.date}</div>
        <h3>${n.title}</h3>
        <p>${n.text}</p>
        <button class="btn-link">Читать →</button>
      </div>
    </div>
  `).join('');
}

// ─── Update UI ────────────────────────────────────
function updateUI() {
  const logged    = !!currentUser;
  const loggedOut = document.getElementById('auth-logged-out');
  const loggedIn  = document.getElementById('auth-logged-in');
  if (loggedOut) loggedOut.style.display = logged ? 'none'  : 'block';
  if (loggedIn)  loggedIn.style.display  = logged ? 'block' : 'none';

  const letter = logged ? currentUser.username[0].toUpperCase() : '?';
  const els = {
    'profile-avatar':     letter,
    'profile-name':       logged ? currentUser.username : 'Не войдено',
    'profile-status':     !logged ? 'Нажмите для входа' :
                          currentUser.offline ? 'Оффлайн режим' : 'CosmoLauncher',
    'user-avatar-big':    letter,
    'user-name-big':      logged ? currentUser.username : '',
    'user-email-display': logged ? (currentUser.email || 'Оффлайн режим') : '',
  };
  Object.entries(els).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

// ─── Helpers ──────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatRam(mb) {
  return mb >= 1024 ? `${mb / 1024} ГБ` : `${mb} МБ`;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showConfirm(msg) {
  return new Promise(resolve => {
    // Простой confirm — можно заменить на красивую модалку потом
    resolve(window.confirm(msg));
  });
}

function setBtn(btn, text, disabled) {
  if (!btn) return;
  btn.textContent = text;
  btn.disabled    = disabled;
}

function showElement(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}

function hideElement(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function showNotif(msg, type = 'info') {
  const c = document.getElementById('notifications');
  if (!c) return;
  const n = document.createElement('div');
  n.className   = `notification ${type}`;
  n.textContent = msg;
  c.appendChild(n);
  setTimeout(() => {
    n.style.transition = 'all .3s';
    n.style.opacity    = '0';
    n.style.transform  = 'translateX(20px)';
    setTimeout(() => n.remove(), 300);
  }, 3500);
}