import { describe, expect, it } from 'vitest';
import { analyzeRows, buildPreview, contactKeys, resolveAssignee } from './dry-run.js';
import { distribute } from './assign.js';
import type { ImportSettings } from './types.js';

const headers = ['Client Name', 'Business Name', 'Owner Name', 'Number', 'Assigned To'];
const settings: ImportSettings = {
  name: 'Expo list',
  columnMapping: { '0': 'contactName', '1': 'companyName', '2': 'ownerName', '3': 'phone', '4': 'assignedTo' },
  leadSourceId: null,
  campaignId: null,
  defaultCountryCode: '91',
  extraColumnsToNotes: true,
  assigneeMapping: {},
};
const employees = [
  { id: 'u-rahul', fullName: 'Rahul Verma', email: 'rahul@acme.in' },
  { id: 'u-priya', fullName: 'Priya Nair', email: 'priya@acme.in' },
];

const rows = [
  { rowNumber: 1, cells: ['Amit Shah', 'Shah Traders', 'Amit Shah', '98765 43210', 'Rahul'] },
  { rowNumber: 2, cells: ['Neha', 'Neha Boutique', 'Neha Gupta', '+91 91234-56789', 'priya@acme.in'] },
  { rowNumber: 3, cells: ['Repeat', 'Shah Traders', '', '9876543210', 'Rahul'] },
  { rowNumber: 4, cells: ['No number', 'Ghost Co', '', '', 'Rahul'] },
  { rowNumber: 5, cells: ['Bad number', 'Short Co', '', '12345', 'Sunil'] },
  { rowNumber: 6, cells: ['Known', 'Old Co', '', '9000000001', 'Sunil'] },
];

describe('lead import dry run', () => {
  const analyzed = analyzeRows(headers, rows, settings);

  it('reads each row the way the import will', () => {
    expect(analyzed.map((row) => row.status)).toEqual(['ready', 'ready', 'duplicate_in_file', 'missing_contact', 'invalid_phone_format', 'ready']);
    expect(analyzed[0]!.fields.phone).toEqual({ ok: true, e164: '+919876543210', others: [] });
    expect(analyzed[1]!.fields.notes).toBe('Business owner: Neha Gupta');
    expect(analyzed[0]!.fields.notes).toBeNull();
  });

  it('collects the phones worth looking up in the CRM', () => {
    expect(contactKeys(analyzed)).toEqual({ phones: ['+919876543210', '+919123456789', '+919000000001'], emails: [] });
  });

  it('counts leads already in the CRM and who each lead will go to', () => {
    const preview = buildPreview(analyzed, [{ phone: '+919000000001', email: null, leadNumber: '42', ownerName: 'Old Owner' }], settings, employees);
    expect(preview).toMatchObject({
      total: 6,
      ready: 2,
      alreadyInCrm: 1,
      duplicateInFile: 1,
      missingContact: 1,
      invalidPhone: 1,
      willBeAssigned: 2,
      assigneeColumn: true,
    });
    expect(preview.problemRows.find((row) => row.rowNumber === 6)).toMatchObject({ status: 'already_in_crm', existingLeadNumber: '42', existingOwnerName: 'Old Owner' });
    expect(preview.assignees.map((entry) => [entry.value, entry.employeeName, entry.rows, entry.match])).toEqual([
      ['Rahul', 'Rahul Verma', 1, 'auto'],
      ['priya@acme.in', 'Priya Nair', 1, 'auto'],
    ]);
  });

  it('lets the person importing overrule or drop a match', () => {
    expect(resolveAssignee('Sunil', { sunil: 'u-priya' }, employees)).toEqual({ employeeId: 'u-priya', employeeName: 'Priya Nair', match: 'manual' });
    expect(resolveAssignee('Rahul', { rahul: null }, employees)).toEqual({ employeeId: null, employeeName: null, match: 'none' });
    expect(resolveAssignee('Sunil', {}, employees).match).toBe('none');
  });

  it('splits leads evenly in the order people were picked', () => {
    const groups = distribute(['a', 'b', 'c', 'd', 'e'], ['p1', 'p2']);
    expect(groups.get('p1')).toEqual(['a', 'c', 'e']);
    expect(groups.get('p2')).toEqual(['b', 'd']);
  });
});
