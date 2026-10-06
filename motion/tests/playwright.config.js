// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;
// Linux でロケール未設定だと Chromium が日本語のダウンロードファイル名を "download" に置き換えるため
if (!process.env.LANG) process.env.LANG = 'C.UTF-8';
// H.264 エンコーダを持つ Chrome（Google Chrome / Chrome for Testing）。
// CHROME_PATH があればそれを、なければインストール済みの Google Chrome（channel: 'chrome'）を使う。
const chrome = process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : { channel: 'chrome' };

module.exports = defineConfig({
  testDir: '.',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  webServer: { command: `node server.mjs ${PORT}`, url: `http://127.0.0.1:${PORT}/index.html`, reuseExistingServer: true },
  projects: [
    // 主なテスト環境：WebKit エンジン + iPhone 端末エミュレーション
    { name: 'iphone-webkit', testMatch: /(editor|selftest)\.spec\.js/, use: { ...devices['iPhone 15'] } },
    // 同じテストを Chromium の iPhone エミュレーションでも実行（WebKit を用意できない環境向け）
    { name: 'iphone-chromium', testMatch: /(editor|selftest)\.spec\.js/, use: { ...devices['iPhone 15'], browserName: 'chromium' } },
    // PC（マウス・キーボード）の操作、MediaRecorder へのフォールバック
    { name: 'desktop-chromium', testMatch: /(desktop|selftest|export)\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    // MP4（H.264）書き出しのフレーム比較
    { name: 'export-chrome', testMatch: /export\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 }, ...chrome } },
  ],
});
