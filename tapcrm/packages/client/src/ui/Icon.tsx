const paths: Record<string, string> = {
  hierarchy: 'M9 3h6v5H9z M2 16h6v5H2z M16 16h6v5h-6z M12 8v4 M5 16v-4h14v4',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  fit: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  monitor: 'M3 3h18v13H3z M8 21h8 M12 16v5',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0 M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  building: 'M4 21V3h12v18 M16 9h4v12 M2 21h20 M8 7h4 M8 11h4 M8 15h4',
  briefcase: 'M3 7h18v14H3z M8 7V3h8v4 M3 12c6 4 12 4 18 0 M12 12v4',
  chart: 'M3 3v18h18 M7 16v-4 M12 16V8 M17 16V5',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  logout: 'M9 4H3v16h6 M8 12h13 M16 7l5 5-5 5',
  check: 'M5 12l4 4L19 6',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
  clock: 'M12 6v6l4 2 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  calendar: 'M3 5h18v16H3z M3 9h18 M8 3v4 M16 3v4',
  plus: 'M12 5v14 M5 12h14',
  grip: 'M8 4h.01 M16 4h.01 M8 10h.01 M16 10h.01 M8 16h.01 M16 16h.01 M8 22h.01 M16 22h.01',
  close: 'M6 6l12 12 M18 6L6 18',
  refresh: 'M3 12a9 9 0 0 1 15-6.7l3-3v9h-9l3.7-3.7 M21 12a9 9 0 0 1-15 6.7l-3 3v-9h9l-3.7 3.7',
};
export function Icon({
  name,
  className = 'size-5',
}: {
  name: string;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths['building']} />
    </svg>
  );
}
