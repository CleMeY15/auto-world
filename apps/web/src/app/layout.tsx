import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrivateSession } from "./private-session";
import "@auto-world/design-system/styles.css";
import "./site.css";

export const metadata: Metadata = {
  title: "AutoFind · Espace privé",
  description: "L’espace privé AutoFind pour rechercher, consulter et comparer les annonces de démonstration.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return <html lang="fr"><body>{children}{process.env.NEXT_PUBLIC_PRIVATE_WEB === "1" && <PrivateSession />}</body></html>;
}
