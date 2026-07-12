const METADATA_KEY = "photos";
const PHOTO_KEY_PREFIX = "photo:";
export const IMAGE_SLOT_KEYS = ["old_photo", "restored_photo"];

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function requireBindings(env) {
  if (!env.PHOTO_METADATA) {
    throw new Error("Cloudflare KV is not connected. Add a KV namespace binding named PHOTO_METADATA, then redeploy.");
  }
}

export function isAuthed(request, env) {
  const header = request.headers.get("authorization") || request.headers.get("x-admin-auth") || "";
  if (!header.startsWith("Basic ")) {
    return false;
  }
  try {
    const acceptedCredentials = [
      { username: env.ADMIN_USER || "Admin", password: env.ADMIN_PASSWORD || "Admin123" },
    ];
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    if (separator === -1) {
      return false;
    }
    const username = decoded.slice(0, separator).trim().toLowerCase();
    const password = decoded.slice(separator + 1).trim();
    return acceptedCredentials.some((credential) => {
      const expectedUser = String(credential.username || "").trim().toLowerCase();
      const expectedPassword = String(credential.password || "").trim();
      return username === expectedUser && password === expectedPassword;
    });
  } catch {
    return false;
  }
}

export function unauthorized() {
  return json({ error: "Wrong username or password." }, 401);
}

export async function readPhotos(env) {
  const raw = await env.PHOTO_METADATA.get(METADATA_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writePhotos(env, photos) {
  await env.PHOTO_METADATA.put(METADATA_KEY, JSON.stringify(photos));
}

export function photoKey(filename) {
  return `${PHOTO_KEY_PREFIX}${filename}`;
}

export function normalizeImageRecord(image) {
  if (!image || typeof image !== "object" || !image.filename) {
    return null;
  }
  return {
    filename: String(image.filename),
    content_type: image.content_type || "image/jpeg",
    original_filename: image.original_filename || image.filename,
  };
}

export function legacyImageRecord(photo) {
  if (!photo || !photo.filename) {
    return null;
  }
  return normalizeImageRecord({
    filename: photo.filename,
    content_type: photo.content_type,
    original_filename: photo.original_filename,
  });
}

export function getPhotoImage(photo, slotKey) {
  const image = normalizeImageRecord(photo?.[slotKey]);
  if (image) {
    return image;
  }
  if (slotKey === "old_photo" && !photo?.old_photo && !photo?.restored_photo) {
    return legacyImageRecord(photo);
  }
  return null;
}

export function getPhotoImages(photo) {
  const seen = new Set();
  return IMAGE_SLOT_KEYS.map((slotKey) => getPhotoImage(photo, slotKey))
    .filter((image) => {
      if (!image || seen.has(image.filename)) {
        return false;
      }
      seen.add(image.filename);
      return true;
    });
}

export function photoFilenames(photo) {
  const names = new Set();
  if (photo?.filename) {
    names.add(photo.filename);
  }
  getPhotoImages(photo).forEach((image) => names.add(image.filename));
  return [...names];
}

export function setLegacyPrimary(photo) {
  const primary = getPhotoImage(photo, "old_photo") || getPhotoImage(photo, "restored_photo") || legacyImageRecord(photo);
  if (!primary) {
    return photo;
  }
  photo.filename = primary.filename;
  photo.content_type = primary.content_type;
  photo.original_filename = primary.original_filename;
  return photo;
}

export function clean(value, maxLength = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function extensionFromName(name, contentType) {
  const lower = String(name || "").toLowerCase();
  const match = lower.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/);
  if (match) {
    return `.${match[1]}`;
  }
  if (contentType === "image/png") return ".png";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}
