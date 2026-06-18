require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const axios     = require('axios');

const authRoutes = require('./routes/auth');

const app = express();

// ─── CORS ─────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Rate Limit ───────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { message: 'Слишком много запросов' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Слишком много попыток' }
});

app.use('/api/', limiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── Routes ───────────────────────────────────────
app.use('/api/auth', authRoutes);

// ─── Versions (кэш) ───────────────────────────────
let versionsCache     = null;
let versionsCacheTime = 0;
const CACHE_TTL       = 10 * 60 * 1000;

app.get('/api/versions', async (req, res) => {
  try {
    if (versionsCache && Date.now() - versionsCacheTime < CACHE_TTL) {
      return res.json({ versions: versionsCache });
    }

    const response = await axios.get(
      'https://launchermeta.mojang.com/mc/game/version_manifest.json',
      { timeout: 8000 }
    );

    const data = response.data;

    const versions = data.versions.map(v => ({
      id:             v.id,
      type:           v.type,
      releaseTime:    v.releaseTime,
      recommended:    v.id === data.latest.release,
      latest:         v.id === data.latest.release,
      latestSnapshot: v.id === data.latest.snapshot,
    }));

    versionsCache     = versions;
    versionsCacheTime = Date.now();

    res.json({ versions, latest: data.latest });

  } catch (err) {
    console.error('Ошибка загрузки версий:', err.message);
    if (versionsCache) {
      return res.json({ versions: versionsCache });
    }
    res.status(500).json({ message: 'Не удалось загрузить версии' });
  }
});

// ─── Launcher latest ──────────────────────────────
app.get('/api/launcher/latest', (req, res) => {
  res.json({
    version: '1.0.0',
    downloads: {
      win32:  'https://github.com/Orang786/cosmolauncher/releases/download/NewUpdate/CosmoLauncher.Setup.1.0.0.exe',
      linux:  'https://github.com/Orang786/cosmolauncher/releases/download/NewUpdate/CosmoLauncher.1.0.0.AppImage',
      darwin: 'https://github.com/Orang786/cosmolauncher/releases/download/NewUpdate/CosmoLauncher.1.0.0.dmg'
    },
    changelog: [
      'Первый публичный релиз',
      'Загрузка всех версий с Mojang API',
      'Система аккаунтов',
      'Оффлайн режим'
    ]
  });
});

// ─── Health ───────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ name: 'CosmoLauncher API', status: 'running' });
});

app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    db:        mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime:    process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Не найдено' });
});

// ─── Start ────────────────────────────────────────
const PORT = process.env.PORT || 3001;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB Atlas подключена');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Сервер на порту ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Ошибка MongoDB:', err.message);
    process.exit(1);
  });