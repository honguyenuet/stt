import { renderToStaticMarkup } from "react-dom/server";
import { CircleCheck } from "lucide-react";
import { siGoogle } from "simple-icons";
import { describe, expect, it } from "vitest";

import {
  AppIcon,
  BrandIcon,
  ICON_SIZES,
  ICON_STROKE_WIDTH,
} from "./app-icon";

describe("app icon system", () => {
  it("uses the 16, 20 and 24 pixel size scale", () => {
    expect(ICON_SIZES).toEqual({ sm: 16, md: 20, lg: 24 });
  });

  it("renders decorative Lucide icons with a consistent stroke", () => {
    const markup = renderToStaticMarkup(
      <AppIcon icon={CircleCheck} size="sm" />,
    );

    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="16"');
    expect(markup).toContain(`stroke-width="${ICON_STROKE_WIDTH}"`);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("gives informative icons an accessible name", () => {
    const markup = renderToStaticMarkup(
      <AppIcon icon={CircleCheck} label="Hoàn tất" size="lg" />,
    );

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Hoàn tất"');
    expect(markup).not.toContain('aria-hidden="true"');
  });

  it("renders Simple Icons paths with currentColor", () => {
    const markup = renderToStaticMarkup(
      <BrandIcon icon={siGoogle} size="md" tone="brand" />,
    );

    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('width="20"');
    expect(markup).toContain(`color:#${siGoogle.hex}`);
    expect(markup).toContain(`d="${siGoogle.path}`);
  });
});
