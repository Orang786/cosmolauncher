require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const authRoutes = require('./routes/auth');

const app = express();

// ─── CORS ─────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'https://cosmolauncher.onrender.com',
  'https://cosmolauncher.com'
];

app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без origin (Electron app)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, true); // В проде можно убрать и сделать строго
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Rate Limit ───────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Слишком много запросов' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Слишком много попыток входа' }
});

app.use('/api/', limiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── Routes ───────────────────────────────────────
app.use('/api/auth', authRoutes);

// Версии Minecraft (для лаунчера и сайта)
app.get('/api/versions', (req, res) => {
  res.json({
    versions: [
      { id: '1.20.4', type: 'release', releaseTime: '2023-12-07', recommended: true },
      { id: '1.20.2', type: 'release', releaseTime: '2023-10-17' },
      { id: '1.20.1', type: 'release', releaseTime: '2023-06-12' },
      { id: '1.19.4', type: 'release', releaseTime: '2023-03-14' },
      { id: '1.19.2', type: 'release', releaseTime: '2022-08-05' },
      { id: '1.18.2', type: 'release', releaseTime: '2022-02-28' },
      { id: '1.17.1', type: 'release', releaseTime: '2021-07-06' },
      { id: '1.16.5', type: 'release', releaseTime: '2021-01-15' },
      { id: '1.15.2', type: 'release', releaseTime: '2020-01-21' },
      { id: '1.12.2', type: 'release', releaseTime: '2017-09-18' },
      { id: '1.8.9',  type: 'release', releaseTime: '2015-12-09' },
      { id: '1.7.10', type: 'old_release', releaseTime: '2014-06-26' },
      { id: '1.5.2',  type: 'old_release', releaseTime: '2013-05-02' },
    ]
  });
});

// Информация о последней версии лаунчера (для авто-обновления)
app.get('/api/launcher/latest', (req, res) => {
  res.json({
    version: '1.0.0',
    downloads: {
      win32:  `${process.env.SITE_URL || 'https://cosmolauncher.onrender.com'}/downloads/CosmoLauncher-Setup-1.0.0.exe`,
      linux:  `${process.env.SITE_URL || 'https://cosmolauncher.onrender.com'}/downloads/CosmoLauncher-1.0.0.AppImage`,
      darwin: `${process.env.SITE_URL || 'https://cosmolauncher.onrender.com'}/downloads/CosmoLauncher-1.0.0.dmg`
    },
    changelog: [
      'Первый публичный релиз',
      'Поддержка всех версий Minecraft',
      'Система аккаунтов CosmoLauncher',
      'Оффлайн режим'
    ]
  });
});

// Health check (Render проверяет этот endpoint)
app.get('/', (req, res) => {
  res.json({
    name: 'CosmoLauncher API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ message: 'Не найдено' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Ошибка сервера' });
});

// ─── Start ────────────────────────────────────────
const PORT = process.env.PORT || 3001;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB Atlas подключена');
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Сервер запущен на порту ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Ошибка MongoDB:', err.message);
    process.exit(1);
  });