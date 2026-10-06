// PC（マウス・キーボード、3カラム）での操作テスト
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { fixture, sha256File, openApp, project, state, waitSaved, centerOf } = require('./helpers');

const geom = (page, id) => page.evaluate(id => window.__motion.layerGeom(id), id);
const sp = (page, x, y) => page.evaluate(([x, y]) => window.__motion.stagePointOf(x, y), [x, y]);
async function mouseDrag(page, from, to, { shift = false, steps = 10 } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}
/** 再生ヘッド位置のシーンのレイヤー */
const layers = page => page.evaluate(() => {
  const st = window.__motion.state(), P = window.__motion.project();
  return (P.scenes.find(s => st.time >= s.start - 1e-7 && st.time < s.start + s.duration - 1e-7) || P.scenes[P.scenes.length - 1]).layers;
});

test('PC：3カラム表示、ハンドルで拡大縮小（Shift で比率固定）・回転、キーボード操作', async ({ page }) => {
  await openApp(page);
  expect((await state(page)).wide).toBe(true);
  await expect(page.locator('#rightCol')).toBeVisible();
  await expect(page.locator('#leftCol')).toBeVisible();
  await page.getByTestId('add-rect').click();
  let L = (await layers(page))[0];
  let g = await geom(page, L.id);
  const tl0 = g.corners[0];

  // 右下ハンドルを Shift ドラッグ → 縦横比を保って拡大、左上は固定
  const br = await sp(page, g.corners[2][0], g.corners[2][1]);
  await mouseDrag(page, br, { x: br.x + 50, y: br.y + 10 }, { shift: true });
  L = (await layers(page))[0];
  expect(L.width).toBeGreaterThan(330);
  expect(Math.abs(L.width - L.height)).toBeLessThan(0.01);
  g = await geom(page, L.id);
  expect(Math.abs(g.corners[0][0] - tl0[0])).toBeLessThan(0.5);
  expect(Math.abs(g.corners[0][1] - tl0[1])).toBeLessThan(0.5);
  // Shift なし → 比率は固定されない
  const br2 = await sp(page, g.corners[2][0], g.corners[2][1]);
  await mouseDrag(page, br2, { x: br2.x + 40, y: br2.y });
  L = (await layers(page))[0];
  expect(L.width - L.height).toBeGreaterThan(50);
  expect((await state(page)).undo).toBe(3); // 追加 + ドラッグ2回

  // 回転ハンドル（上の丸）を Shift ドラッグで 90°（15° 刻み）
  g = await geom(page, L.id);
  const c = await sp(page, g.x, g.y);
  const topC = await sp(page, (g.corners[0][0] + g.corners[1][0]) / 2, (g.corners[0][1] + g.corners[1][1]) / 2);
  const rotH = { x: topC.x, y: topC.y - 30 };
  const r = Math.hypot(rotH.x - c.x, rotH.y - c.y);
  await page.keyboard.down('Shift');
  await page.mouse.move(rotH.x, rotH.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * i / 12; await page.mouse.move(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r); }
  await page.mouse.up(); await page.keyboard.up('Shift');
  L = (await layers(page))[0];
  expect(L.rotation).toBe(90);

  // キーボード：Space 再生/停止、←/→ コマ送り、Ctrl+Z / Ctrl+Shift+Z、Delete
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } }); // 選択解除 & フォーカスを外す
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).playing).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await state(page)).playing).toBe(false);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  expect((await state(page)).time).toBeCloseTo(1 / 30, 6);
  await page.keyboard.press('Shift+ArrowRight');
  expect((await state(page)).time).toBeCloseTo(11 / 30, 6);
  await page.keyboard.press('ArrowLeft');
  expect((await state(page)).time).toBeCloseTo(10 / 30, 6);
  await expect(page.locator('#timeReadout')).toContainText('F 10 / 300');
  await page.keyboard.press('Control+z');
  expect((await layers(page))[0].rotation).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  expect((await layers(page))[0].rotation).toBe(90);
  const lc = await page.evaluate(id => window.__motion.layerCenter(id), L.id);
  await page.mouse.click(lc.x, lc.y);
  expect((await state(page)).sel.layerIds).toEqual([L.id]);
  await page.keyboard.press('Delete');
  expect(await layers(page)).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect(await layers(page)).toHaveLength(1);

  // ドラッグ&ドロップで画像を読み込み
  const b64 = fs.readFileSync(fixture('test-image.png')).toString('base64');
  const dt = await page.evaluateHandle(b64 => { const dt = new DataTransfer(); const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], 'dropped.png', { type: 'image/png' })); return dt; }, b64);
  await page.dispatchEvent('#app', 'dragenter', { dataTransfer: dt });
  await expect(page.locator('#dropzone')).toHaveClass(/on/);
  await page.dispatchEvent('#app', 'drop', { dataTransfer: dt });
  await expect.poll(async () => (await project(page)).assets.map(a => a.originalName)).toEqual(['dropped.png']);
  expect((await layers(page)).map(l => l.type)).toEqual(['shape', 'image']);
});

test('シーン（作成・複製・名前変更・並べ替え・削除・境界ドラッグ）とレイヤーパネル（並べ替え・表示・ロック・名前変更・複製・削除）', async ({ page }) => {
  await openApp(page);
  // シーン
  await page.getByTestId('ltab-scenes').click();
  await page.getByTestId('add-scene').click();
  let P = await project(page);
  expect(P.scenes.map(s => [s.start, s.duration])).toEqual([[0, 10], [10, 3]]);
  expect(P.settings.durationSec).toBe(13);
  await page.getByTestId('scene-name').fill('エンディング');
  await page.getByTestId('scene-name').press('Enter');
  expect((await project(page)).scenes[1].name).toBe('エンディング');
  await page.getByTestId('dup-scene').click();
  P = await project(page);
  expect(P.scenes.map(s => s.name)).toEqual(['シーン 1', 'エンディング', 'エンディング のコピー']);
  await page.getByRole('button', { name: '← 前へ' }).click();
  P = await project(page);
  expect(P.scenes.map(s => s.name)).toEqual(['シーン 1', 'エンディング のコピー', 'エンディング']);
  expect(P.scenes.map(s => s.start)).toEqual([0, 10, 13]);
  await page.getByRole('button', { name: '削除' }).last().click();
  await page.locator('.dlg footer button.danger').click();
  P = await project(page);
  expect(P.scenes.map(s => s.name)).toEqual(['シーン 1', 'エンディング']);
  expect(P.settings.durationSec).toBe(13);
  // 境界ドラッグ（シーン1を約1秒長くする → 後ろのシーンが詰めて並ぶ）
  const edge = page.getByTestId('scene-edge').first();
  const ec = await centerOf(edge);
  const pps = (await state(page)).pps;
  await mouseDrag(page, ec, { x: ec.x + pps, y: ec.y });
  P = await project(page);
  expect(Math.abs(P.scenes[0].duration - 11)).toBeLessThan(0.1);
  expect(P.scenes[1].start).toBe(P.scenes[0].duration);
  expect(P.scenes[1].duration).toBe(3);

  // レイヤーパネル
  await page.keyboard.press('Home');
  await page.getByTestId('ltab-add').click();
  await page.getByTestId('add-text').click();
  await page.getByTestId('add-ellipse').click();
  await page.getByTestId('ltab-layers').click();
  let L = await layers(page);
  expect(L.map(l => l.type)).toEqual(['text', 'shape']);
  const items = page.getByTestId('layer-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('円'); // 前面が上
  await page.getByRole('button', { name: '背面へ' }).click(); // 選択中の円を背面へ
  expect((await layers(page)).map(l => l.type)).toEqual(['shape', 'text']);
  await page.getByRole('button', { name: '前面へ' }).click();
  expect((await layers(page)).map(l => l.type)).toEqual(['text', 'shape']);
  await page.getByRole('button', { name: '名前変更' }).click();
  await page.locator('#panel-layers input[type=text]').fill('まる');
  await page.locator('#panel-layers input[type=text]').press('Enter');
  expect((await layers(page))[1].name).toBe('まる');
  await items.first().getByTestId('toggle-visible').click();
  expect((await layers(page))[1].visible).toBe(false);
  await items.first().getByTestId('toggle-visible').click();
  await items.first().getByTestId('toggle-lock').click();
  expect((await layers(page))[1].locked).toBe(true);
  // ロック中のレイヤーはプレビューで選択できない
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  const lc = await page.evaluate(id => window.__motion.layerCenter(id), (await layers(page))[1].id);
  await page.mouse.click(lc.x, lc.y);
  expect((await state(page)).sel.layerIds).not.toContain((await layers(page))[1].id);
  await items.first().getByTestId('toggle-lock').click();
  await items.first().locator('.nm').click();
  await page.getByRole('button', { name: '複製' }).first().click();
  expect((await layers(page)).map(l => l.name)).toEqual(['テキスト', 'まる', 'まる のコピー']);
  await page.locator('#panel-layers').getByRole('button', { name: '削除' }).click();
  expect((await layers(page)).map(l => l.name)).toEqual(['テキスト', 'まる']);
  await page.locator('#btnUndo').click();
  expect((await layers(page)).map(l => l.name)).toEqual(['テキスト', 'まる', 'まる のコピー']);
});

test('プロジェクト設定：長さ・縦横比・解像度・fps を変えてもレイヤーは消えない', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('add-text').click();
  await page.getByTestId('add-rect').click();
  await page.getByTestId('kf-x').click();
  const before = await project(page);
  await page.locator('#btnSettings').click();
  await page.getByTestId('set-duration').fill('6');
  await page.getByTestId('set-duration').press('Tab');
  await page.getByTestId('set-aspect').selectOption('9:16');
  await expect(page.getByTestId('set-res')).toHaveValue('1080x1920');
  await page.getByTestId('set-fps').selectOption('60');
  await page.getByTestId('settings-apply').click();
  let P = await project(page);
  expect(P.settings).toMatchObject({ durationSec: 6, aspect: '9:16', width: 1080, height: 1920, fps: 60 });
  expect(P.scenes[0].duration).toBe(6);
  expect(P.scenes[0].layers).toHaveLength(2);
  expect(P.scenes[0].layers.map(l => l.id)).toEqual(before.scenes[0].layers.map(l => l.id));
  expect(P.scenes[0].layers[0].x).toBe(540); // 中央は中央のまま
  expect(P.scenes[0].layers[1].keyframes.x).toHaveLength(1);
  await expect(page.locator('#timeReadout')).toContainText('/ 360');
  // カスタム：奇数は偶数に丸める
  await page.locator('#btnSettings').click();
  await page.getByTestId('set-aspect').selectOption('custom');
  await page.getByTestId('set-width').fill('1001');
  await page.getByTestId('set-width').press('Tab');
  await page.getByTestId('settings-apply').click();
  P = await project(page);
  expect(P.settings.width % 2).toBe(0);
  expect(P.scenes[0].layers).toHaveLength(2);
  // 元に戻す
  await page.locator('#btnUndo').click();
  await page.locator('#btnUndo').click();
  P = await project(page);
  expect(P.settings).toEqual(before.settings);
  expect(P.scenes).toEqual(before.scenes);
});

test('ファイルに保存（.motion.json）→ 新規 → 開く で素材ごと復元、フォント登録、素材が無いときは再リンク', async ({ page }, testInfo) => {
  await openApp(page);
  // 画像とフォント（自作の箱フォント：全グリフ幅 600/1000em）を読み込む
  await page.evaluate(() => { document.querySelector('#fileAssets')._addLayers = true; });
  await page.setInputFiles('#fileAssets', [fixture('test-image.png'), fixture('test-box-font.ttf')]);
  await expect.poll(async () => (await project(page)).assets.length).toBe(2);
  let P = await project(page);
  const img = P.assets.find(a => a.kind === 'image'), font = P.assets.find(a => a.kind === 'font');
  expect(font).toMatchObject({ originalName: 'test-box-font.ttf', type: 'font/ttf', hash: sha256File(fixture('test-box-font.ttf')) });
  await expect.poll(() => page.evaluate(id => window.__motion.assetInfo(id).status, font.id)).toBe('ready');
  // テキストにフォントを適用 → 幅が箱フォントの値（4文字 × 0.6em）になる
  await page.getByTestId('add-text').click();
  await page.getByTestId('prop-content').fill('AAAA');
  await page.getByTestId('prop-content').blur();
  await page.getByTestId('prop-fontSize').fill('100');
  await page.getByTestId('prop-fontSize').press('Enter');
  await page.getByTestId('prop-font').selectOption('asset:' + font.id);
  const textId = (await layers(page))[1].id;
  expect((await geom(page, textId)).w).toBeCloseTo(240, 3);
  await waitSaved(page);
  const before = await project(page);

  // ファイルに保存
  await page.locator('#btnMenu').click();
  await page.getByTestId('menu-save').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-download').click()]);
  expect(dl.suggestedFilename()).toBe('無題のプロジェクト.motion.json');
  const file = testInfo.outputPath('saved.motion.json');
  await dl.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(json.format).toBe('motion-project-file');
  expect(Object.keys(json.assetData).sort()).toEqual([img.id, font.id].sort());
  expect(Buffer.from(json.assetData[font.id].data, 'base64')).toEqual(fs.readFileSync(fixture('test-box-font.ttf')));
  await page.locator('.dlg footer').getByRole('button', { name: '閉じる' }).click();

  // 新規プロジェクト
  await page.locator('#btnMenu').click();
  await page.getByTestId('menu-new').click();
  await page.locator('.dlg footer button.danger').click();
  await expect.poll(async () => (await project(page)).scenes[0].layers.length).toBe(0);

  // ファイルを開く → 完全一致
  await page.locator('#btnMenu').click();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('menu-open').click()]);
  await fc.setFiles(file);
  await expect.poll(async () => (await project(page)).scenes[0].layers.length).toBe(2);
  expect(await project(page)).toEqual(before);
  await expect.poll(() => page.evaluate(id => window.__motion.assetInfo(id).status, img.id)).toBe('ready');
  await expect.poll(() => page.evaluate(id => window.__motion.assetInfo(id).status, font.id)).toBe('ready');
  expect((await geom(page, textId)).w).toBeCloseTo(240, 3);

  // 素材データの無いファイル → 警告 + プレースホルダー + 再リンク
  delete json.assetData[img.id];
  json.project.assets.find(a => a.id === img.id).id = 'a_gone';
  json.project.scenes[0].layers.find(l => l.type === 'image').assetId = 'a_gone';
  const broken = testInfo.outputPath('noimage.motion.json');
  fs.writeFileSync(broken, JSON.stringify(json));
  await page.locator('#btnMenu').click();
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('menu-open').click()]);
  await fc2.setFiles(broken);
  await page.locator('.dlg footer button.primary').click(); // 現在のプロジェクトを置き換える確認
  await expect(page.locator('.dlg')).toContainText('データが含まれていません');
  await page.locator('.dlg footer button.primary').click();
  await expect.poll(() => page.evaluate(() => window.__motion.assetInfo('a_gone').status)).toBe('missing');
  const imgLayer = (await layers(page)).find(l => l.type === 'image');
  await page.getByTestId('ltab-layers').click();
  await page.locator(`[data-testid=layer-item][data-layer-id="${imgLayer.id}"] .nm`).click();
  await expect(page.locator('#panel-props').getByTestId('relink')).toBeVisible(); // プロパティにも再リンクボタン
  const ph = await page.evaluate(async () => { const r = await window.__motion.renderPixels(0, 1920); const b = atob(r.data); const i = (540 * 1920 + 900) * 4; return [b.charCodeAt(i), b.charCodeAt(i + 1), b.charCodeAt(i + 2)]; });
  expect(ph).not.toEqual([16, 18, 24]); // プレースホルダーが描かれている（背景色 #101218 ではない）
  await page.getByTestId('ltab-assets').click();
  const item = page.locator('[data-testid=asset-item][data-asset-id="a_gone"]');
  await expect(item).toContainText('見つかりません');
  const [fc4] = await Promise.all([page.waitForEvent('filechooser'), item.getByTestId('relink').click()]);
  await fc4.setFiles(fixture('test-image.png'));
  await expect.poll(() => page.evaluate(() => window.__motion.assetInfo('a_gone').status)).toBe('ready');
});

test('フェーズ2：プリセット（置き換え・Undo）、ステージャー（シード付きランダム）、スプリングUI、カーソル', async ({ page }) => {
  await openApp(page);
  for (let i = 0; i < 3; i++) await page.getByTestId('add-text').click();
  let L = await layers(page);
  const [a, b, c] = L.map(l => l.id);
  // プリセット：スライドイン（左から）→ キーフレーム生成
  await page.getByTestId('preset-kind').selectOption('slide');
  await page.getByTestId('preset-apply-in').click();
  let T = (await layers(page))[2];
  expect(T.keyframes.x.map(k => [k.time, k.tag])).toEqual([[0, 'in'], [0.6, 'in']]);
  expect(T.keyframes.x[0].value).toBe(T.x - 288);
  expect(T.keyframes.x[1].value).toBe(T.x);
  // 再適用（フェード）→ イン枠のキーフレームは置き換え
  await page.getByTestId('preset-kind').selectOption('fade');
  await page.getByTestId('preset-apply-in').click();
  T = (await layers(page))[2];
  expect(T.keyframes.x).toBeUndefined();
  expect(T.keyframes.opacity.map(k => [k.time, k.value])).toEqual([[0, 0], [0.6, 1]]);
  await page.locator('#btnUndo').click();
  T = (await layers(page))[2];
  expect(T.keyframes.x).toHaveLength(2);
  expect(T.keyframes.opacity).toBeUndefined();
  // アウト（最後の 0.6 秒）
  await page.getByTestId('preset-kind').selectOption('scale');
  await page.getByTestId('preset-apply-out').click();
  T = (await layers(page))[2];
  expect(T.keyframes.scale.map(k => [k.time, k.value, k.tag])).toEqual([[9.4, 1, 'out'], [10, 0.5, 'out']]);
  // 生成されたキーフレームは通常どおり編集できる（◆を選んでスプリングに変更）
  const dia = page.locator(`[data-testid=kf-diamond][data-id="${T.keyframes.scale[0].id}"]`);
  await page.locator('#btnUndo').click(); await page.locator('#btnRedo').click();
  await page.evaluate(() => window.__motion.setTime(9.4));
  await dia.click();
  await page.getByTestId('easing-select').selectOption('spring');
  await expect(page.getByTestId('spring-stiffness')).toBeVisible();
  await page.getByTestId('spring-damping').evaluate(el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  T = (await layers(page))[2];
  expect(T.keyframes.scale[0].easing).toEqual({ type: 'spring', stiffness: 180, damping: 20, mass: 1 });

  // ステージャー：複数選択（パネルの「複数選択」）→ ランダム（シード 42）→ 適用
  await page.getByTestId('ltab-layers').click();
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } }); // いったん選択解除
  await page.getByTestId('multi-toggle').click();
  const items = page.getByTestId('layer-item');
  for (let i = 0; i < 3; i++) await items.nth(i).locator('.nm').click();
  expect((await state(page)).sel.layerIds.sort()).toEqual([a, b, c].sort());
  await page.getByTestId('stagger-random').click();
  await page.getByTestId('stagger-seed').fill('42');
  await page.getByTestId('stagger-seed').press('Tab');
  await page.getByTestId('stagger-interval').fill('0.3');
  await page.getByTestId('stagger-apply').click();
  L = await layers(page);
  const starts1 = Object.fromEntries(L.map(l => [l.id, l.start]));
  expect(Object.values(starts1).sort()).toEqual([0, 0.3, 0.6]);
  expect(L[2].keyframes.x.map(k => k.time)).toEqual([0, 0.6]); // キーフレームはレイヤー相対で一緒に動く
  await page.locator('#btnUndo').click();
  await page.getByTestId('stagger-apply').click();
  L = await layers(page);
  expect(Object.fromEntries(L.map(l => [l.id, l.start]))).toEqual(starts1); // 同じシード → 同じ順
  await page.getByTestId('stagger-forward').click();
  await page.getByTestId('stagger-apply').click();
  L = await layers(page);
  expect(L.map(l => l.start)).toEqual([0.6, 0.3, 0]); // リスト上から（= 前面から）
  await page.getByTestId('multi-toggle').click();

  // カーソル：追加 → 経路点をドラッグ → クリック追加
  await page.getByTestId('ltab-add').click();
  await page.getByTestId('add-cursor').click();
  let C = (await layers(page))[3];
  expect(C.type).toBe('cursor');
  const p0 = C.points[0];
  await page.keyboard.press('Home');
  const ps = await sp(page, p0.x, p0.y);
  await mouseDrag(page, ps, { x: ps.x + 30, y: ps.y - 20 });
  C = (await layers(page))[3];
  expect(C.points[0].x).toBeGreaterThan(p0.x + 20);
  expect(C.points[0].y).toBeLessThan(p0.y - 10);
  await page.evaluate(() => window.__motion.setTime(1.5));
  await page.getByTestId('add-cursor-click').click();
  C = (await layers(page))[3];
  expect(C.clicks.map(k => k.time)).toEqual([1.4, 1.5]);
  await page.getByTestId('add-cursor-point').click();
  C = (await layers(page))[3];
  expect(C.points.map(k => k.time)).toEqual([0, 1.2, 1.5]);
  await expect(page.getByTestId('cursor-point')).toHaveCount(3);
  await expect(page.getByTestId('cursor-click')).toHaveCount(2);
  // 波紋はクリック時刻の直後だけ描かれる（renderFrame の出力が変わる）
  const px = await page.evaluate(async () => { const a = await window.__motion.renderPixels(1.39, 480), b = await window.__motion.renderPixels(1.55, 480); return a.data === b.data; });
  expect(px).toBe(false);
});
