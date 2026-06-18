// ─── Config ────────────────────────────────────────
const API = 'https://cosmolauncher-api.onrender.com/api';
// Для локальной разработки:
// const API = 'http://localhost:3001/api';

const GITHUB_USER = 'Orang786'; // твой никнейм на GitHub
const GITHUB_REPO = 'cosmolauncher';
const VERSION     = '1.0.0';
const GITHUB_BASE = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download/v${VERSION}`;

const DOWNLOADS = {
  'win32':          `${GITHUB_BASE}/CosmoLauncher.Setup.${VERSION}.exe`,
  'win32-portable': `${GITHUB_BASE}/CosmoLauncher.${VERSION}.exe`,
  'linux':          `${GITHUB_BASE}/CosmoLauncher-${VERSION}.AppImage`,
  'darwin':         `${GITHUB_BASE}/CosmoLauncher-${VERSION}.dmg`,
};

// ─── Cursor glow ───────────────────────────────────
const cursorGlow = document.getElementById('cursor-glow');
document.addEventListener('mousemove', e => {
  cursorGlow.style.left = e.clientX + 'px';
  cursorGlow.style.top  = e.clientY + 'px';
});

// ─── Particles ─────────────────────────────────────
(function createParticles() {
  const c = document.getElementById('particles');
  for (let i = 0; i < 50; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 3 + 1;
    const colors = ['168,85,247', '124,58,237', '192,132,252', '79,70,229'];
    const col = colors[Math.floor(Math.random() * colors.length)];
    Object.assign(p.style, {
      left:             Math.random() * 100 + '%',
      bottom:           '0',
      width:            size + 'px',
      height:           size + 'px',
      background:       `rgb(${col})`,
      animationDuration: (Math.random() * 25 + 10) + 's',
      animationDelay:   '-' + (Math.random() * 25) + 's',
    });
    c.appendChild(p);
  }
})();

// ─── Navbar scroll ─────────────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// ─── Reveal on scroll ──────────────────────────────
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ─── Parallax orbs ─────────────────────────────────
document.addEventListener('mousemove', e => {
  const x = (e.clientX / window.innerWidth  - 0.5) * 2;
  const y = (e.clientY / window.innerHeight - 0.5) * 2;
  document.querySelectorAll('.hero-orb').forEach((orb, i) => {
    const s = (i + 1) * 12;
    orb.style.transform = `translate(${x * s}px, ${y * s}px)`;
  });
}, { passive: true });

// ─── Count-up animation ────────────────────────────
function animateCount(el, target, suffix = '') {
  let start = 0;
  const dur = 1800;
  const step = timestamp => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / dur, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(eased * target).toLocaleString('ru') + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const statsObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const nums = e.target.querySelectorAll('.stat-num[data-target]');
    nums.forEach(el => {
      const t = parseInt(el.dataset.target);
      const suffix = t === 99 ? '%' : t > 1000 ? '+' : '';
      animateCount(el, t, suffix);
    });
    statsObserver.unobserve(e.target);
  });
}, { threshold: 0.3 });

const statsBar = document.querySelector('.stats-bar');
if (statsBar) statsObserver.observe(statsBar);

// ─── OS Detection ──────────────────────────────────
function detectOS() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win'))   return 'win32';
  if (ua.includes('mac'))   return 'darwin';
  if (ua.includes('linux')) return 'linux';
  return 'win32';
}

function setupOSDetection() {
  const os = detectOS();
  const names = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  const icons = { win32: '🪟', darwin: '🍎', linux: '🐧' };
  const btnTexts = {
    win32:  'Скачать для Windows',
    darwin: 'Скачать для macOS',
    linux:  'Скачать для Linux',
  };

  document.getElementById('os-name').textContent  = names[os] || 'Windows';
  document.getElementById('os-icon').textContent  = icons[os] || '🪟';
  document.getElementById('hero-btn-text').textContent = btnTexts[os] || 'Скачать';

  // Подсветить нужную карточку
  document.querySelectorAll('.dl-card').forEach(card => {
    card.style.order = card.dataset.os === os ? '-1' : '0';
  });
}

setupOSDetection();

function downloadFile(platform) {
  const url = DOWNLOADS[platform];
  if (!url) {
    showToast('Платформа пока не поддерживается', 'info');
    return;
  }

  showToast('Загрузка началась! ✨', 'success');
  const a = document.createElement('a');
  a.href     = url;
  a.download = '';
  a.target   = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function detectAndDownload() {
  downloadFile(detectOS());
}

// ─── Interface tabs ────────────────────────────────
document.querySelectorAll('.if-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.if-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.if-screen').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`if-${tab.dataset.tab}`)?.classList.add('active');
  });
});

// ─── Install guide tabs ────────────────────────────
document.querySelectorAll('.ig-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ig-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ig-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`ig-${tab.dataset.osTab}`)?.classList.add('active');
  });
});

// Автовыбор таба инструкции по ОС
(function() {
  const os = detectOS();
  const tabMap = { win32: 'windows', darwin: 'macos', linux: 'linux' };
  const tabName = tabMap[os] || 'windows';
  document.querySelector(`.ig-tab[data-os-tab="${tabName}"]`)?.click();
})();

// ─── Versions from API ─────────────────────────────
async function loadVersions() {
  const grid = document.getElementById('versions-live-grid');
  let allVersions = [];

  try {
    const res = await fetch(`${API}/versions`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    allVersions = data.versions || [];
  } catch {
    // Фолбэк если API недоступен
    allVersions = [
      { id: '1.20.4', type: 'release', recommended: true },
      { id: '1.20.2', type: 'release' },
      { id: '1.20.1', type: 'release' },
      { id: '1.19.4', type: 'release' },
      { id: '1.18.2', type: 'release' },
      { id: '1.16.5', type: 'release' },
      { id: '1.12.2', type: 'release' },
      { id: '1.8.9',  type: 'release' },
      { id: '1.7.10', type: 'old_release' },
    ];
  }

  function renderVersions(filter) {
    const filtered = filter === 'all'
      ? allVersions
      : allVersions.filter(v => v.type === filter);

    grid.innerHTML = filtered.map(v => `
      <div class="vl-card ${v.recommended ? 'recommended' : ''}">
        <div class="vl-num">${v.id}</div>
        <div class="vl-type">${v.type === 'release' ? 'Release' : 'Old Release'}</div>
        ${v.recommended ? '<div class="vl-rec">⭐ Рекомендуется</div>' : ''}
      </div>
    `).join('');
  }

  renderVersions('all');

  // Фильтры
  document.querySelectorAll('.vl-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.vl-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVersions(btn.dataset.f);
    });
  });
}

loadVersions();

// ─── Server status check ───────────────────────────
async function checkServerStatus() {
  const badge   = document.getElementById('server-badge');
  const footer  = document.getElementById('footer-server-status');

  try {
    const start = Date.now();
    const res   = await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) });
    const data  = await res.json();
    const ping  = Date.now() - start;

    if (data.status === 'ok') {
      badge.innerHTML  = '<span class="badge-dot"></span> Сервер работает · ' + ping + 'ms';
      footer.textContent = '● Онлайн · ' + ping + 'ms';
      footer.style.color = '#10b981';
    }
  } catch {
    badge.innerHTML   = '<span style="background:#ef4444" class="badge-dot"></span> Сервер недоступен';
    badge.style.color = '#ef4444';
    badge.style.borderColor = 'rgba(239,68,68,.2)';
    badge.style.background  = 'rgba(239,68,68,.06)';
    footer.textContent = '● Офлайн';
    footer.style.color = '#ef4444';
  }
}

checkServerStatus();
setInterval(checkServerStatus, 60000);

// ─── Smooth scroll ─────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth' });
  });
});

// ─── Toast notifications ───────────────────────────
function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed',
    bottom:   '24px',
    right:    '24px',
    zIndex:   '9999',
    padding:  '14px 20px',
    background: type === 'success' ? 'rgba(16,185,129,.12)' : 'rgba(124,58,237,.12)',
    border:   `1px solid ${type === 'success' ? 'rgba(16,185,129,.3)' : 'rgba(124,58,237,.3)'}`,
    borderRadius: '12px',
    color:    type === 'success' ? '#10b981' : '#c084fc',
    fontSize: '14px',
    fontFamily: 'Inter, sans-serif',
    fontWeight: '500',
    boxShadow: '0 8px 32px rgba(0,0,0,.3)',
    animation: 'none',
    opacity:  '0',
    transform: 'translateY(10px)',
    transition: 'all .3s ease',
  });
  toast.textContent = msg;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity   = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}