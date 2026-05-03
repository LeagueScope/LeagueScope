# LeagueScope Auto-Ingest — Deployment Guide

## Architecture

```
EventBridge (every 15 min) → Lambda (auto-ingest.js) → PandaScore API → PostgreSQL (RDS)
```

- Lambda picks the most stale leagues from `ingestion_state` table
- Processes 2-5 leagues per invocation (respects 15-min timeout)
- All 50+ leagues cycle every ~4 hours
- 10K API calls/hour limit respected via 400ms delays

## Prerequisites

1. **AWS SAM CLI** installed: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html
2. **AWS CLI** configured with credentials for eu-west-3
3. **Node.js 22** (matches App Runner runtime)

## Step 1: Initialize the database table

Run this once to create the `ingestion_state` tracking table:

```bash
cd backend
# IMPORTANTE: nunca commitees PG_DSN al repo. Léelo de un .env local
# (ya en .gitignore) o exportalo en la sesión:
#   export PG_DSN="postgresql://USER:PASS@HOST:5432/DB"
node -e "
    import pg from 'pg';
    import fs from 'fs';
    const pool = new pg.Pool({ connectionString: process.env.PG_DSN, ssl: { rejectUnauthorized: false } });
    const sql = fs.readFileSync('scripts/sql/ingestion_state.sql', 'utf-8');
    await pool.query(sql);
    console.log('Done');
    await pool.end();
  "
```

## Step 2: Test locally

```bash
# Test with just 1 league, 2-min timeout
npm run auto-ingest:test

# Full run (14 min, up to 10 leagues)
npm run auto-ingest
```

## Step 3: Deploy Lambda + EventBridge

```bash
cd infra

# Build the Lambda package
sam build --template template.yaml

# Deploy (first time — creates the stack)
# Lee PG_DSN y PANDASCORE_TOKEN de tu .env local antes de ejecutar:
#   set -a; source ../.env; set +a
sam deploy \
  --stack-name leaguescope-auto-ingest \
  --region eu-west-3 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    PgDsn="$PG_DSN" \
    PandascoreToken="$PANDASCORE_TOKEN" \
    ScheduleRate="rate(15 minutes)"

# Subsequent deploys
sam deploy --stack-name leaguescope-auto-ingest --region eu-west-3
```

## Step 4: Verify

```bash
# Check Lambda logs
aws logs tail /aws/lambda/leaguescope-auto-ingest --follow --region eu-west-3

# Manually trigger
aws lambda invoke \
  --function-name leaguescope-auto-ingest \
  --region eu-west-3 \
  --payload '{}' \
  response.json && cat response.json

# Check ingestion state
psql $PG_DSN -c "SELECT league_slug, priority, status, last_completed, api_calls_used FROM ingestion_state ORDER BY last_completed DESC NULLS LAST;"
```

## Monitoring

- **CloudWatch Logs**: `/aws/lambda/leaguescope-auto-ingest`
- **CloudWatch Alarm**: `leaguescope-ingest-errors` — triggers if > 3 errors in 1 hour
- **ingestion_state table**: `SELECT * FROM ingestion_state ORDER BY last_completed;`

## Adjusting

| Setting | How to change |
|---------|---------------|
| Frequency | Change `ScheduleRate` parameter (e.g., `rate(10 minutes)`) |
| League priority | `UPDATE ingestion_state SET priority = 3 WHERE league_slug = 'LEC'` |
| Disable a league | `UPDATE ingestion_state SET priority = 0 WHERE league_slug = 'ALLSTAR'` |
| Skip timelines | Set env var `SKIP_TIMELINE=1` in Lambda config |
| Change year | Set env var `CURRENT_YEAR=2026` in Lambda config |

## Cost Estimate

- Lambda: 96 invocations/day × 15 min × 512 MB ≈ **$3-5/month**
- EventBridge: Free tier covers this
- CloudWatch Logs: ~$0.50/month
- **Total: ~$4-6/month**
