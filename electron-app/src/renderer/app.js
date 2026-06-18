const { ipcRenderer } = require('electron');

// ─── API URL ───────────────────────────────────────
const API = 'https://cosmolauncher-api.onrender.com/api';

// ─── State ────────────────────────────────────────
let currentUser  = null;
let isLaunching  = false;
let allVersions  = [];
let consoleLines = 0;

// ─── Init ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initWindowControls();
  initNavigation();
  initHomeControls();
  initAuth();
  initSettings();
  initConsole();
  initNewsPage();

  await restoreSession();
  await loadVersions();
  updateUI();
  checkServerStatus();
});

// ─── Window Controls ──────────────────────────────
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
  document.getElementById('sidebar-profile').addEventListener('click', () => {
    switchPage('settings');
  });
}

function switchPage(name) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-page="${name}"]`)?.classList.add('active');
  document.getElementById(`page-${name}`)?.classList.add('active');
}

// ─── Load Versions from API ────────────────────────
async function loadVersions() {
  try {
    const res  = await fetchWithTimeout(`${API}/versions`, 5000);
    const data = await res.json();
    allVersions = data.versions || getDefaultVersions();
  } catch {
    allVersions = getDefaultVersions();
  }

  populateVersionSelect();
  renderVersionsPage('release');
}

function getDefaultVersions() {
  return [
    { id: '1.20.4', type: 'release', recommended: true  },
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

function populateVersionSelect() {
  const sel = document.getElementById('quick-version');
  sel.innerHTML = allVersions
    .filter(v => v.type === 'release')
    .map(v => `<option value="${v.id}">${v.id}${v.recommended ? ' (Рекомендуется)' : ''}</option>`)
    .join('');
}

// ─── Home Controls ────────────────────────────────
function initHomeControls() {
  const slider  = document.getElementById('ram-slider');
  const display = document.getElementById('ram-display');

  slider.addEventListener('input', () => {
    display.textContent = slider.value;
  });

  document.getElementById('launch-btn').addEventListener('click', handleLaunch);
}

async function handleLaunch() {
  if (isLaunching) return;

  // Проверить авторизацию
  let username = currentUser?.username;
  if (!username) {
    username = await askOfflineUsername();
    if (!username) return;
  }

  const version    = document.getElementById('quick-version').value;
  const ram        = parseInt(document.getElementById('ram-slider').value);
  const fullscreen = await ipcRenderer.invoke('store-get', 'fullscreen') || false;
  const javaPath   = await ipcRenderer.invoke('store-get', 'javaPath')   || 'java';
  const closeOnLaunch = await ipcRenderer.invoke('store-get', 'closeLauncher') ?? true;

  isLaunching = true;
  setLaunchBtnState('loading');
  showElement('download-progress');
  showElement('console-section');
  setProgress(0, 'Подготовка...');
  addLog(`Запуск Minecraft ${version} для ${username}...`, 'success');

  const result = await ipcRenderer.invoke('launch-minecraft', {
    username, version, ram, fullscreen, javaPath
  });

  if (!result.success) {
    showNotif('Ошибка: ' + result.error, 'error');
    addLog('Ошибка запуска: ' + result.error, 'error');
    isLaunching = false;
    setLaunchBtnState('idle');
    hideElement('download-progress');
    return;
  }

  showNotif(`Minecraft ${version} запускается! 🚀`, 'success');
  if (closeOnLaunch) {
    setTimeout(() => ipcRenderer.send('window-minimize'), 3000);
  }
}

function setLaunchBtnState(state) {
  const btn  = document.getElementById('launch-btn');
  const txt  = btn.querySelector('.btn-text');
  const icon = btn.querySelector('.btn-icon');

  if (state === 'loading') {
    btn.classList.add('loading');
    txt.textContent  = 'Загрузка...';
    icon.textContent = '⏳';
  } else {
    btn.classList.remove('loading');
    txt.textContent  = 'Играть';
    icon.textContent = '▶';
  }
}

async function askOfflineUsername() {
  const stored = await ipcRenderer.invoke('store-get', 'offlineUsername');
  if (stored) return stored;

  return new Promise(resolve => {
    const modal = document.getElementById('offline-modal');
    const input = document.getElementById('offline-username');
    modal.classList.add('show');
    input.focus();

    const confirm = async () => {
      const val = input.value.trim();
      if (!val || val.length < 3) {
        showNotif('Никнейм минимум 3 символа', 'error');
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(val)) {
        showNotif('Только буквы, цифры и _', 'error');
        return;
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

// ─── Versions Page ────────────────────────────────
function renderVersionsPage(filter) {
  const grid     = document.getElementById('versions-grid');
  const filtered = filter === 'all'
    ? allVersions
    : allVersions.filter(v => v.type === (filter === 'old' ? 'old_release' : filter));

  if (!filtered.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:20px">Нет версий</p>';
    return;
  }

  grid.innerHTML = filtered.map(v => `
    <div class="version-card ${v.recommended ? 'recommended' : ''}">
      <div class="version-number">${v.id}</div>
      <div class="version-type">
        ${v.type === 'release' ? 'Release' : 'Old Release'}
        ${v.recommended ? ' · <span style="color:var(--accent-2)">⭐ Рекомендуется</span>' : ''}
      </div>
      <div class="version-action">
        <button class="btn-play-small" onclick="launchVersion('${v.id}')">▶ Играть</button>
      </div>
    </div>
  `).join('');
}

window.launchVersion = function(version) {
  document.getElementById('quick-version').value = version;
  switchPage('home');
  setTimeout(handleLaunch, 200);
};

// Фильтры на странице версий
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderVersionsPage(btn.dataset.filter);
  });
});

// ─── Console ──────────────────────────────────────
function initConsole() {
  document.getElementById('console-clear').addEventListener('click', () => {
    document.getElementById('console-output').innerHTML = '';
    consoleLines = 0;
  });

  ipcRenderer.on('minecraft-log', (_, data) => {
    if (data.type === 'progress') {
      handleProgress(data.data);
    } else {
      addLog(String(data.message).slice(0, 300));
    }
  });

  ipcRenderer.on('minecraft-closed', (_, code) => {
    isLaunching = false;
    setLaunchBtnState('idle');
    hideElement('download-progress');
    addLog(`Minecraft закрыт (код: ${code})`, code === 0 ? 'success' : 'error');
    showNotif('Minecraft закрыт', code === 0 ? 'info' : 'error');
  });
}

function addLog(msg, type = '') {
  if (consoleLines > 500) {
    const out = document.getElementById('console-output');
    out.innerHTML = '';
    consoleLines = 0;
  }
  const out  = document.getElementById('console-output');
  const line = document.createElement('div');
  line.className   = `console-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
  consoleLines++;
}

function handleProgress(data) {
  if (data?.loaded && data?.total) {
    const pct = Math.round((data.loaded / data.total) * 100);
    setProgress(pct, getProgressLabel(data.type));
  }
}

function getProgressLabel(type) {
  const map = {
    assets:  'Загрузка ресурсов...',
    client:  'Загрузка клиента...',
    natives: 'Загрузка natives...',
    classes: 'Загрузка библиотек...'
  };
  return map[type] || 'Загрузка...';
}

function setProgress(pct, label) {
  document.getElementById('progress-bar').style.width     = `${pct}%`;
  document.getElementById('progress-percent').textContent = `${pct}%`;
  document.getElementById('progress-text').textContent    = label;
}

// ─── Auth ─────────────────────────────────────────
function initAuth() {
  // Переключение вход/регистрация
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('auth-form-login').classList.toggle('hidden', !isLogin);
      document.getElementById('auth-form-register').classList.toggle('hidden', isLogin);
    });
  });

  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-offline').addEventListener('click', async () => {
    const uname = await askOfflineUsername();
    if (uname) {
      currentUser = { username: uname, offline: true };
      updateUI();
      showNotif(`Привет, ${uname}! Оффлайн режим`, 'success');
    }
  });
  document.getElementById('btn-register').addEventListener('click', handleRegister);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
}

async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showNotif('Заполните все поля', 'error'); return;
  }

  const btn = document.getElementById('btn-login');
  setBtn(btn, 'Вхожу...', true);

  try {
    const res  = await fetchAPI('/auth/login', 'POST', { email, password });
    const data = await res.json();

    if (!res.ok) {
      showNotif(data.message || 'Ошибка входа', 'error');
      return;
    }

    currentUser = data.user;
    await ipcRenderer.invoke('store-set', 'token', data.token);
    await ipcRenderer.invoke('store-set', 'user', JSON.stringify(data.user));
    updateUI();
    showNotif(`Добро пожаловать, ${data.user.username}! 🎮`, 'success');
    switchPage('home');

  } catch (err) {
    showNotif('Сервер недоступен. Попробуйте позже.', 'error');
  } finally {
    setBtn(btn, 'Войти в аккаунт', false);
  }
}

async function handleRegister() {
  const username  = document.getElementById('reg-username').value.trim();
  const email     = document.getElementById('reg-email').value.trim();
  const password  = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;

  if (!username || !email || !password) {
    showNotif('Заполните все поля', 'error'); return;
  }
  if (password !== password2) {
    showNotif('Пароли не совпадают', 'error'); return;
  }
  if (password.length < 8) {
    showNotif('Пароль минимум 8 символов', 'error'); return;
  }
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
    showNotif('Никнейм: 3-16 символов, буквы/цифры/_', 'error'); return;
  }

  const btn = document.getElementById('btn-register');
  setBtn(btn, 'Создаю...', true);

  try {
    const res  = await fetchAPI('/auth/register', 'POST', { username, email, password });
    const data = await res.json();

    if (!res.ok) {
      showNotif(data.message || 'Ошибка регистрации', 'error');
      return;
    }

    currentUser = data.user;
    await ipcRenderer.invoke('store-set', 'token', data.token);
    await ipcRenderer.invoke('store-set', 'user', JSON.stringify(data.user));
    updateUI();
    showNotif(`Аккаунт создан! Добро пожаловать, ${username}! 🎉`, 'success');
    switchPage('home');

  } catch {
    showNotif('Сервер недоступен. Попробуйте позже.', 'error');
  } finally {
    setBtn(btn, 'Создать аккаунт', false);
  }
}

async function handleLogout() {
  currentUser = null;
  await ipcRenderer.invoke('store-delete', 'token');
  await ipcRenderer.invoke('store-delete', 'user');
  await ipcRenderer.invoke('store-delete', 'offlineUsername');
  document.getElementById('login-email').value    = '';
  document.getElementById('login-password').value = '';
  updateUI();
  showNotif('Вы вышли из аккаунта', 'info');
}

async function restoreSession() {
  try {
    const token   = await ipcRenderer.invoke('store-get', 'token');
    const userStr = await ipcRenderer.invoke('store-get', 'user');
    const offline = await ipcRenderer.invoke('store-get', 'offlineUsername');

    if (token && userStr) {
      const cached = JSON.parse(userStr);
      currentUser  = cached;

      // Фоновая проверка токена
      fetchAPI('/auth/me', 'GET', null, token)
        .then(r => r.json())
        .then(d => {
          if (d.user) {
            currentUser = d.user;
            ipcRenderer.invoke('store-set', 'user', JSON.stringify(d.user));
            updateUI();
          }
        })
        .catch(() => {});

    } else if (offline) {
      currentUser = { username: offline, offline: true };
    }
  } catch {}
}

// ─── Settings Page ────────────────────────────────
function initSettings() {
  loadSavedSettings();

  document.getElementById('default-ram').addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'defaultRam', e.target.value);
    document.getElementById('ram-slider').value = e.target.value;
    document.getElementById('ram-display').textContent = e.target.value;
  });

  document.getElementById('java-path').addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'javaPath', e.target.value.trim());
  });

  document.getElementById('fullscreen-toggle').addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'fullscreen', e.target.checked);
  });

  document.getElementById('close-launcher-toggle').addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'closeLauncher', e.target.checked);
  });

  document.getElementById('open-game-folder').addEventListener('click', () => {
    ipcRenderer.send('open-minecraft-folder');
  });

  document.getElementById('check-updates-btn').addEventListener('click', checkForUpdates);
}

async function loadSavedSettings() {
  const ram      = await ipcRenderer.invoke('store-get', 'defaultRam');
  const java     = await ipcRenderer.invoke('store-get', 'javaPath');
  const fs       = await ipcRenderer.invoke('store-get', 'fullscreen');
  const close    = await ipcRenderer.invoke('store-get', 'closeLauncher');

  if (ram)  {
    document.getElementById('default-ram').value = ram;
    document.getElementById('ram-slider').value  = ram;
    document.getElementById('ram-display').textContent = ram;
  }
  if (java)  document.getElementById('java-path').value            = java;
  if (fs)    document.getElementById('fullscreen-toggle').checked  = fs;
  document.getElementById('close-launcher-toggle').checked = close ?? true;
}

async function checkForUpdates() {
  const btn = document.getElementById('check-updates-btn');
  setBtn(btn, 'Проверяю...', true);

  try {
    const res  = await fetchAPI('/launcher/latest', 'GET');
    const data = await res.json();

    const current = '1.0.0';
    if (data.version === current) {
      showNotif('У вас последняя версия лаунчера ✅', 'success');
    } else {
      showNotif(`Доступна версия ${data.version}! Скачайте с сайта.`, 'info');
    }
  } catch {
    showNotif('Не удалось проверить обновления', 'error');
  } finally {
    setBtn(btn, 'Проверить обновления', false);
  }
}

// ─── News Page ────────────────────────────────────
function initNewsPage() {
  const newsData = [
    {
      emoji: '🎮',
      date:  '15 декабря 2024',
      title: 'CosmoLauncher 1.0 — релиз!',
      text:  'Первый публичный релиз нашего лаунчера. Поддержка всех версий Minecraft.',
      color: 'linear-gradient(135deg,#7c3aed,#4f46e5)'
    },
    {
      emoji: '⚡',
      date:  '10 декабря 2024',
      title: 'Оптимизация производительности',
      text:  'Встроенные JVM аргументы дают до +30% FPS без ручных настроек.',
      color: 'linear-gradient(135deg,#a855f7,#7c3aed)'
    },
    {
      emoji: '🔐',
      date:  '5 декабря 2024',
      title: 'Запущена система аккаунтов',
      text:  'Теперь можно создать аккаунт CosmoLauncher и сохранять настройки.',
      color: 'linear-gradient(135deg,#4f46e5,#2563eb)'
    },
    {
      emoji: '📦',
      date:  '1 декабря 2024',
      title: 'Minecraft 1.20.4 поддерживается',
      text:  'Добавлена поддержка последней версии Minecraft 1.20.4.',
      color: 'linear-gradient(135deg,#7c3aed,#a855f7)'
    }
  ];

  const grid = document.getElementById('news-grid');
  grid.innerHTML = newsData.map(n => `
    <div class="news-card">
      <div class="news-img" style="background:${n.color}">
        <span style="font-size:3rem">${n.emoji}</span>
      </div>
      <div class="news-body">
        <div class="news-date">${n.date}</div>
        <h3>${n.title}</h3>
        <p>${n.text}</p>
        <button class="btn-link">Читать подробнее →</button>
      </div>
    </div>
  `).join('');
}

// ─── Server Status ─────────────────────────────────
async function checkServerStatus() {
  const badge = document.getElementById('server-status-badge');
  if (!badge) return;

  try {
    const start = Date.now();
    const res   = await fetchWithTimeout(`${API}/health`, 4000);
    const data  = await res.json();
    const ping  = Date.now() - start;

    if (data.status === 'ok') {
      badge.textContent = `● Сервер онлайн · ${ping}ms`;
      badge.style.color = '#10b981';
    }
  } catch {
    badge.textContent = '● Сервер офлайн';
    badge.style.color = '#ef4444';
  }
}

// ─── Update UI ────────────────────────────────────
function updateUI() {
  const logged = !!currentUser;

  document.getElementById('auth-logged-out').style.display = logged ? 'none' : 'block';
  document.getElementById('auth-logged-in').style.display  = logged ? 'block' : 'none';

  const letter = logged ? currentUser.username[0].toUpperCase() : '?';

  document.getElementById('profile-avatar').textContent = letter;
  document.getElementById('profile-name').textContent   = logged ? currentUser.username : 'Не войдено';
  document.getElementById('profile-status').textContent =
    !logged             ? 'Нажмите для входа'  :
    currentUser.offline ? 'Оффлайн режим'      :
                          'CosmoLauncher';

  if (logged) {
    document.getElementById('user-avatar-big').textContent   = letter;
    document.getElementById('user-name-big').textContent     = currentUser.username;
    document.getElementById('user-email-display').textContent =
      currentUser.email || 'Оффлайн режим';
  }
}

// ─── Helpers ──────────────────────────────────────
function fetchAPI(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
}

function fetchWithTimeout(url, ms) {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
}

function setBtn(btn, text, disabled) {
  btn.textContent = text;
  btn.disabled    = disabled;
}

function showElement(id) {
  document.getElementById(id).style.display = 'block';
}

function hideElement(id) {
  document.getElementById(id).style.display = 'none';
}

function showNotif(msg, type = 'info') {
  const c = document.getElementById('notifications');
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