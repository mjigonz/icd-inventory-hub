import fs from 'fs';
import sharp from 'sharp';

async function generateIcons() {
  const svgBuffer = fs.readFileSync('public/icon.svg');

  // Standard crisp raster icons directly rendered from the vector SVG reference
  await sharp(svgBuffer)
    .resize(192, 192)
    .png({ quality: 100 })
    .toFile('public/icon-192.png');

  await sharp(svgBuffer)
    .resize(512, 512)
    .png({ quality: 100 })
    .toFile('public/icon-512.png');

  await sharp(svgBuffer)
    .resize(180, 180)
    .png({ quality: 100 })
    .toFile('public/apple-touch-icon.png');

  // Maskable icons: Safe zone compliant (80% inner content, padded with matching #0D1522 background)
  const innerSize192 = Math.round(192 * 0.8);
  const padding192 = Math.round((192 - innerSize192) / 2);
  const innerBuffer192 = await sharp(svgBuffer)
    .resize(innerSize192, innerSize192)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 192,
      height: 192,
      channels: 4,
      background: { r: 13, g: 21, b: 34, alpha: 1 },
    },
  })
    .composite([{ input: innerBuffer192, top: padding192, left: padding192 }])
    .png({ quality: 100 })
    .toFile('public/icon-maskable-192.png');

  const innerSize512 = Math.round(512 * 0.8);
  const padding512 = Math.round((512 - innerSize512) / 2);
  const innerBuffer512 = await sharp(svgBuffer)
    .resize(innerSize512, innerSize512)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 13, g: 21, b: 34, alpha: 1 },
    },
  })
    .composite([{ input: innerBuffer512, top: padding512, left: padding512 }])
    .png({ quality: 100 })
    .toFile('public/icon-maskable-512.png');

  console.log('All high-resolution raster icons generated from public/icon.svg successfully!');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
