import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const brandDir = path.join(publicDir, "brand");
const iconSourcePath = path.join(brandDir, "logo-icon-source.png");
const iconPath = path.join(brandDir, "logo-icon.png");

const BG = "#0a0b0f";
const CYAN = "#3dd7e5";
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Key out the baked-in black JPEG background, preserving the cyan glow edges. */
async function removeBlackBackground(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = data;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const brightness = Math.max(r, g, b);

    if (brightness < 28) {
      pixels[i + 3] = 0;
    } else if (brightness < 90) {
      pixels[i + 3] = Math.round(((brightness - 28) / 62) * 255);
    } else {
      pixels[i + 3] = 255;
    }
  }

  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png();
}

/** Trim excess padding and re-center on a tight transparent square canvas. */
async function prepareIcon() {
  const keyed = await removeBlackBackground(iconSourcePath);
  const trimmed = await keyed.trim({ threshold: 1 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  const maxDim = Math.max(meta.width, meta.height);
  const margin = Math.round(maxDim * 0.02);
  const squareSize = maxDim + margin * 2;
  const left = Math.round((squareSize - meta.width) / 2);
  const top = Math.round((squareSize - meta.height) / 2);

  await sharp({
    create: {
      width: squareSize,
      height: squareSize,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: trimmed, left, top }])
    .png()
    .toFile(iconPath);
}

/** Render a favicon with the mark cropped to fill the canvas edge-to-edge. */
async function renderFavicon(size) {
  const keyed = await removeBlackBackground(iconSourcePath);
  const mark = await keyed
    .trim({ threshold: 1 })
    .resize(size, size, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
}

async function generateFavicons() {
  const sizes = [
    { name: "favicon-16x16.png", size: 16 },
    { name: "favicon-32x32.png", size: 32 },
    { name: "favicon-48x48.png", size: 48 },
    { name: "apple-touch-icon.png", size: 180 },
  ];

  for (const { name, size } of sizes) {
    const buf = await renderFavicon(size);
    await writeFile(path.join(publicDir, name), buf);
  }

  const icoSizes = [16, 32, 48];
  const pngBuffers = await Promise.all(icoSizes.map((size) => renderFavicon(size)));

  await writeFile(path.join(publicDir, "favicon.ico"), encodeIco(pngBuffers, icoSizes));
}

function encodeIco(images, sizes) {
  const count = images.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = images.map((buf, i) => {
    const entry = { size: sizes[i], offset, length: buf.length };
    offset += buf.length;
    return entry;
  });

  const totalSize = offset;
  const out = Buffer.alloc(totalSize);

  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(count, 4);

  let dirOffset = 6;
  for (const entry of entries) {
    out.writeUInt8(entry.size === 256 ? 0 : entry.size, dirOffset);
    out.writeUInt8(entry.size === 256 ? 0 : entry.size, dirOffset + 1);
    out.writeUInt8(0, dirOffset + 2);
    out.writeUInt8(0, dirOffset + 3);
    out.writeUInt16LE(1, dirOffset + 4);
    out.writeUInt16LE(32, dirOffset + 6);
    out.writeUInt32LE(entry.length, dirOffset + 8);
    out.writeUInt32LE(entry.offset, dirOffset + 12);
    dirOffset += 16;
  }

  let dataOffset = headerSize;
  for (const buf of images) {
    buf.copy(out, dataOffset);
    dataOffset += buf.length;
  }

  return out;
}

async function generateLockup() {
  const iconSize = 512;
  const canvasWidth = 640;
  const canvasHeight = 720;
  const iconTop = 48;

  const icon = await sharp(iconPath)
    .resize(iconSize, iconSize, { fit: "contain", background: BG })
    .png()
    .toBuffer();

  const wordmarkSvg = Buffer.from(`
    <svg width="${canvasWidth}" height="120" xmlns="http://www.w3.org/2000/svg">
      <text
        x="50%"
        y="72"
        text-anchor="middle"
        font-family="Inter, Arial, sans-serif"
        font-size="64"
        font-weight="700"
        fill="${CYAN}"
      >LMX Cloud</text>
    </svg>
  `);

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: BG,
    },
  })
    .composite([
      { input: icon, top: iconTop, left: Math.round((canvasWidth - iconSize) / 2) },
      { input: wordmarkSvg, top: iconTop + iconSize + 8, left: 0 },
    ])
    .png()
    .toFile(path.join(brandDir, "logo-lockup.png"));
}

async function generateOgShare() {
  const width = 1200;
  const height = 630;
  const lockup = await sharp(path.join(brandDir, "logo-lockup.png")).metadata();
  const maxLockupWidth = 520;
  const scale = maxLockupWidth / lockup.width;
  const lockupHeight = Math.round(lockup.height * scale);

  const resizedLockup = await sharp(path.join(brandDir, "logo-lockup.png"))
    .resize(maxLockupWidth, lockupHeight, { fit: "inside" })
    .png()
    .toBuffer();

  const meta = await sharp(resizedLockup).metadata();
  const left = Math.round((width - meta.width) / 2);
  const top = Math.round((height - meta.height) / 2);

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: resizedLockup, top, left }])
    .png()
    .toFile(path.join(brandDir, "og-share.png"));
}

await mkdir(brandDir, { recursive: true });
await prepareIcon();
await generateFavicons();
await generateLockup();
await generateOgShare();
console.log("Brand assets generated.");
