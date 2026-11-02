import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const assetsDir = join(process.cwd(), 'dist', 'assets');
const files = readdirSync(assetsDir);
const images = files.filter((file) => /\.(jpe?g|png|webp|svg)$/i.test(file));
if (images.length < 4) {
  console.error(`Expected at least 4 hashed product images, found ${images.length}.`);
  process.exit(1);
}
const scripts = files.filter((file) => file.endsWith('.js'));
const leakedSrcPath = scripts.some((file) =>
  readFileSync(join(assetsDir, file), 'utf8').includes('/src/assets/images')
);
if (leakedSrcPath) {
  console.error('Production bundle still contains a /src/assets/images reference.');
  process.exit(1);
}
console.log(`Verified ${images.length} hashed images and no /src/assets/images references.`);
