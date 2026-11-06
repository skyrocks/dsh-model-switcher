// Host 半：把「切换模型」做成模型可调用的工具（function call）。
//
// 没有自己的界面：手动选模型仍用 DSH 内置的 /model 弹窗；这里的价值是让
// 模型能在对话里查目录、并在多版本时把候选摊给用户选。
//
// 数据与切换都走 DSH 自己的 host 服务（ctx.sessionController.modelCatalog /
// selectModel），与浏览器 /model 弹窗调的是同一层，所以看到的候选、切换的效果
// 完全一致。
// 不 import 任何 @deepseek-ai 包：本地 link 的插件目录解不到 profile 的
// node_modules，只用 node 内置与 ctx 服务，避免加载期解析失败。
import { AmbiguousModelError, describeCandidate, flattenCatalog, rankModels, resolveSelection } from "./match.js";

const MODEL_ROW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: { type: "string" },
    providerName: { type: "string" },
    model: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    efforts: { type: "array", items: { type: "string" } },
    defaultEffort: { type: "string" },
  },
  required: ["provider", "providerName", "model", "name", "description", "efforts"],
};

const FIND_MODELS_OUTPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    current: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "string" },
        model: { type: "string" },
        name: { type: "string" },
        reasoningEffort: { type: "string" },
      },
      required: ["provider", "model", "name"],
    },
    routable: { type: "boolean" },
    matched: { type: "boolean" },
    total: { type: "number" },
    models: { type: "array", items: MODEL_ROW_SCHEMA },
    failures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: { type: "string" },
          providerName: { type: "string" },
          message: { type: "string" },
        },
        required: ["provider", "providerName", "message"],
      },
    },
  },
  required: ["current", "routable", "matched", "total", "models", "failures"],
};

const SWITCH_MODEL_OUTPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: { type: "string" },
    providerName: { type: "string" },
    model: { type: "string" },
    name: { type: "string" },
    reasoningEffort: { type: "string" },
    note: { type: "string" },
  },
  required: ["provider", "providerName", "model", "name", "note"],
};

/** Host 服务；没挂载时返回 undefined（工具会给出可读错误）。 */
function sessionControllerOf(ctx) {
  const controller = typeof ctx.get === "function" ? ctx.get("sessionController") : undefined;
  if (controller === undefined || controller === null) return undefined;
  if (typeof controller.modelCatalog !== "function" || typeof controller.selectModel !== "function") return undefined;
  return controller;
}

/** 工具执行所属会话：Agent 的 id 就是 sessionId。 */
function sessionIdOf(exec) {
  const agent = exec === undefined || exec === null ? undefined : exec.agent;
  const id = agent === undefined || agent === null ? undefined : agent.id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * 原始 ToolDefinition 的参数要自己校验（defineTool 的校验只服务于它自己的 DSL）。
 * 这里只接受声明过的字符串参数，未知字段和错类型都直接拒绝，不静默忽略。
 * @param {string} tool - 工具名，用于错误文案。
 * @param {unknown} args - 模型给的参数。
 * @param {Record<string, { required?: boolean }>} spec - 允许的参数表。
 * @returns {Record<string, unknown>} 原样返回（冻结对象，不修改）。
 */
function checkArgs(tool, args, spec) {
  const value = args === undefined || args === null ? {} : args;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${tool}: 参数必须是对象，收到 ${Array.isArray(value) ? "数组" : typeof value}。`);
  }
  const allowed = Object.keys(spec);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Error(`${tool}: 不认识的参数「${key}」；只接受 ${allowed.join(", ")}。`);
    }
    const got = value[key];
    if (got === undefined || got === null) continue;
    if (typeof got !== "string") throw new Error(`${tool}: 参数「${key}」必须是字符串，收到 ${typeof got}。`);
  }
  for (const [key, entry] of Object.entries(spec)) {
    if (entry.required !== true) continue;
    const got = value[key];
    if (typeof got !== "string" || got.trim() === "") {
      throw new Error(`${tool}: 缺少必填参数「${key}」（非空字符串）。`);
    }
  }
  return value;
}

/** 当前会话选中的模型：先读 live Agent 的选中项，退回部署默认。 */
function currentSelectionOf(ctx, sessionId, fallback) {
  const agents = typeof ctx.get === "function" ? ctx.get("agents") : undefined;
  const agent = agents === undefined ? undefined : agents.get(sessionId);
  const model = agent === undefined || agent === null ? undefined : agent.model;
  const current = model === undefined || typeof model.current !== "function" ? undefined : model.current();
  return current ?? fallback;
}

/** 读一次会话的真实模型目录（与 /model 弹窗同源）。 */
async function readDirectory(ctx, sessionId) {
  const controller = sessionControllerOf(ctx);
  if (controller === undefined) {
    throw new Error("这个 DSH 部署没有挂载 sessionController 服务，读不到模型目录。");
  }
  // { default, routableProviders, groups, failures }
  const catalog = await controller.modelCatalog();
  const current = currentSelectionOf(ctx, sessionId, catalog.default);
  const routableProviders = Array.isArray(catalog.routableProviders) ? catalog.routableProviders : [];
  return {
    current,
    routable: routableProviders.includes(current.provider),
    groups: catalog.groups ?? [],
    failures: catalog.failures ?? [],
  };
}

/** 目录行 → 模型可见的形状（efforts 只报 id，默认档位单独给）。 */
function toToolRow(candidate) {
  const reasoning = candidate.model.reasoning ?? {};
  const efforts = Array.isArray(reasoning.efforts) ? reasoning.efforts : [];
  const row = {
    provider: candidate.provider,
    providerName: candidate.providerName,
    model: candidate.model.id,
    name: candidate.model.name || candidate.model.id,
    description: candidate.model.description ?? "",
    efforts: efforts.map((effort) => effort.id),
  };
  if (typeof reasoning.defaultEffort === "string") row.defaultEffort = reasoning.defaultEffort;
  return row;
}

/** 一行候选的展示文案（模型转述给用户时直接用）。 */
function renderRow(row) {
  const effort = row.efforts.length === 0
    ? ""
    : ` · 推理档位 ${row.efforts.join("/")}${typeof row.defaultEffort === "string" ? `（默认 ${row.defaultEffort}）` : ""}`;
  const description = row.description === "" ? "" : ` — ${row.description}`;
  return `- ${row.name} · provider: ${row.provider} · model: ${row.model}${effort}${description}`;
}

/** 当前选择的展示文案。 */
function renderCurrent(current) {
  const base = `${current.name} · provider: ${current.provider} · model: ${current.model}`;
  return current.reasoningEffort === undefined ? base : `${base} · 推理档位: ${current.reasoningEffort}`;
}

/**
 * 注册两个工具。没有可配置项，行为完全由 DSH 的模型目录决定。
 * @param ctx - cordis 插件上下文。
 */
export function apply(ctx) {
  ctx.tools.register({
    name: "find_models",
    description: [
      "列出当前会话真正可选的模型。与 DSH 界面里 /model 弹窗的数据同源，没有硬编码。",
      "不带 query 返回完整目录（按 provider 分组）；带 query 则按自然语言或关键词匹配排序，",
      "例如「最快的」「推理模型」「glm」「claude sonnet」「智谱」。",
      "重要：结果多于一个时，必须把候选逐个列给用户（名称 + provider + 精确 model id），",
      "让用户自己选；不要替用户挑。用户确认后再用 switch_model 精确切换。",
    ].join(""),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "可选。模型名、家族、或自然语言描述；省略则返回完整目录。",
        },
      },
    },
    output: {
      schema: FIND_MODELS_OUTPUT,
      render: (_args, value) => {
        const lines = [`当前模型：${renderCurrent(value.current)}`];
        if (!value.routable) lines.push("注意：当前 provider 没有可用适配器，会话暂时无法发起请求。");
        if (value.matched) {
          lines.push(
            value.models.length === 0
              ? `没有匹配的模型（目录里共 ${value.total} 个）。`
              : `匹配到 ${value.models.length} 个（目录里共 ${value.total} 个）：`,
          );
        } else {
          lines.push(`完整目录，共 ${value.models.length} 个：`);
        }
        for (const row of value.models) lines.push(renderRow(row));
        if (value.models.length > 1) {
          lines.push("→ 候选不止一个：请把上面的候选列给用户，等用户选定后再调用 switch_model。");
        }
        for (const failure of value.failures) {
          lines.push(`⚠ provider ${failure.provider}（${failure.providerName}）目录读取失败：${failure.message}`);
        }
        return [{ type: "text", text: lines.join("\n") }];
      },
    },
    async execute(rawArgs, exec) {
      const args = checkArgs("find_models", rawArgs, { query: {} });
      const sessionId = sessionIdOf(exec);
      if (sessionId === undefined) throw new Error("这个工具只能在会话里调用（拿不到 sessionId）。");
      const directory = await readDirectory(ctx, sessionId);
      const catalog = flattenCatalog(directory.groups);
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const matched = query !== "";
      const picked = matched ? rankModels(catalog, query, 25) : catalog;
      const rows = picked.map(toToolRow);
      const currentRow = catalog.find((candidate) => candidate.provider === directory.current.provider
        && candidate.model.id === directory.current.model);
      const current = {
        provider: directory.current.provider,
        model: directory.current.model,
        name: currentRow === undefined
          ? directory.current.model
          : currentRow.model.name || currentRow.model.id,
      };
      if (directory.current.reasoningEffort !== undefined) current.reasoningEffort = directory.current.reasoningEffort;
      return {
        current,
        routable: directory.routable !== false,
        matched,
        total: catalog.length,
        models: rows,
        failures: (directory.failures ?? []).map((failure) => ({
          provider: failure.id,
          providerName: failure.name || failure.id,
          message: failure.message,
        })),
      };
    },
  });

  ctx.tools.register({
    name: "switch_model",
    description: [
      "把当前会话切换到指定模型，从下一次模型请求起生效；同时会保存为默认模型。",
      "model 必须是 find_models 返回的精确 model id。provider 可省略，但仅当该 id 在目录里唯一时才这么做。",
      "如果匹配到多个模型，本工具会报错并列出候选——此时不要重试，直接把候选交给用户选择。",
      "reasoningEffort 只在模型确实提供推理档位时才传。",
    ].join(""),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        model: { type: "string", description: "精确的 model id，例如 glm-4.6。" },
        provider: { type: "string", description: "可选。provider 路由 id，例如 opencode-go。" },
        reasoningEffort: { type: "string", description: "可选。推理档位 id，例如 high。" },
      },
      required: ["model"],
    },
    output: {
      schema: SWITCH_MODEL_OUTPUT,
      render: (_args, value) => {
        const effort = value.reasoningEffort === undefined ? "" : `（推理档位 ${value.reasoningEffort}）`;
        return [{ type: "text", text: `已切换到 ${value.name}${effort} · provider: ${value.provider} · model: ${value.model}\n${value.note}` }];
      },
    },
    async execute(rawArgs, exec) {
      const args = checkArgs("switch_model", rawArgs, {
        model: { required: true },
        provider: {},
        reasoningEffort: {},
      });
      const sessionId = sessionIdOf(exec);
      if (sessionId === undefined) throw new Error("这个工具只能在会话里调用（拿不到 sessionId）。");
      const controller = sessionControllerOf(ctx);
      if (controller === undefined) throw new Error("这个 DSH 部署没有挂载 sessionController 服务，切不了模型。");
      const directory = await readDirectory(ctx, sessionId);
      const catalog = flattenCatalog(directory.groups);
      const resolved = resolveSelection(catalog, args);
      const payload = { sessionId, provider: resolved.provider, model: resolved.model };
      if (resolved.reasoningEffort !== undefined) payload.reasoningEffort = resolved.reasoningEffort;
      // host 服务返回 { selected: { provider, model, reasoningEffort? } }
      const { selected } = await controller.selectModel(payload);
      return {
        provider: selected.provider,
        providerName: resolved.row.providerName,
        model: selected.model,
        name: resolved.row.model.name || resolved.row.model.id,
        ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
        note: "已对当前会话生效，并保存为默认模型。",
      };
    },
  });
}

/** 插件身份（与 profile bundle 里的 id 一致，便于日志定位）。 */
export const name = "model-switcher";

/** 只依赖工具注册表；网关是可选服务，运行时再取。 */
export const inject = ["tools"];

/** 测试用：纯函数与错误类型从这里取，避免测试去碰运行时。 */
export { AmbiguousModelError, describeCandidate };
