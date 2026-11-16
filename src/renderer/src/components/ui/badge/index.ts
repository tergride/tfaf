import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

export const badgeVariants = cva(
  "plate plate-control plate-focus cut-xs inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-colors overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "bg-primary font-semibold text-primary-foreground [--plate-border:transparent] [a&]:hover:brightness-110",
        secondary:
          "bg-secondary text-secondary-foreground [--plate-border:transparent] [a&]:hover:bg-accent",
        destructive:
         "bg-destructive/80 text-white [--plate-border:transparent] [a&]:hover:bg-destructive",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        muted: "bg-muted text-muted-foreground [--plate-border:transparent]",
        accent: "bg-primary/12 text-primary [--plate-border:color-mix(in_srgb,var(--color-primary)_35%,transparent)]",
        success: "bg-success/12 text-success [--plate-border:color-mix(in_srgb,var(--color-success)_35%,transparent)]",
        warning: "bg-warning/12 text-warning [--plate-border:color-mix(in_srgb,var(--color-warning)_35%,transparent)]",
        info: "bg-info/12 text-info [--plate-border:color-mix(in_srgb,var(--color-info)_35%,transparent)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
