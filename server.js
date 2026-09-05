const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8788', 10);
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.user.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  // 允许跨域访问（方便油猴扩展和本地跨域调试）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(ROOT_DIR, reqPath);

  // 防止目录穿越
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + reqPath);
      return;
    }

    let ext = path.extname(filePath).toLowerCase();
    if (filePath.endsWith('.user.js')) {
      ext = '.user.js';
    }
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Panstar & Akile 交易所计算器 本地调试服务已启动！`);
  console.log(`🏠 调试控制台主页: http://127.0.0.1:${PORT}/`);
  console.log(`📦 油猴脚本安装地址: http://127.0.0.1:${PORT}/panstar-akile-value.user.js`);
  console.log(`⚡ 实时热加载 Loader: http://127.0.0.1:${PORT}/dev.loader.user.js`);
  console.log(`🧪 双平台仿真测试壳: http://127.0.0.1:${PORT}/mock-marketplace.html`);
  console.log(`======================================================\n`);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
