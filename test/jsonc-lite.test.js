'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, modify, applyEdits } = require('../lib/jsonc-lite');

test('JSONC set only edits the root property and preserves comments', () => {
  const input = `{
  // keep this comment
  "default_agent": "build",
  "nested": { "default_agent": "keep" },
}`;
  const output = applyEdits(input, modify(input, ['default_agent'], 'eri'));
  assert.deepEqual(parse(output, []), { default_agent: 'eri', nested: { default_agent: 'keep' } });
  assert.match(output, /keep this comment/);
  assert.match(output, /"default_agent": "eri"/);
  assert.match(output, /"nested": \{ "default_agent": "keep" \}/);
});

test('JSONC adds a missing root key with valid commas', () => {
  const input = '{\n  "model": "opencode/model"\n}\n';
  const output = applyEdits(input, modify(input, ['default_agent'], 'eri'));
  assert.deepEqual(parse(output, []), { model: 'opencode/model', default_agent: 'eri' });
  assert.match(output, /"model": "opencode\/model",\n/);
});

test('JSONC removal leaves a valid object and does not alter nested keys', () => {
  const input = '{\n  "default_agent": "eri",\n  "other": {"default_agent":"user"}\n}\n';
  const output = applyEdits(input, modify(input, ['default_agent'], undefined));
  assert.deepEqual(parse(output, []), { other: { default_agent: 'user' } });
});

test('invalid JSONC is reported rather than silently replaced', () => {
  const errors = [];
  parse('{ "model": ', errors);
  assert.ok(errors.length > 0);
});


test('JSONC can safely add nested object paths while preserving comments and existing settings', () => {
  let input = `{
  // keep user settings
  "profiles": {
    "defaults": {
      "startingDirectory": "C:/work",
    },
  },
}`;
  input = applyEdits(input, modify(input, ['profiles', 'defaults', 'font', 'face'], 'JetBrains Maple Mono'));
  input = applyEdits(input, modify(input, ['profiles', 'defaults', 'font', 'weight'], 'medium'));
  const errors = [];
  const parsed = parse(input, errors);
  assert.deepEqual(errors, []);
  assert.equal(parsed.profiles.defaults.startingDirectory, 'C:/work');
  assert.equal(parsed.profiles.defaults.font.face, 'JetBrains Maple Mono');
  assert.equal(parsed.profiles.defaults.font.weight, 'medium');
  assert.match(input, /keep user settings/);
});

test('JSONC nested edit refuses to replace an existing scalar parent', () => {
  const input = '{"profiles": "not-an-object"}';
  assert.throws(() => modify(input, ['profiles', 'defaults', 'font', 'face'], 'JetBrains Maple Mono'), /不是对象/);
});


test('JSONC can edit nested properties inside a selected array object', () => {
  let input = `{
  // Windows Terminal profiles
  "profiles": {
    "list": [
      {"guid": "{a}", "name": "first"},
      {"guid": "{b}", "name": "second"}
    ]
  }
}`;
  input = applyEdits(input, modify(input, ['profiles', 'list', 1, 'font', 'face'], 'JetBrains Maple Mono'));
  input = applyEdits(input, modify(input, ['profiles', 'list', 1, 'font', 'weight'], 'medium'));
  const errors = [];
  const parsed = parse(input, errors);
  assert.deepEqual(errors, []);
  assert.equal(parsed.profiles.list[0].name, 'first');
  assert.equal(parsed.profiles.list[1].name, 'second');
  assert.equal(parsed.profiles.list[1].font.face, 'JetBrains Maple Mono');
  assert.equal(parsed.profiles.list[1].font.weight, 'medium');
  assert.match(input, /Windows Terminal profiles/);
});
