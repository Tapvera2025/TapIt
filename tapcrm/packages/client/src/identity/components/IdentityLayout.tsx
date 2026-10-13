import type { ReactNode } from 'react';

export function IdentityLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-app-background px-5 py-8 text-app-foreground">
      <div className="relative z-10 w-full max-w-[440px]">{children}</div>
    </main>
  );
}
