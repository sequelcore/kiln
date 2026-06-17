import { mediaToolMetadata } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { optionalString, requireString, toErrorResult } from "./tool-helpers.js";
import {
  DEFAULT_IMAGE_MAX_BYTES,
  ORIGINAL_IMAGE_MAX_BYTES,
  parseImageDetail,
  readSupportedImageFile,
} from "./image-tool-helpers.js";

export class ViewImageTool implements DevTool {
  readonly name = "view_image";
  readonly description = TOOL_SCHEMAS.view_image.description;
  readonly inputSchema = TOOL_SCHEMAS.view_image.inputSchema;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const pathInput = requireString(input, "path");
    if (!pathInput.ok) {
      return pathInput.result;
    }

    const detail = parseImageDetail(optionalString(input, "detail"));
    if (!detail) {
      return toErrorResult('Invalid input: "detail" must be "default" or "original"');
    }

    const maxBytes = detail === "original" ? ORIGINAL_IMAGE_MAX_BYTES : DEFAULT_IMAGE_MAX_BYTES;
    const image = await readSupportedImageFile(
      pathInput.value,
      sandbox,
      maxBytes,
      { toolName: "view_image", operation: "view_image" },
    );
    if (!image.ok) {
      return image.result;
    }

    const metadata = mediaToolMetadata("view_image", {
      operation: "view_image",
      path: image.value.path,
      mimeType: image.value.mimeType,
      size: image.value.size,
      ...(image.value.width !== undefined ? { width: image.value.width } : {}),
      ...(image.value.height !== undefined ? { height: image.value.height } : {}),
      detail,
    });
    const output = {
      path: metadata.path,
      mimeType: metadata.mimeType,
      size: metadata.size,
      ...(metadata.width !== undefined ? { width: metadata.width } : {}),
      ...(metadata.height !== undefined ? { height: metadata.height } : {}),
      detail: metadata.detail,
    };

    return {
      output: JSON.stringify(output, null, 2),
      isError: false,
      metadata,
      content: [
        {
          type: "image",
          data: image.value.content.toString("base64"),
          mimeType: image.value.mimeType,
        },
      ],
    };
  }
}
