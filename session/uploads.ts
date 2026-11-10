import { HttpError } from "./http";
import type { Store } from "./store";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SESSION_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Durable Object storage caps a value at 2 MiB; chunks stay well under it. */
const CHUNK_BYTES = 1024 * 1024;

interface UploadMeta {
  type: string;
  size: number;
  chunks: number;
  name: string;
}

const TOTAL = "uploads-total";
const metaKey = (id: string) => `upload:${id}`;
const chunkKey = (id: string, n: number) => `upload-chunk:${id}:${n}`;

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  sig.every((b, i) => bytes[offset + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** The image type the bytes really are (by signature), or null for anything that is not an image. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12))) {
    return "image/avif";
  }
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp";
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "image/tiff";
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart().toLowerCase();
  if ((head.startsWith("<svg") || head.startsWith("<?xml")) && head.includes("<svg")) {
    return "image/svg+xml";
  }
  return null;
}

/** Stores an uploaded image and returns its id. Throws `HttpError` for non-images or oversize. */
export function saveUpload(store: Store, bytes: Uint8Array, name: string): string {
  if (bytes.byteLength === 0) throw new HttpError(400, "Empty file");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new HttpError(413, `Images are limited to ${MAX_IMAGE_BYTES} bytes`);
  }
  const type = sniffImageType(bytes);
  if (!type) throw new HttpError(400, "File is not a supported image type");
  const total = store.get<number>(TOTAL) ?? 0;
  if (total + bytes.byteLength > MAX_SESSION_UPLOAD_BYTES) {
    throw new HttpError(413, "This session's upload space is full");
  }
  const id = crypto.randomUUID();
  const chunks = Math.ceil(bytes.byteLength / CHUNK_BYTES);
  for (let n = 0; n < chunks; n++) {
    store.put(chunkKey(id, n), bytes.slice(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES));
  }
  store.put<UploadMeta>(metaKey(id), { type, size: bytes.byteLength, chunks, name });
  store.put(TOTAL, total + bytes.byteLength);
  return id;
}

export function loadUpload(store: Store, id: string): { type: string; bytes: Uint8Array } | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const meta = store.get<UploadMeta>(metaKey(id));
  if (!meta) return null;
  const bytes = new Uint8Array(meta.size);
  let offset = 0;
  for (let n = 0; n < meta.chunks; n++) {
    const chunk = store.get<Uint8Array>(chunkKey(id, n));
    if (!chunk) return null;
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { type: meta.type, bytes };
}

/** Headers upstream sends on `/api/image`: an SVG opened directly must not run script. */
export function imageHeaders(type: string): Record<string, string> {
  return {
    "Content-Type": type,
    "Content-Security-Policy":
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
}
