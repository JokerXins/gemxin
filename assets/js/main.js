/*
	gemxin.com — 阿鑫个人主页交互脚本

	职责（单一入口，按功能分区）：
	  1. 入场：DOM 就绪后移除 body.is-preload，触发首屏动画
	  2. 弹窗：打开 / 关闭 / 遮罩关闭 / Esc 关闭 / Tab 焦点锁定 / 焦点归还
	  3. 复制：Clipboard API 优先，失败降级 execCommand
	  4. 移动端：阻止整页回弹，放行弹窗内滚动

	约定：弹窗用 hidden 属性 + .is-open 类双重控制可见性（见 main.css）；
	      所有事件走委托，不依赖具体节点顺序。
	不做兼容垫片（Promise / classList / closest / dataset / focus-visible），
	目标为现代浏览器；如需支持 IE 请另加 polyfill。
*/
(function () {
	'use strict';

	const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, ' +
		'[tabindex]:not([tabindex="-1"])';
	const COPY_LABEL_READY = '复制邮箱地址';
	const COPY_DONE_MS = 2000;
	const COPY_FAIL_MS = 3200;
	const SCROLL_LOCKED = 'hidden';

	/* 全局状态：同一时刻至多一个弹窗处于打开态 */
	let opener = null;      /* 打开弹窗前获得焦点的元素，关闭后归还焦点 */
	let openModal = null;   /* 当前打开的弹窗 */
	const copyTimers = new WeakMap(); /* 节点 -> 复位定时器，避免把定时器挂到 DOM 上 */

	function byId(id) {
		return document.getElementById(id);
	}

	function on(element, type, handler, options) {
		element.addEventListener(type, handler, options);
	}

	function findOpenModal() {
		return document.querySelector('.modal.is-open');
	}

	function setScrollLock(locked) {
		document.body.style.overflow = locked ? SCROLL_LOCKED : '';
	}

	/* 元素仍在文档中才归还焦点，避免元素被移除后 focus() 抛错 */
	function isAttached(el) {
		return !!(el && el.nodeType === 1 && document.contains(el));
	}

	/* ── 1. 入场 ───────────────────────────────────────────────── */

	function onPageReady() {
		document.body.classList.remove('is-preload');
	}

	function watchPageReady() {
		if (document.readyState === 'loading') {
			on(document, 'DOMContentLoaded', onPageReady);
			return;
		}
		/* script 位于文档末尾：此时 DOM 已就绪，下一帧再解除 preload，
		   保证首屏动画从初始状态开始播。 */
		window.setTimeout(onPageReady, 0);
	}

	/* ── 2. 弹窗 ───────────────────────────────────────────────── */

	function open(id, trigger) {
		const modal = byId(id);
		if (!modal) { return; }

		opener = trigger || document.activeElement;
		modal.removeAttribute('hidden');   /* 先解除 hidden，内部按钮才可聚焦 */
		modal.classList.add('is-open');
		openModal = modal;
		setScrollLock(true);

		const closeBtn = modal.querySelector('[data-close]');
		if (closeBtn) { closeBtn.focus(); }
	}

	function close(modal) {
		if (!modal || !modal.classList.contains('is-open')) { return; }

		modal.classList.remove('is-open');
		modal.setAttribute('hidden', '');  /* 隐藏后内部按钮退出 Tab 序列 */
		if (openModal === modal) { openModal = null; }
		if (!findOpenModal()) { setScrollLock(false); }

		/* 归还焦点：触发元素可能已被移除，先确认仍在文档中 */
		if (isAttached(opener) && typeof opener.focus === 'function') {
			opener.focus();
		}
		opener = null;
	}

	/* 统一关闭入口：关闭按钮与 Esc 共用，确保两条路径都归还焦点并解锁滚动 */
	function closeAll() {
		document.querySelectorAll('.modal.is-open').forEach(close);
	}

	/* 焦点锁定：Tab 在弹窗内循环，不移出到页面其余控件 */
	function onTabKey(ev) {
		if (!openModal) { return; }

		const items = openModal.querySelectorAll(FOCUSABLE);
		if (!items.length) { return; }

		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;

		if (ev.shiftKey && active === first) {
			ev.preventDefault();
			last.focus();
		} else if (!ev.shiftKey && active === last) {
			ev.preventDefault();
			first.focus();
		}
	}

	function onKeyDown(ev) {
		if (ev.key === 'Escape') {
			closeAll();
			return;
		}
		if (ev.key === 'Tab') { onTabKey(ev); }
	}

	/* ── 3. 复制 ───────────────────────────────────────────────── */

	function resetCopy(btn, label) {
		window.clearTimeout(copyTimers.get(btn));
		copyTimers.delete(btn);
		label.textContent = COPY_LABEL_READY;
		btn.classList.remove('is-done', 'is-fail');
	}

	function flashCopy(btn, label, ok) {
		label.textContent = ok ? '已复制到剪贴板' : '复制失败，请手动选中';
		/* 两个状态类互斥：失败态必须覆盖成功态，否则绿底会盖住红色提示。
		   注意不能用 classList.replace() —— 旧类不存在时它什么都不做。 */
		btn.classList.remove(ok ? 'is-fail' : 'is-done');
		btn.classList.add(ok ? 'is-done' : 'is-fail');

		/* 连续点击时取消上一次复位，只有最后一次点击的定时器生效 */
		window.clearTimeout(copyTimers.get(btn));
		const timer = window.setTimeout(function () {
			copyTimers.delete(btn);
			resetCopy(btn, label);
		}, ok ? COPY_DONE_MS : COPY_FAIL_MS);
		copyTimers.set(btn, timer);
	}

	function handleCopy(btn) {
		const text = btn.dataset.copy || '';
		const label = btn.querySelector('.mail-copy-label') || btn;
		copyText(text).then(function (ok) {
			flashCopy(btn, label, ok);
		});
	}

	/* Clipboard API 优先；不可用或失败时降级 execCommand */
	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text).then(function () {
				return true;
			}, function () {
				return fallbackCopy(text);
			});
		}
		return Promise.resolve(fallbackCopy(text));
	}

	function fallbackCopy(text) {
		const field = document.createElement('textarea');
		try {
			field.value = text;
			field.setAttribute('readonly', '');
			/* 必须留在渲染树内 select() 才有效，因此用移出视口代替 display:none */
			field.style.position = 'fixed';
			field.style.top = '-9999px';
			field.style.opacity = '0';
			document.body.appendChild(field);
			field.select();
			field.setSelectionRange(0, text.length);
			return !!document.execCommand('copy');
		} catch (err) {
			/* 降级失败：UI 会提示"复制失败，请手动选中"，这里补一条带原因的日志便于排查 */
			console.warn('复制降级方案执行失败，请在页面上手动选中邮箱地址。', err);
			return false;
		} finally {
			/* 无论成败都回收，避免节点泄漏 */
			field.value = '';
			if (field.parentNode) { field.parentNode.removeChild(field); }
		}
	}

	/* ── 4. 事件委托 ───────────────────────────────────────────── */

	/* 从事件目标向上找第一个带指定 data 属性的元素 */
	function closestWithAttr(node, attr) {
		let el = node;
		while (el && el.nodeType === 1) {
			if (el.hasAttribute(attr)) { return el; }
			el = el.parentElement;
		}
		return null;
	}

	const clickResponders = [
		['data-copy', function (el) { handleCopy(el); }],
		['data-modal', function (el) { open(el.getAttribute('data-modal'), el); }],
		['data-close', function (el) { close(el.closest('.modal')); }]
	];

	function respondToClick(ev) {
		for (const [attr, respond] of clickResponders) {
			const el = closestWithAttr(ev.target, attr);
			if (el) {
				ev.preventDefault();
				respond(el);
				return;
			}
		}
		/* 点击遮罩空白处关闭；点弹窗内容区不关闭 */
		if (ev.target.classList && ev.target.classList.contains('modal')) {
			close(ev.target);
		}
	}

	/* 阻止整页上下拖拽回弹；事件目标位于弹窗内时放行（弹窗可滚动） */
	function onTouchMove(ev) {
		if (ev.target.closest && ev.target.closest('.modal')) { return; }
		ev.preventDefault();
	}

	/* 屏幕旋转后回到顶部，避免停留在横屏时的滚动位置 */
	function onOrientationChange() {
		window.scrollTo(0, 0);
	}

	function init() {
		watchPageReady();
		on(document, 'click', respondToClick);
		on(document, 'keydown', onKeyDown);
		on(window, 'touchmove', onTouchMove, { passive: false });
		on(window, 'orientationchange', onOrientationChange);
	}

	init();
})();
