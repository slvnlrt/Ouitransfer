import { cn } from "@/lib/utils";

type SpinnerSize = "xs" | "sm" | "md" | "lg";

interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual size of the spinner. Defaults to "md". */
  size?: SpinnerSize;
  /** Accessible label for screen readers. Defaults to "Loading…". */
  label?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  xs: "h-3.5 w-3.5 border-[1.5px]",
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-2",
};

/**
 * Inline spinner for buttons, table rows, and other small contexts.
 *
 * Uses a CSS border approach: a full-circle border with one side transparent
 * to create the spinning arc effect. The color inherits from the parent
 * via `border-current` unless overridden via `className`.
 *
 * For full-page loading states, use `<Loader />` from `@/components/ui/loader`.
 */
export function Spinner({ size = "md", label = "Loading…", className, ...props }: SpinnerProps) {
  return (
    <div
      role="status"
      className={cn(
        "animate-spin rounded-full border-primary border-t-transparent",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}
