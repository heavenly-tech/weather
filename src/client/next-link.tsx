import { forwardRef } from "react";
import { useNav } from "./nav";

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  scroll?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, onClick, ...props },
  ref
) {
  delete props.scroll;
  const { navigate } = useNav();
  return (
    <a
      {...props}
      ref={ref}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!href.startsWith("/")) return;
        event.preventDefault();
        navigate(href);
      }}
    />
  );
});

export default Link;
