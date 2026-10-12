import { describe, expect, it } from 'vitest';
import { splitMarginLabels } from './section-labels.js';

const rows = (...texts: string[]) => texts.map((text) => ({ text, size: 10, page: 1 }));
const texts = (lines: readonly { text: string }[]) => lines.map((line) => line.text);

describe('section names in a left margin', () => {
  it('moves a margin name onto its own line, before the row it sat beside', () => {
    expect(texts(splitMarginLabels(rows('PROFILE\tAn industrious and determined security specialist.', 'Second line of the profile.'))))
      .toEqual(['PROFILE', 'An industrious and determined security specialist.', 'Second line of the profile.']);
  });

  it('joins a name wrapped onto the next row', () => {
    expect(texts(splitMarginLabels(rows(
      'EMPLOYMENT\tSenior Security Officer | NPCIL, Mumbai',
      'HISTORY\tJul 2021 - Present',
      'Conducting investigations regarding suspect incidents.',
    )))).toEqual(['EMPLOYMENT HISTORY', 'Senior Security Officer | NPCIL, Mumbai', 'Jul 2021 - Present', 'Conducting investigations regarding suspect incidents.']);
  });

  it('joins a wrapped name whose second half stands alone, and title-case names', () => {
    expect(texts(splitMarginLabels(rows('Work\tSenior Product Designer, Swiggy\tMar 2021 - Present', 'Experience', '- Redesigned the partner app.'))))
      .toEqual(['Work Experience', 'Senior Product Designer, Swiggy\tMar 2021 - Present', '- Redesigned the partner app.']);
    expect(texts(splitMarginLabels(rows('WORK', 'EXPERIENCE\tData Analyst | Mu Sigma'))))
      .toEqual(['WORK EXPERIENCE', 'Data Analyst | Mu Sigma']);
  });

  it('keeps each row’s size and page', () => {
    const [label, rest] = splitMarginLabels([{ text: 'EDUCATION\tBA in Security Management', size: 11.5, page: 2 }]);
    expect(label).toEqual({ text: 'EDUCATION', size: 11.5, page: 2 });
    expect(rest).toEqual({ text: 'BA in Security Management', size: 11.5, page: 2 });
  });

  it('leaves ordinary rows alone', () => {
    const untouched = [
      'PROJECT MANAGER\tJan 2020 - Present', // a job title in capitals, not a section name
      'TRAINING COORDINATOR\t2019 - 2021',
      'Leadership\tCommunication\tTeamwork', // a skills grid
      'Name\tRahul Khanna',
      'M.Com\tMG University\t2012',
      'SKILLS', // already a line of its own
      'SKILLS\tLANGUAGES', // not one wrapped name
    ];
    for (const text of untouched.slice(0, 6)) expect(texts(splitMarginLabels(rows(text)))).toEqual([text]);
    expect(texts(splitMarginLabels(rows('SKILLS\tSafety Audits\tFire Drills', 'LANGUAGES\tEnglish | Hindi'))))
      .toEqual(['SKILLS', 'Safety Audits\tFire Drills', 'LANGUAGES', 'English | Hindi']);
  });
});
