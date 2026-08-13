# Tutor Humanization & Professor Feedback Loop / 导师人性化与教授反馈闭环

## 中文

### 目标

让导师更像一位会倾听、会承接学生思路、会适度搭脚手架的真人教师，同时保持评分稳定、教学安全和可回滚。教授评分不会直接在线“训练”生产模型；它先成为脱敏、版本化的离线评测数据，只有通过门槛并获人工批准的候选版本才能发布。

### 目前能学到什么

逐题复核既记录教授对**学生答案**的 `correct / partial / vague / wrong` 标签与评论，也通过 `tutor_turn_reviews` 记录导师追问的自然度、针对性、非引导性、难度适配、帮助程度、问题标签及教授建议改写。两类信号分别用于分类校准和导师质量改进，避免把“答案评分”误当成“导师像不像真人”。

### 数据与版本

每个导师 turn 应保存 `provider`、`model`、`prompt_version`、病例版本、phase、attempt、AI 输出、教授答案标签和导师质量评分。自由文本先去除学生身份信息；不保存隐藏思维链。提示词存为不可变版本，生产版本可一键回滚。

### 离线评测门槛

1. 答案判断：exact agreement、balanced accuracy、ordinal weighted Cohen's kappa、数值 MAE 与 signed bias。
2. 置信度：Brier score 与 ECE，按 phase、attempt、provider 和病例分层。
3. 教学质量：盲评自然度、针对性、单一开放问题、非引导性、无诊断泄漏、无小讲课。
4. 学习效果：下一次教授标签是否提升、同阶段恢复率、false-advance rate；不能把“完成会话”误当成“掌握”。
5. 发布条件：固定 time-based holdout、至少双教授盲评子集、分歧仲裁、最小样本量、无安全回归。

### 发布流程

`生产快照 → 脱敏 → 教授标注/仲裁 → 生成候选 prompt → 离线对照 → shadow → 小流量 A/B → 教授批准 → 分阶段发布/回滚`

禁止从单个教授评论直接在线自训，也禁止用教授纠偏在运行时改写学生记忆或自动推进阶段。

### 已落地（human-v1 与教授质量反馈）

- OpenAI 与 Claude 共用同一版本化提示词，避免行为漂移。
- 明确四分类边界和可校准置信度含义。
- 追问必须先承接学生答案中的一个具体想法或不确定点，再提出恰好一个开放、非引导问题。
- 禁止通用表扬、复述题干、多问题和直接给答案；按第 1/2/3 次尝试渐进搭脚手架。
- Structured Output 强制恰好一个问号；无效输出走既有确定性回退，不写入半成品评估。
- 教授复核页提供五项 1–5 分导师质量评分、失败标签、可选建议改写和评论，并持久化到 Supabase 或内存 repository。
- 新增离线指标模块，计算教授覆盖率、AI/教授一致率、balanced accuracy、MAE、signed bias、Brier、false-advance 与导师质量通过率。
- 新评估记录保存 phase、attempt、provider、model 与 prompt version，支持按版本切片比较；历史记录保持兼容。
- Admin Feedback Lab 已实现冻结数据集、candidate、离线 gate、0% Shadow、最多 25% A/B、教授追加式批准、Admin 发布和带操作者/原因的回滚审计。
- 数据库重复执行关键门槛：至少 20 条样本、至少两位教授、离线通过、Shadow 有记录并暂停后才可进入 A/B；A/B 有记录后教授才能批准；任何教授 rejection 都会阻止发布。
- 历史 tutor-quality 评分只属于历史 baseline，绝不复制成新 candidate 的“人工评分”。新 candidate 的人工判断只来自 A/B 观察后独立的 faculty checkpoint。

## English

### Goal

Make the tutor feel like an attentive human teacher who acknowledges the learner's actual reasoning and provides proportionate scaffolding, while preserving reliable grading, safety, and rollback. Professor feedback is never used for direct online self-training. It first becomes a de-identified, versioned offline evaluation set; only candidates that pass gates and receive human approval may ship.

### What current reviews can teach us

Turn reviews now capture both a professor's `correct / partial / vague / wrong` judgement of the **student answer** and a dedicated `tutor_turn_reviews` record for the tutor intervention. The latter stores naturalness, specificity, non-leadingness, challenge fit, helpfulness, failure tags, and an optional preferred rewrite. These two signals serve classifier calibration and tutor-quality improvement separately.

### Data and versioning

Persist `provider`, `model`, `prompt_version`, case version, phase, attempt, AI output, professor answer label, and tutor-quality ratings per turn. De-identify free text, never store hidden chain-of-thought, keep prompt versions immutable, and support one-click rollback.

### Offline gates

1. Answer judgement: exact agreement, balanced accuracy, ordinal weighted Cohen's kappa, numeric MAE, and signed bias.
2. Confidence: Brier score and ECE, sliced by phase, attempt, provider, and case.
3. Teaching quality: blinded faculty ratings for naturalness, specificity, a single open question, non-leadingness, no diagnosis leakage, and no mini-lecture.
4. Learning: next-turn professor-label gain, same-phase recovery, and false-advance rate; session completion is not treated as mastery.
5. Release: frozen time-based holdout, a double-rated faculty subset with adjudication, minimum sample sizes, and no safety regression.

### Release flow

`Production snapshot → de-identification → faculty labels/adjudication → candidate prompt → offline comparison → shadow → limited A/B → faculty approval → staged rollout/rollback`

Never train online from one professor comment, and never let a professor correction rewrite learner memory or phase progression at runtime.

### Implemented (`human-v1` and faculty tutor-quality feedback)

- OpenAI and Claude now share one versioned prompt contract.
- Classification boundaries and calibrated-confidence semantics are explicit.
- A follow-up must acknowledge one specific idea or uncertainty in the learner's answer before asking exactly one open, non-leading question.
- Generic praise, question repetition, multi-part questions, and answer revealing are prohibited; scaffolding changes across attempts 1, 2, and 3+.
- Structured output enforces exactly one question mark; invalid output uses the existing deterministic fallback and is not partially persisted.
- The professor review page collects five 1–5 tutor-quality ratings, failure tags, an optional preferred rewrite, and comments, persisted through both Supabase and in-memory repositories.
- A new offline metrics module reports faculty coverage, AI/faculty agreement, balanced accuracy, MAE, signed bias, Brier score, false-advance rate, and tutor-quality pass rate.
- New evaluations persist phase, attempt, provider, model, and prompt version for version-sliced comparisons while remaining compatible with historical records.
- The Admin Feedback Lab implements frozen datasets, candidates, offline gates, 0% shadow, at most 25% A/B, append-only professor approval, Admin release, and actor/reason rollback audit.
- Database triggers repeat the important ordering rules: at least 20 samples from two faculty sources, passed offline gate, recorded-and-paused shadow before A/B, observed A/B before approval, and no release when any faculty rejection exists.
- Historical tutor-quality ratings remain baseline evidence and are never attributed to a newly generated candidate; candidate faculty judgement begins only after observed A/B evidence.
