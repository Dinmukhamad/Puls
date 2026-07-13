# Деплой Puls на Oracle Cloud (Always Free)

Полный запуск в Docker: база PostgreSQL + приложение + nginx одной командой.
Данные базы хранятся в docker-томе `pgdata` и переживают перезапуски.

---

## 1. Создать сервер (Compute Instance)

1. Зарегистрируйтесь на https://cloud.oracle.com (нужна карта для верификации,
   списаний за Always Free не будет).
2. Menu → **Compute → Instances → Create Instance**.
3. **Image and shape:**
   - Image: **Ubuntu 22.04** (или 24.04).
   - Shape: **Ampere (VM.Standard.A1.Flex)** — Always Free, возьмите
     2 OCPU / 12 GB (в пределах бесплатного лимита 4 OCPU / 24 GB).
     Если пишет «out of capacity» — попробуйте позже или другой регион,
     либо возьмите **VM.Standard.E2.1.Micro** (x86, тоже Always Free, слабее).
4. **Add SSH keys:** сохраните приватный ключ (понадобится для входа).
5. Create. Запишите **публичный IP** инстанса.

## 2. Открыть порты (firewall)

Oracle закрывает всё по умолчанию — нужно открыть HTTP (80) и HTTPS (443).

**A. В облаке (Security List / NSG):**
- VCN → Security Lists → Default → Add Ingress Rules:
  - Source `0.0.0.0/0`, TCP, порт **80**
  - Source `0.0.0.0/0`, TCP, порт **443**

**B. На самом сервере (iptables у Ubuntu на Oracle включён):**
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Подключиться и установить Docker

```bash
ssh -i /путь/к/ключу ubuntu@ВАШ_IP

# Docker + compose plugin
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# перезайти по ssh, чтобы группа применилась:
exit
ssh -i /путь/к/ключу ubuntu@ВАШ_IP
docker --version && docker compose version
```

## 4. Забрать код и настроить секреты

```bash
git clone https://github.com/Dinmukhamad/Puls.git
cd Puls/deploy

cp .env.example .env
nano .env        # заполнить пароли и секреты
```

В `.env` обязательно поменяйте:
- `POSTGRES_PASSWORD` — длинный пароль базы,
- `JWT_SECRET_KEY` — сгенерируйте: `openssl rand -hex 32`,
- `SEED_ADMIN_PASSWORD` — пароль первого администратора.

## 5. Запустить

```bash
docker compose up -d --build
```

Первый старт: соберётся образ, поднимется Postgres, приложение применит
миграции (`alembic upgrade head`) и создаст админа. Проверить:

```bash
docker compose ps          # все сервисы healthy/running
docker compose logs -f app # смотреть логи запуска
```

Откройте в браузере: `http://ВАШ_IP` — должно открыться приложение.
Вход под `admin` и паролем из `SEED_ADMIN_PASSWORD`.

## 6. Обновление после новых коммитов

```bash
cd ~/Puls
git pull
cd deploy
docker compose up -d --build
```

## 7. HTTPS (рекомендуется, но не обязательно для старта)

Проще всего — привязать домен к IP и получить сертификат Let's Encrypt.
Без домена, по «голому» IP, HTTPS полноценно не выдаётся.

Кратко (когда будет домен, указывающий на IP сервера):
```bash
# остановить nginx-контейнер, чтобы освободить :80 для certbot
docker compose stop nginx
sudo apt-get install -y certbot
sudo certbot certonly --standalone -d ваш-домен.ru
# сертификаты появятся в /etc/letsencrypt/live/ваш-домен.ru/
```
Затем в `deploy/nginx/puls.conf` добавить server-блок на 443 с путями к
сертификатам, смонтировать их в nginx (том `./nginx/certs`), в `.env`
поставить `AUTH_COOKIE_SECURE=true`, раскомментировать `443` в
`docker-compose.yml` и `docker compose up -d`.

---

## Полезное

- Логи:              `docker compose logs -f app`
- Перезапуск:        `docker compose restart app`
- Остановить всё:    `docker compose down`  (данные в томе pgdata сохраняются)
- Бэкап базы:        `docker compose exec db pg_dump -U puls puls > backup.sql`
- Восстановить:      `cat backup.sql | docker compose exec -T db psql -U puls puls`

## Важно про --workers 1
Приложение запускается с одним воркером намеренно (кеши рейтинга/аналитики
живут в памяти процесса). Не увеличивайте число воркеров без вынесения кеша
в Redis — иначе после загрузки Excel/расчёта периода часть ответов будет
устаревшей. Подробности — в комментарии `start.sh`.
