# Divergent Operator Contest

## Persistent data on Railway

The app stores live contest data in JSON through `/api/state`.

Do not store production data in the release file `./data.json`: Railway redeploys can replace files from the GitHub repository and reset operators.

Use a Railway Volume instead:

1. Create or attach a Volume to this service.
2. Mount it at `/data`.
3. Set the service variable:

```env
DATA_FILE=/data/data.json
```

Alternative:

```env
PERSISTENT_DATA_DIR=/data
```

After deploy, open:

```text
/api/health
```

The response must show:

```json
{
  "storage": {
    "persistent": true
  }
}
```

The server writes automatic backups into `/data/backups`.

If `storage.persistent` is `false`, operator data can still disappear after deploy or restart.
