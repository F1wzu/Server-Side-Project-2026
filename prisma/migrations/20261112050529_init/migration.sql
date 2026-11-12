-- CreateEnum
CREATE TYPE "role" AS ENUM ('member', 'admin');

-- CreateEnum
CREATE TYPE "place_status" AS ENUM ('published', 'unpublished');

-- CreateEnum
CREATE TYPE "hours_state" AS ENUM ('open', 'closed', 'unknown');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('active', 'deleted', 'removed');

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('pending', 'changes_requested', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "submission_action" AS ENUM ('submitted', 'edited', 'resubmitted', 'returned', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(100) NOT NULL,
    "role" "role" NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "image_path" VARCHAR(500),
    "status" "place_status" NOT NULL DEFAULT 'published',
    "featured_order" INTEGER,
    "rating_avg" DECIMAL(3,2),
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "place_hours" (
    "place_id" INTEGER NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "state" "hours_state" NOT NULL DEFAULT 'unknown',
    "opens_at" TIME(0),
    "closes_at" TIME(0),
    "closes_next_day" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "place_hours_pkey" PRIMARY KEY ("place_id","weekday")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "place_id" INTEGER NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" VARCHAR(2000),
    "status" "review_status" NOT NULL DEFAULT 'active',
    "removed_by" INTEGER,
    "removed_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" INTEGER NOT NULL,
    "place_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","place_id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "image_path" VARCHAR(500),
    "hours" JSONB NOT NULL,
    "status" "submission_status" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "review_note" VARCHAR(1000),
    "place_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_events" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "action" "submission_action" NOT NULL,
    "note" VARCHAR(1000),
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "places_status_category_id_idx" ON "places"("status", "category_id");

-- CreateIndex
CREATE INDEX "places_status_rating_avg_idx" ON "places"("status", "rating_avg");

-- CreateIndex
CREATE INDEX "reviews_place_id_status_idx" ON "reviews"("place_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_user_id_place_id_key" ON "reviews"("user_id", "place_id");

-- CreateIndex
CREATE INDEX "favorites_place_id_idx" ON "favorites"("place_id");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_place_id_key" ON "submissions"("place_id");

-- CreateIndex
CREATE INDEX "submissions_status_created_at_idx" ON "submissions"("status", "created_at");

-- CreateIndex
CREATE INDEX "submissions_user_id_idx" ON "submissions"("user_id");

-- CreateIndex
CREATE INDEX "submission_events_submission_id_created_at_idx" ON "submission_events"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "sessions_expire_idx" ON "sessions"("expire");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_hours" ADD CONSTRAINT "place_hours_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules that the Prisma schema cannot express.
-- Keep this block when the schema changes; Prisma leaves CHECK constraints
-- and expression indexes alone.
-- ---------------------------------------------------------------------------

-- users
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_username_length_check" CHECK (char_length("username") >= 3);

-- categories: unique name, ignoring upper / lower case
CREATE UNIQUE INDEX "categories_name_lower_key" ON "categories" (lower("name"));
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_not_blank_check" CHECK (btrim("name") <> '');

-- places
ALTER TABLE "places"
  ADD CONSTRAINT "places_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "places_description_length_check" CHECK (char_length("description") BETWEEN 1 AND 5000),
  ADD CONSTRAINT "places_coordinates_pair_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "places_latitude_range_check" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "places_longitude_range_check" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "places_featured_order_check" CHECK ("featured_order" > 0),
  ADD CONSTRAINT "places_rating_count_check" CHECK ("rating_count" >= 0),
  ADD CONSTRAINT "places_rating_avg_range_check" CHECK ("rating_avg" BETWEEN 1 AND 5),
  ADD CONSTRAINT "places_rating_pair_check" CHECK (("rating_count" = 0) = ("rating_avg" IS NULL));

-- place_hours
ALTER TABLE "place_hours"
  ADD CONSTRAINT "place_hours_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT "place_hours_times_check" CHECK (
    ("state" = 'open' AND "opens_at" IS NOT NULL AND "closes_at" IS NOT NULL)
    OR ("state" <> 'open' AND "opens_at" IS NULL AND "closes_at" IS NULL AND NOT "closes_next_day")
  ),
  ADD CONSTRAINT "place_hours_order_check" CHECK (
    "state" <> 'open' OR "closes_next_day" OR "closes_at" > "opens_at"
  );

-- reviews
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range_check" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_removed_check" CHECK (
    ("status" = 'removed' AND "removed_by" IS NOT NULL AND "removed_reason" IS NOT NULL)
    OR ("status" <> 'removed' AND "removed_by" IS NULL AND "removed_reason" IS NULL)
  );

-- submissions
ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_name_not_blank_check" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "submissions_description_length_check" CHECK (char_length("description") BETWEEN 1 AND 5000),
  ADD CONSTRAINT "submissions_coordinates_pair_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "submissions_latitude_range_check" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "submissions_longitude_range_check" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "submissions_hours_week_check" CHECK (
    jsonb_typeof("hours") = 'array' AND jsonb_array_length("hours") = 7
  ),
  ADD CONSTRAINT "submissions_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "submissions_approved_place_check" CHECK (("status" = 'approved') = ("place_id" IS NOT NULL));

-- submission_events: a return or a rejection always carries a reason
ALTER TABLE "submission_events"
  ADD CONSTRAINT "submission_events_note_check" CHECK (
    "action" NOT IN ('returned', 'rejected') OR "note" IS NOT NULL
  );
