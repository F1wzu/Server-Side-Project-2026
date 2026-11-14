// Turns an uploaded photo into a safe, small WebP file and stores it.
// The uploaded bytes are never kept as they are: they are decoded and encoded
// again, which drops hidden data (EXIF, GPS position, comments) and anything
// that only pretends to be an image.
const sharp = require('sharp');
const AppError = require('./AppError');
const storage = require('../storage');

const MAX_SIDE = 1600;
// A small file can claim to be a huge image (a "decompression bomb") and use
// up all memory when decoded. 40 megapixels is far above any phone photo.
const MAX_INPUT_PIXELS = 40_000_000;

const unsupported = () => new AppError(415, 'UNSUPPORTED_FILE', 'รองรับเฉพาะรูป JPEG, PNG หรือ WebP');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Recognises the file from its first bytes. The file name and the type the
// browser reports are chosen by the sender, so they are never trusted.
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Returns the photo as WebP, at most 1600 px on its longest side, without
// metadata. Anything that is not a readable JPEG, PNG or WebP is refused with 415.
async function processPhoto(buffer) {
  if (!detectImageType(buffer)) throw unsupported();
  try {
    return await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      // Turn the picture the way the camera meant (EXIF orientation), because
      // the orientation tag is about to be dropped with the rest of the metadata.
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      // No keepMetadata()/withMetadata(): sharp then writes no EXIF, XMP or ICC.
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    // A broken or truncated file, or one that is too large to decode.
    throw unsupported();
  }
}

// Processes and stores the photo from multer (req.file). Returns its public
// path, or null when the form had no photo.
async function storePhoto(file) {
  if (!file) return null;
  const webp = await processPhoto(file.buffer);
  return storage.save(webp);
}

// Processes and stores several photos, in order. All or nothing: if one is
// refused, the ones already stored are deleted again and the error says
// which photo it was ("รูปที่ 2: ..."). Returns their public paths.
async function storePhotos(files = []) {
  const stored = [];
  try {
    for (const [index, file] of files.entries()) {
      try {
        stored.push(await storePhoto(file));
      } catch (err) {
        if (err instanceof AppError && files.length > 1) err.message = `รูปที่ ${index + 1}: ${err.message}`;
        throw err;
      }
    }
    return stored;
  } catch (err) {
    await Promise.all(stored.map((path) => storage.remove(path).catch(() => {})));
    throw err;
  }
}

module.exports = { detectImageType, processPhoto, storePhoto, storePhotos, MAX_SIDE, MAX_INPUT_PIXELS };
