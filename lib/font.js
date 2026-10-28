'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const { parse, modify, applyEdits } = require('./jsonc-lite');
const PACKAGE_VERSION = require('../package.json').version;
const { DEFAULT_TUI_FONT, DEFAULT_TUI_FONT_WEIGHT, DEFAULT_TUI_FONT_SOURCE } = require('./config');

const RELEASE_API = 'https://api.github.com/repos/SpaceTimee/Fusion-JetBrainsMapleMono/releases/latest';
const REPOSITORY = 'https://github.com/SpaceTimee/Fusion-JetBrainsMapleMono';
const USER_AGENT = `eri-ai-debug-font-installer/${PACKAGE_VERSION}`;
const MAX_REDIRECTS = 6;
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024; // Upstream ZIPs are ~134–152 MiB; cap custom URLs at 250 MiB.

function isSafeHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!isSafeHttpsUrl(url)) return reject(new Error('字体下载地址必须使用 HTTPS。'));
    if (redirects > MAX_REDIRECTS) return reject(new Error('字体源重定向次数过多。'));
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      timeout: 30000,
    }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        return resolve(requestBuffer(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`获取字体发布信息失败：HTTP ${code}`));
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 5 * 1024 * 1024) {
          req.destroy(new Error('字体发布信息超过 5 MiB，已停止读取。'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('连接字体源超时。')));
    req.on('error', reject);
  });
}

function downloadFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!isSafeHttpsUrl(url)) return reject(new Error('字体下载地址必须使用 HTTPS。'));
    if (redirects > MAX_REDIRECTS) return reject(new Error('字体下载重定向次数过多。'));
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
      timeout: 60000,
    }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume();
        return resolve(downloadFile(new URL(res.headers.location, url).toString(), destination, redirects + 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`下载字体压缩包失败：HTTP ${code}`));
      }
      const declaredSize = Number(res.headers['content-length'] || 0);
      if (declaredSize > MAX_ARCHIVE_BYTES) {
        res.resume();
        return reject(new Error(`字体压缩包超过 ${Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024))} MiB 安全上限。`));
      }
      const output = fs.createWriteStream(destination, { flags: 'wx' });
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_ARCHIVE_BYTES) {
          const error = new Error(`字体压缩包超过 ${Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024))} MiB 安全上限。`);
          req.destroy(error);
          output.destroy(error);
        }
      });
      res.on('aborted', () => output.destroy(new Error('字体下载连接被中断。')));
      output.on('error', reject);
      output.on('finish', () => {
        const expected = Number(res.headers['content-length'] || 0);
        const actual = fs.existsSync(destination) ? fs.statSync(destination).size : 0;
        if (actual <= 0 || (expected > 0 && actual !== expected)) {
          try { fs.rmSync(destination, { force: true }); } catch { /* cleanup only */ }
          return reject(new Error(`字体文件下载不完整（收到 ${actual} 字节，预期 ${expected || '未知'} 字节）。`));
        }
        resolve({ path: destination, bytes: actual });
      });
      res.pipe(output);
    });
    req.on('timeout', () => req.destroy(new Error('字体下载连接超时。')));
    req.on('error', (error) => {
      try { fs.rmSync(destination, { force: true }); } catch { /* cleanup only */ }
      reject(error);
    });
  });
}

function chooseReleaseAsset(assets) {
  if (!Array.isArray(assets)) throw new Error('字体源没有提供有效的 release assets 列表。');
  const archives = assets.filter((asset) => asset && typeof asset.name === 'string'
    && asset.name.toLowerCase().endsWith('.zip')
    && /JetBrainsMapleMono/i.test(asset.name)
    && !/\bNF\b/i.test(asset.name));
  const preferredNames = [
    'JetBrainsMapleMono-XX-XX-NL-HT.zip',
    'JetBrainsMapleMono-XX-XX-XX-XX.zip',
    'JetBrainsMapleMono-XX-NR-NL-HT.zip',
    'JetBrainsMapleMono-XX-XX-NL-XX.zip',
  ];
  for (const name of preferredNames) {
    const asset = archives.find((item) => item.name === name);
    if (asset && isSafeHttpsUrl(asset.browser_download_url)) return asset;
  }
  const asset = archives.find((item) => isSafeHttpsUrl(item.browser_download_url));
  if (asset) return asset;
  throw new Error('未找到安全的 JetBrains Maple Mono ZIP 发布包。请设置 ERI_FONT_ARCHIVE_URL 为 HTTPS 的 ZIP 直链。');
}

async function resolveFontArchive(overrideUrl) {
  const custom = overrideUrl || process.env.ERI_FONT_ARCHIVE_URL;
  if (custom) {
    if (!isSafeHttpsUrl(custom)) throw new Error('ERI_FONT_ARCHIVE_URL 必须是 HTTPS 的 ZIP 直链，而不是字体目录页面。');
    const parsedUrl = new URL(custom);
    if (!parsedUrl.pathname.toLowerCase().endsWith('.zip')) {
      throw new Error('字体自定义地址必须指向 .zip 文件；字体目录页面或单独的 WOFF/TTF 不能作为 ZIP 解压。');
    }
    return { name: path.basename(parsedUrl.pathname) || 'font.zip', browser_download_url: custom, size: 0, source: 'custom' };
  }
  const release = JSON.parse((await requestBuffer(RELEASE_API)).toString('utf8'));
  const asset = chooseReleaseAsset(release.assets);
  return { ...asset, source: 'upstream', release: release.tag_name, page: release.html_url };
}

function walkFiles(dir) {
  const found = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...walkFiles(full));
    else if (item.isFile()) found.push(full);
  }
  return found;
}

function selectMediumFonts(files) {
  const valid = files.filter((file) => /\.(ttf|otf)$/i.test(file)
    && /Jet.?Brains.?Maple.?Mono/i.test(path.basename(file)));
  const medium = valid.filter((file) => /Medium/i.test(path.basename(file)) && !/Italic/i.test(path.basename(file)));
  if (medium.length) return medium;
  const mediumInsideMeta = valid.filter((file) => /Medium/i.test(path.basename(file)));
  if (mediumInsideMeta.length) return mediumInsideMeta;
  throw new Error('压缩包中没有找到 JetBrains Maple Mono Medium 字体文件；未安装任何字体。');
}

function fontDirectories(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [path.join(local, 'Microsoft', 'Windows', 'Fonts')];
  }
  if (platform === 'darwin') return [path.join(home, 'Library', 'Fonts')];
  return [path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'fonts')];
}

function getFontStatus(platform = process.platform, env = process.env, home = os.homedir()) {
  const directories = fontDirectories(platform, env, home);
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    let files = [];
    try { files = walkFiles(directory); } catch { /* status should never crash TUI */ }
    const match = files.find((file) => /Jet.?Brains.?Maple.?Mono.*Medium.*\.(ttf|otf)$/i.test(path.basename(file)));
    if (match) return { installed: true, family: DEFAULT_TUI_FONT, weight: DEFAULT_TUI_FONT_WEIGHT, path: match, directory };
  }
  return { installed: false, family: DEFAULT_TUI_FONT, weight: DEFAULT_TUI_FONT_WEIGHT, path: null, directory: directories[0] };
}

function backupFile(file) {
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const backup = `${file}.eri-ai-debug-${suffix}.bak`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  return backup;
}

function writeJsoncWithEdits(file, pathsToValues) {
  const before = fs.readFileSync(file, 'utf8');
  const errors = [];
  const initial = parse(before, errors, { allowTrailingComma: true });
  if (errors.length || !initial || typeof initial !== 'object' || Array.isArray(initial)) {
    throw new Error(`JSONC 配置无效，拒绝修改并保留原文件：${file}`);
  }
  let after = before;
  for (const [propertyPath, value] of pathsToValues) {
    after = applyEdits(after, modify(after, propertyPath, value, {
      formattingOptions: { eol: after.includes('\r\n') ? '\r\n' : '\n' },
    }));
  }
  const afterErrors = [];
  const output = parse(after, afterErrors, { allowTrailingComma: true });
  if (afterErrors.length || !output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error(`字体设置生成的 JSONC 无效，未写入：${file}`);
  }
  if (after === before) return { file, changed: false, backup: null };
  const backup = backupFile(file);
  const tmp = `${file}.eri-ai-debug-tmp-${process.pid}`;
  const swap = `${tmp}.old`;
  fs.writeFileSync(tmp, after, 'utf8');
  try {
    if (process.platform === 'win32') {
      fs.renameSync(file, swap);
      try { fs.renameSync(tmp, file); }
      catch (error) {
        if (!fs.existsSync(file) && fs.existsSync(swap)) fs.renameSync(swap, file);
        throw error;
      }
      fs.rmSync(swap, { force: true });
    } else {
      fs.renameSync(tmp, file);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
    if (fs.existsSync(swap) && !fs.existsSync(file)) fs.renameSync(swap, file);
  }
  return { file, changed: true, backup };
}

function windowsTerminalSettingsPaths(env = process.env, home = os.homedir()) {
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    path.join(local, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(local, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(local, 'Microsoft', 'Windows Terminal', 'settings.json'),
  ];
}

function vscodeSettingsPaths(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [path.join(appData, 'Code', 'User', 'settings.json'), path.join(appData, 'Code - Insiders', 'User', 'settings.json')];
  }
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json')];
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [path.join(configHome, 'Code', 'User', 'settings.json'), path.join(configHome, 'Code - Insiders', 'User', 'settings.json')];
}

function applyKittyConfig(configPath = path.join(os.homedir(), '.config', 'kitty', 'kitty.conf')) {
  if (!fs.existsSync(configPath)) return null;
  const begin = '# BEGIN eri-ai-debug managed font';
  const end = '# END eri-ai-debug managed font';
  const block = `${begin}\nfont_family ${DEFAULT_TUI_FONT} Medium\n${end}`;
  const old = fs.readFileSync(configPath, 'utf8');
  const beginAt = old.indexOf(begin);
  const endAt = beginAt >= 0 ? old.indexOf(end, beginAt + begin.length) : -1;
  let after;
  if (beginAt >= 0 && endAt < 0) {
    throw new Error(`kitty.conf 中存在未闭合的 Eri 字体管理标记，拒绝覆盖：${configPath}`);
  }
  if (beginAt >= 0 && endAt >= 0) {
    after = `${old.slice(0, beginAt)}${block}${old.slice(endAt + end.length)}`;
  } else if (endAt >= 0) {
    throw new Error(`kitty.conf 中存在孤立的 Eri 字体结束标记，拒绝覆盖：${configPath}`);
  } else {
    after = `${old.replace(/\s*$/, '')}\n\n${block}\n`;
  }
  if (after === old) return { file: configPath, changed: false, backup: null };
  const backup = backupFile(configPath);
  fs.writeFileSync(configPath, after, 'utf8');
  return { file: configPath, changed: true, backup };
}

function normalizedGuid(value) {
  return String(value || '').replace(/[{}]/g, '').trim().toLowerCase();
}

function windowsTerminalFontEdits(settingsText, activeProfileId = '') {
  const errors = [];
  const settings = parse(settingsText, errors, { allowTrailingComma: true });
  if (errors.length || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Windows Terminal settings.json 是无效 JSONC，拒绝修改。');
  }
  const edits = [
    [['profiles', 'defaults', 'font', 'face'], DEFAULT_TUI_FONT],
    [['profiles', 'defaults', 'font', 'weight'], 'medium'],
  ];
  const profiles = settings.profiles && settings.profiles.list;
  const id = normalizedGuid(activeProfileId);
  if (id && Array.isArray(profiles)) {
    const index = profiles.findIndex((profile) => normalizedGuid(profile && profile.guid) === id);
    if (index >= 0) {
      edits.push(
        [['profiles', 'list', index, 'font', 'face'], DEFAULT_TUI_FONT],
        [['profiles', 'list', index, 'font', 'weight'], 'medium'],
      );
    }
  }
  return edits;
}

function applyTerminalFont() {
  const results = [];
  const platform = process.platform;
  const home = os.homedir();
  if (platform === 'win32') {
    const wt = windowsTerminalSettingsPaths().find((file) => fs.existsSync(file));
    if (wt) {
      const settingsText = fs.readFileSync(wt, 'utf8');
      const activeProfileId = process.env.WT_PROFILE_ID || '';
      const edits = windowsTerminalFontEdits(settingsText, activeProfileId);
      const result = writeJsoncWithEdits(wt, edits);
      results.push({
        terminal: 'Windows Terminal', ...result,
        note: activeProfileId && edits.length > 2
          ? '已更新默认字体及当前 WT_PROFILE_ID 对应的活动 profile；需完全重开终端。'
          : '已更新 profiles.defaults；如果某个 profile 单独覆盖了 font.face，请在该 profile 的外观设置中选择字体。',
      });
    }
    const vscode = vscodeSettingsPaths().find((file) => fs.existsSync(file));
    if (vscode) {
      const result = writeJsoncWithEdits(vscode, [
        [['terminal.integrated.fontFamily'], `'${DEFAULT_TUI_FONT}'`],
        [['terminal.integrated.fontWeight'], 500],
      ]);
      results.push({ terminal: 'VS Code Terminal', ...result });
    }
  } else {
    const kittyPath = path.join(home, '.config', 'kitty', 'kitty.conf');
    const kitty = applyKittyConfig(kittyPath);
    if (kitty) results.push({ terminal: 'kitty', ...kitty });
    const vscode = vscodeSettingsPaths(platform).find((file) => fs.existsSync(file));
    if (vscode) {
      const result = writeJsoncWithEdits(vscode, [
        [['terminal.integrated.fontFamily'], `'${DEFAULT_TUI_FONT}'`],
        [['terminal.integrated.fontWeight'], 500],
      ]);
      results.push({ terminal: 'VS Code Terminal', ...result });
    }
  }
  return {
    applied: results.length > 0,
    results,
    message: results.length
      ? '已更新检测到的终端配置（Windows Terminal 默认值及可识别的当前 profile、VS Code 字体族与 500 字重、kitty 管理块）。请完全退出并重新打开终端；当前正在运行的终端不会热切换系统字体。'
      : '已安装字体时，当前未发现可安全自动修改的终端配置。请在终端的外观设置中选择 JetBrains Maple Mono，字重设为 Medium。',
  };
}

function powershellInstallerScript() {
  return String.raw`param([Parameter(Mandatory=$true)][string]$ArchivePath, [Parameter(Mandatory=$true)][string]$FontDirectory)
$ErrorActionPreference = 'Stop'
$extract = Join-Path $env:TEMP ('eri-maple-font-' + [Guid]::NewGuid().ToString('N'))
try {
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $extract -Force
  $fonts = @(Get-ChildItem -LiteralPath $extract -Recurse -File | Where-Object {
    ($_.Extension -eq '.ttf' -or $_.Extension -eq '.otf') -and $_.Name -match 'Jet.?Brains.?Maple.?Mono' -and $_.BaseName -match 'Medium' -and $_.BaseName -notmatch 'Italic'
  })
  if ($fonts.Count -eq 0) { throw 'ZIP 中没有找到 JetBrains Maple Mono Medium TTF/OTF 字体文件。' }
  New-Item -ItemType Directory -Path $FontDirectory -Force | Out-Null
  $regPath = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
  New-Item -Path $regPath -Force | Out-Null
  $installed = @()
  foreach ($font in $fonts) {
    $target = Join-Path $FontDirectory $font.Name
    Copy-Item -LiteralPath $font.FullName -Destination $target -Force
    $valueName = $font.BaseName + ' (TrueType)'
    New-ItemProperty -Path $regPath -Name $valueName -Value $target -PropertyType String -Force | Out-Null
    $installed += $target
  }
  $installed | ForEach-Object { Write-Output $_ }
} finally {
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue }
}`;
}

function extractZip(zipPath, destination) {
  if (process.platform === 'win32') {
    const tempScript = path.join(path.dirname(zipPath), 'install-font.ps1');
    fs.writeFileSync(tempScript, powershellInstallerScript(), 'utf8');
    const fontDir = fontDirectories()[0];
    const powershell = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tempScript, zipPath, fontDir], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    fs.rmSync(tempScript, { force: true });
    if (result.error) throw new Error(`Windows 字体安装器启动失败：${result.error.message}`);
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Windows 字体安装失败').trim());
    return (result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => /Jet.?Brains.?Maple.?Mono/i.test(line));
  }

  const unzip = spawnSync('unzip', ['-q', zipPath, '-d', destination], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (unzip.error || unzip.status !== 0) {
    const detail = unzip.error ? unzip.error.message : (unzip.stderr || `退出码 ${unzip.status}`);
    throw new Error(`无法解压字体 ZIP。请确认系统安装了 unzip。${detail ? ` ${detail.trim()}` : ''}`);
  }
  const fonts = selectMediumFonts(walkFiles(destination));
  const fontDir = fontDirectories()[0];
  fs.mkdirSync(fontDir, { recursive: true, mode: 0o755 });
  const copied = [];
  for (const font of fonts) {
    const target = path.join(fontDir, path.basename(font));
    fs.copyFileSync(font, target);
    copied.push(target);
  }
  if (process.platform === 'linux' && spawnSync('fc-cache', ['-f', fontDir], { encoding: 'utf8' }).status !== 0) {
    console.warn('提示：字体已复制，但 fc-cache 不可用或刷新失败；可手动运行 fc-cache -f。');
  }
  return copied;
}

function confirmDownload(asset, yes) {
  if (yes) return Promise.resolve(true);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error('字体压缩包较大。非交互环境请显式添加 --yes，或设置 ERI_FONT_ARCHIVE_URL 指向你选择的 HTTPS ZIP 直链。'));
  }
  const readline = require('readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const size = asset.size ? `${(asset.size / (1024 * 1024)).toFixed(1)} MiB` : '大小未知';
  return rl.question(`将下载 JetBrains Maple Mono 字体包（${size}，来源：${asset.source === 'custom' ? '自定义 HTTPS URL' : '官方 GitHub Release'}）。继续？[y/N] `)
    .then((answer) => ['y', 'yes'].includes(answer.trim().toLowerCase()))
    .finally(() => rl.close());
}

async function installAndApplyFont(options = {}) {
  const asset = await resolveFontArchive(options.archiveUrl);
  const allowed = await confirmDownload(asset, Boolean(options.yes));
  if (!allowed) return { installed: false, cancelled: true, message: '已取消字体安装。' };
  if (!asset.browser_download_url) throw new Error('字体源没有可用的下载 URL。');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-maple-font-'));
  const archive = path.join(tempDir, 'jetbrains-maple-mono.zip');
  try {
    console.log(`==> 字体源：${asset.source === 'custom' ? asset.browser_download_url : (asset.page || REPOSITORY)}`);
    if (asset.size) console.log(`==> 字体压缩包：${(asset.size / (1024 * 1024)).toFixed(1)} MiB`);
    console.log('==> 正在下载字体包…');
    const downloaded = await downloadFile(asset.browser_download_url, archive);
    console.log(`==> 下载完成：${(downloaded.bytes / (1024 * 1024)).toFixed(1)} MiB`);
    const installedFiles = extractZip(archive, path.join(tempDir, 'extracted'));
    let apply;
    try { apply = applyTerminalFont(); }
    catch (error) {
      apply = { applied: false, results: [], message: `字体已安装，但自动修改终端配置失败：${error.message}。请使用 eri-ai-debug font apply 重试或手动设置字体。` };
    }
    return {
      installed: installedFiles.length > 0 || getFontStatus().installed,
      installedFiles,
      apply,
      message: `${installedFiles.length || 1} 个 Medium 字体文件已安装。${apply.message}`,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function showFontGuide(config = {}) {
  const family = config.fontFamily || DEFAULT_TUI_FONT;
  const weight = config.fontWeight || DEFAULT_TUI_FONT_WEIGHT;
  const status = getFontStatus();
  console.log([
    'Eri 字体安装与应用',
    `目标字体：${family} · ${weight}`,
    `字体目录/说明页：${DEFAULT_TUI_FONT_SOURCE}`,
    `已安装：${status.installed ? `是（${status.path}）` : '未检测到 Medium 字体文件'}`,
    '',
    '自动安装与终端配置：',
    '  eri-ai-debug font install       下载并安装 Medium 字体，然后应用到已识别的终端配置',
    '  eri-ai-debug font install --yes 非交互/跳过大文件确认',
    '  eri-ai-debug font apply         只修改已识别终端的字体配置',
    '  eri-ai-debug font status        查看字体文件状态',
    '',
    `默认下载使用上游 release：${REPOSITORY}/releases/latest`,
    '你指定的 fonts.107211.xyz 是字体浏览入口；如果该站提供 ZIP 直链，可使用：',
    '  ERI_FONT_ARCHIVE_URL=https://你的字体ZIP直链 eri-ai-debug font install',
    '',
    '可自动修改 Windows Terminal 的默认字体，并在 WT_PROFILE_ID 可用时修改当前 profile；VS Code 集成终端会设置 fontFamily 与 500 字重；',
    'Linux 会安装到 ~/.local/share/fonts 并刷新 fontconfig，检测到 kitty 配置时也会更新 kitty.conf。',
    '其他终端需在其外观设置中选择 JetBrains Maple Mono，并将字重设为 Medium。',
    '安装后完全关闭并重开终端；现有 profile 自己覆盖字体时，请在该 profile 中指定字体。',
  ].join('\n'));
}

module.exports = {
  RELEASE_API, REPOSITORY, chooseReleaseAsset, resolveFontArchive, selectMediumFonts,
  fontDirectories, getFontStatus, writeJsoncWithEdits, windowsTerminalSettingsPaths,
  vscodeSettingsPaths, applyKittyConfig, windowsTerminalFontEdits, applyTerminalFont, installAndApplyFont,
  showFontGuide, isSafeHttpsUrl,
};
