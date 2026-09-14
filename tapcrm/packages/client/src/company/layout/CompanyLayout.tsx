import { useState } from 'react';
import { CompanyHeader } from './CompanyHeader.js';
import { CompanySidebar } from './CompanySidebar.js';

export function CompanyLayout({ pathname, identity, accountType, title, onNavigate, onLogout, children }: { pathname: string; identity: { fullName: string; email: string }; accountType: string; title: string; onNavigate: (path: string) => void; onLogout: () => void; children: React.ReactNode }): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <div className="flex h-screen overflow-hidden bg-app-background text-app-foreground"><CompanySidebar pathname={pathname} identity={identity} accountType={accountType} onNavigate={onNavigate} onLogout={onLogout} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />{sidebarOpen && <button type="button" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-label="Close navigation overlay" /> }<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><CompanyHeader title={title} onMenu={() => setSidebarOpen(true)} onLogout={onLogout} /><main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main></div></div>;
}
