// Shrinking a picked photo in the browser before it is uploaded (crowd test options, chat pictures).

const DEFAULT_TYPES = ["image/jpeg", "image/png", "image/webp"];

const hinted = (hint) => Object.assign(new Error(hint), { hint });

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** Shrinks a picked file to at most `maxSide` px on its long side and re-encodes it (WebP, else JPEG) under
 * `maxBytes`, so a phone photo uploads in a moment. Resolves to { blob, ext, width, height }; rejects with an Error
 * whose `.hint` is bad_type, unreadable or too_big. */
export async function prepareImage(file, { maxSide = 1024, maxBytes = 900 * 1024, types = DEFAULT_TYPES, maxInput = 25 * 1024 * 1024 } = {}) {
  if (!file || !types.includes(file.type)) throw hinted("bad_type");
  if (file.size > maxInput) throw hinted("too_big");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try { bitmap = await createImageBitmap(file); } catch { throw hinted("unreadable"); }
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  for (const [type, ext] of [["image/webp", "webp"], ["image/jpeg", "jpg"]]) {
    for (const quality of [0.86, 0.76, 0.64, 0.5]) {
      const blob = await canvasBlob(canvas, type, quality);
      // a browser that cannot encode the type hands back a PNG instead: skip to the next type
      if (!blob || blob.type !== type) break;
      if (blob.size <= maxBytes) return { blob, ext, width, height };
    }
  }
  throw hinted("too_big");
}
