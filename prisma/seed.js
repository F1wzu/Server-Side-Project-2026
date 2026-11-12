// Fills an empty database with the starting categories and places.
//
// It only ever fills an empty table: if any place exists, no place is added,
// and if any category exists, no category is added. Matching by name was not
// enough: after an admin renamed a seeded place, a second run added the old
// name again as a duplicate. Running it twice is safe (the second run finds
// the places from the first and adds nothing).
//
// Run with: npm run db:seed
const prisma = require('../src/config/db');
const places = require('./data/places.json');

// "09:00" -> a value for a TIME column (only the time part is stored).
const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`);

// places.json lists hours Sunday first: ["09:00", "17:00"], "closed", or null for unknown.
// Every place gets exactly seven rows.
function weekRows(hours) {
  return Array.from({ length: 7 }, (unused, weekday) => {
    const value = hours?.[weekday] ?? null;
    if (value === null) return { weekday, state: 'unknown' };
    if (value === 'closed') return { weekday, state: 'closed' };
    const [opens, closes] = value;
    return { weekday, state: 'open', opensAt: time(opens), closesAt: time(closes), closesNextDay: closes <= opens };
  });
}

async function main() {
  const added = await prisma.$transaction(async (tx) => {
    // Two runs at the same moment wait for each other instead of both
    // seeing empty tables. The lock is released when the transaction ends.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('painaidee-seed'))`;

    if ((await tx.place.count()) > 0) return null;

    const categoryIds = new Map();
    let categories = 0;
    const names = [...new Set(places.map((place) => place.category))];
    if ((await tx.category.count()) === 0) {
      for (const name of names) {
        const category = await tx.category.create({ data: { name } });
        categoryIds.set(name, category.id);
        categories += 1;
      }
    } else {
      // Categories were made by hand before the first seed: use the ones
      // with a matching name and skip places whose category is missing.
      for (const name of names) {
        const category = await tx.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
        if (category) categoryIds.set(name, category.id);
      }
    }

    let created = 0;
    let skipped = 0;
    for (const place of places) {
      const categoryId = categoryIds.get(place.category);
      if (!categoryId) {
        skipped += 1;
        continue;
      }
      await tx.place.create({
        data: {
          categoryId,
          name: place.name,
          description: place.description,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          imagePath: place.image,
          featuredOrder: place.featuredOrder,
          hours: { create: weekRows(place.hours) },
        },
      });
      created += 1;
    }
    return { categories, places: created, skipped };
  });

  if (!added) {
    console.log('Places already exist; the seed only fills an empty database. Nothing was added.');
    return;
  }
  console.log(`Seed finished: ${added.categories} categories and ${added.places} places added.`);
  if (added.skipped) {
    console.log(`${added.skipped} places were skipped because their category does not exist (categories already existed, so none were added).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
