import type { Metadata } from "next";

/** С /admin на экран «Домой» добавляется «omf админ», который открывает модерацию. */
export const metadata: Metadata = {
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "omf админ",
    statusBarStyle: "black"
  }
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
