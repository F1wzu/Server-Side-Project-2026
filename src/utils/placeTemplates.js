// The ready-made illustrations in public/images/places/. An admin can pick
// one as a place's cover when there is no real photo yet (or the photo is
// broken), and a photo that fails to load falls back to one by category.
// Keys are fixed here, so a path is never built from user input.

const TEMPLATES = [
  { key: 'cafe', label: 'คาเฟ่' },
  { key: 'dining', label: 'ร้านอาหาร' },
  { key: 'market', label: 'ตลาด' },
  { key: 'lodging', label: 'ที่พัก' },
  { key: 'temple', label: 'วัด' },
  { key: 'park', label: 'สวน' },
  { key: 'nature', label: 'ธรรมชาติ' },
  { key: 'canal', label: 'ริมคลอง' },
  { key: 'library', label: 'ห้องสมุด' },
  { key: 'health', label: 'โรงพยาบาล' },
  { key: 'transit', label: 'การเดินทาง' },
];

const KEYS = TEMPLATES.map((template) => template.key);

const templatePath = (key) => `/images/places/${key}.svg`;

// The key of a template path, or null for anything else (an uploaded photo).
function templateKeyOf(path) {
  const match = typeof path === 'string' && /^\/images\/places\/([a-z]+)\.svg$/.exec(path);
  return match && KEYS.includes(match[1]) ? match[1] : null;
}

// The picture a broken photo falls back to, by the place's category kind
// (see categoryKind in views/helpers.js).
const BY_KIND = { food: 'dining', cafe: 'cafe', stay: 'lodging', service: 'health', market: 'market', park: 'park', temple: 'temple', shop: 'market', learn: 'library' };
const fallbackFor = (kind) => templatePath(BY_KIND[kind] || 'canal');

module.exports = { TEMPLATES, KEYS, templatePath, templateKeyOf, fallbackFor };
