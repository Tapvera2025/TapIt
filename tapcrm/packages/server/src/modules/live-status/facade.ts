/**
 * The live-status façade — the only file other modules may import (MB-1, §4).
 *
 * Exposes the live board projection reader and display grouping helper
 * for downstream composition (e.g. Employee 360 Work / Live Status).
 */
export { readRow, type Row, type BoardRow } from './repository.js';
export { liveBoardGroup, type LiveBoardGroup } from './group.js';
