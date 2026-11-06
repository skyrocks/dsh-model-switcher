# dsh-model-switcher

English | [简体中文](README.md)

A **model-switching tool plugin** for **DeepSeek Harness** (`dsh`). It exposes "list the catalog /
switch the model" as model-callable function calls, so you can just say "switch to glm" in the
conversation. Manual selection still uses the built-in `/model` popup — this plugin does not
reinvent it, it only lets the model reach the same catalog and the same switching path.

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![dsh](https://img.shields.io/badge/DSH-0.2.1--rc.3%20line-4d6bfe)
![node](https://img.shields.io/badge/node-%3E%3D18-339933)
![dependencies](https://img.shields.io/badge/runtime%20deps-0-6bd586)

```text
you: which models are cheap and fast?

Current model: DeepSeek V4.1 Flash · provider: opencode-go · model: deepseek-v4.1-flash
Matched 4 of 31:
- DeepSeek-V4.1-Flash · provider: deepseek-account · model: deepseek-flash · efforts off/low/high/max (default high)
- Qwen3.8 Flash · provider: opencode-go · model: qwen3.8-flash · efforts off/minimal/low/medium/high
- GLM-5.3-Flash · provider: opencode-go · model: glm-5.3-flash · efforts low/high/max
- MiMo-V2.6-Flash · provider: opencode-go · model: mimo-v2.6-flash · efforts off/minimal/low/medium/high
→ More than one candidate: list them for the user and wait for a choice.

you: GLM-5.3-Flash then

Switched to GLM-5.3-Flash (effort low) · provider: opencode-go · model: glm-5.3-flash
Applied to this session and saved as the default model.
```

---

## Why use it

- **One sentence is enough** — no need to remember exact model ids or scroll a 30-model popup.
- **Same source as `/model`** — candidates come from DSH's own catalog
  (`sessionController.modelCatalog()`), and switching goes through the same `selectModel()`.
  No hardcoded lists, no guessing.
- **You decide when it is ambiguous** — "glm" matches `glm-5.2` / `glm-5.3` / `glm-5.3-flash`;
  the plugin lists the candidates instead of picking one.
- **Zero runtime dependencies** — no zod, no native modules, nothing to resolve when installed
  straight from a GitHub directory.
- **Hands off your machine** — no file I/O, no shell, no outbound requests.

---

## The two tools

| Tool | Arguments | What it does |
| --- | --- | --- |
| `find_models` | `query?` (natural language or keywords) | List the models actually selectable in this session. Without `query`: the full catalog. With `query`: ranked by relevance, at most 25 rows |
| `switch_model` | `model` (required), `provider?`, `reasoningEffort?` | Perform the switch. Takes effect from the next model request and is saved as the default model |

`find_models` returns `current` (the active model), `models` (candidates with their reasoning
efforts) and `failures` (per-provider read failures, reported verbatim without poisoning the rest).

---

## Ambiguity rules (the point of this plugin)

"switch to glm" usually matches more than one entry in a real catalog:

- `find_models` returns **all** candidates and explicitly asks the model to present them and wait
  for the user's choice;
- `switch_model` **fails with the candidate list** instead of guessing;
- only an exact, unique whole-string match is auto-selected: `haiku` → `claude-haiku-5-5` is fine,
  `gpt-9` will never be resolved to `gpt-6-luna`.

When the same `model` id exists under two providers (for example `deepseek-v4-pro`), `provider`
becomes mandatory. Better one extra question than the wrong model.

---

## Requirements

| Item | Requirement |
| --- | --- |
| DSH | `>= 0.2.1-rc.3 < 0.3.0` (desktop app and `dsh web`) |
| Node | `>= 18` (the desktop app bundles Node 24) |
| Dependencies | none (zero runtime dependencies, pure ESM) |
| OS | verified on macOS; Windows / Linux expected to work (no platform branches) |

---

## Install

### In the DSH desktop app (recommended)

1. Open DSH and go to Settings → Plugins.
2. Click "Add plugin" and paste:
   ```
   github:skyrocks/dsh-model-switcher
   ```
3. Confirm and wait for dependency resolution.
4. **Quit DSH completely and reopen it** (`Cmd+Q` on macOS; quit from the tray on Windows).
   Closing the window is not enough — host plugins load at startup only.
5. Open a new session and ask "list the models" to verify. The plugin appears as
   `@skyrocks/dsh-model-switcher` (plugin row id `model-switcher`).

### From the command line (optional)

```sh
# GitHub (recommended)
dsh plugin --profile desktop add github:skyrocks/dsh-model-switcher

# local directory (development)
dsh plugin --profile desktop add /absolute/path/to/dsh-model-switcher
```

> `desktop` is the desktop profile; use `--profile web` for `dsh web`.
> Restart DSH completely after installing either way.

---

## Usage

Just talk to it — the model decides when to call the tools:

```
what models do I have?
list the glm family
switch to claude haiku
use the cheapest one
switch to deepseek reasoning
```

You can also pass an exact id ("switch to glm-5.3") to do it in one step. If you switch to the
wrong model, switch back with the built-in `/model`.

Supported phrasings: mixed Chinese/English, conversational commands ("switch to …", "change to …"),
and synonym expansion (fastest → flash / turbo / mini / lite, strongest → pro / max / ultra,
reasoning → reasoner / thinking, zhipu → glm, moonshot → kimi, and so on).

---

## How it works

```text
user says "switch to glm"
        │
        ▼
the model calls a tool              ┌──────────────── Host (Node) ────────────────┐
  find_models("switch to glm") ────▶│ ctx.get("sessionController")               │
  switch_model("glm-5.3")    ──────▶│  ├─ modelCatalog()                         │
                                    │  │    ← ctx.llm.listProviders()/listModels()│
                                    │  │      (the same source as the /model UI)  │
                                    │  ├─ agents.get(sessionId).model.current()  │
                                    │  │    (active selection, else deployment    │
                                    │  │     default)                             │
                                    │  └─ selectModel({ sessionId, provider,     │
                                    │        model, reasoningEffort? })          │
                                    │       (the same write path as /model)      │
                                    └────────────────────────────────────────────┘
```

- **sessionId** is taken from `(exec.agent).id`, so a tool always acts on the session that
  triggered it.
- **No `@deepseek-ai` imports**: with a local `link:` install the plugin directory cannot resolve
  the profile's `node_modules`, so the tool definitions are written as plain JSON Schema
  (`ctx.tools.register` accepts a raw `ToolDefinition`; `defineTool` is only typing sugar) and
  services are fetched at runtime with `ctx.get()`.
- A provider failing to list its models does not fail the whole call; it shows up in `failures`.

### Version note

Older builds used `ctx.apiProxy.sessions.models/selectModel`. DSH `0.2.1-rc.3` removed that
service, and the old code fails with "apiProxy gateway not mounted". `0.2.1` uses
`sessionController` instead.

---

## Compatibility

- **Verified**: DSH `0.2.1-rc.3` on macOS desktop — a 31-model, two-provider catalog listed and
  switched correctly.
- **Service contract**: the host `sessionController` service
  (`@deepseek-ai/dsh-api-session-controller`) provides `modelCatalog()` / `selectModel()`; the
  active selection is read from `agents` via `agent.model.current()`.
- **0.2.0 and earlier**: depend on the removed `apiProxy` service and both tools fail on
  `0.2.1-rc.3`. Upgrade to `0.2.1`.
- **0.3.x**: `engines.dsh` refuses the install; `dsh plugin allow-version` can override it, but
  service names and signatures may have changed.

---

## FAQ

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `find_models` is missing | not restarted, or installed into another profile | quit and reopen; make sure it went into the current profile (`desktop` / `web`) |
| "sessionController service not mounted" | DSH too old, or the deployment has no session controller | upgrade to `0.2.1-rc.3+` |
| "apiProxy gateway not mounted" | running `0.2.0` or earlier | upgrade to `0.2.1` |
| `failures` entries in `find_models` | that provider could not list models (often a missing key) | configure credentials in Settings → Models; other providers are unaffected |
| "switch to glm" only listed candidates | several models matched, by design | answer with an exact name, e.g. "GLM-5.3" |
| the current reply still uses the old model | the switch applies from the **next** model request | send the next message |
| the default model changed too | same behaviour as `/model` | switch back with `/model` |
| "provider is ambiguous" | that id exists under several providers | include the provider, e.g. "deepseek-v4-pro on opencode-go" |

---

## Development

```sh
node test/smoke.mjs     # matching, ambiguity, tool contract, failure paths (no DSH needed)
node test/manifest.mjs  # manifest self-check: entries exist, patch row name == package name, zero deps
node --check index.js match.js
```

Local iteration:

```sh
# 1. install as a directory (link:)
dsh plugin --profile desktop add /absolute/path/to/dsh-model-switcher

# 2. edit the sources

# 3. Cmd+Q and reopen DSH
```

Re-run `add` after changing the `dsh.bundle` declaration in `package.json`.
CI runs the same tests on Ubuntu / macOS / Windows with Node 22 and 24.

---

## Project layout

```text
dsh-model-switcher/
├── index.js            # the two tools (host side, zero dependencies)
├── match.js            # pure functions: normalization, aliases, ranking, ambiguity resolution
├── cordis.patch.yml    # plugin row (injected into the profile on install)
├── package.json        # dsh.bundle declaration + exports + files whitelist
├── test/smoke.mjs      # regression tests
├── test/manifest.mjs   # manifest self-check (also run by CI)
├── README.md           # Chinese readme
└── README.en.md        # this file
```

---

## Privacy and security

- Calls only DSH services that already exist in the host process; makes **no** additional network
  requests.
- No file I/O, no shell, no telemetry.
- Tool output contains only provider, model id, display name, reasoning efforts and provider
  failure reasons.
- Unofficial community plugin; not affiliated with DeepSeek.

---

## Known limitations

- Tools only, no UI: use `/model` for manual picking.
- No catalog caching: every call reads the live catalog (DSH itself caches provider data).
- Ranking is heuristic: the alias table covers common phrasings; unusual nicknames may not match —
  pass the exact id instead.
- Works inside subagent sessions too, scoped to that agent's own session.

## Roadmap

- [ ] Short-lived local cache for the catalog to avoid repeated reads
- [ ] Filter by capability tags (vision / code / long context)
- [ ] Show price and context window before switching
- [ ] Windows verification and a green CI badge

---

## Contributing

Issues and PRs are welcome. When reporting, please include:

- DSH version and OS;
- the full `find_models` output (provider names may be redacted);
- the exact phrase you used.

Before sending a PR, make sure `node test/smoke.mjs` and `node test/manifest.mjs` pass, and keep
the plugin **free of runtime dependencies**.

---

## License

[MIT](LICENSE)

> Unofficial plugin, not affiliated with DeepSeek.
