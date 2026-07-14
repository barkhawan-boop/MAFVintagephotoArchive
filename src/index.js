import { onRequestPost as adminPost } from "../functions/api/admin.js";
import { onRequestGet as photoGet } from "../functions/api/photo/[filename].js";
import { onRequestGet as photosGet } from "../functions/api/photos.js";
import { onRequestPost as rootsChatPost } from "../functions/api/roots-chat.js";
import { onRequestPost as uploadPost } from "../functions/api/upload.js";

function methodNotAllowed() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: "GET, POST" },
  });
}

function notFound() {
  return new Response("Not Found", { status: 404 });
}

async function routeApi(request, env, ctx, pathname) {
  if (pathname === "/api/photos") {
    return request.method === "GET" ? photosGet({ request, env, ctx }) : methodNotAllowed();
  }
  if (pathname === "/api/admin") {
    return request.method === "POST" ? adminPost({ request, env, ctx }) : methodNotAllowed();
  }
  if (pathname === "/api/upload") {
    return request.method === "POST" ? uploadPost({ request, env, ctx }) : methodNotAllowed();
  }
  if (pathname === "/api/roots-chat") {
    return request.method === "POST" ? rootsChatPost({ request, env, ctx }) : methodNotAllowed();
  }

  const photoMatch = pathname.match(/^\/api\/photo\/([^/]+)$/);
  if (photoMatch) {
    return request.method === "GET"
      ? photoGet({ request, env, ctx, params: { filename: decodeURIComponent(photoMatch[1]) } })
      : methodNotAllowed();
  }

  return notFound();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return routeApi(request, env, ctx, url.pathname);
    }
    return env.STATIC_ASSETS.fetch(request);
  },
};
