-- Phase 9 (TP/SL/Trailing Stop): a position needs to know whether its stop
-- loss is FIXED (locked at entry) or DYNAMIC (ratchets up with highestPrice)
-- to be re-evaluated correctly on every price update. Inherited from the
-- strategy at entry time, so it lives on the position, not just the strategy.
ALTER TABLE positions
  ADD COLUMN stop_loss_mode TEXT NOT NULL DEFAULT 'FIXED' CHECK (stop_loss_mode IN ('FIXED', 'DYNAMIC'));
