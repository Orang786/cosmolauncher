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
    // Используем execFile, чтобы избежать интерпретации shell
    const { execFile } = require('child_process');
    const proc = execFile(java, args, {
      timeout: options.timeout || 120000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ─── Установка Forge (упрощённая, без --noBanners) ──
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
        customArgs: []
      });
      onLog && onLog({ type: 'info', message: `Клиент ${version} загружен` });
    } catch (e) {
      onLog && onLog({ type: 'error', message: `Не удалось загрузить клиент: ${e.message}` });
      throw new Error(`Не удалось загрузить Minecraft ${version} перед установкой Forge`);
    }
  } else {
    onLog && onLog({ type: 'info', message: `Клиент ${version} уже есть` });
  }

  // 2. Определяем версию Forge (fallback для надёжности)
  let selectedVersion = loaderVersion;
  if (!selectedVersion || selectedVersion === 'latest') {
    onLog && onLog({ type: 'info', message: `Определяем последнюю версию Forge для ${version}...` });
    // Используем только fallback список, чтобы избежать проблем с API
    const fallback = {
      '1.20.4': ['47.2.0'],
      '1.20.1': ['47.2.0'],
      '1.19.4': ['45.2.0'],
      '1.18.2': ['40.2.10'],
      '1.17.1': ['37.1.1'],
      '1.16.5': ['36.2.34'],
      '1.15.2': ['31.2.0'],
      '1.14.4': ['28.2.0'],
      '1.12.2': ['14.23.5.2859'],
      '1.8.9': ['11.15.1.2318']
    };
    if (fallback[version]) {
      selectedVersion = fallback[version][0];
      onLog && onLog({ type: 'info', message: `Используем версию Forge: ${selectedVersion}` });
    } else {
      // Если нет в списке, пробуем получить через API (но если упадёт, всё равно кидаем ошибку)
      try {
        const url = `https://bmclapi2.bangbang93.com/forge/minecraft/${version}`;
        const response = await axios.get(url, { timeout: 5000 });
        const rawData = response.data;
        if (Array.isArray(rawData) && rawData.length > 0) {
          selectedVersion = rawData[0].version;
          onLog && onLog({ type: 'info', message: `Получена версия Forge через API: ${selectedVersion}` });
        } else {
          throw new Error('Не удалось получить версию');
        }
      } catch (e) {
        onLog && onLog({ type: 'error', message: `Не удалось определить версию Forge для ${version}` });
        throw new Error(`Нет известных версий Forge для ${version}`);
      }
    }
  }

  const forgeVersion = `${version}-${selectedVersion}`;
  const installerUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`;
  const installerPath = path.join(minecraftPath, 'forge-installer.jar');
  const forgeDir = path.join(minecraftPath, 'versions', `forge-${forgeVersion}`);

  if (fs.existsSync(forgeDir)) {
    onLog && onLog({ type: 'info', message: 'Forge уже установлен' });
    return `forge-${forgeVersion}`;
  }

  // 3. Скачиваем инсталлятор
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

  // 4. Запускаем установку (без лишних опций)
  onLog && onLog({ type: 'info', message: 'Устанавливаем Forge...' });
  const java = javaPath || 'java';
  const args = [
    '-jar', installerPath,
    '--installClient', minecraftPath
  ];

  onLog && onLog({ type: 'debug', message: `Команда: ${java} ${args.join(' ')}` });

  try {
    const result = await runJava(java, args, { timeout: 180000 });
    onLog && onLog({ type: 'info', message: result.stdout || 'Forge установлен' });
    if (result.stderr) {
      onLog && onLog({ type: 'error', message: result.stderr });
      // Если stderr содержит ошибку, но код возврата 0, то игнорируем
    }
  } catch (e) {
    onLog && onLog({ type: 'error', message: `Ошибка установки: ${e.message}` });
    if (e.stdout) onLog && onLog({ type: 'info', message: `Вывод: ${e.stdout}` });
    if (e.stderr) onLog && onLog({ type: 'error', message: `Детали: ${e.stderr}` });
    throw new Error(`Не удалось установить Forge: ${e.message}`);
  } finally {
    if (fs.existsSync(installerPath)) {
      fs.unlinkSync(installerPath);
    }
  }

  // 5. Проверка
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
    if (result.stderr) onLog && onLog({ type: 'error', message: result.stderr });
  } catch (e) {
    onLog && onLog({ type: 'error', message: `Ошибка выполнения: ${e.message}` });
    onLog && onLog({ type: 'error', message: e.stderr || '' });
    throw new Error(`Не удалось запустить установщик Fabric: ${e.message}`);
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