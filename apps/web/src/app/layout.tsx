import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@auto-world/design-system/styles.css";
import "./site.css";

export const metadata: Metadata = {
  title: "Auto World — Aperçu de l’interface",
  description: "Les premiers composants de l’interface Auto World.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
