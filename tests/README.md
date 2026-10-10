# 测试说明

本站没有构建步骤，测试只做两件事：**守住交互行为**和**守住视觉/响应式契约**。

```bash
npm install          # 首次执行，安装 eslint / prettier / jsdom
npm test             # = lint + 行为测试 + 真实浏览器测试
npm run test:behavior  # 只需 Node（jsdom），秒级
npm run test:browser   # 需本机 Chrome/Edge，约 40s
npm run lint           # ESLint
npm run format:check   # Prettier 格式门禁
```

## 两个测试文件的分工

| 文件               | 环境                   | 适合验证                                                                                                                     |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `behavior.test.js` | jsdom（无需浏览器）    | 入场、弹窗开关、焦点管理、Tab 焦点锁定、Esc、复制成功/失败两条路径、触摸与旋转事件、首屏看门狗、结构契约、资源经 HTTP 可访问 |
| `browser.test.js`  | 真实 Chrome/Edge + CDP | 真实鼠标点击、真实剪贴板读写、计算样式（含响应式断点与图标间距）、控制台异常、网络 4xx、弹窗遮罩铺满视口                     |

`browser.test.js` 会自己拉起静态服务与无头浏览器，结束后清理临时 profile，无需手工准备环境。
可用 `CHROME_PATH` 指定浏览器可执行文件（默认探测 Chrome/Edge 常见安装路径及 Linux/macOS 路径）。

## 写测试的约定

- **只断言可观察行为**：DOM 状态、类名、焦点、事件响应、计算样式。
  不断言内部变量名或函数名，这样重命名与拆分不会误报，行为回归才会红。
- **真实优先**：能走真实路径就不 mock。例如复制功能断言的是「剪贴板里真的是那个邮箱地址」，
  而不是「调用过某个函数」。
- **失败路径必须有测试**：复制失败降级、`main.js` 加载失败（看门狗）都覆盖到了。
- 新增交互功能时，请同步补上对应断言；改了行为却没改测试，`npm test` 应当先红。

## 目录

```
tests/
  behavior.test.js     行为回归（jsdom）
  browser.test.js      端到端（真实浏览器）
  lib/server.js        测试用静态服务（Node 内置 http，零依赖）
  lib/browser.js       无头浏览器启动 + CDP 连接封装
```
