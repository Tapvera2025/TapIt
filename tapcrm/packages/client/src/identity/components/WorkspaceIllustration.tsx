import type { CSSProperties, Ref } from 'react';
import { Icon } from '../../ui/Icon.js';

// Evenly spaced around the same ellipse used by the connection path.
const modules = [
  { name: 'Sales', icon: 'chart', x: 24.5, y: 24.5 },
  { name: 'Development', icon: 'code', x: 50, y: 14 },
  { name: 'SEO', icon: 'search', x: 75.5, y: 24.5 },
  { name: 'Attendance', icon: 'attendance', x: 86, y: 50 },
  { name: 'HRMS', icon: 'users', x: 75.5, y: 75.5 },
  { name: 'Projects', icon: 'folder', x: 50, y: 86 },
  { name: 'Clients', icon: 'person', x: 24.5, y: 75.5 },
  { name: 'Operations', icon: 'layers', x: 14, y: 50 },
];

const customIcons: Record<string, string> = {
  code: 'm8 5-7 7 7 7 M16 5l7 7-7 7 M14 3l-4 18',
  attendance:
    'M7 2v4 M17 2v4 M3 9h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z m3 11 3 3 5-5',
  folder: 'M2 7V4h7l3 3h8a2 2 0 0 1 2 2v11H2V7Z M2 10h20',
  person: 'M16.5 6.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z M3 22v-2a9 7 0 0 1 18 0v2Z',
};

export function WorkspaceIllustration({ ref }: { ref: Ref<HTMLDivElement> }) {
  return (
    <div className="workspace-illustration" ref={ref} aria-hidden="true">
      <svg className="workspace-orbit" viewBox="0 0 680 570" fill="none">
        <defs>
          <linearGradient
            id="workspace-orbit-gradient"
            x1="70"
            y1="350"
            x2="620"
            y2="230"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#d8cabb" />
            <stop offset=".4" stopColor="#d5dbe3" />
            <stop offset="1" stopColor="#b9c4d1" />
          </linearGradient>
        </defs>
        <ellipse
          cx="340"
          cy="285"
          rx="245"
          ry="205"
          stroke="url(#workspace-orbit-gradient)"
          strokeWidth="1.8"
        />
        {Array.from({ length: 8 }, (_, index) => {
          const angle = ((index * 45 + 22.5) * Math.PI) / 180;
          return (
            <circle
              key={index}
              cx={340 + 245 * Math.cos(angle)}
              cy={285 + 205 * Math.sin(angle)}
              r="3.5"
              fill={index % 4 === 0 ? '#c8a580' : '#bac4d0'}
            />
          );
        })}
      </svg>
      <div className="workspace-hub">
        <div className="workspace-hub-shadow" />
        <div className="workspace-hub-pulse" />
        <div className="workspace-hub-object">
          <div className="workspace-hub-base" />
          <div className="workspace-hub-top">
            {/* Crop the original logo to its T mark, retaining its exact artwork. */}
            <svg className="workspace-hub-mark" viewBox="20 140 550 520" fill="none">
              <defs>
                <clipPath id="tapvera-original-mark">
                  <path d="M20 140H570V370H325V670H20Z" />
                </clipPath>
              </defs>
              <image
                href="/brand/tapvera-crm.png"
                width="1981"
                height="793"
                clipPath="url(#tapvera-original-mark)"
              />
            </svg>
          </div>
        </div>
      </div>
      {modules.map((module, index) => (
        <div
          className="workspace-module-position"
          key={module.name}
          style={
            {
              left: `${module.x}%`,
              top: `${module.y}%`,
              '--module-delay': `${280 + index * 24}ms`,
            } as CSSProperties
          }
        >
          <div className="workspace-module">
            {customIcons[module.icon] ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={customIcons[module.icon]} />
              </svg>
            ) : (
              <Icon name={module.icon} />
            )}
            <span>{module.name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoginWaves() {
  return (
    <div className="workspace-login-waves" aria-hidden="true">
      <svg
        className="workspace-wave-top"
        viewBox="0 0 1100 900"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="login-wave-peach" x1="0" y1="0" x2=".8" y2=".7">
            <stop stopColor="#ffc5ad" />
            <stop offset=".65" stopColor="#ffe9df" />
            <stop offset="1" stopColor="#f4e8ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="login-wave-warm" x1=".15" y1="0" x2=".7" y2=".85">
            <stop stopColor="#ff9c18" />
            <stop offset=".25" stopColor="#ffb550" />
            <stop offset=".52" stopColor="#ffe4d6" />
            <stop offset="1" stopColor="#efe2ff" stopOpacity=".15" />
          </linearGradient>
        </defs>
        <path
          d="M320-70C190 30 140 170 72 310C-32 524-40 697 35 900H1100V-70Z"
          fill="url(#login-wave-peach)"
        />
        <path
          d="M650-35C430 24 220 90 103 255C-38 454-49 697 35 900H1100V-35Z"
          fill="url(#login-wave-warm)"
        />
      </svg>
      <svg
        className="workspace-wave-bottom"
        viewBox="0 0 1200 340"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="login-wave-purple" x1="0" y1="0" x2=".8" y2="1">
            <stop stopColor="#ddbdff" />
            <stop offset=".45" stopColor="#d3b2ff" />
            <stop offset="1" stopColor="#f8efff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="login-wave-lilac" x1="0" y1="0" x2=".8" y2=".6">
            <stop stopColor="#f1e1ff" />
            <stop offset=".6" stopColor="#ddc7ff" stopOpacity=".7" />
            <stop offset="1" stopColor="#f9f3ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M-20 76C120-20 290 192 477 214S777 93 974 167S1150 181 1220 149V360H-20Z"
          fill="url(#login-wave-purple)"
        />
        <path
          d="M-20 163C150 14 321 257 547 241S811 114 1008 210S1169 238 1220 211V360H-20Z"
          fill="url(#login-wave-lilac)"
        />
      </svg>
    </div>
  );
}
