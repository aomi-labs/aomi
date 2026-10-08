import type { ButtonHTMLAttributes } from "react";

import { cn } from "@aomi-labs/react";

export function ModalBackdrop({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      data-slot="modal-backdrop"
      className={cn(
        "absolute inset-0 cursor-default bg-black/20 backdrop-blur-[3px]",
        className,
      )}
      {...props}
    />
  );
}
