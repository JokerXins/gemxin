# gemxin.com · 阿鑫的个人主页

单页个人主页，蓝天云海视觉，用于集中展示联系方式。

**在线地址**：https://gemxin.com

## 技术栈

- 原生 HTML + CSS + 少量内联 JavaScript，无构建步骤
- 基于 [HTML5 UP「Aerial」](https://html5up.net/aerial) 模板改造（CCA 3.0 许可，见 `LICENSE.txt`）
- 图标：[Font Awesome 5](https://fontawesome.com/)
- 字体：Source Sans Pro（Google Fonts）
- 托管：GitHub Pages（自定义域名见 `CNAME`）

## 目录结构

```
index.html          页面（含弹窗逻辑）
robots.txt          搜索引擎抓取规则
sitemap.xml         站点地图
CNAME               自定义域名
assets/css/         样式（main.css 为本站定制样式）
assets/webfonts/    Font Awesome 5 字体
assets/fonts/       模板自带字体
image/              页面用图（公众号二维码等）
```

## 本地预览

页面使用绝对路径（`/assets/...`），**需通过 HTTP 服务访问**，直接双击打开 `index.html` 会因路径解析失败导致样式丢失：

```bash
python -m http.server 8000
# 然后访问 http://localhost:8000
```

## 部署

推送到 `master` 分支后由 GitHub Pages 自动构建，约 1~2 分钟生效。

```bash
git add -A
git commit -m "描述改动"
git push origin master
```

## 许可

模板部分遵循 [CCA 3.0](https://html5up.net/license)（见 `LICENSE.txt`）；本站内容版权归作者所有。
