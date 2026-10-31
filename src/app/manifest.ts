import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/env";

// Web app manifest (/manifest.webmanifest): the icon Android and Chrome use when
// someone adds the site to their home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: "Easy, flavorful gluten-free recipes for everyday cooking.",
    start_url: "/",
    display: "browser",
    background_color: "#faf8f3",
    theme_color: "#faf8f3",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
