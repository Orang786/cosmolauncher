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
  initVersionsPage();

  await restoreSession();
  await loadVersions();
  updateUI();
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

// ─── Versions ─────────────────────────────────────
function getDefaultVersions() {
  return [
    { id: '1.20.4', type: 'release',     recommended: true },
    { id: '1.20.2', type: 'release' },
    { id: '1.20.1', type: 'release' },
    { id: '1.19.4', type: 'release' },
    { id: '1.19.2', type: 'release' },
    { id: '1.18.2', type: 'release' },
    { id: '1.17.1', type: 'release' },
    { id: '1.16.5', type: 'release' },
    { id: '1.15.2', type: 'release' },
    { id: '1.12.2', type: 'release' },
    { id: '1.8.9',  type: 'release' },
    { id: '1.7.10', type: 'old_release' },
    { id: '1.5.2',  type: 'old_release' },
  ];
}

async function loadVersions() {
  // Сразу ставим дефолтные чтобы не было пустоты
  allVersions = getDefaultVersions();
  populateVersionSelect();
  renderVersionsPage('release');

  // Пробуем загрузить с API
  try {
    const res  = await fetch(`${API}/versions`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    if (data.versions && data.versions.length > 0) {
      allVersions = data.versions;
      populateVersionSelect();
      renderVersionsPage('release');
    }
  } catch {
    // Остаёмся на дефолтных
    console.log('API недоступен, используем дефолтные версии');
  }
}

function populateVersionSelect() {
  const sel = document.getElementById('quick-version');
  if (!sel) return;
  sel.innerHTML = allVersions
    .filter(v => v.type === 'release')
    .map(v => `
      <option value="${v.id}">
        ${v.id}${v.recommended ? ' (Рекомендуется)' : ''}
      </option>
    `).join('');
}

// ─── Versions Page ────────────────────────────────
function initVersionsPage() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVersionsPage(btn.dataset.filter);
    });
  });
}

function renderVersionsPage(filter) {
  const grid = document.getElementById('versions-grid');
  if (!grid) return;

  let filtered = [];

  if (filter === 'release') {
    filtered = allVersions.filter(v => v.type === 'release');
  } else if (filter === 'old') {
    filtered = allVersions.filter(v => v.type === 'old_release');
  } else if (filter === 'snapshot') {
    filtered = allVersions.filter(v => v.type === 'snapshot');
  } else {
    filtered = allVersions;
  }

  if (!filtered.length) {
    grid.innerHTML = `
      <p style="color:var(--text-muted);padding:20px;grid-column:1/-1">
        Нет версий в этой категории
      </p>`;
    return;
  }

  grid.innerHTML = filtered.map(v => `
    <div class="version-card ${v.recommended ? 'recommended' : ''}">
      <div class="version-number">${v.id}</div>
      <div class="version-type">
        ${v.type === 'release' ? 'Release' : 'Old Release'}
        ${v.recommended
          ? ' · <span style="color:var(--accent-2)">⭐ Рекомендуется</span>'
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

// ─── Home Controls ────────────────────────────────
function initHomeControls() {
  const slider  = document.getElementById('ram-slider');
  const display = document.getElementById('ram-display');
  if (slider) {
    slider.addEventListener('input', () => {
      display.textContent = slider.value;
    });
  }
  document.getElementById('launch-btn')?.addEventListener('click', handleLaunch);
}

async function handleLaunch() {
  if (isLaunching) return;

  let username = currentUser?.username;
  if (!username) {
    username = await askOfflineUsername();
    if (!username) return;
  }

  const version       = document.getElementById('quick-version').value;
  const ram           = parseInt(document.getElementById('ram-slider').value);
  const fullscreen    = await ipcRenderer.invoke('store-get', 'fullscreen') || false;
  const javaPath      = await ipcRenderer.invoke('store-get', 'javaPath')   || 'java';
  const closeOnLaunch = await ipcRenderer.invoke('store-get', 'closeLauncher') ?? true;

  isLaunching = true;
  setLaunchBtnState('loading');
  showElement('download-progress');
  showElement('console-section');
  setProgress(0, 'Подготовка...');
  addLog(`▶ Запуск Minecraft ${version} для ${username}...`, 'success');

  const result = await ipcRenderer.invoke('launch-minecraft', {
    username, version, ram, fullscreen, javaPath
  });

  if (!result.success) {
    showNotif('Ошибка: ' + result.error, 'error');
    addLog('❌ Ошибка: ' + result.error, 'error');
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

// ─── Console ──────────────────────────────────────
function initConsole() {
  document.getElementById('console-clear')?.addEventListener('click', () => {
    const out = document.getElementById('console-output');
    if (out) out.innerHTML = '';
    consoleLines = 0;
  });

  // ── ПРОБЛЕМА 2 ИСПРАВЛЕНА ЗДЕСЬ ──
  // Слушаем закрытие Minecraft и сбрасываем кнопку
  ipcRenderer.on('minecraft-log', (_, data) => {
    if (data.type === 'progress') {
      handleProgress(data.data);
    } else {
      addLog(String(data.message || '').slice(0, 300));
    }
  });

  ipcRenderer.on('minecraft-closed', (_, code) => {
    // Сбрасываем состояние кнопки когда Minecraft закрылся
    isLaunching = false;
    setLaunchBtnState('idle');
    hideElement('download-progress');
    addLog(
      `■ Minecraft закрыт (код: ${code})`,
      code === 0 ? 'success' : 'error'
    );
    showNotif(
      code === 0 ? 'Minecraft закрыт' : `Minecraft закрыт с ошибкой (код: ${code})`,
      code === 0 ? 'info' : 'error'
    );
  });

  // Если Minecraft запустился успешно — ставим кнопку в режим "запущено"
  ipcRenderer.on('minecraft-launched', () => {
    setLaunchBtnState('launched');
    addLog('✅ Minecraft запущен!', 'success');
    showNotif('Minecraft запущен! 🎮', 'success');
  });
}

function addLog(msg, type = '') {
  if (consoleLines > 500) {
    const out = document.getElementById('console-output');
    if (out) out.innerHTML = '';
    consoleLines = 0;
  }
  const out  = document.getElementById('console-output');
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
    const pct = Math.round((data.loaded / data.total) * 100);
    setProgress(pct, getProgressLabel(data.type));
  }
}

function getProgressLabel(type) {
  return {
    assets:  'Загрузка ресурсов...',
    client:  'Загрузка клиента...',
    natives: 'Загрузка natives...',
    classes: 'Загрузка библиотек...',
  }[type] || 'Загрузка...';
}

function setProgress(pct, label) {
  const bar     = document.getElementById('progress-bar');
  const percent = document.getElementById('progress-percent');
  const text    = document.getElementById('progress-text');
  if (bar)     bar.style.width     = `${pct}%`;
  if (percent) percent.textContent = `${pct}%`;
  if (text)    text.textContent    = label;
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
    // Сбросить сохранённый ник чтобы показалось окно
    await ipcRenderer.invoke('store-delete', 'offlineUsername');
    const uname = await askOfflineUsername();
    if (uname) {
      currentUser = { username: uname, offline: true };
      // ── ПРОБЛЕМА 3 ИСПРАВЛЕНА — сохраняем offline пользователя ──
      await ipcRenderer.invoke('store-set', 'offlineUser', JSON.stringify(currentUser));
      updateUI();
      showNotif(`Привет, ${uname}! Оффлайн режим 🎮`, 'success');
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
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
      signal:  AbortSignal.timeout(10000)
    });
    const data = await res.json();

    if (!res.ok) {
      showNotif(data.message || 'Ошибка входа', 'error');
      return;
    }

    currentUser = data.user;
    // ── ПРОБЛЕМА 3 ИСПРАВЛЕНА — сохраняем токен и данные ──
    await ipcRenderer.invoke('store-set', 'token', data.token);
    await ipcRenderer.invoke('store-set', 'user', JSON.stringify(data.user));
    await ipcRenderer.invoke('store-delete', 'offlineUser');
    await ipcRenderer.invoke('store-delete', 'offlineUsername');

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
  const username  = document.getElementById('reg-username')?.value.trim();
  const email     = document.getElementById('reg-email')?.value.trim();
  const password  = document.getElementById('reg-password')?.value;
  const password2 = document.getElementById('reg-password2')?.value;

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
    const res  = await fetch(`${API}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, email, password }),
      signal:  AbortSignal.timeout(10000)
    });
    const data = await res.json();

    if (!res.ok) {
      showNotif(data.message || 'Ошибка регистрации', 'error');
      return;
    }

    currentUser = data.user;
    // ── ПРОБЛЕМА 3 ИСПРАВЛЕНА — сохраняем сессию ──
    await ipcRenderer.invoke('store-set', 'token', data.token);
    await ipcRenderer.invoke('store-set', 'user', JSON.stringify(data.user));
    await ipcRenderer.invoke('store-delete', 'offlineUser');

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
  await ipcRenderer.invoke('store-delete', 'offlineUser');
  await ipcRenderer.invoke('store-delete', 'offlineUsername');
  if (document.getElementById('login-email'))
    document.getElementById('login-email').value    = '';
  if (document.getElementById('login-password'))
    document.getElementById('login-password').value = '';
  updateUI();
  showNotif('Вы вышли из аккаунта', 'info');
}

// ── ПРОБЛЕМА 3 ИСПРАВЛЕНА — правильное восстановление сессии ──
async function restoreSession() {
  try {
    const token      = await ipcRenderer.invoke('store-get', 'token');
    const userStr    = await ipcRenderer.invoke('store-get', 'user');
    const offlineStr = await ipcRenderer.invoke('store-get', 'offlineUser');

    if (token && userStr) {
      // Есть аккаунт — восстанавливаем из кэша сразу
      currentUser = JSON.parse(userStr);

      // Фоновая проверка токена
      fetch(`${API}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal:  AbortSignal.timeout(5000)
      })
      .then(r => r.json())
      .then(async d => {
        if (d.user) {
          currentUser = d.user;
          await ipcRenderer.invoke('store-set', 'user', JSON.stringify(d.user));
          updateUI();
        }
      })
      .catch(() => {
        // Токен устарел но кэш есть — всё равно показываем пользователя
        console.log('Токен устарел, используем кэш');
      });

    } else if (offlineStr) {
      // Оффлайн пользователь
      currentUser = JSON.parse(offlineStr);
    }

  } catch (e) {
    console.log('Ошибка восстановления сессии:', e);
  }
}

// ─── Settings ─────────────────────────────────────
function initSettings() {
  loadSavedSettings();

  document.getElementById('default-ram')?.addEventListener('change', e => {
    ipcRenderer.invoke('store-set', 'defaultRam', e.target.value);
    const slider = document.getElementById('ram-slider');
    const disp   = document.getElementById('ram-display');
    if (slider) slider.value = e.target.value;
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
      if (data.version === '1.0.0') {
        showNotif('У вас последняя версия ✅', 'success');
      } else {
        showNotif(`Доступна версия ${data.version}!`, 'info');
      }
    } catch {
      showNotif('Не удалось проверить обновления', 'error');
    } finally {
      setBtn(btn, 'Проверить обновления', false);
    }
  });
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
    if (sel)    sel.value          = ram;
    if (slider) slider.value       = ram;
    if (disp)   disp.textContent   = ram;
  }
  if (java) {
    const el = document.getElementById('java-path');
    if (el) el.value = java;
  }
  if (fs !== undefined) {
    const el = document.getElementById('fullscreen-toggle');
    if (el) el.checked = fs;
  }
  const closeEl = document.getElementById('close-launcher-toggle');
  if (closeEl) closeEl.checked = close ?? true;
}

// ─── News Page ────────────────────────────────────
function initNewsPage() {
  const newsData = [
    {
      emoji: '🎮', color: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
      date:  '15 декабря 2024',
      title: 'CosmoLauncher 1.0 — релиз!',
      text:  'Первый публичный релиз. Поддержка всех версий Minecraft от 1.5 до 1.20.4.'
    },
    {
      emoji: '⚡', color: 'linear-gradient(135deg,#a855f7,#7c3aed)',
      date:  '10 декабря 2024',
      title: 'Оптимизация производительности',
      text:  'Встроенные JVM аргументы дают до +30% FPS без ручных настроек.'
    },
    {
      emoji: '🔐', color: 'linear-gradient(135deg,#4f46e5,#2563eb)',
      date:  '5 декабря 2024',
      title: 'Система аккаунтов',
      text:  'Теперь можно создать аккаунт CosmoLauncher и сохранять настройки.'
    },
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
        <button class="btn-link">Читать подробнее →</button>
      </div>
    </div>
  `).join('');
}

// ─── Update UI ────────────────────────────────────
function updateUI() {
  const logged = !!currentUser;
  const loggedOut = document.getElementById('auth-logged-out');
  const loggedIn  = document.getElementById('auth-logged-in');

  if (loggedOut) loggedOut.style.display = logged ? 'none'  : 'block';
  if (loggedIn)  loggedIn.style.display  = logged ? 'block' : 'none';

  const letter = logged ? currentUser.username[0].toUpperCase() : '?';

  const els = {
    'profile-avatar':     letter,
    'profile-name':       logged ? currentUser.username : 'Не войдено',
    'profile-status':     !logged             ? 'Нажмите для входа' :
                          currentUser.offline ? 'Оффлайн режим'     : 'CosmoLauncher',
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