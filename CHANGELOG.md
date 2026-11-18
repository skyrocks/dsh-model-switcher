# Changelog

## 0.2.2

- 补上插件图标与本地化名称：新增 `icon.svg`（`exports["./icon"]`）和 `locale/{zh,en}.json`
  （`meta.title` / `meta.description`）。此前设置页的插件列表只能回退成包名、也没有图标。
- 安装包不再包含 `test/`：运行时本来就不碰文件系统，但自动化商店的源码扫描会把包内测试里的
  `node:fs` 判成「插件会读写本机文件」的权限信号。仓库内的测试与 CI 不受影响。

## 0.2.1

- **修复 DSH `0.2.1-rc.3` 上两个工具全部失效**：模型目录与切换改走 host 服务
  `sessionController.modelCatalog()` / `selectModel()`，替代已被移除的 `apiProxy` 网关；
  当前选中项读 `agents.get(sessionId).model.current()`，读不到时退回目录里的部署默认。
- 兼容范围收敛为 `>= 0.2.1-rc.3 < 0.3.0`（旧版本没有该服务）。
- 骨架对齐同作者其余插件：补 `README.en.md`、`CHANGELOG.md`、`PUBLISHING.md`、
  `CHANGELOG`/CI 工作流、`.gitignore` / `.gitattributes`，以及 `test/manifest.mjs` 清单自检。
- 新增 `npm run check`（包清单自检），`npm test` 保持为纯 Node 冒烟测试。
- 描述里去掉「只依赖网关」的说法；README 补安装、歧义规则、FAQ 与原理图。

## 0.2.0

- 首次成型：`find_models` / `switch_model` 两个模型可调用工具。
- 多版本歧义时列出候选、由用户决定，不替用户猜；只有整串唯一命中才自动选。
- 纯 JSON Schema 手写工具定义，零运行时依赖，可本地 `link:` 目录直装。
