import { NextResponse } from "next/server";

/**
 * Манифест админки: добавили на экран «Домой» со страницы /admin — иконка «omf админ»
 * открывает сразу очередь модерации. Путь под /admin/, чтобы middleware не уводил на /login.
 */
export function GET() {
  return NextResponse.json(
    {
      name: "omf админ",
      short_name: "omf админ",
      start_url: "/admin",
      scope: "/",
      display: "standalone",
      background_color: "#1A1D24",
      theme_color: "#1A1D24",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
      ]
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } }
  );
}
