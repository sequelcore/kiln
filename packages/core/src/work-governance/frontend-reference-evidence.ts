const PLACEHOLDER_FRONTEND_REFERENCE_MARKERS = [
  "<source url",
  "<kiln://",
  "<relevant frontend",
] as const;

const PRODUCT_UI_VISUAL_MARKERS = [
  "product ui",
  "product screenshot",
  "product image",
  "app ui",
  "app screenshot",
  "app image",
  "ui screenshot",
  "ui image",
  "interface screenshot",
  "interface image",
  "running app",
  "running vllm studio",
  "dashboard",
  "demo",
  "video",
  "video frame",
  "readme image",
  "readme screenshot",
  "docs image",
  "docs screenshot",
  "frontend screenshot",
  "browser visual reference",
  "browser_observe",
  "workstation ui screenshot",
  "technical workstation ui screenshot",
] as const;

const FRONTEND_SOURCE_MARKERS = [
  "frontend/",
  "frontend\\",
  "src/app",
  "src\\app",
  "src/components",
  "src\\components",
  ".tsx",
  ".jsx",
  ".css",
  "component",
  "layout",
  "navigation",
  "panel",
  "work surface",
  "composer",
  "status area",
  "typography",
  "spacing",
  "density",
] as const;

const CODE_BACKED_FRONTEND_DECLARATIONS = [
  "frontend implementation",
  "code-backed",
  "component structure",
  "layout pattern",
  "navigation model",
  "product ergonomics",
] as const;

const CODE_BACKED_SOURCE_SECTION_MARKERS = [
  "qualifying frontend found",
  "key source paths",
  "relevant paths",
  "relevant frontend file paths",
] as const;

const CODE_BACKED_ANALYSIS_MARKERS = [
  "extracted ui principles",
  "reusable principles",
  "ui principles",
  "extracted principles",
] as const;

export function containsFrontendReferenceEvidence(value: string): boolean {
  return containsProductUiVisualEvidence(value) || containsCodeBackedFrontendEvidence(value);
}

export function containsProductUiVisualEvidence(value: string): boolean {
  const normalized = value.toLowerCase();
  return hasReferenceSource(normalized)
    && !containsPlaceholderFrontendReference(normalized)
    && PRODUCT_UI_VISUAL_MARKERS.some((marker) => normalized.includes(marker));
}

export function containsCodeBackedFrontendEvidence(value: string): boolean {
  const normalized = value.toLowerCase();
  return hasReferenceSource(normalized)
    && !containsPlaceholderFrontendReference(normalized)
    && FRONTEND_SOURCE_MARKERS.some((marker) => normalized.includes(marker))
    && (
      CODE_BACKED_FRONTEND_DECLARATIONS.some((marker) => normalized.includes(marker))
      || containsStructuredCodeBackedFrontendAnalysis(normalized)
    );
}

export function containsLocalSourcePointer(value: string): boolean {
  const normalized = value.toLowerCase();
  return /(^|[\s"'`(])(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+[\\/])/.test(normalized)
    || normalized.includes("local source ")
    || normalized.includes("local repository ")
    || normalized.includes("file://");
}

function hasReferenceSource(normalized: string): boolean {
  return normalized.includes("http://")
    || normalized.includes("https://")
    || normalized.includes("kiln://")
    || containsLocalSourcePointer(normalized);
}

function containsPlaceholderFrontendReference(normalized: string): boolean {
  return PLACEHOLDER_FRONTEND_REFERENCE_MARKERS.some((marker) => normalized.includes(marker));
}

function containsStructuredCodeBackedFrontendAnalysis(normalized: string): boolean {
  return CODE_BACKED_SOURCE_SECTION_MARKERS.some((marker) => normalized.includes(marker))
    && CODE_BACKED_ANALYSIS_MARKERS.some((marker) => normalized.includes(marker));
}
