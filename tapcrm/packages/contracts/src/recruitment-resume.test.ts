import { describe, expect, it } from 'vitest';
import { splitPersonName } from './recruitment-resume.js';

describe('splitPersonName', () => {
  it('puts the first word in First Name and the rest, in order, in Last Name', () => {
    expect(splitPersonName('Rohit Kumar Verma')).toEqual({ firstName: 'Rohit', lastName: 'Kumar Verma' });
    expect(splitPersonName('Mohammed Abdul Rahman')).toEqual({ firstName: 'Mohammed', lastName: 'Abdul Rahman' });
    expect(splitPersonName('Ana de Souza')).toEqual({ firstName: 'Ana', lastName: 'de Souza' });
  });

  it('never uses initials as the first name, wherever they stand', () => {
    expect(splitPersonName('K. S. Raghavan')).toEqual({ firstName: 'Raghavan', lastName: 'K. S.' });
    expect(splitPersonName('Suresh Babu K')).toEqual({ firstName: 'Suresh', lastName: 'Babu K' });
    expect(splitPersonName('Raghavan KS')).toEqual({ firstName: 'Raghavan', lastName: 'KS' });
    expect(splitPersonName('Priyanka M. Desai')).toEqual({ firstName: 'Priyanka', lastName: 'M. Desai' });
  });

  it('keeps a two-letter name that has a vowel, and handles one word', () => {
    expect(splitPersonName('Li Wei')).toEqual({ firstName: 'Li', lastName: 'Wei' });
    expect(splitPersonName('Madhavan')).toEqual({ firstName: 'Madhavan', lastName: '' });
    expect(splitPersonName('  ')).toEqual({ firstName: '', lastName: '' });
  });
});
