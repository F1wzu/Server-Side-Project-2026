// Fixes from the code review: the database-error safety net in the error
// handler, and the duplicate finder no longer matching on a short common word.
const { normalize } = require('../src/middleware/errors');
const { sameName } = require('../src/models/duplicates');

describe('database errors become clear 4xx answers, not 500', () => {
  test.each([
    ['P2002', 409],
    ['P2025', 404],
    ['P2003', 409],
  ])('Prisma %s → %i', (code, status) => {
    const err = Object.assign(new Error('db'), { code });
    expect(normalize(err).status).toBe(status);
  });

  test('other unknown errors still become a 500 (null = generic error)', () => {
    expect(normalize(new Error('boom'))).toBeNull();
  });
});

describe('duplicate names', () => {
  test('a short common word inside a longer name is not a duplicate', () => {
    expect(sameName('กาแฟ', 'ร้านกาแฟริมคลอง')).toBe(false);
    expect(sameName('ร้านอาหาร', 'ร้านอาหารป้าแดงเจ้าเก่าลาดกระบัง')).toBe(false);
  });

  test('names that cover most of each other, or are equal, still match', () => {
    expect(sameName('กาแฟริมคลอง', 'ร้านกาแฟริมคลอง')).toBe(true);
    expect(sameName('ร้าน กาแฟ-ริมคลอง', 'ร้านกาแฟริมคลอง')).toBe(true);
    expect(sameName('Cafe Amazon', 'cafe amazon')).toBe(true);
  });
});
