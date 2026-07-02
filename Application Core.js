const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const patcher = require('./patcher');

const userDataDir = path.join(__dirname, 'user-data');
const userSettingsPath = path.join(userDataDir, 'settings.json');
const hashCachePath = path.join(userDataDir, 'launcher.cache');

let mainWindow;
let launcherConfig = {
  webHost: 'outerrim.gg',            // portal / manifest / files / cfg (Cloudflare 443)
  gameHost: 'play.outerrim.gg',      // game login server (direct-to-origin, TCP)
  loginPort: 44453,
  patchNotesUrl: 'https://outerrim.gg/portal/patch-notes',
  roadmapUrl: 'https://outerrim.gg/portal/roadmap',
  eventsUrl: 'https://outerrim.gg/portal/api/events',
  authUrl: 'https://outerrim.gg/portal/api/login',
  portalStatusUrl: 'https://outerrim.gg/portal/',
  swgInstallPath: '',
  allowMultipleInstances: false,
  // When true, the client patch/update pipeline is disabled: no manifest download,
  // no writes into the SWG dir — the launcher relies on whatever the existing
  // launcher already installed. Flip to false to re-enable patching.
  bypassUpdate: true,
  servers: [{ name: 'Live - The Outer Rim', address: 'play.outerrim.gg' }],
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function extractPatchNotes(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : html;
  const text = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 800).trim();
}

function extractRoadmap(html) {
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  const roadmapMatch = cleanHtml.match(/<(?:div|section|article)[^>]*(?:class|id)=["'][^"']*(?:roadmap|map|road-map)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|article)>/i);
  if (roadmapMatch) {
    const content = roadmapMatch[1].trim();
    return `<div class="roadmap-item">${content}</div>`;
  }

  const headingMatch = cleanHtml.match(/<h[12-6][^>]*>Road\s*Map[\s\S]*?<\/h[12-6]>/i);
  if (headingMatch) {
    return `<div class="roadmap-item">${headingMatch[0]}</div>`;
  }

  const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : cleanHtml;
  const text = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return `<div class="roadmap-item"><p>${esc(text.slice(0, 800).trim())}...</p></div>`;
}

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    launcherConfig = { ...launcherConfig, ...parsed };
  } catch (error) {
    console.warn('Could not read config.json, using defaults:', error.message);
  }
}

function loadUserSettings() {
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    if (fs.existsSync(userSettingsPath)) {
      const settings = JSON.parse(fs.readFileSync(userSettingsPath, 'utf8'));
      launcherConfig = { ...launcherConfig, ...settings };
    }
  } catch (error) {
    console.warn('Could not read settings.json:', error.message);
  }
}

function saveUserSettings() {
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(userSettingsPath, JSON.stringify({
      swgInstallPath: launcherConfig.swgInstallPath,
      allowMultipleInstances: launcherConfig.allowMultipleInstances,
    }, null, 2));
  } catch (error) {
    console.warn('Could not save settings.json:', error.message);
  }
}

function loadHashCache() {
  try { return JSON.parse(fs.readFileSync(hashCachePath, 'utf8')); }
  catch (_) { return {}; }
}

function saveHashCache(cache) {
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(hashCachePath, JSON.stringify(cache));
  } catch (_) {}
}

function isGameInstalled(installPath = launcherConfig.swgInstallPath) {
  const candidates = [];
  const normalizedPath = installPath ? path.normalize(installPath) : '';

  if (normalizedPath) {
    const isExe = normalizedPath.toLowerCase().endsWith('.exe');
    // Accept either the SWGEmu.exe wrapper or the legacy SwgClient_r.exe.
    if (isExe) {
      candidates.push(normalizedPath);
    } else {
      candidates.push(path.join(normalizedPath, 'SWGEmu.exe'));
      candidates.push(path.join(normalizedPath, 'SwgClient_r.exe'));
    }
  }

  const commonPaths = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Star Wars Galaxies', 'SwgClient_r.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Star Wars Galaxies', 'SwgClient_r.exe'),
    path.join(process.env['USERPROFILE'] || 'C:\\Users\\Public', 'Documents', 'Star Wars Galaxies', 'SwgClient_r.exe'),
  ];

  for (const candidate of candidates.concat(commonPaths)) {
    if (fs.existsSync(candidate)) {
      // Report the containing folder so the rest of the app has the SWG dir.
      const dir = candidate.toLowerCase().endsWith('.exe') ? path.dirname(candidate) : candidate;
      return { installed: true, path: dir };
    }
  }

  return { installed: false, paths: candidates.length ? candidates : commonPaths };
}

function tcpPing(host, port, timeout = 4000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; try { sock.destroy(); } catch (_) {} resolve(ok); };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

function createWindow() {
  app.setPath('userData', userDataDir);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#0b0d17',
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

loadConfig();
loadUserSettings();
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==================== Patch / Update ====================

ipcMain.handle('run-update', async () => {
  if (launcherConfig.bypassUpdate) {
    return { success: true, updated: 0, message: 'Update pipeline is disabled. Using your existing client files.' };
  }
  const swg = launcherConfig.swgInstallPath;
  if (!swg || !fs.existsSync(swg)) {
    return { success: false, error: 'Select your Star Wars Galaxies install folder first.' };
  }
  const webHost = launcherConfig.webHost || patcher.DEFAULTS.webHost;
  const send = (payload) => { try { mainWindow?.webContents.send('update-progress', payload); } catch (_) {} };

  try {
    send({ phase: 'manifest', message: 'Fetching file manifest…', percent: 0 });
    const manifest = await patcher.fetchManifest(webHost);

    send({ phase: 'verify', message: 'Verifying local files…', percent: 0 });
    const cache = loadHashCache();
    const plan = await patcher.planUpdate(manifest.files, swg, cache, (doneN, total) => {
      send({ phase: 'verify', message: `Verifying ${doneN}/${total}…`, percent: total ? Math.round((doneN / total) * 100) : 0 });
    });
    saveHashCache({ ...cache, ...plan.freshCache });

    const needed = plan.needed;
    const totalBytes = needed.reduce((a, f) => a + (Number(f.size) || 0), 0);
    let doneBytes = 0;

    for (let i = 0; i < needed.length; i++) {
      const f = needed[i];
      const label = `Downloading ${f.name} (${i + 1}/${needed.length})…`;
      send({ phase: 'download', message: label, file: f.name, index: i + 1, count: needed.length, percent: totalBytes ? Math.round((doneBytes / totalBytes) * 100) : 0 });
      await patcher.downloadFile(webHost, f, swg, (received) => {
        const pct = totalBytes ? Math.round(((doneBytes + received) / totalBytes) * 100) : 0;
        send({ phase: 'download', message: label, file: f.name, index: i + 1, count: needed.length, percent: pct });
      });
      doneBytes += Number(f.size) || 0;
    }

    // Record freshly-downloaded files into the hash cache (skip re-hash next launch).
    if (needed.length) {
      const c2 = loadHashCache();
      for (const f of needed) {
        try { const st = fs.statSync(path.join(swg, f.name)); c2[f.name] = { size: f.size, mtime: st.mtimeMs, md5: f.md5 }; } catch (_) {}
      }
      saveHashCache(c2);
    }

    send({ phase: 'cfg', message: 'Updating game configuration…', percent: 100 });
    await patcher.downloadLiveCfg(webHost, swg);

    return {
      success: true,
      updated: needed.length,
      message: needed.length ? `Updated ${needed.length} file(s). Ready to launch.` : 'All files up to date. Ready to launch.',
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== Launch ====================

ipcMain.handle('launch-game', async (event, serverAddress) => {
  const swg = launcherConfig.swgInstallPath;
  if (!swg || !fs.existsSync(swg)) {
    return { success: false, error: 'Select your Star Wars Galaxies install folder first.' };
  }
  const gameHost = serverAddress || launcherConfig.gameHost || patcher.DEFAULTS.gameHost;
  const loginPort = launcherConfig.loginPort || patcher.DEFAULTS.loginPort;

  // In bypass mode we do NOT write any cfg files — the existing launcher owns them.
  // The client still connects via the -s ClientGame args below, so launch works
  // without touching anything on disk.
  if (!launcherConfig.bypassUpdate) {
    try {
      // Client reads connection + TRE order from these on every launch.
      patcher.writeLoginCfg(swg, gameHost, loginPort);
      patcher.writeRootCfg(swg);
    } catch (error) {
      return {
        success: false,
        error: `Cannot write client config to ${swg}. If your SWG folder is in a protected location ` +
               `(Program Files), move it somewhere like C:\\SWGEmu or run the launcher as Administrator.\n\n${error.message}`,
      };
    }
  }

  const exe = patcher.resolveClientExe(swg);
  if (!exe) {
    return { success: false, error: `SWGEmu.exe / SwgClient_r.exe not found in:\n${swg}` };
  }

  try {
    const args = patcher.buildLaunchArgs(gameHost, loginPort, !!launcherConfig.allowMultipleInstances);
    const child = spawn(exe, args, { cwd: swg, detached: true, stdio: 'ignore' });
    child.unref();
    console.log(`Launched ${exe} against ${gameHost}:${loginPort}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to launch game client:', error);
    return { success: false, error: error.message };
  }
});

// ==================== Config / Info panels ====================

ipcMain.handle('get-launcher-config', () => launcherConfig);

ipcMain.handle('fetch-patch-notes', async () => {
  try {
    const response = await fetch(launcherConfig.patchNotesUrl);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const text = await response.text();
    return { success: true, notes: extractPatchNotes(text) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fetch-roadmap', async () => {
  if (!launcherConfig.roadmapUrl) return { success: false, error: 'Roadmap URL is not configured.' };
  try {
    const response = await fetch(launcherConfig.roadmapUrl);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const body = await response.text();
    return { success: true, html: extractRoadmap(body) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fetch-events', async () => {
  if (!launcherConfig.eventsUrl) return { success: false, error: 'Events endpoint is not configured.' };
  try {
    const response = await fetch(launcherConfig.eventsUrl);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { success: true, html: '<div class="event-item">No events scheduled at this time.</div>' };
    }
    const html = data.slice(0, 4).map((ev) => {
      const title = ev.title || ev.name || 'Event';
      const desc = ev.description || ev.body || ev.summary || '';
      const when = ev.starts_at || ev.start || ev.date || ev.when || '';
      return `<div class="event-item"><strong>${esc(title)}</strong>` +
        (when ? `<span class="event-when">${esc(String(when))}</span>` : '') +
        (desc ? `<p>${esc(String(desc))}</p>` : '') + '</div>';
    }).join('');
    return { success: true, html };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fetch-portal-status', async () => {
  if (!launcherConfig.portalStatusUrl) return { success: false, error: 'Portal status URL is not configured.' };
  try {
    const response = await fetch(launcherConfig.portalStatusUrl);
    if (response.ok) return { success: true, status: 'online', message: 'Portal: online' };
    return { success: true, status: 'offline', message: `Portal: offline (${response.status})` };
  } catch (error) {
    return { success: true, status: 'offline', message: `Portal: offline (${error.message})` };
  }
});

// ==================== Login gate ====================

ipcMain.handle('validate-login', async (event, credentials) => {
  const username = credentials?.username?.trim();
  const password = credentials?.password;
  if (!username || !password) return { success: false, error: 'Username and password are required.' };

  const authUrl = launcherConfig.authUrl || `https://${launcherConfig.webHost}/portal/api/login`;
  try {
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    let body = {};
    try { body = await response.json(); } catch (_) {}
    // The portal returns HTTP 200 with {ok:false,error} on bad creds — must check ok.
    if (response.ok && body && body.ok === true) return { success: true, token: body.token };
    return { success: false, error: (body && body.error) || `Login failed (${response.status})` };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== Install location ====================

ipcMain.handle('check-game-installed', async () => {
  try { return isGameInstalled(); }
  catch (error) { return { installed: false, error: error.message }; }
});

ipcMain.handle('select-game-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Star Wars Galaxies folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };

    const installed = isGameInstalled(result.filePaths[0]);
    // Persist whatever the user picked, even if the client exe isn't there yet
    // (a fresh install can still be patched into that folder).
    launcherConfig.swgInstallPath = installed.installed ? installed.path : result.filePaths[0];
    saveUserSettings();
    return installed.installed ? installed : { installed: false, path: result.filePaths[0] };
  } catch (error) {
    return { installed: false, error: error.message };
  }
});

ipcMain.handle('check-server-status', async (event, address) => {
  if (!address) return { online: false, error: 'Missing server address' };
  const port = launcherConfig.loginPort || patcher.DEFAULTS.loginPort;
  const online = await tcpPing(address, port);
  return { online };
});

// ==================== Window controls ====================

ipcMain.on('minimize-window', () => mainWindow?.minimize());
ipcMain.on('close-window', () => mainWindow?.close());
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url).catch((error) => console.error('Failed to open external URL:', error));
});
