import sharp from 'sharp';
for (const size of [192, 512]) await sharp('web/public/icon.svg').resize(size, size).png().toFile(`web/public/icon-${size}.png`);
console.log('Generated 192 and 512px maskable icons');
