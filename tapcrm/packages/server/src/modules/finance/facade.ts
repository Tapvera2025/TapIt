/** Public cross-module boundary for Finance.
 *
 * Source modules import this file instead of reaching into accounting's
 * implementation details.
 */
export { postSourceJournalTx } from './accounting/facade.js';
export type {
  AccountingPostingInput,
  AccountingPostingLine,
  AccountingPostingResult,
} from './accounting/facade.js';
