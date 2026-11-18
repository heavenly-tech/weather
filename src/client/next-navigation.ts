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
    push(href: string, _options?: { scroll?: boolean }) {
      navigate(href, false);
    },
    replace(href: string, _options?: { scroll?: boolean }) {
      navigate(href, true);
    },
  };
}
