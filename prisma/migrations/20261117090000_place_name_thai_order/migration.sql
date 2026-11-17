-- Sort place names in Thai dictionary order instead of by character code.
-- With the database's default "C" order, names that start with a leading
-- vowel (เ แ โ ใ ไ) came after every other Thai name ("เดอะ พาซิโอ" after
-- "ห้องสมุด"), and capital letters came before small ones ("MASON" before
-- "Mariya"). ICU's Thai collation (PostgreSQL 10+ built with ICU, including
-- Neon) sorts เดอะ under ด and ignores letter case. Prisma cannot express a
-- column collation, so this lives only here; the column type is unchanged.
ALTER TABLE "places" ALTER COLUMN "name" SET DATA TYPE VARCHAR(200) COLLATE "th-x-icu";
