#!/usr/bin/env python3
"""
One-time converter: TapCRM_AUTHORIZATION_v1.8.pdf -> docs/AUTHORIZATION.md

TECH.md §6.1 makes AUTHORIZATION.md the input to the registry code generator.
The document was delivered as a PDF, so this script lifts §6.4 (the 147-action
registry) and §6.5 (the 292 bindings) into markdown tables that
tools/extract-registry.ts can parse.

The document states its own totals, and this script asserts every one of them.
A silent parse failure that drops rows would produce a registry missing actions
-- which fails CLOSED at runtime (SE-2) but would look like a working build.
The checksums below are what make that impossible.

Usage:  python3 tools/convert-authorization-pdf.py <input.pdf> <output.md>
"""

import re
import subprocess
import sys
from pathlib import Path

# Totals asserted by the document itself (§6.4).
EXPECTED = {
    "actions": 147,
    "bindings": 292,
    "sensitive": 65,
    "approval_bearing": 25,
    "super_admin_only": 18,
    "not_position_grantable": 2,
    "delegable": 82,
    "people_domain": 38,
    "business_domain": 101,
}

YES, NO = "Y", "·"

ACTION_RE = re.compile(
    r"^\s+([a-z][a-z0-9-]*:[a-z][a-z0-9-]*)\s{2,}"   # action
    r"(\S+)\s{2,}"                                    # resource (or em dash)
    r"(people|business|derived)\s{2,}"                # domain
    r"([Y·])\s{2,}"                                   # sensitive
    r"([Y·])\s{2,}"                                   # approval-bearing
    r"(\S+)\s{2,}"                                    # initiator field (or em dash)
    r"([Y·])\s{2,}"                                   # positionGrantable
    r"([Y·])\s{2,}"                                   # delegationAllowed
    r"([Y·])\s*$"                                     # superAdminOnly
)

BINDING_RE = re.compile(
    r"^\s+(GET|POST|PATCH|PUT|DELETE)\s{2,}"
    r"(/\S*)\s{2,}"
    r"([a-z][a-z0-9-]*:[a-z][a-z0-9-]*)\s{2,}"
    r"(\S+)\s{2,}"
    r"(\S+)\s*$"
)

# A path that wrapped onto the next line: the method row ended mid-path.
BINDING_WRAP_RE = re.compile(
    r"^\s+(GET|POST|PATCH|PUT|DELETE)\s{2,}"
    r"(/\S*)\s{2,}"
    r"([a-z][a-z0-9-]*:[a-z][a-z0-9-]*)\s{2,}"
    r"(\S+)\s{2,}"
    r"(\S+)\s*$"
)

DASHES = {"—", "-", "–", "", "·"}


def norm(value: str) -> str:
    return "—" if value.strip() in DASHES else value.strip()


def extract_text(pdf: Path) -> list[str]:
    out = subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.split("\n")


def section_bounds(lines: list[str], start_marker: str, end_marker: str) -> tuple[int, int]:
    """Last occurrence of the start marker (the first is the table of contents)."""
    starts = [i for i, l in enumerate(lines) if l.strip().startswith(start_marker)]
    ends = [i for i, l in enumerate(lines) if l.strip().startswith(end_marker)]
    if not starts:
        raise SystemExit(f"Section '{start_marker}' not found")
    start = starts[-1]
    after = [e for e in ends if e > start]
    return start, (after[0] if after else len(lines))


def parse_actions(lines: list[str]) -> list[dict]:
    start, end = section_bounds(lines, "6.4 The Complete Action Registry", "6.5 API Bindings")
    rows, seen = [], set()

    for line in lines[start:end]:
        m = ACTION_RE.match(line)
        if not m:
            continue
        action = m.group(1)
        if action in seen:          # header repeats across page breaks
            continue
        seen.add(action)
        rows.append({
            "action": action,
            "resource": norm(m.group(2)),
            "domain": m.group(3),
            "sensitive": m.group(4) == YES,
            "approvalBearing": m.group(5) == YES,
            "initiatorField": norm(m.group(6)),
            "positionGrantable": m.group(7) == YES,
            "delegationAllowed": m.group(8) == YES,
            "superAdminOnly": m.group(9) == YES,
        })
    return rows


def parse_bindings(lines: list[str], valid_actions: set[str]) -> tuple[list[dict], list[str]]:
    """
    Two independent wrap modes appear in the PDF's fixed-width layout, and one
    row wraps in both at once:

      path wrap    path ends in '/', continuation sits at the path column
      action wrap  action ends in '-', continuation sits at the action column

    Continuations are matched by COLUMN POSITION rather than by order, because a
    row wrapping both would otherwise stitch the fragments to the wrong fields.
    """
    start, end = section_bounds(lines, "6.5 API Bindings", "6.6 CI Checks")
    rows, seen = [], set()
    collisions: dict[str, set[str]] = {}
    window = lines[start:end]

    def fragment_at(line: str, column: int, tolerance: int = 6) -> str | None:
        """A bare word on a continuation line starting near `column`."""
        for m in re.finditer(r"\S+", line):
            if abs(m.start() - column) <= tolerance and re.fullmatch(r"[a-z0-9:_-]+", m.group()):
                return m.group()
        return None

    for i, line in enumerate(window):
        m = BINDING_RE.match(line)
        if not m:
            continue
        method, path, action, _resource, param = m.groups()
        path_col, action_col = m.start(2), m.start(3)

        nxt = window[i + 1] if i + 1 < len(window) else ""

        if path.endswith("/"):
            frag = fragment_at(nxt, path_col)
            if frag:
                path += frag

        if action.endswith("-"):
            frag = fragment_at(nxt, action_col)
            if frag:
                action += frag

        if action not in valid_actions:
            continue

        # Dedup on the FULL triple. `GET /api/changes` is genuinely bound twice
        # in the source with two different actions, so method+path is not a key.
        key = f"{method} {path} {action}"
        if key in seen:
            continue
        seen.add(key)

        collisions.setdefault(f"{method} {path}", set()).add(action)

        rows.append({
            "method": method,
            "path": path,
            "action": action,
            "param": norm(param),
        })

    conflicts = [
        f"{route} → {sorted(actions)}"
        for route, actions in collisions.items()
        if len(actions) > 1
    ]
    return rows, conflicts


def check(label: str, actual: int, expected: int, problems: list[str]) -> None:
    mark = "✓" if actual == expected else "✗"
    print(f"  {mark} {label}: {actual} (document states {expected})")
    if actual != expected:
        problems.append(f"{label}: parsed {actual}, document states {expected}")


def main() -> None:
    pdf = Path(sys.argv[1])
    out = Path(sys.argv[2])

    lines = extract_text(pdf)
    actions = parse_actions(lines)
    bindings, conflicts = parse_bindings(lines, {a["action"] for a in actions})

    print("Checksums against the document's own stated totals:")
    problems: list[str] = []
    check("actions", len(actions), EXPECTED["actions"], problems)
    check("bindings", len(bindings), EXPECTED["bindings"], problems)
    check("sensitive", sum(a["sensitive"] for a in actions), EXPECTED["sensitive"], problems)
    check("approval-bearing", sum(a["approvalBearing"] for a in actions), EXPECTED["approval_bearing"], problems)
    check("super-admin-only", sum(a["superAdminOnly"] for a in actions), EXPECTED["super_admin_only"], problems)
    check("not position-grantable", sum(not a["positionGrantable"] for a in actions), EXPECTED["not_position_grantable"], problems)
    check("delegable", sum(a["delegationAllowed"] for a in actions), EXPECTED["delegable"], problems)
    check("people-domain", sum(a["domain"] == "people" for a in actions), EXPECTED["people_domain"], problems)
    check("business-domain", sum(a["domain"] == "business" for a in actions), EXPECTED["business_domain"], problems)

    if problems:
        print("\n✗ Conversion is INCOMPLETE. Do not commit this output:\n  " + "\n  ".join(problems))
        sys.exit(1)

    y = lambda b: "yes" if b else "no"
    hdr = ("| Action | Module | Resource | Domain | Sensitive | ApprovalBearing | "
           "InitiatorField | PositionGrantable | DelegationAllowed | SuperAdminOnly |")
    sep = "| " + " | ".join(["---"] * 10) + " |"

    body = [
        f"| `{a['action']}` | {module_for(a['action'])} | {a['resource']} | {a['domain']} | "
        f"{y(a['sensitive'])} | {y(a['approvalBearing'])} | {a['initiatorField']} | "
        f"{y(a['positionGrantable'])} | {y(a['delegationAllowed'])} | {y(a['superAdminOnly'])} |"
        for a in actions
    ]

    bhdr = "| Method | Path | Action | ResourceParam |"
    bsep = "| --- | --- | --- | --- |"
    bbody = [f"| {b['method']} | {b['path']} | `{b['action']}` | {b['param']} |" for b in bindings]

    out.write_text(TEMPLATE.format(
        n_actions=len(actions),
        n_bindings=len(bindings),
        action_table="\n".join([hdr, sep] + body),
        binding_table="\n".join([bhdr, bsep] + bbody),
    ), encoding="utf-8")

    print(f"\n✓ Wrote {out} — {len(actions)} actions, {len(bindings)} bindings")

    if conflicts:
        print(
            "\n⚠ SOURCE DOCUMENT CONFLICT — one route bound to more than one action.\n"
            "  §6.2 makes method+path the authorization key, so this is ambiguous:\n  "
            + "\n  ".join(conflicts)
            + "\n  The boot-time route check (RM-1/RM-2) will reject this until resolved."
        )


NAMESPACE_TO_MODULE = {
    "org": "organization", "access": "access-management", "system": "system-administration",
    "users": "employee-directory", "notepad": "workspace", "notices": "workspace",
    "sheets": "workspace", "todo": "workspace", "profile": "workspace", "search": "workspace",
    "billing": "billing-terms", "resources": "resource-planning", "changes": "delivery",
    "accounts": "clients", "communication": "project-communication", "reports": "reporting",
    "renewals": "post-closure", "breaks": "break-management", "wfh": "leave",
    "status": "live-status", "portal": "client-portal", "brief": "handoff",
}

KNOWN_MODULES = {
    "identity", "organization", "access-management", "audit", "system-administration",
    "employee-directory", "onboarding", "live-status", "attendance", "break-management",
    "shifts", "biometric", "leave", "holidays", "payroll", "performance",
    "territories", "leads", "callbacks", "handovers", "deals", "approvals",
    "handoff", "projects", "tasks", "resource-planning", "delivery",
    "clients", "post-closure", "client-portal",
    "billing-terms", "invoicing", "payments", "receivables", "payables", "accounting",
    "chat", "project-communication", "documents", "reporting", "notifications", "workspace",
}


def module_for(action: str) -> str:
    ns = action.split(":")[0]
    if ns in NAMESPACE_TO_MODULE:
        return NAMESPACE_TO_MODULE[ns]
    if ns in KNOWN_MODULES:
        return ns
    raise SystemExit(f"Namespace '{ns}' (from {action}) maps to no known module. Add it to NAMESPACE_TO_MODULE.")


TEMPLATE = """# TapCRM — Authorization

**Version** 1.8 **Status** Converted from `TapCRM_AUTHORIZATION_v1.8.pdf`

> **This file is generated.** `tools/convert-authorization-pdf.py` lifted §6.4 and
> §6.5 out of the delivered PDF into the markdown tables below, so that
> `tools/extract-registry.ts` can consume them (TECH.md §6.1). The conversion
> asserts every total the document states about itself — {n_actions} actions,
> {n_bindings} bindings, and the sensitive / approval-bearing / delegable /
> domain counts — and refuses to write this file if any of them disagree.
>
> The PDF remains the human-authoritative document. Prose sections §1–§5 and
> §7–§11 live there and are not reproduced here; only the two machine-read
> tables are.

---

## 6.4 Action Registry

{n_actions} actions. Column meanings are as given in the source document:

| Column | Meaning |
| --- | --- |
| `Resource` | Which `ResourcePolicy` governs object-level checks and list filtering. `—` means the action operates on no object — configuration or a derived report — and is gated by policy alone. |
| `Domain` | `people` \\| `business`. A `derived` resource resolves to one of these two at evaluation time; `derived` is a declaration style, not a third domain. |
| `Sensitive` | Every **use** is written to the access audit, not only every grant. |
| `ApprovalBearing` | Segregation of duties (A1) applies and an initiator field is mandatory. |
| `InitiatorField` | The field naming who initiated the item, resolved per §4.1.1. |
| `PositionGrantable` | May appear in a Position's policy list. |
| `DelegationAllowed` | A delegate may grant it, bounded by the ceiling. |
| `SuperAdminOnly` | Only Super Admin may grant it. |

**Registry invariants** (asserted at build time by the extractor, RG-I4):

| # | Invariant |
| --- | --- |
| RG-1 | `DelegationAllowed` requires `Sensitive = no`. A sensitive action is never delegable — a delegate may hold it, but only Super Admin may hand it out. |
| RG-2 | `SuperAdminOnly` implies `DelegationAllowed = no` (GP-2). |
| RG-3 | `PositionGrantable = no` implies `DelegationAllowed = no` and `SuperAdminOnly = yes` (GP-1). Two actions qualify: `notepad:view-all` and `billing:set-terms`. |
| RG-4 | `ApprovalBearing` requires a non-null initiator field (GP-5). |
| RG-5 | Every action names a resource or is explicitly `—`. There is no unspecified case. |
| RG-6 | Every action has at least one API binding (§6.5). |

{action_table}

---

## 6.5 API Bindings

{n_bindings} bindings. Every action bound to at least one HTTP route. A route
registered at boot with no binding is a startup failure (RM-1); a binding naming
an unregistered action fails the build (RM-2).

Paths are the design intent. `TECH.md` may refine them, but **not** the
method-to-action mapping — that is the authorization contract, and changing it
changes who can do what.

{binding_table}
"""

if __name__ == "__main__":
    main()
