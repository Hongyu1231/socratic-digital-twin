# 用户指南 / User Guide

本指南说明如何以 Student、Professor 和 Admin 三种角色使用 Socratic Digital Twin AI Tutor。中文在前，英文在后。

> 本系统仅用于教学模拟，不提供临床诊断，不应录入真实患者身份资料。

---

# 中文版

## 1. 开始使用

打开应用首页。右上角显示当前角色和身份。首次打开通常使用默认学生身份。

切换用户：

1. 点击右上角当前身份，例如 **Student**、**Professor** 或 **Admin**。
2. 在 **Demo identity** 列表中选择具体预置用户。
3. 系统会根据该用户在服务器中的真实角色进入对应页面。

常用演示身份包括 Alicia Tan、Benjamin Lee、Chloe Wong、Prof. Marcus Lim、Prof. Sarah Ng 和 Dr. Elaine Koh。可见用户、班级名称和任务以当前部署数据为准。停用用户不会出现在可用身份列表中。

## 2. Student 学生指南

### 选择任务

学生首页只显示自己所属班级中当前可用的任务。卡片包含病例名称、班级、开放状态和学习重点。

- **Begin Socratic session**：第一次开始该任务。
- **Continue session**：恢复该任务已有的会话。
- **Resume paused session**：恢复之前明确暂停的会话，阶段、对话和学习状态均会保留。
- 已关闭或过期但已有会话的任务仍可显示，学生可以继续；不能为不可用任务创建新会话。

### 完成对话

1. 阅读左侧病例说明和当前阶段目标。
2. 在 **Your clinical reasoning** 中输入你的判断及理由。
3. 点击 **Send answer**，或按 Enter 发送；Shift+Enter 换行。
4. 你的回答会立即出现在对话中，然后显示等待状态，最后出现 tutor 的一个追问。

左侧 **Case attachments** 提供合成教学图片和病例描述朗读。点击麦克风可使用浏览器语音听写；点击 tutor 消息旁的 **Read aloud** 可朗读单条回复，**Auto-read** 可自动朗读新的 tutor 回复。语音能力依赖浏览器支持，并且不应录入真实患者身份资料。

点击 **Pause & return to cases** 会保存当前阶段、对话和学习状态并返回首页。首页卡片随后显示 **Resume paused session**；恢复前 API 不接受新的学生回答。

请表达推理证据，而不只是最终答案。Tutor 不会直接展示内部分类或推理缺口给学生。

流程共有五个阶段：

- 回答掌握当前目标时进入下一阶段。
- 未掌握时 tutor 会继续追问。
- 同一阶段第三次仍未掌握时，系统记录未解决问题并自动推进，避免卡住。
- 第五阶段完成后自动生成学习总结。

### 提前结束与总结

点击 **End session & view summary** 并确认，可以提前结束。总结会明确反映尚未完成全部阶段。

总结页包含：

- Reasoning score：基于学生已表达推理的 AI 形成性分数。
- Strengths：本次表现出的强项。
- Reasoning gaps：仍需补足的推理缺口。
- Next steps：建议的练习方向。

点击 **Choose another case** 返回任务列表。演示时可点击 **Open professor review**，系统会切换到可用教授身份并打开同一会话的复核页。

## 3. Professor 教授指南

Professor 首页包含三个标签页。

### My classes

显示教授任教的班级、学生人数、教师人数和任务数量。点击 **Manage assignments** 可进入对应班级的任务页。

### Assignments

创建任务：

1. 点击 **New assignment**。
2. 选择自己的班级和一个已发布病例。
3. 设置 Opens 和可选 Deadline；截止时间必须晚于开放时间。
4. 点击 **Publish**。

已发布任务可点击 **Close** 手动关闭，再点击 **Reopen** 重开。关闭后学生不能开始新会话；已经开始的会话仍可继续。

### Review queue

可用筛选：All、Ready to claim、My draft、Claimed by colleague、Completed。

- **Student in progress**：学生仍在作答，只可查看，不能保存复核。
- **Ready to claim**：已完成且尚未被教授认领。
- **My draft**：由当前教授认领、尚未完成的复核。
- **Claimed by colleague**：另一名教授已认领，只读。
- **Completed**：最终复核已锁定。

### 逐题复核

复核页会显示原始对话、AI 分类、置信度、推理缺口、教学策略和学习者模型。

1. 为每条回答选择 `correct`、`partial`、`vague` 或 `wrong`。
2. 可填写逐题 Comments。
3. 填写 Overall feedback。
4. 点击 **Save draft** 保存草稿。第一次保存会原子认领该复核。
5. 点击 **Complete review** 提交最终复核。

其他教授仍能阅读该会话，但不能覆盖认领人的草稿。教授最终分数独立于 AI 分数保存。

## 4. Admin 管理员指南

Admin workspace 包含 Overview、Users、Classes、Cases 和 Activity。

### Overview

查看用户、班级、开放任务、会话和待复核统计。快捷入口可跳到组织班级、发布病例和校准进度。

### Users

1. 使用角色筛选查找用户。
2. 点击 **Edit** 修改姓名、邮箱或 **Account active**。
3. 点击 Save。

停用用户不能再切换身份或调用受保护接口。此 POC 只维护预置用户资料，不创建真实登录凭证。

### Classes

点击 **Create class** 设置名称、代码、学期和状态。创建后点击 **Manage class**：

- 编辑班级基本资料。
- 勾选多名学生和教授。
- 从已选教授中指定一个 **Lead**。
- 点击 **Save members**。

成员关系决定教授能看到哪些会话，以及学生能看到哪些任务。

### Cases

点击 **New case draft** 创建病例。一个可发布病例必须包含：

- 标题、难度、说明和学习目标。
- 正好五个教学阶段。
- 每阶段的标题、Learning goal、Rubric criteria、Starter question 和 Follow-up question bank。

草稿可 **Edit**。点击 **Publish** 后病例版本锁定，不再原地编辑。需要修改时点击 **New version** 创建下一版草稿。点击 Archive 图标可归档不再使用的版本。

### Activity

按班级查看学生状态、病例、AI 分数、复核状态和所有权。

- 未完成复核可选择班级教授并点击保存按钮重新指派。
- 选择 **Release claim** 可释放认领。
- 已完成复核显示 **Completed**，不能被重新指派或覆盖。

## 5. 推荐三角色演示流程

1. 以 Dr. Elaine Koh 进入 Admin，查看 Users、Classes 和 Cases。
2. 创建或管理一个班级，加入至少一名学生和两名教授，并设置 lead professor。
3. 创建完整五阶段病例草稿，保存、发布，并演示 **New version**。
4. 切换 Prof. Marcus Lim，在 Assignments 中向该班级布置已发布病例。
5. 切换班级中的学生，点击 **Begin Socratic session**，提交回答并观察回答立即出现、tutor 随后追问。
6. 完成或提前结束会话并查看总结。
7. 切换 Marcus，在 Review queue 中打开会话，保存草稿完成认领。
8. 切换 Prof. Sarah Ng，验证相同复核为只读。
9. 切回 Marcus，点击 **Complete review**。
10. 回到 Admin → Activity，确认完成状态、分数和 reviewer。

## 6. 状态与分数

| 状态 | 含义 |
| --- | --- |
| open | 学生可以开始任务 |
| closed | 不允许新会话；已有会话可继续 |
| active | 学生会话进行中 |
| completed | 学生会话或教授复核已完成 |
| pending | 尚未完成教授复核 |
| in review | 已有教授认领并保存草稿 |

AI 分类分值：`correct=100`、`partial=70`、`vague=40`、`wrong=0`，取平均并四舍五入。该分数用于形成性反馈，不等同于临床能力认证。Professor 的最终评分单独保存。

## 7. 常见问题

### 看不到任务

确认当前选择的是学生身份、学生仍是该班级成员、任务已开放且未过期/关闭。已有会话应显示 Continue session。

### Send answer 不可点击

输入不能为空或过短。等待上一条回答完成后再提交。

### AI 回复较慢

回答先立即显示，AI 评价可能需要数秒。若 provider 不可用，系统会自动使用确定性 tutor 继续，不会保存半成品 AI 输出。

### 教授不能编辑复核

会话可能仍在进行、已被另一名教授认领，或已经完成。查看页面顶部的 Ready to claim、Claimed by、Completed 和 Read only 提示。

### 保存班级成员失败

至少选择一名教授，并确保 Lead 是已勾选的教授。

### 病例不能编辑

已发布版本不可变。使用 **New version** 创建可编辑的下一版草稿。

### 页面提示 403 Forbidden

当前身份没有该页面或资源的权限。使用右上角 Demo identity 切换到正确的预置用户。

---

# English Version

## 1. Getting started

Open the application and use the identity button in the top-right corner. Select a specific seeded user from **Demo identity**. The server derives that user's role; the browser cannot declare its own permissions. Available names, classes, and assignments depend on the current deployment data. Inactive users are unavailable.

## 2. Student guide

The home page shows only assignments available through the student's class memberships.

- **Begin Socratic session** starts a new assignment session.
- **Continue session** resumes the single existing session for that assignment.
- **Resume paused session** restores an explicitly paused session with the same phase, transcript, and learner state.
- A closed/expired assignment may remain visible when a session already exists; that session can continue, but a new one cannot start.

In the conversation page, read the case and phase goal, enter reasoning in **Your clinical reasoning**, then click **Send answer** or press Enter. The student bubble appears immediately; a waiting state is shown until the tutor returns one follow-up question. Shift+Enter inserts a line break.

**Case attachments** contains synthetic teaching visuals and a narrated case history. The microphone button uses browser-native dictation. **Read aloud** speaks one tutor message, while **Auto-read** speaks new tutor replies automatically. Browser support varies, and real patient identifiers must never be dictated or entered.

Select **Pause & return to cases** to preserve the current phase, transcript, and learner state. The home card changes to **Resume paused session**. New answers are rejected until the session has been resumed.

There are five reasoning phases. A correct response advances the phase. Other responses receive another Socratic question. After the third unsuccessful attempt in a phase, the unresolved gap is recorded and the flow advances to avoid a loop. Completing phase five generates a summary automatically.

Use **End session & view summary** to finish early. The summary includes a reasoning score, strengths, reasoning gaps, next steps, and an incomplete indicator when not all phases were finished. **Choose another case** returns home. In the demo, **Open professor review** selects an available professor and opens the same submission.

## 3. Professor guide

### My classes

Shows only the professor's teaching groups, membership counts, and activity counts. **Manage assignments** opens the assignment view for that class.

### Assignments

Select **New assignment**, choose one of your classes and a published case, set an opening time and optional later deadline, then select **Publish**. Use **Close** and **Reopen** to control new starts. Existing student sessions remain resumable after closing.

### Review queue

Filter by All, Ready to claim, My draft, Claimed by colleague, or Completed. In-progress student sessions are view-only and cannot be reviewed.

On a completed submission, inspect the full transcript, AI classification/confidence, reasoning gap, strategy, and learner model. Choose a label for each answer, add optional comments and overall feedback, then:

- **Save draft** atomically claims the review the first time.
- **Complete review** locks the final faculty review.

A colleague may read a claimed review but cannot overwrite it. The faculty score remains independent of the AI score.

## 4. Admin guide

### Overview

Shows user, class, open-assignment, session, and pending-review statistics.

### Users

Filter by role and use **Edit** to change name, email, or **Account active**. An inactive seeded user cannot switch identity or use protected APIs. This POC does not create real credentials.

### Classes

Use **Create class** for the class name, code, term, and status. In **Manage class**, select multiple students/professors, choose one selected professor as **Lead**, and select **Save members**. Membership controls student offerings and professor visibility.

### Cases

Use **New case draft**. A publishable case needs metadata, learning objectives, and exactly five complete phases. Each phase needs a title, learning goal, rubric criteria, starter question, and follow-up question bank.

Drafts can be edited. **Publish** locks a version. Use **New version** to clone an editable next version. Archive versions that should no longer be assigned.

### Activity

Filter sessions by class and inspect student status, case, AI score, review status, and ownership. Assign an unfinished review to a class professor, or select **Release claim**. Completed reviews are locked.

## 5. Recommended three-role demo

1. As Dr. Elaine Koh, inspect Users, Classes, and Cases.
2. Manage a class with a student, two professors, and one lead.
3. Create, save, publish, and clone a complete five-phase case.
4. As Prof. Marcus Lim, assign the published case to that class.
5. As an enrolled student, begin the assignment and submit reasoning; observe the immediate student bubble and later tutor reply.
6. Complete or end early and inspect the summary.
7. As Marcus, save a review draft to claim it.
8. As Prof. Sarah Ng, verify that the same review is read-only.
9. As Marcus, complete the review.
10. As Admin, verify the score, reviewer, and completed status in Activity.

## 6. Status and scoring reference

- `open`: a student may start the assignment.
- `closed`: new sessions are blocked; an existing session may continue.
- `active`: the learner session is in progress.
- `completed`: the learner session or faculty review is final.
- `pending`: faculty review has not been completed.
- `in review`: a professor has claimed and saved a draft.

AI scores map `correct=100`, `partial=70`, `vague=40`, and `wrong=0`, then average and round the results. This is formative feedback, not clinical certification. Faculty scoring is stored separately.

## 7. Troubleshooting

- No assignment: check the selected student, class membership, opening/deadline, and manual close state.
- Send disabled: enter a sufficiently long response and wait for any pending answer to finish.
- Slow AI: the answer should appear immediately; provider evaluation can take several seconds. A failed provider request falls back to the deterministic tutor.
- Review is read-only: the session is in progress, claimed by a colleague, or completed. Read the claim banner.
- Member save fails: select at least one professor and choose the lead from the selected professors.
- Case cannot be edited: published versions are immutable; choose **New version**.
- 403 Forbidden: the current identity lacks the required role or resource membership; select the appropriate seeded user.
