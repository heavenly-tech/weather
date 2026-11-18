import { useNav } from "./nav";

export function usePathname(): string {
  return useNav().pathname;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(useNav().search);
}

export function useRouter() {
  const { navigate } = useNav();
  return {
    push(href: string) {
      navigate(href, false);
    },
    replace(href: string) {
      navigate(href, true);
    },
  };
}
