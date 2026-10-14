# HR Recruitment Module Revamp — Design Spec

**Date:** 2026-10-02  
**Author:** Archisman Dutta  
**Status:** Approved for implementation

---

## 1. Overview

A full revamp of the existing recruitment module. The goal is to replace the current flat candidate/interview/offer/joining flow with a structured, round-based pipeline that covers the full lifecycle — from job post creation through to employee import.

The existing module's core data (candidates, offers, joining) is preserved and extended. The revamp adds custom interview pipelines per job post, an interviewer-facing panel, a template-based joining email with acknowledgement tracking, and a pre-filled employee import.

---

## 2. Design Decisions Summary

| Area | Decision |
|------|----------|
| Pipeline view | Hybrid — funnel stats + candidates grouped by round + slide-in detail panel |
| Round builder | Simple ordered list — name, mode, drag to reorder |
| Interviewer experience | Separate dedicated dashboard (not embedded in HR pages) |
| Joining email | Template editor with `{{variables}}` + live preview |
| Acknowledge flow | Badge + CRM bell notification + candidate activity timeline |

---

## 3. Full Flow

```
Job Post Creation
    ↓
Copy form link + platform redirect icons (LinkedIn, Naukri, Indeed, Internshala)
    ↓
Resume Intake (public form link OR HR manual upload → Resume Inbox)
    ↓
Initial Screening → Convert to Candidate (resume auto-fills form)
    ↓
Custom Interview Pipeline (rounds defined per job post)
    ↓
Per round: Schedule → Assign Interviewer → Interviewer submits feedback → HR passes/fails
    ↓
Accepted → HR sends customised joining email (template + variables)
    ↓
Candidate clicks "Acknowledge Now" → CRM records acknowledgement
    ↓
Candidate joins → HR imports to Employee form (pre-filled)
```

---

## 4. Data Model Changes

### 4.1 Job Post (extends existing Requisition)

New fields on `job_requisitions`:
```
platform_links   jsonb   -- { linkedin, naukri, indeed, internshala } redirect URLs
```

No structural schema change needed — existing requisition table is sufficient. Platform links are static redirect URLs stored as config, not per-record data.

### 4.2 Interview Pipeline Rounds

New table: `recruitment_pipeline_rounds`
```
id                  uuid PK
organization_id     uuid FK
requisition_id      uuid FK → job_requisitions
name                text          -- e.g. "Technical Round"
mode                enum          -- online | offline | phone
order_index         integer       -- defines sequence
default_interviewer_note  text    -- optional prompt shown to assigned interviewer
created_at          timestamptz
updated_at          timestamptz
```

### 4.3 Candidate Round Progress

New table: `recruitment_candidate_rounds`
```
id                  uuid PK
organization_id     uuid FK
candidate_id        uuid FK → recruitment_candidates
pipeline_round_id   uuid FK → recruitment_pipeline_rounds
assigned_to         uuid FK → users (the interviewer)
scheduled_at        timestamptz nullable
mode                enum          -- online | offline | phone (can override round default)
meeting_link        text nullable -- for online
location            text nullable -- for offline
status              enum          -- pending | scheduled | completed | passed | failed | skipped
interviewer_notes   text nullable -- submitted by interviewer post-interview
rating              integer nullable -- 1–5
recommendation      enum nullable -- pass | fail | hold
passed_at           timestamptz nullable
failed_at           timestamptz nullable
created_at          timestamptz
updated_at          timestamptz
```

### 4.4 Joining Email Template

New table: `recruitment_email_templates`
```
id                  uuid PK
organization_id     uuid FK
name                text          -- e.g. "Standard Joining Email"
subject             text          -- supports {{variables}}
body                text          -- rich text with {{variables}}
is_default          boolean
created_at          timestamptz
updated_at          timestamptz
```

Supported variables: `{{candidate_name}}`, `{{role}}`, `{{department}}`, `{{joining_date}}`, `{{reporting_manager}}`, `{{company_name}}`

### 4.5 Joining Acknowledgement

New fields on `recruitment_candidate_joinings`:
```
joining_email_sent_at      timestamptz nullable
joining_email_template_id  uuid FK nullable
acknowledge_token          text unique nullable  -- random hex token
acknowledged_at            timestamptz nullable
acknowledge_ip             text nullable
```

### 4.6 Candidate Activity Timeline

New table: `recruitment_candidate_events`
```
id                  uuid PK
organization_id     uuid FK
candidate_id        uuid FK
event_type          enum  -- applied | screening_passed | round_passed | round_failed |
                          -- selected | offer_sent | offer_accepted | joining_email_sent |
                          -- acknowledged | employee_imported
actor_id            uuid nullable FK → users
metadata            jsonb nullable  -- e.g. { round_name, interviewer_name, note }
occurred_at         timestamptz
```

---

## 5. Feature Specs

### 5.1 Job Post — Platform Redirect Icons

Inside the job post / requisition detail page, after creating a post, HR sees:

- A "Share & Post" section with the copy-able form link
- Icon buttons for: LinkedIn, Naukri, Indeed, Internshala (and optionally Shine, Monster)
- Each icon is an `<a href="..." target="_blank">` redirect to that platform's job posting page
- URLs are static (e.g. `https://www.linkedin.com/jobs/post/`) — no API calls
- A "Copy Link" button copies the TapCRM public application form URL to clipboard

### 5.2 Resume Intake — Auto-fill on Convert

When HR clicks "Move to Interview" on a resume submission:
- The candidate creation form opens pre-filled from `parsedData` on the submission record
- Fields pre-filled: first name, last name, email, phone, skills (as screening notes)
- HR can edit any field before confirming
- On confirm, candidate record is created and linked to the submission

This re-uses the existing `parseCandidateResume` API — the parsed data is already stored on submissions.

### 5.3 Interview Pipeline — Round Builder

Inside the job post creation/edit form, a "Interview Rounds" section:
- Ordered list of rounds
- Each row: drag handle | numbered badge | round name (editable) | mode selector (Online / Offline / Phone) | delete button
- "+ Add Round" button appends a blank row
- Drag-to-reorder updates `order_index`
- Rounds are saved with the job post — they apply to all candidates for that post
- Default rounds if none defined: HR Screening → Technical → Final HR

### 5.4 Candidate Pipeline View (HR)

Default view when HR opens the Recruitment module:

**Top bar — Funnel stats:**
- One pill per round showing count of candidates currently in that round
- Colour-coded per round

**Main area — Candidates grouped by current round:**
- Each round group shows its candidates as rows
- Each row: candidate name, email, assigned interviewer, scheduled date, status badge
- "Action needed" badge if a round has no interviewer assigned
- Clicking any candidate opens the slide-in detail panel

**Slide-in detail panel (right side):**
- Candidate name, email, job post
- Round history (all rounds with pass/fail icons and interviewer notes)
- Current round info + interviewer
- Action buttons: Pass to Next Round | Reject | Schedule Interview | Assign Interviewer
- Activity timeline (see 5.6)

**Toggle buttons** in top-right: switch between Hybrid (default) | Kanban | List views

### 5.5 Interviewer Dashboard

Separate section accessible from the main nav (visible only to users who have at least one interview assigned).

**My Interview Queue page:**
- Header: "X pending · Y completed this week"
- List of assigned interviews as expandable cards
- Each card (expanded): candidate name, job post, round name, date/time, mode, meeting link or location
- Previous round outcomes and notes from prior interviewers
- Feedback form inline: Pass / Fail / Hold toggle, star rating (1–5), feedback textarea, strengths, areas to improve
- "Submit Feedback" button — submits `recruitment_candidate_rounds` update
- Once submitted, card collapses and moves to "Completed" section

Notification: when HR assigns an interview, the interviewer receives a CRM bell notification and email.

### 5.6 Activity Timeline

Displayed inside the candidate slide-in panel (HR view) and inside the interviewer's candidate view.

Shows all `recruitment_candidate_events` for the candidate in reverse chronological order:
- Colour-coded dot per event type
- Event label + timestamp + actor name
- Key events: Applied, Screening Passed, Round X Passed/Failed, Offer Sent, Acknowledged, Employee Imported

### 5.7 Joining Email — Template Editor

Accessed from the candidate detail panel once candidate is accepted and offer accepted.

**Template editor:**
- Subject field with variable support
- Body: rich text editor (or styled textarea) with `{{variable}}` placeholders highlighted in colour
- Available variables panel (click to insert)
- Live preview panel on the right — renders the email with actual candidate data substituted in
- "Acknowledge Now" button is always included automatically — HR cannot remove it
- Org can save a default template — "Use saved template" button loads it
- "Send to [Candidate Name]" button — sends email, records `joining_email_sent_at`, generates and stores `acknowledge_token`

### 5.8 Acknowledgement Flow

**Public endpoint:** `GET /api/public/recruitment/acknowledge/:token`
- Validates token exists and not already acknowledged
- Sets `acknowledged_at = now()`, stores `acknowledge_ip`
- Returns a simple "Thank you, your joining is confirmed" page
- Fires `recruitment_candidate_events` entry: `acknowledged`
- Sends CRM bell notification to HR who sent the email

**HR view:**
- Joining record shows acknowledgement badge: "✓ Acknowledged [date]" or "⏳ Awaiting" + "Resend" link
- Bell notification: "Rohan Mehta acknowledged their joining offer"
- Activity timeline entry visible in candidate panel

### 5.9 Employee Import (Pre-filled)

From the candidate detail panel, once `acknowledged_at` is set and joining date has passed (or HR manually triggers):

- "Import to Employee" button opens the existing Employee addition form
- Form is pre-filled with: full name, email, department (from requisition), position (from offer), designation (from offer), joining date (from joining record), reporting manager (from offer/assignment)
- HR reviews, adjusts if needed, and confirms
- On confirm: `provisionEmployee` runs, `recruitment_candidate_events` logs `employee_imported`, joining record gets `employee_id` linked

---

## 6. What Stays the Same

- Resume Inbox (submissions, convert to candidate) — UI refresh only, no logic change
- Offer creation and status flow — unchanged
- Joining status flow (pending → confirmed → joined) — still exists, acknowledgement is additive
- Existing API endpoints — all preserved, new ones added alongside
- Authorization model — same `recruitment:*` action scopes, new `interviewer:*` scope for interviewer dashboard

---

## 7. New API Endpoints

```
GET    /api/recruitment/pipeline-rounds?requisitionId=
POST   /api/recruitment/pipeline-rounds
PATCH  /api/recruitment/pipeline-rounds/:id
DELETE /api/recruitment/pipeline-rounds/:id

GET    /api/recruitment/candidate-rounds?candidateId=
POST   /api/recruitment/candidate-rounds
PATCH  /api/recruitment/candidate-rounds/:id/feedback   -- interviewer submits
PATCH  /api/recruitment/candidate-rounds/:id/decision   -- HR passes/fails

GET    /api/recruitment/my-interviews                   -- interviewer's assigned rounds
GET    /api/recruitment/candidate-events?candidateId=

GET    /api/recruitment/email-templates
POST   /api/recruitment/email-templates
PATCH  /api/recruitment/email-templates/:id
POST   /api/recruitment/joining/:id/send-email          -- sends joining email
GET    /api/public/recruitment/acknowledge/:token       -- candidate clicks
```

---

## 8. Implementation Phases

### Phase 1 — Foundation (DB + Round Builder)
- DB migrations: pipeline_rounds, candidate_rounds, candidate_events, email_templates, joining fields
- Round builder UI in job post form
- Basic candidate pipeline view (list only, no slide-in panel yet)

### Phase 2 — Interview Pipeline
- Candidate round progress tracking
- Assign interviewer to a round
- Interviewer dashboard (separate section)
- Interviewer feedback submission
- HR pass/fail decision per round
- CRM notifications for assignments

### Phase 3 — Joining Email + Acknowledge
- Email template editor with variables + live preview
- Send joining email endpoint + acknowledge token
- Public acknowledge endpoint + thank-you page
- Acknowledgement badge, bell notification, timeline

### Phase 4 — Polish + Import
- Slide-in candidate detail panel with full timeline
- Hybrid pipeline view (funnel stats + grouped list)
- Kanban and List view toggles
- Pre-filled employee import form
- Platform redirect icons on job post
- Resume auto-fill on convert

---

## 9. Out of Scope

- Direct API posting to LinkedIn / Naukri / Indeed (icons redirect only)
- Email delivery infrastructure changes (uses existing mailer)
- Mobile app changes
- Bulk candidate actions
