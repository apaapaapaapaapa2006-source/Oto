// テスト用の静的ファイルサーバー（motion/ フォルダを配信）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.md': 'text/markdown' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
