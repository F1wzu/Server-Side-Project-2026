// A flash message is shown once, on the next page, after a redirect
// (for example "เข้าสู่ระบบแล้ว"). It waits in the session until a page shows it.
function setFlash(req, type, text) {
  req.session.flash = { type, text };
}

// Views call takeFlash(); reading the message also removes it.
function exposeFlash(req, res, next) {
  res.locals.takeFlash = () => {
    const flash = req.session?.flash ?? null;
    if (flash) delete req.session.flash;
    return flash;
  };
  next();
}

module.exports = { setFlash, exposeFlash };
