-- AlterTable
ALTER TABLE "users" ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 1;

-- Hand-written rule that the Prisma schema cannot express.
-- "Closes the next day" must really cross midnight: closing time at or before
-- the opening time (00:00–00:00 means open around the clock). Without this, a
-- normal 10:00–20:00 day ticked as "next day" would look open for 34 hours.
ALTER TABLE "place_hours" DROP CONSTRAINT "place_hours_order_check";
ALTER TABLE "place_hours" ADD CONSTRAINT "place_hours_order_check" CHECK (
  "state" <> 'open'
  OR ("closes_next_day" AND "closes_at" <= "opens_at")
  OR (NOT "closes_next_day" AND "closes_at" > "opens_at")
);
