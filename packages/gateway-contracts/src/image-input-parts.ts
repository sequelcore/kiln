export interface ImageInputBlobLike {
  readonly type?: string;
  readonly size?: number;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export interface ImageInputImagePart {
  readonly type: "image";
  readonly mimeType: string;
  readonly data: string;
}

export interface ImageInputPartsInput {
  readonly image: ImageInputBlobLike;
  readonly mimeType?: string;
  readonly maxBytes?: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function normalizeMimeType(input: ImageInputPartsInput): string {
  const mimeType = (input.mimeType ?? input.image.type ?? "").trim();
  if (!mimeType.startsWith("image/")) {
    throw new Error("Image input must be an image MIME type.");
  }
  return mimeType;
}

async function readImageBuffer(image: ImageInputBlobLike): Promise<ArrayBuffer> {
  if (typeof image.arrayBuffer === "function") {
    return image.arrayBuffer();
  }

  const fileReaderCtor = (globalThis as {
    readonly FileReader?: new () => {
      result: string | ArrayBuffer | null;
      error: unknown;
      onload: (() => void) | null;
      onerror: (() => void) | null;
      readAsArrayBuffer(value: unknown): void;
    };
  }).FileReader;
  if (!fileReaderCtor) {
    throw new Error("Image input blob cannot be read in this environment.");
  }

  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new fileReaderCtor();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error("Image input blob reader did not return an ArrayBuffer."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Image input blob read failed."));
    reader.readAsArrayBuffer(image);
  });
}

export function imageInputDisplayText(filename?: string): string {
  const normalized = filename?.trim();
  if (!normalized) {
    return "Image input";
  }
  return `Image: ${normalized}`;
}

export async function createImageInputParts(input: ImageInputPartsInput): Promise<readonly ImageInputImagePart[]> {
  const mimeType = normalizeMimeType(input);
  const buffer = await readImageBuffer(input.image);
  if (input.maxBytes !== undefined && buffer.byteLength > input.maxBytes) {
    throw new Error(`Image input exceeds the configured ${input.maxBytes} byte limit.`);
  }

  return [{
    type: "image",
    mimeType,
    data: toBase64(new Uint8Array(buffer)),
  }];
}
