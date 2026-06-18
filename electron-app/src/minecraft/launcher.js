const { Client, Authenticator } = require('minecraft-launcher-core');
const path = require('path');
const os = require('os');
const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

const launcher = new Client();

function getMinecraftPath() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA, '.cosmolauncher');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', '.cosmolauncher');
  } else {
    return path.join(home, '.cosmolauncher');
  }
}

// ─── Установка Forge ──────────────────────────────
async function installForge(minecraftPath, version, loaderVersion, onLog) {
  const forgeVersion = `${version}-${loaderVersion}`;
  const installerUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`;
  const installerPath = path.join(minecraftPath, 'forge-installer.jar');
  const forgeDir = path.join(minecraftPath, 'versions', `forge-${forgeVersion}`);

  if (fs.existsSync(forgeDir)) {
    onLog && onLog({ type: 'info', message: 'Forge уже установлен' });
    return `forge-${forgeVersion}`;
  }

  onLog && onLog({ type: 'info', message: `Скачиваем Forge ${forgeVersion}...` });
  const response = await axios({
    method: 'GET',
    url: installerUrl,
    responseType: 'stream',
    timeout: 60000,
  });
  const writer = fs.createWriteStream(installerPath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  onLog && onLog({ type: 'info', message: 'Устанавливаем Forge...' });
  const java = process.platform === 'win32' ? 'java' : 'java';
  const cmd = `"${java}" -jar "${installerPath}" --installClient "${minecraftPath}"`;
  const { stdout, stderr } = await execPromise(cmd);
  if (stderr) onLog && onLog({ type: 'error', message: stderr });
  onLog && onLog({ type: 'info', message: stdout || 'Forge установлен' });

  fs.unlinkSync(installerPath);
  return `forge-${forgeVersion}`;
}

// ─── Установка Fabric ─────────────────────────────
async function installFabric(minecraftPath, version, loaderVersion, onLog) {
  const installerUrl = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar';
  const installerPath = path.join(minecraftPath, 'fabric-installer.jar');
  const fabricDir = path.join(minecraftPath, 'versions', `fabric-loader-${loaderVersion}-${version}`);

  if (fs.existsSync(fabricDir)) {
    onLog && onLog({ type: 'info', message: 'Fabric уже установлен' });
    return `fabric-loader-${loaderVersion}-${version}`;
  }

  onLog && onLog({ type: 'info', message: 'Скачиваем Fabric Installer...' });
  const response = await axios({
    method: 'GET',
    url: installerUrl,
    responseType: 'stream',
    timeout: 30000,
  });
  const writer = fs.createWriteStream(installerPath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  onLog && onLog({ type: 'info', message: 'Устанавливаем Fabric...' });
  const java = process.platform === 'win32' ? 'java' : 'java';
  const cmd = `"${java}" -jar "${installerPath}" client -dir "${minecraftPath}" -mcversion "${version}" -loader "${loaderVersion}"`;
  const { stdout, stderr } = await execPromise(cmd);
  if (stderr) onLog && onLog({ type: 'error', message: stderr });
  onLog && onLog({ type: 'info', message: stdout || 'Fabric установлен' });

  fs.unlinkSync(installerPath);
  return `fabric-loader-${loaderVersion}-${version}`;
}

// ─── Установка OptiFine (в папку mods) ────────────
async function installOptiFine(minecraftPath, version, optifineVersion, onLog) {
  const optifineFile = `OptiFine_${version}_${optifineVersion}.jar`;
  const modsDir = path.join(minecraftPath, 'mods');
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

  const targetPath = path.join(modsDir, optifineFile);
  if (fs.existsSync(targetPath)) {
    onLog && onLog({ type: 'info', message: 'OptiFine уже установлен в модах' });
    return targetPath;
  }

  onLog && onLog({ type: 'info', message: `Скачиваем OptiFine ${optifineVersion}...` });
  // Используем зеркало (можно заменить на более стабильное)
  const mirrorUrl = `https://optifine.net/downloads/optifine/${optifineFile}`;
  try {
    const response = await axios({
      method: 'GET',
      url: mirrorUrl,
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 30000,
    });
    const writer = fs.createWriteStream(targetPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    onLog && onLog({ type: 'info', message: 'OptiFine установлен в моды' });
    return targetPath;
  } catch (e) {
    onLog && onLog({ type: 'error', message: 'Не удалось скачать OptiFine: ' + e.message });
    throw new Error('OptiFine скачать не удалось, попробуйте установить вручную');
  }
}

// ─── Основная функция запуска ──────────────────────
async function launchMinecraft(options, onLog, onClose) {
  const { username, version, ram, fullscreen, javaPath, loader, loaderVersion, optifineVersion } = options;
  const rootPath = getMinecraftPath();

  if (!fs.existsSync(rootPath)) {
    fs.mkdirSync(rootPath, { recursive: true });
  }

  let actualVersion = version;
  let customArgs = options.customArgs || [];

  try {
    // Установка загрузчиков
    if (loader && loader !== 'vanilla') {
      if (loader === 'forge' || loader === 'forge+optifine') {
        const forgeVersion = await installForge(rootPath, version, loaderVersion || 'latest', onLog);
        actualVersion = forgeVersion;
      } else if (loader === 'fabric' || loader === 'fabric+optifine') {
        const fabricVersion = await installFabric(rootPath, version, loaderVersion || 'latest', onLog);
        actualVersion = fabricVersion;
      }

      // OptiFine
      if (loader === 'forge+optifine' || loader === 'fabric+optifine') {
        if (loader === 'fabric+optifine') {
          // Скачиваем OptiFabric как мод
          const optifabricUrl = 'https://maven.terraformersmc.com/releases/net/terraformersmc/optifabric/1.13.24/optifabric-1.13.24.jar';
          const modsDir = path.join(rootPath, 'mods');
          if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
          const optifabricPath = path.join(modsDir, 'optifabric.jar');
          if (!fs.existsSync(optifabricPath)) {
            onLog && onLog({ type: 'info', message: 'Скачиваем OptiFabric...' });
            const response = await axios({
              method: 'GET',
              url: optifabricUrl,
              responseType: 'stream',
              timeout: 15000,
            });
            const writer = fs.createWriteStream(optifabricPath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
            });
          }
        }
        if (optifineVersion) {
          await installOptiFine(rootPath, version, optifineVersion, onLog);
        }
      }
    }
  } catch (e) {
    onLog && onLog({ type: 'error', message: 'Ошибка установки загрузчика: ' + e.message });
    throw e;
  }

  // Авторизация
  const auth = Authenticator.getAuth(username);

  const launchOptions = {
    authorization: auth,
    root: rootPath,
    version: {
      number: actualVersion,
      type: 'release'
    },
    memory: {
      max: `${ram}M`,
      min: `512M`
    },
    window: {
      fullscreen: fullscreen || false
    },
    javaPath: javaPath || 'java',
    customArgs: [
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1'
    ]
  };

  if (customArgs.length) {
    launchOptions.customArgs = launchOptions.customArgs.concat(customArgs);
  }

  launcher.on('debug', (e) => onLog({ type: 'debug', message: e }));
  launcher.on('data', (e) => onLog({ type: 'data', message: e }));
  launcher.on('progress', (e) => onLog({ type: 'progress', data: e }));
  launcher.on('close', (code) => onClose(code));

  await launcher.launch(launchOptions);
}

module.exports = { launchMinecraft, getMinecraftPath };