// Is an uploaded photo file still used anywhere? A file can be shared: an
// approved submission keeps the same paths as the place it created, and a
// photo can move between a place's cover and its gallery. Callers ask this
// inside their transaction, after their own change, and delete the file only
// once that transaction has committed.

// Seed illustrations (/images/...) belong to the project and are never deleted.
const isUpload = (path) => typeof path === 'string' && path.startsWith('/uploads/');

async function isUploadUnused(tx, path) {
  if (!isUpload(path)) return false;
  const counts = await Promise.all([
    tx.place.count({ where: { imagePath: path } }),
    tx.placePhoto.count({ where: { imagePath: path } }),
    tx.submission.count({ where: { imagePath: path } }),
    tx.submission.count({ where: { extraImagePaths: { has: path } } }),
  ]);
  return counts.every((count) => count === 0);
}

// The paths from `paths` that nothing uses any more.
async function unusedUploads(tx, paths) {
  const unique = [...new Set(paths.filter(isUpload))];
  const unused = [];
  for (const path of unique) {
    if (await isUploadUnused(tx, path)) unused.push(path);
  }
  return unused;
}

module.exports = { isUploadUnused, unusedUploads };
