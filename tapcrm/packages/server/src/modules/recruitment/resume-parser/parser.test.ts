import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildResumeDocument, findDateRanges } from '../ats/text.js';
import { layoutPdfPage, type PdfTextItem } from '../pdf-layout.js';
import { parseResume } from '../parser.js';
import {
  extractResumeText,
  normalizeResumeLine,
  normalizeResumeText,
  readWordStyleSizes,
  wordprocessingXmlToLines,
  type ResumeTextExtraction,
} from '../resume-text.js';
import { classifyPhone, findEmails, findLinks, findPhones, type ContactLine } from './contact.js';
import { parseEducation, parseExperience } from './entries.js';
import { parseResumeExtraction, RESUME_PARSER_VERSION } from './index.js';
import { cleanName, displayName, findName, type NameLine } from './name.js';
import { extractSkills } from './skills.js';

const AS_OF = new Date('2026-10-03T00:00:00Z');

function txt(text: string): ResumeTextExtraction {
  const normalized = normalizeResumeText(text);
  return {
    format: 'txt',
    text: normalized,
    pageCount: null,
    issues: [],
    lines: normalized.split('\n').filter(Boolean).map((line) => ({ text: line, size: null, page: null })),
    links: [],
  };
}

function parse(text: string) {
  return parseResumeExtraction(txt(text), { asOf: AS_OF });
}

function contactLines(text: string): ContactLine[] {
  return buildResumeDocument(normalizeResumeText(text)).lines.map((line) => ({
    text: line.text,
    index: line.index,
    section: line.section,
    heading: line.headingText?.toLowerCase() ?? null,
  }));
}

/* ------------------------------------------------------------------ *
 * Minimal file builders
 * ------------------------------------------------------------------ */

interface PdfText {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size?: number;
  readonly bold?: boolean;
}

/** A one-page PDF with positioned Helvetica text and optional link annotations. */
function pdf(texts: readonly PdfText[], links: readonly { rect: readonly number[]; uri: string }[] = []): Buffer {
  const escape = (value: string) => value.replace(/[()\\]/g, (c) => `\\${c}`);
  const content = texts.map((item) =>
    `BT /${item.bold ? 'F2' : 'F1'} ${item.size ?? 10} Tf 1 0 0 1 ${item.x} ${item.y} Tm (${escape(item.text)}) Tj ET`).join('\n');
  const annotationIds = links.map((_, index) => 7 + index);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R${
      links.length ? ` /Annots [${annotationIds.map((id) => `${id} 0 R`).join(' ')}]` : ''} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    ...links.map((link) => `<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${link.uri}) >> >>`),
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

const W = 'xmlns:w="w" xmlns:r="r"';
const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (body: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${body}</w:p>`;
const cell = (...paragraphs: string[]) => `<w:tc>${paragraphs.join('')}</w:tc>`;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/* ------------------------------------------------------------------ *
 * Text extraction
 * ------------------------------------------------------------------ */

describe('resume text normalisation', () => {
  it('drops icon glyphs, keeps a leading icon as a bullet and rejoins spaced-out words', () => {
    // The icon between two fields leaves a gap, which separates them like a tab.
    expect(normalizeResumeLine('\u260e +91 98765 43210  \u2709 a@b.com')).toBe('- +91 98765 43210\ta@b.com');
    expect(normalizeResumeLine('\uf0b7 Led the team')).toBe('- Led the team');
    expect(normalizeResumeLine('\u0088 Wrote firmware')).toBe('- Wrote firmware');
    expect(normalizeResumeLine('D E E P A K   J O S H I')).toBe('DEEPAK JOSHI');
    expect(normalizeResumeLine('R E S U M E')).toBe('RESUME');
  });

  it('turns wide gaps into a tab, the field separator the parser splits on', () => {
    expect(normalizeResumeLine('Engineer, Acme      Jan 2020 - Present')).toBe('Engineer, Acme\tJan 2020 - Present');
    expect(normalizeResumeLine('Engineer  \t  Acme')).toBe('Engineer\tAcme');
    expect(normalizeResumeLine('two  spaces')).toBe('two spaces');
  });
});

describe('PDF reading order', () => {
  const item = (str: string, x: number, y: number, size = 10, width = str.length * size * 0.5): PdfTextItem => ({
    str, transform: [size, 0, 0, size, x, y], width, height: size,
  });

  it('reads a sidebar and a main column one after the other, even when drawn row by row', () => {
    const items = [
      item('SNEHA PATIL', 220, 780, 24), item('CONTACT', 30, 760, 11),
      item('UI/UX Designer', 220, 752, 12), item('+91 98450 12345', 30, 742, 9),
      item('EXPERIENCE', 220, 720, 12), item('sneha@x.com', 30, 726, 9),
      item('Senior UI Designer', 220, 700), item('SKILLS', 30, 700, 11),
      item('Zoho Corporation | Jan 2023 - Present', 220, 686), item('Figma', 30, 684, 9),
      item('- Redesigned onboarding.', 220, 672), item('Adobe XD', 30, 668, 9),
    ];
    const lines = layoutPdfPage(items, 1, 842).map((line) => line.text);
    expect(lines).toEqual([
      'CONTACT', '+91 98450 12345', 'sneha@x.com', 'SKILLS', 'Figma', 'Adobe XD',
      'SNEHA PATIL', 'UI/UX Designer', 'EXPERIENCE', 'Senior UI Designer', 'Zoho Corporation | Jan 2023 - Present', '- Redesigned onboarding.',
    ]);
  });

  it('keeps a right-aligned date, and a label with its value, on their row', () => {
    const items = [
      item('Software Engineer, Acme', 50, 700), item('Jan 2021 - Present', 470, 700),
      item('Analyst, Beta', 50, 686), item('2018 - 2020', 490, 686),
      item('Name', 50, 660), item(': Mohammed Rahman', 160, 660),
      item('Mobile', 50, 646), item(': 9123456789', 160, 646),
    ];
    expect(layoutPdfPage(items, 1, 842).map((line) => line.text)).toEqual([
      'Software Engineer, Acme\tJan 2021 - Present', 'Analyst, Beta\t2018 - 2020', 'Name\t: Mohammed Rahman', 'Mobile\t: 9123456789',
    ]);
  });

  it('rejoins letter-spaced headings and ignores fake-bold overprinting', () => {
    const items = [item('D E E P A K', 50, 780, 24, 130), item(' ', 180, 780, 24, 18), item('J O S H I', 199, 780, 24, 96),
      item('Joshi Labs', 50, 740), item('Joshi Labs', 50.2, 740)];
    expect(layoutPdfPage(items, 1, 842).map((line) => line.text)).toEqual(['DEEPAK JOSHI', 'Joshi Labs']);
  });

  it('extracts link targets and font sizes from a real PDF', async () => {
    const file = pdf([
      { x: 50, y: 780, text: 'Nikhil Bansal', size: 22, bold: true },
      { x: 50, y: 750, text: 'Email    LinkedIn' },
    ], [{ rect: [50, 748, 75, 760], uri: 'mailto:nikhil.bansal@gmail.com' }, { rect: [95, 748, 135, 760], uri: 'https://www.linkedin.com/in/nikhilb/' }]);
    const result = await extractResumeText(file, 'cv.pdf', 'application/pdf');
    expect(result.lines?.[0]).toEqual({ text: 'Nikhil Bansal', size: 22, page: 1 });
    expect(result.links).toEqual(['mailto:nikhil.bansal@gmail.com', 'https://www.linkedin.com/in/nikhilb/']);
  });
});

describe('DOCX extraction', () => {
  it('reads a data table as tab-separated rows and a layout table cell by cell', () => {
    const xml = `<w:document ${W}><w:body>`
      + `<w:tbl><w:tr>${cell(para(run('M.Com')))}${cell(para(run('MG University')))}${cell(para(run('2012')))}</w:tr></w:tbl>`
      + `<w:tbl><w:tr>${cell(para(run('CONTACT')), para(run('98450 12345')))}${cell(para(run('EXPERIENCE')), para(run('HR Generalist')))}</w:tr></w:tbl>`
      + '</w:body></w:document>';
    expect(wordprocessingXmlToLines(xml).lines.map((line) => line.text)).toEqual([
      'M.Com\tMG University\t2012', 'CONTACT', '98450 12345', 'EXPERIENCE', 'HR Generalist',
    ]);
  });

  it('skips hidden text and tab-stop definitions, and keeps run sizes', () => {
    const xml = `<w:document ${W}><w:body>`
      + `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9000"/></w:tabs></w:pPr>${run('Asha Rao', '<w:sz w:val="48"/>')}${run(' java python aws', '<w:vanish/>')}</w:p>`
      + para(run('Analyst') + '<w:r><w:tab/></w:r>' + run('2019 - 2021'))
      + '</w:body></w:document>';
    expect(wordprocessingXmlToLines(xml).lines).toEqual([
      { text: 'Asha Rao', size: 24, page: null },
      { text: 'Analyst\t2019 - 2021', size: 11, page: null },
    ]);
  });

  it('reads styles, the page header first, the footer last, and hyperlink targets', async () => {
    const styles = '<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:styleId="Title"><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="56"/></w:rPr></w:style></w:styles>';
    expect(readWordStyleSizes(styles).paragraphStyles.get('Title')).toBe(28);
    const file = zip({
      '[Content_Types].xml': '<Types/>',
      'word/styles.xml': styles,
      'word/document.xml': `<w:document ${W}><w:body>${para(run('Vikram Singh'), 'Title')}<w:p><w:hyperlink r:id="rId9">${run('vikram@x.com')}</w:hyperlink></w:p></w:body></w:document>`,
      'word/header1.xml': `<w:hdr ${W}>${para(run('Curriculum Vitae'))}</w:hdr>`,
      'word/footer1.xml': `<w:ftr ${W}>${para(run('Page 1'))}</w:ftr>`,
      'word/_rels/document.xml.rels': '<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:vikram@x.com" TargetMode="External"/></Relationships>',
    });
    const result = await extractResumeText(file, 'cv.docx', DOCX_MIME);
    expect(result.text.split('\n')).toEqual(['Curriculum Vitae', '', 'Vikram Singh', 'vikram@x.com', '', 'Page 1']);
    expect(result.lines?.find((line) => line.text === 'Vikram Singh')?.size).toBe(28);
    expect(result.links).toEqual(['mailto:vikram@x.com']);
  });
});

/* ------------------------------------------------------------------ *
 * Contact details
 * ------------------------------------------------------------------ */

describe('phone numbers', () => {
  it('normalises Indian mobile numbers however they are written', () => {
    for (const written of ['9876543210', '+91 98765 43210', '+91-9876543210', '(+91) 98765 43210', '098765 43210', '0 98765 43210', '91 9876543210', '0091 98765 43210', '98765.43210']) {
      expect(classifyPhone(written)?.display, written).toBe('+91 98765 43210');
    }
  });

  it('recognises landlines, North American and other international numbers', () => {
    expect(classifyPhone('080-41234567')?.kind).toBe('in-landline');
    expect(classifyPhone('+91-80-41234567')).toMatchObject({ display: '+91 80 41234567', kind: 'in-landline' });
    expect(classifyPhone('+91 (0) 98765 43210')?.display).toBe('+91 98765 43210');
    expect(classifyPhone('(415) 555-0134')).toMatchObject({ display: '+1 415-555-0134', kind: 'nanp' });
    expect(classifyPhone('+1 (646) 555-0199')?.display).toBe('+1 646-555-0199');
    expect(classifyPhone('+971 50 123 4567')).toMatchObject({ display: '+971 50 123 4567', kind: 'international' });
  });

  it('is not fooled by dates, year ranges or long identifiers', () => {
    for (const written of ['2016 - 2020', '14-08-1994', '1994-08-14', '2019 2021', '1234 5678 9012 3456']) {
      expect(classifyPhone(written), written).toBeNull();
    }
  });

  it("prefers the candidate's labelled mobile over landlines, referees and family", () => {
    const lines = contactLines([
      'Asha Rao',
      'Res: 022-26801234 | Mobile: 98200 45678',
      "Father's Mobile: 9822012345",
      'Aadhaar No: 9123 4567 8901',
      'REFERENCES',
      'Mr. S. Kumar, Manager - +91 94440 12345',
    ].join('\n'));
    const phones = findPhones(lines, []);
    expect(phones[0]).toMatchObject({ value: '+91 98200 45678', confidence: 'high' });
    expect(phones.map((phone) => phone.value)).not.toContain('+91 98220 12345');
    expect(phones.map((phone) => phone.value)).not.toContain('+91 91234 56789');
    expect(phones.at(-1)?.value).toBe('+91 94440 12345');
  });

  it('splits two numbers written side by side, and reads tel: links', () => {
    expect(findPhones(contactLines('Contact: 98765 43210 91234 56789'), []).map((phone) => phone.value))
      .toEqual(['+91 98765 43210', '+91 91234 56789']);
    expect(findPhones([], ['tel:+919812345678'])[0]?.value).toBe('+91 98123 45678');
  });
});

describe('email addresses', () => {
  it('rejoins split, obfuscated and label-glued addresses', () => {
    const emails = (text: string) => findEmails(contactLines(text), [], []).map((email) => email.value);
    expect(emails('priya.raman @gmail .com')).toEqual(['priya.raman@gmail.com']);
    expect(emails('rahul [at] gmail [dot] com')).toEqual(['rahul@gmail.com']);
    expect(emails('Email-PRIYA.DESAI@GMAIL.COM')).toEqual(['priya.desai@gmail.com']);
    expect(emails('+91 98765432109876543210rahul@x.in')).toEqual(['rahul@x.in']);
  });

  it("ranks the candidate's own address over a referee's, and reads mailto: links", () => {
    const lines = contactLines(['Deepa R', 'REFERENCES', 'Mr. Kumar - kumar.s@hexaware.com', 'PERSONAL DETAILS', 'Email: deepa.raghu@gmail.com'].join('\n'));
    expect(findEmails(lines, [], ['deepa'])[0]?.value).toBe('deepa.raghu@gmail.com');
    expect(findEmails([], ['mailto:Nikhil.B@Gmail.com?subject=Hi'], [])[0]?.value).toBe('nikhil.b@gmail.com');
  });
});

describe('profile links', () => {
  it('normalises LinkedIn and GitHub, rejoining a URL wrapped across lines', () => {
    const lines = contactLines('www.linkedin.com/in/anil-\nmenon-12345\ngithub.com/features\nhttps://github.com/echen/repo');
    expect(findLinks(lines, [])).toEqual({
      linkedin: 'https://www.linkedin.com/in/anil-menon-12345',
      github: 'https://github.com/echen',
    });
  });

  it('takes a portfolio from the header or the PDF links, never a social profile', () => {
    expect(findLinks(contactLines('Asha Rao\nbehance.net/asharao | instagram.com/asha'), []).portfolio).toBe('https://behance.net/asharao');
  });
});

/* ------------------------------------------------------------------ *
 * Name
 * ------------------------------------------------------------------ */

function nameLines(entries: readonly (string | readonly [string, number])[]): NameLine[] {
  const document = buildResumeDocument(entries.map((entry) => (typeof entry === 'string' ? entry : entry[0])).join('\n'));
  return document.lines.map((line, index) => {
    const entry = entries[index];
    return {
      text: line.text, index: line.index, size: typeof entry === 'string' || !entry ? null : entry[1], page: 1,
      section: line.section, heading: line.heading,
    };
  });
}

describe('candidate name', () => {
  it('cleans titles, credentials and wrapping, and rejects lines that are not names', () => {
    expect(cleanName('Mr. Farhan Qureshi')).toBe('Farhan Qureshi');
    expect(cleanName('Emily Chen, PMP')).toBe('Emily Chen');
    expect(cleanName('(ROHIT KUMAR VERMA)')).toBe('ROHIT KUMAR VERMA');
    expect(cleanName('Resume of Kiran Shetty')).toBe('Kiran Shetty');
    expect(cleanName('Dr. Priya Sharma, MBBS')).toBe('Priya Sharma');
    expect(cleanName('\u0930\u093e\u0939\u0941\u0932 \u0936\u0930\u094d\u092e\u093e')).toBe('\u0930\u093e\u0939\u0941\u0932 \u0936\u0930\u094d\u092e\u093e');
    for (const line of ['CURRICULUM VITAE', 'WORK EXPERIENCE', 'Pune, Maharashtra', 'rohit@gmail.com', 'Top Skills', 'HTML & CSS']) {
      expect(cleanName(line), line).toBeNull();
    }
  });

  it('writes capitals and lower case as a name, keeping initials and particles', () => {
    expect(displayName('K. S. RAGHAVAN')).toBe('K. S. Raghavan');
    expect(displayName("ANA DE SOUZA-D'COSTA")).toBe("Ana de Souza-D'Costa");
    expect(displayName('McDonald Ross')).toBe('McDonald Ross');
  });

  it('skips document titles and job titles above the name', () => {
    expect(findName(nameLines(['CURRICULUM VITAE', 'ROHIT KUMAR VERMA', 'Mobile: 9876543210']), ['rohit.verma88@gmail.com']))
      .toMatchObject({ value: 'Rohit Kumar Verma', confidence: 'high' });
    expect(findName(nameLines(['Senior Business Analyst', 'Ananya Reddy']), [])?.value).toBe('Ananya Reddy');
  });

  it('uses font size, so a sidebar read first does not hide the name', () => {
    const lines = nameLines([['Contact', 13], ['anil@x.com', 9], ['Top Skills', 13], ['Kubernetes', 9], ['Anil Menon', 24], ['Site Reliability Engineer', 11]]);
    expect(findName(lines, [])?.value).toBe('Anil Menon');
  });

  it('reads a "Name:" label, joins a stacked name and falls back to the email address', () => {
    expect(findName(nameLines(['BIO-DATA', 'Name\t: Mohammed Abdul Rahman']), [])).toMatchObject({ value: 'Mohammed Abdul Rahman', confidence: 'high' });
    expect(findName(nameLines([['ARJUN', 34], ['MEHTA', 34], ['Backend Developer', 11], ['EXPERIENCE', 12]]), ['arjun.mehta@x.in'])?.value).toBe('Arjun Mehta');
    expect(findName(nameLines(['EXPERIENCE', 'Analyst at Swiggy, worked with rohit verma on pricing']), ['rohit.verma88@gmail.com']))
      .toMatchObject({ value: 'Rohit Verma', confidence: 'medium' });
  });
});

/* ------------------------------------------------------------------ *
 * Work history, education, skills
 * ------------------------------------------------------------------ */

function experienceOf(text: string) {
  const document = buildResumeDocument(normalizeResumeText(text));
  return parseExperience(document, findDateRanges(document, AS_OF), AS_OF)
    .map((entry) => [entry.title, entry.company, entry.location ?? null]);
}

describe('work history', () => {
  it('splits title, company and place whatever their order and separators', () => {
    expect(experienceOf([
      'WORK EXPERIENCE',
      'Sr. Sales Executive - HDFC Bank Ltd. (Mar 2019 - Present)',
      '- Managed 300 retail customers.',
      'Kotak Mahindra Bank - Relationship Manager (Aug 2016 - Feb 2019)',
      'Maintenance Technician, Tata Motors, Pune (2014 - 2016)',
      'Software Engineer, Brightlabs      Jul 2012 - Dec 2013',
      'Data Engineer - Fractal Analytics (Mumbai)      Jan\'11 - Jun\'12',
    ].join('\n'))).toEqual([
      ['Sr. Sales Executive', 'HDFC Bank Ltd.', null],
      ['Relationship Manager', 'Kotak Mahindra Bank', null],
      ['Maintenance Technician', 'Tata Motors', 'Pune'],
      ['Software Engineer', 'Brightlabs', null],
      ['Data Engineer', 'Fractal Analytics', 'Mumbai'],
    ]);
  });

  it('assigns stacked header lines to the right job (LinkedIn and template layouts)', () => {
    expect(experienceOf([
      'Experience',
      'Razorpay', 'Site Reliability Engineer', 'April 2021 - Present (3 years 7 months)', 'Bengaluru, Karnataka, India',
      'Flipkart', 'DevOps Engineer', 'July 2017 - March 2021 (3 years 9 months)',
    ].join('\n'))).toEqual([
      ['Site Reliability Engineer', 'Razorpay', 'Bengaluru, Karnataka, India'],
      ['DevOps Engineer', 'Flipkart', null],
    ]);
    expect(experienceOf([
      'EXPERIENCE',
      'Stripe, San Francisco, CA', 'Engineering Manager, Payments      Aug 2021 - Present',
      'Twilio', 'Senior Software Engineer      Jun 2017 - Jul 2021',
    ].join('\n'))).toEqual([
      ['Engineering Manager, Payments', 'Stripe', 'San Francisco, CA'],
      ['Senior Software Engineer', 'Twilio', null],
    ]);
  });

  it('reads numbered job lists, table rows and keeps a qualifier in the title', () => {
    expect(experienceOf([
      'Teaching Experience',
      'School\tDesignation\tPeriod',
      'DAV Public School, Chennai\tPGT Mathematics\t2015 - Present',
      'WORK EXPERIENCE',
      '1. Front Office Associate, Taj Hotels, Bengaluru (Aug 2012 - till date)',
      'Assistant Manager - Finance',
      'Deloitte Haskins & Sells LLP | Mumbai | Aug 2010 - Jul 2012',
    ].join('\n'))).toEqual([
      ['PGT Mathematics', 'DAV Public School', 'Chennai'],
      ['Front Office Associate', 'Taj Hotels', 'Bengaluru'],
      ['Assistant Manager - Finance', 'Deloitte Haskins & Sells LLP', 'Mumbai'],
    ]);
  });

  it('records dates in a sortable form', () => {
    const document = buildResumeDocument('EXPERIENCE\nAnalyst, Initech\t06/2019 - 03/2023\nIntern, Hooli (Since 2023)');
    expect(parseExperience(document, findDateRanges(document, AS_OF), AS_OF)).toEqual([
      { title: 'Analyst', company: 'Initech', duration: '06/2019 - 03/2023', startDate: '2019-06', endDate: '2023-03' },
      expect.objectContaining({ title: 'Intern', company: 'Hooli', startDate: '2023', current: true }),
    ]);
  });
});

describe('education', () => {
  const educationOf = (text: string) => parseEducation(buildResumeDocument(normalizeResumeText(text)), AS_OF);

  it('names degrees in short form with field, institution, year and grade', () => {
    expect(educationOf([
      'EDUCATION',
      'MBA (Marketing) | Amity University, Noida | 2016 | 72%',
      'B.E. Computer Engineering, VJTI Mumbai      2023 - 2027 (Expected)      CGPA: 8.6/10',
      'Bachelor of Technology - BTech, Computer Science · (2013 - 2017)',
      'HSC, Ruia College, Mumbai      2019      91.2%',
      '12th - CBSE (2016)',
    ].join('\n'))).toEqual([
      { degree: 'MBA', field: 'Marketing', institution: 'Amity University, Noida', year: '2016', grade: '72%' },
      { degree: 'B.E.', field: 'Computer Engineering', institution: 'VJTI Mumbai', year: '2027 (expected)', grade: 'CGPA 8.6/10' },
      { degree: 'B.Tech', field: 'Computer Science', year: '2017' },
      { degree: 'HSC', institution: 'Ruia College, Mumbai', year: '2019', grade: '91.2%' },
      { degree: 'HSC', institution: 'CBSE', year: '2016' },
    ]);
  });

  it('finds the institution on the line above or below, and ignores certificates', () => {
    expect(educationOf('Education\nIndian Institute of Technology Delhi\tNew Delhi, India\nBachelor of Technology in Computer Science; CGPA: 8.9/10\tAug. 2018 - May 2022'))
      .toEqual([{ degree: 'B.Tech', field: 'Computer Science', institution: 'Indian Institute of Technology Delhi', year: '2022', grade: 'CGPA 8.9/10' }]);
    expect(educationOf('EDUCATION\nMBA (Human Resources)\nSymbiosis Institute of Business Management | 2016\nBBA\nOsmania University | 2014').map((entry) => entry.institution))
      .toEqual(['Symbiosis Institute of Business Management', 'Osmania University']);
    expect(educationOf('EDUCATION & CERTIFICATIONS\nDiploma in Mechanical Engineering, 2012\nNEBOSH International General Certificate, 2014'))
      .toEqual([{ degree: 'Diploma', field: 'Mechanical Engineering', year: '2012' }]);
  });

  it('takes the year from a date line below the degree and its college', () => {
    expect(educationOf('EDUCATION\nBA in Security Management\nSardar Patel University of Police, Security and Criminal Justice, Jodhpur\nJul 2010 - Apr 2013'))
      .toEqual([{ degree: 'B.A.', field: 'Security Management', institution: 'Sardar Patel University of Police, Security and Criminal Justice, Jodhpur', year: '2013' }]);
    // A date line that belongs to the next degree is not borrowed.
    expect(educationOf('EDUCATION\nMBA\nIIM Indore\nB.Com\n2014 - 2017').map((entry) => entry.year)).toEqual([undefined, '2017']);
  });
});

describe('section names in a left margin', () => {
  it('reads the jobs, degree and skills of a template with margin labels', async () => {
    const label = (y: number, text: string) => ({ x: 40, y, text, size: 11, bold: true });
    const body = (y: number, text: string, bold = false) => ({ x: 160, y, text, size: 10, bold });
    const parsed = await parseResume(pdf([
      { x: 40, y: 780, text: 'PRIYANKA DESHMUKH', size: 26, bold: true },
      { x: 40, y: 760, text: 'Chartered Accountant', size: 13 },
      label(730, 'CONTACT'), body(730, 'Phone', true), { x: 270, y: 730, text: 'Email', size: 10, bold: true },
      body(717, '+91-9822012345'), { x: 270, y: 717, text: 'priyanka.d@outlook.com', size: 10 },
      label(690, 'PROFILE'), body(690, 'Chartered accountant with 8 years of audit and tax experience.'),
      label(660, 'EMPLOYMENT'), body(660, 'Audit Manager | Deloitte, Pune', true),
      label(645, 'HISTORY'), body(645, 'Aug 2019 - Present'),
      body(630, '- Led statutory audits for six listed manufacturing clients.'),
      body(605, 'Senior Accountant | Tata Motors, Pune', true),
      body(590, 'Jun 2016 - Jul 2019'),
      body(575, '- Prepared monthly MIS packs for the CFO office.'),
      label(545, 'EDUCATION'), body(545, 'B.Com in Accounting', true),
      body(530, 'Savitribai Phule Pune University, Pune'),
      body(515, 'Jun 2013 - Apr 2016'),
      label(485, 'SKILLS'), body(485, 'Statutory Audit'), { x: 360, y: 485, text: 'GST Compliance', size: 10 },
      body(470, 'Tally ERP'), { x: 360, y: 470, text: 'SAP FICO', size: 10 },
    ]), 'margin.pdf', 'application/pdf');

    expect(parsed.name).toBe('Priyanka Deshmukh');
    expect(parsed.experience?.map((job) => [job.title, job.company, job.location, job.startDate, job.current ?? false])).toEqual([
      ['Audit Manager', 'Deloitte', 'Pune', '2019-08', true],
      ['Senior Accountant', 'Tata Motors', 'Pune', '2016-06', false],
    ]);
    expect(parsed.education).toEqual([
      { degree: 'B.Com', field: 'Accounting', institution: 'Savitribai Phule Pune University, Pune', year: '2016' },
    ]);
    expect(parsed.skills).toEqual(expect.arrayContaining(['Statutory Audit', 'GST Compliance', 'Tally ERP', 'SAP FICO']));
  });
});

describe('skills', () => {
  const skillsOf = (text: string) => extractSkills(buildResumeDocument(normalizeResumeText(text)));

  it("lists the skills section in the candidate's words, then skills used in descriptions", () => {
    expect(skillsOf([
      'EXPERIENCE',
      'Data Analyst, Zoho Corporation (2020 - Present)',
      '- Built dashboards in Power BI on a MongoDB and Kubernetes stack.',
      'SKILLS',
      'Languages: Java, Python, C/C++',
      'Tally ERP 9, SAP FICO, Advanced Excel',
    ].join('\n'))).toEqual(['Java', 'Python', 'C/C++', 'Tally ERP 9', 'SAP FICO', 'Advanced Excel', 'MongoDB', 'Kubernetes', 'Power BI']);
  });

  it('does not read company names, lower-case verbs or broader terms as skills', () => {
    const skills = skillsOf('SUMMARY\nI react quickly to customer escalations and excel at follow-ups.\nEXPERIENCE\nZoho Corporation | Jan 2020 - Present\n- Tuned PostgreSQL queries.');
    expect(skills).toEqual(['PostgreSQL']);
  });
});

/* ------------------------------------------------------------------ *
 * End to end
 * ------------------------------------------------------------------ */

describe('parseResumeExtraction', () => {
  it('parses a plain-text resume into contact details, history and confidence', () => {
    const parsed = parse([
      'SURESH BABU K',
      'Chennai | suresh.babu.k@gmail.com | 98401 23456',
      'OBJECTIVE',
      'Seeking a customer support role.',
      'EXPERIENCE',
      'Customer Support Executive, Teleperformance India, Chennai (Jan 2021 - Present)',
      'EDUCATION',
      'B.Sc. Computer Science, Loyola College, 2020 - 7.8 CGPA',
    ].join('\n'));
    expect(parsed).toMatchObject({
      parserVersion: RESUME_PARSER_VERSION,
      name: 'Suresh Babu K',
      email: 'suresh.babu.k@gmail.com',
      phone: '+91 98401 23456',
      summary: 'Seeking a customer support role.',
      confidence: { name: 'high', email: 'high', phone: 'high' },
      experience: [expect.objectContaining({ title: 'Customer Support Executive', company: 'Teleperformance India', location: 'Chennai', current: true })],
      education: [{ degree: 'B.Sc', field: 'Computer Science', institution: 'Loyola College', year: '2020', grade: '7.8 CGPA' }],
    });
    expect(parsed.experienceYears).toBeCloseTo(5.8, 1);
  });

  it('reads a PDF whose contact details exist only as links', async () => {
    const file = pdf([
      { x: 50, y: 780, text: 'Ishaan Malhotra', size: 22, bold: true },
      { x: 50, y: 760, text: 'Email Me      LinkedIn      +91 70123 45678' },
      { x: 50, y: 730, text: 'EXPERIENCE', size: 11, bold: true },
      { x: 50, y: 714, text: 'Product Manager @ CRED (2022 - Present)' },
    ], [{ rect: [50, 758, 95, 770], uri: 'mailto:ishaan.malhotra@gmail.com' }, { rect: [120, 758, 165, 770], uri: 'https://linkedin.com/in/ishaanm' }]);
    const parsed = await parseResume(file, 'cv.pdf', 'application/pdf');
    expect(parsed).toMatchObject({
      name: 'Ishaan Malhotra',
      email: 'ishaan.malhotra@gmail.com',
      phone: '+91 70123 45678',
      links: { linkedin: 'https://www.linkedin.com/in/ishaanm' },
      experience: [expect.objectContaining({ title: 'Product Manager', company: 'CRED' })],
    });
  });

  it('reports an unreadable file instead of guessing', async () => {
    const parsed = await parseResume(Buffer.from('%PDF-1.4 not really a pdf'), 'scan.pdf', 'application/pdf');
    expect(parsed).toMatchObject({ name: null, email: null, phone: null, skills: [] });
    expect(parsed.warnings?.[0]).toMatch(/could not be read|selectable text/);
    expect(parsed.rawTextPreview).toBe('');
  });
});
