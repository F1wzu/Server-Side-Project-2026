// Moves photos that were uploaded before the switch to Cloudinary: every
// /uploads/<name>.webp path the database still mentions is uploaded from
// storage/uploads/ on this computer, and the database is pointed at the new
// address.
//
//   node scripts/move-uploads-to-cloud.js           lists what would move (changes nothing)
//   node scripts/move-uploads-to-cloud.js --apply   moves the photos
//
// Safe to run again: a photo that has moved is no longer an /uploads/ path,
// so it is not picked up a second time. A photo whose file is not on this
// computer (a teammate uploaded it on theirs) is listed and left alone; that
// teammate can run the script on their computer. Local files are never
// deleted, so the old setup keeps working if STORAGE_DRIVER goes back to local.
const fs = require('node:fs/promises');
const path = require('node:path');
const env = require('../src/config/env');
const prisma = require('../src/config/db');
const cloud = require('../src/storage/cloud');
const { LOCAL_PATH } = require('../src/storage/paths');

const UPLOAD_DIR = path.join(__dirname, '..', 'storage', 'uploads');
const apply = process.argv.includes('--apply');

// Every /uploads/ path the database mentions, wherever a photo can be kept:
// a place's cover and gallery, a submission's cover and extra photos, and the
// saved versions in a submission's history.
async function pathsInUse() {
  const rows = await prisma.$queryRaw`
    SELECT image_path AS path FROM places WHERE image_path LIKE '/uploads/%'
    UNION SELECT image_path FROM place_photos WHERE image_path LIKE '/uploads/%'
    UNION SELECT image_path FROM submissions WHERE image_path LIKE '/uploads/%'
    UNION SELECT unnest(extra_image_paths) FROM submissions
    UNION SELECT snapshot->>'imagePath' FROM submission_events WHERE snapshot->>'imagePath' LIKE '/uploads/%'
    UNION SELECT jsonb_array_elements_text(snapshot->'extraImagePaths') FROM submission_events
      WHERE jsonb_typeof(snapshot->'extraImagePaths') = 'array'`;
  return rows.map((row) => row.path).filter((value) => typeof value === 'string' && value.startsWith('/uploads/'));
}

// Points every mention of `from` at `to`, all or nothing.
function repoint(from, to) {
  return prisma.$transaction([
    prisma.$executeRaw`UPDATE places SET image_path = ${to} WHERE image_path = ${from}`,
    prisma.$executeRaw`UPDATE place_photos SET image_path = ${to} WHERE image_path = ${from}`,
    prisma.$executeRaw`UPDATE submissions SET image_path = ${to} WHERE image_path = ${from}`,
    prisma.$executeRaw`UPDATE submissions SET extra_image_paths = array_replace(extra_image_paths, ${from}, ${to}) WHERE ${from} = ANY(extra_image_paths)`,
    prisma.$executeRaw`UPDATE submission_events SET snapshot = jsonb_set(snapshot, '{imagePath}', to_jsonb(${to}::text)) WHERE snapshot->>'imagePath' = ${from}`,
    prisma.$executeRaw`
      UPDATE submission_events
      SET snapshot = jsonb_set(snapshot, '{extraImagePaths}',
        (SELECT jsonb_agg(CASE WHEN item = ${from} THEN ${to} ELSE item END ORDER BY position)
         FROM jsonb_array_elements_text(snapshot->'extraImagePaths') WITH ORDINALITY AS photos(item, position)))
      WHERE jsonb_typeof(snapshot->'extraImagePaths') = 'array' AND jsonb_exists(snapshot->'extraImagePaths', ${from})`,
  ]);
}

async function main() {
  if (env.STORAGE_DRIVER !== 'cloud') {
    throw new Error('Set STORAGE_DRIVER=cloud and CLOUDINARY_URL in .env first; this script uploads to Cloudinary.');
  }
  const paths = await pathsInUse();
  console.log(`${paths.length} photo(s) in the database still point at /uploads/.`);

  let moved = 0;
  const missing = [];
  for (const from of paths) {
    const match = LOCAL_PATH.exec(from);
    const buffer = match ? await fs.readFile(path.join(UPLOAD_DIR, match[1])).catch(() => null) : null;
    if (!buffer) {
      missing.push(from);
      continue;
    }
    if (!apply) {
      console.log(`  would move ${from} (${Math.round(buffer.length / 1024)} KB)`);
      continue;
    }
    const to = await cloud.save(buffer);
    try {
      await repoint(from, to);
    } catch (err) {
      // The database did not change, so the copy just uploaded is unused.
      await cloud.remove(to).catch(() => {});
      throw err;
    }
    moved += 1;
    console.log(`  moved ${from}`);
  }

  if (missing.length) {
    console.log(`${missing.length} photo(s) are not on this computer and were left as they are:`);
    for (const from of missing) console.log(`  ${from}`);
  }
  console.log(apply ? `Done: ${moved} photo(s) moved to Cloudinary.` : 'Nothing was changed. Run again with --apply to move them.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
