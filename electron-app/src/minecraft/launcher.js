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
async function getLatestForgeVersion(mcVersion) {
  try {
    // Используем общий JSON со всеми версиями
    const url = 'https://files.minecraftforge.net/net/minecraftforge/forge/json';
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;
    // data — массив объектов { mcversion, version, ... }
    const versions = data
      .filter(item => item.mcversion === mcVersion)
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    if (versions.length === 0) return null;
    return versions[0].version;
  } catch (e) {
    console.error('Ошибка получения версий Forge:', e);
    return null;
  }
}

async function installForge(minecraftPath, version, loaderVersion, onLog) {
  // Если loaderVersion не указан или 'latest', пытаемся получить последнюю версию
  let selectedVersion = loaderVersion;
  if (!selectedVersion || selectedVersion === 'latest') {
    onLog && onLog({ type: 'info', message: `Определяем последнюю версию Forge для ${version}...` });
    let versions = [];
    let source = '';

    // Попытка 1: официальный API Forge (иногда не работает)
    try {
      const url = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/index_${version}.json`;
      const response = await axios.get(url, { timeout: 5000 });
      const data = response.data;
      versions = data.number || [];
      source = 'официальный API';
      onLog && onLog({ type: 'info', message: `Получено ${versions.length} версий через ${source}` });
    } catch (e) {
      onLog && onLog({ type: 'warn', message: `Официальный API Forge недоступен: ${e.message}` });
      
      // Попытка 2: BMCLAPI (зеркало)
      try {
        const url = `https://bmclapi2.bangbang93.com/forge/minecraft/${version}`;
        const response = await axios.get(url, { timeout: 5000 });
        // BMCLAPI возвращает массив объектов, у каждого есть поле 'version'
        const rawData = response.data;
        if (Array.isArray(rawData)) {
          versions = rawData.map(item => item.version).filter(v => v);
          source = 'BMCLAPI';
          onLog && onLog({ type: 'info', message: `Получено ${versions.length} версий через ${source}` });
        } else {
          throw new Error('Неверный формат данных от BMCLAPI');
        }
      } catch (e2) {
        onLog && onLog({ type: 'warn', message: `BMCLAPI недоступен: ${e2.message}` });
        
        // Попытка 3: парсинг официальной страницы Forge
        try {
          const url = `https://files.minecraftforge.net/net/minecraftforge/forge/`;
          const response = await axios.get(url, { timeout: 10000 });
          const html = response.data;
          // Ищем таблицу с версиями для конкретной версии MC
          // Шаблон: <a href="index_${version}.html"> или просто версии в таблице
          // Упрощённо: ищем строки вида "forge-${version}-XXX-installer.jar"
          const regex = new RegExp(`forge-${version}-([0-9.]+)-installer\\.jar`, 'g');
          const matches = [...html.matchAll(regex)];
          if (matches.length > 0) {
            versions = matches.map(m => m[1]);
            source = 'парсинг страницы Forge';
            onLog && onLog({ type: 'info', message: `Получено ${versions.length} версий через ${source}` });
          } else {
            throw new Error(`Не удалось найти версии Forge для ${version} на странице`);
          }
        } catch (e3) {
          onLog && onLog({ type: 'warn', message: `Парсинг страницы Forge не удался: ${e3.message}` });
          
          // Попытка 4: встроенный fallback-список для популярных версий
          const fallback = {
            '1.20.4': ['47.2.0', '47.1.3'],
            '1.20.2': ['47.1.0'],
            '1.20.1': ['47.2.0', '47.1.3'],
            '1.19.4': ['45.2.0'],
            '1.18.2': ['40.2.10', '40.2.0'],
            '1.17.1': ['37.1.1'],
            '1.16.5': ['36.2.34', '36.2.0'],
            '1.15.2': ['31.2.0'],
            '1.14.4': ['28.2.0'],
            '1.12.2': ['14.23.5.2859', '14.23.5.2847'],
            '1.8.9': ['11.15.1.2318'],
          };
          if (fallback[version]) {
            versions = fallback[version];
            source = 'встроенный список';
            onLog && onLog({ type: 'info', message: `Используем ${source}: ${versions.join(', ')}` });
          } else {
            throw new Error(`Нет известных версий Forge для ${version}`);
          }
        }
      }
    }

    if (!versions || versions.length === 0) {
      throw new Error(`Не найдено ни одной версии Forge для ${version}`);
    }

    // Сортируем версии по убыванию (чтобы последняя была первой)
    versions.sort((a, b) => {
      const partsA = a.split('.').map(Number);
      const partsB = b.split('.').map(Number);
      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const valA = partsA[i] || 0;
        const valB = partsB[i] || 0;
        if (valA !== valB) return valB - valA;
      }
      return 0;
    });

    selectedVersion = versions[0]; // берём первую (самую свежую)
    onLog && onLog({ type: 'info', message: `Выбрана версия Forge: ${selectedVersion}` });
  }

  const forgeVersion = `${version}-${selectedVersion}`;
  const installerUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`;
  const installerPath = path.join(minecraftPath, 'forge-installer.jar');
  const forgeDir = path.join(minecraftPath, 'versions', `forge-${forgeVersion}`);

  if (fs.existsSync(forgeDir)) {
    onLog && onLog({ type: 'info', message: 'Forge уже установлен' });
    return `forge-${forgeVersion}`;
  }

  onLog && onLog({ type: 'info', message: `Скачиваем Forge ${forgeVersion}...` });
  try {
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
  } catch (e) {
    onLog && onLog({ type: 'error', message: `Ошибка скачивания Forge: ${e.message}` });
    throw new Error(`Не удалось скачать Forge: ${e.message}`);
  }

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
  let actualLoaderVersion = loaderVersion;
  if (!loaderVersion || loaderVersion === 'latest') {
    try {
      const response = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${version}`);
      const data = response.data;
      if (data.length === 0) throw new Error('Нет доступных версий Fabric для ' + version);
      actualLoaderVersion = data[0].loader.version; // первая (самая свежая)
      onLog && onLog({ type: 'info', message: `Выбрана версия Fabric: ${actualLoaderVersion}` });
    } catch (e) {
      onLog && onLog({ type: 'error', message: 'Не удалось получить список версий Fabric: ' + e.message });
      throw new Error('Не удалось определить последнюю версию Fabric для ' + version);
    }
  }

  const installerUrl = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar';
  const installerPath = path.join(minecraftPath, 'fabric-installer.jar');
  const fabricDir = path.join(minecraftPath, 'versions', `fabric-loader-${actualLoaderVersion}-${version}`);

  if (fs.existsSync(fabricDir)) {
    onLog && onLog({ type: 'info', message: 'Fabric уже установлен' });
    return `fabric-loader-${actualLoaderVersion}-${version}`;
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
  const cmd = `"${java}" -jar "${installerPath}" client -dir "${minecraftPath}" -mcversion "${version}" -loader "${actualLoaderVersion}"`;
  const { stdout, stderr } = await execPromise(cmd);
  if (stderr) onLog && onLog({ type: 'error', message: stderr });
  onLog && onLog({ type: 'info', message: stdout || 'Fabric установлен' });

  fs.unlinkSync(installerPath);
  return `fabric-loader-${actualLoaderVersion}-${version}`;
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
        const forgeVersion = await installForge(rootPath, version, loaderVersion, onLog);
        actualVersion = forgeVersion;
      } else if (loader === 'fabric' || loader === 'fabric+optifine') {
        const fabricVersion = await installFabric(rootPath, version, loaderVersion, onLog);
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