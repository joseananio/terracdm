import { forwardRef, type HTMLAttributes } from "react";

export const FloatingPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function FloatingPanel({ className, ...props }, ref) {
  return <div ref={ref} className={`floating-panel${className ? ` ${className}` : ""}`} {...props} />;
});
