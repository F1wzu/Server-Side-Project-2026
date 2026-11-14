// Admin quality-of-life: staying on the place after saving, a safe "back"
// for the quick publish button, and the possible-duplicates panel.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let category;
let admin;
let member;

const makePlace = (overrides = {}) =>
  prisma.place.create({ data: { categoryId: category.id, name: 'ร้านเดิม', description: 'รายละเอียด', address: 'ลาดกระบัง', ...overrides } });

const fields = (overrides = {}) => {
  const base = {
    name: 'ร้านแก้ไขแล้ว',
    categoryId: String(category.id),
    description: 'รายละเอียดใหม่',
    address: 'ลาดกระบัง',
    latitude: '',
    longitude: '',
    status: 'published',
    featuredOrder: '',
  };
  for (let day = 0; day < 7; day += 1) base[`state${day}`] = 'unknown';
  return { ...base, ...overrides };
};

// multipart form post (the place forms are multipart)
async function postPlaceForm(client, url, values) {
  const token = await client.csrfToken();
  return Object.entries({ _csrf: token, ...values }).reduce((req, [key, value]) => req.field(key, value), client.agent.post(url));
}

const hoursOf = () => Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' }));

async function submit(overrides = {}) {
  const res = await member.post('/api/v1/submissions', {
    name: 'กาแฟริมคลอง',
    categoryId: category.id,
    description: 'ร้านเล็ก ๆ',
    address: 'ซอยฉลองกรุง 1',
    latitude: 13.7271,
    longitude: 100.7784,
    hours: hoursOf(),
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  admin = createClient(app);
  await admin.registerAdmin();
  member = createClient(app);
  await member.register({ username: 'member', email: 'member@example.com' });
});
afterAll(closeDatabase);

describe('staying on the place after saving', () => {
  test('update redirects to the edit page, where the flash is shown once', async () => {
    const place = await makePlace();
    const res = await postPlaceForm(admin, `/admin/places/${place.id}`, fields());
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/admin/places/${place.id}/edit`);

    const page = await admin.get(res.headers.location);
    expect(page.status).toBe(200);
    expect(page.text).toContain('data-flash');
    expect(page.text).toContain('บันทึกข้อมูล');
    expect(page.text).toContain('ร้านแก้ไขแล้ว');
    expect((await admin.get(res.headers.location)).text).not.toContain('data-flash');
  });

  test('a failed update still re-renders the form and does not redirect', async () => {
    const place = await makePlace();
    const res = await postPlaceForm(admin, `/admin/places/${place.id}`, fields({ name: '' }));
    expect(res.status).toBe(400);
  });

  test('creating a place goes to the new place edit page', async () => {
    const res = await postPlaceForm(admin, '/admin/places', fields({ name: 'ร้านใหม่' }));
    expect(res.status).toBe(303);
    const created = await prisma.place.findFirst({ where: { name: 'ร้านใหม่' } });
    expect(res.headers.location).toBe(`/admin/places/${created.id}/edit`);
    const page = await admin.get(res.headers.location);
    expect(page.status).toBe(200);
    expect(page.text).toContain('data-flash');
  });
});

describe('quick publish / unpublish returns to a safe place', () => {
  const setStatus = (place, back) => admin.postForm(`/admin/places/${place.id}/status`, { status: 'unpublished', ...(back === undefined ? {} : { back }) });

  test('keeps the list query string', async () => {
    const place = await makePlace();
    for (const back of ['/admin/places', '/admin/places?q=%E0%B8%81%E0%B8%B2&status=published&page=2', '/admin/places?missing=pin']) {
      const res = await setStatus(place, back);
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe(back);
    }
  });

  test('the list puts its own URL in the hidden back field', async () => {
    await makePlace();
    const page = await admin.get('/admin/places?status=published');
    expect(page.text).toContain('name="back" value="/admin/places?status=published"');
  });

  test('unsafe or odd values fall back to /admin/places', async () => {
    const place = await makePlace();
    const bad = [
      '//evil.example',
      'https://evil.example/admin/places',
      '/admin/placesx/../..',
      '/admin/placesx',
      '/admin/places/../login',
      '/admin/places\\evil',
      '/admin/places?x=1\r\nSet-Cookie: a=b',
      '/admin/places#frag',
      '/admin/places?q=<script>',
      '/evil',
      '',
    ];
    for (const back of bad) {
      const res = await setStatus(place, back);
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/admin/places');
    }
    expect((await setStatus(place)).headers.location).toBe('/admin/places');
  });
});

describe('possible duplicates when reviewing a submission', () => {
  const page = (id) => admin.get(`/admin/submissions/${id}`);
  const detail = async (id) => (await admin.get(`/api/v1/admin/submissions/${id}`)).body.data;

  test('lists a similar name and a nearby pin, but not unrelated far places', async () => {
    const similar = await makePlace({ name: 'ร้านกาแฟริมคลอง', status: 'unpublished' });
    const near = await makePlace({ name: 'ชื่ออื่นเลย', latitude: 13.7275, longitude: 100.7787 });
    await makePlace({ name: 'ร้านไกลมาก', latitude: 13.75, longitude: 100.8 });
    await makePlace({ name: 'ตลาดนัดสถาบัน' });
    const submission = await submit();

    const body = await detail(submission.id);
    const byId = Object.fromEntries(body.possibleDuplicates.map((place) => [place.id, place]));
    expect(Object.keys(byId).map(Number).sort()).toEqual([similar.id, near.id].sort());
    expect(byId[similar.id]).toMatchObject({ name: 'ร้านกาแฟริมคลอง', status: 'unpublished', matchedBy: ['name'], distanceMeters: null });
    expect(byId[near.id].matchedBy).toEqual(['pin']);
    expect(byId[near.id].distanceMeters).toBeLessThanOrEqual(150);
    expect(byId[near.id].category).toEqual({ id: category.id, name: 'คาเฟ่' });

    const html = await page(submission.id);
    expect(html.text).toContain('สถานที่ที่อาจซ้ำ');
    expect(html.text).toContain(`href="/admin/places/${similar.id}/edit"`);
    expect(html.text).toContain(`href="/admin/places/${near.id}/edit"`);
    expect(html.text).toContain(`href="/places/${near.id}"`);
    expect(html.text).not.toContain(`href="/places/${similar.id}"`); // unpublished: no public page
    expect(html.text).not.toContain('ร้านไกลมาก');
  });

  test('name matching ignores case, spaces and punctuation, and needs a real overlap', async () => {
    await makePlace({ name: 'Coffee  Corner!' });
    await makePlace({ name: 'ก' });
    const submission = await submit({ name: 'coffee-corner', latitude: 13.8, longitude: 100.9 });
    const body = await detail(submission.id);
    expect(body.possibleDuplicates.map((place) => place.name)).toEqual(['Coffee  Corner!']);
  });

  test('no panel when nothing looks similar', async () => {
    await makePlace({ name: 'ร้านไกลมาก', latitude: 13.75, longitude: 100.8 });
    const submission = await submit();
    expect((await detail(submission.id)).possibleDuplicates).toEqual([]);
    expect((await page(submission.id)).text).not.toContain('สถานที่ที่อาจซ้ำ');
  });

  test('shows at most five, best matches first', async () => {
    for (let n = 0; n < 7; n += 1) await makePlace({ name: `กาแฟริมคลอง สาขา ${n}` });
    const exact = await makePlace({ name: 'กาแฟริมคลอง', latitude: 13.7271, longitude: 100.7784 });
    const submission = await submit();
    const list = (await detail(submission.id)).possibleDuplicates;
    expect(list).toHaveLength(5);
    expect(list[0].id).toBe(exact.id);
    expect([...list[0].matchedBy].sort()).toEqual(['name', 'pin']);
  });

  test('shown for a returned submission, hidden once approved or rejected', async () => {
    await makePlace({ name: 'ร้านกาแฟริมคลอง' });
    const returned = await submit();
    const res = await admin.post(`/api/v1/admin/submissions/${returned.id}/return`, { version: returned.version, reason: 'เพิ่มข้อมูล' });
    expect(res.status).toBe(200);
    expect((await detail(returned.id)).possibleDuplicates).toHaveLength(1);
    expect((await page(returned.id)).text).toContain('สถานที่ที่อาจซ้ำ');

    const rejected = await submit({ name: 'กาแฟริมคลอง 2' });
    await admin.post(`/api/v1/admin/submissions/${rejected.id}/reject`, { version: rejected.version, reason: 'ซ้ำ' });
    expect((await detail(rejected.id)).possibleDuplicates).toEqual([]);
    expect((await page(rejected.id)).text).not.toContain('สถานที่ที่อาจซ้ำ');

    const approved = await submit({ name: 'กาแฟริมคลอง 3' });
    const ok = await admin.post(`/api/v1/admin/submissions/${approved.id}/approve`, { version: approved.version });
    expect(ok.status).toBe(201);
    // The approved submission's own new place is a perfect match, yet nothing is shown.
    expect((await detail(approved.id)).possibleDuplicates).toEqual([]);
    expect((await page(approved.id)).text).not.toContain('สถานที่ที่อาจซ้ำ');
  });
});
