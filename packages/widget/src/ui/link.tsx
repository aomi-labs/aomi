"use client";

import { createContext, useContext, type AnchorHTMLAttributes } from "react";

export const ShellNavigationContext = createContext<
  ((path: string) => void) | null
>(null);

export default function Link({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigate = useContext(ShellNavigationContext);
  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          navigate &&
          (href === "/statement" || href === "/")
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}
