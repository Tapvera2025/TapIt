import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import * as repo from './repository.js';

/**
 * The employment window (§8.6): the joining and the leaving date on the
 * employee record, both inclusive (migration 0060). Only employees have one;
 * super-admin, client and service accounts never have attendance days.
 *
 * Two questions, kept apart because one is about history and one about now:
 *
 *   - `isEmployedOn` — was the person employed on that date? The dates alone
 *     answer, so a day is judged the same whenever it is judged: its facts,
 *     its calculation, a device punch replayed a month later. A missing date
 *     is no bound on that side.
 *   - `opensDaysOn` — should day-open build that date for them now? Employed
 *     on it, and, with no leaving date recorded, an account still in use
 *     (active, or only locked: a login lock does not end employment). A
 *     deactivated account without a leaving date gets no new days; the days
 *     it has keep their answer.
 *
 * `repository.opensDaysSql` applies the second rule in SQL.
 */
export interface EmploymentSubject {
  readonly id: string;
  readonly accountType: string;
  readonly status: string;
  readonly joinedOn: DateOnly | null;
  readonly leftOn: DateOnly | null;
}

export function isEmployedOn(person: EmploymentSubject, date: DateOnly): boolean {
  if (person.accountType !== 'employee') return false;
  if (person.joinedOn !== null && date < person.joinedOn) return false;
  return person.leftOn === null || date <= person.leftOn;
}

export function opensDaysOn(person: EmploymentSubject, date: DateOnly): boolean {
  if (!isEmployedOn(person, date)) return false;
  return (
    person.leftOn !== null || person.status === 'active' || person.status === 'locked'
  );
}

/**
 * The same rule for a person by id, for callers outside attendance (the
 * biometric pipeline asks before a punch becomes attendance). A person who is
 * not in the tenant is not employed.
 */
export async function employedOn(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<boolean> {
  const person = await repo.findAppUser(tx, userId);
  return person !== null && isEmployedOn(person, date);
}
