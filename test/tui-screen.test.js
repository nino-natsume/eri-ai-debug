'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenRenderer, visibleWidth } = require('../lib/tui');

function makeOutput({ columns = 40, rows = 12 } = {}) {
  const writes = [];
  return {
    isTTY: true,
    columns,
    rows,
    writes,
    write(value) {
      writes.push(String(value));
      return true;
    },
  };
}

test('screen renderer uses alternate screen once for nested menus', () => {
  const output = makeOutput();
  const screen = createScreenRenderer(output);

  assert.equal(screen.begin(), true);
  assert.equal(screen.begin(), true);
  const joined = output.writes.join('');
  assert.equal((joined.match(/\x1b\[\?1049h/g) || []).length, 1);
  assert.equal((joined.match(/\x1b\[2J/g) || []).length, 1);
  assert.equal(screen.depth(), 2);

  screen.end();
  assert.doesNotMatch(output.writes.join(''), /\x1b\[\?1049l/);
  screen.end();
  assert.match(output.writes.join(''), /\x1b\[\?1049l/);
  assert.match(output.writes.join(''), /\x1b\[\?25h/);
});

test('moving selection rewrites only changed rows and never emits line feeds or clears the page', () => {
  const output = makeOutput();
  const screen = createScreenRenderer(output);
  screen.begin();
  output.writes.length = 0;

  screen.draw(['Eri', '› 01  Start', '  02  Tools', 'footer']);
  const initial = output.writes.join('');
  assert.doesNotMatch(initial, /\n/);
  assert.doesNotMatch(initial, /\x1b\[2J/);
  assert.match(initial, /\x1b\[2;1H\x1b\[2K/);
  assert.match(initial, /\x1b\[3;1H\x1b\[2K/);

  output.writes.length = 0;
  screen.draw(['Eri', '  01  Start', '› 02  Tools', 'footer']);
  const move = output.writes.join('');
  assert.doesNotMatch(move, /\n/, 'redraw must not write newline characters');
  assert.doesNotMatch(move, /\x1b\[2J/, 'navigation must not clear the full page');
  assert.doesNotMatch(move, /\x1b\[1;1H\x1b\[2K/, 'unchanged title row must not be rewritten');
  assert.match(move, /\x1b\[2;1H\x1b\[2K/);
  assert.match(move, /\x1b\[3;1H\x1b\[2K/);
  assert.doesNotMatch(move, /\x1b\[4;1H\x1b\[2K/, 'unchanged footer row must not be rewritten');
  screen.end();
});

test('renderer avoids terminal delayed-wrap by leaving the final column unused', () => {
  const output = makeOutput({ columns: 12, rows: 5 });
  const screen = createScreenRenderer(output);
  screen.begin();
  output.writes.length = 0;
  screen.draw(['abcdefghijklmnop']);
  const update = output.writes.join('');
  const rowText = update.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  assert.ok(visibleWidth(rowText) <= 11);
  assert.doesNotMatch(update, /\n/);
  screen.end();
});

test('shrinking a view clears stale rows in place without scrolling', () => {
  const output = makeOutput();
  const screen = createScreenRenderer(output);
  screen.begin();
  screen.draw(['one', 'two', 'three']);
  output.writes.length = 0;
  screen.draw(['one']);
  const update = output.writes.join('');
  assert.match(update, /\x1b\[2;1H\x1b\[2K/);
  assert.match(update, /\x1b\[3;1H\x1b\[2K/);
  assert.doesNotMatch(update, /\n/);
  assert.doesNotMatch(update, /\x1b\[2J/);
  screen.end();
});

test('readline prompts temporarily show the cursor at the bottom and invalidate stale rows', () => {
  const output = makeOutput({ columns: 40, rows: 12 });
  const screen = createScreenRenderer(output);
  screen.begin();
  screen.draw(['menu row one', 'menu row two']);
  output.writes.length = 0;

  assert.equal(screen.beginPrompt(), true);
  const promptStart = output.writes.join('');
  assert.match(promptStart, /\x1b\[12;1H\x1b\[2K\x1b\[\?25h/);
  output.writes.length = 0;
  screen.endPrompt();
  assert.match(output.writes.join(''), /\x1b\[\?25l/);

  output.writes.length = 0;
  screen.draw(['menu row one', 'menu row two']);
  const refreshed = output.writes.join('');
  assert.match(refreshed, /\x1b\[1;1H\x1b\[2K/);
  assert.match(refreshed, /\x1b\[2;1H\x1b\[2K/);
  assert.doesNotMatch(refreshed, /\n/);
  assert.doesNotMatch(refreshed, /\x1b\[2J/);
  screen.end();
});
