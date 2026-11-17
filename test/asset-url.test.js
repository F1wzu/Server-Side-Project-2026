// Stylesheet and script URLs carry a content fingerprint, so a browser that
// cached the old file (7 days in production) fetches the new one after a deploy.
const request = require('supertest');
const { createApp } = require('../src/app');
const { assetUrl } = require('../src/utils/assetUrl');
const { closeDatabase } = require('./support/db');

const app = createApp();
afterAll(closeDatabase);

test('pages link CSS and JS with a ?v= fingerprint that the server serves', async () => {
  const page = await request(app).get('/about');
  expect(page.status).toBe(200);
  const css = page.text.match(/href="(\/css\/site\.css\?v=[0-9a-f]{10})"/);
  const js = page.text.match(/src="(\/js\/site\.js\?v=[0-9a-f]{10})"/);
  expect(css).not.toBeNull();
  expect(js).not.toBeNull();
  const served = await request(app).get(css[1]);
  expect(served.status).toBe(200);
  expect(served.text).toContain('.admin-item-tools');
});

test('the fingerprint is stable per file and a missing file keeps its plain URL', () => {
  expect(assetUrl('/css/site.css')).toBe(assetUrl('/css/site.css'));
  expect(assetUrl('/css/missing.css')).toBe('/css/missing.css');
});
