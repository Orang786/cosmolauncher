const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const router = express.Router();
const User   = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'cosmo_secret_key_change_me';
const JWT_EXPIRE = '30d';

// ─── Helpers ──────────────────────────────────────
function generateToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRE });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Нет токена' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ message: 'Токен недействителен' });
  }
}

// ─── POST /api/auth/register ──────────────────────
router.post('/register', [
  body('username')
    .isLength({ min: 3, max: 16 })
    .withMessage('Никнейм: 3-16 символов')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Никнейм: только буквы, цифры и _'),
  body('email')
    .isEmail()
    .withMessage('Некорректный email')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Пароль минимум 8 символов')
], async (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: errors.array()[0].msg
    });
  }

  const { username, email, password } = req.body;

  try {
    // Проверяем email
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: 'Email уже используется' });
    }

    // Проверяем никнейм (без учёта регистра)
    const existingUsername = await User.findOne({
      username: { $regex: new RegExp(`^${username}$`, 'i') }
    });
    if (existingUsername) {
      return res.status(400).json({ message: 'Никнейм уже занят' });
    }

    // Хэшируем пароль
    const hashedPassword = await bcrypt.hash(password, 12);

    // Создаём пользователя
    const user = await User.create({
      username,
      email,
      password: hashedPassword
    });

    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: {
        id:        user._id,
        username:  user.username,
        email:     user.email,
        createdAt: user.createdAt
      }
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// ─── POST /api/auth/login ─────────────────────────
router.post('/login', [
  body('email').notEmpty().withMessage('Введите логин'),
  body('password').notEmpty().withMessage('Введите пароль')
], async (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }

  const { email, password } = req.body;

  try {
    // Поиск по email ИЛИ никнейму
    const user = await User.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        { username: { $regex: new RegExp(`^${email}$`, 'i') } }
      ]
    });

    if (!user) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    // Обновляем дату входа
    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id:        user._id,
        username:  user.username,
        email:     user.email,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    res.json({ user });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// ─── ВАЖНО: экспортируем только router ────────────
module.exports = router;