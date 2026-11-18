import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Nav = {
  pathname: string;
  search: string;
  navigate: (href: string, replace?: boolean) => void;
};

const NavContext = createContext<Nav | null>(null);

function current(): { pathname: string; search: string } {
  const pathname = window.location.pathname;
  return {
    pathname: pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname || "/",
    search: window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : window.location.search,
  };
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const sync = () => setLoc(current());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const navigate = useCallback((href: string, replace = false) => {
    if (replace) window.history.replaceState({}, "", href);
    else window.history.pushState({}, "", href);
    setLoc(current());
  }, []);
  const value = useMemo(
    () => ({ pathname: loc.pathname, search: loc.search, navigate }),
    [loc.pathname, loc.search, navigate]
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const value = useContext(NavContext);
  if (!value) throw new Error("Client navigation is only available inside the Vite desk.");
  return value;
}
