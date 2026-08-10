import type { CSSProperties, SVGProps } from "react";
import type { LucideIcon } from "lucide-react";
import type { SimpleIcon } from "simple-icons";

import { cn } from "@/lib/utils";

export const ICON_SIZES = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export const ICON_STROKE_WIDTH = 2;

export type IconSize = keyof typeof ICON_SIZES;

interface AccessibleIconProps {
  className?: string;
  label?: string;
  size?: IconSize;
}

interface AppIconProps extends AccessibleIconProps {
  icon: LucideIcon;
}

interface BrandIconProps extends AccessibleIconProps {
  icon: SimpleIcon;
  tone?: "brand" | "current";
}

function getAccessibilityProps(label?: string) {
  return label
    ? ({ "aria-label": label, role: "img" } as const)
    : ({ "aria-hidden": true } as const);
}

export function AppIcon({
  className,
  icon: Icon,
  label,
  size = "md",
}: AppIconProps) {
  const pixels = ICON_SIZES[size];

  return (
    <Icon
      className={cn("shrink-0", className)}
      focusable="false"
      size={pixels}
      strokeWidth={ICON_STROKE_WIDTH}
      {...getAccessibilityProps(label)}
    />
  );
}

export function BrandIcon({
  className,
  icon,
  label,
  size = "md",
  tone = "current",
}: BrandIconProps) {
  const pixels = ICON_SIZES[size];
  const style =
    tone === "brand"
      ? ({ color: `#${icon.hex}` } satisfies CSSProperties)
      : undefined;
  const accessibilityProps = getAccessibilityProps(label);

  return (
    <svg
      className={cn("shrink-0", className)}
      fill="currentColor"
      focusable="false"
      height={pixels}
      style={style}
      viewBox="0 0 24 24"
      width={pixels}
      xmlns="http://www.w3.org/2000/svg"
      {...(accessibilityProps as SVGProps<SVGSVGElement>)}
    >
      <path d={icon.path} />
    </svg>
  );
}
