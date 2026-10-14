# HR Recruitment Revamp — Implementation Plan

**Spec:** `2026-10-02-hr-recruitment-revamp-design.md`  
**Date:** 2026-10-02

---

## Phase 1 — Foundation: DB Migrations + Round Builder

### Step 1.1 — DB Migration: New Tables & Fields

Create `migrations/0070_recruitment_revamp.sql`:

```sql
-- Pipeline rounds per job post
CREATE TABLE recruitment_pipeline_rounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requisition_id   uuid NOT NULL REFERENCES job_requisitions(id) ON DELETE CASCADE,
  name             text NOT NULL,
  mode             text NOT NULL DEFAULT 'online' CHECK (mode IN ('online','offline','phone')),
  order_index      integer NOT NULL DEFAULT 0,
  interviewer_note text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON recruitment_pipeline_rounds (organization_id, requisition_id);

-- Candidate progress per round
CREATE TABLE recruitment_candidate_rounds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id       uuid NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
  pipeline_round_id  uuid NOT NULL REFERENCES recruitment_pipeline_rounds(id) ON DELETE CASCADE,
  assigned_to        uuid REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at       timestamptz,
  mode               text CHECK (mode IN ('online','offline','phone')),
  meeting_link       text,
  location           text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','scheduled','completed','passed','failed','skipped')),
  interviewer_notes  text,
  rating             integer CHECK (rating BETWEEN 1 AND 5),
  recommendation     text CHECK (recommendation IN ('pass','fail','hold')),
  passed_at          timestamptz,
  failed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON recruitment_candidate_rounds (organization_id, candidate_id);
CREATE INDEX ON recruitment_candidate_rounds (assigned_to);

-- Candidate activity timeline
CREATE TABLE recruitment_candidate_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_id     uuid NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  actor_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata         jsonb,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON recruitment_candidate_events (organization_id, candidate_id, occurred_at DESC);

-- Joining email templates
CREATE TABLE recruitment_email_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  is_default       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON recruitment_email_templates (organization_id);

-- Acknowledgement fields on existing joining table
ALTER TABLE recruitment_candidate_joinings
  ADD COLUMN joining_email_sent_at      timestamptz,
  ADD COLUMN joining_email_template_id  uuid REFERENCES recruitment_email_templates(id) ON DELETE SET NULL,
  ADD COLUMN acknowledge_token          text UNIQUE,
  ADD COLUMN acknowledged_at            timestamptz,
  ADD COLUMN acknowledge_ip             text;
```

---

### Step 1.2 — Server: Types

**File:** `packages/server/src/modules/recruitment/types.ts`

Add interfaces:
- `PipelineRound` — maps `recruitment_pipeline_rounds`
- `CandidateRound` — maps `recruitment_candidate_rounds`
- `CandidateEvent` — maps `recruitment_candidate_events`
- `EmailTemplate` — maps `recruitment_email_templates`

Add enums/literals:
- `PipelineRoundMode = 'online' | 'offline' | 'phone'`
- `CandidateRoundStatus = 'pending' | 'scheduled' | 'completed' | 'passed' | 'failed' | 'skipped'`
- `RoundRecommendation = 'pass' | 'fail' | 'hold'`
- `CandidateEventType` union of all event strings

---

### Step 1.3 — Server: Validators

**File:** `packages/server/src/modules/recruitment/validators.ts`

Add schemas:
- `createPipelineRoundSchema` — name, mode, orderIndex, interviewerNote?
- `updatePipelineRoundSchema` — all optional
- `reorderPipelineRoundsSchema` — array of { id, orderIndex }
- `createEmailTemplateSchema` — name, subject, body, isDefault?
- `updateEmailTemplateSchema` — all optional

---

### Step 1.4 — Server: Pipeline Rounds Repository + Service

**New files:**
- `packages/server/src/modules/recruitment/pipeline-rounds/repository.ts`
  - `listPipelineRounds(ctx, requisitionId)`
  - `createPipelineRound(ctx, input)`
  - `updatePipelineRound(ctx, id, input)`
  - `deletePipelineRound(ctx, id)`
  - `reorderPipelineRounds(ctx, requisitionId, order: { id, orderIndex }[])`
  - `findPipelineRoundById(ctx, id)`

- `packages/server/src/modules/recruitment/pipeline-rounds/service.ts`
  - Thin wrappers with NotFoundError guards

---

### Step 1.5 — Server: Pipeline Round Routes

**File:** `packages/server/src/modules/recruitment/routes.ts`

Add:
```
GET    /api/recruitment/pipeline-rounds?requisitionId=   recruitment:manage-requisitions
POST   /api/recruitment/pipeline-rounds                  recruitment:manage-requisitions
PATCH  /api/recruitment/pipeline-rounds/:id              recruitment:manage-requisitions
DELETE /api/recruitment/pipeline-rounds/:id              recruitment:manage-requisitions
POST   /api/recruitment/pipeline-rounds/reorder          recruitment:manage-requisitions
```

---

### Step 1.6 — Client: Types

**File:** `packages/client/src/company/recruitment/types/index.ts`

Add:
- `PipelineRound` interface
- `PipelineRoundMode` type
- `CreatePipelineRoundInput` interface
- `CandidateRound` interface
- `CandidateRoundStatus` type
- `CandidateEvent` interface
- `EmailTemplate` interface

---

### Step 1.7 — Client: API Functions

**File:** `packages/client/src/company/recruitment/api/recruitmentApi.ts`

Add:
- `listPipelineRounds(requisitionId)`
- `createPipelineRound(input)`
- `updatePipelineRound(id, input)`
- `deletePipelineRound(id)`
- `reorderPipelineRounds(requisitionId, order)`

---

### Step 1.8 — Client: Round Builder Component

**New file:** `packages/client/src/company/recruitment/components/PipelineRoundBuilder.tsx`

Props: `rounds: PipelineRound[]`, `onChange: (rounds) => void`, `disabled?: boolean`

Features:
- Ordered list of round rows
- Each row: drag handle, numbered colour badge, name input, mode select (Online/Offline/Phone), delete button
- "+ Add Round" appends a blank row
- Drag-to-reorder (use HTML5 drag events or a simple up/down arrow approach — no external DnD library)
- Used inside `RequisitionFormModal.tsx` as a new section

**Update:** `packages/client/src/company/recruitment/components/RequisitionFormModal.tsx`
- Add "Interview Rounds" section using `PipelineRoundBuilder`
- On save, call `reorderPipelineRounds` + create/update rounds after requisition is saved

---

## Phase 2 — Interview Pipeline

### Step 2.1 — Server: Candidate Rounds Repository + Service

**New files:**
- `packages/server/src/modules/recruitment/candidate-rounds/repository.ts`
  - `listCandidateRounds(ctx, candidateId)`
  - `createCandidateRound(ctx, input)`
  - `assignInterviewer(ctx, id, userId)`
  - `scheduleRound(ctx, id, input)` — scheduledAt, mode, meetingLink/location
  - `submitFeedback(ctx, id, input)` — notes, rating, recommendation → sets status=completed
  - `passRound(ctx, id)` — status=passed, passed_at=now(), fires candidate_event
  - `failRound(ctx, id, reason?)` — status=failed, failed_at=now(), fires candidate_event
  - `getCurrentRound(ctx, candidateId)` — returns the lowest-order pending/scheduled round

- `packages/server/src/modules/recruitment/candidate-rounds/service.ts`
  - Business logic: validate candidate is in 'interview' status, validate round belongs to candidate's requisition
  - On `passRound`: if more rounds exist → create next `candidate_round` record; if last round → update candidate status to `selected`
  - On `failRound`: update candidate status to `rejected`, send rejection notification

---

### Step 2.2 — Server: Candidate Events Repository

**New file:** `packages/server/src/modules/recruitment/candidate-events/repository.ts`
- `logEvent(ctx, candidateId, eventType, actorId?, metadata?)`
- `listCandidateEvents(ctx, candidateId)`

Call `logEvent` from key service functions: `createCandidate`, `passRound`, `failRound`, `updateCandidateStatus`, `sendJoiningEmail`, `recordAcknowledgement`, `hireCandidateAsEmployee`.

---

### Step 2.3 — Server: Candidate Round Routes

**File:** `packages/server/src/modules/recruitment/routes.ts`

Add:
```
GET    /api/recruitment/candidate-rounds?candidateId=         recruitment:view-candidates
POST   /api/recruitment/candidate-rounds                      recruitment:manage-candidates
PATCH  /api/recruitment/candidate-rounds/:id/assign           recruitment:manage-interviews
PATCH  /api/recruitment/candidate-rounds/:id/schedule         recruitment:manage-interviews
PATCH  /api/recruitment/candidate-rounds/:id/feedback         -- interviewer submits (own assigned round)
POST   /api/recruitment/candidate-rounds/:id/pass             recruitment:manage-interviews
POST   /api/recruitment/candidate-rounds/:id/fail             recruitment:manage-interviews
GET    /api/recruitment/my-interviews                         -- interviewer's own assigned rounds
GET    /api/recruitment/candidate-events?candidateId=         recruitment:view-candidates
```

For `my-interviews` and feedback submission: a new `interviewer:submit-feedback` action scoped to the user's own assigned rounds.

---

### Step 2.4 — Server: Interviewer Notification

**File:** `packages/server/src/modules/recruitment/notifications.ts`

Add:
- `notifyInterviewerAssigned({ to, interviewerName, candidateName, roundName, scheduledAt, mode, meetingLink, location })`
- `notifyHrRoundFeedbackSubmitted({ hrUserId, candidateName, roundName, recommendation })` — CRM bell notification

---

### Step 2.5 — Client: Candidate Pipeline View (Hybrid)

**New file:** `packages/client/src/company/recruitment/pages/CandidatePipelinePage.tsx`

Replaces the current `CandidatesPage.tsx` as the default view (or sits alongside it).

Structure:
- `PipelineFunnelBar` — row of pills showing count per round, colour-coded
- `CandidateGroupedList` — candidates grouped by their current round name, each row shows name, email, interviewer, scheduled date, status badge
- `CandidateDetailPanel` — slide-in right panel (width: ~380px) showing:
  - Candidate header (name, email, job post)
  - `RoundHistoryList` — all rounds with pass/fail icons + interviewer notes
  - Current round block + action buttons: Assign Interviewer | Schedule | Pass | Reject
  - `CandidateActivityTimeline` (see Step 2.6)
- Toggle buttons in top-right: Hybrid (default) | List | Kanban

**Update:** `packages/client/src/company/recruitment/pages/RecruitmentWorkspace.tsx`
- Replace `CandidatesPage` default with `CandidatePipelinePage`

---

### Step 2.6 — Client: Activity Timeline Component

**New file:** `packages/client/src/company/recruitment/components/CandidateActivityTimeline.tsx`

Props: `candidateId: string`

- Fetches `GET /api/recruitment/candidate-events?candidateId=`
- Renders reverse-chronological list of events with colour-coded dot, event label, timestamp, actor name
- Used inside the slide-in detail panel

---

### Step 2.7 — Client: Interviewer Dashboard

**New file:** `packages/client/src/company/recruitment/pages/InterviewerDashboardPage.tsx`

Route: `/company/recruitment/my-interviews`

Features:
- Header: "My Interview Queue" + counts (pending / completed this week)
- Cards per assigned round — expandable
- Expanded card: candidate details, previous round notes, pass/fail/hold toggle, star rating, feedback textarea, submit button
- Completed section below with collapsed cards

**Update:** `packages/client/src/company/CompanyWorkspace.tsx`
- Add route `/company/recruitment/my-interviews` → `InterviewerDashboardPage`
- Show "My Interviews" nav link for all employees (not just HR) — hide if no assignments

**Update:** `packages/client/src/company/recruitment/api/recruitmentApi.ts`
- Add `listMyInterviews()` — calls `GET /api/recruitment/my-interviews`
- Add `submitRoundFeedback(roundId, input)` — calls `PATCH /api/recruitment/candidate-rounds/:id/feedback`
- Add `listCandidateEvents(candidateId)` — calls `GET /api/recruitment/candidate-events`

---

## Phase 3 — Joining Email + Acknowledge

### Step 3.1 — Server: Email Template Repository + Service + Routes

**New files:**
- `packages/server/src/modules/recruitment/email-templates/repository.ts`
  - `listEmailTemplates(ctx)`
  - `createEmailTemplate(ctx, input)`
  - `updateEmailTemplate(ctx, id, input)`
  - `findDefaultTemplate(ctx)`

- `packages/server/src/modules/recruitment/email-templates/service.ts`
  - `renderTemplate(template, vars)` — replaces `{{variable}}` with actual values

**Routes added to** `routes.ts`:
```
GET    /api/recruitment/email-templates                  recruitment:manage-joining
POST   /api/recruitment/email-templates                  recruitment:manage-joining
PATCH  /api/recruitment/email-templates/:id              recruitment:manage-joining
POST   /api/recruitment/joining/:id/send-email           recruitment:manage-joining
```

---

### Step 3.2 — Server: Send Joining Email + Acknowledge Endpoint

**File:** `packages/server/src/modules/recruitment/joining/service.ts`

Add `sendJoiningEmail(ctx, joiningId, input: { templateId?, subjectOverride?, bodyOverride? })`:
- Loads joining + candidate + offer data
- Renders template with variables
- Generates `acknowledge_token = crypto.randomBytes(32).toString('hex')`
- Sends email with rendered body (acknowledge button URL = `/api/public/recruitment/acknowledge/:token`)
- Updates `joining_email_sent_at`, `acknowledge_token`, `joining_email_template_id`
- Logs `joining_email_sent` event

**File:** `packages/server/src/modules/recruitment/public-routes.ts`

Add:
```
GET /acknowledge/:token
```
Handler:
- Finds joining by `acknowledge_token`
- If already acknowledged → returns "Already acknowledged" page
- Sets `acknowledged_at = now()`, `acknowledge_ip`
- Logs `acknowledged` candidate event
- Sends CRM bell notification to HR
- Returns a simple branded "Thank you, your joining is confirmed" HTML page

---

### Step 3.3 — Client: Email Template Editor

**New file:** `packages/client/src/company/recruitment/components/JoiningEmailModal.tsx`

Props: `joining: CandidateJoining`, `candidate: Candidate`, `onClose`, `onSent`

Features:
- Left pane: subject field + body textarea with `{{variable}}` highlights (CSS span wrapping)
- Available variables panel (click to insert at cursor)
- Right pane: live preview (renders substituted HTML)
- "Load saved template" button
- "Send to [Candidate Name]" button → calls `POST /api/recruitment/joining/:id/send-email`

**Update:** `packages/client/src/company/recruitment/api/recruitmentApi.ts`
- Add `listEmailTemplates()`
- Add `createEmailTemplate(input)`
- Add `sendJoiningEmail(joiningId, input)`

---

### Step 3.4 — Client: Acknowledgement Badge + Notification

**Update:** `packages/client/src/company/recruitment/pages/JoiningPage.tsx`
- Add "Acknowledgement" column to the joining table
- Show `✓ Acknowledged [date]` badge or `⏳ Awaiting` + "Resend" link
- "Resend" calls `POST /api/recruitment/joining/:id/send-email` again

**CRM bell notification** is handled by the existing notifications system — the public acknowledge endpoint fires it server-side via the existing `notifyUser` utility.

---

## Phase 4 — Polish + Import

### Step 4.1 — Kanban View Toggle

**New file:** `packages/client/src/company/recruitment/components/CandidateKanbanView.tsx`

- Columns per round
- Candidate cards (name, status badge, interviewer)
- Driven by same data as `CandidatePipelinePage` — just a different render

**Update:** `CandidatePipelinePage.tsx`
- Add view toggle state: `'hybrid' | 'list' | 'kanban'`
- Render appropriate view component based on state
- Persist preference in `localStorage`

---

### Step 4.2 — Pre-filled Employee Import

**Update:** `packages/client/src/company/recruitment/components/HiringDialog.tsx`

Current: HR fills fields manually.

New behaviour:
- Pre-fill `actualJoiningDate` from `joining.expectedJoiningDate`
- Pre-fill `specialization` from `candidate.requisitionTitle`
- Department + position + designation come from offer/requisition — already passed to `hireCandidateAsEmployee` server-side
- Show a read-only summary block of what will be pre-filled so HR can verify
- Fix the existing `res.employee.id` bug (currently reads `res.employeeId` which is undefined)

---

### Step 4.3 — Platform Redirect Icons on Job Post

**Update:** `packages/client/src/company/recruitment/components/RequisitionFormModal.tsx` (or a new `JobPostShareSection.tsx`)

Add a "Share & Post" section visible after the job post is created/saved:
- Copy-able form link (copy icon + toast on click)
- Platform icon buttons: LinkedIn, Naukri, Indeed, Internshala
- Each is an `<a href="[platform URL]" target="_blank" rel="noopener noreferrer">`
- Use SVG icons for each platform (stored in `packages/client/src/ui/icons/`)

---

### Step 4.4 — Resume Auto-fill on Convert

**Update:** `packages/client/src/company/recruitment/pages/ResumeInboxPage.tsx`

When HR clicks "Convert to Candidate":
- Open `CandidateFormModal` with `prefill` prop from `submission.parsedData`
- `CandidateFormModal` reads `prefill` to set initial state for firstName, lastName, email, phone, screeningNotes (from skills)

**Update:** `packages/client/src/company/recruitment/components/CandidateFormModal.tsx`
- Add optional `prefill?: Partial<CreateCandidateInput>` prop
- Use prefill values as initial state

---

### Step 4.5 — Fix Existing Bugs (from earlier analysis)

While touching the relevant files:

1. **`HiringDialog.tsx:63`** — `res.employeeId` → `res.employee.id`  
   **File:** `packages/client/src/company/recruitment/api/recruitmentApi.ts` — fix `hireCandidate` return type  
   **File:** `packages/client/src/company/recruitment/components/HiringDialog.tsx` — fix usage

2. **`InterviewRescheduleModal.tsx:48`** — `res.interview` → `res` (server returns Interview directly)  
   **File:** `packages/client/src/company/recruitment/api/recruitmentApi.ts` — fix `rescheduleInterview` return type  
   **File:** `packages/client/src/company/recruitment/components/InterviewRescheduleModal.tsx` — fix usage

3. **`PublicApplicationPage.tsx:249`** — `requisition.openingsCount` undefined  
   **File:** `packages/server/src/modules/recruitment/service.ts` — add `openingsCount` to `resolvePublicApplicationLink` return

---

## File Change Summary

### New Files
```
migrations/0070_recruitment_revamp.sql
packages/server/src/modules/recruitment/pipeline-rounds/repository.ts
packages/server/src/modules/recruitment/pipeline-rounds/service.ts
packages/server/src/modules/recruitment/candidate-rounds/repository.ts
packages/server/src/modules/recruitment/candidate-rounds/service.ts
packages/server/src/modules/recruitment/candidate-events/repository.ts
packages/server/src/modules/recruitment/email-templates/repository.ts
packages/server/src/modules/recruitment/email-templates/service.ts
packages/client/src/company/recruitment/components/PipelineRoundBuilder.tsx
packages/client/src/company/recruitment/components/CandidateActivityTimeline.tsx
packages/client/src/company/recruitment/components/JoiningEmailModal.tsx
packages/client/src/company/recruitment/components/CandidateKanbanView.tsx
packages/client/src/company/recruitment/pages/CandidatePipelinePage.tsx
packages/client/src/company/recruitment/pages/InterviewerDashboardPage.tsx
```

### Modified Files
```
packages/server/src/modules/recruitment/types.ts
packages/server/src/modules/recruitment/validators.ts
packages/server/src/modules/recruitment/routes.ts
packages/server/src/modules/recruitment/public-routes.ts
packages/server/src/modules/recruitment/notifications.ts
packages/server/src/modules/recruitment/service.ts             (openingsCount fix + sendJoiningEmail)
packages/server/src/modules/recruitment/joining/service.ts
packages/client/src/company/recruitment/types/index.ts
packages/client/src/company/recruitment/api/recruitmentApi.ts  (new calls + bug fixes)
packages/client/src/company/recruitment/components/RequisitionFormModal.tsx
packages/client/src/company/recruitment/components/CandidateFormModal.tsx
packages/client/src/company/recruitment/components/HiringDialog.tsx
packages/client/src/company/recruitment/components/InterviewRescheduleModal.tsx
packages/client/src/company/recruitment/pages/RecruitmentWorkspace.tsx
packages/client/src/company/recruitment/pages/JoiningPage.tsx
packages/client/src/company/recruitment/pages/ResumeInboxPage.tsx
packages/client/src/company/CompanyWorkspace.tsx
```

---

## Build Order

1. Migration → server types → validators
2. Pipeline rounds (server repo + service + routes)
3. Round builder UI + RequisitionFormModal update
4. Candidate rounds (server repo + service + routes)
5. Candidate events (server repo + logging hooks)
6. Candidate pipeline view (client hybrid page)
7. Interviewer dashboard (client + CompanyWorkspace route)
8. Email templates (server repo + service + routes)
9. Send joining email + public acknowledge endpoint
10. Joining email modal (client)
11. Acknowledgement badge on JoiningPage
12. Kanban view toggle
13. Pre-filled employee import + bug fixes
14. Platform icons + resume auto-fill
