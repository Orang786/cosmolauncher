const fs   = require('fs');
const path = require('path');

// Этот скрипт создаёт заглушки иконок если нет настоящих
// В продакшне замени на реальные иконки!

async function createIcons() {
  const assetsDir = path.join(__dirname, '../assets');
  const iconsDir  = path.join(assetsDir, 'icons');

  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  console.log('📁 Папка assets/icons создана');
  console.log('⚠️  Положи реальные иконки:');
  console.log('   assets/icon.ico   — для Windows (256x256)');
  console.log('   assets/icon.icns  — для macOS');
  console.log('   assets/icon.png   — 512x512 PNG');
  console.log('   assets/icons/     — PNG разных размеров для Linux');
  console.log('');
  console.log('🔗 Конвертер иконок: https://www.icoconverter.com/');
  console.log('🔗 Или: https://cloudconvert.com/png-to-ico');
}

createIcons();