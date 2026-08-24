import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VbeePublicFooter } from "./vbee-public-chrome";

describe("VbeePublicFooter", () => {
  it("renders the shared Vbee product, system and contact content", () => {
    const markup = renderToStaticMarkup(<VbeePublicFooter />);
    const plainText = markup.replace(/<[^>]+>/g, "");

    expect(markup).toContain('aria-label="Chân trang Vbee AI"');
    expect(markup).toContain(
      "Không gian giọng nói Vbee AI tập trung vào chuyển giọng nói thành văn bản, Realtime, thời lượng và gói cước trong một giao diện thống nhất.",
    );
    expect(markup).toContain("Sản phẩm");
    expect(markup).toContain('href="/history"');
    expect(markup).toContain("Hệ thống");
    expect(markup).toContain("Thời lượng");
    expect(markup).toContain("Thanh toán");
    expect(markup).toContain("Liên hệ");
    expect(markup).toContain('href="mailto:contact@vbee.ai"');
    expect(markup).toContain('href="tel:+842499993399"');
    expect(plainText).toContain(
      "© 2026 Không gian giọng nói Vbee AI. Điều khoản dịch vụ · Chính sách bảo mật.",
    );
  });
});
