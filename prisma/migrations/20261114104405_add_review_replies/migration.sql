-- CreateTable
CREATE TABLE "review_replies" (
    "id" SERIAL NOT NULL,
    "review_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "status" "review_status" NOT NULL DEFAULT 'active',
    "removed_by" INTEGER,
    "removed_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_replies_review_id_status_created_at_idx" ON "review_replies"("review_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written rules that the Prisma schema cannot express.
-- A reply has visible text; a removed reply records who removed it and why,
-- and only a removed one does (same rule as reviews).
ALTER TABLE "review_replies"
  ADD CONSTRAINT "review_replies_body_not_blank_check" CHECK (btrim("body") <> ''),
  ADD CONSTRAINT "review_replies_removed_check" CHECK (
    ("status" = 'removed' AND "removed_by" IS NOT NULL AND "removed_reason" IS NOT NULL)
    OR ("status" <> 'removed' AND "removed_by" IS NULL AND "removed_reason" IS NULL)
  );
