import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public", "appicon.png");
const androidRes = path.join(root, "android", "app", "src", "main", "res");
const iosIcon = path.join(
  root,
  "ios",
  "App",
  "App",
  "Assets.xcassets",
  "AppIcon.appiconset",
  "AppIcon-512@2x.png",
);

const DENSITIES = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
];

async function roundMask(size) {
  return sharp(
    Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#ffffff"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

async function resizeIcon(size, round = false) {
  let image = sharp(src).resize(size, size, { fit: "cover" });
  if (round) {
    image = image.composite([{ input: await roundMask(size), blend: "dest-in" }]);
  }
  return image.png().toBuffer();
}

async function backgroundColor() {
  const { data } = await sharp(src)
    .extract({ left: 8, top: 8, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [r, g, b] = data;
  const hex = [r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `#${hex.toUpperCase()}`;
}

async function main() {
  if (!fs.existsSync(src)) throw new Error(`源图标不存在：${src}`);

  for (const [density, legacySize, foregroundSize] of DENSITIES) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ic_launcher.png"), await resizeIcon(legacySize));
    fs.writeFileSync(
      path.join(dir, "ic_launcher_round.png"),
      await resizeIcon(legacySize, true),
    );
    fs.writeFileSync(
      path.join(dir, "ic_launcher_foreground.png"),
      await resizeIcon(foregroundSize),
    );
  }

  const color = await backgroundColor();
  fs.writeFileSync(
    path.join(androidRes, "values", "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${color}</color>\n</resources>\n`,
  );

  if (fs.existsSync(path.dirname(iosIcon))) {
    fs.writeFileSync(
      iosIcon,
      await sharp(src)
        .resize(1024, 1024, { fit: "cover" })
        .flatten({ background: "#FFFFFF" })
        .png()
        .toBuffer(),
    );
  }

  console.log(`已生成 Android / iOS 图标（背景 ${color}）`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
