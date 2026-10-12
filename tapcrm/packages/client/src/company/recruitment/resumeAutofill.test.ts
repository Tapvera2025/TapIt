import { describe, expect, it } from 'vitest';
import type { ParsedCandidateData } from '@tapcrm/contracts';
import {
  acceptSuggestion,
  applyParsedResume,
  clearAutofill,
  editField,
  EMPTY_AUTOFILL,
  formatYears,
  resumeHighlights,
  resumeNotes,
  safeHttpUrl,
} from './resumeAutofill.js';

function parsed(overrides: Partial<ParsedCandidateData> = {}): ParsedCandidateData {
  return {
    name: 'Sneha Patil',
    firstName: 'Sneha',
    lastName: 'Patil',
    email: 'sneha.patil@gmail.com',
    phone: '+91 98450 12345',
    skills: ['Figma', 'Adobe XD'],
    confidence: { name: 'high', email: 'high', phone: 'medium' },
    ...overrides,
  };
}

describe('filling the candidate form from a resume', () => {
  it('fills empty fields and records how sure the parser was', () => {
    const state = applyParsedResume(EMPTY_AUTOFILL, parsed());
    expect(state.values).toEqual({ firstName: 'Sneha', lastName: 'Patil', email: 'sneha.patil@gmail.com', phone: '+91 98450 12345' });
    expect(state.filled).toEqual({ firstName: 'high', lastName: 'high', email: 'high', phone: 'medium' });
    expect(state.suggestions).toEqual({});
  });

  it('never overwrites what HR typed, and offers the whole name instead of mixing names', () => {
    const typed = editField(editField(EMPTY_AUTOFILL, 'firstName', 'Snehal'), 'phone', '022 2680 1234');
    const state = applyParsedResume(typed, parsed());
    expect(state.values).toEqual({ firstName: 'Snehal', lastName: '', email: 'sneha.patil@gmail.com', phone: '022 2680 1234' });
    expect(state.suggestions).toEqual({ firstName: 'Sneha', lastName: 'Patil', phone: '+91 98450 12345' });
    expect(acceptSuggestion(state, 'firstName').values).toMatchObject({ firstName: 'Sneha', lastName: 'Patil', phone: '022 2680 1234' });
  });

  it('completes a name HR started the same way', () => {
    const typed = editField(EMPTY_AUTOFILL, 'firstName', 'sneha');
    expect(applyParsedResume(typed, parsed()).values).toMatchObject({ firstName: 'sneha', lastName: 'Patil' });
  });

  it('suggests, rather than fills, values the parser is unsure of', () => {
    const state = applyParsedResume(EMPTY_AUTOFILL, parsed({ confidence: { name: 'low', email: 'high', phone: 'low' } }));
    expect(state.values).toEqual({ firstName: '', lastName: '', email: 'sneha.patil@gmail.com', phone: '' });
    expect(state.suggestions).toEqual({ firstName: 'Sneha', lastName: 'Patil', phone: '+91 98450 12345' });
  });

  it("takes a resume's values back out when the resume is replaced or removed", () => {
    const first = applyParsedResume(editField(EMPTY_AUTOFILL, 'phone', '98200 45678'), parsed());
    const second = applyParsedResume(first, parsed({ name: 'Anil Menon', firstName: 'Anil', lastName: 'Menon', email: null, phone: null }));
    expect(second.values).toEqual({ firstName: 'Anil', lastName: 'Menon', email: '', phone: '98200 45678' });
    expect(clearAutofill(second).values).toEqual({ firstName: '', lastName: '', email: '', phone: '98200 45678' });
  });
});

describe('resume summaries', () => {
  const resume = parsed({
    experience: [{ title: 'Senior UI Designer', company: 'Zoho Corporation', duration: 'Jan 2023 - Present' }],
    education: [{ degree: 'B.Des', field: 'Interaction Design', institution: 'MIT Institute of Design', year: '2020' }],
    experienceYears: 6.25,
    links: { linkedin: 'https://www.linkedin.com/in/snehapatil', portfolio: 'javascript:alert(1)' },
  });

  it('shows the latest role, experience, skills and only safe links', () => {
    expect(resumeHighlights(resume)).toEqual({
      role: 'Senior UI Designer at Zoho Corporation',
      experienceYears: 6.25,
      skills: ['Figma', 'Adobe XD'],
      links: [{ label: 'LinkedIn', href: 'https://www.linkedin.com/in/snehapatil' }],
    });
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
  });

  it('writes screening notes from the parsed resume', () => {
    expect(resumeNotes(resume)).toBe([
      'Latest role: Senior UI Designer at Zoho Corporation (Jan 2023 - Present)',
      'Experience: 6.3 yrs',
      'Education: B.Des, Interaction Design · MIT Institute of Design · 2020',
      'Skills: Figma, Adobe XD',
    ].join('\n'));
    expect(formatYears(0.4)).toBe('5 months');
  });
});
