'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { createRing, RING_SIZE } = require('../ui/ring');

test('ring applies backpressure and delivers every frame plus the final result', { timeout: 15000 }, async () => {
  const sab = new SharedArrayBuffer(RING_SIZE);
  const ring = createRing(sab);
  const total = 1500;
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { createRing } = require(${JSON.stringify(require.resolve('../ui/ring'))});
    const ring = createRing(workerData.sab);
    for (let i = 0; i < workerData.total; i++) {
      ring.write({ sid: 'test', t: 'ev', ev: { t: 'out', d: String(i).padStart(4, '0') + 'x'.repeat(1200) } });
    }
    ring.write({ sid: 'test', t: 'result', status: 200, body: { done: true } });
    parentPort.postMessage('written');
  `;

  const worker = new Worker(workerSource, { eval: true, workerData: { sab, total } });
  const messages = [];
  let resolveWritten;
  let rejectWritten;
  const written = new Promise((resolve, reject) => {
    resolveWritten = resolve;
    rejectWritten = reject;
  });
  worker.once('message', resolveWritten);
  worker.once('error', rejectWritten);

  try {
    const deadline = Date.now() + 12000;
    let resultSeen = false;
    while (!resultSeen && Date.now() < deadline) {
      messages.push(...ring.drain());
      resultSeen = messages.some((m) => m.t === 'result' && m.body && m.body.done);
      if (!resultSeen) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(resultSeen, true, 'final result should be delivered without requiring another write');
    await written;
    const frames = messages.filter((m) => m.t === 'ev');
    assert.equal(frames.length, total);
    assert.equal(messages[messages.length - 1].t, 'result');
  } finally {
    await worker.terminate();
  }
});
