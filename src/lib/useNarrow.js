import { useEffect, useState } from 'react'

// True when the viewport is phone/tablet-narrow (matches the CSS breakpoint).
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 860px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const fn = (e) => setNarrow(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return narrow
}
