# gemxin.com · 阿鑫的个人主页

单页个人主页，蓝天渐变视觉（纯 CSS 实现，无云层贴图），用于集中展示联系方式。

**在线地址**：https://gemxin.com
**代码仓库**：https://github.com/JokerXins/gemxin

## 技术栈

- 原生 HTML + CSS + JavaScript，无构建步骤
- 交互逻辑集中在 `assets/js/main.js`（入场动画、弹窗无障碍、邮箱一键复制、移动端手势）
- 基于 [HTML5 UP「Aerial」](https://html5up.net/aerial) 模板改造（CCA 3.0 许可，见 `LICENSE.txt`）
- 图标：[Font Awesome 5](https://fontawesome.com/)
- 字体：Source Sans Pro（Google Fonts）
- 托管：GitHub Pages（自定义域名见 `CNAME`）

> 说明：`assets/css/main.css` 是本站实际使用的样式；`assets/sass/` 与 `assets/css/style.css`
> 为上游模板源码/产物，本站未引用，保留仅作参考。

## 目录结构

```
index.html          页面结构
favicon.ico         站点图标
robots.txt          搜索引擎抓取规则
sitemap.xml         站点地图
CNAME               自定义域名
README.md           本文件
LICENSE.txt         模板许可协议
assets/css/         样式（main.css 为本站定制样式）
assets/js/          交互脚本（main.js 为本站交互，anti-debug.js 为可选反调试）
assets/js/vendor/   本地化的第三方库（disable-devtool 固定版本，不走 CDN）
assets/webfonts/    Font Awesome 5 字体
assets/fonts/       模板自带字体
image/              页面用图（公众号二维码等）
```

## 本地预览

页面资源使用相对路径，**建议通过 HTTP 服务访问**。直接双击 `index.html` 时，部分浏览器会因本地文件协议限制而拒绝加载脚本或样式，导致回到「白屏等待动画」的初始状态：

```bash
python -m http.server 8000
# 然后访问 http://localhost:8000
```

## 代码规范与质量校验

开发期工具链**不参与部署产物**（GitHub Pages 仍只发布静态文件）：

```bash
npm install            # 安装 eslint / prettier / jsdom
npm test               # lint + jsdom 行为测试 + 真实浏览器端到端测试
npm run lint           # ESLint（flat config）
npm run format:check   # Prettier 格式门禁（CI 用 check，不用 write）
```

约定要点：

- **命名**：`camelCase` 变量/函数、`UPPER_SNAKE_CASE` 常量、布尔用 `is`/`has` 前缀、名字带单位（如 `COPY_DONE_MS`）。
- **缩进**：沿用上游 HTML5 UP 模板的 **Tab**，LF、文件末尾单换行、无行尾空格（见 `.editorconfig`）。
  这是「项目既有约定优先」的刻意选择：本仓库未引入 ESLint 前的历史排版即为 Tab，全库重排会淹没真实改动。
- **格式边界**：Prettier 只负责**新增文件与配置文件**；`index.html`、`assets/css/main.css`、`assets/js/main.js`、`assets/js/anti-debug.js` 为既有手工排版，已在 `.prettierignore` 中列明。要一次性统一，删掉那几行后执行 `npm run format`。
- **代码要求**：禁 `var`（用 `const`/`let`）、禁空 `catch`、`if` 必须带花括号、单行只写一条语句、复杂处只注释「为什么」。
- **测试**：交互行为必须带回归测试，见 [`tests/README.md`](tests/README.md)。

## 部署

推送到 `main` 分支后由 GitHub Pages 自动构建，约 1~2 分钟生效。

```bash
git add -A
git commit -m "描述改动"
git push origin main
```

## 许可

模板部分遵循 [CCA 3.0](https://html5up.net/license)（见 `LICENSE.txt`）；本站内容版权归作者所有。
