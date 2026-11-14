// Checks that the database itself enforces the rules in docs/DESIGN.md section 3,
// even if application code forgets to.
const { prisma, resetDatabase } = require('./support/db');

let user;
let admin;
let category;
let place;

const placeData = () => ({ categoryId: category.id, name: 'ร้านทดสอบ', description: 'รายละเอียด', address: 'ลาดกระบัง' });
const week = Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' }));
const submissionData = () => ({ userId: user.id, categoryId: category.id, name: 'ที่ใหม่', description: 'รายละเอียด', address: 'ลาดกระบัง', hours: week });

beforeAll(async () => {
  await resetDatabase();
  user = await prisma.user.create({ data: { username: 'member', email: 'member@example.com', passwordHash: 'x' } });
  admin = await prisma.user.create({ data: { username: 'admin', email: 'admin@example.com', passwordHash: 'x', role: 'admin' } });
  category = await prisma.category.create({ data: { name: 'Cafe' } });
  place = await prisma.place.create({ data: placeData() });
});

afterAll(() => prisma.$disconnect());

test('the database has the eleven tables from the design', async () => {
  const rows = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  expect(rows.map((row) => row.table_name)).toEqual([
    'categories',
    'favorites',
    'place_hours',
    'place_reports',
    'places',
    'review_replies',
    'reviews',
    'sessions',
    'submission_events',
    'submissions',
    'users',
  ]);
});

describe('users', () => {
  test('a new user is a member by default', () => {
    expect(user.role).toBe('member');
  });

  test('email is unique', async () => {
    await expect(prisma.user.create({ data: { username: 'other', email: 'member@example.com', passwordHash: 'x' } })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('email must be stored in lowercase', async () => {
    await expect(prisma.user.create({ data: { username: 'other', email: 'Other@Example.com', passwordHash: 'x' } })).rejects.toThrow(/users_email_lowercase_check/);
  });
});

describe('categories', () => {
  test('name is unique, ignoring upper and lower case', async () => {
    await expect(prisma.category.create({ data: { name: 'CAFE' } })).rejects.toThrow();
  });

  test('a category in use cannot be deleted', async () => {
    await expect(prisma.category.delete({ where: { id: category.id } })).rejects.toThrow();
  });
});

describe('places', () => {
  test('starts published, with no rating', () => {
    expect(place).toMatchObject({ status: 'published', ratingAvg: null, ratingCount: 0 });
  });

  test('latitude and longitude are set together or not at all', async () => {
    await expect(prisma.place.create({ data: { ...placeData(), latitude: 13.72 } })).rejects.toThrow(/places_coordinates_pair_check/);
  });

  test('coordinates must be in range', async () => {
    await expect(prisma.place.create({ data: { ...placeData(), latitude: 91, longitude: 100 } })).rejects.toThrow(/places_latitude_range_check/);
    await expect(prisma.place.create({ data: { ...placeData(), latitude: 13, longitude: 181 } })).rejects.toThrow(/places_longitude_range_check/);
  });

  test('a rating average needs a rating count, and the other way round', async () => {
    await expect(prisma.place.update({ where: { id: place.id }, data: { ratingAvg: 4.5 } })).rejects.toThrow(/places_rating_pair_check/);
    await expect(prisma.place.update({ where: { id: place.id }, data: { ratingCount: 2 } })).rejects.toThrow(/places_rating_pair_check/);
  });

  test('featured order must be positive', async () => {
    await expect(prisma.place.update({ where: { id: place.id }, data: { featuredOrder: 0 } })).rejects.toThrow(/places_featured_order_check/);
  });
});

describe('place_hours', () => {
  const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`);

  test('an open day needs opening and closing times', async () => {
    await expect(prisma.placeHours.create({ data: { placeId: place.id, weekday: 0, state: 'open' } })).rejects.toThrow(/place_hours_times_check/);
  });

  test('a closed day has no times', async () => {
    await expect(prisma.placeHours.create({ data: { placeId: place.id, weekday: 0, state: 'closed', opensAt: time('09:00'), closesAt: time('17:00') } })).rejects.toThrow(/place_hours_times_check/);
  });

  test('closing must be after opening unless it closes the next day', async () => {
    await expect(prisma.placeHours.create({ data: { placeId: place.id, weekday: 0, state: 'open', opensAt: time('18:00'), closesAt: time('02:00') } })).rejects.toThrow(/place_hours_order_check/);
    const overnight = await prisma.placeHours.create({ data: { placeId: place.id, weekday: 0, state: 'open', opensAt: time('18:00'), closesAt: time('02:00'), closesNextDay: true } });
    expect(overnight.closesAt.toISOString()).toContain('T02:00:00');
  });

  test('weekday is 0 to 6, once per place', async () => {
    await expect(prisma.placeHours.create({ data: { placeId: place.id, weekday: 7, state: 'unknown' } })).rejects.toThrow(/place_hours_weekday_check/);
    await expect(prisma.placeHours.create({ data: { placeId: place.id, weekday: 0, state: 'unknown' } })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('reviews', () => {
  test('rating must be 1 to 5', async () => {
    for (const rating of [0, 6]) {
      await expect(prisma.review.create({ data: { userId: user.id, placeId: place.id, rating } })).rejects.toThrow(/reviews_rating_range_check/);
    }
  });

  test('one review per member per place', async () => {
    await prisma.review.create({ data: { userId: user.id, placeId: place.id, rating: 5 } });
    await expect(prisma.review.create({ data: { userId: user.id, placeId: place.id, rating: 4 } })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('a removed review records who removed it and why', async () => {
    const where = { userId_placeId: { userId: user.id, placeId: place.id } };
    await expect(prisma.review.update({ where, data: { status: 'removed' } })).rejects.toThrow(/reviews_removed_check/);
    const removed = await prisma.review.update({ where, data: { status: 'removed', removedById: admin.id, removedReason: 'สแปม' } });
    expect(removed.status).toBe('removed');
  });
});

describe('favorites', () => {
  test('the same place cannot be saved twice', async () => {
    await prisma.favorite.create({ data: { userId: user.id, placeId: place.id } });
    await expect(prisma.favorite.create({ data: { userId: user.id, placeId: place.id } })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('submissions', () => {
  test('starts pending at version 1', async () => {
    const submission = await prisma.submission.create({ data: submissionData() });
    expect(submission).toMatchObject({ status: 'pending', version: 1, placeId: null });
  });

  test('hours must list exactly seven days', async () => {
    await expect(prisma.submission.create({ data: { ...submissionData(), hours: week.slice(0, 6) } })).rejects.toThrow(/submissions_hours_week_check/);
  });

  test('approved means it has a place, and only then', async () => {
    await expect(prisma.submission.create({ data: { ...submissionData(), status: 'approved' } })).rejects.toThrow(/submissions_approved_place_check/);
    await expect(prisma.submission.create({ data: { ...submissionData(), placeId: place.id } })).rejects.toThrow(/submissions_approved_place_check/);
  });

  test('a place comes from at most one submission', async () => {
    await prisma.submission.create({ data: { ...submissionData(), status: 'approved', placeId: place.id } });
    await expect(prisma.submission.create({ data: { ...submissionData(), status: 'approved', placeId: place.id } })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('returning or rejecting needs a reason in the history', async () => {
    const submission = await prisma.submission.create({ data: submissionData() });
    const event = { submissionId: submission.id, actorId: admin.id, snapshot: {} };
    await expect(prisma.submissionEvent.create({ data: { ...event, action: 'returned' } })).rejects.toThrow(/submission_events_note_check/);
    await expect(prisma.submissionEvent.create({ data: { ...event, action: 'rejected', note: 'อยู่นอกเขต' } })).resolves.toMatchObject({ action: 'rejected' });
  });
});
