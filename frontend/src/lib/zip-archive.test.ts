import { describe, expect, it } from "vitest";
import { createStoredZip } from "./zip-archive";

describe("createStoredZip", () => {
  it("creates a valid archive with sanitized UTF-8 filenames", async () => {
    const blob = createStoredZip([
      { name: "meeting.txt", content: "Xin chào" },
      { name: "../notes/biên bản.txt", content: "Quyết định" },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);

    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(text).toContain("meeting.txt");
    expect(text).toContain("biên bản.txt");
    expect(text).not.toContain("../");
    expect(Array.from(bytes.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
