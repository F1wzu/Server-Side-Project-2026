// What a stored photo looks like in the database, for either driver. Kept
// apart from the drivers (and free of settings) so models and views can ask
// "is this one of our uploads?" without loading a driver.

// Local driver: /uploads/<uuid>.webp, served by app.js.
const LOCAL_PATH = /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp)$/;

// Cloud driver: the address Cloudinary gives back for a photo this app
// uploaded, always inside the "painaidee" folder with a UUID name. Groups:
// the cloud name, and the public id ("painaidee/<uuid>") used to delete it.
const CLOUD_URL =
  /^https:\/\/res\.cloudinary\.com\/([a-z0-9_-]+)\/image\/upload\/(?:v\d+\/)?(painaidee\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/;

const CLOUD_HOST = 'https://res.cloudinary.com';

// A photo a member or admin uploaded (as opposed to a seed illustration
// under /images/, which belongs to the project and is never deleted).
const isUpload = (path) => typeof path === 'string' && (path.startsWith('/uploads/') || CLOUD_URL.test(path));

module.exports = { LOCAL_PATH, CLOUD_URL, CLOUD_HOST, isUpload };
