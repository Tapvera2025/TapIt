/** Source-level companion to the live-schema CI-33 check. */
export function inspectTenantRls(migrations: string): {
  tenantTables: string[];
  unprotected: string[];
} {
  const created = [
    ...migrations.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\)/g),
  ];
  const tenantTables = created
    .filter(([, , body]) => /organization_id\s+uuid\b/.test(body ?? ''))
    .map(([, name]) => name!)
    .filter((name) => name !== 'organization');

  const unprotected = tenantTables.filter((table) => {
    const helper = new RegExp(`apply_tenant_rls\\('${table}'\\)`).test(migrations);
    const enabled = new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`).test(
      migrations,
    );
    const forced = new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`).test(
      migrations,
    );
    return !helper && !(enabled && forced);
  });

  return { tenantTables, unprotected };
}
