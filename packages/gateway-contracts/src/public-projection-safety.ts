import { z } from "zod";

/** Public operator text must not carry credential assignments or operator-specific filesystem paths. */
export const SafePublicDisplayTextSchema = z.string().min(1).max(512).refine(
  (value) => !hasUnsafePublicProjectionText(value),
  "Secret or operator-specific path text is not permitted in public projections.",
);

/** Portable logical identity only; absolute, drive-relative, empty, and traversal segments are forbidden. */
export const PortableLogicalPathSchema = z.string().min(1).max(512).refine(
  (value) => !/^(?:[A-Za-z]:|[\\/]{1,2})/u.test(value)
    && !value.includes("\\")
    && !value.split("/").some((segment) => segment === "." || segment === ".." || segment.length === 0),
  "A portable logical relative path is required.",
);

function hasUnsafePublicProjectionText(value: string): boolean {
  return /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|private|tmp|var|workspace|mnt)(?:[\\/]|$))/u.test(value)
    || /(?:^|[=:;,\s])(token|secret|password|api[_-]?key|credential|private[_-]?key)\s*[=:]/iu.test(value);
}
