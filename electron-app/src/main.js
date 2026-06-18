const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path  = require('path');
const Store = require('electron-store');
const { launchMinecraft, getMinecraftPath } = require('./minecraft/launcher');

const store = new Store();

let mainWindow;
let splashWindow;

// ─── Splash Screen ────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width:           400,
    height:          250,
    frame:           false,
    transparent:     true,
    resizable:       false,
    alwaysOnTop:     true,
    skipTaskbar:     true,
    center:          true,
    webPreferences:  { nodeIntegration: false },
    backgroundColor: '#00000000',
    hasShadow:       true,
    roundedCorners:  true,
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.setIgnoreMouseEvents(false);
}

// ─── Main Window ──────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:    1100,
    height:   680,
    minWidth: 900,
    minHeight:600,
    frame:    false,
    show:     false,
    center:   true,
    backgroundColor: '#0d0a1a',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    titleBarStyle: 'hidden',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Когда главное окно готово
  mainWindow.once('ready-to-show', () => {
    // Закрыть сплэш через 2.5 секунды
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, 2500);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Ready ────────────────────────────────────
app.whenReady().then(() => {
  createSplash();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
});

// ─── IPC — Окно ───────────────────────────────────
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  app.quit();
});

// ─── IPC — Store ──────────────────────────────────
ipcMain.handle('store-get',    (_, key)        => store.get(key));
ipcMain.handle('store-set',    (_, key, value) => store.set(key, value));
ipcMain.handle('store-delete', (_, key)        => store.delete(key));

// ─── IPC — Minecraft ──────────────────────────────
ipcMain.handle('launch-minecraft', async (_, options) => {
  try {
    await launchMinecraft(
      options,
      (data) => {
        mainWindow?.webContents.send('minecraft-log', data);
        
        // Сообщаем что Minecraft запустился
        if (data.type === 'debug' && 
            String(data.message).includes('Launching game')) {
          mainWindow?.webContents.send('minecraft-launched');
        }
      },
      (code) => {
        mainWindow?.webContents.send('minecraft-closed', code);
      }
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

ipcMain.handle('get-minecraft-path', () => {
  return getMinecraftPath();
});

// ─── IPC — Диалог выбора Java ─────────────────────
ipcMain.handle('browse-java', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:       'Выберите java.exe',
    properties:  ['openFile'],
    filters: [
      { name: 'Java', extensions: ['exe', ''] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});