# User Guide

This guide explains how to use Socratic Digital Twin AI Tutor as a Student, Professor, or Admin.

> This system is for teaching simulations only. It does not provide clinical diagnosis, and real patient-identifying information must not be entered.

## 1. Getting started

Open the application and use the identity button in the top-right corner. Select a specific seeded user from **Demo identity**. Every listed role is intentionally open for this synthetic-data POC; the selector is not real authentication and must never be used with real student or patient data. The server derives that user's role, and inactive or non-allow-listed database users are unavailable.

## 2. Student guide

The home page shows only assignments available through the student's class memberships.

- **Begin Socratic session** starts a new assignment session.
- **Continue session** resumes the single existing session for that assignment.
- **Resume paused session** restores an explicitly paused session with the same phase, transcript, and learner state.
- A closed/expired assignment may remain visible when a session already exists; that session can continue, but a new one cannot start.

In the conversation page, read the case and phase goal, enter reasoning in **Your clinical reasoning**, then click **Send answer** or press Enter. The student bubble appears immediately; a waiting state is shown until the tutor returns one follow-up question. Shift+Enter inserts a line break.

**Case attachments** contains synthetic teaching visuals and a narrated case history. The microphone button uses browser-native dictation. AI-generated Tutor voice replies are on by default and play whenever a new reply arrives. Use **Tutor voice** to toggle automatic playback, or **Read aloud** to replay one message. If OpenAI TTS is unavailable, the app falls back to the device's English voice; if the browser blocks autoplay, click **Read aloud** once to enable playback. Real patient identifiers must never be dictated or entered.

Select **Pause & return to cases** to preserve the current phase, transcript, and learner state. The home card changes to **Resume paused session**. New answers are rejected until the session has been resumed.

There are five reasoning phases. A correct response advances the phase. Other responses receive another Socratic question. After the third unsuccessful attempt in a phase, the unresolved gap is recorded and the flow advances to avoid a loop. Completing phase five generates a summary automatically.

Use **End session & view summary** to finish early. A reliable local summary and completed state are saved immediately. When Supabase is enabled, optional AI wording is generated in the background and the page refreshes it automatically; a provider failure leaves the local summary intact. The summary includes a reasoning score, strengths, reasoning gaps, next steps, and an incomplete indicator when not all phases were finished. **Choose another case** returns home.

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
