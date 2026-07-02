// patcher.js — Outer Rim client patching + config, decoupled from Electron so it
// can be unit-tested with plain Node. Uses only Node built-ins.
//
// Server contract (verified against live outerrim.gg):
//   manifest : GET https://<webHost>/portal/api/manifest
//              -> { download_port, files:[{name,size,md5,sha256}], tre_order }
//   files    : GET https://<webHost>/portal/files/<name>   (Cloudflare 443; NOT download_port)
//   live cfg : GET https://<webHost>/portal/static/swgemu_live.cfg  (pre-built TRE load order)
// The game login server is a direct-to-origin host (grey-clouded) on TCP 44453.

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  webHost: 'outerrim.gg',        // portal / manifest / files / cfg (behind Cloudflare, 443)
  gameHost: 'play.outerrim.gg',  // game login server (direct-to-origin, CF can't proxy game UDP)
  loginPort: 44453,
  manifestPath: '/portal/api/manifest',
  filesPath: '/portal/files',
  liveCfgPath: '/portal/static/swgemu_live.cfg',
};

// Files that must never be pulled from the server:
//  - options.cfg / user.cfg / ui.txt : player-owned (graphics, UI layout, multi-instance)
//  - OuterRim*.exe                    : the C# launcher's own artifacts, irrelevant here
const SKIP_NAMES = new Set([
  'options.cfg', 'user.cfg', 'ui.txt',
  'outerrimlauncher.exe', 'outerrimlogin.exe',
]);

const UA = 'ElusionLauncher';

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const s = fs.createReadStream(filePath);
    s.on('error', reject);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
  });
}

async function fetchManifest(webHost) {
  const url = `https://${webHost}${DEFAULTS.manifestPath}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.files)) throw new Error('Manifest missing files[]');
  return json;
}

// Decide which manifest files need downloading. `cache` maps name -> {size,mtime,md5}
// so returning players skip re-hashing unchanged multi-GB TREs. Returns
// { needed:[entry], upToDate:n, freshCache }.
async function planUpdate(files, swgDir, cache = {}, onProgress) {
  const needed = [];
  const freshCache = {};
  let upToDate = 0;
  let done = 0;
  const relevant = files.filter((f) => !SKIP_NAMES.has(String(f.name).toLowerCase()));

  for (const f of relevant) {
    const name = f.name;
    const local = path.join(swgDir, name);
    let need = false;

    if (!fs.existsSync(local)) {
      need = true;
    } else {
      const st = fs.statSync(local);
      if (st.size !== f.size) {
        need = true; // size differs -> definitely changed, no need to hash
      } else {
        const mtime = st.mtimeMs;
        const c = cache[name];
        const localMd5 = (c && c.size === f.size && c.mtime === mtime)
          ? c.md5                       // trust cache
          : await md5File(local);       // cold: hash once
        freshCache[name] = { size: f.size, mtime, md5: localMd5 };
        need = localMd5.toLowerCase() !== String(f.md5).toLowerCase();
      }
    }

    if (need) needed.push(f); else upToDate++;
    done++;
    if (onProgress) onProgress(done, relevant.length, name);
  }

  return { needed, upToDate, freshCache };
}

// Stream one file into <swgDir>/<name>, hashing as we go, atomic .part -> rename,
// with an MD5 gate so a truncated/corrupt download is never committed.
function downloadFile(webHost, entry, swgDir, onProgress) {
  return new Promise((resolve, reject) => {
    const name = entry.name;
    const dest = path.join(swgDir, name);
    const tmp = dest + '.part';
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const url = `https://${webHost}${DEFAULTS.filesPath}/${encodeURIComponent(name)}`;
    const hash = crypto.createHash('md5');
    const out = fs.createWriteStream(tmp);
    let received = 0;

    const cleanup = () => { try { fs.unlinkSync(tmp); } catch (_) {} };

    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        out.close();
        cleanup();
        return reject(new Error(`HTTP ${res.statusCode} for ${name}`));
      }
      const total = Number(res.headers['content-length']) || entry.size || 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        if (onProgress) onProgress(received, total);
      });
      res.on('error', (e) => { out.close(); cleanup(); reject(e); });
      res.pipe(out);
    });

    out.on('finish', () => {
      out.close(() => {
        const got = hash.digest('hex');
        if (entry.md5 && got.toLowerCase() !== String(entry.md5).toLowerCase()) {
          cleanup();
          return reject(new Error(`MD5 mismatch for ${name}: got ${got}, expected ${entry.md5}`));
        }
        try {
          fs.renameSync(tmp, dest);
        } catch (_) {
          // Windows: can't rename over an existing file — remove then rename.
          try { fs.unlinkSync(dest); fs.renameSync(tmp, dest); }
          catch (e2) { cleanup(); return reject(e2); }
        }
        resolve({ name, bytes: received });
      });
    });

    req.on('error', (e) => { out.close(); cleanup(); reject(e); });
    out.on('error', (e) => { cleanup(); reject(e); });
  });
}

// The server serves a pre-built swgemu_live.cfg (correct TRE order + maxSearchPriority).
async function downloadLiveCfg(webHost, swgDir) {
  const url = `https://${webHost}${DEFAULTS.liveCfgPath}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`swgemu_live.cfg HTTP ${res.status}`);
  const data = await res.text();
  if (!/searchTree_/i.test(data)) throw new Error('swgemu_live.cfg looks invalid (no searchTree entries)');
  fs.writeFileSync(path.join(swgDir, 'swgemu_live.cfg'), data);
  return data;
}

function writeLoginCfg(swgDir, gameHost, loginPort) {
  fs.writeFileSync(path.join(swgDir, 'swgemu_login.cfg'),
    '[ClientGame]\n' +
    `loginServerAddress0=${gameHost}\n` +
    `loginServerPort0=${loginPort}\n\n` +
    '[Station]\n' +
    'subscriptionFeatures=1\n' +
    'gameFeatures=65535\n');
}

// Root config the client reads (CWD-relative). Include filenames MUST be
// double-quoted or the client silently skips them -> empty TRE search tree ->
// "appearance/defaultappearance.apt could not be found" FATAL.
function writeRootCfg(swgDir) {
  // Guarantee user.cfg exists so its .include always resolves.
  const userCfg = path.join(swgDir, 'user.cfg');
  if (!fs.existsSync(userCfg)) fs.writeFileSync(userCfg, '');

  let cfg = '.include "swgemu_login.cfg"\n.include "swgemu_live.cfg"\n';
  if (fs.existsSync(path.join(swgDir, 'swgemu_preload.cfg'))) cfg += '.include "swgemu_preload.cfg"\n';
  if (fs.existsSync(path.join(swgDir, 'options.cfg'))) cfg += '.include "options.cfg"\n';
  cfg += '.include "user.cfg"\n';
  fs.writeFileSync(path.join(swgDir, 'swgemu.cfg'), cfg);
}

function resolveClientExe(swgDir) {
  for (const n of ['SWGEmu.exe', 'SwgClient_r.exe']) {
    const p = path.join(swgDir, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function buildLaunchArgs(gameHost, loginPort, multiInstance) {
  return [
    '--',
    '-s', 'ClientGame', `loginServerAddress0=${gameHost}`, `loginServerPort0=${loginPort}`,
    '-s', 'Station', 'gameFeatures=65535', 'subscriptionFeatures=1',
    '-s', 'SwgClient', `allowMultipleInstances=${multiInstance ? 'true' : 'false'}`,
  ];
}

module.exports = {
  DEFAULTS, SKIP_NAMES,
  md5File, fetchManifest, planUpdate, downloadFile, downloadLiveCfg,
  writeLoginCfg, writeRootCfg, resolveClientExe, buildLaunchArgs,
};
