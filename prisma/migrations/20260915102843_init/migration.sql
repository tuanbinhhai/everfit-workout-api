-- CreateTable
CREATE TABLE "workout_entries" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "exercise_name" TEXT NOT NULL,
    "exercise_name_normalized" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workout_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sets" (
    "id" BIGSERIAL NOT NULL,
    "workout_entry_id" BIGINT NOT NULL,
    "set_index" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "weight" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "weight_kg" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id"),
    -- Defense in depth behind DTO validation (docs/ARCHITECTURE.md §4.2 / §1).
    CONSTRAINT "chk_sets_reps_positive" CHECK ("reps" >= 1),
    CONSTRAINT "chk_sets_weight_non_negative" CHECK ("weight" >= 0),
    CONSTRAINT "chk_sets_weight_kg_non_negative" CHECK ("weight_kg" >= 0)
);

-- CreateTable
CREATE TABLE "exercise_muscle_groups" (
    "exercise_name_normalized" TEXT NOT NULL,
    "muscle_group" TEXT NOT NULL,

    CONSTRAINT "exercise_muscle_groups_pkey" PRIMARY KEY ("exercise_name_normalized")
);

-- CreateIndex
CREATE INDEX "idx_entries_user_date" ON "workout_entries"("user_id", "date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_entries_user_exercise_date" ON "workout_entries"("user_id", "exercise_name_normalized", "date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_sets_entry" ON "workout_sets"("workout_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sets_entry_set_index" ON "workout_sets"("workout_entry_id", "set_index");

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_entry_id_fkey" FOREIGN KEY ("workout_entry_id") REFERENCES "workout_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trigram support for case-insensitive partial exercise-name search (docs/ARCHITECTURE.md §6).
-- Not expressible via Prisma's declarative schema, so added by hand in this migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "idx_entries_exercise_trgm" ON "workout_entries" USING gin ("exercise_name_normalized" gin_trgm_ops);
