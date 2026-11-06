# 发布清单（维护者用）

这份文件不会随 tarball 发布，只用于把仓库整理成可公开的状态。

## 1. 检查

```sh
node test/smoke.mjs      # 匹配 / 歧义 / schema / 失败路径
node test/manifest.mjs   # 入口存在、插件行名 == 包名、零运行时依赖
node --check index.js match.js
grep -n "Users/shilei" README.md README.en.md package.json   # 应无输出
```

## 2. 上传

仓库根目录是 **本目录的内容**（`package.json` 与 `cordis.patch.yml` 在根），
不要把外层父目录一起上传，否则 `github:skyrocks/dsh-model-switcher` 安装会找不到插件清单。

```sh
git init -b main
git add -A
git commit -m "feat: model switcher tools for DeepSeek Harness"
gh repo create skyrocks/dsh-model-switcher --public --source=. --remote=origin --push
git tag v0.2.1
git push origin v0.2.1
```

## 3. Release

```sh
pnpm pack     # 产出 skyrocks-dsh-model-switcher-0.2.1.tgz
gh release create v0.2.1 ./skyrocks-dsh-model-switcher-0.2.1.tgz \
  --title "v0.2.1" --generate-notes
```

npm 发布当前暂停（安装只走 GitHub）。恢复时补 `npm publish --access public` 与 npm 徽章。

## 4. 发布前检查

- [x] `node test/smoke.mjs` 通过
- [x] `node test/manifest.mjs` 通过（插件行名 == 包名）
- [x] `index.js` / `match.js` 语法检查通过
- [x] 仓库内没有本机绝对路径（`/Users/shilei/...`）
- [x] `package.json` 含 `repository` / `homepage` / `bugs` / `publishConfig`
- [x] 零运行时依赖（无 `dependencies`）
- [ ] CI 在 Ubuntu / macOS / Windows 上全绿（推送后自动跑）
- [ ] 安装路径实测：粘贴 `github:skyrocks/dsh-model-switcher` 后完全退出重启，新会话里
      `find_models` 能返回真实目录
- [ ] Release 附件与 `package.json` 版本一致

## 5. 本机发布记录（2026-11-06）

- 仓库已创建并推送：<https://github.com/skyrocks/dsh-model-switcher>，公开，默认分支 `main`，
  tag `v0.2.1`。
- 本机 `github.com:443` 不可达、GitHub 上也未登记本机 SSH key（`ssh -T git@github.com`
  为 `Permission denied (publickey)`），只有 `api.github.com` 与 `codeload.github.com` 可用。
  因此推送走 **GitHub Git Data API**（blob → tree → commit → ref），本地 `git push` 会失败。
- 空仓库不能直接建 blob（`409 Git Repository is empty.`），所以先用 Contents API 造了一个
  `chore: initialize repository` 提交，再在上面接 `feat: model switcher tools for DeepSeek Harness`。
- `.github/workflows/ci.yml` **未推送**：gh token 的 scope 是 `gist, read:org, repo`，缺
  `workflow`；带该文件的 tree / contents 请求一律返回 `404 Not Found`（GitHub 对 workflow
  路径的 scope 拦截表现成 404，不是 403）。补推步骤：

  ```sh
  gh auth refresh -h github.com -s workflow
  dsh-note  # 网络可用时直接 git push 即可
  ```

  或者走 API：

  ```sh
  gh api -X PUT /repos/skyrocks/dsh-model-switcher/contents/.github/workflows/ci.yml \
    -f message="ci: add workflow" \
    -f content="$(base64 -i .github/workflows/ci.yml)"
  ```

- 本地两个提交与远端消息、文件树一致，但 **sha 不同**（远端 root 提交由 API 生成）。
  网络恢复后对齐：

  ```sh
  git fetch origin
  git reset --hard origin/main   # 之后补 ci.yml 再提交一次
  ```
- 安装路径实测：`curl -sSL https://codeload.github.com/skyrocks/dsh-model-switcher/tar.gz/refs/heads/main`
  解包后包含 `package.json` + `cordis.patch.yml` + `index.js` + `match.js`，包内
  `node test/smoke.mjs`、`node test/manifest.mjs` 均通过——`github:skyrocks/dsh-model-switcher`
  这种目录安装拿到的就是这份内容。

## 6. 契约备忘（改代码前先看这几行）

- 目录：`ctx.get("sessionController").modelCatalog()` →
  `{ default, routableProviders, groups, failures }`，与 `/model` 弹窗同源。
- 切换：`sessionController.selectModel({ sessionId, provider, model, reasoningEffort? })` →
  `{ selected }`；会话作用域取 `(exec.agent).id`。
- 当前选中项：`ctx.get("agents").get(sessionId).model.current()`，取不到时退回
  `modelCatalog().default`。
- 旧的 `ctx.apiProxy.sessions.models/selectModel` 在 DSH `0.2.1-rc.3` 已被移除，
  **不要**为了兼容把它加回来；旧部署会走 `engines.dsh` 拦截。
- 插件行名必须等于 `package.json` 的 `name`（`@skyrocks/dsh-model-switcher`），
  否则 Host 启动时找不到模块——`test/manifest.mjs` 会守住这条。
