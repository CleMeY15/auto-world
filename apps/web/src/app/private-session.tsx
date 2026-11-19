"use client";

import { useEffect } from "react";

export function PrivateSession() {
  useEffect(() => {
    function hide() { document.documentElement.style.visibility = "hidden"; }
    function restore(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("aw-private-session");
    if (channel) channel.onmessage = (event) => {
      if (event.data === "logout") { hide(); window.location.reload(); }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restore);
    return () => {
      channel?.close();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
    };
  }, []);

  return <nav className="site-container private-session-footer" aria-label="Session privée"><a className="site-nav" href="/acces/deconnexion">Se déconnecter</a></nav>;
}
