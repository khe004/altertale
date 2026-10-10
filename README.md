# AlterTale · 天命未定

（中文名原为“异章”，2026 年 10 月改为“天命未定”。）

> 改变一个选择，让故事重新演化。

AlterTale 是一个以小说为世界基线的剧情反事实游戏项目。玩家扮演故事中的角色，在关键决策点改变选择；系统根据当前世界状态、人物目标、认知与行动条件，逐步推演后续事件。

玩家操作的主要粒度是战略和剧情决策，例如北伐、撤军、调遣、谈判与结盟。

## 第一个 demo：荆州（当时名为《异章：荆州》）

以《三国演义》的“关羽北伐襄樊—荆州危机—败走麦城”作为局部测试窗口，玩家首先扮演刘备。

比较两种起点：

- 原著基线：采用所选原著版本中这一时期的部署。
- 反事实起点：设定诸葛亮已提前留守荆州，重新推演后续事件。

第二种起点是实验性世界设定；诸葛亮到任的时间和调遣过程需要在模型中说明。模型需要计算留守对防御、外交、人员配置与其他地区的影响，不预设关羽必胜或荆州必然安全。

详细范围与验收标准见 [荆州 demo 说明](docs/jingzhou-demo.md)。

## 工作原则

- 世界状态负责记录事实，角色认知允许不完整或错误。
- 原著事件需要检查前置条件；条件变化后可以保留、变形或失效。
- 新事件需要有可追溯的行动条件、角色动机和状态变化。
- 每次推演推进到下一个重要事件或玩家决策点，再根据新状态继续。
- 原文事实、对原文的解释和实验模型假设分别记录，事实引用保留章节及版本定位。
- 小说是故事基线；反事实结果是模型下的可能发展。

## 路线图

刘备线按时代推进，现已有入川、汉中、荆州三段，可以连打。原著是默认走向：一路照原著下令就照演义展开，偏离之后自由推演；每个时代的结局决定下一段世界线怎么分叉。机制、世界线规划、决策点、原著事件池、测试方法和里程碑见 [路线图](docs/roadmap.md)。[荆州 demo 说明](docs/jingzhou-demo.md) 是早期的规格，已由路线图取代。

## 待评估的参考项目

| 项目 | 评估重点 |
| --- | --- |
| [Sabre](https://github.com/sgware/sabre) | 已定义行动、人物目标与认知下的事件序列规划 |
| [StoryWorld Engine](https://github.com/MaxfanO/storyworld-engine) | 世界状态、分支隔离、检查点与因果链记录 |
| [There and Back Again](https://github.com/alex-calderwood/there-and-back) | 从自然语言提取形式化故事模型的方法 |

采用依赖或复制代码之前，检查实现、接口、运行条件和许可证。技术栈与引擎尚未确定。

## 当前状态

已有一个可玩原型：[`web/index.html`](web/index.html)。

- 玩家扮演刘备，可从入川、汉中、荆州、北伐任一时代开局，也可以一路连打；第一回为预写内容。“孔明留守荆州”早先是荆州的一个独立起点，现已从开局页撤下：连着打时在入川只召张飞、赵云即可得到这个局面。
- 每回分两步：先**推演**（Claude 只输出结构化的事件与局势：谁在哪做了什么、为什么、结果、刘备是否得知，以及兵马、城池、选项），立即存档；再**说书**（另一次调用把已定事件写成章回体，不得改动事实）。
- 推演的记忆是事件记录而非小说原文；玩家可设方略与授权，前方将帅据此自决；命令按驿马时日在途。
- 可以回到任一回另作决断，形成分支；约八到十二回收束到结局，并与原著对照。
- 在 claude.ai 中作为 Artifact 打开时直接调用 Claude；本地用浏览器打开 `web/index.html` 时，在开局页底部填写 API（只存在本机浏览器）：
  - Anthropic API Key：推演、说书用 `claude-sonnet-5-5`，拆令、预检等小活用 `claude-haiku-5-5`；
  - 或勾选"改用 OpenAI 兼容接口"，填接口地址（如 `https://api.deepseek.com/v1`、本地 Ollama 的 `http://localhost:11434/v1`）、Key、主模型名与小活模型名。推演规则按 Claude 调校，换用别家模型时效果要自行试；不允许网页直接调用（跨域）的接口会被浏览器拦下。

测试：`node tools/playtest.js --starts canon --strategies prudent,delegate` 只跑推演、不说书，用本机 `claude` CLI 自动打完整局，结果写入 `playtest-out/`。

原型以“故事好看”为先，暂不包含上文开发顺序中的规划器与形式化世界模型。

## 用 ChatGPT Plus 在本机推演

本地版本通过官方 [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) 使用你授权的 ChatGPT 套餐用量，不需要 OpenAI API Key 或 API 余额。项目仍按原流程工作：拆令 → 推演结构化事实 → 复核与存档 → 写成章回；这些步骤全部使用所选 OpenAI 模型。

需要 Node.js **22.12 或更新版本**。在你的电脑上运行：

```sh
git clone --branch feat/chatgpt-plus-local https://github.com/khe004/altertale.git altertale-plus
cd altertale-plus
npm ci
npm start
```

1. 用浏览器打开 `http://127.0.0.1:8787`。
2. 点击 **Continue with ChatGPT**，在打开的官方登录页选择你的 Plus / Pro 账户，并允许本应用使用 ChatGPT 套餐。
3. 登录后从账户实际可用的模型中选择。默认优先选 `gpt-6.1-sol` 的 `low` 推理档；如果账户没有它，页面会显示其他可选模型。拆令、预检和改字等小活会优先使用 `gpt-6-luna` 的 `low` 推理档，正式推演、复核和说书仍使用所选模型的 `low` 推理档。
4. 点“测试推演连接”，再选时代开局或继续存档。测试也占用少量套餐用量。

达到 ChatGPT 套餐或应用限额后会停止调用。点“管理用量”查看重置时间及应用限额。登录身份与授权使用套餐是两个权限；只登录身份时不会启用推演，也不会自动转为付费 API。模型与权限以当前账户的实际结果为准。

游戏记录保存在浏览器里。Sites 和本机页面的存档互不相通；在 Sites 点“导出”，再在本机开局页导入即可继续。保持同一个端口与浏览器即可继续本机存档；端口被占用时可用 `ALTERTALE_PORT=8788 npm start`，此时浏览器存档属于新地址。

登录 SDK 管理独立的应用注册、PKCE、身份验证、刷新与退出。加密的登录状态位于 `~/.config/altertale/chatgpt`，密钥由 macOS Keychain、Windows Credential Manager 或 Linux Secret Service 保存。凭证不交给网页，不使用 Codex 的登录文件，不写进仓库。macOS 首次访问 Keychain 可能要求你授权；Linux 必须运行并解锁 Secret Service，不能依靠无桌面环境的临时 kernel keyring。

退出登录会清除本机选中连接的凭证并尝试撤销远端授权。也可以在 ChatGPT 设置 → 安全与登录 → 登录连接中撤销本应用。关闭终端或按 Ctrl+C 会停止本机服务。

这里沿用官方本地 SDK，来源及其 **Noncommercial License** 见 [vendor/siwc](vendor/siwc/README.md)，适用于个人非商业本地试玩。该通用开源接入面向本地运行，不能把本机登录凭证上传到 Sites 来共享；远程托管应用应走另外的获批接入流程或 API 计费方式。

验证：

```sh
npm run check
```

本地集成测试用模拟登录和模型结果验证授权、流式完成、取消与加密；不消耗套餐。真实账户的登录、模型权限与一回推演需要你在本机授权后验证。

## Sites 部署

Sites 版本保留原有游戏与浏览器存档。`worker/index.js` 处理 `/api/openai`、`/api/anthropic` 同源转发，避免模型服务的浏览器跨域限制；Key 不进入源码或打包资源，转发不记录 Key 或提示词。

- 在开局页填写公网 HTTPS 接口地址（可填 `/v1` base 或完整 `/chat/completions` 地址）、Key、主模型名；小活模型可留空。
- 点“测试连接（小请求）”检查主模型与小活模型，然后保存。测试按服务商正常计费。
- 云端无法访问玩家电脑上的 `localhost` Ollama；直接打开 `web/index.html` 的本地模式仍支持本机接口。
- 可选的站点默认值通过 Sites 运行时环境变量配置，变量名见 `.env.example`。Key 不写进 `.openai/hosting.json`。

离线验证（不调用付费模型）：

```sh
node tools/check.js
node --test tools/api-test.mjs
node scripts/build-site.mjs
```

构建将 `web/` 资源嵌入单个 `dist/server/index.js`，并保留 `dist/.openai/hosting.json`。本机 ChatGPT 登录入口仅由本地服务器注入，Sites 仍使用 API 接口。部署前应先把对应源码提交同步到本项目的 Sites 源码仓库，再打包 `dist/` 并发布该提交。
