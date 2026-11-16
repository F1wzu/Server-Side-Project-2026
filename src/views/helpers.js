// Functions and labels available to every EJS template (added in app.js).
const { fallbackFor } = require('../utils/placeTemplates');

const paths = {
  pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="7.3"/><path d="m16 16 5 5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  // A mug with a handle and steam, centred in the 24px box like the other icons.
  coffee: '<path d="M4 9h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Zm12 2h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3m4-3v3"/>',
  utensils: '<path d="M4 2v7a3 3 0 0 0 6 0V2M7 2v20M20 2c-4 3-5 7-5 11h5M20 2v20"/>',
  bed: '<path d="M3 18v3m18-3v3M3 10h18v8H3V5m18 5V5H3M7 10V7h4v3m2 0V7h4v3"/>',
  bell: '<path d="M3 19h18M5 19a7 7 0 0 1 14 0M12 12V9M9.5 9h5"/>',
  store: '<path d="M3 9 4.5 4h15L21 9M4 9v11h16V9M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9.5 20v-6h5v6"/>',
  tree: '<path d="M12 22v-7M12 15c-4 0-7-2.8-7-6.5S8 2 12 2s7 2.8 7 6.5S16 15 12 15Z"/>',
  temple: '<path d="M12 2v3M5 11l7-6 7 6M3 11h18M6 11v9M18 11v9M3 20h18M10 20v-5h4v5"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v15H6.5A2.5 2.5 0 0 0 4 19.5v-15Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5M8 7h8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  map: '<path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13.5M15 6.5V20"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  logout: '<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4M16 17l5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  // The password show/hide button: an open eye while the password is readable,
  // a closed eye (lid and lashes) while it is hidden. Both are drawn around
  // the middle of the 24px box (y = 12), so the icon does not jump on a toggle.
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeClosed: '<path d="M2 8c2.2 3.2 5.6 5 10 5s7.8-1.8 10-5M12 13v3.5M6.5 11.7 5 14.5M17.5 11.7 19 14.5"/>',
};

// An inline SVG icon. The markup is fixed here, never built from user input.
function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.pin}</svg>`;
}

// The seed pictures under /images/places/ illustrate a category, not the place itself.
const isIllustration = (path) => typeof path === 'string' && /^\/images\/places\/[a-z0-9-]+\.svg$/i.test(path);

// Categories are data an admin can rename or add, so the icon and colour are
// chosen by name with a neutral fallback; nothing depends on a category's id.
const kinds = {
  ร้านอาหาร: ['food', 'utensils'],
  คาเฟ่: ['cafe', 'coffee'],
  ที่พัก: ['stay', 'bed'],
  บริการ: ['service', 'bell'],
  ตลาดและชุมชน: ['market', 'store'],
  สวนและพักผ่อน: ['park', 'tree'],
  วัดและวัฒนธรรม: ['temple', 'temple'],
  ช็อปปิง: ['shop', 'bag'],
  เรียนรู้และพิพิธภัณฑ์: ['learn', 'book'],
};
// Each colour kind with its icon, for the map pins (partials/head.ejs puts
// them in a <template> that public/js/map.js copies into each pin).
const pinIcons = () => [...Object.values(kinds), ['other', 'pin']];
const categoryKind = (category) => kinds[category?.name]?.[0] || 'other';
const categoryIcon = (category) => kinds[category?.name]?.[1] || 'pin';
// The illustration a photo falls back to when it cannot be loaded (public/js/site.js).
const photoFallback = (category) => fallbackFor(categoryKind(category));

const weekdayLabels = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const date = (value) =>
  new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(value));

// Date and time in Bangkok, for the admin's activity history.
const dateTime = (value) =>
  new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(value));

// A place with no reviews shows no number.
const rating = (value) => (value === null || value === undefined ? 'ยังไม่มีคะแนน' : Number(value).toFixed(2));

// One row of the weekly hours table. Unknown hours are shown as unknown, never as closed.
// Midnight reads better as a word: "08:00–เที่ยงคืน" instead of "08:00–00:00".
const clockLabel = (hhmm) => (hhmm === '00:00' ? 'เที่ยงคืน' : hhmm);

// One day of opening hours as shown to people. A closing time at or before
// the opening time means the place closes after midnight (see
// validation/submission.js), which is spelled out instead of left to guess.
const hoursLabel = (day) => {
  if (day.state !== 'open') return day.state === 'closed' ? 'ปิด' : 'ยังไม่ระบุ';
  if (day.opensAt === day.closesAt) return 'เปิด 24 ชั่วโมง';
  if (day.closesAt === '00:00') return `${clockLabel(day.opensAt)}–เที่ยงคืน`;
  const range = `${clockLabel(day.opensAt)}–${day.closesAt}`;
  return day.closesAt < day.opensAt ? `${range} (เลยเที่ยงคืน)` : range;
};

// "350 ม." or "1.2 กม."
const distanceLabel = (km) => (km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} ม.` : `${km.toFixed(1)} กม.`);

// "เปิดอยู่ ถึง 21:00" / "ปิดอยู่ เปิด 10:00". Unknown hours produce no label at all.
function openLabel(status) {
  if (!status || status.state === 'unknown') return '';
  if (status.state === 'open') return 'เปิดอยู่' + (status.closesAt ? ' ถึง ' + clockLabel(status.closesAt) : '');
  return 'ปิดอยู่' + (status.opensAt ? ' เปิด ' + status.opensAt : '');
}

// Opens Google Maps: directions to the pin, or a search when a place has no pin yet.
function mapsUrl(place) {
  if (place.latitude !== null && place.longitude !== null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name} ${place.address}`)}`;
}

module.exports = { icon, isIllustration, categoryKind, categoryIcon, pinIcons, photoFallback, weekdayLabels, date, dateTime, rating, hoursLabel, distanceLabel, openLabel, mapsUrl };
