#!/usr/bin/env node
/**
 * alert-notifier.js — CloudWatch alarm → SNS → this Lambda → SES (HTML email)
 *
 * Triggered by SNS subscription. Parses the CloudWatch alarm payload and
 * sends a nicely formatted HTML email via SES from alerts@leaguescope.com.
 *
 * Env vars:
 *   ALERTS_FROM      — "LeagueScope Alerts <alerts@leaguescope.com>"
 *   ALERTS_TO        — recipient email (leaguescopeweb@gmail.com)
 *   SES_CONFIG_SET   — SES configuration set name (leaguescope-default)
 *   AWS_REGION       — auto-set by Lambda
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const sesClient = new SESv2Client({ region: process.env.AWS_REGION || 'eu-west-3' });

const FROM = process.env.ALERTS_FROM || 'LeagueScope Alerts <alerts@leaguescope.com>';
const TO = process.env.ALERTS_TO || 'leaguescopeweb@gmail.com';
const CONFIG_SET = process.env.SES_CONFIG_SET || 'leaguescope-default';

// Color palette per alarm state
const COLORS = {
  ALARM: { bg: '#fee2e2', border: '#dc2626', text: '#7f1d1d', badge: '#dc2626', emoji: '🚨' },
  OK: { bg: '#dcfce7', border: '#16a34a', text: '#14532d', badge: '#16a34a', emoji: '✅' },
  INSUFFICIENT_DATA: { bg: '#fef3c7', border: '#d97706', text: '#78350f', badge: '#d97706', emoji: '⚠️' },
};

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid',
      dateStyle: 'medium',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

function buildHtml(alarm) {
  const state = alarm.NewStateValue || 'ALARM';
  const palette = COLORS[state] || COLORS.ALARM;
  const name = escapeHtml(alarm.AlarmName || 'unknown');
  const desc = escapeHtml(alarm.AlarmDescription || '');
  const reason = escapeHtml(alarm.NewStateReason || '');
  const region = escapeHtml(alarm.Region || process.env.AWS_REGION || 'eu-west-3');
  const timestamp = formatDate(alarm.StateChangeTime || new Date().toISOString());
  const metric = alarm.Trigger || {};
  const metricName = escapeHtml(metric.MetricName || '');
  const namespace = escapeHtml(metric.Namespace || '');
  const threshold = metric.Threshold;
  const period = metric.Period;
  const dimensions = (metric.Dimensions || [])
    .map((d) => `${escapeHtml(d.name)}=${escapeHtml(d.value)}`)
    .join(', ');

  const consoleUrl = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(alarm.AlarmName || '')}`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <tr>
        <td style="background:${palette.bg};border-left:4px solid ${palette.border};padding:20px 24px;">
          <div style="display:inline-block;background:${palette.badge};color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.5px;">
            ${palette.emoji} ${escapeHtml(state)}
          </div>
          <h1 style="margin:12px 0 4px;color:${palette.text};font-size:20px;font-weight:700;">
            ${name}
          </h1>
          ${desc ? `<p style="margin:0;color:${palette.text};opacity:.85;font-size:14px;">${desc}</p>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:13px;width:140px;">Hora</td>
              <td style="padding:8px 0;color:#111827;font-size:14px;">${escapeHtml(timestamp)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:13px;">Región</td>
              <td style="padding:8px 0;color:#111827;font-size:14px;"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${region}</code></td>
            </tr>
            ${metricName ? `
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:13px;">Métrica</td>
              <td style="padding:8px 0;color:#111827;font-size:14px;"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;">${namespace}/${metricName}</code></td>
            </tr>` : ''}
            ${dimensions ? `
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:13px;">Recurso</td>
              <td style="padding:8px 0;color:#111827;font-size:14px;">${dimensions}</td>
            </tr>` : ''}
            ${threshold !== undefined ? `
            <tr>
              <td style="padding:8px 0;color:#6b7280;font-size:13px;">Umbral</td>
              <td style="padding:8px 0;color:#111827;font-size:14px;">${escapeHtml(threshold)}${period ? ` cada ${period}s` : ''}</td>
            </tr>` : ''}
          </table>

          ${reason ? `
          <div style="margin-top:20px;padding:14px 16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
            <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Motivo</div>
            <div style="font-size:13px;color:#374151;line-height:1.5;">${reason}</div>
          </div>` : ''}

          <div style="margin-top:24px;">
            <a href="${consoleUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:500;">
              Abrir alarma en CloudWatch →
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#9ca3af;text-align:center;">
            LeagueScope · alerts@leaguescope.com · <a href="https://leaguescope.com" style="color:#6b7280;text-decoration:none;">leaguescope.com</a>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText(alarm) {
  const state = alarm.NewStateValue || 'ALARM';
  const lines = [
    `[${state}] ${alarm.AlarmName || 'unknown'}`,
    '',
    `Hora: ${formatDate(alarm.StateChangeTime || new Date().toISOString())}`,
    `Región: ${alarm.Region || process.env.AWS_REGION || 'eu-west-3'}`,
    alarm.AlarmDescription ? `Descripción: ${alarm.AlarmDescription}` : '',
    alarm.NewStateReason ? `Motivo: ${alarm.NewStateReason}` : '',
    '',
    `Consola: https://${alarm.Region || 'eu-west-3'}.console.aws.amazon.com/cloudwatch/home?region=${alarm.Region || 'eu-west-3'}#alarmsV2:alarm/${encodeURIComponent(alarm.AlarmName || '')}`,
  ].filter(Boolean);
  return lines.join('\n');
}

function buildSubject(alarm) {
  const state = alarm.NewStateValue || 'ALARM';
  const emoji = (COLORS[state] || COLORS.ALARM).emoji;
  return `${emoji} [${state}] ${alarm.AlarmName || 'LeagueScope alert'}`;
}

export async function handler(event) {
  console.log('Event:', JSON.stringify(event));
  const records = event.Records || [];
  const results = [];

  for (const rec of records) {
    try {
      const snsMsg = rec.Sns?.Message;
      if (!snsMsg) {
        console.warn('No SNS message in record, skipping');
        continue;
      }

      // CloudWatch alarms send JSON as the SNS message body
      let alarm;
      try {
        alarm = JSON.parse(snsMsg);
      } catch {
        // Fallback: treat as plain text (e.g. manual SNS publish)
        alarm = {
          AlarmName: rec.Sns?.Subject || 'LeagueScope notification',
          NewStateValue: 'ALARM',
          NewStateReason: snsMsg,
          StateChangeTime: new Date().toISOString(),
        };
      }

      const subject = buildSubject(alarm);
      const html = buildHtml(alarm);
      const text = buildText(alarm);

      const cmd = new SendEmailCommand({
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
      });

      const res = await sesClient.send(cmd);
      console.log(`Email sent: ${alarm.AlarmName} [${alarm.NewStateValue}] → ${TO} (MessageId=${res.MessageId})`);
      results.push({ alarm: alarm.AlarmName, messageId: res.MessageId });
    } catch (err) {
      console.error('Failed to send alert email:', err);
      results.push({ error: err.message });
    }
  }

  return { ok: true, sent: results };
}
