#!/usr/bin/env python3
"""
DEPRECATED — use migrate-team-brands.py instead.

db-create-team-brands-v2.py
Generates the team_brands table using YEAR RANGES — reads and writes directly to PostgreSQL.

Only stores entries for teams that need an override — teams whose historical
name/acronym differs from what PandaScore currently shows. Teams that never
rebranded don't need an entry (COALESCE falls back to teams.name).

Structure: team_id + year_start + year_end → display_name, display_acronym, display_logo, slug_name

Source of truth: match slugs (PandaScore never modifies them retroactively).

Usage:
  python db-create-team-brands-v2.py --dry-run   (preview without writing)
  python db-create-team-brands-v2.py              (populate team_brands)
  python db-create-team-brands-v2.py --drop       (truncate + repopulate)
"""

import os
import re
import sys
from collections import defaultdict, Counter

import psycopg2

DRY_RUN = '--dry-run' in sys.argv
DROP = '--drop' in sys.argv

PG_DSN = os.environ.get("PG_DSN")
if not PG_DSN:
    print("[ERROR] PG_DSN env variable not set. Export it or add to .env")
    sys.exit(1)

print()
print('╔══════════════════════════════════════════════════════════')
print('║  LeagueScope — Create team_brands (v2 — Year Ranges)')
print(f'║  DB: PostgreSQL')
print(f'║  Mode: {"DRY RUN" if DRY_RUN else "LIVE"}')
print('╚══════════════════════════════════════════════════════════')
print()

conn = psycopg2.connect(PG_DSN)
conn.autocommit = False
cur = conn.cursor()

# ── 0. Drop if requested ─────────────────────────────
if DROP and not DRY_RUN:
    cur.execute("TRUNCATE TABLE team_brands")
    conn.commit()
    print('  ✓ Truncated team_brands table')
    print()

# ── 1. Check existing data ──────────────────────────
cur.execute("SELECT count(*) FROM team_brands")
existing_count = cur.fetchone()[0]

if existing_count > 0 and not DROP and not DRY_RUN:
    # Check if it's the new schema (has year_start)
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'team_brands' AND column_name = 'year_start'
    """)
    if cur.fetchone():
        print(f'  ⚠ team_brands already has {existing_count} rows. Use --drop to recreate.')
        conn.close()
        sys.exit(0)
    else:
        print(f'  ⚠ Old team_brands schema detected. Please update postgresql-schema.sql first.')
        conn.close()
        sys.exit(1)

# ── 2. Load reference data ───────────────────────────
print('── Loading reference data ─────────────────────────────────')

team_info = {}
cur.execute('SELECT id, name, slug, acronym, image_url FROM teams')
for row in cur.fetchall():
    tid, name, slug, acronym, image_url = row
    slug = (slug or '').lower()
    name = name or ''
    name_slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    team_info[tid] = {
        'slug': slug, 'name': name, 'acronym': acronym or '',
        'image_url': image_url or '', 'name_slug': name_slug,
    }

series_info = {}
cur.execute('SELECT id, slug, year, season FROM series')
for row in cur.fetchall():
    sid, slug, year, season = row
    series_info[sid] = {'year': year or 0, 'slug': slug or '', 'split': season or ''}

print(f'  Teams: {len(team_info)}, Series: {len(series_info)}')
print()

# ── 3. Extract historical names from match slugs ─────
print('── Extracting names from match slugs ──────────────────────')


def clean_slug_part(part):
    part = re.sub(
        r'^\d+-(?:group-[a-z]-|knockout-stage-|quarterfinals?-|semifinals?-|finals?-)',
        '', part)
    part = re.sub(
        r'-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        '', part)
    return part


def similarity(slug_part, team_id):
    info = team_info.get(team_id)
    if not info:
        return 0
    sp = slug_part
    if sp == info['slug']:
        return 100
    if sp == info['name_slug']:
        return 95
    if info['slug'] and (info['slug'] in sp or sp in info['slug']):
        return 80
    if info['name_slug'] and (info['name_slug'] in sp or sp in info['name_slug']):
        return 75
    sp_words = set(sp.split('-'))
    slug_words = set(info['slug'].split('-')) if info['slug'] else set()
    name_words = set(info['name_slug'].split('-')) if info['name_slug'] else set()
    slug_ov = len(sp_words & slug_words) / max(len(sp_words), 1)
    name_ov = len(sp_words & name_words) / max(len(sp_words), 1)
    return max(slug_ov, name_ov) * 60


def match_slug_to_team(slug_part, team_a_id, team_b_id):
    slug_part = clean_slug_part(slug_part)
    if not slug_part:
        return None
    score_a = similarity(slug_part, team_a_id)
    score_b = similarity(slug_part, team_b_id)
    if score_a > score_b and score_a >= 30:
        return team_a_id, slug_part
    if score_b > score_a and score_b >= 30:
        return team_b_id, slug_part
    return None


# team_id → serie_id → Counter(slug)
team_serie_slugs = defaultdict(lambda: defaultdict(Counter))
matched = 0
skipped = 0

# Read matches with their two opponents from PG (flat columns, no JSON)
cur.execute("""
    SELECT m.slug, m.serie_id, mo1.team_id, mo2.team_id
    FROM matches m
    JOIN match_opponents mo1 ON mo1.match_id = m.id AND mo1.side = 1
    JOIN match_opponents mo2 ON mo2.match_id = m.id AND mo2.side = 2
    WHERE m.slug IS NOT NULL AND m.slug != ''
""")

for slug, serie_id, team_a, team_b in cur.fetchall():
    slug_clean = re.sub(r'-\d{4}-\d{2}-\d{2}.*$', '', slug)
    parts = slug_clean.split('-vs-')
    if len(parts) != 2:
        skipped += 1
        continue

    for part in parts:
        result = match_slug_to_team(part, team_a, team_b)
        if result:
            owner, cleaned = result
            team_serie_slugs[owner][serie_id][cleaned] += 1
            matched += 1
        else:
            skipped += 1

print(f'  Matched: {matched:,} | Skipped: {skipped:,}')
print()

# ── 4. Build per-team chronological records ──────────
print('── Building chronological records ─────────────────────────')

raw_per_team = defaultdict(list)
for team_id in team_serie_slugs:
    for serie_id in team_serie_slugs[team_id]:
        counter = team_serie_slugs[team_id][serie_id]
        best_slug = counter.most_common(1)[0][0]
        year = series_info.get(serie_id, {}).get('year', 0)
        raw_per_team[team_id].append((year, serie_id, best_slug))

for tid in raw_per_team:
    raw_per_team[tid].sort(key=lambda x: (x[0], x[1]))


# ── 5. Debounce A→B→A noise ─────────────────────────
def debounce_timeline(entries):
    """entries = [(year, serie_id, slug), ...]"""
    if len(entries) <= 2:
        return entries

    for _pass in range(10):
        blocks = []
        for y, sid, slug in entries:
            if blocks and blocks[-1]['slug'] == slug:
                blocks[-1]['year_end'] = y
                blocks[-1]['items'].append((y, sid, slug))
            else:
                blocks.append({
                    'slug': slug, 'year_start': y, 'year_end': y,
                    'items': [(y, sid, slug)]
                })

        if len(blocks) <= 2:
            break

        bounce_idx = None
        for i in range(1, len(blocks) - 1):
            if (blocks[i - 1]['slug'] == blocks[i + 1]['slug'] and
                    blocks[i]['year_end'] - blocks[i]['year_start'] <= 1):
                bounce_idx = i
                break

        if bounce_idx is None:
            break

        surrounding = blocks[bounce_idx - 1]['slug']
        bounce_sids = {sid for _, sid, _ in blocks[bounce_idx]['items']}
        entries = [
            (y, sid, surrounding) if sid in bounce_sids else (y, sid, slug)
            for y, sid, slug in entries
        ]

    return entries


bounced = 0
for tid in raw_per_team:
    original = raw_per_team[tid]
    cleaned = debounce_timeline(original)
    changes = sum(1 for a, b in zip(original, cleaned) if a[2] != b[2])
    bounced += changes
    raw_per_team[tid] = cleaned

print(f'  Debounced: {bounced} records corrected')
print()

# ── 6. Fill gaps from team_stats ─────────────────────
print('── Filling gaps from team_stats ───────────────────────────')

# Build slug timeline per team for propagation
team_slug_timeline = defaultdict(list)
for tid, entries in raw_per_team.items():
    for y, sid, slug in entries:
        team_slug_timeline[tid].append((y, slug))
for tid in team_slug_timeline:
    team_slug_timeline[tid].sort()

existing_team_series = set()
for tid, entries in raw_per_team.items():
    for y, sid, slug in entries:
        existing_team_series.add((tid, sid))

fallback_count = 0
cur.execute('SELECT DISTINCT team_id, serie_id FROM team_stats')
for row in cur.fetchall():
    tid, sid = row[0], row[1]
    if (tid, sid) in existing_team_series:
        continue

    year = series_info.get(sid, {}).get('year', 0)
    timeline = team_slug_timeline.get(tid)
    if not timeline:
        continue

    # Find closest slug by year
    best = None
    for y, slug in timeline:
        if y <= year:
            best = slug
        elif best is None:
            best = slug
            break

    if best:
        raw_per_team[tid].append((year, sid, best))
        fallback_count += 1

# Re-sort after adding fallbacks
for tid in raw_per_team:
    raw_per_team[tid].sort(key=lambda x: (x[0], x[1]))

print(f'  Fallback records added: {fallback_count}')
print()

# ── 7. Compress into year ranges ─────────────────────
print('── Compressing into year ranges ───────────────────────────')


def slug_to_display(slug_name):
    """Convert slug to display name."""
    special = {
        'tsm': 'TSM', 'clg': 'CLG', 'lgd': 'LGD', 'edg': 'EDG', 'rng': 'RNG',
        'jdg': 'JDG', 'tes': 'TES', 'omg': 'OMG', 'we': 'WE', 'ig': 'IG',
        'drx': 'DRX', 'gen': 'Gen', 'skt': 'SKT', 't1': 'T1', 'kt': 'KT',
        'dwg': 'DWG', 'dk': 'DK', 'lpl': 'LPL', 'lck': 'LCK', 'lec': 'LEC',
        'eg': 'EG', 'c9': 'C9', 'tl': 'TL', 'nrg': 'NRG', 'fly': 'FLY',
        'koi': 'KOI', 'g2': 'G2', 'fnc': 'FNC', 'mad': 'MAD', 'bds': 'BDS',
        'sk': 'SK', 'vit': 'VIT', 'xl': 'XL', 'msf': 'MSF', 'blg': 'BLG',
        'lng': 'LNG', 'fpx': 'FPX', 'wbg': 'WBG', 'ra': 'RA', 'v5': 'V5',
        'tt': 'TT', 'up': 'UP', 'al': 'AL', 'bnk': 'BNK', 'ns': 'NS',
        'hle': 'HLE', 'lsb': 'LSB', 'ok': 'OK', 'psg': 'PSG', 'gam': 'GAM',
        'kcb': 'KCB', 'kc': 'KC', 'uk': 'UK', 'ol': 'OL', 'nxt': 'NXT',
        'mce': 'MCE', 'lg': 'LG', 'cr': 'CR', 'sb': 'SB', 'anc': 'aNc',
        'qtv': 'QTV', 'sdx': 'SDX', 'bt': 'BT', 'ec': 'E.C.',
        'dn': 'DN', 'ii': 'II', 'bcn': 'BCN', 'nip': 'NIP',
    }
    words = slug_name.split('-')
    result = []
    for w in words:
        low = w.lower()
        if low in special:
            result.append(special[low])
        else:
            result.append(w.capitalize())
    return ' '.join(result)


def derive_acronym(slug_name, display_name):
    """
    Derive acronym from slug.

    Strategy:
    1. Known acronym mappings (slug → acronym) for common teams
    2. If all words in display_name are uppercase → use as-is (e.g. "TSM" → "TSM")
    3. Take first letter of each word, uppercase (e.g. "MAD Lions" → "ML")
       BUT prefer the known acronym if slug starts with it
    """
    slug_acronyms = {
        'tsm': 'TSM', 'clg': 'CLG', 'lgd': 'LGD', 'edg': 'EDG', 'rng': 'RNG',
        'jdg': 'JDG', 'tes': 'TES', 'omg': 'OMG', 'we': 'WE', 'ig': 'IG',
        'drx': 'DRX', 'gen-g': 'GEN', 'gen-g-esports': 'GEN',
        'sk-telecom-t1': 'SKT', 't1': 'T1', 'kt-rolster': 'KT',
        'dwg-kia': 'DK', 'dplus-kia': 'DK',
        'c9': 'C9', 'cloud9': 'C9', 'tl': 'TL', 'team-liquid': 'TL',
        'nrg': 'NRG', 'flyquest': 'FLY', 'fly': 'FLY',
        'koi': 'KOI', 'movistar-koi': 'MKOI', 'movistar-koi-fenix': 'KOI.F',
        'g2-esports': 'G2', 'g2-heretics': 'G2H',
        'fnatic': 'FNC', 'fnc': 'FNC',
        'mad-lions': 'MAD', 'mad-lions-e-c': 'MAD', 'mad-lions-koi': 'MLKOI',
        'mad-lions-madrid': 'MADM',
        'team-bds': 'BDS', 'bds': 'BDS',
        'sk-gaming': 'SK', 'sk': 'SK',
        'team-vitality': 'VIT', 'vitality': 'VIT',
        'excel-esports': 'XL', 'xl': 'XL',
        'misfits-gaming': 'MSF', 'msf': 'MSF',
        'bilibili-gaming': 'BLG', 'blg': 'BLG',
        'lng-esports': 'LNG', 'lng': 'LNG',
        'funplus-phoenix': 'FPX', 'fpx': 'FPX',
        'weibo-gaming': 'WBG', 'wbg': 'WBG',
        'rare-atom': 'RA', 'ra': 'RA',
        'victory-five': 'V5', 'v5': 'V5',
        'thundertalk-gaming': 'TT', 'tt': 'TT',
        'ultra-prime': 'UP', 'up': 'UP',
        'anyone-s-legend': 'AL', 'al': 'AL',
        'bnk-fearx': 'BFX', 'fearx': 'FOX',
        'nongshim-redforce': 'NS', 'ns': 'NS',
        'hanwha-life-esports': 'HLE', 'hle': 'HLE',
        'liiv-sandbox': 'LSB', 'sandbox-gaming': 'SB',
        'ok-brion': 'OK', 'brion': 'BRO', 'fredit-brion': 'BRO',
        'oksavingsbank-brion': 'BRO', 'hanjin-brion': 'BRO',
        'psg-talon': 'PSG', 'talon-esports': 'TLN',
        'gam-esports': 'GAM', 'gam': 'GAM',
        'karmine-corp': 'KC', 'karmine-corp-blue': 'KCB',
        'karmine-corp-academy': 'KCA',
        'team-heretics': 'TH', 'team-heretics-academy': 'HRTS',
        'los-heretics': 'TH',
        'mousesports': 'MOUZ', 'mouz': 'MOUZ', 'mouz-nxt': 'MOUZ',
        'rogue': 'RGE', 'fc-schalke-04-esports': 'S04',
        'astralis': 'AST', 'origen': 'OG',
        'furia-esports': 'FUR', 'furia-uppercut': 'FUR',
        'loud': 'LOUD', 'pain-gaming': 'PNG', 'pain': 'PNG',
        'red-canids': 'RED', 'red-canids-corinthians': 'RED',
        'kabum-esports': 'KBM',
        'isurus-gaming': 'ISG', 'isurus': 'ISG',
        'saigon-buffalo': 'SGB', 'dashing-buffalo': 'DBL',
        'team-flash': 'TF', 'team-flash-vietnam': 'TF',
        'detonation-focusme': 'DFM',
        'edward-gaming': 'EDG', 'edward-gaming-youth-team': 'EDGY',
        'top-esports': 'TES', 'jd-gaming': 'JDG',
        'oh-my-god': 'OMG', 'royal-never-give-up': 'RNG',
        'lgd-gaming': 'LGD', 'lgd-gaming-young-team': 'LGDY',
        'invictus-gaming': 'IG',
        'dragonx': 'DRX',
        'damwon-gaming': 'DWG',
        'kt-rolster-challengers': 'KT.C',
        'gen-g-challengers': 'GEN.C', 'gen-g-global-academy': 'GEN.GA',
        'fredit-brion-challengers': 'BRO.C', 'brion-challengers': 'BRO.C',
        'oksavingsbank-brion-challengers': 'BRO.C',
        'liiv-sandbox-challengers': 'LSB.C', 'liiv-sandbox-youth': 'LSB.Y',
        'nongshim-redforce-challengers': 'NS.C', 'nongshim-esports-academy': 'NS.EA',
        'dplus-kia-challengers': 'DK.C', 'dwg-kia-challengers': 'DK.C',
        'bnk-fearx-youth': 'FOX.Y', 'fearx-youth': 'FOX.Y',
        'dn-freecs': 'DNF', 'dn-soopers': 'DNS',
        'team-solomid': 'TSM', 'team-solomid-academy': 'TSM.A',
        'tsm-academy': 'TSM.A',
        'team-liquid-academy': 'TLA', 'liquid-academy': 'TLA',
        'giantx': 'GX', 'giantx-academy': 'GX.A', 'giantx-pride': 'GX.P',
        'bt-excel': 'BTXL', 'excel-uk': 'XL.UK',
        'star-horn-royal-club': 'SHR', 'royal-club': 'RYL',
        'besiktas-e-sport-club': 'BJK', 'besiktas-esports': 'BJK',
        'supermassive-esports': 'SUP', 'papara-supermassive': 'SUP',
        '100-thieves': '100T', 'counter-logic-gaming': 'CLG',
        'team-dignitas': 'DIG', 'dignitas': 'DIG',
        'immortals': 'IMT', 'golden-guardians': 'GG',
        'evil-geniuses': 'EG',
        'k1ck-esports-club': 'K1CK', 'k1ck-neosurf': 'K1CK',
        'ibai-x-pique': 'KOI',
        'movistar-riders': 'MRS',
    }

    # 1. Direct slug lookup
    if slug_name in slug_acronyms:
        return slug_acronyms[slug_name]

    # 2. Try first part of slug
    first_part = slug_name.split('-')[0]
    if first_part in slug_acronyms:
        return slug_acronyms[first_part]

    # 3. Derive from display_name: take uppercase words as-is, initials of others
    words = display_name.split()
    if len(words) == 1:
        return display_name[:3].upper()

    parts = []
    for w in words:
        if w.isupper() and len(w) >= 2:
            parts.append(w)
        else:
            parts.append(w[0].upper())

    acronym = ''.join(parts)
    if len(acronym) > 5:
        acronym = ''.join(w[0].upper() for w in words)

    return acronym


# Compress per-team entries into year ranges
year_ranges = {}  # team_id → [{ year_start, year_end, slug, display, acronym }]

for tid, entries in raw_per_team.items():
    if not entries:
        continue

    ranges = []
    cur_slug = None
    cur_start = None
    cur_end = None

    for y, sid, slug in entries:
        if slug == cur_slug:
            cur_end = y
        else:
            if cur_slug is not None:
                ranges.append({
                    'slug': cur_slug,
                    'year_start': cur_start,
                    'year_end': cur_end,
                })
            cur_slug = slug
            cur_start = y
            cur_end = y

    if cur_slug is not None:
        ranges.append({
            'slug': cur_slug,
            'year_start': cur_start,
            'year_end': cur_end,
        })

    # Add display_name and display_acronym
    for r in ranges:
        r['display'] = slug_to_display(r['slug'])
        r['acronym'] = derive_acronym(r['slug'], r['display'])

    year_ranges[tid] = ranges

total_ranges = sum(len(v) for v in year_ranges.values())
print(f'  Teams with data: {len(year_ranges)}')
print(f'  Total year ranges: {total_ranges}')
print()

# ── 8. Filter: only keep teams that need overrides ───
print('── Filtering: only teams that need overrides ──────────────')

override_ranges = {}
reasons_count = {'rebrand': 0}

for tid, ranges in year_ranges.items():
    info = team_info.get(tid)
    if not info:
        continue

    has_rebrand = len(ranges) > 1

    # For single-range teams: no override needed — COALESCE uses teams.name which
    # is correct (PandaScore's current name IS the only name they've ever had).
    if not has_rebrand:
        continue

    # Rebranded team — keep all ranges with derived acronyms
    # The LAST range = current era, use PandaScore's acronym (they get it right
    # for the current name, just not for historical ones)
    ranges[-1]['acronym'] = info['acronym'] or ranges[-1]['acronym']
    override_ranges[tid] = ranges
    reasons_count['rebrand'] += 1

override_total = sum(len(v) for v in override_ranges.values())
print(f'  Teams needing override: {len(override_ranges)}')
print(f'    Rebrands:     {reasons_count["rebrand"]}')
print(f'  Total override rows: {override_total}')
print()

# ── 9. Show rebrands ───────────────────────────────
print('── Rebrands detected ─────────────────────────────────────')

rebrand_count = 0
for tid, ranges in sorted(override_ranges.items()):
    if len(ranges) <= 1:
        continue
    rebrand_count += 1
    info = team_info.get(tid, {})
    current_name = info.get('name', '?')
    current_acr = info.get('acronym', '?')

    parts = []
    for r in ranges:
        span = str(r['year_start']) if r['year_start'] == r['year_end'] else f"{r['year_start']}-{r['year_end']}"
        parts.append(f"{r['display']} [{r['acronym']}] ({span})")

    print(f'  [{tid}] {" → ".join(parts)}')
    print(f'         PandaScore actual: {current_name} [{current_acr}]')

print(f'\n  Total rebrands: {rebrand_count}')
print()

# ── 10. Insert ───────────────────────────────────────
records = []
for tid, ranges in override_ranges.items():
    for r in ranges:
        records.append((
            tid, r['year_start'], r['year_end'],
            r['display'], r['acronym'], None,  # display_logo = NULL
            r['slug']
        ))

if not DRY_RUN:
    print('── Inserting records ─────────────────────────────────────')
    cur.executemany(
        'INSERT INTO team_brands '
        '(team_id, year_start, year_end, display_name, display_acronym, display_logo, slug_name) '
        'VALUES (%s, %s, %s, %s, %s, %s, %s) '
        'ON CONFLICT (team_id, year_start) DO UPDATE SET '
        'year_end = EXCLUDED.year_end, display_name = EXCLUDED.display_name, '
        'display_acronym = EXCLUDED.display_acronym, display_logo = EXCLUDED.display_logo, '
        'slug_name = EXCLUDED.slug_name',
        records
    )
    conn.commit()
    cur.execute('SELECT count(*) FROM team_brands')
    final = cur.fetchone()[0]
    print(f'  ✓ Inserted {final} records')
else:
    print(f'  DRY RUN: Would insert {len(records)} records')

print()
print('══════════════════════════════════════════════════════════')
print(f'  {"DRY RUN complete" if DRY_RUN else "DONE"}')
print(f'  Override teams: {len(override_ranges)} | Rows: {len(records)} | Rebrands: {rebrand_count}')
print('══════════════════════════════════════════════════════════')
print()

conn.close()
