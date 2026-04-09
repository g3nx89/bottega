/**
 * Perceptual hash (average hash) for visual regression in the QA baseline system.
 *
 * Algorithm:
 *   1. Resize image to 8×8 grayscale (64 pixels total)
 *   2. Compute the mean of all 64 pixel values
 *   3. Build 64-bit hash: bit[i] = 1 if pixel[i] >= mean, else 0
 *   4. Encode as 16-char hex string (big-endian, MSB first)
 *
 * Uses `sharp` which is available as a transitive dependency of Playwright.
 * No additional install needed in the Bottega project.
 *
 * Exports:
 *   computePHash(imagePath: string) → Promise<string>   — 16-char hex
 *   hammingDistance(hash1: string, hash2: string) → number  — 0-64
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Lazy-load sharp from wherever Playwright installed it.
 * Playwright bundles its own copy under node_modules/@playwright/test/node_modules/sharp
 * (or a hoisted copy at node_modules/sharp depending on the package manager).
 */
let _sharp = null;

function loadSharp() {
  if (_sharp) return _sharp;

  try {
    _sharp = require('sharp');
    return _sharp;
  } catch {
    // not hoisted — try Playwright's tree
  }

  try {
    const playwrightDir = require.resolve('@playwright/test').replace(/\/index\.js$/, '');
    _sharp = require(require.resolve('sharp', { paths: [playwrightDir] }));
    return _sharp;
  } catch {
    throw new Error(
      'phash.mjs: could not load sharp. ' +
        'Install it with `npm install --save-dev sharp` or ensure @playwright/test is installed.',
    );
  }
}

/**
 * Compute the average perceptual hash of an image.
 *
 * @param {string} imagePath - Absolute path to a PNG/JPEG/WebP/etc image.
 * @returns {Promise<string>} 16-character lowercase hex string (64 bits).
 */
export async function computePHash(imagePath) {
  const sharp = loadSharp();

  let data;
  try {
    ({ data } = await sharp(imagePath)
      .resize(8, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch (err) {
    throw new Error(`computePHash: failed to process "${imagePath}": ${err.message}`);
  }

  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (pixels.length !== 64) {
    throw new Error(`computePHash: expected 64 pixels from 8×8 resize, got ${pixels.length} for "${imagePath}"`);
  }

  // Compute mean.
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    sum += pixels[i];
  }
  const mean = sum / 64;

  // Build 64-bit hash as two 32-bit numbers (high and low word).
  // Bit i is set if pixels[i] >= mean.
  let hi = 0; // bits 0-31  (pixels[0] = MSB of hi)
  let lo = 0; // bits 32-63 (pixels[32] = MSB of lo)

  for (let i = 0; i < 32; i++) {
    if (pixels[i] >= mean) hi = (hi | (1 << (31 - i))) >>> 0;
  }
  for (let i = 0; i < 32; i++) {
    if (pixels[32 + i] >= mean) lo = (lo | (1 << (31 - i))) >>> 0;
  }

  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/**
 * Compute the Hamming distance between two 16-char hex pHash strings.
 * Returns the number of bits that differ (0 = identical, 64 = opposite).
 *
 * @param {string} hash1 - 16-char hex string from computePHash.
 * @param {string} hash2 - 16-char hex string from computePHash.
 * @returns {number} Integer in range [0, 64].
 */
export function hammingDistance(hash1, hash2) {
  if (hash1.length !== 16 || hash2.length !== 16) {
    throw new Error(`hammingDistance: both hashes must be 16 hex chars (got "${hash1}", "${hash2}")`);
  }

  let distance = 0;
  // Process 4 hex chars (16 bits) at a time → 4 iterations for 64 bits.
  for (let chunk = 0; chunk < 4; chunk++) {
    const offset = chunk * 4;
    const a = Number.parseInt(hash1.slice(offset, offset + 4), 16);
    const b = Number.parseInt(hash2.slice(offset, offset + 4), 16);
    let xor = (a ^ b) & 0xffff;
    // Kernighan bit-count
    while (xor) {
      xor &= xor - 1;
      distance += 1;
    }
  }

  return distance;
}
