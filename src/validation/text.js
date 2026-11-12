// Shared rules for free text typed by people.
const { z } = require('zod');

// Characters that take no space on screen: zero-width space, joiners, word
// joiner, and the byte-order mark. A name or a "please explain" box made only
// of these looks empty, so they do not count as content.
const INVISIBLE = /[​-‍⁠﻿]/g;

// Control characters (tab, newline and carriage return excepted). The NUL
// character is also removed from every request before it reaches here (see
// middleware/sanitize.js); the rest have no place in names or comments.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// True when the text has something a person can actually see.
const hasVisibleText = (value) => value.replace(INVISIBLE, '').trim().length > 0;

// A required text field: trimmed, at least `min` visible characters, at most
// `max` characters, no control characters.
function visibleText({ label, min = 1, max, minMessage }) {
  return z
    .string({ error: `กรุณากรอก${label}` })
    .trim()
    .max(max, `${label}ต้องไม่เกิน ${max} ตัวอักษร`)
    .refine((value) => !CONTROL.test(value), `${label}มีอักขระที่ใช้ไม่ได้`)
    .refine((value) => value.replace(INVISIBLE, '').trim().length >= min, minMessage ?? `กรุณากรอก${label}`);
}

// An optional text field: empty or invisible-only becomes null.
function optionalText({ label, max }) {
  return z
    .string({ error: `${label}ไม่ถูกต้อง` })
    .trim()
    .max(max, `${label}ต้องไม่เกิน ${max} ตัวอักษร`)
    .refine((value) => !CONTROL.test(value), `${label}มีอักขระที่ใช้ไม่ได้`)
    .optional()
    .nullable()
    .transform((value) => (value && hasVisibleText(value) ? value : null));
}

module.exports = { visibleText, optionalText, hasVisibleText, INVISIBLE, CONTROL };
