-- ============================================================================
-- LeagueScope PostgreSQL Schema v4
-- Verificado campo por campo contra la SQLite real (22 tablas, 24 GB)
--
-- Principios:
--   - TEXT en vez de VARCHAR (sin overhead de check, validación en app)
--   - BIGINT en PKs auto-generadas de tablas granulares
--   - ON DELETE CASCADE en hijas, SET NULL en referencias opcionales
--   - INTEGER[] nativo para arrays simples, JSONB para estructuras complejas
--   - Tablas pre-computadas: columnas directas 1:1 con SQLite + raw_data JSONB
--   - ENUMs para campos con valores acotados
--   - Índices compuestos selectivos, sin índices de baja cardinalidad unitarios
-- ============================================================================

-- ══════════════════════════════════════════════════════════════════════════════
-- 0. TIPOS ENUMERADOS
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TYPE player_role AS ENUM ('top', 'jun', 'mid', 'adc', 'sup');
CREATE TYPE team_color AS ENUM ('blue', 'red');
CREATE TYPE draft_type AS ENUM ('pick', 'ban');
CREATE TYPE match_status AS ENUM ('finished', 'running', 'not_started', 'canceled', 'postponed');
CREATE TYPE rune_tree AS ENUM ('primary', 'secondary');
CREATE TYPE rune_type AS ENUM ('keystone', 'slot1', 'slot2', 'slot3', 'shard');
CREATE TYPE event_type AS ENUM (
    'player_kill', 'tower_kill', 'inhibitor_kill', 'drake_kill', 'baron_nashor_kill',
    'herald_kill', 'voidgrub_kill', 'atakhan_kill'
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. TABLAS DE REFERENCIA
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE leagues (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT,
    image_url       TEXT,
    url             TEXT
);

-- Champions: 173 canónicos (canonical_id del champion_map)
-- Base stats de PandaScore incluidas
CREATE TABLE champions (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    slug                TEXT,
    image_url           TEXT,
    big_image_url       TEXT,
    -- Base stats
    armor               REAL,
    armorperlevel       REAL,
    attackdamage        REAL,
    attackdamageperlevel REAL,
    attackrange         REAL,
    attackspeedoffset   REAL,
    attackspeedperlevel REAL,
    crit                REAL,
    critperlevel        REAL,
    hp                  REAL,
    hpperlevel          REAL,
    hpregen             REAL,
    hpregenperlevel     REAL,
    movespeed           REAL,
    mp                  REAL,
    mpperlevel          REAL,
    mpregen             REAL,
    mpregenperlevel     REAL,
    spellblock          REAL,
    spellblockperlevel  REAL,
    videogame_versions  TEXT[]
);

-- Aliases: los 3,628 IDs originales de PandaScore → canonical
CREATE TABLE champion_aliases (
    pandascore_id   INTEGER PRIMARY KEY,
    canonical_id    INTEGER NOT NULL REFERENCES champions(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    image_url       TEXT
);
CREATE INDEX idx_champion_aliases_canonical ON champion_aliases(canonical_id);

CREATE TABLE teams (
    id                      INTEGER PRIMARY KEY,
    name                    TEXT NOT NULL,
    slug                    TEXT,
    acronym                 TEXT,
    location                TEXT,
    image_url               TEXT,
    dark_mode_image_url     TEXT
);

CREATE TABLE players (
    id              INTEGER PRIMARY KEY,
    name            TEXT,
    first_name      TEXT,
    last_name       TEXT,
    slug            TEXT,
    role            player_role,
    nationality     TEXT,
    image_url       TEXT,
    birthday        DATE,
    active          BOOLEAN,
    current_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL
);
CREATE INDEX idx_players_team ON players(current_team_id);

-- Items: 3,450 con stats de modificadores
CREATE TABLE items (
    id                      INTEGER PRIMARY KEY,
    name                    TEXT NOT NULL,
    image_url               TEXT,
    is_trinket              BOOLEAN DEFAULT FALSE,
    gold_base               INTEGER,
    gold_total              INTEGER,
    gold_sell               INTEGER,
    gold_purchasable        BOOLEAN,
    -- Flat mods
    flat_armor_mod          REAL,
    flat_crit_chance_mod    REAL,
    flat_hp_pool_mod        REAL,
    flat_hp_regen_mod       REAL,
    flat_magic_damage_mod   REAL,
    flat_movement_speed_mod REAL,
    flat_mp_pool_mod        REAL,
    flat_mp_regen_mod       REAL,
    flat_physical_damage_mod REAL,
    flat_spell_block_mod    REAL,
    -- Percent mods
    percent_attack_speed_mod    REAL,
    percent_life_steal_mod      REAL,
    percent_movement_speed_mod  REAL,
    -- Versions
    videogame_versions      TEXT[]
);

CREATE TABLE spells (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    image_url       TEXT
);

-- Árboles de runas: 5 paths (Precision, Domination, Sorcery, Resolve, Inspiration)
CREATE TABLE rune_paths (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    image_url       TEXT
);

-- Runas: 83 (19 keystones, 17 slot1, 21 slot2, 17 slot3, 9 shards)
CREATE TABLE runes (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    image_url       TEXT,
    type            rune_type
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. COMPETICIÓN (league → serie → tournament → match → game)
-- ══════════════════════════════════════════════════════════════════════════════

-- Series: SQLite tiene (id, slug, year, split, name)
-- league_id, begin_at, end_at se extraen del JSON de tournaments.data.serie
CREATE TABLE series (
    id              INTEGER PRIMARY KEY,
    league_id       INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    full_name       TEXT,
    slug            TEXT,
    season          TEXT,              -- 'Spring', 'Summer', 'Versus', etc.
    year            INTEGER,
    begin_at        TIMESTAMPTZ,
    end_at          TIMESTAMPTZ,
    winner_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    winner_type     TEXT
);
CREATE INDEX idx_series_league ON series(league_id);
CREATE INDEX idx_series_year ON series(year);

CREATE TABLE tournaments (
    id              INTEGER PRIMARY KEY,
    serie_id        INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    league_id       INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    name            TEXT,
    slug            TEXT,
    begin_at        TIMESTAMPTZ,
    end_at          TIMESTAMPTZ,
    tier            TEXT CHECK (tier IN ('S', 'A', 'B', 'C', 'D', 'unranked')),
    winner_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    winner_type     TEXT,
    prizepool       TEXT,
    has_bracket     BOOLEAN,
    region          TEXT,
    country         TEXT
);
CREATE INDEX idx_tournaments_serie ON tournaments(serie_id);
CREATE INDEX idx_tournaments_league ON tournaments(league_id);

CREATE TABLE tournament_standings (
    tournament_id   INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    rank            SMALLINT NOT NULL,
    PRIMARY KEY (tournament_id, team_id)
);
CREATE INDEX idx_tournament_standings_team ON tournament_standings(team_id);

CREATE TABLE tournament_teams (
    tournament_id   INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    PRIMARY KEY (tournament_id, team_id)
);
CREATE INDEX idx_tournament_teams_team ON tournament_teams(team_id);

CREATE TABLE tournament_rosters (
    tournament_id   INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    role            player_role,
    PRIMARY KEY (tournament_id, team_id, player_id)
);
CREATE INDEX idx_tournament_rosters_player ON tournament_rosters(player_id);
CREATE INDEX idx_tournament_rosters_team ON tournament_rosters(team_id);

CREATE TABLE matches (
    id                      INTEGER PRIMARY KEY,
    tournament_id           INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    serie_id                INTEGER REFERENCES series(id) ON DELETE SET NULL,
    league_id               INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    name                    TEXT,
    slug                    TEXT,
    match_type              TEXT,
    number_of_games         SMALLINT CHECK (number_of_games BETWEEN 1 AND 7),
    status                  match_status,
    begin_at                TIMESTAMPTZ,
    end_at                  TIMESTAMPTZ,
    scheduled_at            TIMESTAMPTZ,
    original_scheduled_at   TIMESTAMPTZ,
    winner_id               INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    winner_type             TEXT,
    forfeit                 BOOLEAN DEFAULT FALSE,
    draw                    BOOLEAN DEFAULT FALSE,
    rescheduled             BOOLEAN DEFAULT FALSE,
    detailed_stats          BOOLEAN DEFAULT TRUE,
    stream_url              TEXT
);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_serie ON matches(serie_id);
CREATE INDEX idx_matches_league ON matches(league_id);
CREATE INDEX idx_matches_begin ON matches(begin_at);
CREATE INDEX idx_matches_winner ON matches(winner_id);

CREATE TABLE match_opponents (
    match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id         INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    side            SMALLINT CHECK (side IN (1, 2)),
    result_score    SMALLINT,
    PRIMARY KEY (match_id, team_id)
);
CREATE INDEX idx_match_opponents_team ON match_opponents(team_id);

CREATE TABLE games (
    id              INTEGER PRIMARY KEY,
    match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    tournament_id   INTEGER REFERENCES tournaments(id) ON DELETE SET NULL,
    serie_id        INTEGER REFERENCES series(id) ON DELETE SET NULL,
    league_id       INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
    position        SMALLINT CHECK (position BETWEEN 1 AND 7),
    status          match_status,
    begin_at        TIMESTAMPTZ,
    end_at          TIMESTAMPTZ,
    length          INTEGER,
    finished        BOOLEAN DEFAULT TRUE,
    complete        BOOLEAN DEFAULT TRUE,
    forfeit         BOOLEAN DEFAULT FALSE,
    winner_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    winner_type     TEXT,
    patch           TEXT,
    detailed_stats  BOOLEAN DEFAULT TRUE
);
CREATE INDEX idx_games_match ON games(match_id);
CREATE INDEX idx_games_tournament ON games(tournament_id);
CREATE INDEX idx_games_serie ON games(serie_id);
CREATE INDEX idx_games_league ON games(league_id);
CREATE INDEX idx_games_patch ON games(patch);
CREATE INDEX idx_games_begin ON games(begin_at);
CREATE INDEX idx_games_serie_begin ON games(serie_id, begin_at);

-- Equipos en cada game (blue/red) — con TODOS los campos de games.teams[]
CREATE TABLE game_teams (
    game_id             INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id             INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    color               team_color NOT NULL,
    -- Stats generales
    kills               SMALLINT,
    gold_earned         INTEGER,
    tower_kills         SMALLINT,
    inhibitor_kills     SMALLINT,
    baron_kills         SMALLINT,
    herald_kills        SMALLINT,
    dragon_kills        SMALLINT,
    elder_drake_kills   SMALLINT,
    voidgrub_kills      SMALLINT,
    atakhan_kills       SMALLINT,
    -- Drake breakdown
    chemtech_drake_kills    SMALLINT,
    cloud_drake_kills       SMALLINT,
    hextech_drake_kills     SMALLINT,
    infernal_drake_kills    SMALLINT,
    mountain_drake_kills    SMALLINT,
    ocean_drake_kills       SMALLINT,
    -- First flags
    first_blood         BOOLEAN,
    first_tower         BOOLEAN,
    first_inhibitor     BOOLEAN,
    first_baron         BOOLEAN,
    first_dragon        BOOLEAN,
    first_herald        BOOLEAN,
    first_voidgrub      BOOLEAN,
    first_atakhan       BOOLEAN,
    -- Bans
    bans                INTEGER[],        -- array de champion_ids baneados
    -- Player IDs en este equipo
    player_ids          INTEGER[],
    PRIMARY KEY (game_id, team_id)
);
CREATE INDEX idx_game_teams_team ON game_teams(team_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. DATOS IN-GAME (jugadores, picks, bans)
-- ══════════════════════════════════════════════════════════════════════════════

-- Todos los campos de games.players[] mapeados
CREATE TABLE game_players (
    id                  BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    game_id             INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id           INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id             INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    champion_id         INTEGER NOT NULL REFERENCES champion_aliases(pandascore_id),
    role                player_role,
    -- Stats básicas
    kills               SMALLINT,
    deaths              SMALLINT,
    assists             SMALLINT,
    creep_score         INTEGER,
    minions_killed      INTEGER,
    cs_at_14            INTEGER,
    cs_diff_at_14       INTEGER,
    gold_earned         INTEGER,
    gold_spent          INTEGER,
    gold_percentage     REAL,
    level               SMALLINT,
    -- Daño total
    total_damage_dealt              INTEGER,
    total_damage_dealt_to_champions INTEGER,
    total_damage_taken              INTEGER,
    total_damage_dealt_percentage   REAL,
    total_damage_dealt_to_champions_percentage REAL,
    -- Daño físico
    physical_damage_dealt               INTEGER,
    physical_damage_dealt_to_champions   INTEGER,
    physical_damage_taken               INTEGER,
    physical_damage_dealt_percentage     REAL,
    physical_damage_dealt_to_champions_percentage REAL,
    -- Daño mágico
    magic_damage_dealt                  INTEGER,
    magic_damage_dealt_to_champions     INTEGER,
    magic_damage_taken                  INTEGER,
    magic_damage_dealt_percentage       REAL,
    magic_damage_dealt_to_champions_percentage REAL,
    -- Daño verdadero
    true_damage_dealt                   INTEGER,
    true_damage_dealt_to_champions      INTEGER,
    true_damage_taken                   INTEGER,
    true_damage_dealt_percentage        REAL,
    true_damage_dealt_to_champions_percentage REAL,
    -- Heal / CC
    total_heal                          INTEGER,
    total_units_healed                  SMALLINT,
    total_time_crowd_control_dealt      INTEGER,
    -- Visión
    wards_placed                INTEGER,
    sight_wards_bought_in_game  INTEGER,
    vision_wards_bought_in_game INTEGER,
    -- Kill counters
    kills_players               SMALLINT,     -- kills_counters.players
    kills_turrets               SMALLINT,     -- kills_counters.turrets
    kills_inhibitors            SMALLINT,     -- kills_counters.inhibitors
    kills_wards                 SMALLINT,     -- kills_counters.wards
    kills_neutral_minions       INTEGER,      -- kills_counters.neutral_minions
    kills_neutral_minions_enemy_jungle  INTEGER,
    kills_neutral_minions_team_jungle   INTEGER,
    -- Kill series
    largest_killing_spree   SMALLINT,
    largest_multi_kill      SMALLINT,
    largest_critical_strike INTEGER,
    double_kills            SMALLINT,
    triple_kills            SMALLINT,
    quadra_kills            SMALLINT,
    penta_kills             SMALLINT,
    -- Flags
    first_blood_kill        BOOLEAN,
    first_blood_assist      BOOLEAN,
    first_tower_kill        BOOLEAN,
    first_tower_assist      BOOLEAN,
    first_inhibitor_kill    BOOLEAN,
    first_inhibitor_assist  BOOLEAN,
    -- Spells
    spell_1_id              INTEGER REFERENCES spells(id) ON DELETE SET NULL,
    spell_2_id              INTEGER REFERENCES spells(id) ON DELETE SET NULL,
    -- Runas
    rune_primary_path_id    INTEGER REFERENCES rune_paths(id) ON DELETE SET NULL,
    rune_secondary_path_id  INTEGER REFERENCES rune_paths(id) ON DELETE SET NULL,
    rune_shards             JSONB,
    -- Oponente (opponent is the opposing TEAM in PandaScore data, not a player)
    opponent_id             INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    opponent_champion_id    INTEGER REFERENCES champion_aliases(pandascore_id),
    -- Items finales
    items                   INTEGER[],
    --
    UNIQUE (game_id, player_id)
);
CREATE INDEX idx_game_players_game ON game_players(game_id);
CREATE INDEX idx_game_players_player ON game_players(player_id);
CREATE INDEX idx_game_players_team ON game_players(team_id);
CREATE INDEX idx_game_players_champion ON game_players(champion_id);
CREATE INDEX idx_game_players_items ON game_players USING GIN (items);

-- Picks/Bans por game (de game_teams.bans + game_players.champion_id)
CREATE TABLE game_picks_bans (
    id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    team_id         INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    champion_id     INTEGER NOT NULL REFERENCES champion_aliases(pandascore_id),
    type            draft_type NOT NULL,
    pick_turn       SMALLINT CHECK (pick_turn BETWEEN 1 AND 20),
    -- Idempotency: prevents duplicates on re-run
    UNIQUE (game_id, team_id, champion_id, type)
);
CREATE INDEX idx_picks_bans_game ON game_picks_bans(game_id);
CREATE INDEX idx_picks_bans_champion ON game_picks_bans(champion_id);
CREATE INDEX idx_picks_bans_game_type ON game_picks_bans(game_id, type);

-- Runas por jugador por game
CREATE TABLE game_player_runes (
    game_player_id  BIGINT NOT NULL REFERENCES game_players(id) ON DELETE CASCADE,
    rune_id         INTEGER NOT NULL REFERENCES runes(id) ON DELETE CASCADE,
    tree            rune_tree,
    slot            SMALLINT CHECK (slot BETWEEN 0 AND 6),
    PRIMARY KEY (game_player_id, rune_id)
);
CREATE INDEX idx_game_player_runes_rune ON game_player_runes(rune_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. TIMELINE (frames y eventos)
-- Nota: En SQLite, frames y events son 1 row per game con un ARRAY JSON.
-- En PostgreSQL, cada frame/evento es su propia fila.
-- ══════════════════════════════════════════════════════════════════════════════

-- Frames: ~30-40 por game. blue/red tienen stats de equipo y players por rol
CREATE TABLE game_frames (
    id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    timestamp       INTEGER NOT NULL,
    -- Idempotency: one frame per game per timestamp
    UNIQUE (game_id, timestamp),
    -- Blue team
    blue_team_id    INTEGER,
    blue_gold       INTEGER,
    blue_kills      SMALLINT,
    blue_towers     SMALLINT,
    blue_drakes     SMALLINT,
    blue_nashors    SMALLINT,
    blue_heralds    SMALLINT,
    blue_inhibitors SMALLINT,
    blue_voidgrubs  SMALLINT,
    blue_atakhans   SMALLINT,
    blue_score      SMALLINT,
    -- Red team
    red_team_id     INTEGER,
    red_gold        INTEGER,
    red_kills       SMALLINT,
    red_towers      SMALLINT,
    red_drakes      SMALLINT,
    red_nashors     SMALLINT,
    red_heralds     SMALLINT,
    red_inhibitors  SMALLINT,
    red_voidgrubs   SMALLINT,
    red_atakhans    SMALLINT,
    red_score       SMALLINT
);
CREATE INDEX idx_frames_game_ts ON game_frames(game_id, timestamp);

-- Stats de jugador por frame (keyed by role, not by player_id in source)
CREATE TABLE game_frame_players (
    frame_id        BIGINT NOT NULL REFERENCES game_frames(id) ON DELETE CASCADE,
    player_id       INTEGER NOT NULL,
    team_color      team_color NOT NULL,
    role            player_role,
    champion_id     INTEGER REFERENCES champion_aliases(pandascore_id),
    kills           SMALLINT,
    deaths          SMALLINT,
    assists         SMALLINT,
    cs              INTEGER,
    level           SMALLINT,
    PRIMARY KEY (frame_id, player_id)
);
CREATE INDEX idx_frame_players_player ON game_frame_players(player_id);

-- Eventos: tipos reales de PandaScore (player_kill, tower_kill, etc.)
-- killer/victim son {champion_id, player_id}
CREATE TABLE game_events (
    id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    timestamp       INTEGER,
    type            event_type NOT NULL,
    is_first        BOOLEAN,
    -- Killer
    killer_player_id    INTEGER,
    killer_champion_id  INTEGER,
    -- Victim
    victim_player_id    INTEGER,
    victim_champion_id  INTEGER,
    -- Assists: array of {champion_id, player_id}
    assistants          JSONB,
    -- Idempotency: prevents duplicates on re-run
    UNIQUE NULLS NOT DISTINCT (game_id, timestamp, type, killer_player_id, victim_player_id)
);
CREATE INDEX idx_events_game_ts ON game_events(game_id, timestamp);
CREATE INDEX idx_events_game_type ON game_events(game_id, type);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. STATS PRE-COMPUTADAS (importar directamente de PandaScore)
-- Estas tablas tienen columnas directas en SQLite (no JSON blobs).
-- Se copian 1:1 con todos los campos.
-- ══════════════════════════════════════════════════════════════════════════════

-- Champion global stats: 59,977 rows × 50 columnas
-- PK = (champion_id, serie_id)
CREATE TABLE champion_global_stats (
    champion_id             INTEGER NOT NULL REFERENCES champion_aliases(pandascore_id),
    serie_id                INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    champion_name           TEXT,
    total_games_in_serie    INTEGER,
    players_count           INTEGER,
    picks                   INTEGER,
    bans                    INTEGER,
    wins                    INTEGER,
    losses                  INTEGER,
    win_rate                REAL,
    blue_picks              INTEGER,
    blue_wins               INTEGER,
    red_picks               INTEGER,
    red_wins                INTEGER,
    bans_blue               INTEGER,
    bans_red                INTEGER,
    ban_rate_blue           REAL,
    ban_rate_red            REAL,
    ban_turn_avg            REAL,
    avg_game_duration       REAL,
    kills_avg               REAL,
    deaths_avg              REAL,
    assists_avg             REAL,
    kda                     REAL,
    kill_participation      REAL,
    fb_rate                 REAL,
    double_kills            INTEGER,
    triple_kills            INTEGER,
    quadra_kills            INTEGER,
    penta_kills             INTEGER,
    cs_at_14_avg            REAL,
    cs_diff_at_14_avg       REAL,
    dpm                     REAL,
    gpm                     REAL,
    cspm                    REAL,
    avg_dtaken_pm           REAL,
    avg_magic_dpm           REAL,
    avg_physical_dpm        REAL,
    avg_true_dpm            REAL,
    dmg_share               REAL,
    gold_share              REAL,
    avg_wpm                 REAL,
    avg_wcpm                REAL,
    main_role               TEXT,
    roles_json              JSONB,
    top_players_json        JSONB,
    matchups_json           JSONB,
    items_json              JSONB,
    keystones_json          JSONB,
    patch_breakdown_json    JSONB,
    PRIMARY KEY (champion_id, serie_id)
);
CREATE INDEX idx_cgs_serie ON champion_global_stats(serie_id);

-- Player career: 41,541 rows × 56 columnas
-- PK = (player_id, serie_id)
CREATE TABLE player_career (
    player_id               INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    serie_id                INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    team_id                 INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    role                    TEXT,
    games                   INTEGER,
    wins                    INTEGER,
    losses                  INTEGER,
    win_rate                REAL,
    avg_duration            REAL,
    unique_champions        INTEGER,
    blue_games              INTEGER,
    blue_wins               INTEGER,
    red_games               INTEGER,
    red_wins                INTEGER,
    total_kills             INTEGER,
    total_deaths            INTEGER,
    total_assists           INTEGER,
    kills_avg               REAL,
    deaths_avg              REAL,
    assists_avg             REAL,
    kda                     REAL,
    kill_participation      REAL,
    max_kills               INTEGER,
    first_blood_rate        REAL,
    first_tower_rate        REAL,
    double_kills            INTEGER,
    triple_kills            INTEGER,
    quadra_kills            INTEGER,
    penta_kills             INTEGER,
    avg_dtaken_pm           REAL,
    avg_magic_dpm           REAL,
    avg_physical_dpm        REAL,
    avg_true_dpm            REAL,
    avg_cc_per_min          REAL,
    avg_heal_per_min        REAL,
    cspm                    REAL,
    gpm                     REAL,
    dpm                     REAL,
    dmg_share               REAL,
    gold_share              REAL,
    avg_gold_spent          REAL,
    avg_cs_diff_13          REAL,
    avg_cs_diff_14          REAL,
    avg_cs_diff_20          REAL,
    avg_cs_diff_25          REAL,
    avg_level_diff_13       REAL,
    avg_level_diff_20       REAL,
    avg_level_diff_25       REAL,
    avg_kills_diff_13       REAL,
    avg_kills_diff_20       REAL,
    avg_kills_diff_25       REAL,
    avg_vspm                REAL,
    avg_wpm                 REAL,
    avg_wkpm                REAL,
    avg_cwpm                REAL,
    keystones_json          JSONB,
    PRIMARY KEY (player_id, serie_id)
);
CREATE INDEX idx_pc_serie ON player_career(serie_id);
CREATE INDEX idx_pc_team ON player_career(team_id);

-- Team career: 7,273 rows × 77 columnas
-- PK = (team_id, serie_id)
CREATE TABLE team_career (
    team_id                 INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    serie_id                INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    games                   INTEGER,
    wins                    INTEGER,
    losses                  INTEGER,
    win_rate                REAL,
    avg_duration            REAL,
    avg_win_duration        REAL,
    avg_loss_duration       REAL,
    unique_champions        INTEGER,
    total_kills             INTEGER,
    total_deaths            INTEGER,
    total_assists           INTEGER,
    kills_avg               REAL,
    deaths_avg              REAL,
    assists_avg             REAL,
    kda                     REAL,
    avg_cspm                REAL,
    gpm                     REAL,
    egpm                    REAL,
    dpm                     REAL,
    delta_gpm               REAL,
    delta_cspm              REAL,
    blue_games              INTEGER,
    blue_wins               INTEGER,
    red_games               INTEGER,
    red_wins                INTEGER,
    avg_dtaken_pm           REAL,
    avg_magic_dpm           REAL,
    avg_physical_dpm        REAL,
    avg_true_dpm            REAL,
    avg_cc_per_min          REAL,
    avg_heal_per_min        REAL,
    avg_gold_diff_13        REAL,
    avg_gold_diff_14        REAL,
    avg_gold_diff_20        REAL,
    avg_gold_diff_25        REAL,
    avg_cs_diff_13          REAL,
    avg_cs_diff_14          REAL,
    avg_cs_diff_20          REAL,
    avg_cs_diff_25          REAL,
    avg_kills_diff_13       REAL,
    avg_kills_diff_14       REAL,
    avg_kills_diff_20       REAL,
    avg_kills_diff_25       REAL,
    avg_tower_diff_13       REAL,
    avg_tower_diff_20       REAL,
    avg_tower_diff_25       REAL,
    avg_drake_diff_13       REAL,
    avg_drake_diff_20       REAL,
    avg_drake_diff_25       REAL,
    avg_neutral_minions_team    REAL,
    avg_neutral_minions_enemy   REAL,
    avg_towers              REAL,
    avg_towers_lost         REAL,
    avg_plates              REAL,
    avg_inhibitors          REAL,
    avg_dragons             REAL,
    avg_elder_dragons       REAL,
    avg_barons              REAL,
    avg_heralds             REAL,
    avg_voidgrubs           REAL,
    avg_atakhans            REAL,
    drake_breakdown_json    JSONB,
    first_blood_rate        REAL,
    first_tower_rate        REAL,
    first_dragon_rate       REAL,
    dragon_soul_rate        REAL,
    first_elder_rate        REAL,
    first_baron_rate        REAL,
    first_herald_rate       REAL,
    first_voidgrub_rate     REAL,
    first_atakhan_rate      REAL,
    first_inhibitor_rate    REAL,
    avg_wpm                 REAL,
    avg_wkpm                REAL,
    avg_cwpm                REAL,
    PRIMARY KEY (team_id, serie_id)
);
CREATE INDEX idx_tc_serie ON team_career(serie_id);

-- Player champion stats: 290,801 rows × 28 columnas
-- PK = (player_id, serie_id, champion_id)
CREATE TABLE player_champion_stats (
    player_id               INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    serie_id                INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    champion_id             INTEGER NOT NULL REFERENCES champion_aliases(pandascore_id),
    champion_name           TEXT,
    games                   INTEGER,
    wins                    INTEGER,
    losses                  INTEGER,
    win_rate                REAL,
    avg_game_duration       REAL,
    blue_games              INTEGER,
    blue_wins               INTEGER,
    red_games               INTEGER,
    red_wins                INTEGER,
    kills_avg               REAL,
    deaths_avg              REAL,
    assists_avg             REAL,
    kda                     REAL,
    kill_participation      REAL,
    dpm                     REAL,
    cspm                    REAL,
    gpm                     REAL,
    dmg_share               REAL,
    gold_share              REAL,
    double_kills            INTEGER,
    triple_kills            INTEGER,
    quadra_kills            INTEGER,
    penta_kills             INTEGER,
    avg_wpm                 REAL,
    PRIMARY KEY (player_id, serie_id, champion_id)
);
CREATE INDEX idx_pcs_serie ON player_champion_stats(serie_id);
CREATE INDEX idx_pcs_champion ON player_champion_stats(champion_id);

-- Match player stats: 411,836 rows — JSON con stats.averages y stats.totals
CREATE TABLE match_player_stats (
    match_id                INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id               INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id                 INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    games_count             INTEGER,
    -- Importar como JSONB porque stats.averages y stats.totals tienen sub-objetos
    -- (kill_counters{}, magic_damage{}, etc.) demasiado anidados para columnas
    stats_averages          JSONB,
    stats_totals            JSONB,
    PRIMARY KEY (match_id, player_id)
);
CREATE INDEX idx_mps_player ON match_player_stats(player_id);

-- Tournament player stats: 65,197 rows — JSON rico
CREATE TABLE tournament_player_stats (
    tournament_id           INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id               INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id                 INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    games_count             INTEGER,
    stats_averages          JSONB,
    stats_totals            JSONB,
    favorite_champions      JSONB,
    last_games              JSONB,
    PRIMARY KEY (tournament_id, player_id)
);
CREATE INDEX idx_tps_player ON tournament_player_stats(player_id);

-- Tournament team stats: 12,295 rows — JSON con most_picked, most_banned, stats
CREATE TABLE tournament_team_stats (
    tournament_id           INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id                 INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    games_count             INTEGER,
    stats_averages          JSONB,
    stats_totals            JSONB,
    most_picked             JSONB,
    most_banned             JSONB,
    most_banned_against     JSONB,
    players                 JSONB,
    PRIMARY KEY (tournament_id, team_id)
);
CREATE INDEX idx_tts_team ON tournament_team_stats(team_id);

-- Player stats: 41,480 rows — JSON con stats, favorite_champions, last_games, teams
CREATE TABLE player_stats (
    serie_id                INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    player_id               INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    team_id                 INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    games_count             INTEGER,
    stats_averages          JSONB,
    stats_totals            JSONB,
    stats_serie             JSONB,
    favorite_champions      JSONB,
    last_games              JSONB,
    teams_history           JSONB,
    PRIMARY KEY (serie_id, player_id)
);
CREATE INDEX idx_ps_player ON player_stats(player_id);

-- Team stats: 7,757 rows — JSON con stats, most_picked/banned
CREATE TABLE team_stats (
    serie_id                INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    team_id                 INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    games_count             INTEGER,
    stats_averages          JSONB,
    stats_totals            JSONB,
    stats_serie             JSONB,
    most_picked             JSONB,
    most_banned             JSONB,
    most_banned_against     JSONB,
    last_games              JSONB,
    players                 JSONB,
    PRIMARY KEY (serie_id, team_id)
);
CREATE INDEX idx_ts_team ON team_stats(team_id);

-- Team brands: historical team names for rebranded teams (year-range based)
-- Only stores overrides for teams that actually rebranded (86 teams, ~188 rows).
-- Teams without overrides fall back to PandaScore's current name via COALESCE.
CREATE TABLE team_brands (
    team_id           INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    year_start        SMALLINT NOT NULL,
    year_end          SMALLINT NOT NULL,
    display_name      TEXT,
    display_acronym   TEXT,
    display_logo      TEXT,
    slug_name         TEXT,
    PRIMARY KEY (team_id, year_start)
);
CREATE INDEX idx_tb_year ON team_brands(year_start, year_end);

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. VISTAS ÚTILES
-- ══════════════════════════════════════════════════════════════════════════════

CREATE VIEW v_game_players AS
SELECT
    gp.*,
    ca.canonical_id AS canonical_champion_id,
    c.name AS champion_name,
    p.name AS player_name,
    t.name AS team_name
FROM game_players gp
LEFT JOIN champion_aliases ca ON gp.champion_id = ca.pandascore_id
LEFT JOIN champions c ON ca.canonical_id = c.id
LEFT JOIN players p ON gp.player_id = p.id
LEFT JOIN teams t ON gp.team_id = t.id;

CREATE VIEW v_picks_bans AS
SELECT
    pb.*,
    ca.canonical_id AS canonical_champion_id,
    c.name AS champion_name,
    t.name AS team_name
FROM game_picks_bans pb
LEFT JOIN champion_aliases ca ON pb.champion_id = ca.pandascore_id
LEFT JOIN champions c ON ca.canonical_id = c.id
LEFT JOIN teams t ON pb.team_id = t.id;

CREATE VIEW v_games AS
SELECT
    g.*,
    m.name AS match_name,
    m.match_type,
    t.name AS tournament_name,
    s.full_name AS serie_name,
    l.name AS league_name,
    s.year
FROM games g
LEFT JOIN matches m ON g.match_id = m.id
LEFT JOIN tournaments t ON g.tournament_id = t.id
LEFT JOIN series s ON g.serie_id = s.id
LEFT JOIN leagues l ON g.league_id = l.id;
