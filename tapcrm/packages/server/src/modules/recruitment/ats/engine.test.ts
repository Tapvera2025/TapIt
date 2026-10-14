import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { atsScoreBand, type AtsCriteria, type AtsEvaluation } from '@tapcrm/contracts';
import { extractResumeText, normalizeResumeText, type ResumeTextExtraction } from '../resume-text.js';
import { criteriaHash, normalizeCriteria, suggestCriteria } from './criteria.js';
import { BASE_WEIGHTS, countMissingRequired, evaluateResume, redistributeWeights } from './engine.js';
import { atsCriteriaSchema } from './validators.js';

const AS_OF = new Date('2026-10-02T00:00:00Z');

function txt(text: string): ResumeTextExtraction {
  return { format: 'txt', text: normalizeResumeText(text), pageCount: null, issues: [] };
}

function criteria(overrides: Partial<AtsCriteria> = {}): AtsCriteria {
  return {
    requiredSkills: [],
    preferredSkills: [],
    minimumExperienceYears: null,
    requiredQualifications: [],
    ...overrides,
  };
}

function check(evaluation: AtsEvaluation, criterion: string) {
  const found = evaluation.checks.find((item) => item.criterion === criterion);
  if (!found) throw new Error(`no check for ${criterion}`);
  return found;
}

const PRIYA = `
Priya Raman
priya.raman@example.com | +91 98765 43210 | Bengaluru

PROFESSIONAL SUMMARY
Full stack engineer with 6+ years of experience building SaaS products.

WORK EXPERIENCE
Senior Software Engineer, Acme Cloud Pvt Ltd   Jan 2021 – Present
• Built multi-tenant APIs in Node.js and TypeScript on PostgreSQL with row-level security.
• Led migration of 40 services to k8s (EKS) on AWS; cut deploy time by 60%.
Software Engineer, Brightlabs   Jul 2018 – Dec 2020
• Developed React dashboards and REST APIs; introduced CI/CD with GitHub Actions.
Software Engineering Intern, Brightlabs   Jan 2018 – Jun 2018
• Wrote unit tests with Jest.

EDUCATION
B.Tech in Computer Science and Engineering, NIT Trichy   2014 – 2018

SKILLS
JavaScript, TypeScript, React, Node.js, Express, PostgreSQL, Redis, Docker, AWS, Git

CERTIFICATIONS
AWS Certified Solutions Architect – Associate (2022)
Certified Scrum Master (CSM)
`;

describe('ATS engine — scoring and evidence', () => {
  const jobCriteria = criteria({
    requiredSkills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Kubernetes', 'GraphQL'],
    preferredSkills: ['AWS', 'Go', 'CI/CD'],
    minimumExperienceYears: 5,
    requiredQualifications: ['B.Tech in Computer Science', 'AWS Certified Solutions Architect'],
  });

  it('scores a matching resume and quotes the resume line behind every point', () => {
    const evaluation = evaluateResume(txt(PRIYA), jobCriteria, { asOf: AS_OF });

    expect(evaluation.status).toBe('completed');
    expect(evaluation.score).toBe(87);
    expect(check(evaluation, 'React').outcome).toBe('matched');
    // Work evidence is preferred over the skills list.
    expect(check(evaluation, 'React').evidence).toBe('Developed React dashboards and REST APIs; introduced CI/CD with GitHub Actions.');
    expect(check(evaluation, 'Kubernetes')).toMatchObject({ outcome: 'matched', note: 'Matched as "k8s"' });
    expect(check(evaluation, 'GraphQL')).toMatchObject({ outcome: 'not_found', evidence: null });
    expect(check(evaluation, 'B.Tech in Computer Science').outcome).toBe('matched');
    expect(check(evaluation, 'AWS Certified Solutions Architect').outcome).toBe('matched');
    expect(countMissingRequired(evaluation)).toBe(1);
  });

  it('weights categories to 100 and never awards more than a category is worth', () => {
    const evaluation = evaluateResume(txt(PRIYA), jobCriteria, { asOf: AS_OF });
    expect(evaluation.breakdown.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    for (const item of evaluation.breakdown) expect(item.points).toBeLessThanOrEqual(item.weight);
    expect(evaluation.breakdown.find((item) => item.category === 'required_skills')).toMatchObject({
      weight: 50, matchedCount: 5, criteriaCount: 6, points: 41.7,
    });
  });

  it('redistributes weights over only the categories a job uses', () => {
    expect([...redistributeWeights(['required_skills']).values()]).toEqual([100]);
    const two = redistributeWeights(['required_skills', 'experience']);
    expect(two.get('required_skills')! + two.get('experience')!).toBe(100);
    expect(two.get('required_skills')).toBeGreaterThan(two.get('experience')!);
    const all = redistributeWeights(Object.keys(BASE_WEIGHTS) as (keyof typeof BASE_WEIGHTS)[]);
    expect([...all.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('is deterministic for the same resume and criteria', () => {
    const first = evaluateResume(txt(PRIYA), jobCriteria, { asOf: AS_OF });
    const second = evaluateResume(txt(PRIYA), jobCriteria, { asOf: AS_OF });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('marks a resume with too little readable text for manual review instead of scoring it', () => {
    const evaluation = evaluateResume(
      { format: 'pdf', text: '', pageCount: 1, issues: ['The PDF has almost no selectable text; it is probably a scanned image.'] },
      jobCriteria,
      { asOf: AS_OF },
    );
    expect(evaluation.status).toBe('needs_review');
    expect(evaluation.score).toBeNull();
    expect(evaluation.warnings[0]).toMatch(/No text could be read/);
    expect(evaluation.warnings).toContain('The PDF has almost no selectable text; it is probably a scanned image.');
  });
});

describe('ATS engine — skill matching', () => {
  const resume = (skills: string) => txt(`
Test Candidate
SKILLS
${skills}
EXPERIENCE
Developer, Example Labs   Jan 2020 – Present
Worked on internal tools for the operations team, wrote documentation and reviewed code.
Supported production releases, handled on-call rotations and mentored two junior developers.
`);

  it('does not find a skill inside a longer one', () => {
    const evaluation = evaluateResume(resume('JavaScript, C++, C#, ASP.NET, NodeJS'), criteria({
      requiredSkills: ['Java', 'C', 'C++', '.NET', 'Node.js'],
    }), { asOf: AS_OF });
    expect(check(evaluation, 'Java').outcome).toBe('not_found');
    expect(check(evaluation, 'C').outcome).toBe('not_found');
    expect(check(evaluation, 'C++').outcome).toBe('matched');
    expect(check(evaluation, '.NET').outcome).toBe('matched');
    expect(check(evaluation, 'Node.js')).toMatchObject({ outcome: 'matched', note: 'Matched as "NodeJS"' });
  });

  it('does not read the "js" in Node.js as JavaScript', () => {
    const evaluation = evaluateResume(resume('Node.js, Vue.js, Express'), criteria({ requiredSkills: ['JavaScript', 'Vue'] }), { asOf: AS_OF });
    expect(check(evaluation, 'JavaScript').outcome).toBe('not_found');
    expect(check(evaluation, 'Vue').outcome).toBe('matched');
  });

  it('reports an ambiguous short form as uncertain rather than a match', () => {
    const ambiguous = evaluateResume(resume('Go, Python, SQL'), criteria({ requiredSkills: ['Golang'] }), { asOf: AS_OF });
    expect(check(ambiguous, 'Golang').outcome).toBe('uncertain');
    expect(ambiguous.breakdown[0]!.points).toBe(50);

    const explicit = evaluateResume(resume('Golang, Python, SQL'), criteria({ requiredSkills: ['Go'] }), { asOf: AS_OF });
    expect(check(explicit, 'Go').outcome).toBe('matched');
  });

  it('accepts any one of "A or B" alternatives and says which one', () => {
    const evaluation = evaluateResume(resume('HubSpot CRM, cold calling'), criteria({
      requiredSkills: ['Salesforce or HubSpot', 'B2B sales or enterprise sales'],
    }), { asOf: AS_OF });
    expect(check(evaluation, 'Salesforce or HubSpot')).toMatchObject({ outcome: 'matched', note: 'Met by "HubSpot"' });
    expect(check(evaluation, 'B2B sales or enterprise sales')).toMatchObject({ outcome: 'not_found', note: null });
  });

  it('treats a one-letter language name as ambiguous', () => {
    const evaluation = evaluateResume(resume('Embedded C, RTOS, (c) 2024 Example Labs'), criteria({ requiredSkills: ['C'] }), { asOf: AS_OF });
    expect(check(evaluation, 'C')).toMatchObject({ outcome: 'matched', note: 'Matched as "Embedded C"' });
    const bare = evaluateResume(resume('Python, (c) 2024 Example Labs'), criteria({ requiredSkills: ['C'] }), { asOf: AS_OF });
    expect(check(bare, 'C').outcome).not.toBe('matched');
  });

  it('matches criteria outside the built-in vocabulary as phrases', () => {
    const evaluation = evaluateResume(resume('Razorpay payment gateway integration, Socket.IO'), criteria({
      requiredSkills: ['Payment gateway integration', 'socket.io', 'Gateway payments'],
    }), { asOf: AS_OF });
    expect(check(evaluation, 'Payment gateway integration').outcome).toBe('matched');
    expect(check(evaluation, 'socket.io').outcome).toBe('matched');
    expect(check(evaluation, 'Gateway payments').outcome).toBe('uncertain');
  });
});

describe('ATS engine — experience', () => {
  function years(text: string, minimum = 3) {
    const evaluation = evaluateResume(txt(text), criteria({ minimumExperienceYears: minimum }), { asOf: AS_OF });
    return { evaluation, item: check(evaluation, `At least ${minimum} years of experience`) };
  }

  it('merges overlapping roles, skips internships and ignores education dates', () => {
    const { evaluation, item } = years(`
EXPERIENCE
Engineer, Alpha   Mar 2020 – Feb 2023
Part-time Consultant, Beta   Jan 2022 – Dec 2022
Summer Intern, Gamma   May 2019 – Jul 2019
EDUCATION
B.Sc Physics, Delhi University   2016 – 2019
${'Delivered client projects across banking and retail domains with measurable outcomes. '.repeat(3)}
`);
    expect(evaluation.extractedExperienceYears).toBe(3);
    expect(item.outcome).toBe('matched');
    expect(item.note).toContain('3 months of internships not counted');
  });

  it('gives partial credit below the minimum and flags year-only dates', () => {
    const { evaluation, item } = years(`
WORK EXPERIENCE
Analyst, Northwind   2024 – Present
${'Prepared weekly operational dashboards and reconciled vendor invoices for the finance team. '.repeat(3)}
`, 4);
    expect(evaluation.extractedExperienceYears).toBe(2.8);
    expect(item.outcome).toBe('not_found');
    expect(item.note).toContain('some dates give only the year');
    // Experience is the only category here, so it carries all 100 points: 2.8 / 4 of them.
    expect(evaluation.breakdown[0]).toMatchObject({ weight: 100, points: 70 });
  });

  it('treats a stated total without dates as uncertain', () => {
    const { item } = years(`
SUMMARY
Sales professional with 7 years of experience in B2B software sales across India.
${'Closed enterprise deals, built partner channels and trained new account executives. '.repeat(3)}
`);
    expect(item.outcome).toBe('uncertain');
    expect(item.note).toMatch(/states 7 years/);
  });

  it('warns when no experience can be measured', () => {
    const { evaluation, item } = years(`
PROFILE
${'Motivated graduate eager to learn modern web development and contribute to a product team. '.repeat(5)}
`);
    expect(item.outcome).toBe('not_found');
    expect(evaluation.warnings.some((warning) => warning.includes('experience could not be measured'))).toBe(true);
  });
});

describe('ATS engine — qualifications', () => {
  const filler = 'Coordinated cross-functional teams, prepared reports and presented findings to leadership. '.repeat(3);
  function qualification(education: string, requirement: string, extra = '') {
    const evaluation = evaluateResume(txt(`
Candidate Name
EXPERIENCE
Associate, Contoso   Jun 2019 – Present
${filler}
EDUCATION
${education}
${extra}
`), criteria({ requiredQualifications: [requirement] }), { asOf: AS_OF });
    return check(evaluation, requirement);
  }

  it('meets a generic level with any degree at or above it', () => {
    expect(qualification('MBA (Marketing), IIM Indore, 2017 – 2019', "Bachelor's degree").outcome).toBe('matched');
    expect(qualification('Diploma in Mechanical Engineering, 2015', "Bachelor's degree").outcome).toBe('not_found');
  });

  it('does not let a lower degree meet a higher one', () => {
    expect(qualification('B.Com, Mumbai University, 2016', "Master's degree in Finance").outcome).toBe('not_found');
    expect(qualification('M.Com in Finance, Mumbai University, 2018', "Master's degree in Finance").outcome).toBe('matched');
  });

  it('reads degrees from the Education section only', () => {
    const result = qualification('B.A. English, Pune University, 2015', "Master's degree", `
CERTIFICATIONS
Certified Scrum Master (CSM)`);
    expect(result.outcome).toBe('not_found');
  });

  it('accepts equivalent and higher degrees in the same discipline', () => {
    expect(qualification('B.E. Computer Science, Anna University, 2018', 'B.Tech in Computer Science').outcome).toBe('matched');
    const higher = qualification('M.Tech in Computer Science, IIT Delhi, 2020', 'B.Tech in Computer Science');
    expect(higher.outcome).toBe('matched');
    expect(higher.note).toContain('M.Tech / M.E. meets this requirement');
  });

  it('is uncertain when the field is different, the degree is in progress, or only an abbreviation is present', () => {
    expect(qualification('B.E. (IT), Pune University, 2016 – 2020', 'B.Tech in Computer Science'))
      .toMatchObject({ outcome: 'uncertain', note: 'Degree found, but the field of study is not confirmed' });
    expect(qualification('B.Tech Computer Science (pursuing), VIT, 2023 – 2027', 'B.Tech in Computer Science'))
      .toMatchObject({ outcome: 'uncertain', note: 'Appears to be in progress' });
    expect(qualification('BE Electronics, 2014', 'B.Tech').outcome).toBe('uncertain');
    expect(qualification('we will be glad to share references', 'B.Tech').outcome).toBe('not_found');
  });

  it('knows certifications by their long and short names', () => {
    expect(qualification('B.Com, 2012', 'PMP', `
CERTIFICATIONS
Project Management Professional, PMI (2021)`)).toMatchObject({ outcome: 'matched', note: 'Matched as "Project Management Professional"' });
  });
});

describe('ATS criteria', () => {
  it('normalises, de-duplicates and keeps required skills out of preferred', () => {
    expect(normalizeCriteria({
      requiredSkills: [' React ', 'react', 'Node.js'],
      preferredSkills: ['REACT', 'AWS'],
      minimumExperienceYears: 2.3,
      requiredQualifications: ['  B.Tech  '],
    })).toEqual({
      requiredSkills: ['React', 'Node.js'],
      preferredSkills: ['AWS'],
      minimumExperienceYears: 2.5,
      requiredQualifications: ['B.Tech'],
    });
  });

  it('hashes criteria independent of order and letter case', () => {
    const a = criteria({ requiredSkills: ['React', 'AWS'], minimumExperienceYears: 3 });
    const b = criteria({ requiredSkills: ['aws', 'react'], minimumExperienceYears: 3 });
    expect(criteriaHash(a)).toBe(criteriaHash(b));
    expect(criteriaHash(a)).not.toBe(criteriaHash({ ...a, minimumExperienceYears: 4 }));
  });

  it('suggests criteria from the job post without inventing requirements', () => {
    expect(suggestCriteria({
      title: 'Senior Frontend Engineer',
      description: 'Build our customer dashboard in React and TypeScript.',
      requirements: '5+ years of experience with React. Strong CSS skills.\nB.Tech in Computer Science or equivalent.\nGraphQL experience is a plus.',
    })).toEqual({
      requiredSkills: ['React', 'TypeScript', 'CSS'],
      preferredSkills: ['GraphQL'],
      minimumExperienceYears: 5,
      requiredQualifications: ['B.Tech in Computer Science'],
    });
  });

  it('keeps alternatives together, folds examples into their skill and reads "N years in"', () => {
    expect(suggestCriteria({
      title: 'Inside Sales Executive',
      description: 'Own outbound prospecting for our CRM product. We were founded 12 years ago.',
      requirements: '2+ years in B2B sales or inside sales. Cold calling, lead generation and CRM (Salesforce or HubSpot). Any graduate. Negotiation skills are a plus.',
    })).toEqual({
      requiredSkills: ['B2B sales or inside sales', 'lead generation', 'CRM', 'Cold calling'],
      preferredSkills: ['Negotiation'],
      minimumExperienceYears: 2,
      requiredQualifications: ['Any graduate'],
    });
  });

  it('labels a high score "Strong match" only when every must-have is present', () => {
    expect(atsScoreBand(86).label).toBe('Strong match');
    expect(atsScoreBand(86, 1)).toEqual({ min: 60, label: 'Good match', tone: 'good' });
    expect(atsScoreBand(45, 2).label).toBe('Partial match');
  });

  it('rejects personal or protected characteristics but allows look-alike skills', () => {
    for (const bad of ['Male candidates only', 'Age below 30', 'Hindu', 'Unmarried', 'Fair complexion', 'Kannada mother tongue']) {
      expect(atsCriteriaSchema.safeParse(criteria({ requiredSkills: [bad] })).success, bad).toBe(false);
    }
    for (const good of ['React Native', 'Single sign-on', 'Race conditions', 'Color theory', 'Photo editing', 'Political science', 'Genetic algorithms']) {
      expect(atsCriteriaSchema.safeParse(criteria({ requiredSkills: [good] })).success, good).toBe(true);
    }
  });

  it('needs at least one requirement and no skill both required and preferred', () => {
    expect(atsCriteriaSchema.safeParse(criteria({ preferredSkills: ['AWS'] })).success).toBe(false);
    expect(atsCriteriaSchema.safeParse(criteria({ requiredSkills: ['AWS'], preferredSkills: ['aws'] })).success).toBe(false);
    expect(atsCriteriaSchema.safeParse(criteria({ minimumExperienceYears: 2 })).success).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Text extraction from real file formats (built in memory)
 * ------------------------------------------------------------------ */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

/** A minimal one-page PDF with one Helvetica text line per entry. */
function pdf(lines: readonly string[]): Buffer {
  const content = ['BT', '/F1 11 Tf', ...lines.map((line, index) =>
    `1 0 0 1 50 ${780 - index * 16} Tm (${line.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('resume text extraction', () => {
  it('reads DOCX header, body and table rows with line breaks (not the raw ZIP bytes)', async () => {
    const document = `<w:document xmlns:w="w"><w:body>${paragraph('Experience')}${paragraph('Engineer &amp; Lead – Acme   Jan 2020 – Present')}<w:tbl><w:tr><w:tc>${paragraph('B.E. Computer Science')}</w:tc><w:tc>${paragraph('2016 – 2020')}</w:tc></w:tr></w:tbl></w:body></w:document>`;
    const docx = zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': document,
      'word/header1.xml': `<w:hdr xmlns:w="w">${paragraph('jane@example.com | +91 90000 00000')}</w:hdr>`,
    });
    const result = await extractResumeText(docx, 'cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.format).toBe('docx');
    expect(result.issues).toEqual([]);
    expect(result.text.split('\n')).toEqual([
      'jane@example.com | +91 90000 00000',
      '',
      'Experience',
      // Text pushed apart with spaces, and table cells, stay apart as tab-separated fields.
      'Engineer & Lead - Acme\tJan 2020 - Present',
      'B.E. Computer Science\t2016 - 2020',
    ]);
  });

  it('keeps PDF lines apart so sections and dates can be read', async () => {
    const result = await extractResumeText(pdf(['Asha Verma', 'EXPERIENCE', 'Analyst, Initech   Feb 2021 - Present', 'SKILLS', 'SQL, Tableau']), 'cv.pdf', 'application/pdf');
    expect(result.format).toBe('pdf');
    expect(result.pageCount).toBe(1);
    expect(result.text.split('\n')).toEqual(['Asha Verma', 'EXPERIENCE', 'Analyst, Initech Feb 2021 - Present', 'SKILLS', 'SQL, Tableau']);
  });

  it('reports unreadable files instead of returning binary noise', async () => {
    const broken = await extractResumeText(Buffer.from('%PDF-1.4 not really a pdf'), 'cv.pdf', 'application/pdf');
    expect(broken.text).toBe('');
    expect(broken.issues[0]).toMatch(/could not be read|selectable text/);

    const binary = await extractResumeText(Buffer.from([0x00, 0x1f, 0x8b, 0xff, 0xee, 0x00, 0x01]), 'cv.bin', 'application/octet-stream');
    expect(binary.text).toBe('');
    expect(binary.issues).toContain('The file type is not supported for text extraction.');
  });
});
