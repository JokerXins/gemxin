'use strict';

/*
 * 真实浏览器端到端测试（Chrome/Edge + CDP）
 *
 * 与 behavior.test.js 的分工：本文件验证「只有真实浏览器才成立」的部分 ——
 * 真实鼠标点击、剪贴板读写、计算样式、响应式断点、控制台报错与网络 4xx。
 *
 * 运行：npm run test:browser
 * 依赖：本机需安装 Chrome 或 Edge（可用 CHROME_PATH 指定）
 */

const net = require('net');
const path = require('path');
const { launchBrowser, sleep } = require('./lib/browser');
const { startServer } = require('./lib/server');

const REPO_ROOT = path.resolve(__dirname, '..');
const PREFERRED_HTTP_PORT = 8124;

let pass = 0;
const failures = [];

function check(name, actual, expected) {
	const ok = actual === expected;
	if (ok) {
		pass++;
		console.log(`  PASS  ${name}`);
		return;
	}
	failures.push(name);
	console.log(
		`  FAIL  ${name} -> 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`
	);
}

function section(title) {
	console.log(`\n== ${title} ==`);
}

/* 找一个空闲 TCP 端口，避免与用户本地服务或并行测试撞车 */
function findFreePort() {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
}

/**
 * 打开页面并确认真的加载成功。
 * 新建的 CDP 实例首次导航偶发失败，因此先回 about:blank 预热，失败则重试。
 */
async function gotoReady(cdp, url) {
	const waitFor = async (expression, timeoutMs) => {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			let satisfied;
			try {
				satisfied = await cdp.evaluate(`!!(${expression})`);
			} catch {
				/* 页面尚未就绪或导航中被中断，视为未满足，继续轮询 */
				satisfied = false;
			}
			if (satisfied) {
				return;
			}
			if (Date.now() > deadline) {
				throw new Error(`等待超时: ${expression}`);
			}
			await sleep(120);
		}
	};

	try {
		await cdp.send('Page.navigate', { url: 'about:blank' });
		await sleep(300);
	} catch {
		/* 预热失败不致命，继续重试正式导航 */
	}

	for (let i = 1; i <= 3; i++) {
		await cdp.send('Page.navigate', { url });
		try {
			await waitFor('document.querySelector("#myModal3")', 6000);
		} catch (err) {
			if (i === 3) {
				throw new Error(`页面连续 3 次导航失败: ${err.message}`, { cause: err });
			}
			await sleep(800);
			continue;
		}
		await waitFor('!document.body.classList.contains("is-preload")', 6000);
		/* 等入场动画播完，否则 #wrapper 的 opacity 还停在中间值 */
		await cdp.evaluate(
			'Promise.race([' +
				'Promise.all(document.getAnimations().map(function (a) { return a.finished; })),' +
				'new Promise(function (r) { setTimeout(r, 3000); })]).catch(function () {})'
		);
		await sleep(300);
		return;
	}
}

async function run() {
	const server = await startServer(REPO_ROOT, PREFERRED_HTTP_PORT);
	const base = server.url;
	const cdpPort = await findFreePort();
	let cdp;
	try {
		cdp = await launchBrowser({ port: cdpPort });
		console.log(`站点: ${base}`);
		console.log(`浏览器: ${cdp.browserPath}`);

		await cdp.send('Page.enable');
		await cdp.send('Runtime.enable');
		await cdp.send('Network.enable');
		await cdp.send('Log.enable');
		/* 无头环境默认无剪贴板权限，且合成 click 不带用户激活；
		   授权后用 Input.dispatchMouseEvent 发真实点击才能走到成功路径。 */
		await cdp.send('Browser.grantPermissions', {
			origin: base.replace(/\/$/, ''),
			permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
		});

		const realClick = async (selector) => {
			const box = await cdp.evaluate(
				`(function () { var r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();` +
					'return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()'
			);
			const point = JSON.parse(box);
			await cdp.send('Input.dispatchMouseEvent', {
				type: 'mousePressed',
				x: point.x,
				y: point.y,
				button: 'left',
				clickCount: 1,
			});
			await cdp.send('Input.dispatchMouseEvent', {
				type: 'mouseReleased',
				x: point.x,
				y: point.y,
				button: 'left',
				clickCount: 1,
			});
		};

		await gotoReady(cdp, base);

		section('1. 首屏与脚本执行');
		check(
			'body 已解除 is-preload',
			await cdp.evaluate('document.body.classList.contains("is-preload")'),
			false
		);
		check(
			'#wrapper 不透明度为 1',
			await cdp.evaluate('getComputedStyle(document.getElementById("wrapper")).opacity'),
			'1'
		);
		check(
			'样式表已生效(标题字号 > 40px)',
			await cdp.evaluate(
				'parseFloat(getComputedStyle(document.querySelector("#header h1")).fontSize) > 40'
			),
			true
		);
		check(
			'图标字体已加载',
			await cdp.evaluate('document.fonts.check(\'900 16px "Font Awesome 5 Brands"\')'),
			true
		);

		section('2. 打开邮箱弹窗(真实点击)');
		check(
			'初始不可见',
			await cdp.evaluate('getComputedStyle(document.getElementById("myModal3")).display'),
			'none'
		);
		await cdp.evaluate('document.querySelector(\'[data-modal="myModal3"]\').click()');
		await sleep(600);
		check(
			'display 变 flex',
			await cdp.evaluate('getComputedStyle(document.getElementById("myModal3")).display'),
			'flex'
		);
		check(
			'hidden 已移除',
			await cdp.evaluate('document.getElementById("myModal3").hasAttribute("hidden")'),
			false
		);
		check('滚动被锁定', await cdp.evaluate('document.body.style.overflow'), 'hidden');
		check(
			'焦点在关闭按钮',
			await cdp.evaluate(
				'document.activeElement === document.querySelector("#myModal3 [data-close]")'
			),
			true
		);
		check(
			'弹窗已居中',
			await cdp.evaluate(
				'(function () { var r = document.querySelector("#myModal3 .modal-box").getBoundingClientRect();' +
					'var dx = Math.abs((r.left + r.right) / 2 - window.innerWidth / 2);' +
					'var dy = Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2); return dx < 3 && dy < 3; })()'
			),
			true
		);
		check(
			'弹窗在视口内',
			await cdp.evaluate(
				'(function () { var r = document.querySelector("#myModal3 .modal-box").getBoundingClientRect();' +
					'return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight; })()'
			),
			true
		);

		section('3. 复制邮箱(真实剪贴板)');
		await realClick('[data-copy]');
		await sleep(500);
		check(
			'剪贴板内容为邮箱地址',
			await cdp.evaluate(
				'navigator.clipboard.readText().catch(function (e) { return "ERR:" + e.name; })'
			),
			'3333339770@qq.com'
		);
		check(
			'按钮进入成功态',
			await cdp.evaluate(
				'document.querySelector("[data-copy]").classList.contains("is-done")'
			),
			true
		);
		check(
			'无 is-fail 残留',
			await cdp.evaluate(
				'document.querySelector("[data-copy]").classList.contains("is-fail")'
			),
			false
		);
		check(
			'按钮计算背景为绿色',
			await cdp.evaluate(
				'getComputedStyle(document.querySelector("[data-copy]")).backgroundColor'
			),
			'rgb(63, 158, 106)'
		);
		check(
			'文案已更新',
			await cdp.evaluate('document.querySelector(".mail-copy-label").textContent'),
			'已复制到剪贴板'
		);
		await sleep(2200);
		check(
			'2s 后文案复位',
			await cdp.evaluate('document.querySelector(".mail-copy-label").textContent'),
			'复制邮箱地址'
		);
		check(
			'复位后移除成功态',
			await cdp.evaluate(
				'document.querySelector("[data-copy]").classList.contains("is-done")'
			),
			false
		);
		/* 指针移开，否则按钮处于 :hover 态，底色不是默认值 */
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
		await sleep(300);
		check(
			'复位后恢复默认底色',
			await cdp.evaluate(
				'getComputedStyle(document.querySelector("[data-copy]")).backgroundColor'
			),
			'rgb(74, 143, 181)'
		);

		section('4. Esc 关闭与焦点归还');
		await cdp.evaluate('document.querySelector(\'[data-modal="myModal3"]\').focus()');
		await cdp.evaluate('document.querySelector(\'[data-modal="myModal3"]\').click()');
		await sleep(400);
		await cdp.send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			key: 'Escape',
			code: 'Escape',
			windowsVirtualKeyCode: 27,
		});
		await cdp.send('Input.dispatchKeyEvent', {
			type: 'keyUp',
			key: 'Escape',
			code: 'Escape',
			windowsVirtualKeyCode: 27,
		});
		await sleep(400);
		check(
			'Esc 后关闭',
			await cdp.evaluate('document.getElementById("myModal3").classList.contains("is-open")'),
			false
		);
		check('Esc 后解锁滚动', await cdp.evaluate('document.body.style.overflow'), '');
		check(
			'焦点归还触发按钮',
			await cdp.evaluate(
				'document.activeElement === document.querySelector(\'[data-modal="myModal3"]\')'
			),
			true
		);

		section('5. 点遮罩关闭与二维码加载');
		await cdp.evaluate('document.querySelector(\'[data-modal="myModal2"]\').click()');
		await sleep(400);
		check(
			'公众号弹窗已打开',
			await cdp.evaluate('document.getElementById("myModal2").classList.contains("is-open")'),
			true
		);
		check(
			'二维码图片已加载',
			await cdp.evaluate(
				'(function () { var i = document.querySelector("#myModal2 img"); return i.complete && i.naturalWidth > 0; })()'
			),
			true
		);
		await cdp.evaluate('document.getElementById("myModal2").click()');
		await sleep(300);
		check(
			'点遮罩后关闭',
			await cdp.evaluate('document.getElementById("myModal2").classList.contains("is-open")'),
			false
		);

		section('6. 控制台与网络健康度');
		const consoleErrors = cdp.events.filter(
			(e) =>
				e.method === 'Runtime.exceptionThrown' ||
				(e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
				(e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
		);
		check(
			'无 JS 异常 / error 日志',
			JSON.stringify(consoleErrors.map((e) => JSON.stringify(e.params).slice(0, 200))),
			'[]'
		);

		const badResponses = cdp.events
			.filter(
				(e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400
			)
			.map((e) => `${e.params.response.status} ${e.params.response.url}`);
		check('本地资源无 4xx/5xx', JSON.stringify([...new Set(badResponses)]), '[]');

		const urls = cdp.events
			.filter((e) => e.method === 'Network.responseReceived')
			.map((e) => e.params.response.url);
		check(
			'main.js 已加载',
			urls.some((u) => u.endsWith('/assets/js/main.js')),
			true
		);
		check(
			'anti-debug.js 已加载',
			urls.some((u) => u.endsWith('/assets/js/anti-debug.js')),
			true
		);
		check(
			'反调试库已本地加载',
			urls.some((u) => u.endsWith('disable-devtool.min.js')),
			true
		);
		check(
			'DisableDevtool 已就绪',
			await cdp.evaluate('typeof window.DisableDevtool'),
			'function'
		);

		section('7. 移动端视口(390x844)');
		await cdp.send('Emulation.setDeviceMetricsOverride', {
			width: 390,
			height: 844,
			deviceScaleFactor: 2,
			mobile: false,
		});
		await gotoReady(cdp, base);
		await cdp.evaluate('document.querySelector(\'[data-modal="myModal3"]\').click()');
		await sleep(500);
		check(
			'弹窗居中且不溢出',
			await cdp.evaluate(
				'(function () { var r = document.querySelector("#myModal3 .modal-box").getBoundingClientRect();' +
					'return r.left >= 0 && r.right <= window.innerWidth + 1 && r.top >= 0 && r.bottom <= window.innerHeight + 1; })()'
			),
			true
		);
		/* 11pt = 14.667px，标题 2.6em，导航圆 1.35em(=19.8px 字号 × 2.5em = 49.5px，小于 61.6px 的格子) */
		check(
			'标题字号 = 2.6 × 正文字号',
			await cdp.evaluate(
				'Math.abs(parseFloat(getComputedStyle(document.querySelector("#header h1")).fontSize)' +
					' - 2.6 * parseFloat(getComputedStyle(document.body).fontSize)) < 0.2'
			),
			true
		);
		check(
			'导航圆直径小于自身格子(不再外溢拥挤)',
			await cdp.evaluate(
				'(function () { var li = document.querySelector("#header nav li");' +
					'var circle = parseFloat(getComputedStyle(li.firstElementChild, ":before").width);' +
					'var cell = parseFloat(getComputedStyle(li).width);' +
					'return circle < cell; })()'
			),
			true
		);
		check(
			'相邻圆之间留有可见间隔(> 6px)',
			await cdp.evaluate(
				'(function () { var lis = document.querySelectorAll("#header nav li");' +
					'var a = lis[0].firstElementChild.getBoundingClientRect();' +
					'var b = lis[1].firstElementChild.getBoundingClientRect();' +
					'return b.left - a.right > 6; })()'
			),
			true
		);
		await cdp.send('Emulation.setDeviceMetricsOverride', {
			width: 1440,
			height: 900,
			deviceScaleFactor: 1,
			mobile: false,
		});

		section('8. 弹窗遮罩铺满视口');
		for (const [width, height] of [
			[1440, 900],
			[768, 900],
			[390, 844],
		]) {
			await cdp.send('Emulation.setDeviceMetricsOverride', {
				width,
				height,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await gotoReady(cdp, base);
			await cdp.evaluate('document.querySelector(\'[data-modal="myModal3"]\').click()');
			await sleep(400);
			const geom = JSON.parse(
				await cdp.evaluate(
					'(function () { var m = document.getElementById("myModal3"); var r = m.getBoundingClientRect();' +
						'return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left),' +
						' t: Math.round(r.top), vw: window.innerWidth, vh: window.innerHeight }); })()'
				)
			);
			check(
				`${width}x${height}: 遮罩铺满视口`,
				`${geom.w}x${geom.h}@${geom.l},${geom.t}`,
				`${geom.vw}x${geom.vh}@0,0`
			);
		}
	} finally {
		if (cdp) {
			cdp.close();
		}
		await server.close();
	}

	console.log('\n----------------------------------------');
	console.log(`PASS ${pass} / ${pass + failures.length}`);
	if (failures.length) {
		console.log('失败项:');
		failures.forEach((name) => console.log(`  - ${name}`));
		process.exitCode = 1;
	}
}

run().catch((err) => {
	console.error('测试运行失败:', err);
	process.exitCode = 2;
});
