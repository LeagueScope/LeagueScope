# LeagueScope — Guia de despliegue en VPS propio

## Requisitos

- VPS con Ubuntu 22/24 (Hetzner 4-5 EUR/mes, DigitalOcean 6 EUR/mes)
- Dominio (leaguescope.gg u otro)
- Node.js 18+ instalado en el servidor

---

## 1. Preparar el servidor

```bash
# Conectar por SSH
ssh root@TU_IP

# Actualizar paquetes
apt update && apt upgrade -y

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Instalar PM2 (gestor de procesos - mantiene la app viva)
npm install -g pm2

# Instalar Nginx (reverse proxy)
apt install -y nginx

# Instalar Certbot (SSL gratuito con Let's Encrypt)
apt install -y certbot python3-certbot-nginx
```

---

## 2. Apuntar el dominio

En tu registrador de dominios, crea estos registros DNS:

```
A     @              TU_IP_DEL_VPS
A     www            TU_IP_DEL_VPS
```

Espera unos minutos a que propaguen (puedes verificar con `ping leaguescope.gg`).

---

## 3. Subir el codigo

```bash
# En el servidor, clonar el repo (o subir por SCP/rsync)
cd /var/www
git clone https://github.com/TU_USUARIO/LeagueScope.git
cd LeagueScope/web

# Crear archivo de entorno
cp .env.example .env.local
nano .env.local
```

En `.env.local`, ajustar:

```env
API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_SITE_URL=https://leaguescope.gg
```

---

## 4. Compilar

```bash
cd /var/www/LeagueScope/web
npm install
npx next build
```

Con `output: 'standalone'`, el build genera `.next/standalone/` con todo lo necesario.
Copiar los archivos estaticos al standalone:

```bash
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
```

---

## 5. Configurar PM2

```bash
# Arrancar el backend
cd /var/www/LeagueScope
pm2 start server.js --name leaguescope-api

# Arrancar Next.js (standalone)
cd /var/www/LeagueScope/web
pm2 start .next/standalone/server.js --name leaguescope-web -- -p 3000

# Guardar la config para que sobreviva reinicios
pm2 save
pm2 startup
```

Verificar que ambos estan corriendo:

```bash
pm2 status
# Deberia mostrar:
# leaguescope-api    | online | port 3001
# leaguescope-web    | online | port 3000
```

---

## 6. Configurar Nginx

```bash
nano /etc/nginx/sites-available/leaguescope
```

Pegar esta configuracion:

```nginx
server {
    listen 80;
    server_name leaguescope.gg www.leaguescope.gg;

    # Redirigir www a sin www
    if ($host = www.leaguescope.gg) {
        return 301 https://leaguescope.gg$request_uri;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Cache de assets estaticos (1 ano)
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # Cache de imagenes publicas (1 semana)
    location /images/ {
        proxy_pass http://127.0.0.1:3000;
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

Activar el sitio:

```bash
ln -s /etc/nginx/sites-available/leaguescope /etc/nginx/sites-enabled/
nginx -t          # Verificar que no hay errores
systemctl reload nginx
```

---

## 7. SSL con Let's Encrypt (HTTPS gratis)

```bash
certbot --nginx -d leaguescope.gg -d www.leaguescope.gg
```

Certbot configura SSL automaticamente y renueva cada 90 dias.
Verificar renovacion automatica:

```bash
certbot renew --dry-run
```

---

## 8. Desplegar actualizaciones

Cuando hagas cambios, el proceso es:

```bash
cd /var/www/LeagueScope
git pull

# Rebuild Next.js
cd web
npm install
npx next build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

# Reiniciar
pm2 restart leaguescope-web
```

Para automatizar esto, puedes crear un script `deploy.sh`:

```bash
#!/bin/bash
set -e
cd /var/www/LeagueScope
git pull
cd web
npm install
npx next build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
pm2 restart leaguescope-web
echo "Deploy completado"
```

---

## Costes estimados

| Concepto         | Coste             |
|------------------|-------------------|
| VPS (Hetzner)    | 4-5 EUR/mes       |
| Dominio .gg      | 10-15 EUR/ano     |
| SSL              | Gratis (Certbot)  |
| **Total**        | **~5-6 EUR/mes**  |

---

## Comandos utiles

```bash
pm2 status                    # Ver estado de los procesos
pm2 logs leaguescope-web      # Ver logs en tiempo real
pm2 restart all               # Reiniciar todo
nginx -t                      # Verificar config de Nginx
certbot renew                 # Renovar SSL
```
