-- A quest the party did NOT manage still has to end (2026-07-28).
--
-- Quest resolution only ever had one door: every contracted objective completed AND none of them
-- failed. Fail-forward makes an objective terminal-but-failed, so a contract holding one could
-- never satisfy that condition again - the loop stayed active, the journal entry stayed open, no
-- payout and no closing beat, for the rest of the adventure. Live 2026-07-28 (adventure
-- c29038df): the entry contract covered all three objectives, the first failed on turn ~10, and
-- the run reached its ending with the quest still reading "active".
--
-- Mirrors paid_at: a nullable stamp that is both the record and the idempotency guard, so the
-- failure path resolves exactly once the same way the payout path does. Distinct from
-- resolved_at, which marks an OFFER leaving the table (accepted/declined), not a quest ending.
alter table quest_offers add column if not exists failed_at timestamptz;

comment on column quest_offers.failed_at is
  'Set when an accepted quest resolved without success (a contracted objective failed). Mutually exclusive with paid_at.';
