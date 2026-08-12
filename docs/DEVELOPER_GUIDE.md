# 开发者指南 / Developer Guide

本文档面向需要本地运行、调试、扩展或部署 Socratic Digital Twin AI Tutor 的开发者。中文说明在前，英文说明在后。

---

# 中文版

## 1. 系统定位

这是一个教学概念验证（POC），用于演示“Admin 组织教学 → Professor 布置病例 → Student 完成苏格拉底式推理 → Professor 复核 → Admin 观察全局状态”的闭环。

它不是临床诊断系统，不包含真实患者数据，也没有正式注册、OAuth 或 Supabase Auth。身份来自预置用户，并通过服务端签名的 HttpOnly Cookie 保存。

## 2. 技术栈与要求

- Next.js 15 App Router、React 19、TypeScript、Tailwind CSS
- Node.js 22 或更高版本
- Zod 共享输入/输出校验
- Supabase PostgreSQL（可选）或进程内存 repository
- OpenAI Responses API（优先，可选）、Claude Messages API（可选）或确定性 tutor
- Vitest、ESLint、TypeScript 和 Next.js production build

## 3. 快速启动

```bash
npm install
copy .env.example .env.local
npm run dev
```

打开 `http://localhost:3000`。完全不配置外部凭证时，应用仍可使用内存数据和确定性 tutor 运行完整演示。

提交代码前执行：

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## 4. 双适配器架构

```mermaid
flowchart LR
  UI["Next.js pages"] --> API["Server route handlers"]
  API --> Auth["Signed demo identity"]
  API --> SM["Explicit tutor state machine"]
  SM --> Repo{"Repository"}
  Repo -->|"Supabase credentials"| DB["Supabase PostgreSQL"]
  Repo -->|"No credentials / forced"| Memory["In-memory repository"]
  SM --> Tutor{"Tutor engine"}
  Tutor -->|"OpenAI key + model"| OpenAI["OpenAI Responses API"]
  Tutor -->|"Claude key + model"| Claude["Claude Messages API"]
  Tutor -->|"Unavailable or invalid"| Rules["Deterministic tutor"]
```

数据库与 AI 适配器独立选择。例如，可以使用真实 Supabase 加确定性 tutor，也可以使用内存 repository 加 OpenAI。

选择规则：

1. `FORCE_MEMORY_REPOSITORY=true` 强制内存模式。
2. 否则同时存在 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 时使用 Supabase。
3. 同时存在 `OPENAI_API_KEY` 和 `OPENAI_MODEL` 时优先使用 OpenAI。
4. OpenAI 未配置且同时存在 `ANTHROPIC_API_KEY` 和 `CLAUDE_MODEL` 时使用 Claude。
5. AI 未配置，或单次调用失败、超时、拒答、输出不合法时使用确定性 tutor。

## 5. 环境变量

| 变量 | 必需性 | 说明 |
| --- | --- | --- |
| `DEMO_SESSION_SECRET` | 生产必需 | HMAC 签名 Mock 身份 Cookie；使用长随机值 |
| `SUPABASE_URL` | 可选 | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 可选 | 仅服务端使用；绝不能添加 `NEXT_PUBLIC_` 前缀 |
| `FORCE_MEMORY_REPOSITORY` | 可选 | `true` 时忽略 Supabase 配置 |
| `OPENAI_API_KEY` | 可选 | 仅服务端读取 |
| `OPENAI_MODEL` | 与 OpenAI key 配套 | 账号可用并支持 Structured Outputs 的模型 ID |
| `OPENAI_PROXY_URL` | 可选 | Node.js 访问 OpenAI 的 HTTP(S) 代理 |
| `ANTHROPIC_API_KEY` | 可选 | 仅服务端读取 |
| `CLAUDE_MODEL` | 与 Claude key 配套 | 账号可用并支持 Structured Outputs 的模型 ID |

密钥只放在 `.env.local`、Vercel Environment Variables 或安全的 secret manager 中。不要提交 `.env.local`，不要在客户端组件读取 service-role key 或 AI key。

## 6. 代码结构

| 路径 | 职责 |
| --- | --- |
| `app/page.tsx` | 学生任务入口 |
| `app/session/[id]` | 对话和总结页面 |
| `app/professor` | 教授班级、任务和复核队列 |
| `app/admin` | 用户、班级、病例和 Activity |
| `app/api` | 服务端 API 与资源级权限检查 |
| `components/site-header.tsx` | 预置身份切换 |
| `lib/domain.ts` | 核心领域类型与评分常量 |
| `lib/schemas.ts` | 共享 Zod schema |
| `lib/auth.ts` | Cookie 签名、校验和角色守卫 |
| `lib/repository` | repository 接口、内存实现与 Supabase 实现 |
| `lib/tutor` | OpenAI、Claude、确定性 tutor、总结与状态机 |
| `supabase/migrations` | 版本化数据库 schema |
| `supabase/seed.sql` | 可重复执行的演示数据 |

## 7. 身份与权限

`POST /api/demo/identity` 只接受 `{ "userId": "<预置 UUID>" }`。角色由服务器从 repository 读取，客户端不能自行提交 `role=admin` 来提升权限。

`requireStudent()`、`requireProfessor()` 和 `requireAdmin()` 负责角色校验；API 还必须做资源级检查：

- 学生只能访问自己的会话和当前所属班级的任务。
- 教授只能访问自己任教班级的任务与会话。
- Admin 才能管理用户、班级、病例版本和复核归属。
- 停用用户不能切换身份或继续使用受保护接口。

这是演示身份系统，不应直接改造成生产认证。正式系统应接入机构身份提供商，并把外部身份映射到内部用户和班级权限。

## 8. 教学状态机

学生提交回答后，`lib/tutor/state-machine.ts` 按以下顺序处理：

1. 读取会话并校验所有权与状态。
2. 读取当前阶段和该阶段尝试次数。
3. 调用 AI tutor；失败则回退到确定性 tutor。
4. 生成一条学生消息、评价、学习记忆补丁和一个追问。
5. 仅合并白名单字段：错误、强项、弱项、掌握度和下一策略。
6. 使用 `expectedVersion` 做乐观并发控制并原子持久化本轮。
7. `correct` 推进阶段；否则继续追问。第三次仍未掌握也推进，防止死循环。
8. 第五阶段完成后自动生成总结；学生也可以提前结束并生成 `completedAllPhases=false` 的总结。

AI 评分映射为 `correct=100`、`partial=70`、`vague=40`、`wrong=0`，最后取平均并四舍五入。教授最终评分独立保存，不覆盖 AI 原始评价。

## 9. 数据库与 Supabase

主要表包括：

- `users`
- `classes`、`class_memberships`
- `cases`、`case_phases`、`class_case_assignments`
- `sessions`、`messages`、`evaluations`、`session_state`
- `answer_reviews`、`session_reviews`

远程项目初始化：

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push
```

然后在 SQL Editor 运行 `supabase/seed.sql`。仅在一次性开发环境中使用：

```bash
npx supabase@latest db push --include-seed
```

不要对含有需要保留数据的远程项目执行 reset 或重复导入破坏性 seed。

所有公开表启用 RLS，且撤销 `anon`/`authenticated` 的直接表权限。浏览器不直接连接数据库；所有查询通过服务端 service-role repository。`commit_tutor_turn` 数据库函数用于原子写入一次教学回合。

## 10. 病例、任务与复核规则

- 病例草稿必须完整包含五个阶段。
- 已发布病例不可原地编辑；修改时 Clone 为下一版本草稿。
- 教授只能把已发布病例布置给自己的班级。
- 截止或关闭后不能创建新会话；已开始的会话仍可继续。
- 每名学生对每个班级任务只保留一个会话，重复开始会恢复原会话。
- 只有已完成会话可以被复核。
- 第一位保存草稿的教授原子认领复核；其他教授只读。
- Admin 可以释放或重新指派未完成复核；已完成复核不可覆盖。

## 11. API 约定

完整 API 列表见根目录 `README.md`。关键请求：

```json
POST /api/session/start
{ "assignmentId": "uuid" }
```

```json
POST /api/session/message
{
  "sessionId": "uuid",
  "message": "student reasoning",
  "clientRequestId": "client-generated-id"
}
```

```json
POST /api/professor/review
{
  "sessionId": "uuid",
  "reviews": [{ "evaluationId": "uuid", "label": "partial", "comments": "..." }],
  "overallFeedback": "...",
  "status": "draft"
}
```

公开请求与 AI 输出都必须先通过共享 Zod schema。学生会话响应会剥离 AI 推理缺口、分类和学习弱点；教授视图才返回完整评价。

## 12. 测试策略

```bash
npm run typecheck       # TypeScript
npm test                # Vitest 单元和集成测试
npm run lint            # ESLint
npm run build           # Next.js 生产构建
```

测试重点：

- 四种评价与分数计算
- 三次尝试保护、阶段推进和提前结束
- 记忆补丁白名单
- 身份签名和篡改保护
- 班级隔离、任务可用窗口、会话恢复
- 复核认领冲突和已完成锁定
- OpenAI/Claude 合法输出、无效输出与回退

涉及 UI、Cookie、跨角色状态或部署差异的改动，还应在真实浏览器中执行 Student → Professor → Admin 的端到端流程，并检查 Console、Network 和最终数据库状态。

## 13. Docker 与部署

本地容器：

```bash
docker compose up --build
docker compose down
```

部署到 Vercel 时：

1. 导入 GitHub repository。
2. 确认 Node.js 版本满足 `package.json` 的 engines。
3. 在 Project Settings → Environment Variables 配置服务端变量。
4. 部署后分别用三种身份执行 smoke test。
5. 检查 Vercel Runtime Logs，确认没有持续 4xx/5xx 或 AI 密钥错误。

不要把 production secret 写入 `vercel.json`、Docker image、源码或截图。

## 14. 常见问题

### 页面有数据，但重启后消失

当前运行在内存 repository。检查 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY` 是否同时存在，并确认 `FORCE_MEMORY_REPOSITORY` 不是 `true`。

### 页面显示 Demo tutor

AI 凭证或模型 ID 未完整配置，或者该次 AI 调用回退。检查服务端日志中的 provider、request ID 和错误类型；日志不应记录学生全文或密钥。

### Professor 看不到班级或会话

确认该教授存在于 `class_memberships`，任务属于同一班级，且会话引用正确的 `class_case_assignment_id`。

### Close/Reopen 或日期请求返回 400

API 接受带 `Z` 或显式时区偏移的 ISO-8601 字符串。确保截止时间严格晚于开放时间。

### Supabase 返回权限错误

确认服务端使用 service-role key，而不是 anon key；确认 migrations 已执行。绝不能通过 `NEXT_PUBLIC_` 暴露 service-role key。

## 15. 安全与后续开发检查表

- 将学生回答视为不可信输入并限制长度。
- 不保存或展示隐藏 chain-of-thought。
- AI 输出只作为建议，必须通过 Zod 并由状态机合并。
- 数据库写入使用事务、唯一约束或版本号保证幂等和并发安全。
- 新 API 同时加入角色与资源级授权测试。
- 修改数据库时新增 migration，不改写已经应用的历史 migration。
- 新增 provider 时保持 `TutorEngine` 接口和确定性回退。
- 正式上线前用真实认证替换 Mock Cookie，并完成隐私、审计、保留期和教育数据合规评估。

---

# English Version

## 1. Purpose

This teaching POC demonstrates an end-to-end workflow: Admin organizes teaching, Professor assigns a case, Student completes Socratic reasoning, Professor reviews the submission, and Admin monitors the overall state.

It is not a clinical diagnostic system. It stores no real patient data and does not implement production registration, OAuth, or Supabase Auth. A signed HttpOnly cookie stores the selected seeded demo identity.

## 2. Stack and requirements

- Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS
- Node.js 22+
- Shared Zod validation
- Supabase PostgreSQL or an in-process repository
- OpenAI Responses API, Claude Messages API, or the deterministic tutor
- Vitest, ESLint, TypeScript, and Next.js production builds

## 3. Quick start

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. With no external credentials, the complete demo runs with in-memory data and the deterministic tutor.

Run before submitting changes:

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## 4. Adapter architecture

The database and AI providers are selected independently. `FORCE_MEMORY_REPOSITORY=true` forces memory mode. Otherwise, a complete Supabase URL/service-role pair enables Supabase. A complete OpenAI key/model pair selects OpenAI first; otherwise a complete Anthropic key/model pair selects Claude. Missing credentials or a failed individual AI call fall back to the deterministic tutor.

The browser never receives database or AI credentials. Pages call Next.js server routes, which apply authentication, authorization, Zod validation, state-machine rules, and repository operations.

## 5. Environment variables

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `DEMO_SESSION_SECRET` | Required in production | HMAC secret for the demo identity cookie |
| `SUPABASE_URL` | Optional | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-only database key; never prefix with `NEXT_PUBLIC_` |
| `FORCE_MEMORY_REPOSITORY` | Optional | Forces the in-memory adapter |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Optional pair | Preferred structured-output tutor |
| `OPENAI_PROXY_URL` | Optional | HTTP(S) proxy used by the Node.js OpenAI client |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` | Optional pair | Secondary structured-output tutor |

Keep secrets in `.env.local`, Vercel Environment Variables, or a secret manager. Never commit them or import them into client components.

## 6. Repository layout

| Path | Responsibility |
| --- | --- |
| `app/` | App Router pages and server APIs |
| `components/site-header.tsx` | Seeded identity selector |
| `lib/domain.ts` | Domain types and scoring constants |
| `lib/schemas.ts` | Shared Zod schemas |
| `lib/auth.ts` | Cookie signing and role guards |
| `lib/repository/` | Interface, memory adapter, and Supabase adapter |
| `lib/tutor/` | Providers, deterministic fallback, summaries, and state machine |
| `supabase/migrations/` | Versioned database schema |
| `supabase/seed.sql` | Idempotent demo data |

## 7. Identity and authorization

`POST /api/demo/identity` accepts only a seeded `userId`. The server derives the role from the repository, preventing the client from declaring elevated privileges. Route handlers use `requireStudent`, `requireProfessor`, or `requireAdmin`, followed by resource-level checks for session ownership and class membership.

This mechanism is intentionally limited to the POC. A production system should use an institutional identity provider and map external identities to internal users and class permissions.

## 8. Tutor state machine

For each student answer, the state machine:

1. Loads the session and checks ownership/status.
2. Resolves the current phase and attempt number.
3. Calls the selected tutor, with deterministic fallback.
4. Creates one student message, evaluation, allow-listed memory patch, and follow-up.
5. Commits the turn atomically with an expected state version.
6. Advances on `correct`, or after the third unsuccessful attempt.
7. Completes automatically after phase five, or produces an incomplete summary when the learner ends early.

AI scoring is the rounded average of `correct=100`, `partial=70`, `vague=40`, and `wrong=0`. The professor score is stored independently.

## 9. Supabase setup

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push
```

Run `supabase/seed.sql` in the SQL Editor, or use `db push --include-seed` only for a disposable development project.

The schema covers users, classes and memberships, versioned cases and phases, assignments, sessions, messages, evaluations, learner state, and reviews. Public tables use RLS and revoke direct `anon`/`authenticated` table access. Only the server-side service-role repository accesses them. `commit_tutor_turn` atomically persists a teaching turn.

## 10. Core business rules

- Draft cases require exactly five complete phases.
- Published cases are immutable; clone a new draft version to edit.
- Professors may assign only published cases to their own classes.
- Closed or expired assignments cannot start new sessions; an existing session may continue.
- A student has one resumable session per assignment.
- Only completed sessions may be reviewed.
- The first professor to save a draft atomically claims the review; colleagues become read-only.
- Admin may release or reassign unfinished reviews; completed reviews are locked.

## 11. API conventions

API bodies and AI output use shared Zod schemas. Use `assignmentId` to start a session. Message submissions should include a client-generated `clientRequestId` for idempotency. Review writes send a batch of evaluation labels and comments plus overall feedback and a `draft` or `completed` status.

Student session responses omit AI classifications, reasoning gaps, and private learner weaknesses. Professor views receive the full evaluation and transcript.

## 12. Testing

Run the four standard gates shown in Quick Start. Automated coverage includes scoring, all four classifications, phase progression, three-attempt protection, memory allow-listing, early completion, signed-cookie tamper resistance, class isolation, review claiming, and AI adapter fallback.

Changes involving UI state, cookies, permissions, or persistence also require a real-browser Student → Professor → Admin test. Inspect browser Console and Network output and confirm the resulting database state.

## 13. Docker and deployment

```bash
docker compose up --build
docker compose down
```

For Vercel, import the GitHub repository, configure all server-only environment variables in Project Settings, deploy, and run a three-role smoke test. Review Runtime Logs for persistent 4xx/5xx or provider configuration errors. Never place production secrets in source, `vercel.json`, Docker images, screenshots, or browser-visible variables.

## 14. Troubleshooting

- Data disappears after restart: the memory repository is active; verify the complete Supabase credential pair and `FORCE_MEMORY_REPOSITORY`.
- UI shows Demo tutor: provider configuration is incomplete or that request fell back. Inspect redacted server logs for provider, request ID, and error type.
- Professor cannot see a class/session: verify class membership, assignment ownership, and `class_case_assignment_id`.
- Assignment dates return 400: send ISO-8601 with `Z` or an explicit offset, and keep the due time strictly later than the opening time.
- Supabase permission error: use the service-role key only on the server and confirm all migrations were applied.

## 15. Security and extension checklist

- Treat student answers as untrusted and length-limited input.
- Never request, store, or display hidden chain-of-thought.
- Validate model output and merge only allow-listed state changes.
- Preserve atomicity, uniqueness, idempotency, and optimistic version checks.
- Add role and resource authorization tests for every new API.
- Add new migrations instead of rewriting applied history.
- Keep the deterministic fallback when adding providers.
- Replace demo auth and complete privacy, audit, retention, and educational-data compliance work before production use.
