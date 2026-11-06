# Floci-AZ on Render — feasibility and prepared configuration

**Status: prepared, not deployed, not verified at runtime.** No Render account or
resource was touched, and no container was run: this machine has no container
runtime (`docker version` → exit 127, no `podman`), so every statement below
comes from the official Floci-AZ documentation and the official Render
documentation, with the source named. Items that the documentation does not
answer are listed as unverified and are **not** worked around with assumptions.

| Path | What it is |
| --- | --- |
| `render.yaml` | Blueprint-style definition of the emulator as a Render **private service**. Inert file; applying it creates a paid service. |
| `README.md` | The feasibility record: requirements, matrix, risks, blockers, verification checklist. |

Nothing in this directory is referenced by the application, the backend, the
frontend, CI, or `infra/docker-compose.dev.yml`. DataDiet does not currently
consume any Azure storage API, so this is preparation for a capability that does
not exist yet (see [Integration](#integration-with-datadiet)).

## What Floci-AZ actually is

The brief for this task described Floci-AZ as a Rust service. The official
repository says otherwise, and the correction matters for memory sizing and for
the image you pin: Floci-AZ is a **Quarkus (Java) application compiled to a
GraalVM/Mandrel native binary**, packaged on `ubi9-micro`
([`docker/Dockerfile.native`](https://github.com/floci-io/floci-az/blob/main/docker/Dockerfile.native),
[installation](https://floci.io/floci-az/getting-started/installation/)). The
standard image has "no package manager, curl, grep or sed"; a `-compat` variant
adds Python 3, the Azure CLI and `azfloci`.

### Image and tags

`floci/floci-az` on Docker Hub
([tags](https://hub.docker.com/r/floci/floci-az/tags)). Verified directly on
2026-11-04: `0.16.0` and `0.16.0-compat` are the newest releases (published
2026-10-31, and `latest`/`latest-compat` point at the same build); `0.11.0` …
`0.15.0` exist, plus `nightly` and dated `nightly-MMDDYYYY` tags. Every tag
listed carries **`linux/amd64` and `linux/arm64`**, so Render's x86 instance
types are covered. Releases publish twice a month (the 15th and the last day),
`latest` moves, and "a same-day rerun of the nightly workflow republishes that
day's tag, so for a build you can rely on not changing, pin a release version"
([docker-images](https://floci.io/floci-az/configuration/docker-images/)).
`render.yaml` pins `0.16.0`.

### Listening address, port, health

- Bind: the image's `CMD` is `["/app/application", "-Dquarkus.http.host=0.0.0.0"]` with `EXPOSE 4577`, so it already satisfies Render's "must bind to a port on host `0.0.0.0`".
- Port: `FLOCI_AZ_PORT`, default `4577`; the docs require changing `FLOCI_AZ_BASE_URL` together with it ([ports](https://floci.io/floci-az/configuration/ports/)). Other ports exist only for opt-in features: `4578` (Cosmos Java SDK), `4500` (web console), `443` (host-style Key Vault over TLS), and sidecar host ports.
- Health: `GET /_floci/health` → `200 {"status":"UP",…}`, or `503` with a `problems` map when any service reports a problem; `/health` is an alias and does not wait for startup. `GET /ready` stays `503` until every service finishes starting. The image declares `HEALTHCHECK --interval=5s --timeout=3s --retries=10` probing `/_floci/health` ([endpoints](https://floci.io/floci-az/configuration/endpoints/)).

### Environment variables

All optional; unset means the documented default. The ones that matter here
([docker-compose](https://floci.io/floci-az/configuration/docker-compose/),
[application.yml](https://floci.io/floci-az/configuration/advanced/application-yml/)):

| Variable | Default | Why it matters on Render |
| --- | --- | --- |
| `FLOCI_AZ_PORT` | `4577` | must agree with Render's `PORT` so health checks reach it |
| `FLOCI_AZ_BASE_URL` | `http://localhost:4577` | hostnames embedded in SAS URLs and operation locations; must be the internal host |
| `FLOCI_AZ_STORAGE_MODE` | `memory` | `memory` loses everything on stop — must be changed for a disk-backed service |
| `FLOCI_AZ_STORAGE_PERSISTENT_PATH` | `/app/data` | the only path Render preserves; also the image's `VOLUME` |
| `FLOCI_AZ_STORAGE_WAL_COMPACTION_INTERVAL_MS` | `30000` | WAL snapshot cadence |
| `FLOCI_AZ_STORAGE_HYBRID_FLUSH_INTERVAL_MS` | `5000` | hybrid flush cadence |
| `FLOCI_AZ_SERVICES_{BLOB,QUEUE,TABLE,FUNCTIONS,COSMOS,SQL,KEY_VAULT,APP_CONFIG}_ENABLED`, `FLOCI_AZ_SERVICES_EVENT_HUB_ENABLED` | `true` | the disabled set is the Render compatibility decision |
| `FLOCI_AZ_UI_ENABLED` | `true` | the console is a second container image — off |
| `FLOCI_AZ_TLS_ENABLED` | `false` | private network only; enabling pulls in a runtime self-signed CA |
| `FLOCI_AZ_AUTH_STORAGE_ACCOUNT_KEYS_DEVSTOREACCOUNT1` | the Azurite well-known key | override if the emulator is ever reachable beyond one workspace |

A log-level variable is **not documented**; Quarkus native-image logging knobs
were not verified.

### Persistence and storage modes

Data lives under `/app/data` (the image `chown`s it to `floci:root` at
entrypoint). There is **no SQLite**: each logical store is one file, and
metadata and payload bytes are stored together — `persistent`/`hybrid` write
`<service>.json`, `wal` writes `<service>-snapshot.json` plus an append-only
`<service>.wal` in Jackson CBOR. Blob content bytes live inside the same store
(`StoredObject(String key, byte[] data, …)`), and function code under
`FLOCI_AZ_SERVICES_FUNCTIONS_CODE_PATH`. Writes are temp-file + `ATOMIC_MOVE`;
a corrupt file is quarantined to `<file>.corrupt` rather than silently reused
([storage](https://floci.io/floci-az/configuration/storage/),
[`StorageFactory.java`](https://github.com/floci-io/floci-az/blob/main/src/main/java/io/floci/az/core/storage/StorageFactory.java)).

Four modes: `memory` (lost on stop), `persistent` (load at start, flush on
**graceful** shutdown), `hybrid` (async flush every 5 s, docs-recommended for
restart-surviving local use), `wal` ("every mutation is written to disk before
responding", compacted every 30 s). The WAL holds a `ReentrantReadWriteLock` —
an in-process lock, not a file lock.

**Unverified, and it is the main persistence risk:** neither project documents
the behaviour of `wal` or `hybrid` on a network- or volume-backed mount, and
Render documents its disks only as "high-performance SSDs" without stating the
filesystem type, IOPS or whether the mount is `noexec`/`nosuid` or remote from
the container's point of view. Render's own docs warn against restoring a
database from a disk snapshot and recommend a logical dump instead, which is a
hint that the snapshot is a block-level copy taken while the service may be
writing.

## Render constraints that decide this

Citations are Render's current documentation.

| Requirement | Documented behaviour | Source |
| --- | --- | --- |
| Docker image service | `image.url` + optional registry creds; image's `CMD` runs unless overridden | [deploying-an-image](https://render.com/docs/deploying-an-image) |
| Tag updates | "Image-backed services do not automatically redeploy whenever a new image is associated with their assigned tag" | same |
| Port | "Every Render web service must bind to a port on host `0.0.0.0`"; default expected port `10000`; `PORT` is the port your HTTP server binds to | [web-services](https://render.com/docs/web-services), [environment-variables](https://render.com/docs/environment-variables) |
| Private services | `type: pserv`; "aren't reachable via the public internet. They do not receive an `onrender.com` subdomain"; internal host `name-suffix:PORT`; "Private services can listen on almost any port" (max 75; `18012`, `18013`, `19099` blocked; traffic to `10000` always routes to the primary HTTP server); requires **same region and same workspace** | [private-services](https://render.com/docs/private-services), [private-network](https://render.com/docs/private-network) |
| Persistent disk | `disk: {name, mountPath, sizeGB}` for `pserv`/worker; mount path must be absolute, `/`, `/opt`, `/home`, `/etc` prohibited, existing directories allowed; paid instance types only ($0.25/GB); preserves changes across deploys and restarts, rest of the filesystem ephemeral; daily snapshots retained 7 days, full-restore only; single instance, no scaling, not visible during build/pre-deploy; **"Adding a disk to a service prevents zero-downtime deploys"** | [disks](https://render.com/docs/disks), [blueprint-spec](https://render.com/docs/blueprint-spec) |
| Health checks | `healthCheckPath`, 2xx/3xx within 5 s (TCP fallback: connect within 5 s), run against `$PORT`; 15 s of failures stops routing, then the instance is restarted; optional — unset disables it | [health-checks](https://render.com/docs/health-checks) |
| Deploys | adding a disk means the old instance is stopped while the new one starts; SIGTERM after traffic swap, SIGKILL after the shutdown delay (default 30 s) | [deploys](https://render.com/docs/deploys) |
| Docker socket | **No documentation of any kind** for `/var/run/docker.sock`, privileged containers, Docker-in-Docker, or sidecar/multi-container services; the docs describe one image per service | absence across [docker](https://render.com/docs/docker) and [services](https://render.com/docs/services-and-resources) |
| Cost floor | smallest paid instance $7/mo (0.5 vCPU/512 MB); free instances sleep after 15 min idle and cannot attach disks | [pricing](https://render.com/pricing) |
| Auth on the private endpoint | not documented (no mTLS, no service key, no allow-list for private traffic; `ipAllowList` is a public-ingress feature) | [private-network](https://render.com/docs/private-network) |

**Explicit determination:** anything in Floci-AZ that spawns containers cannot
run on Render, because Render gives a service no Docker daemon. That is a
documented platform limit on the Floci-AZ side ("These services **must** have
access to the Docker daemon") met by an undocumented-by-design absence on the
Render side. It is not worked around here.

## Compatibility matrix

"Verified" means verified against official documentation in this pass — **not**
proven by running the image, which was impossible in this environment.

| Feature | Floci support | Render compatibility | Verified |
| --- | --- | --- | --- |
| **Blob** | In-process, "HTTP-only: no Docker"; path-style `http://host:4577/{account}` | **Feasible** as `pserv` + disk; `hybrid` or `wal` mode needed (`memory` is the default and loses data) | Yes — docs both sides ([blob](https://floci.io/floci-az/services/blob/), [disks](https://render.com/docs/disks)). No runtime test. |
| **Queue** | In-process, "HTTP-only: no Docker" | **Feasible**, same as Blob. Caveat: Queue SAS parameters are parsed but **not validated** | Yes — docs both sides ([queue](https://floci.io/floci-az/services/queue/)). No runtime test. |
| **Table** | In-process, "HTTP-only: no Docker" | **Feasible**, same as Blob | Yes — docs. No runtime test. |
| **Key Vault** | In-process, listed under stateless services; absent from the Docker-backed table; `FLOCI_AZ_STORAGE_SERVICES_KEY_VAULT_MODE` exists | **Feasible** without a socket. Caveats: key material is stored **in the clear** in the storage backend; host-style `*.vault.azure.net` needs TLS and port 443 | Yes — docs ([key-vault](https://floci.io/floci-az/services/key-vault/)). No runtime test. |
| **Functions** | **Requires the Docker daemon** (real function runtime containers) **and internet access on first use** to pull runtime images | **Not feasible** — no Docker socket on Render | Yes — [functions](https://floci.io/floci-az/services/functions/) vs Render's documented single-image model |
| **Cosmos engines** (MongoDB, PostgreSQL, Cassandra, Gremlin) | **Requires the Docker daemon**; each names a sidecar image (`mongo:7`, `citusdata/citus`, `scylladb/scylla`, `tinkerpop/gremlin-server`) | **Not feasible** | Yes — [services index](https://floci.io/floci-az/services/) |
| **Cosmos NoSQL / Table API** | Embedded, "always-on, no Docker" | **Feasible in principle** (single port, HTTP) — but `render.yaml` disables Cosmos because the sibling engines are unusable and the SQL/Cosmos startup is what reports health problems | Partial — the "no Docker" claim is documented; feasibility on Render is inference, not a documented pairing |
| **MySQL emulator** | **Requires the Docker daemon** (`mysql:8.0`); databases are "metadata-only" and returned connection strings disable TLS | **Not feasible** — and unnecessary: Render already provides a managed MySQL | Yes — [mysql](https://floci.io/floci-az/services/mysql/) |
| Event Hubs | AMQP (`activemq-artemis`, 5672) and Kafka (`redpanda`, 9093) sidecars → Docker daemon | **Not feasible** | Yes — docs |
| Service Bus | Data plane mocked by default (`mocked: true`); real AMQP needs a sidecar | Management plane only, at best | Partial |
| Web console / UI | Separate image `floci/floci-ui:0.7.0` on port 4500 | **Not feasible** (no sidecar; no second container) | Yes — docs |
| Data Lake Gen2 | Not a separate service: `.dfs.core.windows.net` is an alias onto the Blob backend | Inherits Blob's feasibility | Yes — docs |

Net: **Blob + Queue (+ Table, + Key Vault) are the only things worth deploying,
and they are exactly the priority set in this brief.** Functions, Cosmos
engines, MySQL, Event Hubs and the console are blocked by the same platform
limit and no configuration removes it.

## Persistence, restart and networking risks

1. **Mode choice is a real trade-off, not a checkbox.** `persistent` flushes only on graceful shutdown, and Render's deploys send SIGTERM with a 30 s default — a SIGKILL or a crash loses everything. `hybrid` risks up to 5 s of writes. `wal` claims no loss but writes twice (log + compaction) and its lock is in-process only. `render.yaml` pins `wal` and the checklist below tests it; switch to `hybrid` if compaction or latency proves uncomfortable.
2. **A disk makes every deploy briefly unavailable.** "Adding a disk to a service prevents zero-downtime deploys." Combined with "single instance only, no scaling", the emulator has a restart window on every config change — acceptable for a dev/test dependency, disqualifying for anything an operator depends on continuously.
3. **Snapshot restore is the only backup, and it is whole-disk, 7 days deep.** Render explicitly discourages snapshot-restoring a database; Floci-AZ's state is a set of files, so a restore rolls the whole emulator back to some instant, including blobs a client may have already been given SAS URLs for.
4. **`FLOCI_AZ_BASE_URL` must match the internal host or URLs break.** Render's internal hostname is assigned when the service is created (`<name>-<suffix>`), so the placeholder in `render.yaml` must be replaced — or derived with the blueprint's `fromService` env-var reference. Unverified whether `pserv` accepts a `privatePort`-style key in `render.yaml`; the current spec page does not list one.
5. **Port agreement is unproven.** Render health checks hit `$PORT`; Floci-AZ binds `FLOCI_AZ_PORT`. `render.yaml` sets both to 4577, but Floci-AZ does not document reading `PORT`, and Render does not document a private service binding anything other than what the process chooses. This needs one real deploy to confirm; if it fails, the fix is whichever side Render actually reads.
6. **A `503` from any sub-service restarts the container.** `/_floci/health` reports `problems` per service and Render restarts an instance after 15 s of failing checks. With Functions/Cosmos/SQL/UI disabled this should stay green, but if a disabled service still reports a problem, the practical answer is to drop `healthCheckPath` (Render treats an unset health check as disabled) rather than to re-enable a Docker-dependent service.
7. **No authentication exists between the backend and the emulator.** Render documents nothing for private traffic, and Floci-AZ documents that `auth.mode` "is not read by any service today" and "In `dev` mode (default), all keys are accepted without validation". Anything else in the same Render workspace can therefore read and write every blob, and call `POST /_admin/reset`, which wipes all state with a 204 and no credentials.
8. **Cost floor is paid-only.** No free instance type can attach a disk, so the cheapest honest configuration is a $7/mo instance plus 1 GB of disk at $0.25/GB, and it must not be a free instance that sleeps after 15 idle minutes.

## Security posture

`render.yaml` deliberately uses `type: pserv`, not `web`, because a public
`web` service would put an emulator whose keys are not validated on the
internet, next to an unauthenticated `POST /_admin/reset` and a Key Vault that
stores key material in the clear. **Do not deploy this as a public web service,
and do not put it behind `onrender.com` with a guessed path.** If a task ever
requires public reachability (it does not today: DataDiet's backend would be the
only client), then at minimum: set a non-default account key via
`FLOCI_AZ_AUTH_STORAGE_ACCOUNT_KEYS_DEVSTOREACCOUNT1`, enable
`FLOCI_AZ_TLS_ENABLED=true` and pin the CA served from `/_floci/tls-cert` on the
client, restrict with `ipAllowList`, and record in `docs/decisions.md` why an
emulator is public at all. Even then, Blob service-SAS is enforced while Queue
SAS is not, so a public Queue endpoint accepts any SAS token — that is a Floci
behaviour, not a configuration mistake, and no Render setting fixes it.

This directory contains **no credentials, no connection strings, and no
account keys**. The `devstoreaccount1` name is fine to write down; its key is
Microsoft's published Azurite well-known development key, is the image default,
and is intentionally not repeated here.

## Integration with DataDiet

Inspected as of this pass, unchanged by it:

- **No feature needs Blob today, and none needs Queue Storage.** `backend/requirements.txt` is FastAPI/uvicorn/pydantic/SQLAlchemy/Alembic/PyMySQL only — there is no `azure-*` package anywhere in the backend, and `grep -rniI "azure-"` over `backend/` returns nothing. Every "queue" hit in the code is the retention **review queue** (`/retention/recommendations`), an unrelated SQL concept with the same word.
- **The existing file abstraction is metadata-only and deliberately incapable of I/O.** `backend/app/services/connectors/base.py`: connectors "deliberately have no capability to read file contents, move, archive, or delete anything, or send data anywhere", and `ConnectorType = Literal["synthetic", "local_folder"]` with local paths confined to the `LOCAL_SOURCE_ROOTS` allow-list.
- **Archive and retrieval are placeholders with no writer.** `ArchiveItem.archive_location` (`String(500)`) and `RetrievalRequest` exist in `backend/app/db/models.py`, but no service or route references `ArchiveItem`/`RetrievalRequest`, and the governance view answers `file_operations: "Not implemented. This view never archives, restores, moves, or deletes a file; approving a recommendation is not an execution command."` (`backend/app/services/governance.py`).
- **The database is MySQL, and its planned home is already covered.** `DATABASE_URL` is a SQLAlchemy MySQL URL (`DEV_DATABASE_URL`, `PyMySQL` driver), `infra/docker-compose.dev.yml` runs `mysql:8.4` locally, and `infra/azure/modules/mysql.bicep` provisions Azure Database for MySQL. A Floci-AZ MySQL emulator is both impossible on Render and unnecessary next to Render's own MySQL.
- **The planned Azure topology has no storage account at all** (`infra/azure/main.bicep`: user-assigned identity, network, Key Vault, MySQL, App Service backend, frontend, monitoring) and `docs/azure-architecture.md` never mentions Blob, a storage account or Queue Storage.

So the honest integration reading is: the first real consumer would be the
archive/retrieval executor (a future phase that the repository's own rules
currently forbid — "Phase 1 has no destructive actions at all"), where
`archive_location` would hold a blob URI. **That phase has not been approved and
no application integration was implemented in this pass.** A second, more
immediate use is local development: an emulator in `infra/docker-compose.dev.yml`
would let a `local_folder`-style Azure Blob connector be built and tested without
a real storage account — that is a proposed change, not one made here.

## Recommendation

**Do not create this Render service yet.** There is no consumer, so it would be
a paid, restart-prone, unauthenticated service that nothing calls. Instead:

1. Keep `infra/floci/render.yaml` as the reviewed draft for when a consumer
   exists; if the emulator is ever needed locally, run the `docker run` command
   in the checklist below (or a compose service), which is free and needs no
   Render.
2. When archive execution is approved, add the Blob dependency to the backend
   first against the emulator locally, then decide whether a deployed preview
   environment genuinely needs a hosted emulator.
3. If a deployed environment needs Azure-compatible storage, prefer the real
   thing: an Azure Storage account (already the deployment target in
   `infra/azure/`), or Render's own data products. Floci-AZ on Render is
   feasible only for Blob/Queue/Table/Key Vault and buys nothing over a real
   storage account except cost isolation.

## Verification checklist (what must be proven before deploying)

Run in order. Step 1 fails fast on this machine because Docker is absent.

1. `docker version` — needs a runtime. On this workstation: **exit 127, not
   available**, which is why nothing below has been executed.
2. Local single-port proof, no socket mount, pinned tag, disk-backed path:
   ```text
   docker run --rm -p 4577:4577 \
     -e FLOCI_AZ_PORT=4577 -e FLOCI_AZ_BASE_URL=http://localhost:4577 \
     -e FLOCI_AZ_STORAGE_MODE=wal -e FLOCI_AZ_STORAGE_PERSISTENT_PATH=/app/data \
     -e FLOCI_AZ_SERVICES_FUNCTIONS_ENABLED=false -e FLOCI_AZ_SERVICES_COSMOS_ENABLED=false \
     -e FLOCI_AZ_SERVICES_SQL_ENABLED=false -e FLOCI_AZ_SERVICES_EVENT_HUB_ENABLED=false \
     -e FLOCI_AZ_UI_ENABLED=false \
     docker.io/floci/floci-az:0.16.0
   ```
   Then confirm: `/_floci/health` returns `UP`; a blob uploaded via the Azure
   SDK survives `docker stop` + `docker start` with the same named volume (a
   `--rm` run discards it); leases and user-delegation SAS issued by the previous
   process are documented as invalid after restart — do not build on them;
   `/_admin/reset` is unreachable from outside the intended network.
3. Confirm the storage files appear at `/app/data/*.json|*.wal` and nowhere else,
   so the Render mount path is provably the right one.
4. Create the Render service in the **same region and workspace** as the
   backend, with `FLOCI_AZ_BASE_URL` set to the assigned internal host, and
   verify: the health check goes green (if not, resolve risk 5 and 6 above), a
   private-network request from the backend reaches `http://<internal-host>:4577`,
   the service has **no** `onrender.com` URL, and data written before a manual
   restart is still present afterwards.
5. Only then open a DataDiet issue for the connector/executor work — as an
   application change with its own tests, in its own approved phase.

## Not verified

- Floci-AZ's behaviour on Render specifically: no documented pairing, and this
  environment cannot run containers.
- Render's disk filesystem type, IOPS/throughput, and whether WAL/CBOR append
  patterns are safe on it.
- Whether `PORT` or `FLOCI_AZ_PORT` is authoritative for Render's health check on
  a `pserv`, and whether `render.yaml` has a private-port key.
- Whether a disabled Docker-dependent service still affects `/_floci/health`.
- Any authentication mechanism for Render private traffic.
- Floci-AZ's memory/CPU footprint at realistic blob sizes (hence the `1c-2g`
  choice is a judgement).
- Whether `0.16.0` remains the newest release when this is read; tags and dates
  above were verified on 2026-11-04.
