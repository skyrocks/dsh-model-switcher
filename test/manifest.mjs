// 发布前自检：包里声明的入口真的存在，cordis.patch.yml 的行名与包名一致，
// files 白名单没漏掉运行时模块。CI 与本机 `node test/manifest.mjs` 都会跑。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFileSync(join(root, name), "utf8");
const manifest = JSON.parse(read("package.json"));

assert.equal(typeof manifest.name, "string");
assert.match(manifest.name, /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/);
assert.equal(typeof manifest.version, "string");
assert.equal(manifest.type, "module");
assert.equal(manifest.dsh?.manifestVersion, 1);
assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");

// 包名必须等于插件行名：DSH 按模块名解析 bundle 里的插件行。
const patch = read("cordis.patch.yml");
const rowName = patch.match(/name:\s*"?([^"\s]+)"?/)?.[1];
assert.equal(rowName, manifest.name, "cordis.patch.yml 的插件行名必须与包名一致");

// 入口与运行时模块都要在 files 白名单里，否则装完缺文件。
for (const file of ["index.js", "match.js", "cordis.patch.yml", "README.md", "LICENSE"]) {
  assert.ok(manifest.files.includes(file), `files 缺少 ${file}`);
  assert.ok(existsSync(join(root, file)), `仓库里缺少 ${file}`);
}
assert.equal(manifest.main, "./index.js");
assert.equal(manifest.exports["."], "./index.js");

// 零运行时依赖：只允许 peerDependencies（宿主已提供）。
assert.equal(manifest.dependencies, undefined);
for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
  assert.match(peer, /^@deepseek-ai\//, `意外的 peerDependency：${peer}`);
}

console.log(`manifest ok — ${manifest.name}@${manifest.version}（插件行 ${rowName}）`);
