/**
 * Scope resolution SQL — TECH.md §6.5.
 *
 * The queries live here, next to the port that consumes them, rather than in
 * the DAL: they are authorization logic that happens to be expressed in SQL,
 * and burying them among repository queries is how a second, subtly different
 * copy comes to exist (T-6).
 *
 * BD-32 is RESOLVED: recursive CTE at launch, target under 5 ms p95 on the
 * reference dataset. A materialised closure table is adopted ONLY if §18 load
 * testing proves the CTE misses the budget — "do not pre-optimise a
 * security-critical path into a cache that can be wrong."
 */

/**
 * VIS-1 — `team` scope is TRANSITIVE. Team Lead A sees Manish AND everyone
 * beneath Manish. Resolution walks the full `reports_to` subtree.
 *
 * $1 = organization_id, $2 = root user id
 */
export const SUBORDINATES_CTE = `
WITH RECURSIVE subordinates AS (
  SELECT id
  FROM app_user
  WHERE organization_id = $1
    AND id = $2
    AND status = 'active'

  UNION ALL

  SELECT u.id
  FROM app_user u
  JOIN subordinates s ON u.reports_to = s.id
  WHERE u.organization_id = $1
    AND u.status = 'active'
)
SELECT id FROM subordinates
`;

/**
 * Team descendants.
 *
 * Recursion starts from the principal's OWN team and descends only through
 * `parent_team_id`. It never ascends to a parent and then descends through a
 * sibling branch — that ascent is precisely what protected constraint P6
 * forbids, and it is the reason this query has no `parent_team_id = ANY(...)`
 * upward step. VIS-2: two Team Leads at the same level see disjoint sets,
 * enforced by team membership and never by comparing organizational level.
 *
 * $1 = organization_id, $2 = root team id
 */
export const TEAM_DESCENDANTS_CTE = `
WITH RECURSIVE team_tree AS (
  SELECT id
  FROM team
  WHERE organization_id = $1
    AND id = $2

  UNION ALL

  SELECT t.id
  FROM team t
  JOIN team_tree tt ON t.parent_team_id = tt.id
  WHERE t.organization_id = $1
)
SELECT id FROM team_tree
`;

/**
 * VIS-4 / VIS-6 — a Supervisor sees only their own pool; an Agent sees only
 * their own records, not their pool-mates'.
 *
 * $1 = organization_id, $2 = pool team ids
 */
export const POOL_MEMBERS = `
SELECT id
FROM app_user
WHERE organization_id = $1
  AND team_id = ANY($2::uuid[])
  AND status = 'active'
`;

/**
 * VIS-1 — team scope members: everyone in any team of the principal's team
 * subtree. Combines TEAM_DESCENDANTS_CTE with app_user membership. For a
 * manager over several pools, this is the right denominator — pool scope
 * narrows to one pool, team scope widens to the subtree.
 *
 * $1 = organization_id, $2 = root team id
 */
export const TEAM_MEMBERS = `
WITH RECURSIVE team_tree AS (
  SELECT id
  FROM team
  WHERE organization_id = $1
    AND id = $2

  UNION ALL

  SELECT t.id
  FROM team t
  JOIN team_tree tt ON t.parent_team_id = tt.id
  WHERE t.organization_id = $1
)
SELECT u.id
FROM app_user u
WHERE u.organization_id = $1
  AND u.status = 'active'
  AND u.team_id IN (SELECT id FROM team_tree)
`;

/**
 * Department scope members — every active user in the principal's department.
 * Used when a dept-wide manager must see across every pool in their dept.
 *
 * $1 = organization_id, $2 = department id
 */
export const DEPARTMENT_MEMBERS = `
SELECT id
FROM app_user
WHERE organization_id = $1
  AND department_id = $2
  AND status = 'active'
`;

/** Memo keys, so one request resolves each of these at most once (NF-5). */
export const MEMO_KEYS = {
  subordinates: 'scope:subordinates',
  teams: 'scope:teams',
  pools: 'scope:pools',
  poolMembers: 'scope:pool-members',
  teamMembers: 'scope:team-members',
  departmentMembers: 'scope:department-members',
  department: 'scope:department',
  permissionSet: 'authz:permission-set',
} as const;
