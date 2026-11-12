-- AlterTable
ALTER TABLE "places" ADD COLUMN     "phone" VARCHAR(30),
ADD COLUMN     "website_url" VARCHAR(500);

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "phone" VARCHAR(30),
ADD COLUMN     "website_url" VARCHAR(500);

-- Hand-written rules that the Prisma schema cannot express.
-- A link must be a web address, so a page can never show a "javascript:" link.
ALTER TABLE "places"
  ADD CONSTRAINT "places_phone_not_blank_check" CHECK (btrim("phone") <> ''),
  ADD CONSTRAINT "places_website_url_check" CHECK ("website_url" ~* '^https?://[^[:space:]]+$');

ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_phone_not_blank_check" CHECK (btrim("phone") <> ''),
  ADD CONSTRAINT "submissions_website_url_check" CHECK ("website_url" ~* '^https?://[^[:space:]]+$');
