import { describe, expect, it } from 'vitest';
import {
  canReassignLead,
  canTransferSourcingCredit,
  hasFormProblems,
  validateReassignForm,
} from './reassign-helpers.js';

describe('canReassignLead', () => {
  it('allows super admin', () => {
    expect(canReassignLead({ accountType: 'super-admin' })).toBe(true);
  });
  it('allows sales HOD-flavoured positions', () => {
    expect(canReassignLead({ accountType: 'employee', departmentCode: 'sales', positionCode: 'sales-hod' })).toBe(true);
    expect(canReassignLead({ accountType: 'employee', departmentCode: 'sales', positionCode: 'sales-manager' })).toBe(true);
    expect(canReassignLead({ accountType: 'employee', departmentCode: 'sales', positionCode: 'sales-head' })).toBe(true);
  });
  it('denies sales agents and sales supervisors', () => {
    expect(canReassignLead({ accountType: 'employee', departmentCode: 'sales', positionCode: 'sales-agent' })).toBe(false);
    expect(canReassignLead({ accountType: 'employee', departmentCode: 'sales', positionCode: 'sales-supervisor' })).toBe(false);
  });
  it('denies non-sales HODs', () => {
    expect(canReassignLead({ accountType: 'employee', departmentCode: 'hr', positionCode: 'hr-hod' })).toBe(false);
  });
});

describe('canTransferSourcingCredit', () => {
  it('is only true for super admin', () => {
    expect(canTransferSourcingCredit({ accountType: 'super-admin' })).toBe(true);
    expect(canTransferSourcingCredit({ accountType: 'employee', departmentCode: 'sales', positionCode: 'sales-hod' })).toBe(false);
  });
});

describe('validateReassignForm', () => {
  const base = {
    newOwnerId: 'target-user',
    reason: 'Rebalancing load on the pool',
    transferPendingCallbacks: true,
    transferScheduledActivities: true,
    transferSourcingCredit: false,
  };
  it('passes a complete form', () => {
    expect(hasFormProblems(validateReassignForm(base))).toBe(false);
  });
  it('requires a new owner', () => {
    expect(validateReassignForm({ ...base, newOwnerId: '' }).newOwnerId).toBeDefined();
  });
  it('requires a reason of 5+ characters', () => {
    expect(validateReassignForm({ ...base, reason: 'why?' }).reason).toBeDefined();
  });
  it('caps reason length at 500', () => {
    expect(validateReassignForm({ ...base, reason: 'x'.repeat(501) }).reason).toBeDefined();
  });
});
