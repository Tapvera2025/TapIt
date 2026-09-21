import type { ReactNode } from 'react';
import { ThemeToggle } from '../../theme/ThemeToggle.js';

export function IdentityLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-app-background px-5 py-8 text-app-foreground [background-image:radial-gradient(circle_at_18%_12%,rgba(244,139,60,0.14),transparent_27rem),radial-gradient(circle_at_90%_90%,rgba(244,139,60,0.1),transparent_24rem)]">
      <div className="absolute left-[8%] top-[15%] size-40 rounded-full border border-app-accent/10" aria-hidden="true" />
      <div className="absolute bottom-[12%] right-[8%] size-56 rounded-full border border-app-accent/10" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-[440px]">{children}</div>
      <ThemeToggle floating />
    </main>
  );
}
