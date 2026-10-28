// Pinterest Pin artwork: the recipe's own photo with the title set below it,
// 1000 x 1500 (2:3). Rendered with next/og (Satori) for the text and sharp for
// the photo, so it works in the web app and in the GitHub Actions worker, and
// costs nothing: no AI image is generated. The photo is only cropped, never
// altered, so the Pin shows the real dish from the recipe page.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { PinArtwork } from "./metadata";

export const PIN_WIDTH = 1000;
export const PIN_HEIGHT = 1500;

const PHOTO_HEIGHT = 960;
const COLORS = {
  cream: "#faf8f3",
  ink: "#252525",
  inkSoft: "#57534b",
  sage: "#536b4f",
  line: "#d6cfbf",
};

type Font = { name: string; data: Buffer; weight: 500 | 600; style: "normal" };
let fonts: Promise<Font[]> | null = null;

// The fonts are the site's own (Fraunces and Inter, SIL Open Font License),
// committed next to this file so rendering never downloads anything.
function loadFonts(): Promise<Font[]> {
  const dir = join(process.cwd(), "src/lib/pins/fonts");
  fonts ??= Promise.all([
    readFile(join(dir, "fraunces-latin-600-normal.woff")).then((data): Font => ({ name: "Fraunces", data, weight: 600, style: "normal" })),
    readFile(join(dir, "inter-latin-500-normal.woff")).then((data): Font => ({ name: "Inter", data, weight: 500, style: "normal" })),
    readFile(join(dir, "inter-latin-600-normal.woff")).then((data): Font => ({ name: "Inter", data, weight: 600, style: "normal" })),
  ]).catch((err) => {
    fonts = null;
    throw err;
  });
  return fonts;
}

/** Long titles get a smaller size so they always fit in three or four lines. */
export function titleFontSize(title: string): number {
  const n = title.length;
  if (n <= 28) return 78;
  if (n <= 45) return 68;
  if (n <= 65) return 60;
  return 52;
}

/** Crops the photo to the Pin's photo area, keeping the most interesting part. */
async function preparePhoto(photo: Uint8Array): Promise<string> {
  const jpeg = await sharp(photo)
    .rotate()
    .resize(PIN_WIDTH, PHOTO_HEIGHT, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** Renders the Pin as a progressive JPEG (Pinterest accepts JPEG and PNG). */
export async function renderPinImage(photo: Uint8Array, art: PinArtwork): Promise<Buffer> {
  const [src, fontList] = await Promise.all([preparePhoto(photo), loadFonts()]);
  const fontSize = titleFontSize(art.title);

  const response = new ImageResponse(
    (
      <div style={{ width: PIN_WIDTH, height: PIN_HEIGHT, display: "flex", flexDirection: "column", backgroundColor: COLORS.cream, fontFamily: "Inter" }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={src} width={PIN_WIDTH} height={PHOTO_HEIGHT} style={{ width: PIN_WIDTH, height: PHOTO_HEIGHT, objectFit: "cover" }} />
        <div style={{ position: "absolute", top: PHOTO_HEIGHT - 26, left: 0, width: PIN_WIDTH, display: "flex", justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              backgroundColor: COLORS.sage,
              color: "#ffffff",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: 3,
              textTransform: "uppercase",
              padding: "12px 28px",
              borderRadius: 999,
            }}
          >
            {art.eyebrow}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "52px 70px 8px" }}>
          <div
            style={{
              display: "block",
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize,
              lineHeight: 1.08,
              color: COLORS.ink,
              textAlign: "center",
              lineClamp: 4,
            }}
          >
            {art.title}
          </div>
          {art.detail ? <div style={{ display: "flex", marginTop: 24, fontSize: 26, fontWeight: 500, color: COLORS.inkSoft }}>{art.detail}</div> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: 38 }}>
          <div style={{ display: "flex", width: 44, height: 2, backgroundColor: COLORS.line }} />
          <div style={{ display: "flex", margin: "0 18px", fontSize: 19, fontWeight: 600, letterSpacing: 4, textTransform: "uppercase", color: COLORS.sage }}>{art.brand}</div>
          <div style={{ display: "flex", width: 44, height: 2, backgroundColor: COLORS.line }} />
        </div>
      </div>
    ),
    { width: PIN_WIDTH, height: PIN_HEIGHT, fonts: fontList },
  );
  const png = Buffer.from(await response.arrayBuffer());
  return sharp(png).jpeg({ quality: 86, progressive: true, mozjpeg: true }).toBuffer();
}
