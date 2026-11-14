// The heart button on place cards: shown to members only, shows the right
// saved state, and its form returns the member to the page they were on.
const { createApp } = require('../src/app');
const favoriteModel = require('../src/models/favorite');
const safeRedirect = require('../src/utils/safeRedirect');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let saved;
let unsaved;
let alice;
let bob;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

// The heart button of one place on a page: the whole <form> text for it.
const heartFor = (html, place) => {
  const forms = html.split('<form class="card-save"').slice(1).map((part) => part.slice(0, part.indexOf('</form>')));
  return forms.find((form) => form.includes(`data-place="${place.id}"`)) ?? null;
};

const BACKSLASH = String.fromCharCode(92);

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  const base = { categoryId: category.id, description: 'รายละเอียด', address: 'ลาดกระบัง', featuredOrder: 1 };
  saved = await prisma.place.create({ data: { ...base, name: 'ร้านที่บันทึก' } });
  unsaved = await prisma.place.create({ data: { ...base, name: 'ร้านที่ยังไม่บันทึก', featuredOrder: 2 } });
  alice = await member('alice');
  bob = await member('bob');
  await alice.put(`/api/v1/me/favorites/${saved.id}`);
  // Bob saves the other one, so Alice's page must not show it as saved.
  await bob.put(`/api/v1/me/favorites/${unsaved.id}`);
});

afterAll(closeDatabase);

describe.each([
  ['home', '/'],
  ['the places list', '/places'],
  ['the related places on a place page', null],
])('cards on %s', (name, path) => {
  const url = () => path ?? `/places/${saved.id}`;

  test('a member gets a pressed heart for a saved place and an unpressed one for the rest', async () => {
    // On the place page the related list holds the *other* place only.
    const target = path ? saved : unsaved;
    const res = await alice.get(url());
    expect(res.status).toBe(200);
    const heart = heartFor(res.text, target);
    expect(heart).not.toBeNull();
    expect(heart).toContain(path ? 'aria-pressed="true"' : 'aria-pressed="false"');
    expect(heart).toContain('data-favorite');
    expect(heart).toContain(path ? 'name="action" value="remove"' : 'name="action" value="save"');
    expect(heart).toContain(path ? `aria-label="เลิกบันทึก ${target.name}"` : `aria-label="บันทึก ${target.name}"`);
    // Never nested inside the card link.
    const link = res.text.slice(res.text.indexOf('<a class="card-media"'));
    expect(link.slice(0, link.indexOf('</a>'))).not.toContain('card-save');
  });

  test('a visitor gets no member toggle but the page still renders', async () => {
    const res = await createClient(app).get(url());
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('card-save');
    expect(res.text).toContain('place-card');
  });
});

test('the heart returns to the current page and query', async () => {
  const res = await alice.get('/places?sort=name');
  expect(heartFor(res.text, saved)).toContain('name="next" value="/places?sort=name"');
});

test('another member\'s saves do not show as pressed', async () => {
  const res = await alice.get('/places');
  expect(heartFor(res.text, unsaved)).toContain('aria-pressed="false"');
});

test('the saved places page keeps its own remove button instead of a heart', async () => {
  const res = await alice.get('/me/favorites');
  expect(res.status).toBe(200);
  expect(res.text).not.toContain('card-save-button');
  expect(res.text).toContain('นำออกจากรายการ');
});

describe('posting the card form', () => {
  test('saves and removes, then redirects back to the page', async () => {
    const add = await alice.postForm(`/favorites/${unsaved.id}`, { action: 'save', next: '/places?sort=name' });
    expect(add.status).toBe(303);
    expect(add.headers.location).toBe('/places?sort=name');
    expect(await favoriteModel.isSaved(alice.id, unsaved.id)).toBe(true);

    const del = await alice.postForm(`/favorites/${unsaved.id}`, { action: 'remove', next: '/me/favorites' });
    expect(del.headers.location).toBe('/me/favorites');
    expect(await favoriteModel.isSaved(alice.id, unsaved.id)).toBe(false);
  });

  test.each(['//evil.example', 'https://evil.example', `/${BACKSLASH}evil.example`, 'javascript:alert(1)', '', 'places'])(
    'next=%j falls back to the place page',
    async (next) => {
      const res = await alice.postForm(`/favorites/${unsaved.id}`, { action: 'save', next });
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe(`/places/${unsaved.id}`);
    },
  );

  test('the safe-next rule accepts only local paths', () => {
    for (const ok of ['/', '/places', '/places?q=a&page=2', '/me/favorites']) expect(safeRedirect(ok, '/x')).toBe(ok);
    for (const bad of ['//a.b', `/${BACKSLASH}a.b`, 'https://a.b', 'a/b', undefined, 5]) expect(safeRedirect(bad, '/x')).toBe('/x');
  });
});

describe('savedPlaceIds', () => {
  test('returns only that member\'s saved ids among those asked about', async () => {
    const ids = await favoriteModel.savedPlaceIds(alice.id, [saved.id, unsaved.id]);
    expect(ids).toBeInstanceOf(Set);
    expect([...ids]).toEqual([saved.id]);
    expect([...(await favoriteModel.savedPlaceIds(bob.id, [saved.id, unsaved.id]))]).toEqual([unsaved.id]);
  });

  test('is empty for no ids or no member', async () => {
    expect((await favoriteModel.savedPlaceIds(alice.id, [])).size).toBe(0);
    expect((await favoriteModel.savedPlaceIds(null, [saved.id])).size).toBe(0);
  });
});
