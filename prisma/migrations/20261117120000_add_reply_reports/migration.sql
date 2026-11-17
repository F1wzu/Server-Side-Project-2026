-- Members can report a reply under a review, the same way they report a review.
-- Reuses the review_report_reason and report_status enums.

-- CreateTable
CREATE TABLE "reply_reports" (
    "id" SERIAL NOT NULL,
    "reply_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "reason" "review_report_reason" NOT NULL,
    "details" VARCHAR(1000),
    "status" "report_status" NOT NULL DEFAULT 'open',
    "resolved_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "reply_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reply_reports_status_created_at_idx" ON "reply_reports"("status", "created_at");

-- AddForeignKey
ALTER TABLE "reply_reports" ADD CONSTRAINT "reply_reports_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "review_replies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_reports" ADD CONSTRAINT "reply_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_reports" ADD CONSTRAINT "reply_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written rules that the Prisma schema cannot express (same as review_reports).
-- Details, when given, must say something; "other" must come with details.
-- A handled report records who handled it and when; an open one records neither.
ALTER TABLE "reply_reports"
  ADD CONSTRAINT "reply_reports_details_not_blank_check" CHECK (btrim("details") <> ''),
  ADD CONSTRAINT "reply_reports_other_details_check" CHECK ("reason" <> 'other' OR "details" IS NOT NULL),
  ADD CONSTRAINT "reply_reports_resolved_check" CHECK (
    ("status" = 'open' AND "resolved_by" IS NULL AND "resolved_at" IS NULL)
    OR ("status" <> 'open' AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
  );

-- A member may have only one open report per reply. Once an admin handles it,
-- the same member may report the reply again.
CREATE UNIQUE INDEX "reply_reports_one_open_per_member_key"
  ON "reply_reports" ("reply_id", "user_id")
  WHERE "status" = 'open';
