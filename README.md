# Socratic Digital Twin AI Tutor

NUS Faculty of Dentistry 教学概念验证：通过连续的苏格拉底式追问训练临床推理，而不是直接给出答案。

本项目默认即可运行。没有 Supabase 或 AI 凭证时，它会分别使用进程内存数据库和确定性教学引擎；配置凭证后，每个适配器会独立切换到真实服务。

## 功能

- 学生选择病例、完成五阶段推理会话并查看形成性总结
- AI 对每个回答分类为 `correct`、`partial`、`vague` 或 `wrong`
- 记录推理缺口、强项、弱项、阶段掌握度与历史错误
- Admin 管理预置用户、班级、五阶段病例版本与全局复核进度
- 教授布置班级任务、查看完整对话、认领并逐题重新标注
- 学生只看到所属班级的任务；Mock 三角色按具体预置用户使用签名 HttpOnly Cookie 切换
- Supabase、OpenAI 与 Claude 均有独立、可测试的本地回退实现

> 教学模拟用途。首版不包含真实患者数据、临床影像或医疗诊断功能。

## 文档 / Documentation

- [用户指南（中英双语） / Bilingual User Guide](docs/USER_GUIDE.md)
- [开发者指南（中英双语） / Bilingual Developer Guide](docs/DEVELOPER_GUIDE.md)
- [导师人性化与教授反馈闭环 / Tutor Humanization & Professor Feedback Loop](docs/HUMANIZATION_PLAN.md)

## 本地运行

要求 Node.js 22 或更高版本（当前 OpenAI 与 Supabase SDK 的受支持基线）。

```bash
npm install
copy .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。不填写外部服务变量也可以完成全部演示流程。

常用检查：

```bash
npm run typecheck
npm test
npm run build
```

## Docker 运行

项目提供可直接用于 Docker Engine / Docker Desktop 的生产镜像和 Compose 配置。Docker 本身是本地容器运行时，不会自动创建 Supabase 云项目；没有任何凭证时，容器仍可使用内存 repository 和确定性 tutor 完成演示。

先安装并启动 Docker Desktop（或其他兼容 Docker Compose v2 的 Engine），然后在项目根目录运行：

```bash
docker compose up --build
```

若当前网络无法访问 Docker Hub，但可以访问 AWS Public ECR，可直接覆盖为官方 Node 镜像的公共镜像地址：

```bash
docker build --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine -t socratic-tutor:poc .
```

默认访问 [http://localhost:3000](http://localhost:3000)。如果要从本地环境文件注入 Supabase/OpenAI/Claude 配置，PowerShell 和 macOS/Linux 均可显式指定：

```bash
docker compose --env-file .env.local up --build
```

停止并移除容器：

```bash
docker compose down
```

Compose 会通过 `/api/cases` 健康检查确认应用已启动。不要把 `.env.local`、服务端密钥或 API key 写入镜像、`Dockerfile`、Compose 文件或 Git；这些文件已被 `.dockerignore` 排除。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `DEMO_SESSION_SECRET` | 签名 Mock 身份 Cookie；生产环境必须设置 |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅服务端使用的数据库密钥，禁止使用 `NEXT_PUBLIC_` 前缀 |
| `FORCE_MEMORY_REPOSITORY` | 设为 `true` 时强制内存模式，适合本地验收 |
| `OPENAI_API_KEY` | OpenAI API 密钥，仅在服务端读取 |
| `OPENAI_MODEL` | 明确指定账号可用且支持 Structured Outputs 的 OpenAI 模型 ID |
| `OPENAI_PROXY_URL` | 可选；Node.js 无法直连 OpenAI 时使用的 HTTP(S) 代理 URL |
| `ANTHROPIC_API_KEY` | Claude API 密钥，仅在服务端读取 |
| `CLAUDE_MODEL` | 明确指定账号可用且支持 Structured Outputs 的 Claude 模型 ID |

适配器判断规则：

- 同时存在 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`：使用 Supabase；否则使用内存 repository。
- 同时存在 `OPENAI_API_KEY` 和 `OPENAI_MODEL`：优先使用 OpenAI Responses API。
- OpenAI 未配置而 `ANTHROPIC_API_KEY` 与 `CLAUDE_MODEL` 均存在时：使用 Claude；否则使用确定性 tutor。
- AI 请求超时、拒绝或结构化输出无效时，仅该次回答回退到确定性 tutor。

## Supabase 设置

数据库资产位于 `supabase/`：

- `migrations/20260809000000_create_socratic_digital_twin_schema.sql`
- `migrations/20260812000000_add_class_collaboration.sql`
- `seed.sql`
- `config.toml`

两份 migration 创建原有九张教学表，并扩展 `classes`、`class_memberships`、`class_case_assignments`、病例版本及复核认领。`commit_tutor_turn` 用一笔事务写入学生消息、AI 评价、追问和学习状态。所有公开表启用 RLS；`anon` 与 `authenticated` 无表权限，只有服务端 service role 获得明确授权。

远程开发项目：

```bash
npx supabase@latest login
npx supabase@latest link --project-ref YOUR_PROJECT_REF
npx supabase@latest db push
```

随后在 Supabase SQL Editor 中运行 `supabase/seed.sql`，或仅对一次性开发环境使用：

```bash
npx supabase@latest db push --include-seed
```

不要对包含真实数据的生产项目运行 `--include-seed` 或远程 reset。

如需本地 Supabase，需要 Docker-compatible runtime：

```bash
npx supabase@latest start
npx supabase@latest db reset
```

生成数据库类型：

```bash
npx supabase@latest gen types typescript --local > lib/database.types.ts
```

## OpenAI / Claude 设置

OpenAI（首选）：

1. 在本机 `.env.local` 中设置 `OPENAI_API_KEY`；不要把密钥写入源码、命令历史或 Git。
2. 将账号实际可用且支持 Structured Outputs 的模型 ID 写入 `OPENAI_MODEL`。
3. 重启开发服务器。

Claude（可选的第二适配器）：

1. 创建 Anthropic API 密钥，并写入 `.env.local` 的 `ANTHROPIC_API_KEY`。
2. 将账号可用的模型 ID 写入 `CLAUDE_MODEL`。
3. 重启开发服务器。

回答评估使用一次非流式 Responses API（OpenAI）或 Messages API（Claude）请求和 Zod Structured Outputs，返回分类、置信度、推理缺口、教学策略、一个追问及白名单记忆补丁。学生文本被当作不可信数据，模型输出只能通过状态机合并，不能直接覆盖数据库状态。会话结束时另行生成结构化学习总结；失败时使用本地模板。

## 演示流程

1. 用 Admin（Dr. Elaine Koh）查看六个预置用户、默认班级与病例版本。
2. Admin 可调整班级成员、发布五阶段病例或复制下一版草稿。
3. 用 Professor（Prof. Marcus Lim）向自己的班级布置已发布病例。
4. 用 Student（Alicia Tan）打开班级任务并完成一次回答；发送后学生消息会立即显示。
5. 结束会话后回到 Marcus 的 Review queue，首次保存草稿即认领。
6. 切换 Prof. Sarah Ng 验证同一复核只读/409 冲突保护，再由 Marcus 完成复核。
7. 回到 Admin 的 Activity 查看班级进度、AI 分数和复核归属。

## API

- `GET /api/cases`
- `POST /api/session/start`
- `POST /api/session/message`
- `GET /api/session/:id`
- `POST /api/session/:id/complete`
- `GET /api/professor/sessions`
- `GET /api/professor/classes`
- `GET/POST/PATCH /api/professor/assignments`
- `POST /api/professor/review`
- `GET /api/admin/overview`
- `GET/PATCH /api/admin/users`
- `GET/POST/PATCH /api/admin/classes`
- `PUT /api/admin/classes/:id/members`
- `GET/POST/PATCH /api/admin/cases`
- `POST /api/admin/cases/:id/publish`
- `POST /api/admin/cases/:id/clone`
- `GET /api/admin/sessions`
- `POST /api/admin/reviews/reassign`
- `GET /api/demo/identity`
- `POST /api/demo/identity`

学生 API 不返回逐题 AI 评价；完整评价仅对教授身份开放。消息提交可带 `clientRequestId`，服务器会对同一会话中的重复请求进行幂等处理。
