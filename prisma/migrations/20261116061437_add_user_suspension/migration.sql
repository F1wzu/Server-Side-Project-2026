-- CreateEnum
CREATE TYPE "user_moderation_action" AS ENUM ('suspended', 'unsuspended');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspended_at" TIMESTAMPTZ(6),
ADD COLUMN     "suspended_reason" VARCHAR(500),
ADD COLUMN     "suspended_until" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "user_moderation_events" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "action" "user_moderation_action" NOT NULL,
    "note" VARCHAR(500),
    "until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_moderation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_moderation_events_user_id_created_at_idx" ON "user_moderation_events"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_moderation_events" ADD CONSTRAINT "user_moderation_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_moderation_events" ADD CONSTRAINT "user_moderation_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: a suspension is set as a whole. The start and the reason come
-- together, an end date needs a start, and the end is after the start (NULL end
-- means "until an admin lifts it").
ALTER TABLE "users"
  ADD CONSTRAINT "users_suspension_pair_check" CHECK (("suspended_at" IS NULL) = ("suspended_reason" IS NULL)),
  ADD CONSTRAINT "users_suspension_until_check" CHECK ("suspended_until" IS NULL OR "suspended_at" IS NOT NULL),
  ADD CONSTRAINT "users_suspension_order_check" CHECK ("suspended_until" IS NULL OR "suspended_until" > "suspended_at");
