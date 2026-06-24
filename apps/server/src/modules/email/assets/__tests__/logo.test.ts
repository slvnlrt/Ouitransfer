import { describe, expect, it } from "vitest";
import { EMAIL_LOGO_CID, emailLogoAttachment, emailLogoBuffer } from "../logo.js";

// 8-byte PNG signature.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("email logo asset", () => {
  it("decodes to a non-empty PNG buffer", () => {
    const buf = emailLogoBuffer();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  });

  it("builds an inline attachment referenced by the brand CID", () => {
    const att = emailLogoAttachment();
    expect(att.cid).toBe(EMAIL_LOGO_CID);
    expect(att.contentDisposition).toBe("inline");
    expect(att.filename).toBe("logo.png");
    expect(att.contentType).toBe("image/png");
    expect(Buffer.isBuffer(att.content)).toBe(true);
  });
});
