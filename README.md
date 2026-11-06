# dsh-model-switcher

[English](README.en.md) | 简体中文

给 **DeepSeek Harness**（`dsh`）用的**模型切换工具插件**：把「查目录 / 切模型」做成模型可调用的
function call，你在对话里说一句「换到 glm」就够了。手动选模型仍然用内置 `/model` 弹窗——
这里不重造轮子，只是让模型也能拿到同一份目录、走同一条切换路径。

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![dsh](https://img.shields.io/badge/DSH-0.2.1--rc.3%20line-4d6bfe)
![node](https://img.shields.io/badge/node-%3E%3D18-339933)
![dependencies](https://img.shields.io/badge/runtime%20deps-0-6bd586)

```text
你：有哪些便宜又快的模型？

当前模型：DeepSeek V4.1 Flash · provider: opencode-go · model: deepseek-v4.1-flash
匹配到 4 个（目录里共 31 个）：
- DeepSeek-V4.1-Flash · provider: deepseek-account · model: deepseek-flash · 推理档位 off/low/high/max（默认 high）
- Qwen3.8 Flash · provider: opencode-go · model: qwen3.8-flash · 推理档位 off/minimal/low/medium/high
- GLM-5.3-Flash · provider: opencode-go · model: glm-5.3-flash · 推理档位 low/high/max
- MiMo-V2.6-Flash · provider: opencode-go · model: mimo-v2.6-flash · 推理档位 off/minimal/low/medium/high
→ 候选不止一个：请把上面的候选列给用户，等用户选定后再调用 switch_model。

你：那就 GLM-5.3-Flash

已切换到 GLM-5.3-Flash（推理档位 low） · provider: opencode-go · model: glm-5.3-flash
已对当前会话生效，并保存为默认模型。
```

---

## 为什么用它

- **一句自然语言就够**：不用记精确 id，也不用去弹窗里翻 30 多个模型。
- **和 `/model` 同源**：候选来自 DSH 自己的模型目录（`sessionController.modelCatalog()`），
  切换走同一个 `selectModel()`，看到什么就切到什么，不硬编码、不猜测。
- **多版本时让你决定**：说「glm」会命中 `glm-5.2` / `glm-5.3` / `glm-5.3-flash`，
  插件不会替你挑，而是把候选摆出来等你选。
- **零运行时依赖**：没有 zod、没有原生模块，GitHub 目录直装也不会缺包。
- **不碰你的东西**：不读写文件、不跑 shell、不发外部请求。

---

## 两个工具

| 工具 | 参数 | 做什么 |
| --- | --- | --- |
| `find_models` | `query?`（自然语言或关键词） | 查当前会话真正可选的模型。不带 `query` 给完整目录；带 `query` 按相关度排序，最多 25 条 |
| `switch_model` | `model`（必填）、`provider?`、`reasoningEffort?` | 真正切换，从下一次模型请求起生效，同时保存为默认模型 |

`find_models` 的返回值里带 `current`（当前模型）、`models`（候选，含推理档位）、
`failures`（某个 provider 目录读取失败时如实转述，不影响其它 provider）。

---

## 多版本怎么处理（这个插件的重点）

「换成 glm」在真实目录里通常不止一个候选，此时：

- `find_models` 返回**全部候选**，并在结果里明确要求模型把候选逐个列给你、等你选；
- `switch_model` 遇到歧义会**直接报错并列出候选**，绝不替你猜；
- 只有「整串字面命中且唯一」才会自动选：`haiku` → `claude-haiku-5-5` 可以，
  `gpt-9` 不会被当成 `gpt-6-luna`。

同一个 `model` id 出现在两个 provider 下时（比如 `deepseek-v4-pro`），必须带 `provider`。
宁可多问一句，也不切错模型。

---

## 环境要求

| 项 | 要求 |
| --- | --- |
| DSH | `>= 0.2.1-rc.3 < 0.3.0`（桌面版与 `dsh web` 均可） |
| Node | `>= 18`（桌面版内置 Node 24） |
| 依赖 | 无（零运行时依赖，纯 ESM） |
| 系统 | macOS 已验证；Windows / Linux 预期可用（无平台分支） |

---

## 安装

### 在 DSH 桌面端安装（图形界面，推荐）

1. 打开 DSH 桌面端，进入插件管理页（设置 →「插件」）。
2. 点「添加插件」，在弹窗里粘贴：
   ```
   github:skyrocks/dsh-model-switcher
   ```
3. 确认安装，等待依赖解析完成。
4. **完全退出 DSH 再重新打开**（macOS 用 `Cmd+Q`；Windows 从托盘退出）。
   只关窗口不够——Host 插件只在启动时加载。
5. 新开一个会话，说「列一下模型」验证。插件列表里会显示 `@skyrocks/dsh-model-switcher`
   （插件行 id 为 `model-switcher`）。

### 从命令行安装（可选）

```sh
# GitHub（推荐）
dsh plugin --profile desktop add github:skyrocks/dsh-model-switcher

# 本地目录（开发）
dsh plugin --profile desktop add /absolute/path/to/dsh-model-switcher
```

> `desktop` 是桌面版 profile；如果你用的是 `dsh web`，换成 `--profile web`。
> 安装完成后同样要**完全退出并重启 DSH**。

---

## 用法

在对话里直接说，模型自己决定调工具：

```
有哪些模型？
列一下 glm 系列
换到 claude haiku
用最便宜的那个
切到 deepseek 推理
```

也可以直接报精确 id（`换成 glm-5.3`），一步到位。切错了用内置 `/model` 换回去即可。

支持的表述：中英文混说、口语指令（「帮我换成…」「切到…」「switch to …」）、
同义词扩展（最快 → flash / turbo / mini / lite，最强 → pro / max / ultra，
推理 → reasoner / thinking，智谱 → glm，月之暗面 → kimi / moonshot 等）。

---

## 工作原理

```text
用户在对话里说「换到 glm」
        │
        ▼
模型调用工具                         ┌──────────────── Host（Node）────────────────┐
  find_models("换到 glm") ──────────▶│ ctx.get("sessionController")               │
  switch_model("glm-5.3")   ────────▶│  ├─ modelCatalog()                         │
                                     │  │    ← ctx.llm.listProviders()/listModels()│
                                     │  │      （与 /model 弹窗同源）              │
                                     │  ├─ agents.get(sessionId).model.current()  │
                                     │  │    （当前选中项，读不到退回部署默认）    │
                                     │  └─ selectModel({ sessionId, provider,     │
                                     │        model, reasoningEffort? })          │
                                     │       ← /model 弹窗同一条写入路径          │
                                     └────────────────────────────────────────────┘
```

- **sessionId** 取 `(exec.agent).id`：工具永远作用于触发它的那个会话。
- **不 import 任何 `@deepseek-ai` 包**：本地 `link:` 安装时插件目录解析不到 profile 的
  `node_modules`，所以工具定义用原生 JSON Schema 手写（`ctx.tools.register` 接受原始
  `ToolDefinition`，`defineTool` 只是带类型的语法糖），服务只在运行时用 `ctx.get()` 取。
- 目录读取失败（例如 provider 缺 Key）不会让工具整体报错，会出现在 `failures` 里。

### 版本注记

早期版本走的是 `ctx.apiProxy.sessions.models/selectModel`；DSH `0.2.1-rc.3` 已移除该服务，
照旧写会报「没有挂载 apiProxy 网关」。`0.2.1` 起改用 `sessionController`。

---

## 兼容性

- **已验证**：DSH `0.2.1-rc.3`（macOS 桌面版），实测目录 31 个模型、两个 provider 正常读取与切换。
- **服务契约**：host 服务 `sessionController`（`@deepseek-ai/dsh-api-session-controller`）
  提供 `modelCatalog()` / `selectModel()`；当前选中项读 `agents` 服务的
  `agent.model.current()`。
- **0.2.0 及更早**：依赖已被移除的 `apiProxy`，在 `0.2.1-rc.3` 上两个工具都会报错，
  请升级到 `0.2.1`。
- **0.3.x**：`engines.dsh` 会拒绝安装；如确需尝试，可用 `dsh plugin allow-version` 放行，
  但服务名与签名可能已变。

---

## 常见问题

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 工具列表里没有 `find_models` | 没重启，或装到了别的 profile | 完全退出重启；确认装的是当前 profile（`desktop` / `web`） |
| 报「没有挂载 sessionController 服务」 | DSH 版本太旧，或部署未挂载 session controller | 升级到 `0.2.1-rc.3+` |
| 报「没有挂载 apiProxy 网关」 | 装的是 `0.2.0` 及更早版本 | 升级到 `0.2.1` |
| `find_models` 里有 `failures` 条目 | 该 provider 目录读取失败（常见于缺 Key） | 在「设置 → 模型」补上凭据；其它 provider 不受影响 |
| 说「换到 glm」后只列候选没切换 | 命中了多个模型，按设计等你选 | 回一句精确的名字，如「GLM-5.3」 |
| 切换后当前这轮回复仍是旧模型 | 选择从**下一次模型请求**起生效 | 下一条消息即生效 |
| 切完发现默认模型也被改了 | 与 `/model` 行为一致，会一并保存默认 | 用 `/model` 换回去即可 |
| 同一个名字报「provider 不唯一」 | 该 id 在多个 provider 下都存在 | 带上 `provider`，如「opencode-go 的 deepseek-v4-pro」 |

---

## 开发

```sh
node test/smoke.mjs     # 匹配逻辑 + 工具契约 + 失败路径（不需要 DSH 在跑）
node test/manifest.mjs  # 包清单自检：入口存在、插件行名 == 包名、零运行时依赖
node --check index.js match.js
```

本地迭代：

```sh
# 1. 以目录方式安装（link:）
dsh plugin --profile desktop add /absolute/path/to/dsh-model-switcher

# 2. 改源码

# 3. Cmd+Q 完全退出并重启 DSH
```

改动 `package.json` 的 `dsh.bundle` 声明后，需要重新执行一次 `add`。
CI 会在 Ubuntu / macOS / Windows 的 Node 22、24 上跑同一套测试。

---

## 项目结构

```text
dsh-model-switcher/
├── index.js            # 两个工具的注册与实现（Host 半，零依赖）
├── match.js            # 纯函数：查询归一化、别名扩展、候选打分、歧义解析
├── cordis.patch.yml    # 插件行（安装后自动注入 profile）
├── package.json        # dsh.bundle 声明 + exports + files 白名单
├── test/smoke.mjs      # 回归测试：匹配、歧义、schema、失败路径
├── test/manifest.mjs   # 包清单自检（CI 也会跑）
├── README.md           # 中文说明
└── README.en.md        # English readme
```

---

## 隐私与安全

- **只在 Host 进程内调用 DSH 已有的服务**，不额外发任何网络请求。
- **不读写文件、不执行 shell、没有遥测**。
- 工具输出只包含 provider、model id、显示名、推理档位与 provider 读取失败原因。
- 本插件与 DeepSeek 无隶属关系，是社区插件。

---

## 已知限制

- 只有工具，没有界面：想手动点选请继续用 `/model`。
- 不缓存目录：每次调用都读一次实时目录（目录本身由 DSH 缓存）。
- 排序是启发式的：别名表覆盖常见说法，生僻昵称可能匹配不到，这时直接报精确 id。
- 子会话（subagent）里同样可用，作用域是当前 agent 自己的会话。

## 路线图

- [ ] 目录结果的本地短缓存，减少连续调用时的重复读取
- [ ] 支持按能力标签（视觉 / 代码 / 长上下文）筛选
- [ ] 切换前展示价格与上下文窗口对比
- [ ] Windows 实机验证与 CI 全绿截图

---

## 参与贡献

欢迎 issue 和 PR。反馈时请附上：

- DSH 版本与操作系统；
- `find_models` 的完整输出（可以脱敏 provider 名）；
- 触发时的原话。

提交 PR 前请确保 `node test/smoke.mjs`、`node test/manifest.mjs` 通过，并保持
**零运行时依赖**。

---

## License

[MIT](LICENSE)

> 非官方插件，与 DeepSeek 无隶属关系。
