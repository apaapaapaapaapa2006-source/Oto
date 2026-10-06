// iPhone 端末エミュレーション（WebKit / Chromium）でのエディタ操作テスト
const { test, expect } = require('@playwright/test');
const { fixture, sha256File, touchDrag, pinch, openApp, project, state, waitSaved, centerOf, waitSheetSettled } = require('./helpers');

const evalX = (page, layerId, t) => page.evaluate(({ layerId, t }) => {
  const P = window.__motion.project();
  const L = P.scenes[0].layers.find(l => l.id === layerId);
  return window.__motion.evalProp(L, 'x', t - L.start);
}, { layerId, t });

test('新規 → 画像読込 → キーフレーム → ◆を移動 → スクラブ → Undo/Redo → 再読み込みで復元', async ({ page, browserName }, testInfo) => {
  await openApp(page);

  // 1. 初回起動は空のプロジェクト
  let P = await project(page);
  expect(P.scenes).toHaveLength(1);
  expect(P.scenes[0].layers).toHaveLength(0);
  expect(P.assets).toHaveLength(0);
  expect((await state(page)).wide).toBe(false); // 縦画面レイアウト（ボトムシート）

  // 2. テスト画像を読み込む（ファイル選択ボタン）
  await page.getByTestId('tab-add').tap();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('add-image').tap()]);
  await chooser.setFiles(fixture('test-image.png'));
  await expect.poll(async () => (await project(page)).scenes[0].layers.length).toBe(1);
  P = await project(page);
  const L0 = P.scenes[0].layers[0], assetId = P.assets[0].id;
  expect(L0.type).toBe('image');
  expect(P.assets[0]).toMatchObject({ originalName: 'test-image.png', type: 'image/png', kind: 'image', hash: sha256File(fixture('test-image.png')) });
  await expect.poll(() => page.evaluate(id => window.__motion.assetInfo(id), assetId)).toEqual({ status: 'ready', naturalWidth: 160 });
  await expect(page.locator('#sheet')).toHaveClass(/open/); // プロパティのボトムシートが開く

  // 3. タップで選択（空き領域タップで解除 → レイヤーをタップで選択）
  const emptyPt = await page.evaluate(() => window.__motion.stagePointOf(60, 60));
  await page.touchscreen.tap(emptyPt.x, emptyPt.y);
  await expect.poll(async () => (await state(page)).sel.layerIds).toEqual([]);
  const lc = await page.evaluate(id => window.__motion.layerCenter(id), L0.id);
  await page.touchscreen.tap(lc.x, lc.y);
  await expect.poll(async () => (await state(page)).sel.layerIds).toEqual([L0.id]);

  // 4. t=0 で X と不透明度にキーフレーム（◆）
  await expect(page.getByTestId('kf-x')).toBeVisible();
  await page.getByTestId('kf-x').tap();
  await page.getByTestId('kf-opacity').tap();
  P = await project(page);
  expect(P.scenes[0].layers[0].keyframes.x.map(k => k.time)).toEqual([0]);
  expect(P.scenes[0].layers[0].keyframes.opacity.map(k => k.time)).toEqual([0]);

  // 5. ルーラーをタップして t≈2 秒へ移動し、値を変更（自動でキーフレームが打たれる）
  const ruler = page.getByTestId('tl-ruler');
  const rb = await ruler.boundingBox();
  const x2 = await page.evaluate(() => window.__motion.timeToClientX(2));
  await page.touchscreen.tap(x2, rb.y + rb.height / 2);
  const t2 = (await state(page)).time;
  expect(Math.abs(t2 - 2)).toBeLessThan(0.1);
  await page.getByTestId('prop-x').fill('1400');
  await page.getByTestId('prop-x').press('Enter');
  await page.getByTestId('prop-opacity').fill('30');
  await page.getByTestId('prop-opacity').press('Enter');
  P = await project(page);
  let L = P.scenes[0].layers[0];
  expect(L.keyframes.x.map(k => k.time)).toEqual([0, t2]);
  expect(L.keyframes.x.map(k => k.value)).toEqual([L0.x, 1400]);
  expect(L.keyframes.opacity.map(k => k.value)).toEqual([1, 0.3]);
  const kfX2 = L.keyframes.x[1].id;

  // 6. 2つ目の X キーフレーム◆を、タイムラインで時間方向（右へ約1秒）にドラッグ
  await page.getByTestId('tab-props').tap(); // シートを閉じてタイムラインを表示
  await expect(page.locator('#sheet')).not.toHaveClass(/open/);
  await waitSheetSettled(page);
  const dia = page.locator(`[data-testid=kf-diamond][data-id="${kfX2}"]`);
  await expect(dia).toBeVisible();
  const d0 = await centerOf(dia);
  const pps = (await state(page)).pps;
  const undoBefore = (await state(page)).undo;
  await touchDrag(page, browserName, d0, { x: d0.x + pps * 1.0, y: d0.y }, 16);
  P = await project(page);
  L = P.scenes[0].layers[0];
  const t3 = L.keyframes.x.find(k => k.id === kfX2).time;
  expect(Math.abs(t3 - (t2 + 1))).toBeLessThan(0.1);
  expect(L.keyframes.opacity.map(k => k.time)).toEqual([0, t2]); // 他のキーフレームは動かない
  expect((await state(page)).undo).toBe(undoBefore + 1); // 1回のドラッグ = 1履歴

  // 7. 中間（約1.5秒）へルーラー上をスクラブしてスクリーンショット
  const xa = await page.evaluate(() => window.__motion.timeToClientX(0.4));
  const xb = await page.evaluate(() => window.__motion.timeToClientX(1.5));
  await touchDrag(page, browserName, { x: xa, y: rb.y + rb.height / 2 }, { x: xb, y: rb.y + rb.height / 2 }, 12);
  const tm = (await state(page)).time;
  expect(Math.abs(tm - 1.5)).toBeLessThan(0.1);
  const expectMid = await page.evaluate(({ x0, t3, tm }) => x0 + (1400 - x0) * window.__motion.applyEasing('ease-in-out', tm / t3), { x0: L0.x, t3, tm });
  const xMid = await evalX(page, L0.id, tm);
  expect(xMid).toBeCloseTo(expectMid, 6);
  await page.evaluate(() => window.__motion.idle());
  await page.screenshot({ path: testInfo.outputPath('scrub-middle.png') });
  await testInfo.attach('scrub-middle', { path: testInfo.outputPath('scrub-middle.png'), contentType: 'image/png' });

  // 8. Undo：キーフレームの移動が取り消され、同じ時刻の値が元に戻る
  await page.locator('#btnUndo').tap();
  P = await project(page);
  expect(P.scenes[0].layers[0].keyframes.x.find(k => k.id === kfX2).time).toBe(t2);
  const xUndo = await evalX(page, L0.id, tm);
  const expectUndo = await page.evaluate(({ x0, t2, tm }) => x0 + (1400 - x0) * window.__motion.applyEasing('ease-in-out', tm / t2), { x0: L0.x, t2, tm });
  expect(xUndo).toBeCloseTo(expectUndo, 6);
  expect(Math.abs(xUndo - xMid)).toBeGreaterThan(1);

  // 9. Redo
  await page.locator('#btnRedo').tap();
  P = await project(page);
  expect(P.scenes[0].layers[0].keyframes.x.find(k => k.id === kfX2).time).toBe(t3);
  expect(await evalX(page, L0.id, tm)).toBeCloseTo(xMid, 6);

  // 10. 自動保存 → 再読み込み → 復元（深い比較）と素材の読み込み確認
  await waitSaved(page);
  const before = await project(page);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  const after = await project(page);
  expect(after).toEqual(before);
  expect(after.settings).toEqual(before.settings);
  expect(after.scenes[0].layers[0].keyframes).toEqual(before.scenes[0].layers[0].keyframes);
  expect(after.assets).toEqual(before.assets);
  expect(after.scenes[0].layers[0].assetId).toBe(assetId);
  await expect.poll(() => page.evaluate(id => window.__motion.assetInfo(id), assetId)).toEqual({ status: 'ready', naturalWidth: 160 });
  await expect(page.locator('#saveStatus')).toHaveAttribute('data-state', 'saved');
});

test('タッチ操作：タップ選択・1本指ドラッグ・ピンチ・ひねり・タイムラインのピンチ', async ({ page, browserName }) => {
  await openApp(page);
  await page.getByTestId('tab-add').tap();
  await page.getByTestId('add-rect').tap();
  await page.getByTestId('tab-props').tap(); // シートを閉じる
  await waitSheetSettled(page);
  let P = await project(page);
  const L0 = P.scenes[0].layers[0];
  const k = await page.evaluate(() => { const a = window.__motion.stagePointOf(0, 0), b = window.__motion.stagePointOf(1000, 0); return (b.x - a.x) / 1000; });

  // タップで選択解除 → 選択
  const empty = await page.evaluate(() => window.__motion.stagePointOf(80, 80));
  await page.touchscreen.tap(empty.x, empty.y);
  await expect.poll(async () => (await state(page)).sel.layerIds).toEqual([]);
  const c = await page.evaluate(id => window.__motion.layerCenter(id), L0.id);
  await page.touchscreen.tap(c.x, c.y);
  await expect.poll(async () => (await state(page)).sel.layerIds).toEqual([L0.id]);

  // 1本指ドラッグで移動（1回のドラッグ = 1履歴）
  let u0 = (await state(page)).undo;
  await touchDrag(page, browserName, c, { x: c.x + 40, y: c.y + 24 }, 10);
  P = await project(page);
  let L = P.scenes[0].layers[0];
  expect(Math.abs((L.x - L0.x) - 40 / k)).toBeLessThan(4);
  expect(Math.abs((L.y - L0.y) - 24 / k)).toBeLessThan(4);
  expect((await state(page)).undo).toBe(u0 + 1);

  // ピンチで拡大（指の距離 50 → 100 で 2 倍）
  const c2 = await page.evaluate(id => window.__motion.layerCenter(id), L0.id);
  u0 = (await state(page)).undo;
  await pinch(page, browserName, c2, 50, 100, 0, 0, 14);
  L = (await project(page)).scenes[0].layers[0];
  expect(L.scale).toBeGreaterThan(1.9);
  expect(L.scale).toBeLessThan(2.1);
  expect(Math.abs(L.rotation)).toBeLessThan(1);
  expect((await state(page)).undo).toBe(u0 + 1);

  // 2本指ひねりで回転（+30°）
  await pinch(page, browserName, c2, 80, 80, 0, 30, 14);
  L = (await project(page)).scenes[0].layers[0];
  expect(L.rotation).toBeGreaterThan(27);
  expect(L.rotation).toBeLessThan(33);
  expect(L.scale).toBeGreaterThan(1.9);

  // Undo で回転が元に戻る
  await page.locator('#btnUndo').tap();
  L = (await project(page)).scenes[0].layers[0];
  expect(Math.abs(L.rotation)).toBeLessThan(1);

  // タイムラインのピンチでズーム
  const tracks = await page.getByTestId('tl-tracks').boundingBox();
  const pps0 = (await state(page)).pps;
  await pinch(page, browserName, { x: tracks.x + tracks.width / 2, y: tracks.y + Math.min(tracks.height - 10, 120) }, 60, 150, 0, 0, 14);
  const pps1 = (await state(page)).pps;
  expect(pps1 / pps0).toBeGreaterThan(2.2);
  expect(pps1 / pps0).toBeLessThan(2.8);

  // 選択中のレイヤーのバーを指でドラッグして開始時間を移動
  const bb = await page.locator(`[data-testid=layer-bar][data-layer-id="${L0.id}"]`).boundingBox();
  const vx0 = Math.max(bb.x, tracks.x) + 30, vx1 = Math.min(bb.x + bb.width, tracks.x + tracks.width) - 30 - pps1;
  const bc = { x: (vx0 + Math.max(vx0, vx1)) / 2, y: bb.y + bb.height / 2 };
  await touchDrag(page, browserName, bc, { x: bc.x + pps1 * 1.0, y: bc.y }, 12);
  L = (await project(page)).scenes[0].layers[0];
  expect(Math.abs(L.start - 1)).toBeLessThan(0.1);
});

test('iPhone：1080p を超える設定では書き出し前に理由を表示し、1080p に縮小する', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { const P = window.__motion.project(); Object.assign(P.settings, { width: 3840, height: 2160 }); return window.__motion.loadProject(P); });
  await page.locator('#btnExport').tap();
  const warn = page.getByTestId('ios-limit');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('1080p');
  await expect(warn).toContainText('1920 × 1080 に縮小');
  await expect(page.getByTestId('export-dialog')).toContainText('1920 × 1080・30 fps');
  await expect(page.getByTestId('export-method')).toBeVisible();
});

test('「?」をタップすると説明が表示される', async ({ page }) => {
  await openApp(page);
  await page.locator('.tl-scenelabel .help').tap();
  await expect(page.locator('#popover')).toHaveClass(/on/);
  await expect(page.locator('#popover')).toContainText('シーンの右端');
  await page.touchscreen.tap(20, 300);
  await expect(page.locator('#popover')).not.toHaveClass(/on/);
});
