import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/15", className)} value={value} {...props}>
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("h-full w-full flex-1 bg-primary transition-all", value == null && "animate-pulse")}
        style={{ transform: `translateX(-${100 - (value ?? 35)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
