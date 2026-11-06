# Changelog

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
