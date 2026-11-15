// "รายงานรีวิวนี้": members report reviews, admins dismiss them or remove the review.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let admin;
let place;
let author;
let reporter;
let review;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const reportPath = (id) => `/api/v1/reviews/${id}/reports`;

beforeEach(async () => {
  // users and reviews are truncated with CASCADE, which also empties review_reports.
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านกาแฟริมคลอง', description: 'd', address: 'ลาดกระบัง' } });
  admin = createClient(app);
  await admin.registerAdmin();
  author = await member('author');
  reporter = await member('reporter');
  const res = await author.post(`/api/v1/places/${place.id}/reviews`, { rating: 2, comment: 'รีวิวที่มีปัญหา' });
  review = res.body.data;
});
afterAll(closeDatabase);

describe('POST /api/v1/reviews/:id/reports', () => {
  test('a member reports a review; it is stored as open', async () => {
    const res = await reporter.post(reportPath(review.id), { reason: 'spam', details: '  โฆษณาร้านอื่น  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ reviewId: review.id, reason: 'spam', details: 'โฆษณาร้านอื่น', status: 'open' });
    expect(res.body.data.resolvedById).toBeUndefined();
    const row = await prisma.reviewReport.findFirst();
    expect(row).toMatchObject({ userId: reporter.id, status: 'open', resolvedById: null, resolvedAt: null });
  });

  test('a second open report by the same member is refused, another member may report', async () => {
    expect((await reporter.post(reportPath(review.id), { reason: 'spam' })).status).toBe(201);
    const again = await reporter.post(reportPath(review.id), { reason: 'offensive' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REPORT_EXISTS');
    expect(await prisma.reviewReport.count()).toBe(1);

    const other = await member('other');
    expect((await other.post(reportPath(review.id), { reason: 'false_info' })).status).toBe(201);
  });

  test('the same member may report again once the report is handled', async () => {
    await reporter.post(reportPath(review.id), { reason: 'spam' });
    expect((await admin.post(`/api/v1/admin/reviews/${review.id}/reports/dismiss`)).status).toBe(200);
    expect((await reporter.post(reportPath(review.id), { reason: 'spam' })).status).toBe(201);
  });

  test('own review cannot be reported', async () => {
    const res = await author.post(reportPath(review.id), { reason: 'spam' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_STATE', message: 'รายงานรีวิวของตัวเองไม่ได้' });
  });

  test('a hidden review, a review of an unpublished place, or an unknown id answers 404', async () => {
    await prisma.review.update({ where: { id: review.id }, data: { status: 'deleted' } });
    expect((await reporter.post(reportPath(review.id), { reason: 'spam' })).status).toBe(404);
    await prisma.review.update({ where: { id: review.id }, data: { status: 'active' } });
    await prisma.place.update({ where: { id: place.id }, data: { status: 'unpublished' } });
    const res = await reporter.post(reportPath(review.id), { reason: 'spam' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('ไม่พบรีวิวนี้');
    expect((await reporter.post(reportPath(999999), { reason: 'spam' })).status).toBe(404);
    expect((await reporter.post(reportPath('abc'), { reason: 'spam' })).status).toBe(404);
  });

  test.each([
    ['an unknown reason', { reason: 'closed' }, 'reason'],
    ['a missing reason', {}, 'reason'],
    ['"other" without details', { reason: 'other', details: '   ' }, 'details'],
    ['details over 1000 characters', { reason: 'spam', details: 'ก'.repeat(1001) }, 'details'],
  ])('refuses %s with 400', async (label, body, field) => {
    const res = await reporter.post(reportPath(review.id), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
    expect(await prisma.reviewReport.count()).toBe(0);
  });

  test('a visitor gets 401', async () => {
    const res = await createClient(app).post(reportPath(review.id), { reason: 'spam' });
    expect(res.status).toBe(401);
  });
});

describe('place page and form', () => {
  test('a member sees the report button on others reviews only; visitors and the author do not', async () => {
    const asMember = await reporter.get(`/places/${place.id}`);
    expect(asMember.text).toContain('รายงานรีวิวนี้');
    expect(asMember.text).toContain(`/reviews/${review.id}/reports`);
    expect((await createClient(app).get(`/places/${place.id}`)).text).not.toContain('รายงานรีวิวนี้');
    expect((await author.get(`/places/${place.id}`)).text).not.toContain('รายงานรีวิวนี้');
  });

  test('the form redirects back to the review with a flash', async () => {
    const next = `/places/${place.id}#review-${review.id}`;
    const res = await reporter.postForm(`/reviews/${review.id}/reports`, { reason: 'offensive', next });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(next);
    expect(await prisma.reviewReport.count()).toBe(1);

    const dup = await reporter.postForm(`/reviews/${review.id}/reports`, { reason: 'spam', next });
    expect(dup.status).toBe(303);
    expect((await reporter.get(`/places/${place.id}`)).text).toContain('คุณรายงานรีวิวนี้ไว้แล้ว');
    expect(await prisma.reviewReport.count()).toBe(1);
  });

  test('an unsafe next is ignored and a visitor cannot report', async () => {
    const res = await reporter.postForm(`/reviews/${review.id}/reports`, { reason: 'spam', next: 'https://evil.example/' });
    expect(res.headers.location).toBe('/places');
    const visitor = await createClient(app).postForm(`/reviews/${review.id}/reports`, { reason: 'spam' });
    expect([302, 303, 401]).toContain(visitor.status);
    expect(await prisma.reviewReport.count()).toBe(1);
  });
});

describe('admin: reported reviews', () => {
  let second;
  beforeEach(async () => {
    const other = await member('other');
    const res = await other.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'รีวิวดีๆ' });
    second = res.body.data;
    await reporter.post(reportPath(review.id), { reason: 'spam' });
    await (await member('third')).post(reportPath(review.id), { reason: 'other', details: 'อธิบายเพิ่ม' });
  });

  test('status=reported lists only reviews with an open report, with the reports', async () => {
    const res = await admin.get('/api/v1/admin/reviews?status=reported');
    expect(res.status).toBe(200);
    expect(res.body.data.map((item) => item.id)).toEqual([review.id]);
    expect(res.body.data[0].reports).toHaveLength(2);
    expect(res.body.data[0].reports[0]).toMatchObject({ reason: 'spam', user: { username: 'reporter' } });
    const all = await admin.get('/api/v1/admin/reviews');
    expect(all.body.data.find((item) => item.id === second.id).reports).toEqual([]);
  });

  test('the page shows the tab, the reports and the dismiss button; place tab too', async () => {
    const page = await admin.get('/admin/reviews?status=reported');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ถูกรายงาน');
    expect(page.text).toContain('อธิบายเพิ่ม');
    expect(page.text).toContain(`/admin/reviews/${review.id}/reports/dismiss`);
    expect(page.text).not.toContain('รีวิวดีๆ');
    const tab = await admin.get(`/admin/places/${place.id}/reviews?status=reported`);
    expect(tab.text).toContain(`/admin/reviews/${review.id}/reports/dismiss`);
    expect((await admin.get('/admin')).text).toContain('/admin/reviews?status=reported');
  });

  test('search still combines with the reported tab', async () => {
    expect((await admin.get('/api/v1/admin/reviews?status=reported&user=author')).body.data).toHaveLength(1);
    expect((await admin.get('/api/v1/admin/reviews?status=reported&user=other')).body.data).toHaveLength(0);
    expect((await admin.get('/api/v1/admin/reviews?status=reported&rating=5')).body.data).toHaveLength(0);
    expect((await admin.get('/api/v1/admin/reviews?status=reported&q=' + encodeURIComponent('มีปัญหา'))).body.data).toHaveLength(1);
  });

  test('dismiss closes every open report and returns to the same list', async () => {
    const res = await admin.postForm(`/admin/reviews/${review.id}/reports/dismiss`, { status: 'reported', user: 'author', page: '1' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/reviews?status=reported&user=author');
    const rows = await prisma.reviewReport.findMany();
    expect(rows.every((row) => row.status === 'dismissed' && row.resolvedById === admin.id && row.resolvedAt)).toBe(true);
    expect((await admin.get('/api/v1/admin/reviews?status=reported')).body.data).toHaveLength(0);
    // Nothing left to dismiss.
    expect((await admin.post(`/api/v1/admin/reviews/${review.id}/reports/dismiss`)).status).toBe(409);
    expect((await admin.post('/api/v1/admin/reviews/999999/reports/dismiss')).status).toBe(404);
  });

  test('removing the review resolves its open reports', async () => {
    const res = await admin.post(`/api/v1/admin/reviews/${review.id}/remove`, { reason: 'สแปม' });
    expect(res.status).toBe(200);
    const rows = await prisma.reviewReport.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'resolved' && row.resolvedById === admin.id && row.resolvedAt)).toBe(true);
    expect((await admin.get('/api/v1/admin/reviews?status=reported')).body.data).toHaveLength(0);
  });

  test('members cannot dismiss', async () => {
    expect((await reporter.post(`/api/v1/admin/reviews/${review.id}/reports/dismiss`)).status).toBe(403);
    expect((await reporter.postForm(`/admin/reviews/${review.id}/reports/dismiss`)).status).toBe(403);
    expect(await prisma.reviewReport.count({ where: { status: 'open' } })).toBe(2);
  });
});

describe('database rules', () => {
  test('the open-report unique index, the other-needs-details and resolved checks', async () => {
    await prisma.reviewReport.create({ data: { reviewId: review.id, userId: reporter.id, reason: 'spam' } });
    await expect(prisma.reviewReport.create({ data: { reviewId: review.id, userId: reporter.id, reason: 'spam' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.reviewReport.create({ data: { reviewId: review.id, userId: admin.id, reason: 'other' } })).rejects.toThrow(/review_reports_other_details_check/);
    await expect(prisma.reviewReport.create({ data: { reviewId: review.id, userId: admin.id, reason: 'spam', details: '  ' } })).rejects.toThrow(/review_reports_details_not_blank_check/);
    await expect(prisma.reviewReport.create({ data: { reviewId: review.id, userId: admin.id, reason: 'spam', status: 'resolved' } })).rejects.toThrow(/review_reports_resolved_check/);
  });
});
