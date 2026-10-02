import type { Action } from './registry.generated.js';

/**
 * Plain-language names for every permission ("power"), for the people who
 * hand them out: a company owner or HR manager, not a developer. The registry
 * (registry.generated.ts) stays the authority for what each action does; this
 * file only says it in everyday words.
 *
 * `title` completes "People in this position can…" in a few words.
 * `description` adds one sentence of what that means in practice.
 *
 * Every registered action must have an entry — the compiler enforces it via
 * the Record type, so a new action cannot slip into the policy editor as a
 * bare technical name.
 */
export interface ActionCopy {
  readonly title: string;
  readonly description: string;
}

export const ACTION_COPY: Readonly<Record<Action, ActionCopy>> = {
  // Conversations
  'chat:manage-groups': { title: 'Manage internal groups', description: 'Create groups and manage their members and settings.' },
  'chat:send': { title: 'Send messages', description: 'Send messages and respond in conversations you can access.' },
  'chat:view': { title: 'See conversations', description: 'Read conversations and messages available to you.' },
  // Access & position changes
  'access:decide-role-change': { title: 'Approve position changes', description: "Approve or reject HR's requests to move someone to a different position." },
  'access:delegate': { title: 'Hand out extra powers', description: 'Give a person an extra power for a while, on top of what their position allows.' },
  'access:request-role-change': { title: 'Request position changes', description: 'Ask the Super Admin to move an employee to a different position.' },
  'access:view': { title: 'See who can do what', description: 'Open the Access Explorer to check what a person or position is allowed to do.' },

  // Accounting
  'accounting:close-period': { title: 'Close an accounting month', description: "Lock a month's books so nothing more can be posted to it." },
  'accounting:manage-accounts': { title: 'Manage ledger accounts', description: 'Add and change the accounts in the chart of accounts.' },
  'accounting:post-journal': { title: 'Post journal entries', description: 'Record manual entries in the ledger.' },
  'accounting:reopen-period': { title: 'Reopen a closed month', description: 'Unlock a closed month so it can be corrected.' },
  'accounting:tax-export': { title: 'Export tax data', description: 'Download the figures needed for tax filings.' },
  'accounting:view-ledger': { title: 'See the ledger', description: 'See journal entries and account balances.' },
  'accounting:view-statements': { title: 'See financial statements', description: 'See the profit and loss, balance sheet and similar statements.' },

  // Clients (accounts)
  'accounts:manage-ownership': { title: 'Change account owners', description: 'Decide which salesperson looks after a client account.' },
  'accounts:view-revenue': { title: 'See account revenue', description: 'See how much each client account has brought in.' },

  // Approvals
  'approvals:decide': { title: 'Approve or reject requests', description: 'Decide on approval requests sent to them, such as discounts or exceptions.' },
  'approvals:delegate': { title: 'Pass approvals to someone else', description: 'Let another person decide their approvals while they are away.' },

  // Attendance
  'attendance:correct': { title: 'Approve attendance corrections', description: "Approve or reject requests to fix punches, and correct a day's attendance." },
  'attendance:export': { title: 'Export attendance', description: 'Download attendance records as a spreadsheet.' },
  'attendance:raise-correction': { title: "Correct other people's attendance", description: "Start a correction for another employee's day. It still needs approval." },
  'attendance:request-correction': { title: 'Ask to fix their attendance', description: 'Request a correction when a punch is missing or wrong.' },
  'attendance:view': { title: 'See attendance', description: 'See attendance days, working hours and punches.' },
  'attendance:view-live': { title: "See who's working now", description: 'See the live board of who is in, on a break or finished for the day.' },

  // Audit log
  'audit:export': { title: 'Export the audit log', description: 'Download the record of who changed what.' },
  'audit:manage-holds': { title: 'Put records on legal hold', description: 'Stop records from being deleted while a legal hold applies.' },
  'audit:view': { title: 'See the audit log', description: 'See who changed what, and when.' },

  // Billing terms
  'billing:set-terms': { title: 'Set billing terms', description: 'Set payment terms and credit limits for clients.' },
  'billing:view-terms': { title: 'See billing terms', description: "See clients' payment terms and credit limits." },

  // Attendance machines
  'biometric:manage': { title: 'Manage attendance machines', description: 'Register biometric devices, match employee PINs and review punches from the machines.' },

  // Breaks
  'breaks:explain': { title: 'Explain their long breaks', description: 'Add a note when one of their breaks went over the limit.' },
  'breaks:manage-policy': { title: 'Set break rules', description: 'Decide how long breaks can be and what happens when someone goes over.' },
  'breaks:review-breach': { title: 'Review long breaks', description: 'Confirm or waive breaks that went over the limit, and read the explanations.' },
  'breaks:view': { title: 'See breaks', description: 'See break times and breaks that went over the limit.' },

  // Callbacks
  'callbacks:create': { title: 'Schedule callbacks', description: 'Schedule a call back to a lead or client.' },
  'callbacks:edit': { title: 'Change callbacks', description: 'Reschedule or update scheduled callbacks.' },
  'callbacks:view': { title: 'See callbacks', description: 'See scheduled callbacks.' },

  // Delivery (change requests)
  'changes:assign': { title: 'Assign change requests', description: "Decide who works on a client's change request." },
  'changes:classify': { title: 'Classify change requests', description: "Mark a client's change request as included or chargeable." },

  // Clients
  'clients:manage': { title: 'Manage clients', description: 'Add clients and edit their details.' },
  'clients:manage-requests': { title: 'Handle client requests', description: 'Respond to requests clients raise.' },
  'clients:view': { title: 'See clients', description: 'See client records.' },

  // Project conversations
  'communication:client-thread': { title: 'Message clients on projects', description: 'Post in project conversations that clients can read.' },
  'communication:view': { title: 'Read project conversations', description: 'Read the message threads on projects.' },

  // Deals
  'deals:allow-custom-terms': { title: 'Allow custom deal terms', description: 'Let a deal go ahead with non-standard terms.' },
  'deals:approve': { title: 'Approve deals', description: 'Approve deals that need sign-off, such as large discounts.' },
  'deals:approve-contract': { title: 'Approve contracts', description: 'Approve the contract for a deal.' },
  'deals:confirm-payment': { title: 'Confirm deal payments', description: "Mark a deal's advance payment as received." },
  'deals:create': { title: 'Create deals', description: 'Start a new deal.' },
  'deals:edit': { title: 'Edit deals', description: 'Change the details of a deal.' },
  'deals:forecast': { title: 'Forecast sales', description: 'See and adjust the sales forecast.' },
  'deals:record-win': { title: 'Mark deals as won', description: 'Record that a deal was won.' },
  'deals:view': { title: 'See deals', description: 'See deals and their progress.' },
  'deals:view-commercials': { title: 'See deal prices and margins', description: 'See pricing, discounts and margins on deals.' },

  // Delivery
  'delivery:approve': { title: 'Approve deliverables', description: 'Approve work before it goes to the client.' },
  'delivery:share': { title: 'Share deliverables with clients', description: 'Send finished work to the client.' },
  'delivery:signoff': { title: 'Record client sign-off', description: 'Record that the client accepted the delivery.' },
  'delivery:view': { title: 'See deliveries', description: 'See deliverables and their status.' },

  // Documents
  'documents:manage-templates': { title: 'Manage document templates', description: 'Create and edit templates for offers, contracts and letters.' },
  'documents:share-client': { title: 'Share documents with clients', description: 'Make a document visible to a client.' },
  'documents:upload': { title: 'Upload documents', description: 'Add documents and files.' },
  'documents:view': { title: 'See documents', description: 'Open documents and files.' },

  // Project handoff
  'handoff:confirm': { title: 'Accept project handoffs', description: 'Accept a project brief handed over from sales.' },
  'handoff:create': { title: 'Write project briefs', description: 'Write the brief that hands a won deal to the delivery team.' },
  'handoff:review': { title: 'Review project briefs', description: 'Check a project brief before it is accepted.' },
  'handoff:view': { title: 'See project briefs', description: 'See project briefs and their status.' },

  // Handovers
  'handovers:initiate': { title: 'Hand over leads', description: 'Pass a lead or client to another person.' },
  'handovers:receive': { title: 'Accept handovers', description: 'Accept leads or clients handed over to them.' },
  'handovers:record-disposition': { title: 'Record handover outcomes', description: 'Record what happened after a handover.' },
  'handovers:view': { title: 'See handovers', description: 'See handovers and their status.' },

  // Holidays
  'holidays:manage': { title: 'Manage holidays', description: "Add and change the company's holiday calendar." },
  'holidays:view': { title: 'See holidays', description: 'See the holiday calendar.' },

  // Sign-in & accounts
  'identity:manage-geofence': { title: 'Manage sign-in locations', description: 'Set the office locations people may sign in or punch from.' },
  'identity:unlock-account': { title: 'Unlock accounts', description: 'Unlock an employee who is locked out after too many wrong passwords.' },

  // Invoicing
  'invoicing:create': { title: 'Draft invoices', description: 'Prepare invoices before they are issued.' },
  'invoicing:credit-note': { title: 'Issue credit notes', description: 'Reduce or cancel an invoice with a credit note.' },
  'invoicing:issue': { title: 'Issue invoices', description: 'Finalise an invoice so it gets its number.' },
  'invoicing:manage-recurring': { title: 'Manage recurring invoices', description: 'Set up invoices that are raised automatically on a schedule.' },
  'invoicing:manage-series': { title: 'Manage invoice numbering', description: 'Set how invoice numbers are formed.' },
  'invoicing:send': { title: 'Send invoices', description: 'Email invoices to clients.' },
  'invoicing:view': { title: 'See invoices', description: 'See invoices and their status.' },

  // Leads
  'leads:create': { title: 'Add leads', description: 'Add new sales leads.' },
  'leads:edit': { title: 'Edit leads', description: 'Change the details of leads.' },
  'leads:reassign': { title: 'Reassign leads', description: 'Move leads from one salesperson to another.' },
  'leads:view': { title: 'See leads', description: 'See sales leads.' },

  // Leave
  'leave:acknowledge': { title: 'Acknowledge leave (first step)', description: 'Mark a leave request as seen before it is decided. Not needed when HR approves in one step.' },
  'leave:decide': { title: 'Approve or reject leave', description: 'Approve, reject or cancel leave and work-from-home requests.' },
  'leave:manage-types': { title: 'Set up leave types and balances', description: 'Create leave types, set yearly days and limits, and adjust balances.' },
  'leave:manage-wfh-standing': { title: 'Set regular work-from-home days', description: 'Give someone standing work-from-home days, for example every Friday.' },
  'leave:request': { title: 'Apply for leave', description: 'Request leave for themselves.' },
  'leave:request-wfh': { title: 'Ask to work from home', description: 'Request work-from-home days for themselves.' },
  'leave:view': { title: 'See leave', description: 'See leave requests, balances and the leave calendar.' },

  // Workspace
  'notepad:view-all': { title: "Read everyone's notes", description: "Read other people's private notepads." },
  'notices:manage': { title: 'Post notices', description: 'Publish company notices and announcements.' },

  // Onboarding
  'onboarding:manage': { title: 'Run onboarding', description: 'Set up and track onboarding checklists for new joiners.' },

  // Organization structure
  'org:manage-departments': { title: 'Manage departments', description: 'Create and change departments.' },
  'org:manage-designations': { title: 'Manage job titles', description: 'Add and edit designations (job titles) and specialisations.' },
  'org:manage-positions': { title: 'Manage positions and their powers', description: 'Create positions and decide what each one is allowed to do.' },
  'org:manage-teams': { title: 'Manage teams', description: 'Create teams and choose team leads.' },
  'org:view-designations': { title: 'See job titles', description: 'See designations and specialisations.' },
  'org:view-people': { title: 'See people in the org chart', description: "See people's names and positions in the organization pages." },
  'org:view-policies': { title: 'See what positions can do', description: 'See the powers of each position, without changing them.' },
  'org:view-structure': { title: 'See the organization structure', description: 'See departments, positions, teams and the org chart.' },

  // Payables & expenses
  'payables:approve-bill': { title: 'Approve vendor bills', description: 'Approve bills from suppliers before they are paid.' },
  'payables:approve-claim': { title: 'Approve expense claims', description: "Approve or reject employees' expense claims." },
  'payables:claim': { title: 'Claim expenses', description: 'Submit their own expense claims.' },
  'payables:create-bill': { title: 'Enter vendor bills', description: 'Record bills received from suppliers.' },
  'payables:execute-run': { title: 'Pay suppliers', description: 'Run a batch payment to suppliers.' },
  'payables:view': { title: 'See bills and payouts', description: 'See supplier bills and payments made.' },

  // Payments
  'payments:allocate': { title: 'Match payments to invoices', description: 'Link money received to the invoices it pays.' },
  'payments:reconcile': { title: 'Reconcile the bank', description: 'Match bank statement lines with recorded payments.' },
  'payments:record': { title: 'Record payments received', description: 'Record money received from clients.' },
  'payments:refund': { title: 'Issue refunds', description: 'Send money back to a client.' },
  'payments:view': { title: 'See payments received', description: 'See money received from clients.' },

  // Payroll
  'payroll:manage': { title: 'Run payroll', description: 'Set salaries, add bonuses and deductions, and run and publish payroll.' },
  'payroll:manage-config': { title: 'Change payroll settings', description: 'Change the statutory settings payroll is calculated with.' },
  'payroll:view': { title: 'See payslips', description: 'See published payslips.' },

  // Performance
  'performance:manage': { title: 'Manage performance reviews', description: 'Set goals and record performance reviews.' },
  'performance:view': { title: 'See performance records', description: 'See goals and performance reviews.' },
  'performance:view-aggregates': { title: 'See performance summaries', description: 'See team and department performance averages.' },

  // Projects
  'projects:manage': { title: 'Manage projects', description: 'Create projects and change their plans.' },
  'projects:view': { title: 'See projects', description: 'See projects and their progress.' },
  'projects:view-financials': { title: 'See project budgets and costs', description: 'See how much projects are budgeted and have cost.' },

  // Receivables
  'receivables:dun': { title: 'Send payment reminders', description: 'Chase clients about unpaid invoices.' },
  'receivables:view': { title: 'See money owed', description: 'See unpaid invoices and how long they have been due.' },
  'receivables:write-off': { title: 'Write off bad debts', description: 'Close an invoice that will not be paid.' },

  // Recruitment
  'recruitment:manage-candidates': { title: 'Manage candidates', description: 'Add candidates, upload CVs, screen them and mark them as hired.' },
  'recruitment:manage-interviews': { title: 'Manage interviews', description: 'Schedule and reschedule interviews, and record feedback and decisions.' },
  'recruitment:manage-joining': { title: 'Manage joining', description: "Track new hires' joining dates and paperwork." },
  'recruitment:manage-links': { title: 'Manage job application links', description: 'Create and switch off the public links candidates use to apply.' },
  'recruitment:manage-offers': { title: 'Make job offers', description: 'Create job offers and track their status.' },
  'recruitment:manage-requisitions': { title: 'Open job positions', description: 'Create and close hiring requests (requisitions).' },
  'recruitment:manage-submissions': { title: 'Review applications', description: 'Review CVs sent through application links and turn them into candidates.' },
  'recruitment:view-candidates': { title: 'See candidates', description: 'See candidates and their CVs.' },
  'recruitment:view-interviews': { title: 'See interviews', description: 'See scheduled interviews and feedback.' },
  'recruitment:view-joining': { title: 'See joining status', description: "See new hires' joining progress." },
  'recruitment:view-metrics': { title: 'See hiring numbers', description: 'See the recruitment pipeline and hiring figures.' },
  'recruitment:view-offers': { title: 'See job offers', description: 'See job offers and their status.' },
  'recruitment:view-requisitions': { title: 'See open job positions', description: 'See hiring requests (requisitions).' },

  // Renewals
  'renewals:view': { title: 'See renewals', description: 'See contracts coming up for renewal.' },

  // Reports
  'reports:build': { title: 'Build reports', description: 'Create custom reports.' },
  'reports:export': { title: 'Export reports', description: 'Download reports.' },
  'reports:view': { title: 'See reports', description: 'Open reports.' },
  'reports:view-financial': { title: 'See financial reports', description: 'Open reports with revenue and cost figures.' },
  'reports:view-lifecycle': { title: 'See end-to-end reports', description: 'See reports that follow work from sale to delivery to payment.' },

  // Resource planning
  'resources:allocate': { title: 'Book people on projects', description: "Book people's time on projects." },
  'resources:override-allocation': { title: 'Override bookings', description: 'Book someone even when they are already fully booked.' },
  'resources:view': { title: "See who's booked", description: "See people's project bookings and availability." },

  // Workspace
  'sheets:manage': { title: 'Manage shared sheets', description: 'Create and edit shared spreadsheets.' },

  // Shifts
  'shifts:approve': { title: 'Approve shift requests', description: 'Approve or reject requests to change or swap shifts.' },
  'shifts:manage': { title: 'Set up shifts', description: 'Create shifts and assign them to people and departments.' },
  'shifts:view': { title: 'See shifts', description: 'See shift timings and who works which shift.' },

  // Punching
  'status:punch': { title: 'Punch in and out', description: 'Punch in, punch out and take breaks from the web or phone.' },

  // System settings
  'system:manage-integrations': { title: 'Manage integrations', description: 'Connect outside services such as email and messaging.' },
  'system:manage-retention': { title: 'Set how long data is kept', description: 'Decide how long records are kept before they are removed.' },
  'system:manage-settings': { title: 'Change company settings', description: 'Change company-wide settings.' },
  'system:manage-thresholds': { title: 'Set alert limits', description: 'Set the limits that trigger warnings and alerts.' },

  // Tasks
  'tasks:assign': { title: 'Assign tasks', description: 'Give tasks to themselves and to the people this power reaches.' },
  'tasks:log-time': { title: 'Log time on tasks', description: 'Record the time spent on tasks.' },
  'tasks:manage-dependencies': { title: 'Link tasks together', description: 'Set which tasks must finish before others can start.' },
  'tasks:review': { title: 'Review tasks', description: 'Check finished work and send it back if needed.' },
  'tasks:update': { title: 'Update tasks', description: 'Change task details and status.' },
  'tasks:view': { title: 'See tasks', description: 'See tasks and their progress.' },

  // Territories
  'territories:manage': { title: 'Manage sales territories', description: 'Create territories and assign them to salespeople.' },
  'territories:view': { title: 'See sales territories', description: 'See territories and who covers them.' },

  // Employees
  'users:change-placement': { title: 'Move employees', description: "Change someone's position, department, team or manager directly." },
  'users:manage': { title: 'Manage employee accounts', description: 'Add employees, edit their details, reset passwords and deactivate accounts.' },
  'users:view': { title: 'See employees', description: 'See the employee directory and profiles.' },
};
