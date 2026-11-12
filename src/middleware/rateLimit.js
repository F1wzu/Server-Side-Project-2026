// Slows down password guessing. Only failed attempts are counted; a
// successful one does not use up an attempt.
const { rateLimit, ipKeyGenerator, MemoryStore } = require('express-rate-limit');
const AppError = require('../utils/AppError');
const env = require('../config/env');

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const stores = [];

function failureLimiter({ limit, keyGenerator, message, requestWasSuccessful }) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    store,
    keyGenerator,
    skipSuccessfulRequests: true, // responses below 400 are not counted
    ...(requestWasSuccessful && { requestWasSuccessful }),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
  });
}

const emailOf = (req) => String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254);

// 5 failed attempts for one account from one address: the 6th is refused.
const LOGIN_MESSAGE = 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่';
const perAccount = failureLimiter({ limit: 5, keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${emailOf(req)}`, message: LOGIN_MESSAGE });
// 30 failed attempts from one address, whatever the accounts: stops trying one password on many emails.
const perAddress = failureLimiter({ limit: 30, keyGenerator: (req) => ipKeyGenerator(req.ip), message: LOGIN_MESSAGE });

const loginLimiter = [perAddress, perAccount];

// Changing a password asks for the current one. 5 wrong tries per account,
// so a session left open on a shared computer cannot be used to guess it.
// Use after requireLogin.
const passwordChangeLimiter = failureLimiter({
  limit: 5,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: 'ใส่รหัสผ่านเดิมผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
  // Only a wrong current password counts; a too-short new password does not.
  requestWasSuccessful: (req, res) => !res.locals.wrongCurrentPassword,
});

// Registering costs a slow password hash, and its answer shows whether an
// email already has an account. So each address may try it a limited number
// of times an hour, successful or not. Tests register many accounts from one
// address, so they get a high limit unless a test asks for the real one.
const REGISTER_LIMIT = 20;
const registerStore = new MemoryStore();
stores.push(registerStore);
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: (req) => (env.isTest && !req.get('x-test-real-limits') ? 100000 : REGISTER_LIMIT),
  store: registerStore,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', 'สมัครสมาชิกหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่')),
});

// For the tests: forget every counted attempt.
function resetRateLimits() {
  stores.forEach((store) => store.resetAll());
}

module.exports = { loginLimiter, passwordChangeLimiter, registerLimiter, REGISTER_LIMIT, resetRateLimits };
