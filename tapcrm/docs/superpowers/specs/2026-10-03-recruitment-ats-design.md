# Recruitment ATS Screening — Design Spec

**Date:** 2026-10-03
**Status:** Implemented (uncommitted on `Archi`)

---

## 1. What it does

HR can run an **ATS scan** on any application in the Resume Inbox, whether it came through a public application link or an HR upload. The scan compares the resume with the job's screening criteria and returns a **score out of 100** with the evidence behind every point. HR then **accepts** the application (adds the person as a candidate) or **rejects** it.

The scan is decision support. It never changes an application's status, and a low score never rejects anyone.

## 2. Flow

```
Job (requisition) ──► Screening criteria (set once per job; suggested from the job post)
                              │
Resume Inbox ──► Run ATS scan ──► Report: score, missing must-haves, evidence per criterion
                              │
                              └──► HR decides: Accept & add as candidate  |  Reject
```

- **Per application:** "Review & scan" opens the review window. Its ATS panel runs the scan, shows the report and offers Accept/Reject. A decision started there carries a one-line ATS summary into the screening notes or the rejection reason. HR can edit that line.
- **Per job:** filtering the inbox by a job shows **Screening criteria** and **Scan N unscanned**. The second button scans every open application that has no current report.
- The inbox has an **ATS score** column and a **Highest ATS score first** sort.

## 3. Screening criteria (per job)

| Field | Meaning |
|---|---|
| Required skills | Must-haves. Missing ones are flagged on every report. `A or B` accepts either. |
| Preferred skills | Nice-to-haves. They add points but are never required. |
| Minimum experience | Years, measured from employment dates. |
| Required qualifications | Degrees or certifications, e.g. "B.Tech in Computer Science", "Any graduate", "PMP". |

- **Suggestions:** until HR saves criteria, the job post's description and requirements supply a suggested set. Skills come from a curated vocabulary. "Preferred", "nice to have" and "a plus" lines become preferred skills. "N+ years" sets the minimum, and the first degree named sets the qualification. Nothing is scanned until HR saves.
- **Fairness rule:** criteria that name personal or protected characteristics are refused, both in the editor and by the API. This covers age, sex/gender, caste, religion, marital status, disability and similar (`protectedCriterionTerm` in `@tapcrm/contracts`). The list is kept narrow so that look-alike skills still pass, for example "React Native", "race conditions" and "colour theory".

## 4. Scoring engine (`packages/server/src/modules/recruitment/ats/`)

The engine is deterministic and runs locally: no resume data leaves the server. The same resume, criteria and engine version always produce the same report.

**Text extraction** (`resume-text.ts`):
- **PDF:** pdf.js, with line breaks rebuilt from text positions.
- **DOCX:** real ZIP + WordprocessingML parsing, including headers and tables.
- **Legacy .doc:** Compound File and Word 97 piece table.
- **TXT:** read directly.

An unreadable file, such as a scanned image or a password-protected PDF, produces no text and a stated issue. It never returns raw bytes.

**Sections:** headings such as Experience, Education, Skills, Projects and Certifications tag every line.

| Category | Base weight | How it is judged |
|---|---|---|
| Required skills | 50 | Each skill is found (1), to confirm (½) or not found (0). Aliases count: k8s→Kubernetes, B.E.≈B.Tech. Symbol-aware boundaries mean "Java" is not found in "JavaScript", "C" is not found in "C++", and "js" is not found in "Node.js". |
| Experience | 20 | Employment date ranges are merged so overlaps are not double-counted. Internships and education/project dates are excluded. "Present" means today. Credit = years ÷ minimum, capped at 1. A stated "N years" without dates counts but is marked *to confirm*. |
| Qualifications | 15 | Degrees are read from the Education section only. A generic level ("Bachelor's") accepts any degree at or above it. A specific degree accepts itself or a higher one in the same discipline. If the field of study is not confirmed, or the degree is still in progress, the check is *to confirm*. |
| Preferred skills | 15 | Same as required skills. |

- **Weights:** the weights are spread over only the categories a job uses, and always total 100 (`atsCategoryWeights`).
- **Evidence:** every check quotes the resume line it relied on, preferring work experience over the skills list, and adds a note on how it matched.
- **Ambiguous short forms:** "Go", "C" and "BE" on their own are *to confirm*, never a full match.
- **Bands:** Strong ≥ 80, Good ≥ 60, Partial ≥ 40, Low. **Strong match** also requires every must-have to be present.
- **`needs_review`:** a report gets this status, with no score, when fewer than 250 characters or 40 words can be read.
- **What the scan never reads:** name, photo, age, gender, address or other personal details.

`ATS_ENGINE_VERSION` (`tapcrm-ats/1.0.0`) must be bumped whenever scoring behaviour changes. Older reports then show as stale.

## 5. Data and integrity

- `recruitment_ats_criteria` (0072) holds one row per job, plus a criteria hash. The hash ignores order and letter case.
- `recruitment_ats_scan` (0072, 0073) holds immutable reports. Each stores the criteria snapshot, the SHA-256 of the resume file and its text, the engine version, the full evaluation and who ran it. The app role may only `SELECT`/`INSERT`; 0073 revokes the `UPDATE`/`DELETE` that default privileges grant.
- Re-scanning the same resume with the same criteria and engine returns the existing report.
- A report is **stale** when the job's criteria or the engine version changed after it was made. Stale reports are kept for reference.
- A scan locks the application row. It cannot be recorded after the application is accepted or rejected, and it never changes the status.

## 6. API and authorization

| Method | Path | Action |
|---|---|---|
| GET | `/api/recruitment/requisitions/:id/ats-criteria` | `recruitment:view-requisitions` |
| PUT | `/api/recruitment/requisitions/:id/ats-criteria` | `recruitment:manage-requisitions` |
| GET | `/api/recruitment/resume-submissions/:id/ats` | `recruitment:manage-submissions` |
| POST | `/api/recruitment/resume-submissions/:id/ats-scans` | `recruitment:manage-submissions` |

No new actions were needed. The bindings are in AUTHORIZATION.md §6.5 and the generated registry. `GET /api/recruitment/resume-submissions` now returns each application's latest result as `ats`.

Eligibility failures are 422s with a named code:
- `ATS_CRITERIA_NOT_CONFIGURED`
- `ATS_CRITERIA_EMPTY`
- `ATS_APPLICATION_CLOSED`
- `ATS_RESUME_UNAVAILABLE`

## 7. Compliance notes (engineering view, not legal advice)

The design follows current guidance for automated screening:
- job-related criteria only;
- explainable evidence;
- a human makes the decision;
- immutable, versioned records;
- unreadable resumes routed to manual review rather than scored low.

The public application form tells candidates that resumes may be screened automatically and that people make all decisions. Where they apply:
- the EU AI Act treats recruitment AI as high-risk (Annex III obligations deferred to 2 Dec 2027 by the Digital Omnibus);
- NYC Local Law 144 requires bias audits and candidate notice;
- India's DPDP Rules apply notice, purpose-limitation and retention duties to applicant data from May 2027.

Retention and deletion of applicant data, and any bias audit, are organisational processes this feature does not yet automate.

## 8. Known limits

- No OCR: scanned resumes are flagged for manual review.
- The skill vocabulary (`taxonomy.ts`) is curated. Criteria outside it are still matched as phrases, and all of their words appearing on one line counts as *to confirm*.
- Experience relies on readable date ranges. Year-only ranges are approximated and flagged.
