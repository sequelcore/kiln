// Type declaration for unpdf (optional dependency, dynamically imported)
declare module "unpdf" {
  export function extractText(data: ArrayBuffer): Promise<{ text: string; totalPages: number }>;
}
