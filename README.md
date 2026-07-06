# Puls вЂ” РїР»Р°С‚С„РѕСЂРјР° РіРµР№РјРёС„РёРєР°С†РёРё РѕРїРµСЂР°С‚РѕСЂРѕРІ

Р’РЅСѓС‚СЂРµРЅРЅСЏСЏ СЃРёСЃС‚РµРјР° РјРѕС‚РёРІР°С†РёРё Рё РіРµР№РјРёС„РёРєР°С†РёРё РґР»СЏ РѕРїРµСЂР°С‚РѕСЂРѕРІ РєРѕР»Р»-С†РµРЅС‚СЂР°.

**Р РѕР»Рё:** РѕРїРµСЂР°С‚РѕСЂ, СЃСѓРїРµСЂРІР°Р№Р·РµСЂ, СЂСѓРєРѕРІРѕРґРёС‚РµР»СЊ, Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ  
**РњРѕРґСѓР»Рё:** РѕРїРµСЂР°С‚РѕСЂС‹, СЂРµР№С‚РёРЅРі, РєРѕРёРЅС‹, РјР°РіР°Р·РёРЅ Р±РѕРЅСѓСЃРѕРІ, Р·Р°СЏРІРєРё, РёСЃС‚РѕСЂРёСЏ РѕРїРµСЂР°С†РёР№  
**Backend:** FastAPI + PostgreSQL  
**Frontend:** HTML / CSS / Vanilla JS (СЂР°Р·РґР°С‘С‚СЃСЏ FastAPI)

---

## Р‘С‹СЃС‚СЂС‹Р№ СЃС‚Р°СЂС‚ (Р»РѕРєР°Р»СЊРЅРѕ)

```bash
python -m venv .venv
source .venv/bin/activate          # Linux / macOS
# .venv\Scripts\Activate.ps1     # Windows PowerShell

pip install -r requirements.txt
pip install -r requirements-dev.txt   # ruff + pytest (РґР»СЏ СЂР°Р·СЂР°Р±РѕС‚РєРё/CI)
cp .env.example .env               # Р·Р°РїРѕР»РЅРёС‚Рµ РїРµСЂРµРјРµРЅРЅС‹Рµ

alembic upgrade head               # РїСЂРёРјРµРЅРёС‚СЊ РјРёРіСЂР°С†РёРё
uvicorn app.main:app --reload      # Р·Р°РїСѓСЃС‚РёС‚СЊ СЃРµСЂРІРµСЂ
```

РћС‚РєСЂРѕР№С‚Рµ http://localhost:8000

РџСЂРѕРІРµСЂРєРё РїРµСЂРµРґ РєРѕРјРјРёС‚РѕРј:

```bash
ruff check app          # Р»РёРЅС‚ (РєРѕРЅС„РёРі РІ pyproject.toml)
pytest -q               # Р°РІС‚РѕС‚РµСЃС‚С‹ (tests/, sqlite РїРѕРґРЅРёРјР°РµС‚СЃСЏ СЃР°Рј)
npm run build           # frontend bundles are up to date
```

---

## РџРµСЂРµРјРµРЅРЅС‹Рµ РѕРєСЂСѓР¶РµРЅРёСЏ

### РћР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ РґР»СЏ production

| РџРµСЂРµРјРµРЅРЅР°СЏ | РћРїРёСЃР°РЅРёРµ |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET_KEY` | РЎРµРєСЂРµС‚ JWT вЂ” РјРёРЅРёРјСѓРј 32 Р±Р°Р№С‚Р°, СѓРЅРёРєР°Р»СЊРЅС‹Р№ |
| `CORS_ORIGINS` | Р”РѕРјРµРЅ С„СЂРѕРЅС‚РµРЅРґР° (РЅРµ `*` РІ production) |
| `SEED_ADMIN_USERNAME` | Р›РѕРіРёРЅ admin РїСЂРё РїРµСЂРІРѕРј Р·Р°РїСѓСЃРєРµ |
| `SEED_ADMIN_PASSWORD` | РџР°СЂРѕР»СЊ admin (С‚РѕР»СЊРєРѕ РїСЂРё РїРµСЂРІРѕРј Р·Р°РїСѓСЃРєРµ) |

### РћРїС†РёРѕРЅР°Р»СЊРЅС‹Рµ

| РџРµСЂРµРјРµРЅРЅР°СЏ | РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ | РћРїРёСЃР°РЅРёРµ |
|---|---|---|
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 43200 | Срок жизни авторизации (30 дней) |
| `AUTO_SEED` | true | РЎРѕР·РґР°РІР°С‚СЊ admin Рё demo-РґР°РЅРЅС‹Рµ РїСЂРё СЃС‚Р°СЂС‚Рµ |
| `AUTO_CREATE_TABLES` | true | РЎРѕР·РґР°РІР°С‚СЊ С‚Р°Р±Р»РёС†С‹ С‡РµСЂРµР· create_all (dev only) |
| `ENABLE_DEMO_DATA` | true | РЎРѕР·РґР°РІР°С‚СЊ РґРµРјРѕ-РѕРїРµСЂР°С‚РѕСЂРѕРІ |
| `AUTH_COOKIE_SECURE` | false | true РІ production (HTTPS) |
| `AUTH_COOKIE_SAMESITE` | lax | lax РёР»Рё strict |
| `APP_ENV` / `ENVIRONMENT` | development | production РІРєР»СЋС‡Р°РµС‚ safety-check |

Р“РµРЅРµСЂР°С†РёСЏ JWT_SECRET_KEY:
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

---

## РњРёРіСЂР°С†РёРё (Alembic)

```bash
alembic current          # С‚РµРєСѓС‰Р°СЏ РІРµСЂСЃРёСЏ
alembic heads            # РїРѕСЃР»РµРґРЅСЏСЏ РІРµСЂСЃРёСЏ
alembic upgrade head     # РїСЂРёРјРµРЅРёС‚СЊ РІСЃРµ РјРёРіСЂР°С†РёРё
alembic downgrade -1     # РѕС‚РєР°С‚РёС‚СЊ РѕРґРЅСѓ РјРёРіСЂР°С†РёСЋ

# РЎРѕР·РґР°С‚СЊ РЅРѕРІСѓСЋ РјРёРіСЂР°С†РёСЋ РїРѕСЃР»Рµ РёР·РјРµРЅРµРЅРёСЏ РјРѕРґРµР»Рё:
alembic revision --autogenerate -m "РѕРїРёСЃР°РЅРёРµ РёР·РјРµРЅРµРЅРёСЏ"
```

**РџСЂР°РІРёР»Рѕ:** РёР·РјРµРЅРµРЅРёСЏ СЃС…РµРјС‹ С‚РѕР»СЊРєРѕ С‡РµСЂРµР· Alembic. РќРµ РјРµРЅСЏС‚СЊ РїСЂРёРјРµРЅС‘РЅРЅС‹Рµ РјРёРіСЂР°С†РёРё.

---

## Р СѓС‡РЅРѕР№ РёРјРїРѕСЂС‚ РѕРїРµСЂР°С‚РѕСЂРѕРІ РёР· Excel

> **РђРґРјРёРЅРёСЃС‚СЂР°С‚РёРІРЅР°СЏ СѓС‚РёР»РёС‚Р°.** РќРµ РІС‹Р·С‹РІР°РµС‚СЃСЏ РїСЂРёР»РѕР¶РµРЅРёРµРј РІ СЂР°РЅС‚Р°Р№РјРµ, РЅРµ Р·Р°РїСѓСЃРєР°РµС‚СЃСЏ
> РїСЂРё РґРµРїР»РѕРµ (РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РІ `start.sh`, `Procfile`, `railpack.json`). Р—Р°РїСѓСЃРєР°РµС‚СЃСЏ
> РІСЂСѓС‡РЅСѓСЋ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРј РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё РјР°СЃСЃРѕРІРѕ РґРѕР±Р°РІРёС‚СЊ/РѕР±РЅРѕРІРёС‚СЊ РѕРїРµСЂР°С‚РѕСЂРѕРІ
> РїСЂРѕРёР·РІРѕР»СЊРЅРѕР№ РіСЂСѓРїРїС‹.

Р”Р»СЏ РјР°СЃСЃРѕРІРѕРіРѕ СЃРѕР·РґР°РЅРёСЏ РѕРїРµСЂР°С‚РѕСЂРѕРІ РЅСѓР¶РЅРѕР№ РіСЂСѓРїРїС‹ РёСЃРїРѕР»СЊР·СѓР№С‚Рµ СЃРєСЂРёРїС‚ `scripts/import_operators.py`,
СѓРєР°Р·Р°РІ РЅР°Р·РІР°РЅРёРµ РіСЂСѓРїРїС‹ С‡РµСЂРµР· `--group` (РіСЂСѓРїРїР° РјРѕР¶РµС‚ Р±С‹С‚СЊ Р»СЋР±РѕР№, РЅРµ РїСЂРёРІСЏР·Р°РЅР° Рє РєРѕРЅРєСЂРµС‚РЅРѕРјСѓ РЅРѕРјРµСЂСѓ):

```bash
python scripts/import_operators.py --file /path/to/РѕРїРµСЂР°С‚РѕСЂС‹.xlsx --group "Р“СЂСѓРїРїР° 7"
```

РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ СЌС‚Рѕ dry-run: СЃРєСЂРёРїС‚ РїСЂРѕРІРµСЂСЏРµС‚ С„Р°Р№Р», РґСѓР±Р»Рё Рё Р±СѓРґСѓС‰РёРµ РёР·РјРµРЅРµРЅРёСЏ, РЅРѕ РЅРµ РїРёС€РµС‚ РІ Р‘Р”.

Р”Р»СЏ СЂРµР°Р»СЊРЅРѕР№ Р·Р°РїРёСЃРё:

```bash
python scripts/import_operators.py --file /path/to/РѕРїРµСЂР°С‚РѕСЂС‹.xlsx --group "Р“СЂСѓРїРїР° 7" --apply
```

РЎРєСЂРёРїС‚ С‚СЂРµР±СѓРµС‚ `DATABASE_URL`, СЃРѕР·РґР°С‘С‚ РіСЂСѓРїРїСѓ РїСЂРё РѕС‚СЃСѓС‚СЃС‚РІРёРё, СЃРѕР·РґР°С‘С‚/РѕР±РЅРѕРІР»СЏРµС‚ РѕРїРµСЂР°С‚РѕСЂРѕРІ, СЃС‚Р°РІРёС‚ `must_change_password=true` РґР»СЏ РІСЂРµРјРµРЅРЅС‹С… РїР°СЂРѕР»РµР№ Рё СЃРѕС…СЂР°РЅСЏРµС‚ РѕРґРЅРѕСЂР°Р·РѕРІС‹Р№ CSV СЃ РґРѕСЃС‚СѓРїР°РјРё РІ `secure_outputs/`. Р­С‚РѕС‚ РєР°С‚Р°Р»РѕРі РЅРµ РєРѕРјРјРёС‚РёС‚СЃСЏ.

РќРµР»СЊР·СЏ РєРѕРјРјРёС‚РёС‚СЊ РѕРґРЅРѕСЂР°Р·РѕРІС‹Рµ СЃРєСЂРёРїС‚С‹ РёР»Рё С‚Р°Р±Р»РёС†С‹ СЃ СЂРµР°Р»СЊРЅС‹РјРё Р¤РРћ, email, Р»РѕРіРёРЅР°РјРё Рё РІСЂРµРјРµРЅРЅС‹РјРё РїР°СЂРѕР»СЏРјРё. Р•СЃР»Рё С‚Р°РєРёРµ РґР°РЅРЅС‹Рµ РїРѕРїР°Р»Рё РІ Git, РІСЂРµРјРµРЅРЅС‹Рµ РїР°СЂРѕР»Рё РЅСѓР¶РЅРѕ СЃС‡РёС‚Р°С‚СЊ СЃРєРѕРјРїСЂРѕРјРµС‚РёСЂРѕРІР°РЅРЅС‹РјРё Рё СЃСЂР°Р·Сѓ СЃР±СЂРѕСЃРёС‚СЊ.

---

## РЎР±РѕСЂРєР° С„СЂРѕРЅС‚РµРЅРґР°

`index.html` РїРѕРґРєР»СЋС‡Р°РµС‚ РѕР±С‹С‡РЅС‹Рµ source-bundles: `js/app.js`, `js/api.js`, `css/styles.css`, `css/tokens.css`. Minified artifacts are not committed.

```bash
npm install        # one-time setup
npm run build      # rebuild js/app.js, js/api.js, css/styles.css
```

РџРѕСЃР»Рµ РёР·РјРµРЅРµРЅРёСЏ `js/src/**` РёР»Рё `css/src/**` РїРµСЂРµСЃРѕР±РµСЂРёС‚Рµ Р±Р°РЅРґР»С‹ Рё РїРѕРґРЅРёРјРёС‚Рµ РІРµСЂСЃРёСЋ `?v=...` РІ `index.html`, С‡С‚РѕР±С‹ СЃР±СЂРѕСЃРёС‚СЊ immutable-РєРµС€ СЃС‚Р°С‚РёРєРё.

CI runs `npm run build` on every push/PR.

---

## Р›РёРЅС‚ Рё С‚РµСЃС‚С‹

- **ruff** вЂ” РµРґРёРЅСЃС‚РІРµРЅРЅС‹Р№ Р»РёРЅС‚РµСЂ (`pyproject.toml`: E/F/I/UP/B, line-length 100,
  E501 РІ legacy-РєРѕРґРµ РѕСЃРѕР·РЅР°РЅРЅРѕ РёРіРЅРѕСЂРёСЂСѓРµС‚СЃСЏ). Р—Р°РїСѓСЃРє: `ruff check app`.
- **pytest** вЂ” Р°РІС‚РѕС‚РµСЃС‚С‹ РІ `tests/`: РєРµС€ РЅРѕРјРёРЅР°С†РёР№, Р±РµР·РѕРїР°СЃРЅС‹Р№ 500 Р±РµР·
  traceback, SPA-fallback РґР»СЏ `/api/*`, РіСЂР°РЅРёС†С‹ Р»РѕРєР°Р»СЊРЅРѕРіРѕ РґРЅСЏ, `/coins/overview`.
  Р‘Р” РґР»СЏ С‚РµСЃС‚РѕРІ вЂ” РІСЂРµРјРµРЅРЅС‹Р№ sqlite, РїРѕРґРЅРёРјР°РµС‚СЃСЏ conftest'РѕРј Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё.
- **CI** вЂ” `.github/workflows/checks.yml`: ruff, compileall, pytest,
  `alembic upgrade head` РЅР° PostgreSQL 16 (service-container), РїСЂРѕРІРµСЂРєР°
  РјРёРЅРёС„РёРєР°С†РёРё Рё РѕС‚СЃСѓС‚СЃС‚РІРёСЏ СЃРµРєСЂРµС‚РѕРІ РІ СЂРµРїРѕР·РёС‚РѕСЂРёРё.

---

## Р Р°Р±РѕС‚Р° СЃРѕ РІСЂРµРјРµРЅРµРј

Р•РґРёРЅС‹Р№ СЃС‚Р°РЅРґР°СЂС‚ (РјРѕРґСѓР»СЊ `app/core/datetime_utils.py`):

- **Р’ Р‘Р”** РІСЂРµРјСЏ С…СЂР°РЅРёС‚СЃСЏ РєР°Рє **naive UTC** (`now_utc()`); `datetime.utcnow()`
  РІ РєРѕРґРµ Р·Р°РїСЂРµС‰С‘РЅ.
- **Р‘РёР·РЅРµСЃ-РґРµРЅСЊ** (В«РѕРїРµСЂР°С†РёРё Р·Р° СЃРµРіРѕРґРЅСЏВ», РѕС‚С‡С‘С‚С‹) СЃС‡РёС‚Р°РµС‚СЃСЏ РїРѕ С‚Р°Р№РјР·РѕРЅРµ
  РєРѕР»Р»-С†РµРЅС‚СЂР° **Asia/Almaty** вЂ” РёСЃРїРѕР»СЊР·СѓР№С‚Рµ `local_day_bounds_utc()`, Р° РЅРµ
  `date.today()`.
- РќР° frontend РѕС‚РґР°С‘С‚СЃСЏ ISO; РґР»СЏ Р»РѕРєР°Р»СЊРЅРѕРіРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РЅР° Р±СЌРєРµ РµСЃС‚СЊ
  `to_local_iso()`.

---

## Railway deploy

1. РЎРѕР·РґР°Р№С‚Рµ СЃРµСЂРІРёСЃ PostgreSQL РІ Railway
2. Р—Р°РґР°Р№С‚Рµ Variables (СЃРј. РІС‹С€Рµ)
3. Custom Start Command: `bash start.sh`

`start.sh` Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё Р·Р°РїСѓСЃРєР°РµС‚ `alembic upgrade head` РїРµСЂРµРґ СЃС‚Р°СЂС‚РѕРј uvicorn.

РџСЂРѕРІРµСЂРєР° РґРµРїР»РѕСЏ:
```bash
curl https://<railway-domain>/health
curl https://<railway-domain>/ready
```

---

## РЎРѕР·РґР°РЅРёРµ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°

РџСЂРё РїРµСЂРІРѕРј Р·Р°РїСѓСЃРєРµ РµСЃР»Рё Р·Р°РґР°РЅ `SEED_ADMIN_PASSWORD`:
- СЃРѕР·РґР°С‘С‚СЃСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃ СЂРѕР»СЊСЋ `admin`
- Р»РѕРіРёРЅ = `SEED_ADMIN_USERNAME` (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ `admin`)

РџРѕСЃР»Рµ СЃРѕР·РґР°РЅРёСЏ admin вЂ” СѓР±РµСЂРёС‚Рµ `SEED_ADMIN_PASSWORD` РёР· РїРµСЂРµРјРµРЅРЅС‹С… РёР»Рё СЃРјРµРЅРёС‚Рµ РїР°СЂРѕР»СЊ.

---

## Backup Рё restore

```bash
# Backup
pg_dump "$DATABASE_URL" > backup_$(date +%Y-%m-%d).sql

# Restore
psql "$DATABASE_URL" < backup_YYYY-MM-DD.sql
```

Railway С‚Р°РєР¶Рµ РїСЂРµРґРѕСЃС‚Р°РІР»СЏРµС‚ Backups РІ UI СЃРµСЂРІРёСЃР° PostgreSQL.

**Р”РµР»Р°Р№С‚Рµ backup РїРµСЂРµРґ РєР°Р¶РґРѕР№ РґРµСЃС‚СЂСѓРєС‚РёРІРЅРѕР№ РјРёРіСЂР°С†РёРµР№.**

---

## Rollback

```bash
# РћС‚РєР°С‚ РєРѕРґР°:
git revert HEAD
git push

# РћС‚РєР°С‚ РјРёРіСЂР°С†РёРё:
alembic downgrade -1

# Р•СЃР»Рё РєРѕРґ СѓР¶Рµ РѕС‚РєР°С‚РёР»Рё, Р° РјРёРіСЂР°С†РёСЏ РїСЂРёРјРµРЅРµРЅР° вЂ”
# РЅСѓР¶РµРЅ РѕС‚РґРµР»СЊРЅС‹Р№ РїР»Р°РЅ. Р”РµСЃС‚СЂСѓРєС‚РёРІРЅС‹Рµ РјРёРіСЂР°С†РёРё (DROP COLUMN)
# С‚СЂРµР±СѓСЋС‚ РїСЂРµРґРІР°СЂРёС‚РµР»СЊРЅРѕРіРѕ backup.
```

Р’ Railway: Deployments в†’ РїСЂРµРґС‹РґСѓС‰РёР№ РґРµРїР»РѕР№ в†’ Redeploy.

---

## Troubleshooting

### `/api/auth/me` РѕС‚РґР°С‘С‚ 500
- РџСЂРѕРІРµСЂСЊС‚Рµ Railway Deploy Logs РЅР° РѕС€РёР±РєСѓ AttributeError
- РЈР±РµРґРёС‚РµСЃСЊ С‡С‚Рѕ `alembic upgrade head` РїСЂРѕС€С‘Р» СѓСЃРїРµС€РЅРѕ
- РџСЂРѕРІРµСЂСЊС‚Рµ `DATABASE_URL` РІ Variables

### `/health` РѕС‚РґР°С‘С‚ 502
- РџСЂРёР»РѕР¶РµРЅРёРµ РЅРµ СЃС‚Р°СЂС‚РѕРІР°Р»Рѕ вЂ” СЃРјРѕС‚СЂРёС‚Рµ Deploy Logs
- Р’РѕР·РјРѕР¶РЅРѕ РЅРµ РїСЂРѕС€Р»Р° Alembic РјРёРіСЂР°С†РёСЏ
- РџСЂРѕРІРµСЂСЊС‚Рµ РїРѕСЂС‚: `PORT` РІ Variables РґРѕР»Р¶РµРЅ СЃРѕРІРїР°РґР°С‚СЊ СЃ РєРѕРјР°РЅРґРѕР№ Р·Р°РїСѓСЃРєР°

### `alembic upgrade head` РїР°РґР°РµС‚
- РџСЂРѕРІРµСЂСЊС‚Рµ `DATABASE_URL`
- Р—Р°РїСѓСЃС‚РёС‚Рµ `alembic current` вЂ” РїРѕСЃРјРѕС‚СЂРёС‚Рµ С‚РµРєСѓС‰СѓСЋ РІРµСЂСЃРёСЋ
- РЎРјРѕС‚СЂРёС‚Рµ С‚РµРєСЃС‚ РѕС€РёР±РєРё вЂ” С‡Р°С‰Рµ РІСЃРµРіРѕ РєРѕРЅС„Р»РёРєС‚ С‚РёРїРѕРІ РёР»Рё РґСѓР±Р»РёСЂРѕРІР°РЅРёРµ РєРѕР»РѕРЅРєРё

### РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РјРѕР¶РµС‚ РІРѕР№С‚Рё РїРѕСЃР»Рµ СЃРјРµРЅС‹ JWT secret
- Р’СЃРµ С‚РµРєСѓС‰РёРµ СЃРµСЃСЃРёРё РёРЅРІР°Р»РёРґРёСЂСѓСЋС‚СЃСЏ вЂ” РїРѕР»СЊР·РѕРІР°С‚РµР»Рё РґРѕР»Р¶РЅС‹ РїРµСЂРµР»РѕРіРёРЅРёС‚СЊСЃСЏ
- Р­С‚Рѕ РЅРѕСЂРјР°Р»СЊРЅРѕРµ РїРѕРІРµРґРµРЅРёРµ

### CORS РѕС€РёР±РєР°
- РЈСЃС‚Р°РЅРѕРІРёС‚Рµ `CORS_ORIGINS=https://РІР°С€-РґРѕРјРµРЅ.railway.app`
- РќРµ РёСЃРїРѕР»СЊР·СѓР№С‚Рµ `*` РІ production РїСЂРё cookie-auth

### Р‘Р°Р·Р° РЅРµ РїРѕРґРєР»СЋС‡Р°РµС‚СЃСЏ
- РџСЂРѕРІРµСЂСЊС‚Рµ `DATABASE_URL` РІ Variables
- РЈР±РµРґРёС‚РµСЃСЊ С‡С‚Рѕ PostgreSQL СЃРµСЂРІРёСЃ РІ Railway Р·Р°РїСѓС‰РµРЅ
- РџСЂРѕРІРµСЂСЊС‚Рµ `pg_isready -d "$DATABASE_URL"`

### РќРµ СЃРѕР·РґР°С‘С‚СЃСЏ admin
- РЈР±РµРґРёС‚РµСЃСЊ С‡С‚Рѕ Р·Р°РґР°РЅ `SEED_ADMIN_PASSWORD`
- РџСЂРѕРІРµСЂСЊС‚Рµ `AUTO_SEED=true`
- РЎРјРѕС‚СЂРёС‚Рµ Р»РѕРіРё `[startup] Seed`

---

## Security checklist

- [ ] `.env` РЅРµ РєРѕРјРјРёС‚РёС‚СЃСЏ (РµСЃС‚СЊ РІ `.gitignore`)
- [ ] `JWT_SECRET_KEY` СѓРЅРёРєР°Р»СЊРЅС‹Р№, РЅРµ РґРµС„РѕР»С‚РЅС‹Р№
- [ ] `CORS_ORIGINS` РЅРµ `*` РІ production
- [ ] `AUTH_COOKIE_SECURE=true` РІ production
- [ ] РўРѕРєРµРЅС‹ РЅРµ РѕС‚РїСЂР°РІР»СЏСЋС‚СЃСЏ РІ С‡Р°С‚ РёР»Рё issue
- [ ] Backup РїРµСЂРµРґ РґРµСЃС‚СЂСѓРєС‚РёРІРЅС‹РјРё РјРёРіСЂР°С†РёСЏРјРё
- [ ] `gitleaks detect` РїРµСЂРµРґ СЂРµР»РёР·РѕРј
- [ ] `SEED_ADMIN_PASSWORD` СѓР±СЂР°РЅ РїРѕСЃР»Рµ СЃРѕР·РґР°РЅРёСЏ admin
- [ ] Р’ СЂРµРїРѕР·РёС‚РѕСЂРёРё РЅРµС‚ РѕРґРЅРѕСЂР°Р·РѕРІС‹С… С„Р°Р№Р»РѕРІ РёРјРїРѕСЂС‚Р° СЃ СЂРµР°Р»СЊРЅС‹РјРё Р¤РРћ/email/РїР°СЂРѕР»СЏРјРё
- [ ] `npm run build` Р·РµР»РµРЅС‹Р№ (frontend bundles СЃРѕР±СЂР°РЅС‹ РёР· Р°РєС‚СѓР°Р»СЊРЅС‹С… РёСЃС…РѕРґРЅРёРєРѕРІ)

---

## РђРєС‚СѓР°Р»СЊРЅР°СЏ Р°СЂС…РёС‚РµРєС‚СѓСЂР°

- **Backend:** FastAPI (Python 3.13)
- **Р‘Р°Р·Р° РґР°РЅРЅС‹С…:** PostgreSQL (Railway)
- **Frontend:** Vanilla JS / HTML / CSS (СЂР°Р·РґР°С‘С‚СЃСЏ FastAPI)
- **Auth:** HttpOnly cookie (`pulse_access_token`)
- **РњРёРіСЂР°С†РёРё:** Alembic
- **Р РµР№С‚РёРЅРі:** СЃС‚СЂРѕРёС‚СЃСЏ РїРѕ СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рј `PeriodReport`
- Р¤Р°Р№Р» `server.js` СѓРґР°Р»С‘РЅ
- Node.js backend РЅРµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ
- JSON-С„Р°Р№Р»С‹ РЅРµ РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ РєР°Рє РёСЃС‚РѕС‡РЅРёРє РґР°РЅРЅС‹С…

---

## API СЌРЅРґРїРѕРёРЅС‚С‹

```
POST /api/auth/login                     Р’С…РѕРґ
POST /api/auth/logout                    Р’С‹С…РѕРґ (РѕС‡РёС‰Р°РµС‚ cookie)
GET  /api/auth/me                        РўРµРєСѓС‰РёР№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ

GET  /api/operators                      РЎРїРёСЃРѕРє РѕРїРµСЂР°С‚РѕСЂРѕРІ
POST /api/operators                      РЎРѕР·РґР°С‚СЊ (+ Р°РІС‚Рѕ-Р°РєРєР°СѓРЅС‚)
GET  /api/operators/{id}                 РљР°СЂС‚РѕС‡РєР°
PATCH /api/operators/{id}                Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ
POST /api/operators/{id}/reset-password  РЎР±СЂРѕСЃРёС‚СЊ РїР°СЂРѕР»СЊ
POST /api/operators/account/change-password  РЎРјРµРЅРёС‚СЊ РїР°СЂРѕР»СЊ
POST /api/operators/account/change-username  РЎРјРµРЅРёС‚СЊ Р»РѕРіРёРЅ

GET  /api/rating                         Р РµР№С‚РёРЅРі
POST /api/weekly-results                 Legacy: СЂСѓС‡РЅР°СЏ Р·Р°РіСЂСѓР·РєР° СЂРµР·СѓР»СЊС‚Р°С‚РѕРІ РЅРµРґРµР»Рё

POST /api/reports/period-report/upload   Р—Р°РіСЂСѓР·РёС‚СЊ Monthly Report Рё Report
GET  /api/reports/period-report/status   РЎС‚Р°С‚СѓСЃ Р·Р°РіСЂСѓР¶РµРЅРЅС‹С… С„Р°Р№Р»РѕРІ
GET  /api/reports/operators-period-summary РџСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ СЂР°СЃС‡С‘С‚Р° РїРµСЂРёРѕРґР°
POST /api/reports/period-report/save     РЎРѕС…СЂР°РЅРёС‚СЊ СЂР°СЃС‡С‘С‚ РїРµСЂРёРѕРґР°

GET  /api/analytics/summary              KPI Р°РЅР°Р»РёС‚РёРєРё
GET  /api/analytics/operators            РўР°Р±Р»РёС†Р° РѕРїРµСЂР°С‚РѕСЂРѕРІ Р°РЅР°Р»РёС‚РёРєРё
GET  /api/analytics/groups-comparison    РЎСЂР°РІРЅРµРЅРёРµ РіСЂСѓРїРї
GET  /api/analytics/points               РђРЅР°Р»РёР· РёС‚РѕРіРѕРІС‹С… Р±Р°Р»Р»РѕРІ

GET  /api/wallet/me                      РњРѕР№ РєРѕС€РµР»С‘Рє
POST /api/wallet/transactions            Р СѓС‡РЅРѕРµ РЅР°С‡РёСЃР»РµРЅРёРµ

GET  /api/shop/items                     РњР°РіР°Р·РёРЅ
POST /api/shop/purchases                 РљСѓРїРёС‚СЊ
POST /api/shop/purchases/{id}/approve    РћРґРѕР±СЂРёС‚СЊ
POST /api/shop/purchases/{id}/reject     РћС‚РєР»РѕРЅРёС‚СЊ

GET  /api/dashboard                      РЎРІРѕРґРєР° (admin)
GET  /api/dashboard/operators            РўР°Р±Р»РёС†Р° РѕРїРµСЂР°С‚РѕСЂРѕРІ (admin)
GET  /api/dashboard/history              РСЃС‚РѕСЂРёСЏ С‚СЂР°РЅР·Р°РєС†РёР№ (admin)

GET  /health                             Liveness check
GET  /ready                              Readiness check (DB + migrations)
```

---

## Project structure after refactor

### Backend

`app/main.py` is now only the FastAPI entry point: it creates the app, attaches middleware, includes the API router, registers `/health` and `/ready`, and mounts static files.

Main backend layout:

```text
app/
  api/router.py          # one API router, mounted once with settings.api_prefix
  core/lifespan.py       # startup checks, schema maintenance, seed
  core/middleware.py     # CORS, gzip, CSRF origin guard
  core/static.py         # static files and SPA fallback
  modules/
    analytics/
    auth/
    dashboard/
    groups/
    operator_levels/
    operators/
    rating/
    reports/
    shop/
    tests/
    users/
    wallet/
    weekly_results/
    wheel/
    work_norms/
  routers/               # compatibility shims for old imports
  services/              # compatibility shims for old imports
  schemas/               # compatibility shims for old schema imports
```

New code should be added under `app/modules/<domain>/`. The old `app/routers/*` and selected `app/services/*` files are kept as thin compatibility layers so existing imports do not break.

Domain schemas live next to the owning module in `app/modules/<domain>/schemas.py`. The legacy `app/schemas/*` files are intentionally kept as `from app.modules.<domain>.schemas import *` shims for backwards compatibility.

`coins` is intentionally grouped under the wallet domain: `app/modules/wallet/coins_router.py` serves `/api/coins/*`, `app/modules/wallet/wallet_router.py` serves `/api/wallet/*`, and `app/modules/wallet/router.py` includes both routers. This keeps coin balance operations and wallet views in one domain module without changing public URLs.

### Frontend

Frontend sources are split into editable modules:

```text
js/src/api/client/       # base API request/auth client
js/src/api/domains/      # domain API sections
js/src/app/              # app shell, state, router, navigation
js/src/auth/             # auth-specific frontend code
js/src/components/       # reusable UI components
js/src/utils/            # shared frontend helpers
js/src/views/            # section views
css/src/base/            # base styles and tokens usage
css/src/layout/          # shell/layout styles
css/src/components/      # reusable component styles
css/src/views/           # section-specific styles
```

The current frontend build intentionally stays on ordered concatenation instead of ES modules/Vite. Numeric filename prefixes (`00-`, `10-`, `20-`, ...) define execution order across nested folders; the bundlers sort by filename first so moving a file between folders does not change behavior.

Generated entry files are still committed because Railway serves static files directly:

```text
js/api.js
js/app.js
css/styles.css
css/tokens.css
```

After editing frontend source files, rebuild bundles:

```bash
npm run build
```

If Node/npm is not installed, the safe fallback bundle command is:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-frontend.ps1
```

The fallback rebuilds the same source bundles as `npm run build`. The project no longer commits compressed frontend artifacts.

### Required checks before publish

```bash
ruff check app
pytest -q
npm install
npm run build
```

Manual browser smoke-test before release:

- login/logout
- period report upload/save
- coins and wallet
- operator levels
- Wheel of WOW: rules, tickets, spin, history, stats
- shop purchases
- tests
- dashboard and analytics

