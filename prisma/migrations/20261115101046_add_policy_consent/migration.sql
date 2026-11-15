-- AlterTable
ALTER TABLE "users" ADD COLUMN     "policy_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "policy_version" VARCHAR(20);

-- Hand-written: the time and the version are recorded together, or not at all.
ALTER TABLE "users"
  ADD CONSTRAINT "users_policy_consent_pair_check" CHECK (("policy_accepted_at" IS NULL) = ("policy_version" IS NULL));
