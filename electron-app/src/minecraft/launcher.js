const { Client, Authenticator } = require('minecraft-launcher-core');
const path = require('path');
const os = require('os');
const fs = require('fs');
const axios = require('axios');
const { spawn } = require('child_process');

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

// ─── Утилита для запуска Java с аргументами ──────
function runJava(javaPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const java = javaPath || 'java';
    const proc = spawn(java, args, {
      stdio: 'pipe',
      shell: false,
      ...options,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`Java process exited with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
    proc.on('error', reject);
  });
}

// ─── Установка Forge ──────────────────────────────
async function installForge(minecraftPath, version, loaderVersion, javaPath, onLog) {
  // 1. Проверяем наличие ванильного клиента
  onLog && onLog({ type: 'info', message: `Проверяем наличие клиента ${version}...` });
  const versionDir = path.join(minecraftPath, 'versions', version);
  const versionJson = path.join(versionDir, `${version}.json`);
  const versionJar = path.join(versionDir, `${version}.jar`);

  if (!fs.existsSync(versionJson) || !fs.existsSync(versionJar)) {
    onLog && onLog({ type: 'info', message: `Клиент ${version} не найден, загружаем...` });
    try {
      const tempLauncher = new Client();
      await tempLauncher.launch({
        authorization: Authenticator.getAuth('temp'),
        root: minecraftPath,
        version: { number: version, type: 'release' },
        memory: { max: '512M', min: '256M' },
        skipLaunch: true,
        customArgs: ['-Dfml.ignoreInvalidMinecraftCertificates=true']
      });
      onLog && onLog({ type: 'info', message: `Клиент ${version} загружен` });
    } catch (e) {
      onLog && onLog({ type: 'error', message: `Не удалось загрузить клиент: ${e.message}` });
      throw new Error(`Не удалось загрузить Minecraft ${version} перед установкой Forge`);
    }
  } else {
    onLog && onLog({ type: 'info', message: `Клиент ${version} уже есть` });
  }

  // Проверяем содержимое папки версии
  try {
    const files = fs.readdirSync(versionDir);
    onLog && onLog({ type: 'info', message: `Содержимое папки ${versionDir}: ${files.join(', ')}` });
  } catch(e) {
    onLog && onLog({ type: 'warn', message: `Не удалось прочитать папку версии: ${e.message}` });
  }

  // 2. Определяем версию Forge
  let selectedVersion = loaderVersion;
  if (!selectedVersion || selectedVersion === 'latest') {
    onLog && onLog({ type: 'info', message: `Определяем последнюю версию Forge для ${version}...` });
    let versions = [];
    let source = '';

    try {
      const url = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/index_${version}.json`;
      const response = await axios.get(url, { timeout: 5000 });
      const data = response.data;
      versions = data.number || [];
      source = 'официальный API';
      onLog && onLog({ type: 'info', message: `Получено ${versions.length} версий через ${source}` });
    } catch (e) {
      onLog && onLog({ type: 'warn', message: `Официальный API Forge недоступен: ${e.message}` });
      try {
        const url = `https://bmclapi2.bangbang93.com/forge/minecraft/${version}`;
        const response = await axios.get(url, { timeout: 5000 });
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
        try {
          const url = `https://files.minecraftforge.net/net/minecraftforge/forge/`;
          const response = await axios.get(url, { timeout: 10000 });
          const html = response.data;
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
          const fallback = {
            '1.20.4': ['47.2.0'], '1.20.1': ['47.2.0'],
            '1.19.4': ['45.2.0'], '1.18.2': ['40.2.10'],
            '1.17.1': ['37.1.1'], '1.16.5': ['36.2.34'],
            '1.12.2': ['14.23.5.2859'], '1.8.9': ['11.15.1.2318']
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

    selectedVersion = versions[0];
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
    onLog && onLog({ type: 'error', message: `Ошибка скачивания: ${e.message}` });
    throw new Error(`Не удалось скачать Forge: ${e.message}`);
  }

  onLog && onLog({ type: 'info', message: 'Устанавливаем Forge...' });

  const java = javaPath || 'java';
  const args = [
    '-Dfml.ignoreInvalidMinecraftCertificates=true',
    '-Dhttps.protocols=TLSv1.2',
    '-jar', installerPath,
    '--installClient', minecraftPath
  ];

  onLog && onLog({ type: 'debug', message: `Команда: ${java} ${args.join(' ')}` });

  try {
    const result = await runJava(java, args, { timeout: 180000 });
    onLog && onLog({ type: 'info', message: 'Forge Installer stdout: ' + (result.stdout || '(empty)') });
    if (result.stderr) {
      onLog && onLog({ type: 'error', message: 'Forge Installer stderr: ' + result.stderr });
      if (result.stderr.includes('ERROR') || result.stderr.includes('Exception')) {
        throw new Error(result.stderr);
      }
    }
  } catch (e) {
    onLog && onLog({ type: 'error', message: `Ошибка установки: ${e.message}` });
    if (e.stderr) onLog && onLog({ type: 'error', message: `Детали stderr: ${e.stderr}` });
    if (e.stdout) onLog && onLog({ type: 'info', message: `Вывод stdout: ${e.stdout}` });
    throw new Error(`Не удалось установить Forge: ${e.message}`);
  } finally {
    if (fs.existsSync(installerPath)) {
      fs.unlinkSync(installerPath);
    }
  }

  if (!fs.existsSync(forgeDir)) {
    throw new Error(`Forge не был установлен (папка ${forgeDir} не найдена)`);
  }

  return `forge-${forgeVersion}`;
}

// ─── Установка Fabric ─────────────────────────────
async function installFabric(minecraftPath, version, loaderVersion, javaPath, onLog) {
  const installerUrl = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar';
  const installerPath = path.join(minecraftPath, 'fabric-installer.jar');
  const fabricDir = path.join(minecraftPath, 'versions', `fabric-loader-${loaderVersion}-${version}`);

  if (fs.existsSync(fabricDir)) {
    onLog && onLog({ type: 'info', message: 'Fabric уже установлен' });
    return `fabric-loader-${loaderVersion}-${version}`;
  }

  onLog && onLog({ type: 'info', message: 'Скачиваем Fabric Installer...' });
  try {
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
  } catch (e) {
    onLog && onLog({ type: 'error', message: `Ошибка скачивания Fabric: ${e.message}` });
    throw new Error(`Не удалось скачать Fabric: ${e.message}`);
  }

  onLog && onLog({ type: 'info', message: 'Устанавливаем Fabric...' });
  const java = javaPath || 'java';
  const args = [
    '-jar', installerPath,
    'client',
    '-dir', minecraftPath,
    '-mcversion', version,
    '-loader', loaderVersion
  ];

  onLog && onLog({ type: 'debug', message: `Команда: ${java} ${args.join(' ')}` });

  try {
    const result = await runJava(java, args, { timeout: 120000 });
    onLog && onLog({ type: 'info', message: result.stdout || 'Fabric установлен' });
    if (result.stderr) {
      onLog && onLog({ type: 'error', message: result.stderr });
      if (result.stderr.includes('ERROR') || result.stderr.includes('Exception')) {
        throw new Error(result.stderr);
      }
    }
  } catch (e) {
    onLog && onLog({ type: 'error', message: `Ошибка установки: ${e.message}` });
    if (e.stderr) onLog && onLog({ type: 'error', message: `Детали: ${e.stderr}` });
    if (e.stdout) onLog && onLog({ type: 'info', message: `Вывод: ${e.stdout}` });
    throw new Error(`Не удалось установить Fabric: ${e.message}`);
  } finally {
    if (fs.existsSync(installerPath)) {
      fs.unlinkSync(installerPath);
    }
  }

  return `fabric-loader-${loaderVersion}-${version}`;
}

// ─── Установка OptiFine ──────────────────────────
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
    onLog && onLog({ type: 'error', message: `Не удалось скачать OptiFine: ${e.message}` });
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
    if (loader && loader !== 'vanilla') {
      if (loader === 'forge' || loader === 'forge+optifine') {
        const forgeVersion = await installForge(rootPath, version, loaderVersion || 'latest', javaPath, onLog);
        actualVersion = forgeVersion;
      } else if (loader === 'fabric' || loader === 'fabric+optifine') {
        const fabricVersion = await installFabric(rootPath, version, loaderVersion || 'latest', javaPath, onLog);
        actualVersion = fabricVersion;
      }

      if (loader === 'forge+optifine' || loader === 'fabric+optifine') {
        if (loader === 'fabric+optifine') {
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