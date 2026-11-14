import type { ReactNode } from 'react';

export function IdentityLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-app-background px-5 py-8 text-app-foreground">
      <div className="relative z-10 w-full max-w-[440px]">
        {children}
        {/* Plain links: these are separate HTML pages, not app routes. */}
        <nav
          aria-label="Legal"
          className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-app-muted"
        >
          <a href="/about" className="hover:text-app-foreground hover:underline">
            About Tapvera CRM
          </a>
          <a href="/privacy" className="hover:text-app-foreground hover:underline">
            Privacy Policy
          </a>
          <a href="/terms" className="hover:text-app-foreground hover:underline">
            Terms of Service
          </a>
        </nav>
      </div>
    </main>
  );
}
