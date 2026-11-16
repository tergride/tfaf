import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Toggle } from "./Toggle.vue"

export const toggleVariants = cva(
  "plate plate-control plate-focus cut-sm inline-flex items-center justify-center gap-2 text-sm font-medium hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary/12 data-[state=on]:text-primary data-[state=on]:[--plate-border:var(--color-primary)] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 transition-colors aria-invalid:[--plate-border:var(--color-destructive)] whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-transparent [--plate-border:transparent]",
        outline:
          "bg-secondary text-muted-foreground",
      },
      size: {
        default: "h-9 px-2 min-w-9",
        sm: "h-8 px-1.5 min-w-8",
        lg: "h-10 px-2.5 min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export type ToggleVariants = VariantProps<typeof toggleVariants>
