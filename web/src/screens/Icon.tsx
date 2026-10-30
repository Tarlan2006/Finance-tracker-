const paths = {
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
