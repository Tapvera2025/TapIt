import {
  levelTitleMismatches,
  positionsBySeniority,
} from './position-hierarchy-model.js';
import type { OrganizationPosition } from '../types/index.js';

/**
 * Shows every active position in the department by level while a position is
 * being created or edited, with the one being entered slotted in where its
 * level puts it. Whoever enters a level rarely remembers what the others were
 * given; without this a "Senior" role could land under the junior one.
 */
export function PositionLevelGuide({
  departmentName,
  positions,
  editing,
  name,
  level,
  parent,
  parentSuggested,
  moving,
}: {
  departmentName: string;
  /** Every position in the department, flattened. */
  positions: readonly OrganizationPosition[];
  editing: OrganizationPosition | null;
  name: string;
  /** The level entered, or null while it is empty or not a valid level. */
  level: number | null;
  /** Who it reports to; null for the Super Admin (the department's top). */
  parent: OrganizationPosition | null;
  /** Whether `parent` was picked from the level rather than by the person. */
  parentSuggested: boolean;
  /** Positions that will move under it when it is saved. */
  moving: readonly OrganizationPosition[];
}): React.JSX.Element {
  const ranked = positionsBySeniority(positions, editing?.id);
  const title = name.trim() || (editing ? editing.name : 'New position');
  const movingIds = new Set(moving.map((position) => position.id));
  const parentNames = new Map(positions.map((position) => [position.id, position.name]));
  const draftIndex =
    level === null
      ? -1
      : ranked.findIndex((position) => position.organizationalLevel < level);
  const insertAt = draftIndex === -1 ? ranked.length : draftIndex;
  const mismatches =
    level === null || !name.trim()
      ? []
      : levelTitleMismatches(positions, name, level, editing?.id);

  return (
    <section
      className="rounded-xl border border-app-border p-3 md:col-span-2"
      aria-label={`Levels in ${departmentName}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-semibold text-app-foreground">
          Levels in {departmentName}
        </h3>
        <span className="text-xs text-app-muted">
          1 = most junior · 100 = most senior
        </span>
      </div>
      <p className="mt-1 text-xs text-app-muted" role="status">
        {summary({
          departmentName,
          ranked,
          editing,
          level,
          parent,
          parentSuggested,
          moving,
        })}
      </p>
      {mismatches.map(({ position, enteredSoundsSenior }) => (
        <p
          key={position.id}
          className="mt-2 rounded-lg border border-[#d9a441]/40 bg-[#d9a441]/10 px-3 py-2 text-xs text-app-foreground"
        >
          {enteredSoundsSenior
            ? `“${title}” sounds more senior than ${position.name}, but ${position.name} is at level ${position.organizationalLevel}${position.organizationalLevel === level ? ', the same level' : ''}. To rank it above, use a level higher than ${position.organizationalLevel}.`
            : `${position.name} (level ${position.organizationalLevel}) sounds more senior than “${title}”, but level ${level ?? ''} puts “${title}” ${position.organizationalLevel === level ? 'on the same level' : 'above it'}. To rank it below, use a level lower than ${position.organizationalLevel}.`}
        </p>
      ))}
      {ranked.length > 0 || level !== null ? (
        <ol className="mt-2 max-h-56 space-y-0.5 overflow-auto">
          {ranked.slice(0, insertAt).map((position) => (
            <LevelRow
              key={position.id}
              position={position}
              note={rowNote(position, parentNames, movingIds, title)}
            />
          ))}
          {level !== null && (
            <li className="flex items-center gap-3 rounded-lg border border-app-accent/30 bg-app-accent/10 px-2 py-1.5 text-sm">
              <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-app-accent">
                Level {level}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-app-foreground">
                {title}{' '}
                <span className="font-normal text-app-accent">
                  ({editing ? 'this position' : 'new'})
                </span>
              </span>
              <span className="hidden max-w-[45%] truncate text-xs text-app-muted sm:block">
                reports to {parent?.name ?? 'Super Admin'}
              </span>
            </li>
          )}
          {ranked.slice(insertAt).map((position) => (
            <LevelRow
              key={position.id}
              position={position}
              note={rowNote(position, parentNames, movingIds, title)}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function LevelRow({
  position,
  note,
}: {
  position: OrganizationPosition;
  note: { text: string; highlight: boolean };
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
      <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-app-muted">
        Level {position.organizationalLevel}
      </span>
      <span className="min-w-0 flex-1 truncate text-app-foreground">{position.name}</span>
      <span
        className={`hidden max-w-[45%] truncate text-xs sm:block ${note.highlight ? 'font-semibold text-app-accent' : 'text-app-muted'}`}
      >
        {note.text}
      </span>
    </li>
  );
}

function rowNote(
  position: OrganizationPosition,
  parentNames: ReadonlyMap<string, string>,
  movingIds: ReadonlySet<string>,
  title: string,
): { text: string; highlight: boolean } {
  if (movingIds.has(position.id))
    return { text: `will move under ${title}`, highlight: true };
  const parentName = position.parentPositionId
    ? (parentNames.get(position.parentPositionId) ?? 'another position')
    : 'Super Admin';
  return { text: `reports to ${parentName}`, highlight: false };
}

function summary({
  departmentName,
  ranked,
  editing,
  level,
  parent,
  parentSuggested,
  moving,
}: {
  departmentName: string;
  ranked: readonly OrganizationPosition[];
  editing: OrganizationPosition | null;
  level: number | null;
  parent: OrganizationPosition | null;
  parentSuggested: boolean;
  moving: readonly OrganizationPosition[];
}): string {
  if (!editing && ranked.length === 0)
    return (
      `This is the first position in ${departmentName}, so it reports to the Super Admin. ` +
      'If you later add a position with a higher level, that one takes over as the top and this one moves under it.'
    );
  if (level === null)
    return 'Enter a level to see where this position fits among the others.';
  const placement = parent
    ? `Reports to ${parent.name} (level ${parent.organizationalLevel})${parentSuggested ? `, the closest level above ${level}` : ''}.`
    : editing
      ? `This is the top of ${departmentName} and reports to the Super Admin.`
      : moving.length > 0
        ? `This becomes the new top of ${departmentName} and reports to the Super Admin.`
        : '';
  const moves =
    moving.length > 0
      ? ` ${listNames(moving)} will move under it. You will see the change before it is saved.`
      : '';
  return `${placement}${moves}`.trim();
}

function listNames(positions: readonly OrganizationPosition[]): string {
  const names = positions.map((position) => position.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}
