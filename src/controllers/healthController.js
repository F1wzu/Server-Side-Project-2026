const healthModel = require('../models/health');

// GET /healthz — used by the host to decide whether the app is usable.
async function check(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    await healthModel.checkDatabase();
    res.json({ status: 'ok' });
  } catch (err) {
    req.log.error({ err }, 'health check failed');
    res.status(503).json({ status: 'unavailable' });
  }
}

module.exports = { check };
