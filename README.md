# deepseek-cdp-cli

通过本地 Chrome 或 Chromium，在命令行、交互 shell 或 JSON-RPC 服务里使用 DeepSeek。

它复用真实浏览器会话，不重写站点 HTTP API。适合需要继续使用网页登录态、`Instant` / `Expert`、`DeepThink` / `Search`、文件上传和会话导出的场景。

## 前提

- Node.js `>=20`
- 本机安装 Chrome 或 Chromium
- 运行 `deepseek auth login` 完成一次 DeepSeek 登录

浏览器接入方式：

- 推荐：`deepseek auth login` 创建 DeepSeek 专用 profile，后续普通命令默认使用它
- 连接你自己已经打开的 CDP 浏览器：`--browser-mode attach`，默认 `http://127.0.0.1:9222`
- 兼容：`--clone-chrome-profile` 从普通 Chrome profile 复制 DeepSeek 登录态；该路径开始逐步退为兼容模式

## 安装

```sh
npm install -g deepseek-cdp-cli
```

安装后可直接使用这三个命令：

- `deepseek`
- `deepseek-cdp`
- `deepseek-cdp-cli`

下面的示例默认使用 `deepseek`。`deepseek-cdp` 和 `deepseek-cdp-cli` 继续作为兼容别名保留。

这是一个 `bin-only CLI` 安装包，只包含混淆后的编译产物、最小 README、面向用户的 `SKILL.md` 和必要 metadata，不包含源码、spec、tasks、tests 或内部审计文档。当前以 `UNLICENSED` 方式分发。

## Ready Copy

先登录一次：

```sh
deepseek auth login
```

查看当前命令会如何解析浏览器运行时：

```sh
deepseek plan
```

`plan` 会显示 request family 和 policy preview。

如果你想先读完整用户手册，直接打印打包内置的 `SKILL.md`：

```sh
deepseek skillbook
```

直接发起一条 `headless + text` 请求：

```sh
deepseek reply \
  --message "用三句话介绍 DeepSeek" \
  --headless \
  --format text
```

查看 legacy clone 会如何选路：

```sh
deepseek plan --clone-chrome-profile
```

如果你已经有可连接的 CDP 浏览器，也可以直接复用它：

```sh
deepseek reply \
  --browser-mode attach \
  --message "总结一下这次对话" \
  --format text
```

## 浏览器自动选路

- fully implicit one-shot CLI 且继续使用共享默认 `9222` 时，系统会保守自动选路：
  - attach-compatible：优先复用已登记 runtime，否则 attach 到 active DevTools endpoint
  - managed-required：只会在 managed 家族里 reuse / launch / auto-isolate；不会 auto attach 到外部浏览器
- `deepseek auth login` 成功后，普通 one-shot 命令默认进入 managed-required，并使用专用 auth profile
- `interactive` / RPC 的 legacy `--clone-chrome-profile` 默认值保持 `warm`，不继承 one-shot CLI 的 auto attach / auto-isolate 逻辑
- `--browser-id`、显式 `--browser-mode`、显式自定义 `--cdp-url` 都代表你已经给出强意图，CLI 不会静默改写到别的端口或别的浏览器

为什么之前不会自动分配 / 管理：

- managed runtime 的池化和生命周期能力一直都在
- 缺的是 one-shot 主链路 wiring：旧路径把 `--clone-chrome-profile` 过早塌缩成固定 `ephemeral@9222`
- 现在 one-shot CLI 已接到统一 auto-management seam，所以默认 `9222` 已被现成 CDP browser 占用时，不再只剩手工换端口这一条路

当前边界：

- 什么时候会 auto attach：只有 fully implicit `attach-compatible` 请求，且仍停在共享默认 `9222`，并探测到 active DevTools endpoint 或已登记 managed runtime
- 什么时候会 auto allocate isolated port：只有 fully implicit `managed-required` 请求，且 shared/default endpoint 已不适合 managed launch，但 `cdpUrl` 还没被显式 pin 住
- 什么时候仍会 fail-closed：显式 `--browser-id`、显式 `--browser-mode`、显式 `--cdp-url` 冲突，或 ownership / observation 不清时
- 为什么这不越权：外部浏览器不会被静默接管成 managed runtime；attach-compatible 最多只会连接，不会 kill、不会删 profile

legacy clone 边界：

- 默认 clone 现在直接是唯一的 DeepSeek 站点级最小复制 contract，不再存在额外 copy-scope 选项
- 会保留：
  - 整份 `Local State`
  - 自动选中的 source profile 里的 DeepSeek cookie rows
  - 自动选中的 source profile 里 `https://chat.deepseek.com/` origin 的 localStorage entries
- 会故意排除：
  - 非 DeepSeek 的 cookie rows
  - 非 DeepSeek 的 localStorage entries
  - 整份 `Default/Preferences`
  - 整份 `Default/Login Data`
  - 整份 `Default/Web Data`
  - 整份 `Default/IndexedDB`
  - 整份 `Default/Service Worker`
  - 整份 `Default/Sessions`
- 系统不会 silent broaden 回任何更宽的历史 subtree baseline、历史实验 working set，或 legacy full-root clone
- `deepseek auth login` 建立的专用 profile 位于 `~/.deepseek-cdp-cli/auth/chrome-profile`
- 显式 `--clone-chrome-profile` 仍表达“克隆一个 Chrome source profile”，不会使用 auth profile 语义
- 系统会在 `Default` / `Profile N` 中用 DeepSeek cookie 证据自动选择唯一 source profile，不要求用户知道网页登录态在哪个目录
- `--chrome-user-data-dir` 仍表达 source root pinning；缺少 `Local State`、缺少 source profile、缺少 `<profile>/Cookies`、缺少 `<profile>/Local Storage` 时会 fail-closed，而不是静默 broaden
- 如果多个 profile 都有 DeepSeek cookie，系统会 fail-closed；这时才需要用 `--chrome-profile-directory "Profile 4"` 显式消歧

## 常用命令

查看帮助：

```sh
deepseek --help
```

登录一次并建立 DeepSeek 专用 profile：

```sh
deepseek auth login
```

清理这个专用 profile：

```sh
deepseek auth logout
```

进入交互模式：

```sh
deepseek interactive
```

启动一个可复用的浏览器 runtime：

```sh
deepseek browser start --headless --browser-purpose primary
```

复用上面启动的 runtime：

```sh
deepseek reply \
  --browser-id <browserId> \
  --message "继续，总结一下浏览器运行时模型" \
  --format text
```

找回旧会话：

```sh
deepseek list-sessions
deepseek list-sessions --query "预算" --limit 10
```

`list-sessions` 只列本地 stored session，不是远端账号历史目录。

如果网页里已经有会话，但本地还没有，先把网页 catalog 同步回本地：

```sh
deepseek sync-session --headless
deepseek list-sessions
```

这一步只会同步 browser-observed online catalog：

- 会回填本地 catalog snapshot / placeholder
- 不会逐个进入会话页
- 不会同步 transcript / branches / messages
- 不是稳定 public API
- 如果网页侧 `has_more=true`，结果可能只是 partial catalog

拿到 `sessionId` 后继续、查看分支或导出：

```sh
deepseek reply \
  --session-id <sessionId> \
  --message "继续，总结一下上次会话" \
  --format text
deepseek list-branches --session-id <sessionId>
deepseek export-session \
  --session-id <sessionId> \
  --format text \
  --output ./session.txt
```

如果你怀疑网页 transcript 比本地文件新，再显式同步这一条会话：

```sh
deepseek sync-session --session-id <sessionId> --headless
```

`reply`、`export-session`、`list-branches` 不会自动帮你做这一步。

如果本地 stored session 已经够用，直接继续、导出或查看分支即可，不需要先 sync。

启动 JSON-RPC 服务：

```sh
deepseek serve --transport stdio
```

如果你想把它当成 OpenAI 兼容服务端使用，当前首阶段支持本地 HTTP surface 的 create routes，以及最小 stored-object route family：

- `POST /v1/chat/completions`
- `GET /v1/chat/completions`
- `GET /v1/chat/completions/{completion_id}`
- `POST /v1/chat/completions/{completion_id}`
- `DELETE /v1/chat/completions/{completion_id}`
- `GET /v1/chat/completions/{completion_id}/messages`
- `POST /v1/responses`
- `GET /v1/responses/{response_id}`
- `DELETE /v1/responses/{response_id}`
- `POST /v1/responses/{response_id}/cancel`
- `GET /v1/responses/{response_id}/input_items`

两者都支持 buffered + streaming，但这不是“完整 OpenAI API”。当前 canonical model alias 只有：

- `deepseek-chat-browser`
- `deepseek-expert-browser`

当前官方 request-control 子集也已接通：

- `POST /v1/chat/completions` 接受受限官方 `web_search_options`、`reasoning_effort`
- `POST /v1/responses` 接受受限官方 `tools[].type=web_search_preview*`、`reasoning`
- 它们与 `deepseek_options.search|deep_think` 共享同一 normalized toggle 语义；冲突请求会 fail-closed
- responses 侧最多只接受一个官方 `web_search_preview*` tool，`search_content_types` 目前只接受 `[text]`
- `search_context_size`、`user_location` 只作为 coarse hint 被接受，不是 full-fidelity 浏览器控制面
- `reasoning_effort` / `reasoning.effort` 是 many-to-one 映射：`none -> deep_think=off`，其余支持档位都只会归一化成 `deep_think=on`
- `reasoning.summary` / `reasoning.generate_summary` 当前继续显式 reject

最小启动示例：

```sh
deepseek serve \
  --transport http \
  --host 127.0.0.1 \
  --port 8787 \
  --http-surface openai \
  --http-api-key local-dev-key \
  --openai-clone-chrome-profile \
  --openai-headless
```

然后把 OpenAI SDK / 兼容客户端指向：

- `baseURL=http://127.0.0.1:8787/v1`
- `Authorization: Bearer local-dev-key`

## OpenAI Release Boundary

当前边界分两档：

truthful subset release：

- 当前支持：
- `POST /v1/chat/completions` 与 `POST /v1/responses` 的 buffered + streaming
- `chat.completions` / `responses` 的最小 stored-object route family
- chat 受限官方 `web_search_options`、`reasoning_effort`
- responses 受限官方 `tools[].type=web_search_preview*`、`reasoning`
- request-control precision boundary：`search_context_size` / `user_location` 是 hint-only；`reasoning_effort` / `reasoning.effort` 是 many-to-one binary toggle 映射；responses `reasoning.summary` / `reasoning.generate_summary` 继续 reject
- responses tool boundary：最多一个官方 `web_search_preview*` tool，`search_content_types` 只接受 `[text]`

当前保留的过渡兼容：

- `deepseek_options.search|deep_think` 继续作为 extension / fallback 存在
- `/v1/responses` 仍接受 legacy 顶层 `input_file { filename, file_data }`
- 无句柄多轮历史请求继续通过 `history bootstrap` artifact 收口

当前继续拒绝 / 留待 future wave：

- `/v1/conversations*`、`POST /v1/responses/input_tokens`、`POST /v1/responses/compact`
- `/v1/files*`、`GET /v1/models`、`POST /v1/embeddings`
- responses `background` / `include` / `stream_options`，以及超出当前 subset spec 的 tool / multimodal surface

GA hardening release：

- stronger live evidence：`npm run proof:openai-http` 与 `OPENAI_HTTP_LIVE_SDK=1 npm run test:openai-sdk-live` 必须覆盖 continuation、bootstrap、nested `input_file` 与 stored-object route family，而不再只是 create smoke
- stronger anti-overclaim boundary：`npm run proof:openai-http-request-controls`、README、`serve --help` 与 subset spec 必须一致地把 `search_context_size` / `user_location` 写成 hint-only，把 `reasoning_effort` / `reasoning.effort` 写成 many-to-one，把 `reasoning.summary` / `reasoning.generate_summary` 写成 reject

## 搜索、事实核查和附件

联网搜索或事实核查时，显式打开 `--search on` 和 `--deep-think on`：

```sh
deepseek reply \
  --message "请联网核查这个说法" \
  --headless \
  --search on \
  --deep-think on \
  --format text
```

上传附件时，重复传 `--file`：

```sh
deepseek reply \
  --message "比较这两个文件" \
  --headless \
  --chat-mode expert \
  --file ./notes.txt \
  --file ./summary.txt \
  --format text
```

识图模式上传图片时，使用 `--chat-mode vision --file <image>`。当前官网 vision 模式只稳定提供上传文件 + DeepThink；如果同时传入 `--search on|off`，CLI 会按 no-op 忽略搜索请求，不点击或等待智能搜索按钮，最终请求侧仍应保持 `search_enabled=false`：

```sh
deepseek reply \
  --message "描述这张图片" \
  --headless \
  --chat-mode vision \
  --file ./image.png \
  --search on \
  --format text
```

## 输出格式

- `reply`
  - `--format text`
  - `--format json`
  - `--stream --format text`
  - `--stream --format stream-json`
- `export-session`
  - `--format text`
  - `--format markdown`
  - `--format json`

当前 `--stream` 的 public surface 状态：

- one-shot CLI reply-family 命令当前已是真流
- interactive shell reply-family 当前也已是真流
- JSON-RPC reply-family 当前也已是真流，`deepseek.stream.event` 是 authoritative live notification；stdio / HTTP 都会先增量 flush，再返回最终 success
- `system.describe` 会把 CLI / interactive / RPC 这三类 surface 都暴露为 live

如果你只是先跑通一条命令，优先用 `--format text`。

## 边界

- 这不是官方 DeepSeek API；它依赖你本地真实浏览器的登录态
- 这也不是完整 OpenAI API；当前只承诺 `/v1/chat/completions` 与 `/v1/responses` 的首阶段文本子集
- `/v1/conversations*`、`POST /v1/responses/input_tokens`、`POST /v1/responses/compact` 当前会显式返回 unsupported，而不是伪装成已实现
- 如果你使用 `attach` 模式，项目不会替你关闭外部浏览器
- `browser stop` / `browser restart` 只作用于项目自己管理的 runtime
- public package 只承诺 CLI 可运行、帮助信息可读、最小 smoke 可通过
