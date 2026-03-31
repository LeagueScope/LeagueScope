# LeagueScope — Guía de Deploy (AWS)

## Arquitectura

```
[AWS Amplify] ── Frontend (Next.js SSR) ── rewrites /api/* ──→ [Lightsail Container] ── Backend (Express) ──→ [AWS RDS PostgreSQL]
```

- **AWS Amplify**: Frontend Next.js con SSR nativo, deploy automático con git push, SSL incluido
- **AWS Lightsail Container**: Backend Express, precio fijo, simple
- **AWS RDS PostgreSQL**: DB managed con backups automáticos

---

## Requisitos previos

- Cuenta de AWS (https://aws.amazon.com — necesitas tarjeta, pero hay free tier 12 meses)
- AWS CLI instalado: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html
- Proyecto en GitHub (público o privado)

---

## Paso 1: Subir el proyecto a GitHub

Si aún no lo tienes en GitHub:

```bash
cd C:\Users\Usuario\Desktop\LeagueScope
git init
git add .
git commit -m "Initial commit"
```

Crea un repo en https://github.com/new (puede ser privado) y sube:

```bash
git remote add origin https://github.com/TU_USUARIO/LeagueScope.git
git branch -M main
git push -u origin main
```

---

## Paso 2: AWS RDS — Base de datos PostgreSQL

### 2.1 Crear la instancia RDS

1. Ve a **AWS Console** → **RDS** → **Create database**
2. Configuración:
   - **Engine**: PostgreSQL 16
   - **Template**: Free tier (o Production si quieres Multi-AZ)
   - **DB Instance identifier**: `leaguescope-db`
   - **Master username**: `leaguescope`
   - **Master password**: genera una contraseña segura y guárdala
   - **Instance class**: `db.t3.micro` (free tier) o `db.t3.small` ($25/mes, recomendado)
   - **Storage**: 20 GB SSD GP3
   - **Connectivity**:
     - VPC: default
     - **Public access**: Yes (necesario para importar datos desde tu PC)
     - **Security group**: crea uno nuevo `leaguescope-db-sg`
3. **Additional configuration**:
   - **Initial database name**: `leaguescope`
   - **Backup retention**: 7 days
   - **Enable encryption**: Yes
4. Click **Create database** (tarda ~5-10 min)

### 2.2 Configurar Security Group

1. Ve a **EC2** → **Security Groups** → encuentra `leaguescope-db-sg`
2. **Inbound rules** → **Edit** → añade:
   - Type: PostgreSQL, Port: 5432, Source: `0.0.0.0/0` (temporal para importar datos)

> **Importante**: Después de importar los datos, cambia la source a solo la IP del backend Lightsail.

### 2.3 Importar tu base de datos

Cuando RDS esté en estado "Available", copia el **Endpoint** (algo como `leaguescope-db.xxxx.eu-west-1.rds.amazonaws.com`).

```bash
# Exportar tu DB local
pg_dump -U leaguescope_user -d leaguescope --no-owner --no-acl > dump.sql

# Importar a RDS
psql "postgresql://leaguescope:TU_PASSWORD@leaguescope-db.xxxx.eu-west-1.rds.amazonaws.com:5432/leaguescope" < dump.sql
```

### 2.4 Verificar conexión

```bash
psql "postgresql://leaguescope:TU_PASSWORD@leaguescope-db.xxxx.eu-west-1.rds.amazonaws.com:5432/leaguescope" -c "SELECT count(*) FROM teams;"
```

---

## Paso 3: Lightsail Container — Backend Express

### 3.1 Crear Dockerfile para el backend

Crea `backend/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/

EXPOSE 3001
CMD ["npm", "run", "start:prod"]
```

Crea `backend/.dockerignore`:

```
node_modules
.env
.env.local
data/
scripts/
```

Haz commit y push de estos archivos.

### 3.2 Crear el servicio en Lightsail

1. Ve a **AWS Console** → **Lightsail** → **Containers**
2. Click **Create container service**
3. Configuración:
   - **Region**: la misma que tu RDS (ej: eu-west-1)
   - **Capacity**: Nano ($7/mes, 0.25 vCPU, 512 MB) — suficiente para empezar
   - **Service name**: `leaguescope-backend`

### 3.3 Build y push de la imagen Docker

```bash
# Instalar el plugin de Lightsail para Docker
aws lightsail push-container-image \
  --service-name leaguescope-backend \
  --label backend \
  --image leaguescope-backend

# Primero haz build local
cd backend
docker build -t leaguescope-backend .

# Push a Lightsail
aws lightsail push-container-image \
  --service-name leaguescope-backend \
  --label backend \
  --image leaguescope-backend
```

### 3.4 Configurar el deployment

1. En Lightsail → tu container service → **Deployments** → **Create deployment**
2. **Container**:
   - Image: la que acabas de pushear (`:leaguescope-backend.backend.X`)
   - **Open HTTP port**: 3001
   - **Environment variables**:

```
NODE_ENV=production
PORT=3001
PG_DSN=postgresql://leaguescope:TU_PASSWORD@leaguescope-db.xxxx.rds.amazonaws.com:5432/leaguescope?sslmode=require
PANDASCORE_TOKEN=tu_token
PANDASCORE_PLAN=esports
FRONTEND_URL=https://main.xxxx.amplifyapp.com
PROD_URL=https://main.xxxx.amplifyapp.com
DEFAULT_LEAGUE=LEC
DEFAULT_YEAR=2026
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

3. **Public endpoint**: container `leaguescope-backend`, port 3001
4. Click **Save and deploy**

### 3.5 Obtener URL del backend

Una vez activo, tendrás una URL como:
`https://leaguescope-backend.xxxx.eu-west-1.cs.amazonlightsail.com`

Verifica:
```bash
curl https://leaguescope-backend.xxxx.eu-west-1.cs.amazonlightsail.com/api/v1/health
```

### 3.6 Restringir acceso a la DB

Ahora ve a **EC2** → **Security Groups** → `leaguescope-db-sg`:
- Elimina la regla `0.0.0.0/0`
- Añade: Type: PostgreSQL, Source: IP del Lightsail container (o el security group del VPC)

---

## Paso 4: AWS Amplify — Frontend Next.js

### 4.1 Crear la app

1. Ve a **AWS Console** → **AWS Amplify**
2. Click **New app** → **Host web app**
3. **Source**: GitHub → autoriza y selecciona tu repo `LeagueScope`
4. **Branch**: `main`
5. **App settings**:
   - **App name**: `leaguescope`
   - **Monorepo root**: `web` (importante — le dice que el frontend está en /web)
   - **Build settings** — Amplify lo detecta automáticamente, pero verifica:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
```

### 4.2 Variables de entorno

Antes de hacer deploy, en **App settings** → **Environment variables**, añade:

```
API_URL=https://leaguescope-backend.xxxx.eu-west-1.cs.amazonlightsail.com/api/v1
API_ORIGIN=https://leaguescope-backend.xxxx.eu-west-1.cs.amazonlightsail.com
NEXT_PUBLIC_SITE_URL=https://main.xxxx.amplifyapp.com
```

### 4.3 Configurar rewrites

En **App settings** → **Rewrites and redirects**, añade:

| Source | Target | Type |
|--------|--------|------|
| `/api/<*>` | `https://leaguescope-backend.xxxx.cs.amazonlightsail.com/api/<*>` | Rewrite |

Esto hace que las llamadas `/api/*` del frontend vayan al backend sin CORS issues.

### 4.4 Deploy

Click **Save and deploy**. Amplify hará build automáticamente (~3-5 min).

Tu URL será algo como: `https://main.d1234567890.amplifyapp.com`

### 4.5 Actualizar CORS del backend

Una vez tengas la URL de Amplify, actualiza en Lightsail las variables:
- `FRONTEND_URL=https://main.d1234567890.amplifyapp.com`
- `PROD_URL=https://main.d1234567890.amplifyapp.com`

---

## Paso 5: Dominio personalizado (opcional)

### Comprar dominio

Puedes comprarlo directamente en **AWS Route 53** (~$12/año para .com) o en Cloudflare/Namecheap.

### Configurar en Amplify

1. Ve a Amplify → tu app → **Domain management** → **Add domain**
2. Si usas Route 53: selecciona tu dominio, Amplify configura todo automáticamente
3. Si usas otro registrador: Amplify te dará registros CNAME para configurar
4. SSL se genera automáticamente (tarda ~15 min)

### Actualizar variables

Tras configurar el dominio, actualiza en todas partes:
- **Lightsail**: `FRONTEND_URL=https://leaguescope.gg` y `PROD_URL=https://leaguescope.gg`
- **Amplify**: `NEXT_PUBLIC_SITE_URL=https://leaguescope.gg`

---

## Actualizar tras cambios locales

### Frontend (automático)

```bash
git add .
git commit -m "cambio en frontend"
git push
```

Amplify detecta el push y redespliega automáticamente (~3-5 min).

### Backend (manual — build + push Docker)

```bash
cd backend
docker build -t leaguescope-backend .
aws lightsail push-container-image \
  --service-name leaguescope-backend \
  --label backend \
  --image leaguescope-backend
```

Luego en Lightsail → Deployments → crea un nuevo deployment con la imagen actualizada.

> **Tip**: Para automatizar esto, puedes configurar un GitHub Action que haga build + push en cada commit a `/backend`. Te lo puedo montar si quieres.

---

## Costes estimados

| Servicio | Spec | Coste |
|----------|------|-------|
| AWS Amplify | SSR hosting, build minutes incluidos | $0-5/mes (free tier generoso) |
| Lightsail Container | Nano (0.25 vCPU, 512 MB) | $7/mes |
| RDS PostgreSQL | db.t3.micro (free tier 1er año) | $0 → $15/mes después |
| Route 53 | Dominio .com (opcional) | ~$12/año |
| **Total año 1** | | **~$7-12/mes** |
| **Total después** | | **~$22-27/mes** |

---

## Troubleshooting

**El frontend carga pero no hay datos:**
- Verifica el rewrite en Amplify: Source `/api/<*>` → Target URL del backend
- Comprueba que `FRONTEND_URL` y `PROD_URL` en Lightsail coinciden con tu URL de Amplify

**Error CORS:**
- Asegúrate de que `PROD_URL` incluye `https://` y coincide exactamente con el dominio
- El backend solo permite requests desde `FRONTEND_URL` y `PROD_URL`

**La DB no conecta desde Lightsail:**
- Verifica que el security group de RDS permite el tráfico desde Lightsail
- Asegúrate de que `PG_DSN` incluye `?sslmode=require`

**Amplify build falla:**
- Verifica que el monorepo root es `web`
- Check que las variables de entorno están configuradas antes del build

**Las imágenes no cargan:**
- Verifica que `next.config.ts` tiene los dominios de CDN en `remotePatterns`
- En Amplify, asegúrate de que el CSP permite `img-src` con los CDNs

**Backend lento (Nano):**
- Si notas latencia, sube a Micro ($25/mes, 1 vCPU, 2 GB) en Lightsail → Container settings
