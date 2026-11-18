import { type ReactElement, useEffect, useState } from "react";

type Loader<P> = () => Promise<(props: P) => ReactElement | null>;

export default function dynamic<P extends object>(
  loader: Loader<P>,
  options?: { ssr?: boolean; loading?: () => ReactElement }
) {
  return function ViteDynamic(props: P) {
    const [Comp, setComp] = useState<((props: P) => ReactElement | null) | null>(null);
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
