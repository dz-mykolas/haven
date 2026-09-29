# Development environment

## Recommended: VS Code devcontainer

1. Have Docker with Compose and the VS Code **Dev Containers** extension running on your host.
2. Open this repository and choose **Dev Containers: Rebuild and Reopen in Container**.
3. Wait for setup, then run `make dev`.
4. Open **http://127.0.0.1:4321** (use this hostname for the Enable Banking callback).

The workspace has Node 24, Go 1.27, Make, PostgreSQL client tools and Chromium for browser tests. Setup installs project dependencies and creates `haven_test` and `haven_e2e` if absent. The Go API initializes the main database on first start. Setup may take a few minutes the first time.

PostgreSQL 17 runs in its own Compose service, starts before the workspace, and stores data in a named volume that survives container rebuilds. Its port is not published to the host. The workspace connects to `db:5432`; browser traffic still uses localhost through VS Code port forwarding. Closing the devcontainer stops the Compose services; reopening starts them again. No manual PostgreSQL service command is needed.

Run `make check`, `make test`, `make test-integration` or `make test-e2e` inside the workspace. The integration and browser tests use their separate disposable databases, not `haven`.

## Environment files

- `.env`: existing host/native PostgreSQL setup; unchanged by devcontainer setup.
- `.devcontainer/.env`: ignored local settings for the container environment, created from `.devcontainer/.env.example` on first setup.

The container sets `HAVEN_ENV_FILE=.devcontainer/.env`. Haven's Make commands load that file. Existing sandbox application ID, key path and redirect settings are copied from `.env` when the new file is first created; they are never printed. Keep the private key under the ignored `.secrets/` directory so the workspace mount preserves it across rebuilds. Existing `.devcontainer/.env` edits are preserved. Setup migrates the former root `.env.devcontainer` if the new file does not exist; the loader also accepts the old container environment setting until rebuild.

The Compose database uses a fixed local development password on its private network. These files are development configuration, not a production deployment. The separate root `compose.yaml` remains available for running only PostgreSQL alongside a host installation.

## Existing data and a fresh environment

The devcontainer uses a **new database volume**. It does not automatically migrate the PostgreSQL installation inside the previous development container. Before rebuilding that old container, run `make backup`; keep the resulting dump in the repository's ignored `.local/backups/` folder. Rebuilding can discard the old container's filesystem, including its native PostgreSQL data directory.

A fresh environment starts empty. To keep previous accounts, transactions and tasks, restore a backup **before the first `make dev`** in the new container:

```bash
source scripts/load-env.sh
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname="$DATABASE_URL" .local/backups/your-backup.dump
make dev
```

This command assumes the new `haven` database is empty. If you already started Haven, restore into a new database instead, following the [backup instructions](../README.md#back-up-and-restore). Do not use `docker compose down -v` when you want to keep the volume.

The configuration follows the [Dev Containers Compose guide](https://containers.dev/guide/dockerfile) and uses Docker's [health-based startup ordering](https://docs.docker.com/compose/how-tos/startup-order/).
