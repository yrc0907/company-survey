# 交付、Git 与模型集成规范

## 1. 双远端提交

本项目维护两个远端，所有功能完成并通过本地验证后都应提交本地 Git，并同步两个远端：

| Remote | 地址 | 分支策略 |
| --- | --- | --- |
| `origin` | `git@github.com:yrc0907/company-survey.git` | 本地 `main` 推送到 GitHub `main` |
| `gitee` | `https://gitee.com/yu-some/boss-survey.git` | 本地 `main` 推送到 Gitee `master` |

推荐交付节奏：项目骨架、可用前端、数据/API、部署配置、验收修复各自形成独立提交。不要把未验证的大量改动堆到一个提交里。

```text
git add <verified files>
git commit -m "feat: describe the verified change"
git push origin main
git push gitee main:master
```

若某个远端认证失败，保留本地提交并记录失败原因；不得为绕过认证而把 Token、私钥、密码或 API Key 写入 Git URL、源码、日志或文档。

## 2. 模型 Provider

默认配置目标：

| 配置项 | 值 |
| --- | --- |
| Base URL | `https://api.ymocode.com` |
| 默认模型 | `gpt5.6-Terra` |
| 默认思考强度 | `medium` |
| 思考模式 | 用户可选；仅在 Provider 声明支持时传递 |

实际 API Key 只允许由部署环境的 `.env`、服务器 Secret 或进程环境变量提供。`.env.example` 必须保持空值，任何提交、截图、终端输出和报告均不得包含真实 Key。

首次接入前必须验证：

1. API 是否兼容预期的请求格式；
2. 模型 ID 的精确拼写与可用性；
3. `reasoning_effort` 是否受支持，或是否需要省略；
4. 流式输出、视觉输入、结构化输出和错误返回的实际行为；
5. Provider 不可用时，页面是否明确降级而非伪造 AI 结果。

### 2.1 DeepSeek 备用模型与原生联网搜索

DeepSeek 官方文档显示其 OpenAI-compatible API 使用 `https://api.deepseek.com`，可调用 `deepseek-v4-flash`；思考模式可通过 `thinking` 与 `reasoning_effort` 配置。图片输入需要使用实验性 `deepseek-v4-flash-vision-exp`，不能假设普通文本模型具备视觉能力。

其 Responses API 支持服务端执行的 `web_search` 工具：

```json
{
  "model": "deepseek-v4-flash",
  "input": "检索一个公开问题，并给出引用",
  "tools": [{ "type": "web_search" }]
}
```

这项能力适合用于国际资料补充、公开网页初步检索和模型驱动的事实核验，但不能替代双来源搜索设计：官方文档说明 `search_context_size` 与 `user_location` 会被忽略，应用无法可靠要求它只返回中国大陆或某个固定地区的搜索结果。因此：

- 国内政策、中文监管和国内企业研究仍使用显式配置的国内搜索 Provider；
- DeepSeek 原生 `web_search` 作为 `global`/通用检索 Provider，结果必须标为 `provider=deepseek_native_web` 与 `scope=global_or_unknown`；
- 搜索调用、查询语句、返回 URL、抓取时间和写入报告的引用必须记录；
- 未配置新 Key 时不显示“联网搜索已启用”。

真实 Key 曾在聊天中暴露，不能用于可信生产配置。应在服务商后台轮换，然后仅在服务器 `.env` 设置 `DEEPSEEK_API_KEY`。真实连通测试只发公开测试问题，不上传用户报告、文件或个人资料。

## 3. 联网搜索 Provider

搜索必须按来源范围拆分，而不是让一个搜索接口承担所有事实判断：

| 范围 | 配置 | 适用问题 | 输出要求 |
| --- | --- | --- | --- |
| 国际 | `SEARCH_GLOBAL_PROVIDER`、`SEARCH_GLOBAL_API_KEY` | 海外公司、国际媒体、英文资料、全球竞品、Google 类结果 | 标记 `scope=global`、语言、URL、抓取时间和 Provider |
| 国内 | `SEARCH_DOMESTIC_PROVIDER`、`SEARCH_DOMESTIC_API_BASE_URL`、`SEARCH_DOMESTIC_API_KEY` | 中国公司、监管政策、中文媒体、国内行业信息 | 标记 `scope=domestic`、语言、URL、抓取时间和 Provider |

路由规则：

```text
用户明确选择“国内”或“中国政策” -> 国内 Provider
用户明确选择“国际”或“海外公司” -> 国际 Provider
跨境/不明确问题 -> 并行搜索并在结果中分组展示，不混合排序为单一事实
Provider 未配置/失败 -> 显示明确未配置或失败状态，不使用模型补造搜索结果
```

国内搜索服务的 Key 不能仅凭 Key 接入；还需要服务商文档中的 Base URL、鉴权方式、请求参数、速率限制和返回 Schema。以上配置保持空值，直到这些信息在服务器本地配置完成。

### 3.1 当前接入决策

初版不接入博查。搜索 Provider 的优先级和启用条件如下：

| Provider | 当前状态 | 用途 | 启用条件 |
| --- | --- | --- | --- |
| DeepSeek 原生 `web_search` | 协议已确认，运行时待轮换 Key 验证 | 国际/通用公开资料检索 | 默认优先；结果标记 `scope=global_or_unknown` |
| YMO 模型 Provider | 模型调用待验证，原生搜索能力未确认 | 报告改写、摘要、RAG 回答 | 只有提供商文档或实测确认 `web_search` 后才加入搜索路由 |
| 博查国内搜索 | 禁用，不配置 Key | 中文政策、国内企业与中文网页的范围可控检索 | DeepSeek/YMO 搜索不可用，或需要稳定国内来源分组时启用 |

决策规则：

```text
DeepSeek 原生搜索可用 -> 先使用，不接博查
YMO 原生搜索也验证可用 -> 按模型选择或成本路由使用，不接博查
两者任一不可用 -> 另一模型仍可承接通用搜索
两者均不可用，或用户明确要求国内来源 -> 启用博查国内搜索 Provider
```

即使模型原生搜索可用，报告仍必须显示 Provider、URL、抓取时间、来源范围和引用片段。模型原生搜索不能成为无来源、不可复核的黑盒答案。

## 4. 个人服务器部署约束

目标服务器为 Ubuntu 22.04、2 vCPU、2 GiB 内存、20 GiB 磁盘、100 Mbps 峰值带宽的个人实例。

初版只运行：

```text
Caddy + Next.js + PostgreSQL + 文件卷 + 外部搜索/模型 API
```

不运行本地模型、独立 OCR、Neo4j、Redis、RabbitMQ、Temporal 或 Kubernetes。Docker 镜像优先在本地构建或使用 CI 构建，避免 2 GiB 服务器在构建阶段内存不足。

部署前需要：

- 域名与 DNS（长期公网使用时）；
- 安全组仅开放 `22`、`80`、`443`，SSH 应限制来源 IP；
- 服务器本地 `.env`，其中写入新的模型 Key、数据库密码和应用密码；
- 至少 1 GiB swap；
- PostgreSQL 和上传文件的定期备份；
- 磁盘剩余空间、外网流量和容器健康检查告警。

## 5. 安全说明

- 上传的 PDF、图片、网页正文和模型输出均不可信；
- 调用外部模型或搜索 Provider 会把当前请求所需的文本发送给该 Provider，用户应只导入有权处理的资料；
- AI 只能提出报告 Diff，确认后才写入；
- 模型和搜索 API Key 已曾在聊天中暴露，应立即在服务商后台轮换。新 Key 不得发送到聊天或提交到仓库。
