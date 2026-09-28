import { z } from 'zod';
import { ACTIONS } from '@tapcrm/contracts';

/**
 * Notification types. Free-form strings in the database (a module adds a type
 * without a migration), but declared HERE so they are discoverable and a typo
 * is a compile error rather than a silently orphaned notification.
 *
 * Convention: `<module>.<event>`. Add yours below, then call `notify()`.
 */
export const NOTIFICATION_TYPES = {
  SYSTEM_TEST: 'system.test',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * NT-3 — informational vs operational. A user's channel preferences may silence
 * informational notifications; operational ones (an approval waiting on you, a
 * security alert) always arrive.
 */
export const NOTIFICATION_PRIORITIES = ['informational', 'operational'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_CHANNELS = ['in-app', 'email', 'push', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * WHO receives it. Fields are unioned; at least one must be present.
 *
 *   users        explicit user ids (any active non-service account)
 *   positions    every active employee in these positions
 *   departments  every active employee in these departments
 *   holders      every active employee who currently HOLDS `action` — via a
 *                position policy or an unexpired override, honouring an
 *                override that denies — plus Super Admin. Optionally narrowed
 *                to a department/team. This is the authorization-aware form
 *                (NT-1): a person without the action is never selected.
 *
 * The actor (`ctx.principal`) is excluded unless `includeActor` is set.
 */
export interface NotificationAudience {
  readonly users?: readonly string[];
  readonly positions?: readonly string[];
  readonly departments?: readonly string[];
  readonly holders?: {
    readonly action: string;
    readonly departmentId?: string;
    readonly teamId?: string;
  };
  readonly excludeUserIds?: readonly string[];
  readonly includeActor?: boolean;
}

export interface NotifyInput {
  readonly type: NotificationType | (string & {});
  readonly priority?: NotificationPriority;
  readonly audience: NotificationAudience;
  readonly title: string;
  readonly body?: string;
  /** In-app deep link to the exact record (NT-5). Must be a same-origin path. */
  readonly link?: string | null;
  /** Small identifiers the client may use (leadId, caseId…). Not for record bodies. */
  readonly metadata?: Record<string, string | number | boolean | null>;
  /** Days until pruned (NT-8). Defaults to 90. */
  readonly expiresInDays?: number;
}

const uuid = z.string().uuid();

/** What is stored in `notification_outbox.payload`. Re-validated at dispatch. */
export const outboxPayloadSchema = z.object({
  type: z.string().trim().min(1).max(100).regex(/^[a-z0-9_.-]+$/i, 'type must be dot/kebab/snake case'),
  priority: z.enum(NOTIFICATION_PRIORITIES).default('informational'),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000).default(''),
  link: z
    .string()
    .max(500)
    // Same-origin paths only: a notification is a trusted surface and an
    // absolute or protocol-relative URL would make it a phishing vector.
    .regex(/^\/(?!\/)/, 'link must be an in-app path starting with a single "/"')
    .nullable()
    .default(null),
  metadata: z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).default({}),
  expiresInDays: z.number().int().min(1).max(3650).default(90),
  actorId: uuid.nullable().default(null),
  audience: z
    .object({
      users: z.array(uuid).max(1000).optional(),
      positions: z.array(uuid).max(100).optional(),
      departments: z.array(uuid).max(100).optional(),
      holders: z
        .object({
          action: z.string().refine((a) => (ACTIONS as readonly string[]).includes(a), 'unknown registry action'),
          departmentId: uuid.optional(),
          teamId: uuid.optional(),
        })
        .optional(),
      excludeUserIds: z.array(uuid).max(1000).optional(),
      includeActor: z.boolean().optional(),
    })
    .refine(
      (a) => (a.users?.length ?? 0) + (a.positions?.length ?? 0) + (a.departments?.length ?? 0) > 0 || a.holders !== undefined,
      'audience is empty: give users, positions, departments or holders',
    ),
});

export type OutboxPayload = z.infer<typeof outboxPayloadSchema>;

/** Row shape returned to the API (RT-4: the socket never carries this). */
export interface NotificationView {
  id: string;
  type: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  link: string | null;
  metadata: Record<string, unknown>;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}
