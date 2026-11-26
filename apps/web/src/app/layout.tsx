import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrivateSession } from "./private-session";
import "@auto-world/design-system/styles.css";
import "./site.css";

export const metadata: Metadata = {
  title: "AutoFindex · Espace privé",
  description: "Recherchez des véhicules et consultez les annonces et leurs photos dans le catalogue privé AutoFindex.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return <html lang="fr"><body data-aw-default-theme={process.env.NEXT_PUBLIC_PRIVATE_WEB === "1" ? "dark" : undefined}>{children}{process.env.NEXT_PUBLIC_PRIVATE_WEB === "1" && <PrivateSession />}</body></html>;
}
