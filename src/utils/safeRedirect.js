// After login we send the user back to the page they wanted (`next`).
// Only paths on this site are allowed, so a crafted link cannot send
// someone to another website after they log in.
function safeRedirect(target, fallback = '/') {
  if (typeof target !== 'string') return fallback;
  const isLocalPath = target.startsWith('/') && !target.startsWith('//') && !target.includes('\\');
  return isLocalPath ? target : fallback;
}

module.exports = safeRedirect;
