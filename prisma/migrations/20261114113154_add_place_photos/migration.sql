-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "extra_image_paths" VARCHAR(500)[] DEFAULT ARRAY[]::VARCHAR(500)[];

-- CreateTable
CREATE TABLE "place_photos" (
    "id" SERIAL NOT NULL,
    "place_id" INTEGER NOT NULL,
    "image_path" VARCHAR(500) NOT NULL,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "place_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "place_photos_place_id_position_key" ON "place_photos"("place_id", "position");

-- AddForeignKey
ALTER TABLE "place_photos" ADD CONSTRAINT "place_photos_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written rules that the Prisma schema cannot express.
-- Prisma creates list columns as nullable; an empty list means "no extra photos".
UPDATE "submissions" SET "extra_image_paths" = ARRAY[]::VARCHAR(500)[] WHERE "extra_image_paths" IS NULL;
ALTER TABLE "submissions"
  ALTER COLUMN "extra_image_paths" SET NOT NULL,
  -- At most 5 photos per submission: the cover plus 4 more, and never extra
  -- photos without a cover.
  ADD CONSTRAINT "submissions_extra_image_paths_check" CHECK (
    cardinality("extra_image_paths") <= 4
    AND ("image_path" IS NOT NULL OR cardinality("extra_image_paths") = 0)
  );

ALTER TABLE "place_photos"
  ADD CONSTRAINT "place_photos_position_check" CHECK ("position" >= 0),
  ADD CONSTRAINT "place_photos_image_path_not_blank_check" CHECK (btrim("image_path") <> '');
