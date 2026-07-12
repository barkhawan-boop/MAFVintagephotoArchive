import {
  getPhotoImage,
  isAuthed,
  json,
  photoFilenames,
  photoKey,
  readPhotos,
  requireBindings,
  setLegacyPrimary,
  unauthorized,
  writePhotos,
  clean,
} from "./utils.js";

function clearPendingSlot(photos, pendingPhoto) {
  if (!pendingPhoto?.parent_id || !pendingPhoto?.pending_slot) {
    return;
  }
  const parent = photos.find((photo) => photo.id === pendingPhoto.parent_id);
  if (!parent?.pending_slots) {
    return;
  }
  delete parent.pending_slots[pendingPhoto.pending_slot];
  if (!Object.keys(parent.pending_slots).length) {
    delete parent.pending_slots;
  }
}

function editableFields(input = {}) {
  return {
    album: clean(input.album, 120) || "ئەلبوومی خێزان",
    year_taken: clean(input.year_taken, 80),
    description: clean(input.description, 600),
    people_names: clean(input.people_names, 300),
    uploaded_by: clean(input.uploaded_by, 120) || "نەزانراو",
  };
}

export async function onRequestPost({ request, env }) {
  try {
    requireBindings(env);
    if (!isAuthed(request, env)) {
      return unauthorized();
    }

    const { id, action, updates } = await request.json();
    const photos = await readPhotos(env);
    const index = photos.findIndex((photo) => photo.id === id);
    if (index === -1) {
      return json({ error: "Photo not found." }, 404);
    }

    if (action === "approve") {
      if (photos[index].parent_id && photos[index].pending_slot) {
        const pendingPhoto = photos[index];
        const parent = photos.find((photo) => photo.id === pendingPhoto.parent_id);
        const image = getPhotoImage(pendingPhoto, pendingPhoto.pending_slot);
        if (!parent || !image) {
          return json({ error: "Pending photo cannot be matched to its archive record." }, 400);
        }
        if (getPhotoImage(parent, pendingPhoto.pending_slot)) {
          return json({ error: "That image slot already has an approved photo." }, 400);
        }
        parent[pendingPhoto.pending_slot] = image;
        clearPendingSlot(photos, pendingPhoto);
        parent.updated_at = new Date().toISOString();
        setLegacyPrimary(parent);
        photos.splice(index, 1);
      } else {
        photos[index].status = "approved";
      }
    } else if (action === "disapprove") {
      clearPendingSlot(photos, photos[index]);
      photos[index].status = "disapproved";
    } else if (action === "edit") {
      Object.assign(photos[index], editableFields(updates));
      photos[index].updated_at = new Date().toISOString();
    } else if (action === "delete") {
      clearPendingSlot(photos, photos[index]);
      await Promise.all(photoFilenames(photos[index]).map((filename) => env.PHOTO_METADATA.delete(photoKey(filename))));
      photos.splice(index, 1);
    } else {
      return json({ error: "Unknown action." }, 400);
    }

    await writePhotos(env, photos);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
