const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path  = require('path');
const Store = require('electron-store');

let autoUpdater;
let log;

// Подключаем updater только в продакшне
try {
  autoUpdater = require('electron-updater').autoUpdater;
  log = require('electron-log');

  // ── Правильная настройка логов ──
  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
} catch (e) {
  console.log('electron-updater не найден:', e.message);
}

const { launchMinecraft, getMinecraftPath } = require('./minecraft/launcher');

const store = new Store();

let mainWindow;
let splashWindow;

// ─── Splash ───────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width:       400,
    height:      250,
    frame:       false,
    transparent: true,
    resizable:   false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center:      true,
    webPreferences: { nodeIntegration: false },
    backgroundColor: '#00000000',
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

// ─── Main Window ──────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:     1100,
    height:    680,
    minWidth:  900,
    minHeight: 600,
    frame:     false,
    show:      false,
    center:    true,
    backgroundColor: '#0d0a1a',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();

      // Проверить обновления через 4 секунды
      if (app.isPackaged && autoUpdater) {
        setTimeout(() => checkForUpdates(), 4000);
      }
    }, 2500);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Проверка обновлений ──────────────────────────
function checkForUpdates() {
  if (!autoUpdater) return;
  autoUpdater.checkForUpdates().catch(err => {
    console.log('Ошибка проверки обновлений:', err.message);
  });
}

// ─── AutoUpdater события ──────────────────────────
function setupUpdaterEvents() {
  if (!autoUpdater) return;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      notes:   info.releaseNotes || '',
      date:    info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-download-progress', {
      percent: Math.round(progress.percent),
      speed:   progress.bytesPerSecond,
      total:   progress.total,
      loaded:  progress.transferred,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err);
    mainWindow?.webContents.send('update-error', err.message);
  });
}

// ─── App Ready ────────────────────────────────────
app.whenReady().then(() => {
  setupUpdaterEvents();
  createSplash();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC — Окно ───────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => app.quit());

// ─── IPC — Store ──────────────────────────────────
ipcMain.handle('store-get',    (_, key)        => store.get(key));
ipcMain.handle('store-set',    (_, key, value) => store.set(key, value));
ipcMain.handle('store-delete', (_, key)        => store.delete(key));

// ─── IPC — Minecraft ──────────────────────────────
ipcMain.handle('launch-minecraft', async (_, options) => {
  try {
    await launchMinecraft(
      options,
      (data) => mainWindow?.webContents.send('minecraft-log', data),
      (code) => mainWindow?.webContents.send('minecraft-closed', code)
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC — Папки ──────────────────────────────────
ipcMain.on('open-minecraft-folder', () => {
  shell.openPath(getMinecraftPath());
});

ipcMain.handle('get-minecraft-path', () => getMinecraftPath());

// ─── IPC — Обновления ─────────────────────────────
ipcMain.handle('update-download', async () => {
  if (!autoUpdater) return { success: false, error: 'Updater недоступен' };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('update-install', () => {
  autoUpdater?.quitAndInstall(false, true);
});

ipcMain.handle('check-updates-manual', async () => {
  if (!app.isPackaged) {
    return { success: false, error: 'Dev режим — обновления недоступны' };
  }
  if (!autoUpdater) {
    return { success: false, error: 'Updater недоступен' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

// ─── IPC — Java ───────────────────────────────────
ipcMain.handle('browse-java', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      'Выберите java.exe',
    properties: ['openFile'],
    filters:    [{ name: 'Java', extensions: ['exe', ''] }]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});