import type { MetadataRoute } from "next";

/** The web app manifest: added to a phone's home screen, the portfolio opens full screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Siddarath Vats · AI Engineer",
    short_name: "Siddarath",
    description: "A walk through a hand-built little town: AI agents, search and machine-learning projects.",
    start_url: "/",
    display: "fullscreen",
    orientation: "any",
    background_color: "#5cc4bb",
    theme_color: "#5cc4bb",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
