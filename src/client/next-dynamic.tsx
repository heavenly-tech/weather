/* eslint-disable @typescript-eslint/no-explicit-any -- stand-in for next/dynamic's loose component type */
import { type ComponentType, type ReactElement, useEffect, useState } from "react";

// The Vite stand-in for next/dynamic. Props stay at the call site; the loader
// only has to resolve to a component.
export default function dynamic(
  loader: () => Promise<ComponentType<any>>,
  options?: { ssr?: boolean; loading?: () => ReactElement }
): ComponentType<any> {
  return function ViteDynamic(props) {
    const [Comp, setComp] = useState<ComponentType<any> | null>(null);
    useEffect(() => {
      let live = true;
      loader().then((loaded) => {
        if (live) setComp(() => loaded);
      });
      return () => {
        live = false;
      };
    }, []);
    if (!Comp) {
      const Loading = options?.loading;
      return Loading ? <Loading /> : null;
    }
    return <Comp {...props} />;
  };
}
