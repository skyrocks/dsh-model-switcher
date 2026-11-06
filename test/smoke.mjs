// 不需要 DSH 在跑：匹配逻辑是纯函数，工具体用假的 sessionController / ctx 驱动。
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  AmbiguousModelError,
  flattenCatalog,
  parseQuery,
  rankModels,
  resolveSelection,
  tokenize,
} from "../match.js";
import { apply, inject } from "../index.js";

// ---------------------------------------------------------------- 假目录
const groups = [
  {
    id: "deepseek-official",
    name: "DeepSeek 官方",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        reasoning: { efforts: [{ id: "high", name: "High" }, { id: "max", name: "Max" }], defaultEffort: "high" },
      },
    ],
  },
  {
    id: "opencode-go",
    name: "OpenCode GO",
    models: [
      { id: "glm-4.6", name: "GLM-4.6", description: "旗舰" },
      { id: "glm-4.5-air", name: "GLM-4.5 Air" },
      { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "claude-haiku-3.5", name: "Claude Haiku 3.5" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
      { id: "qwen-max", name: "Qwen Max" },
    ],
  },
];

const directory = {
  current: { provider: "opencode-go", model: "glm-4.6" },
  routable: true,
  groups,
  failures: [],
};

const catalog = flattenCatalog(groups);

// ------------------------------------------------- 指令词剥离 / 归一化
assert.equal(parseQuery("给我换到 glm 模型"), "glm");
assert.equal(parseQuery("切换到 claude sonnet"), "claude sonnet");
assert.equal(parseQuery("switch to gpt-4o"), "gpt 4o");
assert.deepEqual([...new Set(tokenize("用最快的"))].sort(), ["fast", "flash", "lite", "mini", "turbo", "最快的"].sort());

// ------------------------------------------------- 自然语言 → 候选
const top = (query) => rankModels(catalog, query)[0];
assert.equal(top("换成 haiku").model.id, "claude-haiku-3.5");
assert.equal(top("deepseek 推理").model.id, "deepseek-reasoner");
assert.equal(top("帮我切到通义千问").model.id, "qwen-max");
assert.deepEqual(rankModels(catalog, "zzzz"), []);
assert.deepEqual(rankModels(catalog, ""), []);

// 「glm」有两个版本：必须两个都留着，不能替用户挑
const glmCandidates = rankModels(catalog, "换到 glm");
assert.equal(glmCandidates.length, 2, "glm 应命中原样两个版本");
assert.deepEqual(glmCandidates.map((row) => row.model.id).sort(), ["glm-4.5-air", "glm-4.6"]);

// ------------------------------------------------- 解析：宁可报错不猜
assert.deepEqual(
  (({ provider, model, reasoningEffort }) => ({ provider, model, reasoningEffort }))(
    resolveSelection(catalog, { provider: "opencode-go", model: "glm-4.6" }),
  ),
  { provider: "opencode-go", model: "glm-4.6", reasoningEffort: undefined },
);
// 唯一 id 可省略 provider
assert.equal(resolveSelection(catalog, { model: "gpt-4o" }).provider, "opencode-go");
// 带默认推理档位
assert.equal(resolveSelection(catalog, { model: "deepseek-reasoner" }).reasoningEffort, "high");
assert.equal(resolveSelection(catalog, { model: "deepseek-reasoner", reasoningEffort: "max" }).reasoningEffort, "max");
// 模糊到多个 → 抛错并带候选
assert.throws(() => resolveSelection(catalog, { model: "glm 4" }), (error) => {
  assert.ok(error instanceof AmbiguousModelError);
  assert.match(error.message, /匹配到 2 个模型/);
  assert.match(error.message, /glm-4\.6/);
  return true;
});
// 档位不存在 → 报出可用档位
assert.throws(() => resolveSelection(catalog, { model: "deepseek-reasoner", reasoningEffort: "ultra" }), /high.*max/s);
// provider 不存在 → 报出可用 provider
assert.throws(() => resolveSelection(catalog, { provider: "nope", model: "glm-4.6" }), /没有 provider「nope」/);
// 共享关键词不得被当成命中（gpt-9 不能落到 gpt-4o）
assert.throws(() => resolveSelection(catalog, { model: "gpt-9" }), /没有完全匹配的模型/);
// 整串字面命中且唯一 → 允许自动选
assert.equal(resolveSelection(catalog, { model: "haiku" }).model, "claude-haiku-3.5");
assert.equal(resolveSelection(catalog, { model: "claude sonnet" }).model, "claude-sonnet-4");
assert.equal(resolveSelection(catalog, { model: "deepseek reasoner" }).model, "deepseek-reasoner");
// 空 model
assert.throws(() => resolveSelection(catalog, {}), /model 不能为空/);

// ------------------------------------------------- schema 与返回值对齐检查
// 注册表会对返回值做严格校验，这里先自己校验一遍，避免上线才发现形状不对。
// 如果本机装着 DSH，就再借用它自己的校验器验一遍（更严格，且是真正会跑的那套）。
const REAL_TOOLS = [
  process.env.DSH_TOOLS_PATH,
  join(process.env.DSH_HOME ?? "", "profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js"),
].filter((candidate) => typeof candidate === "string" && candidate !== "" && existsSync(candidate));
const real = REAL_TOOLS.length === 0 ? undefined : await import(REAL_TOOLS[0]);
function assertConforms(schema, value, path = "$") {
  if (schema.type === "object") {
    assert.equal(typeof value, "object", `${path} 应为对象`);
    assert.ok(value !== null && !Array.isArray(value), `${path} 应为对象`);
    for (const key of schema.required ?? []) {
      assert.ok(Object.prototype.hasOwnProperty.call(value, key), `${path}.${key} 缺失（required）`);
    }
    const declared = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (declared[key] === undefined) {
        assert.notEqual(schema.additionalProperties, false, `${path}.${key} 未声明，但 schema 关闭了额外字段`);
        continue;
      }
      assertConforms(declared[key], child, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    assert.ok(Array.isArray(value), `${path} 应为数组`);
    for (const [index, item] of value.entries()) assertConforms(schema.items ?? {}, item, `${path}[${index}]`);
    return;
  }
  if (schema.type === "string") assert.equal(typeof value, "string", `${path} 应为字符串`);
  if (schema.type === "number") assert.equal(typeof value, "number", `${path} 应为数字`);
  if (schema.type === "boolean") assert.equal(typeof value, "boolean", `${path} 应为布尔`);
  if (Array.isArray(schema.enum)) assert.ok(schema.enum.includes(value), `${path} 不在 enum 内`);
}

// ------------------------------------------------- 用假 ctx / 假 host 服务跑工具
function buildHarness(options = {}) {
  const registrations = [];
  const calls = [];
  const controller = options.controller === undefined ? {
    modelCatalog: async () => {
      calls.push({ method: "modelCatalog" });
      return {
        default: { provider: "opencode-go", model: "glm-4.6" },
        routableProviders: ["deepseek-official", "opencode-go"],
        groups,
        failures: [],
      };
    },
    selectModel: async (request) => {
      calls.push({ method: "selectModel", request });
      const { provider, model, reasoningEffort } = request;
      return { selected: { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) } };
    },
  } : options.controller;
  const agents = options.agents === undefined ? {
    get: (id) => (id === "session-1" ? { model: { current: () => ({ ...directory.current }) } } : undefined),
  } : options.agents;
  const ctx = {
    tools: {
      register: (definition) => {
        registrations.push(definition);
        return () => {};
      },
    },
    get: (name) => {
      if (name === "sessionController") return controller;
      if (name === "agents") return agents;
      return undefined;
    },
  };
  apply(ctx);
  const byName = new Map(registrations.map((definition) => [definition.name, definition]));
  const run = async (name, args, exec = { agent: { id: "session-1" }, signal: undefined }) => {
    const definition = byName.get(name);
    assert.ok(definition !== undefined, `${name} 未注册`);
    const value = await definition.execute(args, exec);
    assertConforms(definition.output.schema, value, `${name} 返回值`);
    if (real !== undefined) {
      const violations = real.validateJsonSchemaValue(definition.output.schema, value);
      assert.deepEqual(violations, [], `${name} 返回值未通过 DSH 校验器: ${JSON.stringify(violations)}`);
    }
    return value;
  };
  const render = (name, args, value) => byName.get(name).output.render(args, value)[0].text;
  return { registrations, byName, calls, run, render };
}

assert.deepEqual(inject, ["tools"]);

const harness = buildHarness();
assert.deepEqual(harness.registrations.map((definition) => definition.name).sort(), ["find_models", "switch_model"]);
for (const definition of harness.registrations) {
  assert.equal(definition.parameters.type, "object");
  assert.equal(typeof definition.description, "string");
  assert.ok(definition.description.length > 40, `${definition.name} 的描述要够模型判断`);
}

// find_models 不带 query → 完整目录
const all = await harness.run("find_models", {});
assert.equal(all.matched, false);
assert.equal(all.total, 9);
assert.equal(all.models.length, 9);
assert.deepEqual(all.current, { provider: "opencode-go", model: "glm-4.6", name: "GLM-4.6" });
const allText = harness.render("find_models", {}, all);
assert.match(allText, /当前模型：GLM-4\.6/);
assert.match(allText, /完整目录，共 9 个/);
assert.match(allText, /候选不止一个：请把上面的候选列给用户/);

// find_models 带 query → 只列 glП 两个版本，并明确要求用户选
const glm = await harness.run("find_models", { query: "换到 glm" });
assert.equal(glm.matched, true);
assert.equal(glm.models.length, 2);
assert.deepEqual(glm.models.map((row) => row.model).sort(), ["glm-4.5-air", "glm-4.6"]);
const glmText = harness.render("find_models", { query: "换到 glm" }, glm);
assert.match(glmText, /匹配到 2 个/);
assert.match(glmText, /provider: opencode-go · model: glm-4\.6/);
assert.match(glmText, /让用户自己选|等用户选定/);

// find_models 带推理档位的模型要报出来
const reasoner = await harness.run("find_models", { query: "推理" });
const reasonerRow = reasoner.models.find((row) => row.model === "deepseek-reasoner");
assert.ok(reasonerRow !== undefined);
assert.deepEqual(reasonerRow.efforts, ["high", "max"]);
assert.equal(reasonerRow.defaultEffort, "high");

// switch_model 精确切换
const switched = await harness.run("switch_model", { provider: "opencode-go", model: "glm-4.6" });
assert.equal(switched.provider, "opencode-go");
assert.equal(switched.model, "glm-4.6");
assert.equal(switched.name, "GLM-4.6");
const selectCall = harness.calls.find((call) => call.method === "selectModel");
assert.deepEqual(selectCall.request, { sessionId: "session-1", provider: "opencode-go", model: "glm-4.6" });
assert.match(harness.render("switch_model", {}, switched), /已切换到 GLM-4\.6/);

// 唯一 id 省略 provider 也行
const implicit = await harness.run("switch_model", { model: "gpt-4o" });
assert.equal(implicit.model, "gpt-4o");

// 多个 glm → 拒绝并列出候选
await assert.rejects(
  harness.run("switch_model", { model: "glm 4" }),
  (error) => {
    assert.match(error.message, /匹配到 2 个模型/);
    assert.match(error.message, /列给用户/);
    return true;
  },
);
// 拒绝时不得发生任何切换：到目前为止只有 2 次成功切换
assert.equal(harness.calls.filter((call) => call.method === "selectModel").length, 2, "被拒绝的调用不应产生 selectModel");

// 推理档位透传
const effortSwitch = await harness.run("switch_model", { model: "deepseek-reasoner", reasoningEffort: "max" });
assert.equal(effortSwitch.reasoningEffort, "max");
const effortCall = harness.calls.filter((call) => call.method === "selectModel").at(-1);
assert.equal(effortCall.request.reasoningEffort, "max");

// ------------------------------------------------- 失败路径
// host 服务缺失：工具要给出可读错误，而不是崩
const captured = [];
apply({ tools: { register: (definition) => captured.push(definition) }, get: () => undefined });
const findBare = captured.find((definition) => definition.name === "find_models");
await assert.rejects(
  findBare.execute({}, { agent: { id: "s1" } }),
  /没有挂载 sessionController 服务/,
);

// 拿不到 sessionId
await assert.rejects(harness.run("find_models", {}, {}), /拿不到 sessionId/);

// 原始定义自己校验参数：未知字段、错类型、缺必填都要拒绝
await assert.rejects(harness.run("find_models", { query: 3 }), /参数「query」必须是字符串/);
await assert.rejects(harness.run("find_models", { nope: "x" }), /不认识的参数「nope」/);
await assert.rejects(harness.run("switch_model", { provider: "opencode-go" }), /缺少必填参数「model」/);
await assert.rejects(harness.run("switch_model", { model: "   " }), /缺少必填参数「model」/);
await assert.rejects(harness.run("switch_model", { model: "glm-4.6", extra: 1 }), /不认识的参数「extra」/);

// host 服务报错 → 原话透出
const failing = {
  modelCatalog: async () => {
    throw new Error("session-not-found no such session");
  },
  selectModel: async () => {
    throw new Error("不该走到这里");
  },
};
const failingHarness = buildHarness({ controller: failing });
await assert.rejects(failingHarness.run("find_models", {}), /session-not-found no such session/);

// 目录里有 provider 失败项 → 如实转述
const failureHarness = buildHarness({
  controller: {
    modelCatalog: async () => ({
      default: { provider: "opencode-go", model: "glm-4.6" },
      routableProviders: ["opencode-go"],
      groups,
      failures: [{ id: "broken", name: "Broken 路由", message: "timeout" }],
    }),
    selectModel: async () => {
      throw new Error("unused");
    },
  },
});
const failureValue = await failureHarness.run("find_models", {});
assert.equal(failureValue.failures.length, 1);
assert.match(failureHarness.render("find_models", {}, failureValue), /目录读取失败：timeout/);

if (real !== undefined) {
  for (const definition of harness.registrations) {
    real.assertSupportedJsonSchema(definition.output.schema);
    real.assertSupportedJsonSchema(definition.parameters);
  }
}
console.log(`smoke ok — 匹配、候选歧义、schema 对齐、切换与失败路径全部通过${real === undefined ? "（未找到 DSH，跳过真校验器）" : "（含 DSH 真校验器）"}`);
