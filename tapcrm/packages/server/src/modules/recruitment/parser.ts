import type {
  ParsedResumeData,
  ParsedResumeEducation,
  ParsedResumeExperience,
} from './types.js';

const SKILL_KEYWORDS: readonly string[] = [
  'javascript', 'typescript', 'react', 'react native', 'angular', 'vue', 'next.js', 'node.js',
  'express', 'nest.js', 'python', 'django', 'fastapi', 'flask', 'java', 'spring', 'spring boot',
  'kotlin', 'swift', 'flutter', 'dart', 'go', 'golang', 'rust', 'c++', 'c#', '.net', 'php',
  'laravel', 'ruby', 'rails', 'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
  'docker', 'kubernetes', 'aws', 'gcp', 'azure', 'git', 'github', 'gitlab', 'ci/cd', 'linux',
  'graphql', 'rest api', 'microservices', 'html', 'css', 'tailwind', 'bootstrap', 'sass',
  'terraform', 'kafka', 'rabbitmq', 'vitest', 'jest', 'cypress', 'selenium', 'agile', 'scrum',
];

const DEGREE_PATTERNS = [
  /\b(?:b\.?tech|b\.?e\.?|bachelor(?:'s)? of (?:technology|engineering|science|arts|computer application))\b/i,
  /\b(?:m\.?tech|m\.?e\.?|master(?:'s)? of (?:technology|engineering|science|arts|computer application|business administration)|mba|mca|ms)\b/i,
  /\b(?:ph\.?d|doctorate)\b/i,
  /\b(?:diploma|bca|bsc|bcom|ba)\b/i,
];

/**
 * Extracts plain text chunks from PDF binary content.
 */
function extractPdfText(buffer: Buffer): string {
  const textChunks: string[] = [];
  const raw = buffer.toString('binary');

  // 1. Matches text inside parentheses in Tj operators: (text) Tj
  const tjRegex = /\(([^)]+)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tjRegex.exec(raw)) !== null) {
    if (match[1]) textChunks.push(cleanPdfString(match[1]));
  }

  // 2. Matches text arrays in TJ operators: [(t1) 10 (t2)] TJ
  const tjArrayRegex = /\[([^\]]+)\]\s*TJ/g;
  while ((match = tjArrayRegex.exec(raw)) !== null) {
    const inner = match[1] ?? '';
    const innerMatches = inner.match(/\(([^)]+)\)/g);
    if (innerMatches) {
      const line = innerMatches.map((m: string) => cleanPdfString(m.slice(1, -1))).join(' ');
      textChunks.push(line);
    }
  }

  if (textChunks.length === 0) {
    // Fallback: extract contiguous printable ASCII / UTF-8 strings
    const printableMatches = raw.match(/[\x20-\x7E]{4,}/g);
    if (printableMatches) {
      return printableMatches
        .filter((s) => !s.startsWith('/') && !s.includes('obj') && !s.includes('endobj'))
        .join(' ');
    }
  }

  return textChunks.join(' ');
}

function cleanPdfString(str: string): string {
  return str
    .replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .trim();
}

/**
 * Extracts text from DOCX (simple XML tag removal) or raw text.
 */
function extractDocxOrPlainText(buffer: Buffer): string {
  const content = buffer.toString('utf8');
  if (content.includes('<?xml') || content.includes('<w:p')) {
    // Strip XML tags
    return content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return content;
}

/**
 * Extracts raw textual representation from any resume buffer.
 */
export function extractTextFromResume(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): string {
  try {
    const lowerName = filename.toLowerCase();
    const isPdf = mimeType.includes('pdf') || lowerName.endsWith('.pdf');
    if (isPdf) {
      return extractPdfText(buffer);
    }
    return extractDocxOrPlainText(buffer);
  } catch {
    return buffer.toString('utf8', 0, Math.min(buffer.length, 10000));
  }
}

/**
 * Core heuristic resume parser that extracts structured candidate information.
 */
export function parseResume(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): ParsedResumeData {
  try {
    const rawText = extractTextFromResume(buffer, filename, mimeType);
    const cleanedText = rawText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
    const lines = cleanedText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // 1. Email extraction
    const emailMatch = cleanedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch ? emailMatch[0].toLowerCase() : null;

    // 2. Phone extraction (Indian & International formats)
    const phoneMatch = cleanedText.match(
      /(?:\+?(\d{1,3}))?[-.\s]?(?:\(?\d{2,5}\)?)?[-.\s]?\d{3,5}[-.\s]?\d{4}/,
    );
    const phone = phoneMatch ? phoneMatch[0].trim() : null;

    // 3. Name heuristic (first 5 lines, 2 to 4 capitalized words)
    let extractedName: string | null = null;
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i]!;
      if (
        !line.includes('@') &&
        !line.includes('http') &&
        !line.match(/\d{5,}/) &&
        line.length >= 3 &&
        line.length <= 50 &&
        /^[A-Za-z]+(?: [A-Za-z]+){1,3}$/.test(line)
      ) {
        extractedName = line;
        break;
      }
    }

    // 4. Skills extraction
    const lowerText = cleanedText.toLowerCase();
    const foundSkills = new Set<string>();
    for (const skill of SKILL_KEYWORDS) {
      const regex = new RegExp(`\\b${skill.replace(/[.+*?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lowerText)) {
        foundSkills.add(skill);
      }
    }

    // 5. Education extraction
    const education: ParsedResumeEducation[] = [];
    for (const line of lines) {
      for (const pattern of DEGREE_PATTERNS) {
        const degreeMatch = line.match(pattern);
        if (degreeMatch) {
          const yearMatch = line.match(/\b(19\d{2}|20\d{2})\b/);
          education.push({
            degree: degreeMatch[0],
            institution: line.slice(0, 100),
            ...(yearMatch ? { year: yearMatch[0] } : {}),
          });
          break;
        }
      }
      if (education.length >= 3) break;
    }

    // 6. Experience extraction (look for job title keywords)
    const experience: ParsedResumeExperience[] = [];
    const titleKeywords = [
      'software engineer', 'software developer', 'frontend developer', 'backend developer',
      'full stack developer', 'devops engineer', 'product manager', 'intern', 'consultant',
      'team lead', 'technical lead', 'engineering manager', 'data engineer', 'analyst',
    ];
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      for (const tk of titleKeywords) {
        if (lowerLine.includes(tk)) {
          const yearMatch = line.match(/\b(19\d{2}|20\d{2})\s*(?:-|to)\s*(?:present|\d{4})\b/i);
          experience.push({
            title: line.slice(0, 80),
            ...(yearMatch ? { duration: yearMatch[0] } : {}),
          });
          break;
        }
      }
      if (experience.length >= 4) break;
    }

    // 7. Summary / preview
    const preview = cleanedText.slice(0, 500);

    return {
      name: extractedName,
      email,
      phone,
      skills: Array.from(foundSkills),
      education: education.length > 0 ? education : undefined,
      experience: experience.length > 0 ? experience : undefined,
      summary: preview.length > 0 ? preview : null,
      rawTextPreview: cleanedText.slice(0, 1000),
    };
  } catch {
    return {
      rawTextPreview: buffer.toString('utf8', 0, 500),
    };
  }
}
