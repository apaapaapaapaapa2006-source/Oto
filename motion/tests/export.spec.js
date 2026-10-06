// 書き出しのテスト
//  - export-chrome（H.264 エンコーダのある Chrome）：3秒・1080p の MP4 を書き出し、
//    最初・中間・最後のフレームを ffmpeg で取り出して、同じ時刻の renderFrame と比較する
//  - desktop-chromium（Playwright 付属の Chromium は H.264 非対応）：MediaRecorder へのフォールバック
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { fixture, openApp, project } = require('./helpers');

const kf = (id, time, value, easing = 'linear') => ({ id, time, value, easing });
function exportFixture({ width = 1920, height = 1080, durationSec = 3 } = {}) {
  const base = (id, type, extra) => Object.assign({ id, type, name: id, visible: true, locked: false, start: 0, duration: durationSec, anchor: { x: 0.5, y: 0.5 }, x: width / 2, y: height / 2, scale: 1, rotation: 0, opacity: 1, keyframes: {} }, extra);
  return {
    format: 'motion-project', version: 1, id: 'p_export', name: 'export-test',
    settings: { durationSec, aspect: '16:9', width, height, fps: 30, background: '#182030' }, assets: [],
    scenes: [{ id: 's1', name: 'シーン 1', start: 0, duration: durationSec, layers: [
      base('bg', 'shape', { shape: 'rect', width: width * 0.8, height: height * 0.6, fill: '#2b3d63', fillEnabled: true, stroke: '#8fb0ff', strokeWidth: 8, cornerRadius: 40,
        keyframes: { rotation: [kf('r1', 0, -4, 'ease-in-out'), kf('r2', 3, 4)] } }),
      base('ball', 'shape', { shape: 'ellipse', width: 220, height: 220, fill: '#ff6a3d', fillEnabled: true, stroke: '#ffffff', strokeWidth: 0, cornerRadius: 0,
        keyframes: { x: [kf('x1', 0, 300, { type: 'spring', stiffness: 160, damping: 9, mass: 1 }), kf('x2', 2.5, 1600)], y: [kf('y1', 0, 300, 'ease-out'), kf('y2', 2.9, 800)] } }),
      base('title', 'text', { content: 'Motion 書き出しテスト', fontFamily: 'sans-serif', fontSize: 110, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0, align: 'center', color: '#ffffff',
        keyframes: { opacity: [kf('o1', 0, 0, 'ease-in'), kf('o2', 1, 1)], scale: [kf('sc1', 0, 0.6, 'ease-out'), kf('sc2', 1.2, 1)] } }),
      base('tri', 'shape', { shape: 'triangle', x: width * 0.82, y: height * 0.25, width: 200, height: 170, fill: '#ffc94d', fillEnabled: true, stroke: '#000000', strokeWidth: 0, cornerRadius: 0,
        keyframes: { rotation: [kf('t1', 0, 0), kf('t2', 3, 360)] } }),
      base('cur', 'cursor', { anchor: { x: 0, y: 0 }, style: 'arrow', size: 56, color: '#ffffff', outline: '#111111', clickColor: '#ffffff', smoothing: 0.6,
        points: [{ id: 'c1', x: 200, y: 900, time: 0 }, { id: 'c2', x: 1100, y: 500, time: 1.4 }, { id: 'c3', x: 1500, y: 850, time: 2.6 }], clicks: [{ id: 'k1', time: 1.5 }] }),
    ] }],
  };
}
const h264Supported = page => page.evaluate(async () => {
  if (typeof VideoEncoder === 'undefined') return false;
  try { return (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 8e6, framerate: 30, avc: { format: 'avc' } })).supported; } catch (e) { return false; }
});
function compare(rgba, rgb) {
  let sum = 0, sq = 0, max = 0;
  const n = rgb.length;
  for (let p = 0, q = 0; q < n; p += 4, q += 3) for (let c = 0; c < 3; c++) {
    const d = Math.abs(rgba[p + c] - rgb[q + c]);
    sum += d; sq += d * d; if (d > max) max = d;
  }
  return { mae: sum / n, psnr: 10 * Math.log10(255 * 255 / Math.max(1e-9, sq / n)), max };
}
const ffprobe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
  '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames,pix_fmt:format=duration,format_name', '-of', 'json', file]).toString());
const frameRGB = (file, i) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${i})`, '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });

test('MP4（H.264）書き出し：3秒・1080p の最初・中間・最後のフレームが renderFrame と一致', async ({ page }, testInfo) => {
  await openApp(page);
  test.skip(!(await h264Supported(page)), 'このブラウザには H.264 エンコーダがありません（CHROME_PATH で Chrome を指定してください）');
  await page.evaluate(p => window.__motion.loadProject(p), exportFixture());
  // 画像素材を読み込んでレイヤーとして配置（1フレーム目の前に画像デコードを待つことの確認を兼ねる）
  await page.evaluate(() => { document.querySelector('#fileAssets')._addLayers = true; });
  await page.setInputFiles('#fileAssets', fixture('test-image.png'));
  await expect.poll(async () => (await project(page)).scenes[0].layers.length).toBe(6);
  await page.evaluate(() => {
    // 画像を大きくして目立つ位置へ（比較で画像の有無が確実に効くように）
    const P = window.__motion.project(); const L = P.scenes[0].layers[5];
    Object.assign(L, { x: 1500, y: 250, width: 480, height: 360 }); return window.__motion.loadProject(P);
  });

  await page.locator('#btnExport').click();
  await expect(page.getByTestId('export-method')).toHaveAttribute('data-method', 've');
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-progress')).toBeVisible();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 170_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  const out = testInfo.outputPath('export.mp4');
  await dl.saveAs(out);
  expect(dl.suggestedFilename()).toBe('export-test.mp4');

  const probe = ffprobe(out);
  expect(probe.streams[0]).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', nb_read_frames: '90' });
  expect(Math.abs(parseFloat(probe.format.duration) - 3)).toBeLessThan(0.05);

  const results = [];
  for (const i of [0, 45, 89]) {
    const rgb = frameRGB(out, i);
    expect(rgb.length).toBe(1920 * 1080 * 3);
    const ref = await page.evaluate(t => window.__motion.renderPixels(t), i / 30);
    const r = compare(Buffer.from(ref.data, 'base64'), rgb);
    results.push({ frame: i, ...r });
    expect(r.mae).toBeLessThan(2.5);
    expect(r.psnr).toBeGreaterThan(32);
  }
  // 比較の感度確認：違う時刻の renderFrame とは明確にずれる
  const wrong = await page.evaluate(t => window.__motion.renderPixels(t), 1.0);
  const w = compare(Buffer.from(wrong.data, 'base64'), frameRGB(out, 45));
  results.push({ frame: '45 vs t=1.0（不一致のはず）', ...w });
  expect(w.mae).toBeGreaterThan(results[1].mae * 2);
  console.log(JSON.stringify(results, null, 1));
  await testInfo.attach('frame-compare.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
});

test('書き出しのキャンセル', async ({ page }) => {
  await openApp(page);
  await page.evaluate(p => window.__motion.loadProject(p), exportFixture({ durationSec: 20 }));
  await page.locator('#btnExport').click();
  await expect(page.getByTestId('export-start')).toBeEnabled();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-progress')).toContainText('フレーム');
  await page.getByTestId('export-cancel').click();
  await expect(page.getByTestId('export-cancelled')).toBeVisible({ timeout: 30_000 });
  expect((await page.evaluate(() => window.__motion.state())).exporting).toBe(false);
});

test('H.264 の VideoEncoder が無い場合は MediaRecorder（実時間録画）にフォールバックし、コマ落ちの可能性を表示', async ({ page }, testInfo) => {
  await openApp(page);
  test.skip(await h264Supported(page), 'H.264 に対応したブラウザなのでフォールバックは使われません');
  await page.evaluate(p => window.__motion.loadProject(p), exportFixture({ width: 640, height: 360, durationSec: 2 }));
  await page.locator('#btnExport').click();
  const m = page.getByTestId('export-method');
  await expect(m).toHaveAttribute('data-method', 'mr');
  await expect(m).toContainText('コマ落ちの可能性あり');
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  const out = testInfo.outputPath(dl.suggestedFilename());
  await dl.saveAs(out);
  const probe = ffprobe(out);
  expect(probe.streams[0].width).toBe(640);
  expect(probe.streams[0].height).toBe(360);
  expect(Number(probe.streams[0].nb_read_frames)).toBeGreaterThan(10);
});
