# Resume Parsing (Local, Rule-Based) — Design Spec

**Date:** 2026-10-03
**Status:** Implemented (uncommitted on `Archi`); margin labels and scanned PDFs (OCR) added 2026-10-05

---

## 1. What it does

When HR uploads a resume (Resume Inbox → Upload Resume, or Candidates → Add Candidate), the resume is read on our own server and the form fills in the candidate's **name, email and phone**. The same parse is stored on every application, so the review window shows the candidate's **latest role, work history, education, skills and profile links**.

Everything runs inside the API process. No resume text is sent to an AI model or a parsing service. Scanned resumes (a picture of the page saved as a PDF) are read with Tesseract text recognition, which also runs inside the API (§3.7).

## 2. Why it was rebuilt

Measured on 38 test resumes (two corpora, see §7), the first parser filled the name correctly 60% of the time and the phone 30–39% of the time. Its phone pattern cut off the last digit ("+91 98765 4321"). It took "CURRICULUM VITAE", "PROFESSIONAL EXPERIENCE" or "Backend Developer" as the name. It read two-column PDFs row by row across both columns. It never filled company names and missed half the degrees.

## 3. Pipeline

```
file ──► resume-text.ts ──► lines (+ font size, page) and link targets
              │  PDF: pdf-layout.ts puts text in reading order
              │  PDF pages with no text: resume-ocr/ reads the scan (Tesseract)
              │  DOCX: tables, headers/footers, styles, hidden text, hyperlinks
              │  section-labels.ts: section names set in a left margin
              ▼
        resume-parser/  ──► contact (email, phone, links) + confidence
                            name (+ confidence)
                            work history, education, projects, skills, summary
              ▼
        ParsedResumeData (contracts) ──► form auto-fill, stored parsed_data, review window
```

### 3.1 Reading PDFs in order (`pdf-layout.ts`)

pdf.js returns text in the order it was drawn. Designed resumes (sidebars, Canva, Word tables) draw both columns row by row, so the old text interleaved them. The new layout step rebuilds each page from coordinates:

1. Runs of text are grouped into lines by baseline, then split into segments wherever the gap is wider than 1.5× the font size.
2. A recursive XY-cut splits the page at the widest vertical gutter first (columns), then at horizontal gaps.
3. A vertical cut is refused when the two sides share baselines (≥ 60%), or when one side is only dates. Those are rows, not columns: "Engineer …… Jan 2021 – Present", "Name : value", a grid of skills. Their pieces stay on one line, separated by a tab.
4. Letter-spaced headings ("D E E P A K") are rejoined. Text drawn twice to fake bold is dropped. Rotated side labels go last.
5. Link annotations are collected (`mailto:`, `tel:`, LinkedIn, GitHub), because some resumes show only "Email" or a LinkedIn icon.

### 3.2 Word files

- A table row whose cells each hold one paragraph is a data row and becomes one tab-separated line ("M.Com ⇥ MG University ⇥ 2012"). A row with multi-paragraph cells is page layout (a sidebar), so it is read cell by cell.
- Page headers come first and footers last. Hidden text is skipped.
- Font sizes come from runs and paragraph styles (`styles.xml`), so the name set in the Title style or in large type is recognised.
- Hyperlink targets come from the relationship files and from `HYPERLINK` fields (in DOCX and in legacy .doc).

### 3.2a Section names in a left margin (`section-labels.ts`)

Many templates put each section name in a narrow left column, level with the first line of the section, and wrap a long name onto the next row:

```
EMPLOYMENT   Senior Security Officer | NPCIL, Mumbai
HISTORY      Jul 2021 - Present
```

Read row by row, the name hid inside content lines, so the parser saw no "Employment History" heading and missed every job, degree and skill under it (a typed PDF of this layout filled the contact details but nothing else). Such rows are now split: the name becomes a heading line, followed by the rest of each row. A name wrapped over two rows is joined when the two halves make a well-known heading ("EMPLOYMENT HISTORY", "Work Experience"). Only well-known section names count, never keyword guesses, so a job title in capitals ("PROJECT MANAGER   Jan 2020 - Present") is left alone. It applies to every format (PDF rows, Word table rows).

### 3.3 Contact details (`resume-parser/contact.ts`)

| Field | How it is found | What decides the primary one |
|---|---|---|
| Email | Regex on the text after rejoining split or obfuscated addresses ("name @gmail .com", "[at]"), plus `mailto:` links | A `mailto:` link, position near the top, the local part containing the name. Referees' and generic (info@, hr@) addresses rank lowest |
| Phone | Runs of digits with separators, each classified: Indian mobile (+91 / 0 / 91 / 10 digits starting 6–9), Indian landline (STD code), North American ((415) 555-0134), other international (+971 …) | Labels ("Mobile" beats "Res"/"Office"), position, `tel:` links. Dates, year ranges, PIN codes, Aadhaar/PAN/passport numbers, father's/emergency/referee numbers are excluded |
| Links | LinkedIn and GitHub URLs (normalised; a URL wrapped across two lines is rejoined), a portfolio from the header or links | — |

Indian mobiles are written as `+91 98765 43210`, matching the form's placeholder.

### 3.4 Name (`resume-parser/name.ts`)

- A `Name:` label wins.
- Otherwise every short line near the top, and every large-type line on page 1, is a candidate. A candidate must look like a name: capitalised words, initials or particles ("de", "bin"), no digits, not a section heading or document title ("RESUME", "BIO-DATA"). Honorifics ("Mr.", "Dr.", "CA") and post-nominals (", PMP", ", MBBS") are removed.
- Candidates are scored on font size (largest on the page counts most), position, two-to-three words, the email address containing the name, and job-title words (which count heavily against).
- A name stacked over two lines in the same large type ("ARJUN" / "MEHTA") is joined. ALL CAPS is written as a name ("K. S. Raghavan").
- With no good candidate, the name is taken from the email address ("rohit.verma88@…" → "Rohit Verma") if those words appear in the resume.
- `splitPersonName` (contracts): the first full word is the first name and the rest is the last name. Initials are never the first name ("K. S. Raghavan" → Raghavan / K. S.), so emails greet the candidate by the name they use.

### 3.5 Work history, education, skills (`entries.ts`, `skills.ts`)

- **Jobs** are anchored on date ranges inside the experience section. The short header lines around each anchor are cut at separators (tab, `|`, ` - `, ` @ `, ` at `, commas). Each piece is then classified as a role (job-title head nouns and modifiers), an organisation (legal suffixes, known employers, industry words) or a place (Indian cities and states, `City, ST`). Stacked layouts (LinkedIn: company / title / dates / location) are assigned to the right job, and numbered job lists and table rows also work.
- **Education**: degrees are named in short form (B.Tech, B.E., MBA, PGDM, B.Com, HSC, SSC, Diploma …). The field of study, institution (same line, or the line above or below), year (with "expected") and grade (CGPA, %, class) are recorded. Boards (CBSE) and certificates (NEBOSH) are not taken as institutions.
- **Skills**: the skills section is kept in the candidate's own words. Known skills (from the ATS vocabulary) are added only where the resume describes using them: summary, project and job descriptions. Company names and job titles do not count as skills, and a broader term is never inferred ("MongoDB" does not add "NoSQL").

### 3.6 Confidence and auto-fill rules (client `resumeAutofill.ts`)

Each contact field carries `high`, `medium` or `low` confidence.

- **High and medium** values fill an empty field, shown as "From the resume" or "From the resume — please check".
- **Low** values are offered under the field ("Resume says … Use"). They are not filled in.
- A value **never overwrites what HR typed**. A different value from the resume is offered instead. The name is one value, so a typed first name is not mixed with the resume's last name.
- Removing or replacing the resume takes back the values it filled. A slow read of a replaced file is ignored.
- If reading fails, or a scanned PDF has no readable text, the form says so instead of failing silently.
- Values read from a scan (OCR) are never `high`: they fill in as "From the resume — please check", and the form says the resume was read from a scanned image.

### 3.7 Scanned PDFs (`resume-ocr/`)

A PDF page with almost no text (under 20 characters) is treated as a picture of a page:

1. **Find the pictures.** pdf.js's drawing operations give each image with the transform it is drawn under (forms and groups included). Images under 5% of the page (logos, photos) are ignored. Black-and-white scans drawn as stencil masks are read too.
2. **One upright page picture** (`raster.ts`): every image is redrawn in grey where it sits on the page, at 300 dpi — the resolution Tesseract is tuned for. Low-resolution scans are enlarged (a 150 dpi scan of small type went from 56% to 90% word confidence); recognition took no longer at 300 dpi than at 250. Images placed square to the page (the usual case) are resampled in two quick passes (area-averaged when shrinking); quarter-turned images and `/Rotate` pages are turned upright.
3. **Recognition** (`engine.ts`): tesseract.js (Tesseract compiled to WebAssembly) in a worker thread, with the English LSTM model shipped in `node_modules` (`@tesseract.js-data/eng`, 3 MB) — nothing is downloaded at run time and no file is written. Automatic page layout is used because single-block mode drops the large name at the top. One worker is shared, jobs run one at a time, and it stops after a few idle minutes.
4. **Same layout as typed text:** every recognised word becomes a positioned text item (its line's type size as the font size), and goes through the same `pdf-layout.ts` code as real PDF text. Columns, margin labels and "the name is the largest text" work the same for a scan. Bullets Tesseract reads as "e" or "¢" are put back as bullets; rules and specks are dropped.

Limits: the first 3 scanned pages are read (a few seconds each), with a 150-second budget per file and 60 seconds per page. The result is cached by file content for 30 minutes, and a second request for a file still being read waits for the first, because the same file is read when the form is filled, when the application is saved and when it is ATS-scanned. `RESUME_OCR=false` turns recognition off (the form then says so).

What the user sees: the form fills in as for a typed resume, marked "please check"; the review window and the ATS report say the text was read from a scanned image. If a scan has no readable text, recognition fails or is off, the form says which.

## 4. Data and compatibility

- Types live in `@tapcrm/contracts` (`recruitment-resume.ts`) and are shared by the server and the client.
- New fields: `parserVersion` (`tapcrm-resume/2.1.0`; 2.0.0 before margin labels and OCR), `headline`, `links`, `experienceYears`, `confidence`, `otherEmails`, `otherPhones`, `warnings`, and `ocr` (`{ pages, confidence }`, set when text came from a scan). Jobs gain `company`, `location`, `startDate`, `endDate`, `current`. Education gains `field` and `grade`; its year can come from a date line below the degree.
- All fields are optional. Applications parsed by the first version keep their stored data, and the review window shows what they have, labelled as an earlier version.
- The ATS engine version is now `tapcrm-ats/1.2.0` (1.1.0 read PDFs in column order; 1.2.0 reads margin labels and scans). Older reports show as stale and a re-scan uses the new reading. A report made from a scan carries `extraction.ocrPages`, and the panel says the text was read from a scanned image.

## 5. API

No new routes or permissions. `POST /api/recruitment/candidates/resume/parse` returns the richer `ParsedCandidateData`. It now validates the uploaded file's size and type, and returns 422 (not 500) when no file is given and 404 for an unreadable storage key.

## 6. Limits

- Scans: printed text reads well; handwriting, photos taken at an angle, very low resolution (under ~100 dpi) and pages scanned sideways without `/Rotate` do not. Only English is recognised. Text drawn as vector shapes (no text and no picture) cannot be read.
- Scanned image files (JPG, PNG) are not accepted as resumes; only scans inside a PDF.
- Rule-based: unusual layouts can still mislead the job and education parsing. The contact fields carry confidence, and HR confirms every value before saving.
- Phone numbers default to India when no country code is written (the product's market). A bracketed area code is read as North American.

## 7. Verification

| Measure (38 resumes: 20 used while building + 18 written afterwards) | First parser | New parser |
|---|---|---|
| Name / first–last split | 60% / 60% | 100% / 100% |
| Email | 92% | 100% |
| Phone | 34% | 100% |
| LinkedIn / GitHub | 0% / 0% | 100% / 100% |
| Jobs (title + company) recall | 0% | 100% |
| Degrees recall | 43% | 100% |

The second set was written before the parser was run on it. On that first run it scored 100% on name, email, phone, links and degrees, and 86% on jobs (a numbered job list, a table layout and a "Manager – Finance" title). Those three cases were then fixed.

The corpora cover:
- PDF: single column, sidebars drawn row by row, LinkedIn export, LaTeX, Word→PDF tables, letter-spaced headings, contact details only as links, multi-page.
- DOCX: page header, footer, tables, Title style.
- Legacy .doc and plain text.

They were generated for this work and are synthetic, so real resumes will still produce misses. The confidence and auto-fill rules in §3.6 are there to catch those.

A third set checks margin labels and scans: three typed resumes with section names in a left margin (capitals with a two-row "EMPLOYMENT / HISTORY", title case, a Word table) and three scans of them (300 dpi; 200 dpi; 150 dpi skewed, blurred and noisy at JPEG quality 55). Before the margin-label change the three typed ones lost every job; now all six give the right name, email, phone, jobs and degree. A real-world scanned resume (one dense 2480×3509 JPEG page, 366 words) gives the name, phone, email, all three jobs with dates, the degree with its year and all ten skills. On a 2-core test server that took about 11 seconds when the engine was not yet running (most of it recognition); the lighter test scans took 2–3 seconds.

Tests: `resume-parser/parser.test.ts` (36), `section-labels.test.ts` (5), `resume-ocr/raster.test.ts` (10), `resume-ocr/resume-ocr.test.ts` (4, real recognition of a 12 KB scanned fixture), `recruitment-resume.test.ts` (3), `resumeAutofill.test.ts` (7). The updated recruitment and ATS suites pass, and a browser run checked the auto-fill flows (two-column PDF, typed values kept, suggestion used, scanned PDF, LaTeX, Word, mobile, light theme).
