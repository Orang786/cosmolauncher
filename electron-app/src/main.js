const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// ─── Попытка подключить дополнительные модули ────
let AdmZip, tar, glob;
try {
  AdmZip = require('adm-zip');
} catch (e) { AdmZip = null; }
try {
  tar = require('tar');
} catch (e) { tar = null; }
try {
  glob = require('glob');
} catch (e) { glob = null; }

let autoUpdater;
let log;

// Подключаем updater только в продакшне
try {
  autoUpdater = require('electron-updater').autoUpdater;
  log = require('electron-log');

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

// ─── IPC — Java (ручной выбор) ──────────────────
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

// ─── IPC — Загрузчики ─────────────────────────────
ipcMain.handle('get-forge-versions', async (_, mcVersion) => {
  try {
    // Используем API Forge для получения списка версий
    const url = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/index_${mcVersion}.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Не удалось получить версии Forge');
    const data = await response.json();
    const versions = data.number || [];
    return versions.map(v => ({ version: v, url: `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${mcVersion}-${v}/forge-${mcVersion}-${v}-installer.jar` }));
  } catch (e) {
    console.error('Ошибка получения версий Forge:', e);
    return [];
  }
});

ipcMain.handle('get-fabric-versions', async (_, mcVersion) => {
  try {
    // Используем Fabric Meta API
    const url = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Не удалось получить версии Fabric');
    const data = await response.json();
    return data.map(item => ({ version: item.loader.version }));
  } catch (e) {
    console.error('Ошибка получения версий Fabric:', e);
    return [];
  }
});

// ═══════════════════════════════════════════════════
// НОВЫЙ JAVA МЕНЕДЖЕР
// ═══════════════════════════════════════════════════

function findJavaVersions() {
  return new Promise((resolve) => {
    let cmd;
    if (process.platform === 'win32') {
      cmd = 'where java';
    } else if (process.platform === 'darwin') {
      cmd = '/usr/libexec/java_home -V 2>&1 || which java';
    } else {
      cmd = 'which java || update-alternatives --list java 2>/dev/null || echo ""';
    }

    exec(cmd, (error, stdout, stderr) => {
      let paths = [];
      if (process.platform === 'darwin') {
        const lines = stdout.split('\n');
        for (const line of lines) {
          const match = line.match(/^[ \t]*(\d+\.\d+\.\d+[^,]*),[ \t]+(.*)$/);
          if (match) {
            const version = match[1];
            let jpath = match[2].trim();
            if (jpath.endsWith('/')) jpath = jpath.slice(0, -1);
            const javaBin = path.join(jpath, 'bin', 'java');
            if (fs.existsSync(javaBin)) {
              paths.push({ path: javaBin, version });
            }
          }
        }
        if (paths.length === 0) {
          exec('which java', (err, out) => {
            const p = out.trim();
            if (p) {
              getJavaVersion(p, (ver) => {
                resolve([{ path: p, version: ver || 'unknown' }]);
              });
            } else resolve([]);
          });
          return;
        }
      } else {
        const raw = stdout || stderr;
        paths = raw.split('\n')
          .filter(line => line.trim() && fs.existsSync(line.trim()))
          .map(line => line.trim());

        if (paths.length === 0 && glob) {
          const defaultPaths = [];
          if (process.platform === 'win32') {
            const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
            defaultPaths.push(
              path.join(programFiles, 'Java', 'jre1.8.0_*', 'bin', 'java.exe'),
              path.join(programFiles, 'Java', 'jdk-*', 'bin', 'java.exe'),
              path.join(programFilesX86, 'Java', 'jre1.8.0_*', 'bin', 'java.exe'),
              path.join(programFilesX86, 'Java', 'jdk-*', 'bin', 'java.exe')
            );
          } else {
            defaultPaths.push('/usr/bin/java', '/usr/local/bin/java');
          }
          for (const p of defaultPaths) {
            const globbed = glob.sync(p);
            for (const g of globbed) {
              if (fs.existsSync(g)) paths.push(g);
            }
          }
        }
      }

      if (paths.length === 0) {
        resolve([]);
        return;
      }

      const results = [];
      let pending = paths.length;
      paths.forEach(javaPath => {
        getJavaVersion(javaPath, (version) => {
          results.push({ path: javaPath, version: version || 'unknown' });
          if (--pending === 0) resolve(results);
        });
      });
    });
  });
}

function getJavaVersion(javaPath, callback) {
  exec(`"${javaPath}" -version 2>&1`, (err, stdout, stderr) => {
    const output = stderr || stdout;
    const match = output.match(/version "(\d+\.\d+\.\d+[^"]*?)"/) ||
                  output.match(/version "(\d+)"/);
    if (match) {
      callback(match[1]);
    } else {
      callback(null);
    }
  });
}

async function downloadJava(version, destDir) {
  if (!AdmZip || !tar) {
    throw new Error('Для скачивания Java необходимы библиотеки adm-zip и tar. Установите их: npm install adm-zip tar');
  }

  const platform = process.platform === 'win32' ? 'windows' : 
                   process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'x64' ? 'x64' : 'x86';
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
  const url = `https://api.adoptium.net/v3/binary/latest/${version}/ga/${platform}/${arch}/jdk/hotspot/normal/eclipse?project=jdk`;
  const filename = `java-${version}.${ext}`;
  const destFile = path.join(destDir, filename);
  const extractDir = path.join(destDir, `java-${version}`);

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  // Скачиваем
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destFile);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Ошибка загрузки: ${response.statusCode}`));
        return;
      }
      streamPipeline(response, file)
        .then(resolve)
        .catch(reject);
    }).on('error', reject);
  });

  // Распаковываем
  if (process.platform === 'win32') {
    const zip = new AdmZip(destFile);
    zip.extractAllTo(extractDir, true);
  } else {
    await tar.extract({
      file: destFile,
      cwd: destDir,
      strip: 1,
    });
  }

  const binPath = process.platform === 'win32' 
    ? path.join(extractDir, 'bin', 'java.exe')
    : path.join(extractDir, 'bin', 'java');
  return binPath;
}

// IPC — Java
ipcMain.handle('find-java', async () => {
  try {
    return await findJavaVersions();
  } catch (e) {
    console.error('Ошибка поиска Java:', e);
    return [];
  }
});

ipcMain.handle('download-java', async (_, version, destDir) => {
  try {
    const javaPath = await downloadJava(version, destDir);
    return { success: true, path: javaPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ═══════════════════════════════════════════════════
// НОВЫЙ МЕНЕДЖЕР МОДОВ
// ═══════════════════════════════════════════════════

ipcMain.handle('mods-list-installed', async () => {
  const mcPath = getMinecraftPath();
  const modsDir = path.join(mcPath, 'mods');
  if (!fs.existsSync(modsDir)) return [];
  const files = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
  return files.map(f => ({
    name: f,
    path: path.join(modsDir, f),
    size: fs.statSync(path.join(modsDir, f)).size
  }));
});

ipcMain.handle('mods-install', async (_, modId, version, downloadUrl) => {
  const mcPath = getMinecraftPath();
  const modsDir = path.join(mcPath, 'mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

  const filename = `${modId}-${version}.jar`;
  const dest = path.join(modsDir, filename);
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Ошибка загрузки: ${response.status}`);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
  return { success: true, path: dest };
});

ipcMain.handle('mods-uninstall', async (_, filename) => {
  const mcPath = getMinecraftPath();
  const modPath = path.join(mcPath, 'mods', filename);
  if (fs.existsSync(modPath)) {
    fs.unlinkSync(modPath);
    return { success: true };
  }
  return { success: false, error: 'Файл не найден' };
});