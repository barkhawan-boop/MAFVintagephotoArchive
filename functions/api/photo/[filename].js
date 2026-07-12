import { getPhotoImages, json, photoKey, readPhotos, requireBindings } from "../utils.js";

export async function onRequestGet({ env, params }) {
  try {
    requireBindings(env);
    const photos = await readPhotos(env);
    const photo = photos.find((item) => getPhotoImages(item).some((image) => image.filename === params.filename) || item.filename === params.filename);
    const photoImage = photo ? getPhotoImages(photo).find((image) => image.filename === params.filename) : null;
    const image = await env.PHOTO_METADATA.get(photoKey(params.filename), "arrayBuffer");
    if (!image) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(image, {
      headers: {
        "content-type": photoImage?.content_type || photo?.content_type || "application/octet-stream",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
