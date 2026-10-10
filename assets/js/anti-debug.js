/*
	gemxin.com — 反调试初始化（可选功能，删掉本文件与 index.html 中对应 <script> 即可移除）

	为什么本地化而不走 CDN：
	  1. 供应链风险 —— 远端脚本一旦被篡改，等于把任意代码注入本站；
	  2. 可用性 —— CDN 抖动/被墙时不再依赖第三方；
	  3. 行为锁定 —— 固定版本，上游改默认行为不会悄悄影响本站。

	关键设置 ondevtoolopen：库的默认回调会 window.close() 并跳转 404，
	在部分浏览器 / 插件 / 自动化环境下会误判，直接把页面销毁成白屏。
	这里覆盖为「只打印提示、不破坏页面」。
*/
(function () {
	'use strict';

	function initAntiDebug() {
		if (typeof window.DisableDevtool !== 'function') { return; }

		window.DisableDevtool({
			md5: '',
			url: '',
			timeOutUrl: '',
			disableMenu: false,
			clearIntervalWhenDevOpenTrigger: false,
			/* 只提示、不破坏页面：默认回调会 window.close() 并跳转 404 */
			ondevtoolopen: function (type) {
				console.warn(`检测到开发者工具已打开 (type=${type})。`);
			}
		});
	}

	/* defer 脚本执行时 DOM 已就绪；仍做双保险，兼容被改为 async 的场景 */
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initAntiDebug);
	} else {
		initAntiDebug();
	}
})();
