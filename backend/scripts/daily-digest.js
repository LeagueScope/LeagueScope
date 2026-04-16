#!/usr/bin/env node
/**
 * daily-digest.js — Daily summary email (09:00 Europe/Madrid)
 *
 * Queries Postgres + CloudWatch, renders an HTML report and sends via SES.
 *
 * Invoked by EventBridge Scheduler (AWS::Scheduler::Schedule) with
 * Europe/Madrid timezone for DST-safe delivery.
 *
 * Env vars:
 *   PG_DSN                  — PostgreSQL connection string
 *   ALERTS_FROM             — "LeagueScope Alerts <alerts@leaguescope.com>"
 *   ALERTS_TO               — recipient email
 *   SES_CONFIG_SET          — SES configuration set name
 *   AUTO_INGEST_FN          — auto-ingest Lambda function name
 *   MATCH_POLLER_FN         — match-poller Lambda function name
 *   PANDASCORE_HOURLY_LIMIT — PandaScore hourly API call limit (default 10000)
 *   AWS_REGION              — auto-set by Lambda
 */

import pg from 'pg';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { CloudWatchClient, GetMetricStatisticsCommand, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';

const REGION = process.env.AWS_REGION || 'eu-west-3';
const FROM = process.env.ALERTS_FROM || 'LeagueScope Alerts <alerts@leaguescope.com>';
const TO = process.env.ALERTS_TO || 'leaguescopeweb@gmail.com';
const CONFIG_SET = process.env.SES_CONFIG_SET || 'leaguescope-default';
const AUTO_INGEST_FN = process.env.AUTO_INGEST_FN || 'leaguescope-auto-ingest';
const MATCH_POLLER_FN = process.env.MATCH_POLLER_FN || 'leaguescope-match-poller';
const HOURLY_LIMIT = parseInt(process.env.PANDASCORE_HOURLY_LIMIT || '10000', 10);
const DAILY_LIMIT = HOURLY_LIMIT * 24;

const ses = new SESv2Client({ region: REGION });
const cw = new CloudWatchClient({ region: REGION });

// Professional palette — no emojis, subtle color bars
const PALETTE = {
  ok: { accent: '#16a34a', bg: '#f0fdf4', label: 'Operativo' },
  warn: { accent: '#d97706', bg: '#fffbeb', label: 'Con incidencias' },
  err: { accent: '#dc2626', bg: '#fef2f2', label: 'Requiere atención' },
};

function esc(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('es-ES');
}

function fmtPct(numer, denom) {
  if (!denom || denom === 0) return numer > 0 ? '+∞' : '±0';
  const pct = ((numer - denom) / denom) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}`;
}

function fmtDateMadrid(iso) {
  if (!iso) return 'nunca';
  try {
    return new Date(iso).toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(iso);
  }
}

function fmtRelativeHours(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = diffMs / 3_600_000;
  if (hours < 1) return `hace ${Math.round(hours * 60)} min`;
  if (hours < 48) return `hace ${hours.toFixed(1)} h`;
  return `hace ${(hours / 24).toFixed(1)} d`;
}

async function queryDb() {
  const dsn = process.env.PG_DSN;
  const config = { connectionString: dsn };
  if (dsn && dsn.includes('rds.amazonaws.com')) {
    config.ssl = { rejectUnauthorized: false };
  }
  const client = new pg.Client(config);
  await client.connect();
  try {
    const [
      matches24h,
      matchesPrev24h,
      gamesWithStats24h,
      leaguesTouched24h,
      topLeaguesByNew,
      stalest,
      errors,
      apiCallsTotal,
    ] = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS n FROM matches WHERE games_ingested_at >= NOW() - INTERVAL '24 hours'`),
      client.query(`SELECT COUNT(*)::int AS n FROM matches WHERE games_ingested_at >= NOW() - INTERVAL '48 hours' AND games_ingested_at < NOW() - INTERVAL '24 hours'`),
      client.query(`
        SELECT COUNT(DISTINCT g.id)::int AS n
        FROM games g
        JOIN matches m ON m.id = g.match_id
        WHERE m.games_ingested_at >= NOW() - INTERVAL '24 hours'
          AND EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id)
      `),
      client.query(`SELECT COUNT(DISTINCT league_id)::int AS n FROM matches WHERE games_ingested_at >= NOW() - INTERVAL '24 hours' AND league_id IS NOT NULL`),
      client.query(`
        SELECT COALESCE(l.name, i.league_slug) AS league, COUNT(*)::int AS n
        FROM matches m
        LEFT JOIN leagues l ON l.id = m.league_id
        LEFT JOIN ingestion_state i ON i.league_id = m.league_id
        WHERE m.games_ingested_at >= NOW() - INTERVAL '24 hours'
        GROUP BY l.name, i.league_slug
        ORDER BY n DESC
        LIMIT 5
      `),
      client.query(`
        SELECT i.league_slug, COALESCE(l.name, i.league_slug) AS league_name, i.last_completed, i.priority, i.status
        FROM ingestion_state i
        LEFT JOIN leagues l ON l.id = i.league_id
        WHERE i.priority > 0
        ORDER BY i.last_completed ASC NULLS FIRST
        LIMIT 5
      `),
      client.query(`
        SELECT league_slug, last_error, status, retry_count, last_completed
        FROM ingestion_state
        WHERE (
          last_error IS NOT NULL
          AND last_error <> ''
          AND last_error NOT ILIKE '%LEAGUE_IDS%'
          AND last_error NOT ILIKE '%disabled%'
          AND last_error NOT ILIKE '%auto-reset%'
          AND last_error NOT ILIKE '%not mapped%'
        )
        OR (status = 'error' AND retry_count > 0)
        ORDER BY retry_count DESC NULLS LAST, last_completed DESC NULLS LAST
      `),
      client.query(`SELECT COALESCE(SUM(api_calls_used), 0)::bigint AS total FROM ingestion_state`),
    ]);

    return {
      matches24h: matches24h.rows[0].n,
      matchesPrev24h: matchesPrev24h.rows[0].n,
      gamesWithStats24h: gamesWithStats24h.rows[0].n,
      leaguesTouched24h: leaguesTouched24h.rows[0].n,
      topLeaguesByNew: topLeaguesByNew.rows,
      stalest: stalest.rows,
      errors: errors.rows,
      apiCallsTotal: Number(apiCallsTotal.rows[0].total),
    };
  } finally {
    await client.end();
  }
}

async function getLambdaMetric(functionName, metricName, startTime, endTime) {
  const cmd = new GetMetricStatisticsCommand({
    Namespace: 'AWS/Lambda',
    MetricName: metricName,
    Dimensions: [{ Name: 'FunctionName', Value: functionName }],
    StartTime: startTime,
    EndTime: endTime,
    Period: 86400,
    Statistics: ['Sum'],
  });
  const res = await cw.send(cmd);
  return res.Datapoints?.[0]?.Sum || 0;
}

async function queryCloudWatch() {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 3_600_000);

  const [autoInv, autoErr, pollInv, pollErr] = await Promise.all([
    getLambdaMetric(AUTO_INGEST_FN, 'Invocations', startTime, endTime),
    getLambdaMetric(AUTO_INGEST_FN, 'Errors', startTime, endTime),
    getLambdaMetric(MATCH_POLLER_FN, 'Invocations', startTime, endTime),
    getLambdaMetric(MATCH_POLLER_FN, 'Errors', startTime, endTime),
  ]);

  const alarms = await cw.send(new DescribeAlarmsCommand({
    AlarmNamePrefix: 'leaguescope-',
    StateValue: 'ALARM',
  }));

  return {
    autoIngest: { invocations: autoInv, errors: autoErr },
    matchPoller: { invocations: pollInv, errors: pollErr },
    activeAlarms: alarms.MetricAlarms || [],
  };
}

function computeStatus(db, cw) {
  if (db.errors.length > 0 || cw.activeAlarms.length > 0 || cw.autoIngest.errors > 5 || cw.matchPoller.errors > 10) {
    return PALETTE.err;
  }
  if (cw.autoIngest.errors > 0 || cw.matchPoller.errors > 0 || db.matches24h === 0) {
    return PALETTE.warn;
  }
  return PALETTE.ok;
}

function buildHtml(db, cwData, status) {
  const now = new Date().toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  // Estimación de llamadas API en 24h.
  // Heurística: auto-ingest ~500 calls/run, match-poller ~20 calls/run.
  const apiEstimate = Math.round(cwData.autoIngest.invocations * 500 + cwData.matchPoller.invocations * 20);
  const quotaPct = ((apiEstimate / DAILY_LIMIT) * 100).toFixed(1);

  const trendPct = fmtPct(db.matches24h, db.matchesPrev24h);
  const trendColor = db.matches24h >= db.matchesPrev24h ? '#16a34a' : '#dc2626';

  const topLeaguesRows = db.topLeaguesByNew.length
    ? db.topLeaguesByNew.map((r, i) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px;width:28px;">${i + 1}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:13px;">${esc(r.league)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:13px;text-align:right;font-variant-numeric:tabular-nums;">${fmtNum(r.n)}</td>
        </tr>`).join('')
    : `<tr><td colspan="3" style="padding:12px;color:#94a3b8;font-size:13px;text-align:center;">Sin actividad en las últimas 24 horas</td></tr>`;

  const stalestRows = db.stalest.length
    ? db.stalest.map((r) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:13px;">${esc(r.league_name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px;text-align:right;">${fmtRelativeHours(r.last_completed)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px;text-align:right;">${esc(fmtDateMadrid(r.last_completed))}</td>
        </tr>`).join('')
    : `<tr><td colspan="3" style="padding:12px;color:#94a3b8;font-size:13px;text-align:center;">Sin datos</td></tr>`;

  const issues = [];
  if (cwData.activeAlarms.length) {
    issues.push(...cwData.activeAlarms.map((a) => ({
      type: 'Alarma', name: a.AlarmName, detail: a.StateReason || 'En estado ALARM',
    })));
  }
  if (db.errors.length) {
    issues.push(...db.errors.map((e) => ({
      type: 'Ingesta', name: e.league_slug, detail: `${e.last_error || e.status} (${e.retry_count || 0} reintentos)`,
    })));
  }

  const issuesBlock = issues.length
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #fee2e2;border-radius:8px;overflow:hidden;">
        ${issues.map((i) => `
          <tr>
            <td style="padding:10px 14px;background:#fef2f2;border-bottom:1px solid #fee2e2;vertical-align:top;">
              <div style="font-size:11px;font-weight:600;color:#991b1b;text-transform:uppercase;letter-spacing:.5px;">${esc(i.type)}</div>
              <div style="font-size:13px;color:#7f1d1d;margin-top:2px;font-weight:600;">${esc(i.name)}</div>
              <div style="font-size:12px;color:#991b1b;margin-top:4px;">${esc(i.detail)}</div>
            </td>
          </tr>`).join('')}
      </table>`
    : `<div style="padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#14532d;font-size:13px;">Sin incidencias durante las últimas 24 horas.</div>`;

  const consoleBase = `https://${REGION}.console.aws.amazon.com`;
  const cloudwatchUrl = `${consoleBase}/cloudwatch/home?region=${REGION}#dashboards:`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <tr>
        <td style="background:${status.bg};border-left:3px solid ${status.accent};padding:22px 28px;">
          <div style="font-size:11px;font-weight:600;color:${status.accent};text-transform:uppercase;letter-spacing:1.2px;">Informe diario · ${esc(status.label)}</div>
          <h1 style="margin:6px 0 2px;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.2px;">Resumen de actividad LeagueScope</h1>
          <div style="font-size:13px;color:#475569;margin-top:4px;">${esc(now)}</div>
        </td>
      </tr>

      <!-- Sección 1: Actividad de ingesta -->
      <tr>
        <td style="padding:24px 28px 8px;">
          <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Actividad de ingesta · 24 h</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:separate;border-spacing:8px;">
            <tr>
              <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;vertical-align:top;width:33%;">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Partidos nuevos</div>
                <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:4px;font-variant-numeric:tabular-nums;">${fmtNum(db.matches24h)}</div>
                <div style="font-size:11px;color:${trendColor};margin-top:4px;font-weight:500;">${trendPct}% vs día anterior</div>
              </td>
              <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;vertical-align:top;width:33%;">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Games con stats</div>
                <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:4px;font-variant-numeric:tabular-nums;">${fmtNum(db.gamesWithStats24h)}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;">con telemetría completa</div>
              </td>
              <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;vertical-align:top;width:33%;">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Ligas activas</div>
                <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:4px;font-variant-numeric:tabular-nums;">${fmtNum(db.leaguesTouched24h)}</div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;">ingestadas en 24 h</div>
              </td>
            </tr>
          </table>

          <div style="margin-top:20px;">
            <div style="font-size:12px;font-weight:600;color:#334155;margin-bottom:8px;">Top 5 ligas por partidos nuevos</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
              ${topLeaguesRows}
            </table>
          </div>
        </td>
      </tr>

      <!-- Sección 2: Salud del sistema -->
      <tr>
        <td style="padding:20px 28px 8px;">
          <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Salud del sistema · 24 h</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0;">Función</td>
              <td style="padding:10px 14px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0;text-align:right;">Invocaciones</td>
              <td style="padding:10px 14px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0;text-align:right;">Errores</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;"><code style="font-family:ui-monospace,monospace;font-size:12px;color:#475569;">${AUTO_INGEST_FN}</code></td>
              <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${fmtNum(cwData.autoIngest.invocations)}</td>
              <td style="padding:10px 14px;font-size:13px;color:${cwData.autoIngest.errors > 0 ? '#dc2626' : '#0f172a'};border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;">${fmtNum(cwData.autoIngest.errors)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#0f172a;"><code style="font-family:ui-monospace,monospace;font-size:12px;color:#475569;">${MATCH_POLLER_FN}</code></td>
              <td style="padding:10px 14px;font-size:13px;color:#0f172a;text-align:right;font-variant-numeric:tabular-nums;">${fmtNum(cwData.matchPoller.invocations)}</td>
              <td style="padding:10px 14px;font-size:13px;color:${cwData.matchPoller.errors > 0 ? '#dc2626' : '#0f172a'};text-align:right;font-variant-numeric:tabular-nums;">${fmtNum(cwData.matchPoller.errors)}</td>
            </tr>
          </table>

          <div style="margin-top:16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
              <span style="font-size:12px;color:#64748b;">Llamadas PandaScore estimadas (24 h)</span>
              <span style="font-size:13px;font-weight:600;color:#0f172a;font-variant-numeric:tabular-nums;">${fmtNum(apiEstimate)} / ${fmtNum(DAILY_LIMIT)}</span>
            </div>
            <div style="margin-top:8px;background:#e2e8f0;border-radius:4px;height:6px;overflow:hidden;">
              <div style="background:${quotaPct > 80 ? '#dc2626' : quotaPct > 50 ? '#d97706' : '#16a34a'};height:100%;width:${Math.min(quotaPct, 100)}%;"></div>
            </div>
            <div style="font-size:11px;color:#64748b;margin-top:6px;">${quotaPct}% del límite diario (${fmtNum(HOURLY_LIMIT)}/hora × 24). Acumulado histórico: ${fmtNum(db.apiCallsTotal)} llamadas.</div>
          </div>
        </td>
      </tr>

      <!-- Sección 3: Ligas más stale -->
      <tr>
        <td style="padding:20px 28px 8px;">
          <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Ligas más stale · Top 5</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:10px 14px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0;">Liga</td>
              <td style="padding:10px 14px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0;text-align:right;">Edad</td>
              <td style="padding:10px 14px;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #e2e8f0;text-align:right;">Último refresh</td>
            </tr>
            ${stalestRows}
          </table>
        </td>
      </tr>

      <!-- Sección 4: Alertas activas -->
      <tr>
        <td style="padding:20px 28px 16px;">
          <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Alertas activas</div>
          <div style="margin-top:12px;">
            ${issuesBlock}
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:11px;color:#94a3b8;">
                LeagueScope · Informe automático · <a href="https://leaguescope.com" style="color:#64748b;text-decoration:none;">leaguescope.com</a>
              </td>
              <td style="font-size:11px;text-align:right;">
                <a href="${cloudwatchUrl}" style="color:#2563eb;text-decoration:none;font-weight:500;">Abrir CloudWatch →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText(db, cwData, status) {
  return [
    `Informe diario LeagueScope · ${status.label}`,
    `${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`,
    '',
    '== Actividad de ingesta (24h) ==',
    `Partidos nuevos: ${fmtNum(db.matches24h)} (${fmtPct(db.matches24h, db.matchesPrev24h)}% vs día anterior)`,
    `Games con estadísticas: ${fmtNum(db.gamesWithStats24h)}`,
    `Ligas activas: ${fmtNum(db.leaguesTouched24h)}`,
    '',
    '== Salud del sistema ==',
    `${AUTO_INGEST_FN}: ${fmtNum(cwData.autoIngest.invocations)} invocaciones, ${fmtNum(cwData.autoIngest.errors)} errores`,
    `${MATCH_POLLER_FN}: ${fmtNum(cwData.matchPoller.invocations)} invocaciones, ${fmtNum(cwData.matchPoller.errors)} errores`,
    '',
    '== Alertas ==',
    cwData.activeAlarms.length
      ? cwData.activeAlarms.map((a) => `ALARM: ${a.AlarmName}`).join('\n')
      : 'Sin incidencias',
  ].join('\n');
}

export async function handler(event) {
  console.log('Digest triggered:', JSON.stringify(event || {}));
  try {
    const [db, cwData] = await Promise.all([queryDb(), queryCloudWatch()]);
    const status = computeStatus(db, cwData);
    const html = buildHtml(db, cwData, status);
    const text = buildText(db, cwData, status);

    const today = new Date().toLocaleDateString('es-ES', {
      timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const subject = `Informe diario LeagueScope · ${today} · ${status.label}`;

    const res = await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [TO] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: text, Charset: 'UTF-8' },
          },
        },
      },
      ConfigurationSetName: CONFIG_SET,
    }));

    console.log(`Digest sent: ${res.MessageId} · status=${status.label} · matches24h=${db.matches24h}`);
    return { ok: true, messageId: res.MessageId, status: status.label };
  } catch (err) {
    console.error('Digest failed:', err);
    throw err;
  }
}
