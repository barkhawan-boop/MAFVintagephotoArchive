import { isAuthed, json, readPhotos, requireBindings, unauthorized } from "./utils.js";

export async function onRequestGet({ request, env }) {
  try {
    requireBindings(env);
    const url = new URL(request.url);
    const wantsAll = url.searchParams.get("all") === "1";
    if (wantsAll && !isAuthed(request, env)) {
      return unauthorized();
    }

    let photos = await readPhotos(env);
    if (!wantsAll) {
      photos = photos.filter((photo) => photo.status === "approved");
    }
    return json({ photos });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
