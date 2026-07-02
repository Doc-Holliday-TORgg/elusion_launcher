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

    let isUpdating = false;
    let updateReady = false;
    let isLoggedIn = false;
    let swgInstallPath = '';
    let servers = [];
    let bypassUpdate = false;

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
            updateUI(undefined, 'Logged in. Check for updates to patch your client.');
            closeLoginModal();
            return;
        }

        loginError.textContent = result?.error || 'Login failed. Please try again.';
    }

    // Single source of truth for the footer state: progress bar, status line,
    // SWG-path hint, and the enable/label of the update + launch buttons.
    function updateUI(percent, status) {
        if (typeof percent === 'number') progressBar.style.width = `${percent}%`;
        if (status != null) downloadStatus.textContent = status;
        swgPathInfo.textContent = swgInstallPath ? `SWG folder: ${swgInstallPath}` : 'SWG folder not selected.';

        if (bypassUpdate) {
            downloadActionBtn.textContent = 'UPDATES DISABLED';
            downloadActionBtn.disabled = true;
            launchActionBtn.disabled = !(swgInstallPath && isLoggedIn);
            return;
        }

        if (isUpdating) {
            downloadActionBtn.textContent = 'UPDATING…';
            downloadActionBtn.disabled = true;
            launchActionBtn.disabled = true;
            return;
        }
        if (!swgInstallPath) {
            downloadActionBtn.textContent = 'SELECT SWG FOLDER';
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
        downloadActionBtn.textContent = 'CHECK FOR UPDATES';
        downloadActionBtn.disabled = false;
        launchActionBtn.disabled = !updateReady;
    }

    async function runUpdate() {
        if (bypassUpdate) {
            updateReady = true;
            updateUI(100, 'Updates are disabled — launch uses your existing client files.');
            return;
        }
        if (isUpdating) return;
        if (!swgInstallPath) {
            updateUI(0, 'Select your SWG folder before updating.');
            return;
        }
        if (!isLoggedIn) {
            updateUI(0, 'Please log in before updating.');
            return;
        }

        isUpdating = true;
        updateUI(0, 'Starting update…');

        const result = await window.electronAPI?.runUpdate?.();
        isUpdating = false;

        if (result?.success) {
            updateReady = true;
            updateUI(100, result.message || 'Up to date. Ready to launch.');
        } else {
            updateReady = false;
            updateUI(0, `Update failed: ${result?.error || 'unknown error'}`);
        }
    }

    downloadActionBtn.addEventListener('click', () => {
        runUpdate();
    });

    launchActionBtn.addEventListener('click', async () => {
        if (!updateReady) return;
        const selectedAddress = serverDropdown?.value;
        launchActionBtn.textContent = 'LAUNCHING…';
        launchActionBtn.disabled = true;

        const result = await window.electronAPI?.launchGame?.(selectedAddress);
        launchActionBtn.textContent = 'LAUNCH GAME';

        if (result?.success) {
            updateUI(100, 'Game launched. Have fun!');
            launchActionBtn.disabled = false;
        } else {
            updateUI(100, `Launch failed: ${result?.error || 'unknown error'}`);
            launchActionBtn.disabled = false;
        }
    });

    loginBtn?.addEventListener('click', () => openLoginModal());
    loginSubmitBtn?.addEventListener('click', () => submitLogin());
    loginCancelBtn?.addEventListener('click', () => closeLoginModal());
    loginModal?.addEventListener('click', (event) => {
        if (event.target === loginModal) closeLoginModal();
    });

    selectSwgFolderBtn?.addEventListener('click', () => selectSwgFolder());

    window.electronAPI?.onUpdateProgress?.((event, data) => {
        updateUI(typeof data?.percent === 'number' ? data.percent : undefined, data?.message || '');
    });

    async function loadLauncherConfig() {
        if (!window.electronAPI?.getLauncherConfig) return;

        const config = await window.electronAPI.getLauncherConfig();
        swgInstallPath = config.swgInstallPath || '';
        servers = config.servers || [];
        bypassUpdate = !!config.bypassUpdate;
        downloadContent.textContent = bypassUpdate ? 'Outer Rim — launcher (updates disabled)' : 'Outer Rim — client updater';
        await refreshServerStatus();
        await loadGameInstallState();
    }

    async function refreshServerStatus() {
        if (!serverDropdown || !servers.length || !window.electronAPI?.checkServerStatus) return;

        serverDropdown.innerHTML = '';
        for (const server of servers) {
            const option = document.createElement('option');
            option.value = server.address || server.name;
            option.textContent = `${server.name} (Checking...)`;
            serverDropdown.appendChild(option);
        }

        for (let i = 0; i < servers.length; i++) {
            const server = servers[i];
            const status = await window.electronAPI.checkServerStatus(server.address);
            const option = serverDropdown.options[i];
            const online = status?.online;
            option.textContent = `${server.name} (${online ? 'Online' : 'Offline'})`;
        }
    }

    async function loadPatchNotes() {
        if (!window.electronAPI?.fetchPatchNotes) return;

        const patchNotesText = document.getElementById('patchNotesText');
        patchNotesText.textContent = 'Refreshing patch notes...';
        const result = await window.electronAPI.fetchPatchNotes();
        patchNotesText.textContent = result.success ? result.notes : `Unable to load patch notes: ${result.error}`;
    }

    async function loadGameInstallState() {
        if (!window.electronAPI?.checkGameInstalled) return;

        const result = await window.electronAPI.checkGameInstalled();
        if (result?.path) swgInstallPath = result.path;

        updateUI(0, swgInstallPath ? 'Ready. Log in, then check for updates.' : 'Select your Star Wars Galaxies folder to begin.');
    }

    async function selectSwgFolder() {
        if (!window.electronAPI?.selectGameFolder) return;

        const result = await window.electronAPI.selectGameFolder();
        if (result?.canceled) return;

        swgInstallPath = result?.path || swgInstallPath;
        updateReady = false;
        // Any chosen folder is patchable — the client can be downloaded into it.
        updateUI(0, result?.installed
            ? 'SWG folder set. Log in, then check for updates.'
            : 'Folder set — client will be patched here. Log in, then check for updates.');
    }

    async function loadEvents() {
        if (!eventsContent || !window.electronAPI?.fetchEvents) return;

        eventsContent.innerHTML = 'Loading events...';
        const result = await window.electronAPI.fetchEvents();
        if (result.success) eventsContent.innerHTML = result.html;
        else eventsContent.textContent = `Unable to load events: ${result.error}`;
    }

    async function loadRoadmap() {
        if (!roadmapContent || !window.electronAPI?.fetchRoadmap) return;

        roadmapContent.innerHTML = 'Loading roadmap...';
        const result = await window.electronAPI.fetchRoadmap();
        if (result.success) roadmapContent.innerHTML = result.html;
        else roadmapContent.textContent = `Unable to load roadmap: ${result.error}`;
    }

    async function loadPortalStatus() {
        if (!serverStatusContent || !window.electronAPI?.fetchPortalStatus) return;

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
    updateUI(0);

    optionsBtn.addEventListener('click', () => optionsModal.classList.remove('hidden'));
    optionsModal.addEventListener('click', (event) => {
        if (event.target === optionsModal) optionsModal.classList.add('hidden');
    });
    saveOptions.addEventListener('click', () => {
        fpsValue.textContent = `${frameRate.value} FPS`;
        optionsModal.classList.add('hidden');
    });
    frameRate.addEventListener('input', () => {
        fpsValue.textContent = `${frameRate.value} FPS`;
    });

    minimizeWindow?.addEventListener('click', () => window.electronAPI?.minimizeWindow?.());
    closeWindow?.addEventListener('click', () => window.electronAPI?.closeWindow?.());
});
