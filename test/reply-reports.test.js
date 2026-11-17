// "รายงานความเห็นนี้": members report replies under a review; admins dismiss
// the reports or remove the reply.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let admin;
let place;
let reviewer;
let replier;
let reporter;
let review;
let reply;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const reportPath = (id) => `/api/v1/replies/${id}/reports`;

beforeEach(async () => {
  // users and review_replies are truncated with CASCADE, which also empties reply_reports.
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านกาแฟริมคลอง', description: 'd', address: 'ลาดกระบัง' } });
  admin = createClient(app);
  await admin.registerAdmin();
  reviewer = await member('reviewer');
  replier = await member('replier');
  reporter = await member('reporter');
  review = (await reviewer.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'รีวิวปกติ' })).body.data;
  reply = (await replier.post(`/api/v1/reviews/${review.id}/replies`, { body: 'ความเห็นที่มีปัญหา' })).body.data;
});
afterAll(closeDatabase);

describe('POST /api/v1/replies/:id/reports', () => {
  test('a member reports a reply; it is stored as open', async () => {
    const res = await reporter.post(reportPath(reply.id), { reason: 'offensive', details: '  คำหยาบ  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ replyId: reply.id, reason: 'offensive', details: 'คำหยาบ', status: 'open' });
    expect(res.body.data.resolvedById).toBeUndefined();
    const row = await prisma.replyReport.findFirst();
    expect(row).toMatchObject({ userId: reporter.id, status: 'open', resolvedById: null, resolvedAt: null });
  });

  test('a second open report by the same member is refused, another member may report', async () => {
    expect((await reporter.post(reportPath(reply.id), { reason: 'spam' })).status).toBe(201);
    const again = await reporter.post(reportPath(reply.id), { reason: 'offensive' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'REPORT_EXISTS', message: 'คุณรายงานความเห็นนี้ไว้แล้ว ผู้ดูแลกำลังตรวจสอบ' });
    expect((await reviewer.post(reportPath(reply.id), { reason: 'spam' })).status).toBe(201);
    expect(await prisma.replyReport.count()).toBe(2);
  });

  test('the same member may report again once the report is handled', async () => {
    await reporter.post(reportPath(reply.id), { reason: 'spam' });
    expect((await admin.post(`/api/v1/admin/replies/${reply.id}/reports/dismiss`)).status).toBe(200);
    expect((await reporter.post(reportPath(reply.id), { reason: 'spam' })).status).toBe(201);
  });

  test('own reply cannot be reported', async () => {
    const res = await replier.post(reportPath(reply.id), { reason: 'spam' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_STATE', message: 'รายงานความเห็นของตัวเองไม่ได้' });
  });

  test('a hidden reply, a reply under a hidden review or unpublished place, or an unknown id answers 404', async () => {
    await prisma.reviewReply.update({ where: { id: reply.id }, data: { status: 'deleted' } });
    expect((await reporter.post(reportPath(reply.id), { reason: 'spam' })).status).toBe(404);
    await prisma.reviewReply.update({ where: { id: reply.id }, data: { status: 'active' } });

    await prisma.review.update({ where: { id: review.id }, data: { status: 'deleted' } });
    expect((await reporter.post(reportPath(reply.id), { reason: 'spam' })).status).toBe(404);
    await prisma.review.update({ where: { id: review.id }, data: { status: 'active' } });

    await prisma.place.update({ where: { id: place.id }, data: { status: 'unpublished' } });
    const res = await reporter.post(reportPath(reply.id), { reason: 'spam' });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('ไม่พบความเห็นตอบกลับนี้');
    expect((await reporter.post(reportPath(999999), { reason: 'spam' })).status).toBe(404);
    expect((await reporter.post(reportPath('abc'), { reason: 'spam' })).status).toBe(404);
    expect(await prisma.replyReport.count()).toBe(0);
  });

  test.each([
    ['an unknown reason', { reason: 'closed' }, 'reason'],
    ['a missing reason', {}, 'reason'],
    ['"other" without details', { reason: 'other', details: '   ' }, 'details'],
    ['details over 1000 characters', { reason: 'spam', details: 'ก'.repeat(1001) }, 'details'],
  ])('refuses %s with 400', async (label, body, field) => {
    const res = await reporter.post(reportPath(reply.id), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
    expect(await prisma.replyReport.count()).toBe(0);
  });

  test('"other" without details names the reply in the message', async () => {
    const res = await reporter.post(reportPath(reply.id), { reason: 'other' });
    expect(res.body.error.details[0].message).toBe('กรุณาอธิบายว่าความเห็นนี้มีปัญหาอย่างไร');
  });

  test('a visitor gets 401', async () => {
    expect((await createClient(app).post(reportPath(reply.id), { reason: 'spam' })).status).toBe(401);
  });
});

describe('place page and form', () => {
  test('a member sees the report button on others replies only; visitors and the author do not', async () => {
    const action = `/replies/${reply.id}/reports`;
    expect((await reporter.get(`/places/${place.id}`)).text).toContain(action);
    expect((await reviewer.get(`/places/${place.id}`)).text).toContain(action);
    expect((await replier.get(`/places/${place.id}`)).text).not.toContain(action);
    expect((await createClient(app).get(`/places/${place.id}`)).text).not.toContain(action);
  });

  test('the form redirects back to the reply with a flash; a duplicate shows the message', async () => {
    const next = `/places/${place.id}#reply-${reply.id}`;
    const res = await reporter.postForm(`/replies/${reply.id}/reports`, { reason: 'spam', next });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(next);
    expect(await prisma.replyReport.count()).toBe(1);

    await reporter.postForm(`/replies/${reply.id}/reports`, { reason: 'spam', next });
    expect((await reporter.get(`/places/${place.id}`)).text).toContain('คุณรายงานความเห็นนี้ไว้แล้ว');
    expect(await prisma.replyReport.count()).toBe(1);
  });

  test('an unsafe next is ignored and a visitor cannot report', async () => {
    const res = await reporter.postForm(`/replies/${reply.id}/reports`, { reason: 'spam', next: 'https://evil.example/' });
    expect(res.headers.location).toBe('/places');
    const visitor = await createClient(app).postForm(`/replies/${reply.id}/reports`, { reason: 'spam' });
    expect([302, 303, 401]).toContain(visitor.status);
    expect(await prisma.replyReport.count()).toBe(1);
  });
});

describe('admin: reported replies', () => {
  let quiet;
  beforeEach(async () => {
    // A second review with no reports, to check the filter leaves it out.
    quiet = (await reporter.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'รีวิวเงียบๆ' })).body.data;
    await reporter.post(reportPath(reply.id), { reason: 'spam' });
    await reviewer.post(reportPath(reply.id), { reason: 'other', details: 'อธิบายความเห็น' });
  });

  test('status=reported includes a review whose reply has an open report, with the reports on the reply', async () => {
    const res = await admin.get('/api/v1/admin/reviews?status=reported');
    expect(res.status).toBe(200);
    expect(res.body.data.map((item) => item.id)).toEqual([review.id]);
    expect(res.body.data[0].reports).toEqual([]);
    const listed = res.body.data[0].replies.find((item) => item.id === reply.id);
    expect(listed.reports).toHaveLength(2);
    expect(listed.reports[0]).toMatchObject({ reason: 'spam', user: { username: 'reporter' } });
    const all = await admin.get('/api/v1/admin/reviews');
    expect(all.body.data.map((item) => item.id)).toContain(quiet.id);
  });

  test('the public API never shows reply reports', async () => {
    const res = await reporter.get(`/api/v1/places/${place.id}/reviews`);
    expect(JSON.stringify(res.body)).not.toContain('อธิบายความเห็น');
  });

  test('the admin page shows the reports, the dismiss and remove buttons, and the dashboard counts it', async () => {
    const page = await admin.get('/admin/reviews?status=reported');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ความเห็นนี้ถูกรายงาน 2 ครั้ง');
    expect(page.text).toContain('อธิบายความเห็น');
    expect(page.text).toContain(`/admin/replies/${reply.id}/reports/dismiss`);
    expect(page.text).toContain(`/admin/replies/${reply.id}/remove`);
    expect(page.text).not.toContain('รีวิวเงียบๆ');
    const tab = await admin.get(`/admin/places/${place.id}/reviews?status=reported`);
    expect(tab.text).toContain(`/admin/replies/${reply.id}/reports/dismiss`);
    expect((await admin.get('/admin')).text).toMatch(/รีวิวที่ถูกรายงาน <strong>1<\/strong>/);
  });

  test('dismiss closes every open report of the reply and returns to the same list', async () => {
    const res = await admin.postForm(`/admin/replies/${reply.id}/reports/dismiss`, { status: 'reported', page: '1', placeId: String(place.id) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/admin/places/${place.id}/reviews?status=reported`);
    const rows = await prisma.replyReport.findMany();
    expect(rows.every((row) => row.status === 'dismissed' && row.resolvedById === admin.id && row.resolvedAt)).toBe(true);
    expect((await admin.get('/api/v1/admin/reviews?status=reported')).body.data).toHaveLength(0);
    // The reply itself stays on show.
    expect((await prisma.reviewReply.findUnique({ where: { id: reply.id } })).status).toBe('active');
    expect((await admin.post(`/api/v1/admin/replies/${reply.id}/reports/dismiss`)).status).toBe(409);
    expect((await admin.post('/api/v1/admin/replies/999999/reports/dismiss')).status).toBe(404);
  });

  test('removing the reply resolves its open reports', async () => {
    const res = await admin.post(`/api/v1/admin/replies/${reply.id}/remove`, { reason: 'ไม่สุภาพ' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('removed');
    const rows = await prisma.replyReport.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'resolved' && row.resolvedById === admin.id && row.resolvedAt)).toBe(true);
    expect((await admin.get('/api/v1/admin/reviews?status=reported')).body.data).toHaveLength(0);
    // The page form works too and lands back on the list.
    const again = await admin.postForm(`/admin/replies/${reply.id}/remove`, { reason: 'ซ้ำ', status: 'reported' });
    expect(again.status).toBe(303);
    expect(again.headers.location).toBe('/admin/reviews?status=reported');
  });

  test('members cannot dismiss', async () => {
    expect((await reporter.post(`/api/v1/admin/replies/${reply.id}/reports/dismiss`)).status).toBe(403);
    expect((await reporter.postForm(`/admin/replies/${reply.id}/reports/dismiss`)).status).toBe(403);
    expect(await prisma.replyReport.count({ where: { status: 'open' } })).toBe(2);
  });
});

describe('database rules', () => {
  test('the open-report unique index, the other-needs-details and resolved checks', async () => {
    await prisma.replyReport.create({ data: { replyId: reply.id, userId: reporter.id, reason: 'spam' } });
    await expect(prisma.replyReport.create({ data: { replyId: reply.id, userId: reporter.id, reason: 'spam' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.replyReport.create({ data: { replyId: reply.id, userId: admin.id, reason: 'other' } })).rejects.toThrow(/reply_reports_other_details_check/);
    await expect(prisma.replyReport.create({ data: { replyId: reply.id, userId: admin.id, reason: 'spam', details: '  ' } })).rejects.toThrow(/reply_reports_details_not_blank_check/);
    await expect(prisma.replyReport.create({ data: { replyId: reply.id, userId: admin.id, reason: 'spam', status: 'resolved' } })).rejects.toThrow(/reply_reports_resolved_check/);
  });
});
