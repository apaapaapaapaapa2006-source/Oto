// タッチ操作のヘルパー。
// Chromium では CDP の Input.dispatchTouchEvent で本物のタッチ入力を送る。
// WebKit では CDP が無いため、touch 種別の PointerEvent を合成して送る（アプリは Pointer Events で実装）。
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = name => path.join(FIXTURES, name);
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function lerpPath(from, to, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps });
  return pts;
}

/** 複数の指の軌跡（各指は同じ点数）でタッチ操作する */
async function touchPaths(page, browserName, paths, { stepDelay = 16 } = {}) {
  const n = paths[0].length;
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const pts = i => paths.map((p, k) => ({ x: p[i].x, y: p[i].y, id: k + 1, radiusX: 4, radiusY: 4, force: 1 }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
    for (let i = 1; i < n; i++) {
      await page.waitForTimeout(stepDelay);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i) });
    }
    await page.waitForTimeout(stepDelay);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.evaluate(async ({ paths, stepDelay }) => {
      const n = paths[0].length, targets = [];
      const fire = (el, type, k, p) => el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 100 + k, pointerType: 'touch', isPrimary: k === 0,
        clientX: p.x, clientY: p.y, button: 0, buttons: type === 'pointerup' ? 0 : 1, width: 8, height: 8, pressure: type === 'pointerup' ? 0 : 0.5 }));
      const wait = () => new Promise(r => setTimeout(r, stepDelay));
      paths.forEach((p, k) => { const el = document.elementFromPoint(p[0].x, p[0].y); targets[k] = el; fire(el, 'pointerdown', k, p[0]); });
      for (let i = 1; i < n; i++) { await wait(); paths.forEach((p, k) => fire(targets[k], 'pointermove', k, p[i])); }
      await wait();
      paths.forEach((p, k) => fire(targets[k], 'pointerup', k, p[n - 1]));
    }, { paths, stepDelay });
  }
  await page.waitForTimeout(50);
}

const touchDrag = (page, browserName, from, to, steps = 12) => touchPaths(page, browserName, [lerpPath(from, to, steps)]);

/** 2本指ピンチ/ひねり：中心 c、距離 d0→d1、角度 a0→a1（度） */
function pinchPaths(c, d0, d1, a0 = 0, a1 = 0, steps = 14) {
  const f1 = [], f2 = [];
  for (let i = 0; i <= steps; i++) {
    const d = d0 + (d1 - d0) * i / steps, a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
    const dx = Math.cos(a) * d / 2, dy = Math.sin(a) * d / 2;
    f1.push({ x: c.x - dx, y: c.y - dy }); f2.push({ x: c.x + dx, y: c.y + dy });
  }
  return [f1, f2];
}
const pinch = (page, browserName, c, d0, d1, a0, a1, steps) => touchPaths(page, browserName, pinchPaths(c, d0, d1, a0, a1, steps));

async function openApp(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await page.evaluate(() => window.__motion.idle());
}
const project = page => page.evaluate(() => window.__motion.project());
const state = page => page.evaluate(() => window.__motion.state());
async function waitSaved(page) {
  await page.waitForFunction(() => document.querySelector('#saveStatus').dataset.state === 'saved', null, { timeout: 15000 });
}
/** ボトムシートの開閉アニメーションが終わるまで待つ */
async function waitSheetSettled(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#sheet'), r = el.getBoundingClientRect();
    const open = el.classList.contains('open');
    return open ? getComputedStyle(el).transform === 'none' || getComputedStyle(el).transform === 'matrix(1, 0, 0, 1, 0, 0)' : r.top >= innerHeight - 1;
  });
}
async function centerOf(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

module.exports = { fixture, sha256File, touchPaths, touchDrag, pinch, openApp, project, state, waitSaved, centerOf, lerpPath, waitSheetSettled };
