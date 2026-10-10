'use strict';

/*
 * 行为回归测试（jsdom，无需真实浏览器）
 *
 * 覆盖 assets/js/main.js 的可观察行为：入场、弹窗开关、焦点管理、
 * Tab 焦点锁定、Esc、邮箱复制成功/失败两条路径、移动端手势、屏幕旋转。
 *
 * 设计原则：只断言 DOM 状态、类名、焦点与事件响应，不依赖任何内部变量名，
 *          因此重命名/重构实现不会误报，行为回归才会红。
 *
 * 运行：npm run test:behavior
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { startServer } = require('./lib/server');

const REPO_ROOT = path.resolve(__dirname, '..');
const PREVIEW_PORT = 8123;

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

/* 取出被测主脚本：优先 index.html 外链的 assets/js/main.js，否则回退内联脚本 */
function loadMainScript(html) {
	const external = /<script[^>]+src="([^"]*main\.js)"[^>]*>/i.exec(html);
	if (external) {
		const rel = external[1].replace(/^\.?\//, '');
		const file = path.join(REPO_ROOT, rel);
		if (!fs.existsSync(file)) {
			throw new Error(`外链主脚本缺失: ${file}`);
		}
		return { code: fs.readFileSync(file, 'utf8'), source: rel };
	}
	const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
	let m;
	while ((m = re.exec(html)) !== null) {
		if (m[1].includes('FOCUSABLE')) {
			return { code: m[1], source: 'index.html 内联脚本' };
		}
	}
	throw new Error('未找到主脚本');
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createScene(html, mainScript) {
	/* 去掉所有 script 标签，脚本由测试自行注入，避免下载外部资源 */
	const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/gi, ''), {
		url: 'https://gemxin.com/',
		runScripts: 'outside-only',
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const doc = window.document;

	window.__scrolls = [];
	window.scrollTo = (x, y) => window.__scrolls.push([x, y]);

	window.__copies = [];
	window.__copyResult = null;
	Object.defineProperty(window.navigator, 'clipboard', {
		configurable: true,
		value: {
			writeText(text) {
				window.__copies.push(text);
				return typeof window.__copyResult === 'function'
					? window.__copyResult(text)
					: Promise.resolve();
			},
		},
	});

	window.__execCalls = [];
	window.__execReturn = true;
	doc.execCommand = (cmd) => {
		window.__execCalls.push(cmd);
		return window.__execReturn;
	};

	window.eval(mainScript.code);
	return { window, doc };
}

function resetScene(doc) {
	doc.body.classList.add('is-preload');
	doc.querySelectorAll('.modal').forEach((modal) => {
		modal.classList.remove('is-open');
		modal.setAttribute('hidden', '');
	});
	doc.body.style.overflow = '';
}

function click(el, window) {
	el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function pressKey(key, window, options) {
	const ev = new window.KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		...options,
	});
	window.document.dispatchEvent(ev);
	return ev;
}

async function run() {
	const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
	const mainCss = fs.readFileSync(path.join(REPO_ROOT, 'assets/css/main.css'), 'utf8');
	const mainScript = loadMainScript(html);
	console.log(`被测主脚本: ${mainScript.source}`);

	const { window, doc } = createScene(html, mainScript);
	const wechatBtn = doc.querySelector('[data-modal="myModal2"]');
	const mailBtn = doc.querySelector('[data-modal="myModal3"]');
	const modal2 = doc.getElementById('myModal2');
	const modal3 = doc.getElementById('myModal3');
	const copyBtn = doc.querySelector('[data-copy]');
	const copyLabel = doc.querySelector('.mail-copy-label');

	section('1. 入场:is-preload 解除');
	check('body 初始带 is-preload', doc.body.classList.contains('is-preload'), true);
	await tick(30);
	check('DOMContentLoaded 后移除 is-preload', doc.body.classList.contains('is-preload'), false);

	section('2. 打开公众号弹窗');
	resetScene(doc);
	wechatBtn.focus();
	click(wechatBtn, window);
	check('移除 hidden', modal2.hasAttribute('hidden'), false);
	check('加上 is-open', modal2.classList.contains('is-open'), true);
	check('锁滚动 overflow=hidden', doc.body.style.overflow, 'hidden');
	check('焦点移到关闭按钮', doc.activeElement === modal2.querySelector('[data-close]'), true);
	check('另一弹窗仍 hidden', modal3.hasAttribute('hidden'), true);

	section('3. 点关闭按钮');
	click(modal2.querySelector('[data-close]'), window);
	check('去掉 is-open', modal2.classList.contains('is-open'), false);
	check('恢复 hidden', modal2.hasAttribute('hidden'), true);
	check('解锁滚动', doc.body.style.overflow, '');
	check('焦点归还触发按钮', doc.activeElement === wechatBtn, true);

	section('4. 点遮罩空白处关闭');
	resetScene(doc);
	click(wechatBtn, window);
	click(modal2, window);
	check('遮罩点击关闭', modal2.classList.contains('is-open'), false);
	check('遮罩点击后解锁滚动', doc.body.style.overflow, '');
	check('焦点归还', doc.activeElement === wechatBtn, true);

	section('5. 点弹窗内容区不关闭');
	resetScene(doc);
	click(wechatBtn, window);
	click(modal2.querySelector('.mhint'), window);
	check('内容区点击保持打开', modal2.classList.contains('is-open'), true);
	click(modal2.querySelector('[data-close]'), window);

	section('6. Esc 关闭(且焦点归还)');
	resetScene(doc);
	click(mailBtn, window);
	check('邮箱弹窗已打开', modal3.classList.contains('is-open'), true);
	pressKey('Escape', window);
	check('Esc 关闭弹窗', modal3.classList.contains('is-open'), false);
	check('Esc 后解锁滚动', doc.body.style.overflow, '');
	check('Esc 后焦点归还', doc.activeElement === mailBtn, true);

	section('7. Tab 焦点锁定');
	resetScene(doc);
	click(wechatBtn, window);
	const closeBtn = modal2.querySelector('[data-close]');
	closeBtn.focus();
	const tabEv = pressKey('Tab', window);
	check('Tab 回绕被拦截', tabEv.defaultPrevented, true);
	check('焦点留在弹窗内(回到自身)', doc.activeElement === closeBtn, true);
	closeBtn.focus();
	const shiftEv = pressKey('Tab', window, { shiftKey: true });
	check('Shift+Tab 回绕被拦截', shiftEv.defaultPrevented, true);
	click(closeBtn, window);

	section('8. 复制成功路径');
	resetScene(doc);
	window.__copyResult = () => Promise.resolve();
	window.__copies.length = 0;
	click(copyBtn, window);
	await tick(20);
	/* 期望值从页面元素读取,换邮箱只需改 index.html 一处 */
	check(
		'调用 clipboard.writeText 且内容与 data-copy 一致',
		window.__copies.join('|'),
		copyBtn.dataset.copy
	);
	check(
		'data-copy 是合法邮箱格式',
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(copyBtn.dataset.copy),
		true
	);
	check('按钮出现 is-done', copyBtn.classList.contains('is-done'), true);
	check('成功时不残留 is-fail', copyBtn.classList.contains('is-fail'), false);
	check('文案变为已复制', copyLabel.textContent, '已复制到剪贴板');
	check('未走 execCommand 降级', window.__execCalls.length, 0);

	section('9. 复制失败路径(降级 execCommand 失败,3.2s 后复位文案)');
	await tick(2100); /* 让上一节的 2s 定时器自然结束，本节计时从零开始 */
	window.__copyResult = () => Promise.reject(new Error('denied'));
	window.__execReturn = false;
	window.__execCalls.length = 0;
	click(copyBtn, window);
	await tick(20);
	check('降级调用 execCommand(copy)', window.__execCalls.join('|'), 'copy');
	check('失败标记 is-fail', copyBtn.classList.contains('is-fail'), true);
	check('失败时不再显示成功样式(is-done 被替换)', copyBtn.classList.contains('is-done'), false);
	check('失败文案', copyLabel.textContent, '复制失败，请手动选中');
	await tick(2000);
	check('3.2s 未到,失败提示仍在(失败态停留更久)', copyLabel.textContent, '复制失败，请手动选中');
	await tick(1400);
	check('3.2s 后回默认文案', copyLabel.textContent, '复制邮箱地址');
	check('失败标记已清除', copyBtn.classList.contains('is-fail'), false);
	window.__execReturn = true;

	section('10. 复制两连击只复位一次(无竞态)');
	window.__copyResult = () => Promise.resolve();
	click(copyBtn, window);
	await tick(10);
	click(copyBtn, window);
	await tick(10);
	check('第二次点击后仍为已复制', copyLabel.textContent, '已复制到剪贴板');
	await tick(2100);
	check('最终回到默认文案', copyLabel.textContent, '复制邮箱地址');

	section('11. 非弹窗区域点击不影响弹窗');
	resetScene(doc);
	click(mailBtn, window);
	click(doc.getElementById('header'), window);
	check('弹窗仍打开', modal3.classList.contains('is-open'), true);
	pressKey('Escape', window);

	section('12. 空场景不报错');
	resetScene(doc);
	let threw = null;
	try {
		pressKey('Escape', window);
		pressKey('Tab', window);
		click(doc.body, window);
		click(doc.getElementById('footer'), window);
	} catch (err) {
		threw = String(err);
	}
	check('无弹窗时各类操作不抛异常', threw, null);
	check('无弹窗时 Esc 不误锁滚动', doc.body.style.overflow, '');

	section('13. 触摸事件不抛错(阻止整页回弹)');
	resetScene(doc);
	threw = null;
	try {
		const touchMove = new window.Event('touchmove', { bubbles: true, cancelable: true });
		doc.getElementById('header').dispatchEvent(touchMove);
		check('非弹窗区域 touchmove 被阻止', touchMove.defaultPrevented, true);
		click(wechatBtn, window);
		const innerTouch = new window.Event('touchmove', { bubbles: true, cancelable: true });
		modal2.querySelector('.modal-box').dispatchEvent(innerTouch);
		check('弹窗内 touchmove 放行', innerTouch.defaultPrevented, false);
		click(modal2.querySelector('[data-close]'), window);
	} catch (err) {
		threw = String(err);
	}
	check('touchmove 处理不抛错', threw, null);

	section('14. 屏幕旋转回到顶部');
	window.__scrolls.length = 0;
	window.dispatchEvent(new window.Event('orientationchange'));
	check('orientationchange 触发 scrollTo(0,0)', JSON.stringify(window.__scrolls), '[[0,0]]');

	section('15. 页面结构与 CSS 契约');
	check(
		'main.css 含 .modal.is-open{display:flex}',
		/\.modal\.is-open\s*\{\s*display:\s*flex/.test(mainCss),
		true
	);
	check(
		'main.css 含 .modal[hidden] 兜底',
		/\.modal\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(mainCss),
		true
	);
	check('main.css 保留 prefers-reduced-motion', mainCss.includes('prefers-reduced-motion'), true);
	check('main.css 保留 :focus-visible', mainCss.includes(':focus-visible'), true);
	check('main.css 保留 backdrop-filter 兜底', mainCss.includes('-webkit-backdrop-filter'), true);
	check(
		'main.css 无失效选择器 .is-preload .content',
		/\.is-preload\s+\.content\b/.test(mainCss),
		false
	);

	/* 业务逻辑必须全部外置；仅允许一段首屏看门狗内联脚本 */
	const inlineBlocks = [
		...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
	].map((m) => m[1]);
	check('内联脚本至多 1 段(首屏看门狗)', inlineBlocks.length <= 1, true);
	check(
		'内联脚本仅做 is-preload 兜底,不含业务逻辑',
		inlineBlocks.every(
			(code) => code.includes('is-preload') && !/addEventListener|\bdata-modal\b/.test(code)
		),
		true
	);
	check('引用本地 main.js', /src="assets\/js\/main\.js"/.test(html), true);
	/* 邮箱三处必须一致:显示文本 / 复制的 data-copy / mailto 链接 */
	{
		const mailBox = doc.getElementById('myModal3');
		const shown = mailBox.querySelector('.mail-addr').textContent.trim();
		const copyable = mailBox.querySelector('[data-copy]').dataset.copy;
		const mailed = (mailBox.querySelector('.mail-alt a').getAttribute('href') || '').replace(
			/^mailto:/,
			''
		);
		check('显示地址与 data-copy 一致', shown, copyable);
		check('mailto 链接与 data-copy 一致', mailed, copyable);

		/* mailto 由「该设备是否注册了 mailto 处理程序」决定能否唤起,与手机/电脑无关:
		   因此文案 ①不假设设备 ②不承诺必然成功。 */
		const altLink = mailBox.querySelector('.mail-alt a');
		const altLabel = altLink.textContent;
		check(
			'mailto 文案不假设设备(电脑/手机/PC/客户端)',
			!/(电脑|手机|PC端|桌面端|客户端)/.test(altLabel),
			true
		);
		check('mailto 文案说明需先配置邮件应用', altLabel.includes('已配置邮件应用'), true);

		/* 链接必须是可被系统接管的普通 mailto:——不能被 JS 拦截、
		   不能新窗口打开,否则移动端唤起逻辑会被破坏 */
		check('mailto 是纯链接形态', altLink.tagName, 'A');
		check('mailto 不带 target(避免新窗口破坏唤起)', altLink.hasAttribute('target'), false);
		check('mailto 不带内联 onclick', altLink.hasAttribute('onclick'), false);

		/* 实际点击:确认没被 preventDefault 吃掉(弹窗的点击委托不能拦它)。
		   jsdom 不会真的唤起邮件应用,但能验证事件是否被拦截。 */
		resetScene(doc);
		click(mailBtn, window); /* 先打开邮箱弹窗 */
		const mailClick = new window.MouseEvent('click', {
			bubbles: true,
			cancelable: true,
		});
		altLink.dispatchEvent(mailClick);
		check('mailto 点击未被 preventDefault 拦截', mailClick.defaultPrevented, false);
		check('点 mailto 不会误关弹窗', mailBox.classList.contains('is-open'), true);
		pressKey('Escape', window);
	}
	/* 文案不得假设用户设备:手机用户同样会看到这段说明 */
	check(
		'弹窗文案不含设备假设(电脑/手机/PC)',
		!/(电脑|手机|PC端|桌面端)/.test(doc.getElementById('myModal3').textContent),
		true
	);
	check('index.html 不含 console.log 调试残留', /console\.log/.test(html), false);
	/* 个人主页不接广告：确保第三方脚本(广告/统计)不会被重新引入 */
	check('无任何第三方脚本', (html.match(/<script[^>]*\bsrc="https?:[^"]+"/gi) || []).length, 0);
	check(
		'无广告代码残留',
		!/adsbygoogle|googlesyndication|pagead|ad-client|googletagmanager|google-analytics/i.test(
			html
		),
		true
	);
	check('index.html 不再引用远端反调试 CDN', html.includes('cdn.jsdelivr.net'), false);
	check(
		'反调试库已本地化',
		fs.existsSync(path.join(REPO_ROOT, 'assets/js/vendor/disable-devtool.min.js')),
		true
	);

	const localRefs = html.match(/(?:src|href)="(?!https?:|mailto:|#)([^"]+)"/g) || [];
	const missing = localRefs
		.map((s) => s.replace(/^.*?="([^"]+)"$/, '$1'))
		.filter((rel) => !fs.existsSync(path.join(REPO_ROOT, rel)));
	check('本地资源引用全部存在', JSON.stringify(missing), '[]');

	section('16. 资源经由 HTTP 可访问(真实服务验证)');
	const server = await startServer(REPO_ROOT, PREVIEW_PORT);
	try {
		for (const rel of [
			'index.html',
			'assets/css/main.css',
			'assets/js/main.js',
			'assets/js/anti-debug.js',
			'assets/js/vendor/disable-devtool.min.js',
			'image/WeChat20260623.png',
		]) {
			const res = await fetch(`${server.url}${rel}`);
			check(`HTTP 200 ${rel}`, res.status, 200);
		}
	} finally {
		await server.close();
	}

	section('17. 首屏看门狗(main.js 加载失败时不空白)');
	{
		/* 只跑内联看门狗，故意不加载 main.js，模拟脚本被拦截/加载失败 */
		const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/gi, ''), {
			url: 'https://gemxin.com/',
			runScripts: 'outside-only',
			pretendToBeVisual: true,
		});
		const watchdog = inlineBlocks.find((code) => code.includes('is-preload'));
		check('存在看门狗脚本', typeof watchdog, 'string');
		check(
			'模拟:main.js 未执行,body 仍带 is-preload',
			dom.window.document.body.classList.contains('is-preload'),
			true
		);
		dom.window.eval(watchdog);
		await tick(2700);
		check(
			'看门狗兜底后解除 is-preload',
			dom.window.document.body.classList.contains('is-preload'),
			false
		);
		dom.window.close();
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
