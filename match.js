// 模型名匹配：纯函数，不依赖 DSH 运行时，便于单测。
//
// 输入永远是 DSH 自己报上来的目录（sessionController.modelCatalog() 的 groups），
// 这里只负责「把用户的说法映射到目录里真实存在的 provider/model」，
// 不生成任何模型名。

/** 指令性前后缀，逐条剥掉后剩下的才是「模型名」。 */
const STRIP_PATTERNS = [
  /^(请|麻烦|帮我|帮忙|给我|我想|我要|我想用|咱|我们|能不能|可以|可否)+/,
  /^(把|将|给)+/,
  /^(当前|现在|目前|这个|那个)+/,
  /^(的)+/,
  /^(模型|model)+(切换|切换成|切换为|换|)?/i,
  /^(切换|切成|切到|切换到|切至|换到|换成|换用|换一个|改用|改为|改到|改成|变成|使用|选用|用|选择|选|挑|要)+/,
  /^(到|成|为|至|用|一下|个|：|:)+/,
  /^(switch|change|set|use|pick|select|go|i\s+want|please)+/i,
  /^(to|into|over|the|a|an|model|models|model\s+named|named)+/i,
  /^(模型|model)$/,
  /(模型|model)$/,
];

/** 中英混说的别名：目录里只有 provider/model 名，中文得靠这张表落到词上。 */
const ALIASES = [
  { re: /(克劳德|cloud?ade?|anth?ropic)/i, add: ["claude"] },
  { re: /(深度求索|深度搜索|深度思考|deep\s*seek|ds)/i, add: ["deepseek"] },
  { re: /(通义|千问|qwen|qs)/i, add: ["qwen"] },
  { re: /(月之暗面|kimi|moonshot)/i, add: ["kimi", "moonshot"] },
  { re: /(智谱|glm|chatglm)/i, add: ["glm"] },
  { re: /(谷歌|gemini|双子座)/i, add: ["gemini", "google"] },
  { re: /(微软|azure|copilot)/i, add: ["azure", "copilot"] },
  { re: /(欧朋|opencode|zen)/i, add: ["opencode"] },
  { re: /(开放人工?智能|open\s*ai|chat\s*gpt)/i, add: ["gpt", "openai"] },
  { re: /(歌剧|大型|opus)/i, add: ["opus"] },
  { re: /(迷你|小|mini|small|lite|轻量)/i, add: ["mini", "lite", "small", "flash"] },
  { re: /(最快|快速|快|速度|fast|speed|turbo)/i, add: ["flash", "turbo", "mini", "fast", "lite"] },
  { re: /(最强|旗舰|顶配|最好|聪明|pro|max|ultra|premium)/i, add: ["pro", "max", "ultra"] },
  { re: /(推理|思考|reasoner|reasoning|think|r1)/i, add: ["reasoner", "thinking", "r1"] },
  { re: /(代码|编程|coder|coding|code)/i, add: ["coder", "code"] },
  { re: /(视觉|多模态|看图|vision|vl|multimodal)/i, add: ["vision", "vl"] },
  { re: /(聊天|对话|通用|chat|general)/i, add: ["chat"] },
  { re: /(便宜|省钱|经济|cheap|economy|budget)/i, add: ["mini", "lite", "flash"] },
  { re: /(最新|新的|latest|newest|new)/i, add: ["latest"] },
];

/** 无信息量的词，参与匹配只会拉低排序。 */
const STOPWORDS = new Set([
  "the", "a", "an", "to", "into", "over", "with", "of", "for", "and", "or",
  "model", "models", "please", "switch", "change", "set", "use", "pick",
  "select", "want", "i", "we", "my", "me", "one", "some", "any",
]);

/**
 * 归一化：小写、全角转半角、非字母数字 CJK 一律压成空格。
 * @param {unknown} text - 原始文本。
 * @returns {string} 归一化后的文本。
 */
export function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\u3000\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9a-z\u4e00-\u9fff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * 去掉「切换到」这类指令词，返回真正要匹配的描述。
 * @param {unknown} raw - 用户原话。
 * @returns {string} 剥掉指令词后的描述。
 */
export function parseQuery(raw) {
  let text = normalize(raw);
  for (let round = 0; round < 6; round += 1) {
    const before = text;
    for (const pattern of STRIP_PATTERNS) text = text.replace(pattern, "").trim();
    text = text.replace(/\s+/g, " ").trim();
    if (text === before) break;
  }
  return text;
}

/**
 * 英文/数字词 + 中文别名扩展；用于打分。
 * @param {unknown} raw - 用户原话。
 * @returns {string[]} 参与打分的词。
 */
export function tokenize(raw) {
  const parsed = parseQuery(raw);
  const tokens = new Set();
  for (const word of parsed.split(" ")) {
    if (word === "" || STOPWORDS.has(word)) continue;
    if (word.length === 1 && !/[\u4e00-\u9fff]/.test(word)) continue;
    tokens.add(word);
  }
  const lower = String(raw ?? "").toLowerCase();
  for (const alias of ALIASES) {
    if (alias.re.test(lower)) for (const word of alias.add) tokens.add(word);
  }
  return [...tokens];
}

/**
 * 目录摊平：provider 分组 × 模型。
 * @param {readonly object[]} groups - modelCatalog() 的 groups。
 * @returns {object[]} 一行一个模型。
 */
export function flattenCatalog(groups) {
  const rows = [];
  for (const group of groups ?? []) {
    for (const model of group.models ?? []) {
      rows.push({
        provider: group.id,
        providerName: group.name || group.id,
        model,
        text: `${group.name || group.id} ${group.id} ${model.name || ""} ${model.id}`,
      });
    }
  }
  return rows;
}

/**
 * 单个候选的打分：整串命中 > 全词命中 > 逐词命中 > 前缀。
 * @param {object} candidate - flattenCatalog 的一行。
 * @param {unknown} raw - 用户原话。
 * @returns {number} 分数，0 表示不匹配。
 */
export function scoreCandidate(candidate, raw) {
  const haystack = normalize(candidate.text);
  if (haystack === "") return 0;
  const compactHay = haystack.replace(/ /g, "");
  const parsed = parseQuery(raw);
  if (parsed === "") return 0;
  const compactQuery = parsed.replace(/ /g, "");

  let score = 0;
  if (compactQuery !== "" && compactHay.includes(compactQuery)) score += 60 + compactQuery.length * 2;

  const tokens = tokenize(raw);
  if (tokens.length === 0) return score;
  const hayWords = haystack.split(" ");
  let hits = 0;
  for (const token of tokens) {
    if (compactHay.includes(token.replace(/ /g, ""))) {
      score += token.length >= 3 ? 7 : 4;
      hits += 1;
      continue;
    }
    if (token.length >= 3 && hayWords.some((word) => word.startsWith(token))) {
      score += 2;
      hits += 1;
    }
  }
  if (hits === tokens.length) score += 12;
  return score;
}

/**
 * 排名：分数降序，同分保持目录原序。
 * @param {object[]} catalog - flattenCatalog 的结果。
 * @param {unknown} raw - 用户原话。
 * @param {number} [limit] - 最多返回几条。
 * @returns {object[]} 命中的候选。
 */
export function rankModels(catalog, raw, limit) {
  const scored = [];
  catalog.forEach((candidate, index) => {
    const score = scoreCandidate(candidate, raw);
    if (score > 0) scored.push({ candidate, score, index });
  });
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const ranked = scored.map((row) => row.candidate);
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

/** 描述一个候选，用于报错和让模型转述给用户。 */
export function describeCandidate(candidate) {
  return `${candidate.model.name || candidate.model.id}（provider: ${candidate.provider}, model: ${candidate.model.id}）`;
}

/** 候选多于一需要用户决定时抛出的错误，文案里带全部候选。 */
export class AmbiguousModelError extends Error {
  /**
   * @param {string} query - 用户/模型给出的说法。
   * @param {object[]} candidates - 全部候选。
   */
  constructor(query, candidates) {
    const lines = candidates.map((candidate) => `- ${describeCandidate(candidate)}`);
    super([
      `「${query}」匹配到 ${candidates.length} 个模型，没有替你选。`,
      ...lines,
      "请把上面的候选列给用户，让用户选一个，再用 provider + model 精确调用 switch_model。",
    ].join("\n"));
    this.name = "AmbiguousModelError";
    this.candidates = candidates;
  }
}

/**
 * 把调用参数解析成一份可提交的完整选择。
 *
 * 这里的原则是**不猜**，因为切换会真的改会话状态：
 * - 给了 provider + model：在该 provider 内按 id 精确匹配（忽略大小写）；
 * - 只给 model：跨 provider 按 id 精确匹配，唯一才用；
 * - id 都不中时，只认「整串字面命中且唯一」——即归一化后的查询串完整出现在
 *   恰好一个候选的名字/路由里。共有的关键词不算（`gpt-9` 不得落到 `gpt-4o`）。
 * - 命中多个 → AmbiguousModelError，把候选全列出来让用户选；
 * - 一个都不中 → 报错并给出最接近的几个作为提示，不做自动选择。
 * @param {object[]} catalog - flattenCatalog 的结果。
 * @param {{ provider?: string, model?: string, reasoningEffort?: string }} args - 工具参数。
 * @returns {{ provider: string, model: string, reasoningEffort?: string, row: object }} 完整选择。
 */
export function resolveSelection(catalog, args) {
  const wantedProvider = typeof args.provider === "string" ? args.provider.trim() : "";
  const wantedModel = typeof args.model === "string" ? args.model.trim() : "";
  const wantedEffort = typeof args.reasoningEffort === "string" ? args.reasoningEffort.trim() : "";
  if (wantedModel === "") throw new Error("model 不能为空：请传 find_models 返回的精确 model id。");

  const inProvider = wantedProvider === ""
    ? catalog
    : catalog.filter((candidate) => candidate.provider.toLowerCase() === wantedProvider.toLowerCase());
  if (wantedProvider !== "" && inProvider.length === 0) {
    const providers = [...new Set(catalog.map((candidate) => candidate.provider))];
    throw new Error(`没有 provider「${wantedProvider}」。当前可用：${providers.join(", ")}`);
  }

  const exact = inProvider.filter((candidate) => candidate.model.id.toLowerCase() === wantedModel.toLowerCase());
  let row = exact[0];
  if (row === undefined) {
    // 只认整串字面命中：shared token 不可靠，会把「gpt-9」判成「gpt-4o」。
    const compactQuery = parseQuery(wantedModel).replace(/ /g, "");
    const literal = compactQuery === ""
      ? []
      : inProvider.filter((candidate) => normalize(candidate.text).replace(/ /g, "").includes(compactQuery));
    if (literal.length > 1) throw new AmbiguousModelError(wantedModel, literal);
    if (literal.length === 1) {
      row = literal[0];
    } else {
      const nearest = rankModels(inProvider, wantedModel, 8);
      const scope = wantedProvider === "" ? "" : `（provider: ${wantedProvider}）`;
      if (nearest.length === 0) {
        const sample = inProvider.slice(0, 12).map((candidate) => `- ${describeCandidate(candidate)}`);
        throw new Error([
          `目录里没有匹配「${wantedModel}」的模型${scope}。`,
          ...sample,
          "请先用 find_models 查，再用精确的 provider + model 调用。",
        ].join("\n"));
      }
      throw new Error([
        `「${wantedModel}」没有完全匹配的模型${scope}；最接近的是：`,
        ...nearest.map((candidate) => `- ${describeCandidate(candidate)}`),
        "不要靠猜：如果用户要的是其中一个，请用它的精确 model id 重新调用；不确定就先问用户。",
      ].join("\n"));
    }
  }

  const efforts = row.model.reasoning && Array.isArray(row.model.reasoning.efforts) ? row.model.reasoning.efforts : [];
  let reasoningEffort;
  if (wantedEffort !== "") {
    const hit = efforts.find((effort) => effort.id.toLowerCase() === wantedEffort.toLowerCase());
    if (hit === undefined) {
      const available = efforts.map((effort) => `${effort.id}（${effort.name}）`).join(", ");
      throw new Error(
        available === ""
          ? `模型 ${row.model.id} 没有可选的推理档位，不要传 reasoningEffort。`
          : `${row.model.id} 的推理档位只有：${available}。`,
      );
    }
    reasoningEffort = hit.id;
  } else if (row.model.reasoning && row.model.reasoning.defaultEffort !== undefined) {
    reasoningEffort = row.model.reasoning.defaultEffort;
  }

  const selection = { provider: row.provider, model: row.model.id, row };
  if (reasoningEffort !== undefined) selection.reasoningEffort = reasoningEffort;
  return selection;
}
