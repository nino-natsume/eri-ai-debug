'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  chooseReleaseAsset, resolveFontArchive, selectMediumFonts, isSafeHttpsUrl, writeJsoncWithEdits,
  windowsTerminalSettingsPaths, vscodeSettingsPaths, windowsTerminalFontEdits, applyKittyConfig,
} = require('../lib/font');
const { parse } = require('../lib/jsonc-lite');

test('font release picker prefers a non-Nerd-Font static archive and refuses unsafe URLs', () => {
  const assets = [
    { name: 'JetBrainsMapleMono-NF-XX-XX-XX.zip', browser_download_url: 'https://example.test/nf.zip', size: 9 },
    { name: 'JetBrainsMapleMono-XX-XX-NL-HT.zip', browser_download_url: 'https://example.test/medium.zip', size: 100 },
  ];
  assert.equal(chooseReleaseAsset(assets).name, 'JetBrainsMapleMono-XX-XX-NL-HT.zip');
  assert.equal(isSafeHttpsUrl('https://example.test/font.zip'), true);
  assert.equal(isSafeHttpsUrl('http://example.test/font.zip'), false);
  assert.throws(() => chooseReleaseAsset([{ name: 'font.zip', browser_download_url: 'file:///tmp/font.zip' }]), /未找到安全/);
});

test('font selector only chooses JetBrains Maple Mono Medium files', () => {
  const fonts = [
    '/tmp/JetBrainsMapleMono-Regular.ttf',
    '/tmp/JetBrainsMapleMono-Medium.ttf',
    '/tmp/JetBrainsMapleMono-MediumItalic.ttf',
    '/tmp/Other-Medium.ttf',
  ];
  assert.deepEqual(selectMediumFonts(fonts), ['/tmp/JetBrainsMapleMono-Medium.ttf']);
  assert.throws(() => selectMediumFonts(['/tmp/JetBrainsMono-Medium.ttf']), /没有找到/);
});

test('font apply preserves JSONC comments and backs up terminal settings before writing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-font-test-'));
  const file = path.join(dir, 'settings.json');
  try {
    const original = `{
  // user's existing Windows Terminal settings
  "profiles": { "defaults": { "startingDirectory": "C:/work" } }
}\n`;
    fs.writeFileSync(file, original, 'utf8');
    const result = writeJsoncWithEdits(file, [
      [['profiles', 'defaults', 'font', 'face'], 'JetBrains Maple Mono'],
      [['profiles', 'defaults', 'font', 'weight'], 'medium'],
    ]);
    assert.equal(result.changed, true);
    assert.ok(result.backup && fs.existsSync(result.backup));
    const errors = [];
    const parsed = parse(fs.readFileSync(file, 'utf8'), errors);
    assert.deepEqual(errors, []);
    assert.equal(parsed.profiles.defaults.font.face, 'JetBrains Maple Mono');
    assert.equal(parsed.profiles.defaults.font.weight, 'medium');
    assert.equal(parsed.profiles.defaults.startingDirectory, 'C:/work');
    assert.match(fs.readFileSync(file, 'utf8'), /existing Windows Terminal settings/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('font configuration helpers resolve expected Windows and VS Code settings paths', () => {
  const win = windowsTerminalSettingsPaths({ LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' }, 'C:\\Users\\tester');
  assert.ok(win[0].includes('Microsoft.WindowsTerminal_8wekyb3d8bbwe'));
  const vscode = vscodeSettingsPaths('win32', { APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' }, 'C:\\Users\\tester');
  assert.ok(vscode[0].endsWith(path.join('Code', 'User', 'settings.json')));
});


test('Windows Terminal applies the font to defaults and the active profile when WT_PROFILE_ID is known', () => {
  const input = `{
  // Keep existing profile data
  "profiles": {
    "defaults": { "font": { "size": 12 } },
    "list": [
      {"guid":"{11111111-1111-1111-1111-111111111111}","name":"PowerShell"},
      {"guid":"{22222222-2222-2222-2222-222222222222}","name":"Command Prompt"}
    ]
  }
}`;
  const edits = windowsTerminalFontEdits(input, '{22222222-2222-2222-2222-222222222222}');
  assert.equal(edits.length, 4);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-wt-profile-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, input, 'utf8');
  let output;
  try {
    const result = writeJsoncWithEdits(file, edits);
    assert.equal(result.changed, true);
    assert.ok(result.backup && fs.existsSync(result.backup));
    output = fs.readFileSync(file, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const errors = [];
  const parsed = parse(output, errors);
  assert.deepEqual(errors, []);
  assert.equal(parsed.profiles.defaults.font.face, 'JetBrains Maple Mono');
  assert.equal(parsed.profiles.defaults.font.weight, 'medium');
  assert.equal(parsed.profiles.list[0].font, undefined);
  assert.equal(parsed.profiles.list[1].font.face, 'JetBrains Maple Mono');
  assert.equal(parsed.profiles.list[1].font.weight, 'medium');
  assert.match(output, /Keep existing profile data/);
});

test('kitty font block is applied idempotently and preserves existing settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-kitty-font-'));
  const file = path.join(dir, 'kitty.conf');
  try {
    fs.writeFileSync(file, 'font_family monospace\nfont_size 12.0\n');
    const first = applyKittyConfig(file);
    assert.equal(first.changed, true);
    assert.ok(fs.existsSync(first.backup));
    let text = fs.readFileSync(file, 'utf8');
    assert.match(text, /font_family monospace/);
    assert.match(text, /font_family JetBrains Maple Mono Medium/);
    const second = applyKittyConfig(file);
    assert.equal(second.changed, false);
    text = fs.readFileSync(file, 'utf8');
    assert.equal((text.match(/BEGIN eri-ai-debug managed font/g) || []).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('VS Code font settings apply the requested family with Medium-equivalent weight 500', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eri-vscode-font-'));
  const file = path.join(dir, 'settings.json');
  try {
    const input = `{
  // Keep editor options
  "editor.fontSize": 14,
  "terminal.integrated.fontFamily": "monospace"
}`;
    fs.writeFileSync(file, input, 'utf8');
    const result = writeJsoncWithEdits(file, [
      [['terminal.integrated.fontFamily'], "'JetBrains Maple Mono'"],
      [['terminal.integrated.fontWeight'], 500],
    ]);
    assert.equal(result.changed, true);
    const errors = [];
    const parsed = parse(fs.readFileSync(file, 'utf8'), errors);
    assert.deepEqual(errors, []);
    assert.equal(parsed['terminal.integrated.fontFamily'], "'JetBrains Maple Mono'");
    assert.equal(parsed['terminal.integrated.fontWeight'], 500);
    assert.equal(parsed['editor.fontSize'], 14);
    assert.match(fs.readFileSync(file, 'utf8'), /Keep editor options/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('custom font source must be a direct HTTPS ZIP, not a catalogue page or a WOFF/TTF URL', async () => {
  const asset = await resolveFontArchive('https://fonts.example.test/JetBrainsMapleMono.zip?token=sample');
  assert.equal(asset.name, 'JetBrainsMapleMono.zip');
  assert.equal(asset.source, 'custom');
  await assert.rejects(resolveFontArchive('http://fonts.example.test/font.zip'), /HTTPS/);
  await assert.rejects(resolveFontArchive('https://fonts.107211.xyz/'), /必须指向 \.zip 文件/);
  await assert.rejects(resolveFontArchive('https://fonts.example.test/font.woff2'), /必须指向 \.zip 文件/);
});
