import { describe, expect, it } from "vitest";
import { createImageInputParts, imageInputDisplayText } from "../src/image-input-parts.js";

describe("image-input-parts", () => {
  it("creates canonical image parts from an image file", async () => {
    const image = new Blob(["abc"], { type: "image/png" });

    await expect(createImageInputParts({ image })).resolves.toEqual([{
      type: "image",
      mimeType: "image/png",
      data: "YWJj",
    }]);
  });

  it("rejects non-image blobs", async () => {
    const text = new Blob(["abc"], { type: "text/plain" });

    await expect(createImageInputParts({ image: text })).rejects.toThrow("Image input must be an image MIME type.");
  });

  it("describes selected image files for operator-visible display", () => {
    expect(imageInputDisplayText("queja.png")).toBe("Image: queja.png");
    expect(imageInputDisplayText()).toBe("Image input");
  });
});
