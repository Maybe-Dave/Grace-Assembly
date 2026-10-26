/**
 * scripts/generate-icons.mjs
 *
 * Generates PWA icons from public/icons/icon-source.jpg.
 * Requires: npm install --save-dev sharp
 *
 * Run: node scripts/generate-icons.mjs
 */

import { createCanvas, loadImage } from 'canvas'
import { createWriteStream } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(__dirname, '..', 'public', 'icons', 'icon-source.jpg')
const outputDir = join(__dirname, '..', 'public', 'icons')

const sizes = [192, 512]

async function generateIcons() {
  try {
    // Try using sharp if available
    const sharp = await import('sharp').catch(() => null)
    
    if (sharp) {
      for (const size of sizes) {
        await sharp.default(sourcePath)
          .resize(size, size)
          .png()
          .toFile(join(outputDir, `icon-${size}x${size}.png`))
        console.log(`✓ Generated icon-${size}x${size}.png`)
      }
    } else {
      console.log('sharp not available — using canvas fallback')
      const img = await loadImage(sourcePath)
      for (const size of sizes) {
        const canvas = createCanvas(size, size)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, size, size)
        const out = createWriteStream(join(outputDir, `icon-${size}x${size}.png`))
        canvas.createPNGStream().pipe(out)
        console.log(`✓ Generated icon-${size}x${size}.png`)
      }
    }
    console.log('Icon generation complete.')
  } catch (err) {
    console.error('Icon generation failed:', err.message)
    console.log('Tip: Install sharp with: npm install --save-dev sharp')
  }
}

generateIcons()
