/**
 * The attendance façade — the only file other modules may import (MB-1, §4).
 *
 * Synchronous, and every function takes the caller's transaction (MB-2, TX-5).
 * Callers: live-status (step 4), biometric (step 5), leave (step 6), payroll.
 * Step 3a provides the ledger half: appending and retiring events, and the two
 * questions every caller asks — which day owns an event, and which day a
 * person is in. Step 3b adds range recalculation, which shifts and holidays
 * reach through their outbox events rather than by calling it (§4). Step 3c
 * adds `openDay` and the overlay seam leave (step 6) and break-management
 * (step 8) call. Step 5 adds `replaceDeviceEvent`, the person's lock and the
 * employment question for the biometric pipeline.
 */
export {
  appendEvent,
  attributeEvent,
  currentDayFor,
  replaceDeviceEvent,
  retireEvent,
  type AppendEventInput,
  type AppendEventResult,
  type PunchLocation,
  type ReplaceDeviceEventResult,
  type ReplacementRefusal,
  type RetireResult,
} from './ledger.js';
export {
  presenceProjector,
  registerPresenceProjector,
  breakPolicyResolver,
  registerBreakPolicyResolver,
  __resetBreakPolicyResolver,
  type BreakPolicySnapshot,
  type AttendanceBreakPolicyResolver,
} from './ports.js';
/**
 * D24 — the person's lock. A caller that reads its own rows about the person
 * before appending (biometric duplicate bursts) takes it first; the ledger
 * takes it again, which is free inside the same transaction.
 */
export { lockPerson } from './repository.js';
/** A punch's client event id already recorded: a retry, to be answered, not refused. */
export { findClientEvent } from './repository.js';
export { overlaysForDay, type OverlayForDayRow } from './repository.js';
export { employedOn } from './employment.js';
export { requestRecalculation } from './recalculate.js';
export { ATTENDANCE_EVENTS, type RecalcRequested, type DayChanged, type PayrollBlockerChanged } from './events.js';
export { openDay } from './day-open.js';
export {
  applyOverlay,
  removeOverlays,
  removeOverlayForDate,
  type OverlayInput,
  type OverlaySourceKind,
} from './overlays.js';
export {
  listActiveUsersWithRecordFor,
  loadDaySnapshot,
  type DaySnapshot,
} from './detail.js';
export {
  breakEvaluationCandidates,
  earliestStaleBreakDay,
  loadBreakDay,
  setBreaksEvaluatedVersion,
  invalidateBreakEvaluations,
  type BreakEvaluationCandidate,
  type BreakDayRecord,
} from './break-evaluation.js';
export {
  snapshotPeriod,
  openItems,
  type AttendanceDaySnapshot,
  type MissingDay,
  type PeriodSnapshot,
  type OpenItem,
  type OpenItemsOptions,
} from './payroll-snapshot.js';
