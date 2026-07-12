import {
  clean,
  extensionFromName,
  getPhotoImage,
  legacyImageRecord,
  json,
  photoKey,
  readPhotos,
  requireBindings,
  writePhotos,
} from "./utils.js";

const MAX_KV_IMAGE_BYTES = 10 * 1024 * 1024;
const SLOT_KEYS = new Set(["old_photo", "restored_photo"]);

function hasUpload(file) {
  return file && typeof file !== "string" && file.size > 0 && file.name;
}

function validateImage(file) {
  if (!hasUpload(file) || !file.type.startsWith("image/")) {
    return json({ error: "Please choose an image file." }, 400);
  }
  if (file.size > MAX_KV_IMAGE_BYTES) {
    return json({ error: "Image is too large. Please upload an image under 10 MB." }, 400);
  }
  return null;
}

async function storeImage(env, file) {
  const extension = extensionFromName(file.name, file.type);
  const filename = `${crypto.randomUUID()}${extension}`;
  await env.PHOTO_METADATA.put(photoKey(filename), await file.arrayBuffer());
  return {
    filename,
    content_type: file.type || "image/jpeg",
    original_filename: clean(file.name, 180),
  };
}

async function addPhotoSlot(env, form) {
  const photoId = clean(form.get("photo_id"), 80);
  const slot = clean(form.get("slot"), 40);
  const file = form.get("slot_photo");
  if (!photoId || !SLOT_KEYS.has(slot)) {
    return json({ error: "Photo or slot is missing." }, 400);
  }

  const validationError = validateImage(file);
  if (validationError) {
    return validationError;
  }

  const photos = await readPhotos(env);
  const index = photos.findIndex((photo) => photo.id === photoId);
  if (index === -1) {
    return json({ error: "Photo not found." }, 404);
  }
  if (photos[index].status !== "approved") {
    return json({ error: "Photo must be approved before adding the second image." }, 400);
  }
  if (!photos[index].old_photo && !photos[index].restored_photo && photos[index].filename) {
    photos[index].old_photo = legacyImageRecord(photos[index]);
  }
  if (getPhotoImage(photos[index], slot)) {
    return json({ error: "That image slot already has a photo." }, 400);
  }
  if (photos[index].pending_slots?.[slot] || photos.some((photo) => photo.parent_id === photoId && photo.pending_slot === slot && photo.status === "pending")) {
    return json({ error: "That image is already waiting for admin approval." }, 400);
  }

  const image = await storeImage(env, file);
  const pendingPhoto = {
    id: crypto.randomUUID(),
    parent_id: photoId,
    pending_slot: slot,
    filename: image.filename,
    content_type: image.content_type,
    original_filename: image.original_filename,
    old_photo: slot === "old_photo" ? image : null,
    restored_photo: slot === "restored_photo" ? image : null,
    description: photos[index].description || "",
    year_taken: photos[index].year_taken || "",
    people_names: photos[index].people_names || "",
    uploaded_by: clean(form.get("uploaded_by"), 120) || photos[index].uploaded_by || "Gallery visitor",
    album: photos[index].album || "ئەلبوومی خێزان",
    status: "pending",
    created_at: new Date().toISOString(),
  };
  photos[index].pending_slots = {
    ...(photos[index].pending_slots || {}),
    [slot]: true,
  };
  photos[index].updated_at = new Date().toISOString();
  photos.unshift(pendingPhoto);
  await writePhotos(env, photos);
  return json({ ok: true, pending: true, photo: pendingPhoto });
}

export async function onRequestPost({ request, env }) {
  try {
    requireBindings(env);
    const form = await request.formData();

    if (form.get("photo_id")) {
      return addPhotoSlot(env, form);
    }

    const oldFile = form.get("old_photo") || form.get("photo");
    const restoredFile = form.get("restored_photo");
    if (!hasUpload(oldFile) && !hasUpload(restoredFile)) {
      return json({ error: "Please choose an old photo, a restored photo, or both." }, 400);
    }
    if (hasUpload(oldFile)) {
      const oldError = validateImage(oldFile);
      if (oldError) return oldError;
    }
    if (hasUpload(restoredFile)) {
      const restoredError = validateImage(restoredFile);
      if (restoredError) return restoredError;
    }

    const oldPhoto = hasUpload(oldFile) ? await storeImage(env, oldFile) : null;
    const restoredPhoto = hasUpload(restoredFile) ? await storeImage(env, restoredFile) : null;
    const primary = oldPhoto || restoredPhoto;

    const photo = {
      id: crypto.randomUUID(),
      filename: primary.filename,
      content_type: primary.content_type,
      original_filename: primary.original_filename,
      old_photo: oldPhoto,
      restored_photo: restoredPhoto,
      description: clean(form.get("description"), 600),
      year_taken: clean(form.get("year_taken"), 80),
      people_names: clean(form.get("people_names"), 300),
      uploaded_by: clean(form.get("uploaded_by"), 120),
      album: clean(form.get("album"), 120) || "ئەلبوومی خێزان",
      status: "pending",
      created_at: new Date().toISOString(),
    };

    const photos = await readPhotos(env);
    photos.unshift(photo);
    await writePhotos(env, photos);
    return json({ ok: true, photo });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
