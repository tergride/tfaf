import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

export const buttonVariants = cva(
  "plate-control inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[color,background-color,filter] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:[--plate-border:var(--color-destructive)]",
  {
    variants: {
      variant: {
        default:
          "plate plate-focus bg-primary font-semibold text-primary-foreground hover:brightness-110 [--plate-border:var(--color-primary)]",
        destructive:
          "plate plate-focus bg-destructive/80 text-white hover:bg-destructive [--plate-border:transparent]",
        outline:
          "plate plate-focus bg-secondary hover:bg-accent hover:text-accent-foreground hover:[--plate-border:var(--color-input)]",
        secondary:
          "plate plate-focus bg-secondary text-secondary-foreground hover:bg-accent [--plate-border:transparent]",
        ghost:
          "plate plate-focus hover:bg-accent hover:text-accent-foreground [--plate-border:transparent]",
        link: "rounded-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
      },
      size: {
        "default": "h-9 px-4 py-2 has-[>svg]:px-3",
        "xs": "h-6 gap-1 px-2 text-xs cut-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        "sm": "h-8 gap-1.5 px-3 cut-sm has-[>svg]:px-2.5",
        "lg": "h-10 px-6 has-[>svg]:px-4",
        "icon": "size-9 cut-sm",
        "icon-xs": "size-6 cut-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 cut-sm",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
