const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const userDataDir = path.join(__dirname, 'user-data');
const userSettingsPath = path.join(userDataDir, 'settings.json');

let mainWindow;
let currentDownloadFile = null;
let launcherConfig = {
  downloadUrl: 'https://speed.hetzner.de/50MB.bin',
  downloadFileName: 'mtg_patch_014.tre',
  patchNotesUrl: 'https://outerrim.gg/portal/patch-notes',
  authUrl: 'https://outerrim.gg/portal/api/login',
  eventsUrl: 'https://outerrim.gg/portal/api/events',
  swgInstallPath: ''
};

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
  return `<div class="roadmap-item"><p>${text.slice(0, 800).trim()}...</p></div>`;
}

function extractLatestEvent(html) {
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  const articleMatch = cleanHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    let content = articleMatch[1];
    const titleMatch = content.match(/<h[12-6][^>]*>([\s\S]*?)<\/h[12-6]>/i);
    const descMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (titleMatch && descMatch) {
      return `<div class="event-item"><strong>${titleMatch[1].trim()}</strong><p>${descMatch[1].trim()}</p></div>`;
    }
    return `<div class="event-item">${content.trim()}</div>`;
  }

  const blockMatch = cleanHtml.match(/<(?:div|section)[^>]*(?:class|id)=["'][^"']*(?:event|scheduled-event|event-item)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i);
  if (blockMatch) {
    let content = blockMatch[1];
    const titleMatch = content.match(/<h[12-6][^>]*>([\s\S]*?)<\/h[12-6]>/i);
    const descMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (titleMatch && descMatch) {
      return `<div class="event-item"><strong>${titleMatch[1].trim()}</strong><p>${descMatch[1].trim()}</p></div>`;
    }
    return `<div class="event-item">${content.trim()}</div>`;
  }

  const headingMatch = cleanHtml.match(/<h[12-6][^>]*>([\s\S]*?)<\/h[12-6]>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
  if (headingMatch) {
    return `<div class="event-item"><strong>${headingMatch[1].trim()}</strong><p>${headingMatch[2].trim()}</p></div>`;
  }

  const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : cleanHtml;
  const text = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return `<div class="event-item"><strong>Latest scheduled event</strong><p>${text.slice(0, 300).trim()}...</p></div>`;
}

function extractPortalStatus(html) {
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  const statusMatch = cleanHtml.match(/<div[^>]*(?:class|id)=["'][^"']*(?:status|server-status|portal-status|server-info)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (statusMatch) {
    let content = statusMatch[1];
    const titleMatch = content.match(/<h[12-6][^>]*>([\s\S]*?)<\/h[12-6]>/i);
    const descMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (titleMatch && descMatch) {
      return `<div class="server-status-item"><strong>${titleMatch[1].trim()}</strong><p>${descMatch[1].trim()}</p></div>`;
    }
    return `<div class="server-status-item">${content.trim()}</div>`;
  }

  const headingMatch = cleanHtml.match(/<h[12-6][^>]*>([\s\S]*?server[\s\S]*?)<\/h[12-6]>/i);
  const paragraphMatch = cleanHtml.match(/<p[^>]*>([\s\S]*?online[\s\S]*?)<\/p>/i);
  if (headingMatch && paragraphMatch) {
    return `<div class="server-status-item"><strong>${headingMatch[1].trim()}</strong><p>${paragraphMatch[1].trim()}</p></div>`;
  }

  const serverText = cleanHtml.match(/(server status|online|offline|live|maintenance|down)[\s\S]{0,200}/i);
  if (serverText) {
    return `<div class="server-status-item"><strong>Portal status</strong><p>${serverText[0].trim()}</p></div>`;
  }

  const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : cleanHtml;
  const text = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return `<div class="server-status-item"><strong>Portal status</strong><p>${text.slice(0, 200).trim()}...</p></div>`;
}

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    launcherConfig = {
      ...launcherConfig,
      ...parsed
    };
  } catch (error) {
    console.warn('Could not read config.json, using defaults:', error.message);
  }
}

function loadUserSettings() {
  try {
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    if (fs.existsSync(userSettingsPath)) {
      const rawSettings = fs.readFileSync(userSettingsPath, 'utf8');
      const settings = JSON.parse(rawSettings);
      launcherConfig = {
        ...launcherConfig,
        ...settings
      };
    }
  } catch (error) {
    console.warn('Could not read settings.json:', error.message);
  }
}

function saveUserSettings() {
  try {
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    fs.writeFileSync(userSettingsPath, JSON.stringify({ swgInstallPath: launcherConfig.swgInstallPath }, null, 2));
  } catch (error) {
    console.warn('Could not save settings.json:', error.message);
  }
}

function isGameInstalled(installPath = launcherConfig.swgInstallPath) {
  const candidates = [];
  const normalizedPath = installPath ? path.normalize(installPath) : '';

  if (normalizedPath) {
    const maybeExe = normalizedPath.toLowerCase().endsWith('.exe') ? normalizedPath : path.join(normalizedPath, 'SwgClient_r.exe');
    candidates.push(maybeExe);
  }

  const commonPaths = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Star Wars Galaxies', 'SwgClient_r.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Star Wars Galaxies', 'SwgClient_r.exe'),
    path.join(process.env['USERPROFILE'] || 'C:\\Users\\Public', 'Documents', 'Star Wars Galaxies', 'SwgClient_r.exe')
  ];

  for (const candidate of candidates.concat(commonPaths)) {
    if (fs.existsSync(candidate)) {
      return { installed: true, path: candidate };
    }
  }

  return { installed: false, paths: candidates.length ? candidates : commonPaths };
}

function createPreloadScript() {
    const preloadPath = path.join(__dirname, 'preload.js');
    const preloadContent = `
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  launchGame: (serverAddress) => ipcRenderer.send('launch-game', serverAddress),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  startDownload: (url, fileName) => ipcRenderer.send('start-download', { url, fileName }),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', callback),
  getLauncherConfig: () => ipcRenderer.invoke('get-launcher-config'),
  fetchPatchNotes: () => ipcRenderer.invoke('fetch-patch-notes'),
  fetchRoadmap: () => ipcRenderer.invoke('fetch-roadmap'),
  fetchEvents: () => ipcRenderer.invoke('fetch-events'),
  checkServerStatus: (url) => ipcRenderer.invoke('check-server-status', url),
  checkGameInstalled: () => ipcRenderer.invoke('check-game-installed'),
  selectGameFolder: () => ipcRenderer.invoke('select-game-folder'),
  validateLogin: (credentials) => ipcRenderer.invoke('validate-login', credentials)
});
`;

    require('fs').writeFileSync(preloadPath, preloadContent);
    return preloadPath;
}

function createWindow() {
    app.setPath('userData', path.join(__dirname, 'user-data'));

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        frame: false,
        transparent: false,
        backgroundColor: '#0b0d17',
        resizable: false,
        show: false,
        webPreferences: {
            preload: createPreloadScript(),
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.webContents.session.on('will-download', (event, item) => {
        const fileName = currentDownloadFile || item.getFilename();
        const downloadsFolder = path.join(app.getPath('userData'), 'downloads');
        fs.mkdirSync(downloadsFolder, { recursive: true });

        const savePath = path.join(downloadsFolder, fileName);
        item.setSavePath(savePath);

        item.on('updated', () => {
            const received = item.getReceivedBytes();
            const total = item.getTotalBytes();
            const percent = total > 0 ? Math.round((received / total) * 100) : 0;
            mainWindow.webContents.send('download-progress', {
                fileName,
                received,
                total,
                percent
            });
        });

        item.once('done', (event, state) => {
            const total = item.getTotalBytes();
            const filePath = item.getSavePath();
            mainWindow.webContents.send('download-complete', {
                fileName,
                filePath,
                total,
                state: state
            });
            currentDownloadFile = null;
        });
    });
}

loadConfig();
loadUserSettings();
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.on('launch-game', (event, serverAddress) => {
    const targetServer = serverAddress || launcherConfig.servers?.[0]?.address || 'login.theouterrim.gg';
    try {
        const client = spawn('SwgClient_r.exe', ['--s0', targetServer, '--p0', '44453'], {
            detached: true,
            stdio: 'ignore'
        });

        client.unref();
        console.log(`Game client launch requested for ${targetServer}`);
    } catch (error) {
        console.error('Failed to launch game client:', error);
    }
});

ipcMain.on('start-download', (event, { url, fileName }) => {
    currentDownloadFile = fileName || launcherConfig.downloadFileName;
    mainWindow.webContents.downloadURL(url || launcherConfig.downloadUrl);
});

ipcMain.handle('get-launcher-config', () => {
    return launcherConfig;
});

ipcMain.handle('fetch-patch-notes', async () => {
    try {
        const response = await fetch(launcherConfig.patchNotesUrl);
        if (!response.ok) {
            throw new Error(`Status ${response.status}`);
        }
        const text = await response.text();
        const snippet = extractPatchNotes(text);
        return { success: true, notes: snippet };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('fetch-events', async () => {
    if (!launcherConfig.eventsUrl) {
        return { success: false, error: 'Events endpoint is not configured.' };
    }

    try {
        const response = await fetch(launcherConfig.eventsUrl);
        if (!response.ok) {
            throw new Error(`Status ${response.status}`);
        }

        const body = await response.text();
        const html = extractLatestEvent(body);
        return { success: true, html };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('fetch-roadmap', async () => {
    if (!launcherConfig.roadmapUrl) {
        return { success: false, error: 'Roadmap URL is not configured.' };
    }

    try {
        const response = await fetch(launcherConfig.roadmapUrl);
        if (!response.ok) {
            throw new Error(`Status ${response.status}`);
        }

        const body = await response.text();
        const html = extractRoadmap(body);
        return { success: true, html };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('fetch-portal-status', async () => {
    if (!launcherConfig.portalStatusUrl) {
        return { success: false, error: 'Portal status URL is not configured.' };
    }

    try {
        const response = await fetch(launcherConfig.portalStatusUrl);
        if (response.ok) {
            return { success: true, status: 'online', message: 'Server status: online' };
        }

        return { success: true, status: 'offline', message: `Server status: offline (${response.status})` };
    } catch (error) {
        return { success: true, status: 'offline', message: `Server status: offline (${error.message})` };
    }
});

ipcMain.handle('validate-login', async (event, credentials) => {
    const username = credentials?.username?.trim();
    const password = credentials?.password;
    if (!username || !password) {
        return { success: false, error: 'Username and password are required.' };
    }

    if (!launcherConfig.authUrl) {
        return { success: false, error: 'Login endpoint is not configured.' };
    }

    try {
        const response = await fetch(launcherConfig.authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            return { success: true };
        }

        return { success: false, error: `Login failed (${response.status})` };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('check-game-installed', async () => {
    try {
        return isGameInstalled();
    } catch (error) {
        return { installed: false, error: error.message };
    }
});

ipcMain.handle('select-game-folder', async () => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Star Wars Galaxies folder',
            properties: ['openDirectory']
        });

        if (result.canceled || !result.filePaths.length) {
            return { canceled: true };
        }

        launcherConfig.swgInstallPath = result.filePaths[0];
        saveUserSettings();
        return isGameInstalled(launcherConfig.swgInstallPath);
    } catch (error) {
        return { installed: false, error: error.message };
    }
});

ipcMain.handle('check-server-status', async (event, url) => {
    if (!url) {
        return { online: false, error: 'Missing status URL' };
    }

    try {
        const response = await fetch(url, { method: 'HEAD' });
        return { online: response.ok };
    } catch (error) {
        return { online: false, error: error.message };
    }
});

ipcMain.on('minimize-window', () => {
    mainWindow?.minimize();
});

ipcMain.on('close-window', () => {
    mainWindow?.close();
});

ipcMain.on('open-external', (event, url) => {
    shell.openExternal(url).catch((error) => {
        console.error('Failed to open external URL:', error);
    });
});
