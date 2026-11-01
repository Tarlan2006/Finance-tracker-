const paths = {
  groceries: 'M3 8h18l-2 12H5ZM8 8l4-5 4 5M9 12v4m6-4v4',
  cafe: 'M4 7h12v8a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM16 8h2a3 3 0 0 1 0 6h-2M7 3v1m5-1v1',
  transport: 'm5 8 2-4h10l2 4M3 17V9l2-1h14l2 1v8ZM5 17v3m14-3v3M6 12h2m8 0h2',
  gift: 'M3 8h18v4H3Zm2 4v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z',
  health: 'm9 5-4 4a7 7 0 0 0 10 10l4-4A7 7 0 0 0 9 5Zm-2 2 10 10',
  shopping: 'M4 7h16l1 14H3Zm4 0V5a4 4 0 0 1 8 0v2',
  leisure: 'M3 5h18v16H3ZM3 10h18M7 5l-3 5m9-5-3 5m9-5-3 5',
  education: 'M3 4h6l3 2 3-2h6v16h-6l-3 2-3-2H3ZM12 6v16',
  unexpected: 'm13 2-9 12h7l-1 8 10-12h-7Z',
  other: 'm3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4m-9 4v10',
  plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M18 6 6 18', back: 'm14 5-7 7 7 7', next: 'm10 5 7 7-7 7',
  expenses: 'M7 3h10a2 2 0 0 1 2 2v16l-4-2-3 2-3-2-4 2V5a2 2 0 0 1 2-2ZM8 8h8M8 12h5',
  overview: 'M10 3a9 9 0 1 0 11 11H10ZM14 2v8h8a9 9 0 0 0-8-8Z',
  more: 'M5 11v2M12 11v2M19 11v2', search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.5-2 5 5',
  filter: 'M4 7h16M7 12h10M10 17h4', check: 'm5 12 4 4L19 6', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  refresh: 'M20 7A9 9 0 0 0 4 7m16 0V2m0 5h-5M4 17a9 9 0 0 0 16 0M4 17v5m0-5h5',
  logout: 'M9 4H4v16h5m7-13 5 5-5 5M9 12h12', arrow: 'm7 17 10-10M7 7h10v10', erase: 'm9 5-7 7 7 7h12V5Zm4 4 5 6m0-6-5 6'
};
export type IconName = keyof typeof paths;
export default function Icon({ name }: { name: IconName }) { return <svg className="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>; }
