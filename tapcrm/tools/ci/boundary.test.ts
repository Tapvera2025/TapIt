import { describe, expect, it } from 'vitest';
import { findBoundaryViolations, locateInModule } from './boundary.js';

const ROOT = '/repo';
const MODULES = '/repo/packages/server/src/modules';
const file = (path: string, text: string) => ({ path: `${MODULES}/${path}`, text });

describe('module boundary (TECH.md §3, MB-1)', () => {
  it('catches a sibling import of another module service', () => {
    const violations = findBoundaryViolations(
      [file('employee/service.ts', "import { hashIdentityPassword } from '../identity/password/service.js';")],
      ROOT,
    );
    expect(violations).toEqual([
      {
        file: 'packages/server/src/modules/employee/service.ts',
        line: 1,
        from: 'employee',
        to: 'identity',
        specifier: '../identity/password/service.js',
      },
    ]);
  });

  it('catches the long form through modules/', () => {
    const violations = findBoundaryViolations(
      [file('employee/routes.ts', "import { x } from '../../modules/organization/chart/service.js';")],
      ROOT,
    );
    expect(violations.map((v) => v.to)).toEqual(['organization']);
  });

  it('catches type-only imports, re-exports and error classes too', () => {
    const violations = findBoundaryViolations(
      [
        file(
          'employee/service.ts',
          [
            "import type { IdentityUser } from '../identity/authentication/principal.js';",
            "import { IdentityValidationError } from '../identity/errors.js';",
            "export { findTeam } from '../organization/teams/repository.js';",
          ].join('\n'),
        ),
      ],
      ROOT,
    );
    expect(violations.map((v) => v.line)).toEqual([1, 2, 3]);
  });

  it('reports the line of a multi-line import', () => {
    const violations = findBoundaryViolations(
      [file('access-management/service.ts', "import {\n  a,\n  b,\n} from '../organization/reporting/service.js';")],
      ROOT,
    );
    expect(violations.map((v) => v.line)).toEqual([4]);
  });

  it("allows another module's facade", () => {
    expect(
      findBoundaryViolations(
        [file('employee/service.ts', "import { hashIdentityPassword } from '../identity/facade.js';")],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('allows any import inside the same module', () => {
    expect(
      findBoundaryViolations(
        [file('organization/chart/service.ts', "import { findTeam } from '../teams/repository.js';")],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('exempts the composition root in modules/index.ts', () => {
    expect(
      findBoundaryViolations(
        [file('index.ts', "import { registerEmployeeRoutes } from './employee/routes.js';")],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('ignores package imports and platform imports', () => {
    expect(
      findBoundaryViolations(
        [
          file(
            'employee/service.ts',
            "import { z } from 'zod';\nimport { db } from '../../platform/dal/db.js';",
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('does not treat a nested folder called facade as the facade', () => {
    const violations = findBoundaryViolations(
      [file('employee/service.ts', "import { x } from '../identity/facade/service.js';")],
      ROOT,
    );
    expect(violations).toHaveLength(1);
  });

  it('locates module files and nothing else', () => {
    expect(locateInModule(ROOT, `${MODULES}/identity/password/service.ts`)).toEqual({
      module: 'identity',
      inside: ['password', 'service'],
    });
    expect(locateInModule(ROOT, `${MODULES}/index.ts`)).toBeNull();
    expect(locateInModule(ROOT, '/repo/packages/server/src/platform/dal/db.ts')).toBeNull();
  });
});
