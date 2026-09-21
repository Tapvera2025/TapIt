# CRM interface conventions

The shared interface follows the supplied light and dark visual references: warm orange gradients, cool neutral surfaces, outlined navigation, subtle layered cards, rounded bars, and ring charts. The CRM's existing data and authorization rules remain the source of truth.

## Tokens

`packages/client/src/index.css` owns the palette, typography, surfaces, focus treatment and motion. Both themes use the same semantic names. Use `app-foreground`, `app-muted`, `app-border`, `app-surface`, `app-surface-raised`, `app-accent`, `app-success` and `app-danger` instead of adding literal colors to feature components. Light-mode accent text is darker than the decorative orange to retain contrast. Primary actions use the orange gradient and dark `app-on-accent` text.

## Components

- `ui/components.tsx`: Page, Card, Button, Field, Select, Notice, Loading, Empty and Modal. OrganizationUi re-exports these for compatibility and retains its domain-specific position tree.
- `ui/Icon.tsx`: consistent 24px line icons; decorative SVGs are hidden from assistive technology.
- `ui/charts.tsx`: RingChart, BarChart and Progress. Supply actual values and descriptive labels; do not fabricate historical data, targets or growth rates.

Use one page title, a short description and a primary action in Page. Group related content in Cards, place labels above fields, and retain visible loading, empty, unavailable and error states. Prefer native controls and explicit button types. Modal uses the native dialog for focus containment, Escape dismissal and focus restoration.

## Motion and interaction

Chart bars stagger by 65ms and grow over 650ms; rings draw over 900ms. Card entrances run for 350ms and dialog entrances for 180ms. Buttons have subtle press feedback, and hover states use color and border changes. Do not add looping decorative motion. All motion is disabled for `prefers-reduced-motion: reduce`.

## Responsive review

Review light and dark themes at desktop and 390px mobile widths. Keep navigation in its mobile drawer, stack content cards, permit internal horizontal scrolling for wide tables, and avoid hiding essential actions. Verify keyboard focus, Escape dismissal, text labels for chart values and reduced motion. New pages should use the shared primitives rather than copying module-specific markup.

## Brand asset

Use `ui/BrandLogo.tsx` for all logo placements. It references the supplied original PNG in `public/brand/tapvera-crm.png`, preserves its aspect ratio on a transparent background. Light mode retains the original dark CRM lettering; dark mode uses a clipped white overlay for just the CRM letters, keeping the orange artwork unchanged. The overlay bounds match the supplied image and must be reviewed if that asset changes. Do not recreate the logo with text. The favicon uses the same artwork with a monogram-focused SVG viewport.
