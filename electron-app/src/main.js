const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { launchMinecraft } = require('./minecraft/launcher');

const store = new Store();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    frame: false,          // Убираем стандартный фрейм
    transparent: false,
    backgroundColor: '#0d0a1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Открывать DevTools только в dev режиме
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC Handlers ───────────────────────────────────────────

// Управление окном
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => app.quit());

// Сохранение данных
ipcMain.handle('store-get', (event, key) => store.get(key));
ipcMain.handle('store-set', (event, key, value) => store.set(key, value));
ipcMain.handle('store-delete', (event, key) => store.delete(key));

// Запуск Minecraft
ipcMain.handle('launch-minecraft', async (event, options) => {
  try {
    await launchMinecraft(options, (data) => {
      mainWindow.webContents.send('minecraft-log', data);
    }, (code) => {
      mainWindow.webContents.send('minecraft-closed', code);
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Открыть папку .minecraft
ipcMain.on('open-minecraft-folder', () => {
  const minecraftPath = require('./minecraft/launcher').getMinecraftPath();
  shell.openPath(minecraftPath);
});