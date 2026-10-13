export interface SeededStepDefinition {
  code: string;
  title: string;
  description: string;
  ownerRole: 'hr' | 'it' | 'manager' | 'facilities' | 'finance';
  daysDueOffset: number;
}

/**
 * PRD §9.2 ON-1 Seeded Onboarding Steps
 *
 * 1. Issue credentials
 * 2. Assign position/team/manager
 * 3. Assign shift
 * 4. Map biometric PIN
 * 5. Set break policy
 * 6. Collect documents
 * 7. Issue assets
 * 8. Manager introduction
 * 9. Set probation review date
 */
export const SEEDED_ONBOARDING_STEPS: readonly SeededStepDefinition[] = [
  {
    code: 'issue_credentials',
    title: 'Issue credentials',
    description: 'Create system access, provision initial credentials and ensure login is verified.',
    ownerRole: 'it',
    daysDueOffset: 1,
  },
  {
    code: 'assign_placement',
    title: 'Assign position/team/manager',
    description: 'Verify and confirm department, position, team, and direct reporting lines.',
    ownerRole: 'hr',
    daysDueOffset: 1,
  },
  {
    code: 'assign_shift',
    title: 'Assign shift',
    description: 'Assign shift schedule template and effective start date.',
    ownerRole: 'hr',
    daysDueOffset: 2,
  },
  {
    code: 'map_biometric_pin',
    title: 'Map biometric PIN',
    description: 'Enroll biometric credentials and set physical/device attendance PIN.',
    ownerRole: 'it',
    daysDueOffset: 2,
  },
  {
    code: 'set_break_policy',
    title: 'Set break policy',
    description: 'Assign applicable break schedule and meal window rules.',
    ownerRole: 'hr',
    daysDueOffset: 3,
  },
  {
    code: 'collect_documents',
    title: 'Collect documents',
    description: 'Collect government ID, educational certificates, and employment history for verification review.',
    ownerRole: 'hr',
    daysDueOffset: 5,
  },
  {
    code: 'issue_assets',
    title: 'Issue assets',
    description: 'Hand over workstation, laptop, ID badge, and access keycards.',
    ownerRole: 'facilities',
    daysDueOffset: 3,
  },
  {
    code: 'manager_intro',
    title: 'Manager introduction',
    description: 'Conduct initial team orientation, welcome sync, and role expectation walkthrough.',
    ownerRole: 'manager',
    daysDueOffset: 3,
  },
  {
    code: 'set_probation_review',
    title: 'Set probation review date',
    description: 'Schedule 30-day and 90-day probation review milestone meetings.',
    ownerRole: 'hr',
    daysDueOffset: 7,
  },
] as const;
