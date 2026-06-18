const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

const API = 'https://cosmolauncher-api.onrender.com/api';

let appVersion = '1.0.1';
ipcRenderer.invoke('get-app-version').then(v => {
  appVersion = v;
  const el = document.getElementById('app-version-display');
  if (el) el.textContent = `v${v}`;
});

let currentUser    = null;
let isLaunching    = false;
let allVersions    = [];
let consoleLines   = 0;
let profiles       = [];
let activeProfile  = null;
let editingProfile = null;
let sessionStartTime = null;

// Кеш для скинов
const skinCache = {};

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

  ipcRenderer.on('update-available', (_, info) => {
    if (!banner) return;
    if (title)    title.textContent    = `🎉 Доступна версия ${info.version}!`;
    if (subtitle) subtitle.textContent =
      `Текущая: v${appVersion} → Новая: v${info.version}`;
    banner.style.display = 'block';
  });

  ipcRenderer.on('update-not-available', () => {
    showNotif('У вас последняя версия лаунчера ✅', 'success');
  });

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

  ipcRenderer.on('update-downloaded', (_, info) => {
    if (banner) banner.style.display = 'none';
    const modal = document.getElementById('update-ready-modal');
    const text  = document.getElementById('update-ready-text');
    if (text) text.innerHTML =
      `Версия <b>v${info.version}</b> загружена и готова к установке.<br>
       Лаунчер перезапустится автоматически.`;
    if (modal) modal.classList.add('show');
  });

  ipcRenderer.on('update-error', (_, msg) => {
    showNotif('Ошибка обновления: ' + msg, 'error');
    if (btnDownload) {
      btnDownload.disabled    = false;
      btnDownload.textContent = 'Повторить';
    }
    if (progressWrap) progressWrap.style.display = 'none';
  });

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

  btnLater?.addEventListener('click', () => {
    if (banner) banner.style.display = 'none';
    showNotif('Обновление будет установлено при следующем запуске', 'info');
  });

  document.getElementById('update-install-btn')?.addEventListener('click', () => {
    ipcRenderer.send('update-install');
  });

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
  initUpdater();
  initModsPage(); // ← новый вызов

  await restoreSession();
  await loadVersions();
  await loadProfiles();
  await updateUI();  // теперь асинхронный
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
  document.getElementById('btn-create-profile').addEventListener('click', () => {
    openProfileModal(null);
  });

  document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);
  document.getElementById('pf-cancel-btn').addEventListener('click', closeProfileModal);

  document.getElementById('profile-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('profile-modal')) {
      closeProfileModal();
    }
  });

  document.getElementById('pf-save-btn').addEventListener('click', saveProfile);

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

  const confirmed = await showConfirm(
    `Удалить профиль "${profile.name}"?`
  );
  if (!confirmed) return;

  profiles = profiles.filter(p => p.id !== id);

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

  document.getElementById('pf-name').value       = profile?.name || '';
  document.getElementById('pf-desc').value       = profile?.desc || '';
  document.getElementById('pf-ram').value        = profile?.ram || 2048;
  document.getElementById('pf-java').value       = profile?.java || '';
  document.getElementById('pf-fullscreen').checked = profile?.fullscreen || false;

  const iconPreview = document.getElementById('pf-icon-preview');
  const selectedIcon = profile?.icon || '🎮';
  iconPreview.textContent = selectedIcon;

  document.querySelectorAll('.pf-icon-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === selectedIcon);
  });

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
    profiles = profiles.map(p => {
      if (p.id !== editingProfile) return p;
      return { ...p, icon, name, desc, version, ram, java, fullscreen };
    });
    showNotif(`Профиль "${name}" обновлён`, 'success');
  } else {
    const newProfile = {
      id:         generateId(),
      icon, name, desc, version, ram, java, fullscreen,
      createdAt:  Date.now(),
    };
    profiles.push(newProfile);

    if (profiles.length === 1) {
      activeProfile = newProfile;
      await ipcRenderer.invoke('store-set', 'activeProfileId', newProfile.id);
    }

    showNotif(`Профиль "${name}" создан! 🎮`, 'success');
  }

  await ipcRenderer.invoke('store-set', 'profiles', profiles);

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

  sessionStartTime = Date.now();

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

    if (sessionStartTime) {
      const duration = Math.floor((Date.now() - sessionStartTime) / 60000);
      if (duration > 0) {
        ipcRenderer.invoke('store-get', 'totalPlayTime').then(prev => {
          const total = (prev || 0) + duration;
          ipcRenderer.invoke('store-set', 'totalPlayTime', total);
        });
      }
      sessionStartTime = null;
    }

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
      await updateUI();
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
    await updateUI();
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
    await updateUI();
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
  await updateUI();
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
          await updateUI();
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
  loadJavaInfo(); // ← новый вызов

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

  // ── Темы ──
  initThemes();

  // ── Кнопка скачать Java ──
  document.getElementById('btn-download-java')?.addEventListener('click', async () => {
    const version = prompt('Какую версию Java скачать?\nВведите номер: 8, 11, 17, 21', '17');
    if (!version) return;

    const btn = document.getElementById('btn-download-java');
    btn.disabled = true;
    btn.textContent = 'Скачиваю...';
    try {
      const mcPath = await ipcRenderer.invoke('get-minecraft-path');
      const javaDir = path.join(mcPath, '..', 'runtime', 'java');
      const result = await ipcRenderer.invoke('download-java', version, javaDir);
      if (result.success) {
        document.getElementById('java-path').value = result.path;
        await ipcRenderer.invoke('store-set', 'javaPath', result.path);
        showNotif(`✅ Java ${version} установлена!`, 'success');
        await loadJavaInfo();
      } else {
        showNotif('❌ Ошибка: ' + result.error, 'error');
      }
    } catch (e) {
      showNotif('❌ Ошибка: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇️ Скачать Java (если не найдена)';
    }
  });
}

// ─── Java Finder ──────────────────────────────────
async function loadJavaInfo() {
  const container = document.getElementById('java-detected');
  if (!container) return;
  container.innerHTML = '<span class="loading-text">Поиск Java...</span>';

  try {
    const javaList = await ipcRenderer.invoke('find-java');
    if (!javaList || javaList.length === 0) {
      container.innerHTML = '<span style="color:var(--error)">❌ Java не найдена. Установите Java 8 или 17.</span>';
      return;
    }

    container.innerHTML = javaList.map((j, index) => 
      `<div style="display:flex;align-items:center;gap:8px;padding:2px 0;">
        <span>☕</span>
        <span style="font-family:monospace;font-size:12px;">${j.path}</span>
        <span style="background:var(--accent-2);padding:0 8px;border-radius:4px;font-size:11px;">${j.version}</span>
        ${index === 0 ? ' <span style="color:var(--success)">(рекомендуется)</span>' : ''}
      </div>`
    ).join('');

    const currentJava = await ipcRenderer.invoke('store-get', 'javaPath');
    if (!currentJava) {
      const preferred = javaList.find(j => j.version.startsWith('17') || j.version.startsWith('1.8')) || javaList[0];
      document.getElementById('java-path').value = preferred.path;
      await ipcRenderer.invoke('store-set', 'javaPath', preferred.path);
    }
  } catch (e) {
    container.innerHTML = '<span style="color:var(--error)">❌ Ошибка поиска Java</span>';
  }
}

// ─── Themes ───────────────────────────────────────
function initThemes() {
  ipcRenderer.invoke('store-get', 'theme').then(theme => {
    applyTheme(theme || 'purple', false);
  });

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme, true);
    });
  });
}

function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

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

// ═══════════════════════════════════════════════════
// НОВЫЙ МЕНЕДЖЕР МОДОВ
// ═══════════════════════════════════════════════════

let modSearchResults = [];
let installedMods = [];

function initModsPage() {
  const searchBtn = document.getElementById('mod-search-btn');
  const searchInput = document.getElementById('mod-search');
  const installedBtn = document.getElementById('mod-installed-btn');

  searchBtn?.addEventListener('click', () => performModSearch(searchInput?.value));
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performModSearch(searchInput.value);
  });
  installedBtn?.addEventListener('click', toggleInstalledList);

  loadInstalledMods();
}

async function performModSearch(query) {
  if (!query || query.length < 2) {
    showNotif('Введите хотя бы 2 символа', 'info');
    return;
  }

  const container = document.getElementById('mods-search-results');
  container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;">⏳ Поиск...</div>';

  try {
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=24`;
    const res = await fetch(url);
    const data = await res.json();
    modSearchResults = data.hits || [];
    renderModSearchResults(modSearchResults);
  } catch (e) {
    container.innerHTML = `<div style="grid-column:1/-1;color:var(--error);">❌ Ошибка: ${e.message}</div>`;
  }
}

function renderModSearchResults(results) {
  const container = document.getElementById('mods-search-results');
  if (!results || results.length === 0) {
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">Моды не найдены</div>';
    return;
  }

  container.innerHTML = results.map(mod => {
    const icon = mod.icon_url || 'https://via.placeholder.com/64';
    const latestVersion = mod.latest_version || 'latest';
    return `
      <div class="mod-card" style="background:var(--bg-card);border-radius:12px;padding:16px;border:1px solid var(--border);">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;">
          <img src="${icon}" alt="${mod.title}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;">
          <div style="flex:1;">
            <div style="font-weight:600;">${mod.title}</div>
            <div style="font-size:12px;color:var(--text-muted);">${mod.author}</div>
          </div>
        </div>
        <div style="font-size:13px;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:10px;">
          ${mod.description || 'Нет описания'}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:var(--text-muted);">⬇ ${mod.downloads || 0}</span>
          <button class="btn-primary small mod-install-btn" data-mod-id="${mod.project_id}" data-version="${latestVersion}">
            Установить
          </button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.mod-install-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const modId = btn.dataset.modId;
      const version = btn.dataset.version;
      await installMod(modId, version, e);
    });
  });
}

async function installMod(modId, version, event) {
  const btn = event?.target;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳';
  }

  try {
    const versionUrl = `https://api.modrinth.com/v2/project/${modId}/version`;
    const res = await fetch(versionUrl);
    const versions = await res.json();
    const targetVersion = versions.find(v => v.version_type === 'release') || versions[0];
    if (!targetVersion) throw new Error('Нет подходящей версии');
    const file = targetVersion.files.find(f => f.primary);
    if (!file) throw new Error('Файл не найден');

    const result = await ipcRenderer.invoke('mods-install', modId, targetVersion.version_number, file.url);
    if (result.success) {
      showNotif(`✅ Мод ${modId} установлен!`, 'success');
      loadInstalledMods();
    } else {
      showNotif('❌ Ошибка: ' + result.error, 'error');
    }
  } catch (e) {
    showNotif('❌ Ошибка: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Установить';
    }
  }
}

async function loadInstalledMods() {
  try {
    const list = await ipcRenderer.invoke('mods-list-installed');
    installedMods = list;
    renderInstalledMods(list);
  } catch (e) {
    console.error('Ошибка загрузки модов:', e);
  }
}

function renderInstalledMods(list) {
  const grid = document.getElementById('mods-installed-grid');
  if (!grid) return;
  if (!list || list.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted)">Моды не установлены</div>';
    return;
  }
  grid.innerHTML = list.map(mod => `
    <div style="background:var(--bg-card);border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-family:monospace;font-size:13px;">${mod.name}</span>
      <button class="btn-danger small mod-uninstall-btn" data-filename="${mod.name}">🗑</button>
    </div>
  `).join('');

  document.querySelectorAll('.mod-uninstall-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const filename = btn.dataset.filename;
      if (!confirm(`Удалить мод "${filename}"?`)) return;
      const result = await ipcRenderer.invoke('mods-uninstall', filename);
      if (result.success) {
        showNotif(`✅ Мод удалён`, 'info');
        loadInstalledMods();
      } else {
        showNotif('❌ Ошибка: ' + result.error, 'error');
      }
    });
  });
}

function toggleInstalledList() {
  const searchResults = document.getElementById('mods-search-results');
  const installedList = document.getElementById('mods-installed-list');
  if (!searchResults || !installedList) return;

  const isHidden = installedList.style.display === 'none';
  searchResults.style.display = isHidden ? 'none' : 'grid';
  installedList.style.display = isHidden ? 'block' : 'none';
  if (isHidden) loadInstalledMods();
}

// ═══════════════════════════════════════════════════
// СКИНЫ (обновлённый updateUI)
// ═══════════════════════════════════════════════════

async function getSkinUrl(username) {
  if (!username) return null;
  if (skinCache[username]) return skinCache[username];

  try {
    const uuidRes = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (!uuidRes.ok) return null;
    const { id } = await uuidRes.json();

    const profileRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
    if (!profileRes.ok) return null;
    const data = await profileRes.json();

    const texturesProperty = data.properties.find(p => p.name === 'textures');
    if (!texturesProperty) return null;
    const textures = JSON.parse(atob(texturesProperty.value));
    const skinUrl = textures.textures?.SKIN?.url || null;

    skinCache[username] = skinUrl;
    return skinUrl;
  } catch (e) {
    console.warn('Не удалось получить скин:', e.message);
    return null;
  }
}

function setAvatarImage(url) {
  const avatarEls = ['profile-avatar', 'user-avatar-big'];
  avatarEls.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      el.style.background = 'transparent';
    }
  });
}

function setAvatarFallback(letter) {
  const avatarEls = ['profile-avatar', 'user-avatar-big'];
  avatarEls.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = letter;
      el.style.background = '';
      el.innerHTML = letter;
    }
  });
}

async function updateUI() {
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

  await updateAvatar();
}

async function updateAvatar() {
  if (!currentUser || !currentUser.username) {
    setAvatarFallback('?');
    return;
  }

  const skinUrl = await getSkinUrl(currentUser.username);
  if (skinUrl) {
    setAvatarImage(skinUrl);
  } else {
    const letter = currentUser.username[0].toUpperCase();
    setAvatarFallback(letter);
  }
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