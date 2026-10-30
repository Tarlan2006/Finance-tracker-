import { useEffect, useState } from 'react';
export function useMedia(query: string) { const [matches, setMatches] = useState(() => matchMedia(query).matches); useEffect(() => { const media = matchMedia(query), change = () => setMatches(media.matches); change(); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, [query]); return matches; }
