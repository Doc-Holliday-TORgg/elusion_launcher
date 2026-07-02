document.addEventListener('DOMContentLoaded', async () => {
    const optionsBtn = document.getElementById('optionsBtn');
    const optionsModal = document.getElementById('optionsModal');
    const saveOptions = document.getElementById('saveOptions');
    const progressBar = document.getElementById('progressBar');
    const downloadContent = document.getElementById('downloadContent');
    const downloadStatus = document.getElementById('downloadStatus');
    const downloadActionBtn = document.getElementById('downloadActionBtn');
    const frameRate = document.getElementById('frameRate');
    const fpsValue = document.getElementById('fpsValue');
    const minimizeWindow = document.getElementById('minimizeWindow');
    const closeWindow = document.getElementById('closeWindow');
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = document.getElementById('loginBtnText');
    const loginStatus = document.getElementById('loginStatus');
    const loginModal = document.getElementById('loginModal');
    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');
    const loginError = document.getElementById('loginError');
    const loginSubmitBtn = document.getElementById('loginSubmitBtn');
    const loginCancelBtn = document.getElementById('loginCancelBtn');
    const serverDropdown = document.getElementById('serverDropdown');
    const eventsContent = document.getElementById('eventsContent');
    const roadmapContent = document.getElementById('roadmapContent');
    const serverStatusContent = document.getElementById('serverStatusContent');
    const swgPathInfo = document.getElementById('swgPathInfo');
    const selectSwgFolderBtn = document.getElementById('selectSwgFolderBtn');
    const launchActionBtn = document.getElementById('launchActionBtn');

    let downloadFileName = 'mtg_patch_014.tre';
    let downloadUrl = 'https://speed.hetzner.de/50MB.bin';
    let downloadComplete = false;
    let isLoggedIn = false;
    let isGameInstalled = false;
    let swgInstallPath = '';
    let servers = [];

    function updateLoginUI() {
        loginStatus.textContent = isLoggedIn ? 'Logged in' : 'Not logged in';
        loginBtnText.textContent = isLoggedIn ? 'Signed in' : 'Log into your account';
    }

    function openLoginModal() {
        loginError.textContent = '';
        loginUsername.value = '';
        loginPassword.value = '';
        loginModal.classList.remove('hidden');
    }

    function closeLoginModal() {
        loginModal.classList.add('hidden');
    }

    async function submitLogin() {
        const username = loginUsername.value.trim();
        const password = loginPassword.value;

        if (!username || !password) {
            loginError.textContent = 'Please enter both username and password.';
            return;
        }

        loginSubmitBtn.disabled = true;
        loginError.textContent = 'Validating credentials...';

        const result = await window.electronAPI?.validateLogin?.({ username, password });
        loginSubmitBtn.disabled = false;

        if (result?.success) {
            isLoggedIn = true;
            updateLoginUI();
            updateDownloadUI();
            closeLoginModal();
            return;
        }

        loginError.textContent = result?.error || 'Login failed. Please try again.';
    }

    function updateDownloadUI(percent = 0, status = 'Ready to start download') {
        progressBar.style.width = `${percent}%`;
        downloadContent.textContent = `Downloading: ${downloadFileName}`;
        downloadStatus.textContent = status;

        if (swgInstallPath) {
            swgPathInfo.textContent = `SWG folder: ${swgInstallPath}`;
        } else {
            swgPathInfo.textContent = 'SWG folder not selected.';
        }

        if (!isGameInstalled) {
            downloadActionBtn.textContent = 'START DOWNLOAD';
            downloadActionBtn.disabled = true;
            launchActionBtn.disabled = true;
            return;
        }

        if (!isLoggedIn) {
            downloadActionBtn.textContent = 'LOGIN REQUIRED';
            downloadActionBtn.disabled = true;
            launchActionBtn.disabled = true;
            return;
        }

        if (downloadComplete) {
            downloadActionBtn.textContent = 'DOWNLOAD COMPLETE';
            downloadActionBtn.disabled = true;
            launchActionBtn.disabled = false;
        } else {
            downloadActionBtn.textContent = 'START DOWNLOAD';
            downloadActionBtn.disabled = false;
            launchActionBtn.disabled = true;
        }
    }

    function startDownload() {
        if (downloadComplete || window.electronAPI?.startDownload == null) {
            return;
        }

        if (!isGameInstalled) {
            updateDownloadUI(0, 'Please select your SWG folder before downloading.');
            return;
        }

        if (!isLoggedIn) {
            updateDownloadUI(0, 'Please log in before downloading.');
            return;
        }

        downloadActionBtn.textContent = 'DOWNLOADING...';
        downloadActionBtn.disabled = true;
        launchActionBtn.disabled = true;
        updateDownloadUI(0, 'Initializing download...');
        window.electronAPI.startDownload(downloadUrl, downloadFileName);
    }

    downloadActionBtn.addEventListener('click', () => {
        if (downloadComplete) {
            return;
        }
        startDownload();
    });

    launchActionBtn.addEventListener('click', () => {
        if (!downloadComplete) {
            return;
        }
        const selectedAddress = serverDropdown?.value;
        launchActionBtn.textContent = 'LAUNCHING...';
        launchActionBtn.disabled = true;
        window.electronAPI?.launchGame?.(selectedAddress);
    });

    loginBtn?.addEventListener('click', () => {
        openLoginModal();
    });

    loginSubmitBtn?.addEventListener('click', () => {
        submitLogin();
    });

    loginCancelBtn?.addEventListener('click', () => {
        closeLoginModal();
    });

    loginModal?.addEventListener('click', (event) => {
        if (event.target === loginModal) {
            closeLoginModal();
        }
    });

    selectSwgFolderBtn?.addEventListener('click', () => {
        selectSwgFolder();
    });

    window.electronAPI?.onDownloadProgress?.((event, data) => {
        updateDownloadUI(data.percent, `Downloading ${data.fileName} — ${data.percent}% (${(data.received / 1024 / 1024).toFixed(1)} / ${(data.total / 1024 / 1024).toFixed(1)} MB)`);
    });

    window.electronAPI?.onDownloadComplete?.((event, data) => {
        downloadComplete = true;
        updateDownloadUI(100, `Download complete: ${data.fileName}`);
        launchActionBtn.textContent = 'LAUNCH GAME';
    });

    async function loadLauncherConfig() {
        if (!window.electronAPI?.getLauncherConfig) {
            return;
        }

        const config = await window.electronAPI.getLauncherConfig();
        downloadFileName = config.downloadFileName || downloadFileName;
        downloadUrl = config.downloadUrl || downloadUrl;
        swgInstallPath = config.swgInstallPath || '';
        servers = config.servers || [];
        document.getElementById('downloadContent').textContent = `Downloading: ${downloadFileName}`;
        await refreshServerStatus();
        await loadGameInstallState();
    }

    async function refreshServerStatus() {
        if (!serverDropdown || !servers.length || !window.electronAPI?.checkServerStatus) {
            return;
        }

        serverDropdown.innerHTML = '';
        for (const server of servers) {
            const option = document.createElement('option');
            option.value = server.address || server.name;
            option.textContent = `${server.name} (Checking...)`;
            serverDropdown.appendChild(option);
        }

        for (let i = 0; i < servers.length; i++) {
            const server = servers[i];
            const status = await window.electronAPI.checkServerStatus(server.statusUrl);
            const option = serverDropdown.options[i];
            const online = status?.online;
            option.textContent = `${server.name} (${online ? 'Online' : 'Offline'})`;
            option.disabled = !online;
        }
    }

    async function loadPatchNotes() {
        if (!window.electronAPI?.fetchPatchNotes) {
            return;
        }

        const patchNotesText = document.getElementById('patchNotesText');
        patchNotesText.textContent = 'Refreshing patch notes...';
        const result = await window.electronAPI.fetchPatchNotes();
        if (result.success) {
            patchNotesText.textContent = result.notes;
        } else {
            patchNotesText.textContent = `Unable to load patch notes: ${result.error}`;
        }
    }

    async function loadGameInstallState() {
        if (!window.electronAPI?.checkGameInstalled) {
            return;
        }

        const result = await window.electronAPI.checkGameInstalled();
        isGameInstalled = result?.installed === true;
        if (result?.path) {
            swgInstallPath = result.path;
        }

        if (!isGameInstalled) {
            updateDownloadUI(0, 'Star Wars Galaxies not found on this PC.');
        } else {
            updateDownloadUI();
        }
    }

    async function selectSwgFolder() {
        if (!window.electronAPI?.selectGameFolder) {
            return;
        }

        const result = await window.electronAPI.selectGameFolder();
        if (result?.canceled) {
            return;
        }

        isGameInstalled = result?.installed === true;
        swgInstallPath = result?.path || swgInstallPath;
        if (result?.installed) {
            updateDownloadUI();
        } else {
            updateDownloadUI(0, 'Selected folder does not contain SWG client.');
        }
    }

    async function loadEvents() {
        if (!eventsContent || !window.electronAPI?.fetchEvents) {
            return;
        }

        eventsContent.innerHTML = 'Loading events...';
        const result = await window.electronAPI.fetchEvents();
        if (result.success) {
            eventsContent.innerHTML = result.html;
        } else {
            eventsContent.textContent = `Unable to load events: ${result.error}`;
        }
    }

    async function loadRoadmap() {
        if (!roadmapContent || !window.electronAPI?.fetchRoadmap) {
            return;
        }

        roadmapContent.innerHTML = 'Loading roadmap...';
        const result = await window.electronAPI.fetchRoadmap();
        if (result.success) {
            roadmapContent.innerHTML = result.html;
        } else {
            roadmapContent.textContent = `Unable to load roadmap: ${result.error}`;
        }
    }

    async function loadPortalStatus() {
        if (!serverStatusContent || !window.electronAPI?.fetchPortalStatus) {
            return;
        }

        serverStatusContent.innerHTML = 'Checking portal status...';
        const result = await window.electronAPI.fetchPortalStatus();
        if (result.success) {
            const statusClass = result.status === 'online' ? 'status-online' : 'status-offline';
            serverStatusContent.innerHTML = `<span class="server-status-pill ${statusClass}">${result.status === 'online' ? 'Online' : 'Offline'}</span><div class="server-status-message">${result.message}</div>`;
        } else {
            serverStatusContent.textContent = `Unable to load portal status: ${result.error}`;
        }
    }

    await loadLauncherConfig();
    await loadPatchNotes();
    await loadRoadmap();
    await loadEvents();
    await loadPortalStatus();
    setInterval(loadPatchNotes, 60000);
    setInterval(loadRoadmap, 60000);
    setInterval(loadEvents, 60000);
    setInterval(loadPortalStatus, 60000);
    setInterval(refreshServerStatus, 60000);

    updateLoginUI();
    updateDownloadUI();

    optionsBtn.addEventListener('click', () => {
        optionsModal.classList.remove('hidden');
    });

    optionsModal.addEventListener('click', (event) => {
        if (event.target === optionsModal) {
            optionsModal.classList.add('hidden');
        }
    });

    saveOptions.addEventListener('click', () => {
        fpsValue.textContent = `${frameRate.value} FPS`;
        optionsModal.classList.add('hidden');
    });

    frameRate.addEventListener('input', () => {
        fpsValue.textContent = `${frameRate.value} FPS`;
    });

    minimizeWindow?.addEventListener('click', () => {
        window.electronAPI?.minimizeWindow?.();
    });

    closeWindow?.addEventListener('click', () => {
        window.electronAPI?.closeWindow?.();
    });
});