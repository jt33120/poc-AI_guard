// Server-safe constant: may be inserted by Next's root layout before first paint.
export const SIGNAL_BOOTSTRAP_SCRIPT =
  "try{var p=JSON.parse(localStorage.getItem('xsom-signal-preferences')||'{}');var h=document.documentElement;h.dataset.theme=p.theme==='dark'?'dark':'light';var r=p.reduced===true||matchMedia('(prefers-reduced-motion: reduce)').matches;h.dataset.reducedMotion=String(r);h.dataset.motion=r?'off':'on'}catch(e){}";
