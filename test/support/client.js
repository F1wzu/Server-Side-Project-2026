// A pretend browser for the tests: it keeps cookies between requests and
// knows how to fetch and send the CSRF token.
const request = require('supertest');

function createClient(app) {
  const agent = request.agent(app);

  const csrfToken = async () => (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken;

  return {
    agent,
    csrfToken,
    get: (path) => agent.get(path),
    // JSON request to the API, with the CSRF header.
    // The token is fetched first: the agent attaches the session cookie
    // at the moment a request is created.
    async post(path, body = {}) {
      const token = await csrfToken();
      return agent.post(path).set('X-CSRF-Token', token).send(body);
    },
    async patch(path, body = {}) {
      const token = await csrfToken();
      return agent.patch(path).set('X-CSRF-Token', token).send(body);
    },
    async put(path, body = {}) {
      const token = await csrfToken();
      return agent.put(path).set('X-CSRF-Token', token).send(body);
    },
    // HTML form post, with the hidden CSRF field.
    async postForm(path, fields = {}) {
      const token = await csrfToken();
      return agent
        .post(path)
        .type('form')
        .send({ _csrf: token, ...fields });
    },
    register(overrides = {}) {
      return this.post('/api/v1/auth/register', { username: 'สมชาย', email: 'somchai@example.com', password: 'password123', ...overrides });
    },
    login(email = 'somchai@example.com', password = 'password123') {
      return this.post('/api/v1/auth/login', { email, password });
    },
  };
}

// The value of the session cookie in a response, or undefined.
function sessionCookie(res) {
  const header = (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith('sid='));
  return header;
}

module.exports = { createClient, sessionCookie };
