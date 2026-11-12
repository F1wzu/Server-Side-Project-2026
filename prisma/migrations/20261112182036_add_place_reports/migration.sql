-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('closed', 'moved', 'wrong_info', 'other');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "place_reports" (
    "id" SERIAL NOT NULL,
    "place_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "reason" "report_reason" NOT NULL,
    "details" VARCHAR(1000),
    "status" "report_status" NOT NULL DEFAULT 'open',
    "resolved_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "place_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "place_reports_status_created_at_idx" ON "place_reports"("status", "created_at");

-- AddForeignKey
ALTER TABLE "place_reports" ADD CONSTRAINT "place_reports_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_reports" ADD CONSTRAINT "place_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_reports" ADD CONSTRAINT "place_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written rules that the Prisma schema cannot express.
-- "Other" says nothing by itself, so it must come with an explanation.
-- A report that has been handled records who handled it and when; an open one records neither.
ALTER TABLE "place_reports"
  ADD CONSTRAINT "place_reports_details_not_blank_check" CHECK (btrim("details") <> ''),
  ADD CONSTRAINT "place_reports_other_details_check" CHECK ("reason" <> 'other' OR "details" IS NOT NULL),
  ADD CONSTRAINT "place_reports_resolved_check" CHECK (
    ("status" = 'open' AND "resolved_by" IS NULL AND "resolved_at" IS NULL)
    OR ("status" <> 'open' AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
  );

-- A member may have only one open report per place. Once an admin handles it,
-- the same member may report the place again.
CREATE UNIQUE INDEX "place_reports_one_open_per_member_key"
  ON "place_reports" ("place_id", "user_id")
  WHERE "status" = 'open';
