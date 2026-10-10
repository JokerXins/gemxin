'use strict';

/*
 * 无头 Chrome 启动 + CDP 连接封装。
 * 用途：真实浏览器端到端测试。不依赖 puppeteer，直接用内置 WebSocket 说 CDP。
 *
 * 设计要点：
 *   - 自动探测 Chrome/Edge 安装路径，可用 CHROME_PATH 环境变量覆盖；
 *   - 使用独立临时 profile，避免污染用户浏览器；
 *   - 先轮询 /json/version 再连接，避免启动竞态；
 *   - close() 同时清理进程与临时目录，任何退出路径都不会留垃圾。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATE_BROWSERS = [
	process.env.CHROME_PATH,
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
	for (const candidate of CANDIDATE_BROWSERS) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error('未找到 Chrome/Edge，可用 CHROME_PATH 环境变量指定可执行文件');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevToolsEndpoint(port, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) {
				return;
			}
		} catch {
			/* 尚未就绪，继续等 */
		}
		if (Date.now() > deadline) {
			throw new Error(`等待 CDP 端口 ${port} 超时`);
		}
		await sleep(150);
	}
}

/** 建一个 CDP 会话：send(method, params) + 事件缓冲 */
async function connectCdp(port) {
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const page = targets.find((t) => t.type === 'page');
	if (!page) {
		throw new Error('未找到 page target');
	}
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	const pending = new Map();
	const events = [];
	let nextId = 0;

	ws.addEventListener('message', (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.id && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		} else if (msg.method) {
			events.push(msg);
		}
	});
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve);
		ws.addEventListener('error', reject);
	});

	const send = (method, params) =>
		new Promise((resolve) => {
			const id = ++nextId;
			pending.set(id, resolve);
			ws.send(JSON.stringify({ id, method, params: params || {} }));
		});

	/* Runtime.evaluate 的薄封装：返回 JS 值，抛错时带出原始异常 */
	const evaluate = async (expression) => {
		const r = await send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (r.result && r.result.exceptionDetails) {
			throw new Error(
				`页面执行异常: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`
			);
		}
		return r.result && r.result.result ? r.result.result.value : undefined;
	};

	return {
		ws,
		send,
		evaluate,
		events,
		clearEvents: () => {
			events.length = 0;
		},
	};
}

/**
 * 启动无头 Chrome 并连上 CDP。
 * @returns {Promise<{send: Function, evaluate: Function, events: Array, close: Function}>}
 */
async function launchBrowser(options) {
	const opts = options || {};
	const port = opts.port || 9333;
	const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemxin-browser-'));
	const browserPath = findBrowser();

	const child = spawn(
		browserPath,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-extensions',
			`--user-data-dir=${profileDir}`,
			`--remote-debugging-port=${port}`,
			'--window-size=1440,900',
			'about:blank',
		],
		{ stdio: 'ignore' }
	);

	let closed = false;
	const close = () => {
		if (closed) {
			return;
		}
		closed = true;
		try {
			child.kill('SIGKILL');
		} catch {
			/* 进程可能已退出 */
		}
		try {
			fs.rmSync(profileDir, { recursive: true, force: true });
		} catch {
			/* 临时目录清理失败不影响测试结论 */
		}
	};

	try {
		await waitForDevToolsEndpoint(port, 20000);
		const session = await connectCdp(port);
		return { ...session, browserPath, close };
	} catch (err) {
		close();
		throw err;
	}
}

module.exports = { launchBrowser, sleep, findBrowser };
