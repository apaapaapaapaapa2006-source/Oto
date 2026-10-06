// index.html?test=1 の内蔵セルフテストがすべて合格することを確認
const { test, expect } = require('@playwright/test');

test('内蔵セルフテスト（?test=1）がすべて合格', async ({ page }) => {
  await page.goto('/index.html?test=1');
  await page.waitForFunction(() => window.__selfTest && window.__selfTest.done, null, { timeout: 120_000 });
  const r = await page.evaluate(() => window.__selfTest);
  for (const x of r.results) console.log(`${x.status}\t${x.name}\t${x.detail}`);
  expect(r.results.filter(x => x.status === 'fail')).toEqual([]);
  expect(r.passed).toBeGreaterThanOrEqual(9);
  await expect(page.getByTestId('selftest-summary')).toContainText('すべて合格');
});
