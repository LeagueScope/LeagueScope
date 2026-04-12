-- Migration: Change game_player_runes PK from (game_player_id, rune_id) to (game_player_id, slot)
-- Reason: A player CAN have the same rune in multiple slots (e.g., Adaptative Force as offense AND flex shard)
--         The old PK silently dropped the duplicate, losing shard data.

BEGIN;

-- 1. Drop the old PK
ALTER TABLE game_player_runes DROP CONSTRAINT game_player_runes_pkey;

-- 2. Remove any rows with NULL slot (shouldn't exist, but safety)
DELETE FROM game_player_runes WHERE slot IS NULL;

-- 3. Make slot NOT NULL
ALTER TABLE game_player_runes ALTER COLUMN slot SET NOT NULL;

-- 4. Add new PK
ALTER TABLE game_player_runes ADD PRIMARY KEY (game_player_id, slot);

COMMIT;
