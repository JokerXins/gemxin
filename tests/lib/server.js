'use strict';

/*
 * 静态文件服务（Node 内置 http，无需额外依赖）。
 * 用途：测试时以 HTTP 方式提供仓库根目录 —— 页面用相对路径引用资源，
 *       file:// 下部分浏览器行为不一致，测试必须走 HTTP 才可信。
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const MIME_TYPES = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain; charset=utf-8',
	'.woff2': 'font/woff2',
	'.xml': 'application/xml; charset=utf-8',
};

function resolveSafePath(rootDir, urlPath) {
	const decoded = decodeURIComponent(urlPath.split('?')[0]);
	const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
	const resolved = path.resolve(rootDir, relative);
	/* 目录穿越防护：解析结果必须仍在根目录内 */
	return resolved.startsWith(path.resolve(rootDir)) ? resolved : null;
}

/**
 * 启动静态服务。
 * @param {string} rootDir 站点根目录
 * @param {number} [preferredPort] 期望端口，被占用时回退到随机可用端口
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
function startServer(rootDir, preferredPort) {
	const server = http.createServer((req, res) => {
		const filePath = resolveSafePath(rootDir, req.url || '/');
		if (!filePath) {
			res.writeHead(403).end('Forbidden');
			return;
		}
		fs.readFile(filePath, (err, data) => {
			if (err) {
				res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
					'Not Found'
				);
				return;
			}
			const type =
				MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
			res.writeHead(200, { 'Content-Type': type }).end(data);
		});
	});

	return new Promise((resolve, reject) => {
		server.once('error', (err) => {
			/* 端口被占用则退回随机端口重试一次 */
			if (err.code === 'EADDRINUSE' && preferredPort) {
				startServer(rootDir, 0).then(resolve, reject);
				return;
			}
			reject(err);
		});
		server.listen(preferredPort || 0, '127.0.0.1', () => {
			const port = server.address().port;
			resolve({
				url: `http://127.0.0.1:${port}/`,
				port,
				close: () => new Promise((done) => server.close(done)),
			});
		});
	});
}

module.exports = { startServer };
