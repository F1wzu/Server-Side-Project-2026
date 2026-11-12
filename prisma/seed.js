// Fills an empty database with the starting categories and places.
// Safe to run again: anything that already exists (matched by name) is left alone.
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
    const categoryIds = new Map();
    let categories = 0;
    for (const name of new Set(places.map((place) => place.category))) {
      let category = await tx.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
      if (!category) {
        category = await tx.category.create({ data: { name } });
        categories += 1;
      }
      categoryIds.set(name, category.id);
    }

    let created = 0;
    for (const place of places) {
      if (await tx.place.findFirst({ where: { name: place.name }, select: { id: true } })) continue;
      await tx.place.create({
        data: {
          categoryId: categoryIds.get(place.category),
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
    return { categories, places: created };
  });

  console.log(`Seed finished: ${added.categories} categories and ${added.places} places added.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
