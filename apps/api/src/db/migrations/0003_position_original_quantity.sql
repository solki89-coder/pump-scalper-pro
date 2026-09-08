-- Phase 9: multi-level take-profit percentages are always relative to the
-- FULL quantity bought at entry, never to the shrinking remaining quantity
-- after earlier partial sells. `quantity` now means "remaining, unsold"
-- (already nullable-safe at 0, no CHECK constraint required it positive);
-- `original_quantity` is fixed for the position's lifetime.
ALTER TABLE positions ADD COLUMN original_quantity NUMERIC(30, 9);
UPDATE positions SET original_quantity = quantity WHERE original_quantity IS NULL;
ALTER TABLE positions ALTER COLUMN original_quantity SET NOT NULL;
