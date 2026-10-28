'use strict';
// 无端口面板：Worker → 主线程的单向消息环形队列（基于 SharedArrayBuffer）。
// 主线程在 webview_run() 期间通过 bind 回调轮询；队列满时由 Worker 做背压等待，
// 避免旧实现把溢出消息缓存在 Worker 私有数组中而导致无界内存增长或最终结果滞留。

const { isMainThread } = require('worker_threads');
const CAP = 1 << 20;
const HEADER = 8;
const RING_SIZE = HEADER + CAP;
const u32 = (n) => n >>> 0;

function createRing(sab) {
  if (!(sab instanceof SharedArrayBuffer) || sab.byteLength < RING_SIZE) {
    throw new TypeError(`SharedArrayBuffer 至少需要 ${RING_SIZE} 字节`);
  }

  const header = new Int32Array(sab, 0, 2); // [tail, head]
  const data = new Uint8Array(sab, HEADER, CAP);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function putBytes(pos, buf) {
    const start = pos % CAP;
    const first = Math.min(buf.length, CAP - start);
    data.set(buf.subarray(0, first), start);
    if (first < buf.length) data.set(buf.subarray(first), 0);
  }

  function getBytes(pos, len) {
    const start = pos % CAP;
    const first = Math.min(len, CAP - start);
    if (first === len) return data.slice(start, start + len);
    const out = new Uint8Array(len);
    out.set(data.subarray(start, start + first), 0);
    out.set(data.subarray(0, len - first), first);
    return out;
  }

  function putLen(pos, n) {
    const bytes = new Uint8Array(4);
    bytes[0] = n & 255;
    bytes[1] = (n >>> 8) & 255;
    bytes[2] = (n >>> 16) & 255;
    bytes[3] = (n >>> 24) & 255;
    putBytes(pos, bytes);
  }

  function getLen(pos) {
    const b = getBytes(pos, 4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  }

  function writeDirect(pos, bytes) {
    putLen(pos, bytes.length);
    putBytes(pos + 4, bytes);
  }

  return {
    // 本队列是单生产者（Worker）/单消费者（主线程）模型。
    // 生产者在队列满时等待消费者推进 head；不在 Worker 本地无限排队。
    write(obj) {
      let bytes;
      try { bytes = enc.encode(JSON.stringify(obj)); } catch { return false; }
      const need = 4 + bytes.length;
      if (need > CAP) return false;

      if (isMainThread) {
        // 当前架构只允许 Worker 写入。避免主线程误用时发生同步死锁。
        const tail = Atomics.load(header, 0) >>> 0;
        const head = Atomics.load(header, 1) >>> 0;
        if (u32(tail - head) + need > CAP) return false;
        writeDirect(tail, bytes);
        Atomics.store(header, 0, (tail + need) | 0);
        return true;
      }

      for (;;) {
        const tail = Atomics.load(header, 0) >>> 0;
        const headRaw = Atomics.load(header, 1);
        const head = headRaw >>> 0;
        if (u32(tail - head) + need <= CAP) {
          writeDirect(tail, bytes);
          // 发布 tail 前，先确保消息内容已写入共享区。
          Atomics.store(header, 0, (tail + need) | 0);
          return true;
        }

        // 如果 head 在检查后已经变化，Atomics.wait 会立刻返回；否则最多等待 100ms
        // 再重新检查。Worker 线程可等待，主线程仍能通过窗口回调 drain 队列。
        try { Atomics.wait(header, 1, headRaw, 100); }
        catch { return false; }
      }
    },

    drain() {
      const out = [];
      let headRaw = Atomics.load(header, 1);
      let head = headRaw >>> 0;
      const tail = Atomics.load(header, 0) >>> 0;

      while (u32(tail - head) >= 4) {
        const len = getLen(head);
        if (len > CAP - 4) {
          // 队列头损坏时丢弃当前批次，避免越界读取。
          head = tail;
          break;
        }
        if (u32(tail - head) < 4 + len) break;
        const bytes = getBytes(head + 4, len);
        head = u32(head + 4 + len);
        try { out.push(JSON.parse(dec.decode(bytes))); } catch { /* skip malformed frame */ }
      }

      if (head !== headRaw >>> 0) {
        Atomics.store(header, 1, head | 0);
        Atomics.notify(header, 1);
      }
      return out;
    },
  };
}

module.exports = { createRing, RING_SIZE };
