-- Slides: per-workspace float ordering for boards (slides).

-- 1. Add the column with a temporary default so existing rows are valid.
ALTER TABLE "Board" ADD COLUMN "order" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2. Backfill each workspace's boards to sequential 1000-multiples (by recency),
--    so pre-existing boards get a stable, distinct slide order.
WITH ordered AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "workspaceId" ORDER BY "updatedAt" ASC, "id" ASC) AS rn
  FROM "Board"
)
UPDATE "Board" b
SET "order" = o.rn * 1000
FROM ordered o
WHERE b."id" = o."id";

-- 3. Index for ordered slide listing.
CREATE INDEX "Board_workspaceId_order_idx" ON "Board"("workspaceId", "order");
