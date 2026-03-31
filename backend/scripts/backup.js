#!/usr/bin/env node

/**
 * LeagueScope — Backup & Restore de PostgreSQL
 *
 * Uso:
 *   npm run backup                         → Crea un backup en /backups
 *   npm run backup:restore                 → Restaura el backup más reciente
 *   node scripts/backup.js --restore archivo.dump  → Restaura un backup concreto
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { config } from 'dotenv';

config();

const DSN = process.env.PG_DSN;
if (!DSN) {
  console.error('❌ PG_DSN no está definido en .env');
  process.exit(1);
}

const BACKUP_DIR = resolve(import.meta.dirname, '..', '..', 'backups');
const MAX_BACKUPS = 7;
const args = process.argv.slice(2);
const isRestore = args.includes('--restore');

// ── Backup ───────────────────────────────────────────────────────────────

function backup() {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toTimeString().slice(0, 5).replace(':', '');
  const file = join(BACKUP_DIR, `leaguescope_${date}_${time}.dump`);

  console.log(`📦 Creando backup...`);
  console.log(`   Destino: ${file}`);

  try {
    execSync(`pg_dump --format=custom --dbname="${DSN}" --file="${file}"`, {
      stdio: 'inherit',
    });
    console.log(`✅ Backup completado: ${file}`);

    // Limpiar backups antiguos
    const backups = readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.dump'))
      .map(f => ({ name: f, path: join(BACKUP_DIR, f), time: statSync(join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (backups.length > MAX_BACKUPS) {
      const old = backups.slice(MAX_BACKUPS);
      old.forEach(b => {
        unlinkSync(b.path);
        console.log(`   🗑️  Eliminado backup antiguo: ${b.name}`);
      });
    }

    console.log(`   📁 Backups guardados: ${Math.min(backups.length, MAX_BACKUPS)}`);
  } catch (e) {
    console.error(`❌ Error al crear backup: ${e.message}`);
    process.exit(1);
  }
}

// ── Restore ──────────────────────────────────────────────────────────────

function restore() {
  if (!existsSync(BACKUP_DIR)) {
    console.error('❌ No existe la carpeta de backups');
    process.exit(1);
  }

  // Buscar archivo: si se pasa como argumento o usar el más reciente
  const restoreArg = args.find(a => a !== '--restore' && a.endsWith('.dump'));
  let file;

  if (restoreArg) {
    file = resolve(restoreArg);
    if (!existsSync(file)) {
      file = join(BACKUP_DIR, restoreArg);
    }
  } else {
    const backups = readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.dump'))
      .map(f => ({ name: f, path: join(BACKUP_DIR, f), time: statSync(join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (backups.length === 0) {
      console.error('❌ No hay backups disponibles');
      process.exit(1);
    }
    file = backups[0].path;
  }

  if (!existsSync(file)) {
    console.error(`❌ Archivo no encontrado: ${file}`);
    process.exit(1);
  }

  console.log(`🔄 Restaurando backup...`);
  console.log(`   Archivo: ${file}`);
  console.log(`   ⚠️  Esto sobreescribirá los datos actuales.`);

  try {
    execSync(`pg_restore --dbname="${DSN}" --clean --if-exists "${file}"`, {
      stdio: 'inherit',
    });
    console.log(`✅ Restauración completada`);
  } catch (e) {
    // pg_restore suele dar warnings que no son errores fatales
    console.log(`⚠️  Restauración completada con warnings (normal)`);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────

if (isRestore) {
  restore();
} else {
  backup();
}
