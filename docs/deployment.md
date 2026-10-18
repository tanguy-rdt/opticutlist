# Deployment and operations

[Documentation home](README.md) / [Developer Guide](developer-guide.md)

Operator reference for the existing Node service, standalone archive and Docker image. For beginner installation steps, use [Install OptiCutList](user-guide/installation.md). Storage contracts, SQL migrations, API operations and transaction guarantees remain in [Storage internals](storage.md#self-hosted-storage).

**On this page:** [Run from source](#run-the-service) · [Standalone archive](#standalone-archive) · [Docker and Portainer](#standalone-docker-deployment) · [Backups](#consistent-backups-and-restoration)

## Distribution reference

### Run the service

Use Node.js 24 or newer and the existing npm dependencies. The server uses `node:http` and `node:sqlite`; no framework, ORM or additional runtime dependency is required. Node 24.8, used for the initial verification, labels SQLite experimental. Prefer an up-to-date maintained Node 24 runtime; review Node's SQLite compatibility before upgrading production.

```sh
npm ci
npm run build:self-hosted
npm run start:self-hosted
```

Open `http://127.0.0.1:3000/opticutlist/`. The frontend retains the existing Vite base and hash routing. `dist-self-hosted/` contains the server-mode frontend; `server-dist/main.js` is the Node entry point. Install dependencies on the host and deploy these two build directories together. Run as an unprivileged OS user with access to the database directory. The service does not require a second web server.

For local development, rebuild with `npm run build:self-hosted` after changes and restart the service. The ordinary `npm run dev` remains browser-local; there is no implicit API proxy or hostname-based mode selection.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `OCL_HOST` | `127.0.0.1` | Listening interface; binding beyond loopback requires `OCL_ORIGIN` |
| `OCL_PORT` | `3000` | Listening TCP port, 1–65535 |
| `OCL_ORIGIN` | Loopback HTTP origin for the selected port | Exact external `http(s)://host[:port]`, without a path or trailing slash; must match incoming Host and browser Origin |
| `OCL_DATABASE_PATH` | `data/opticutlist.sqlite` | Durable SQLite file, resolved from the process working directory |
| `OCL_FRONTEND_PATH` | `dist-self-hosted` | Matching built frontend directory |

Example behind an HTTPS reverse proxy on a private network:

```sh
OCL_HOST=127.0.0.1 OCL_ORIGIN=https://opticutlist.internal \
OCL_DATABASE_PATH=/srv/opticutlist/data/opticutlist.sqlite npm run start:self-hosted
```

Prefer an absolute database path in a service configuration; otherwise changing the working directory changes the selected dataset. Do not store the database in a frontend/build directory. Startup rejects that configuration, unrelated databases and unsupported newer database versions. It never resets an existing database. A generated storage-mode marker also prevents accidentally serving a browser-mode build as the self-hosted frontend.

Outside loopback, use HTTPS with a browser-trusted certificate even on a LAN/VPN: the existing frontend uses secure-context APIs such as `crypto.randomUUID`. Plain HTTP to a remote LAN IP does not provide those APIs. Loopback HTTP works for local use.

A reverse proxy must preserve the configured Host and forward the actual browser Origin. Set `OCL_ORIGIN` to the exact external origin. The server does not trust forwarded headers or infer an origin from a request. HTTPS, VPN restrictions, process supervision and firewall/access controls are the operator's responsibility.

### Standalone archive

Run OptiCutList without Docker or a source checkout. You need **Node.js 24 or newer** installed on the server. The archive contains the built application and its JavaScript dependencies; no npm install, Git, TypeScript or compilation is needed. SQLite is provided by Node itself, not a separately compiled npm addon.

#### Install and start

1. Open [GitHub Releases](https://github.com/tanguy-rdt/opticutlist/releases) and download `opticutlist-VERSION-self-hosted.tar.gz` from the desired stable or prerelease release. `VERSION` is the full tag, including `v` and any prerelease suffix. Assets appear only after a successful archive job; no particular published version is assumed here.
2. Extract it using your archive manager. Open a terminal in the extracted `opticutlist` folder.
3. Start the server:

```sh
node start.mjs
```

4. Open **http://127.0.0.1:3000/opticutlist/** on that machine. Leave the terminal running; **Ctrl+C** stops the server cleanly.

The default database is **`.opticutlist/opticutlist.sqlite` in the home directory of the account running Node**, outside the installation folder. Keep using that same account when updating. The SQLite database and WAL/journal files belong together; never delete this data directory during an upgrade. The application opens existing databases and applies its existing migrations without resetting them.

To choose another persistent location, use an absolute path outside the installation. On macOS/Linux:

```sh
OCL_DATABASE_PATH="$HOME/opticutlist-data/opticutlist.sqlite" node start.mjs
```

Parent directories are created automatically. Keep this same setting on every start. The launcher rejects database paths inside the extracted installation, including symlink aliases. It locates the bundled frontend independently of the terminal's working directory. Existing `OCL_PORT`, `OCL_HOST` and `OCL_ORIGIN` settings remain available; the defaults are loopback and port 3000.

For a remote server with SSH access, run `ssh -N -L 3000:127.0.0.1:3000 USER@SERVER` on your computer, replacing the login/address, then open the same local URL while the tunnel stays open. Direct access beyond loopback requires an explicit exact `OCL_ORIGIN` and trusted HTTPS browser access. Do not simply expose the port publicly.

**No authentication is built in. Everyone reaching this instance shares its database. Use trusted networks, a private VPN or externally access-controlled deployments only.** Optimization remains in the browser; online browser-local data is not automatically copied to this server.

#### Update safely

1. Stop the server with Ctrl+C and ensure no other process is writing to the same database.
2. Back up the **complete stopped data directory**, including any WAL/journal files. For the default location on macOS/Linux, use:

```sh
tar -czf "$HOME/opticutlist-backup-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$HOME" .opticutlist
```

Check that the backup command succeeded. Use your configured data directory instead if you changed it. Never copy only a live main SQLite file.

3. Extract the newer application into a new folder; keep the old installation and backup until verification succeeds.
4. Run `node start.mjs` in the new application folder, under the same account and with the same database setting. Open the application and check projects and stock.

To restore, stop all writers and extract a known-good backup into a **fresh data directory**, then start the matching application version with `OCL_DATABASE_PATH` pointing to the restored database. Do not mix unrelated database/WAL files or overwrite a live database. Database migrations can make downgrading unsafe without a matching backup.

#### Platform verification

The archive contains JavaScript and static assets, not Node itself or native npm binaries. Use an official compatible Node.js runtime. Local extraction/startup/persistence tests verify macOS ARM64; the release job must run the same tests on its Linux x64 runner before attaching an asset. Until that job has succeeded, Linux release execution is configured but not verified by this local task. Windows and other CPU/OS combinations have not been verified; do not infer support from the archive format alone.

### Standalone Docker deployment

The [Dockerfile](../docker/Dockerfile) packages the existing self-hosted application as one image, one Node process, port **3000/TCP**, and one persistent **`/data`** volume. No Compose, Stack or additional HTTP server is required. Optimization remains in the browser. The ordinary GitHub Pages build is unchanged.

**Requirements:** Docker Engine/Desktop with Linux containers, or Portainer connected to such a Docker host. Published images require no Git, Node.js installation or local compilation.

Stable and SemVer prerelease tags publish **`ghcr.io/tanguy-rdt/opticutlist:VERSION`**, without the leading `v` (for example, `v1.1.0-beta.2` becomes `1.1.0-beta.2`). The examples below use `1.2.3` as an example version, not a claim that this version has already been published. Choose a version from a successful [release publication](ci-cd.md#docker-image-publication). There are no `latest`, `stable`, major-only or minor-only aliases. The workflow targets `linux/amd64` and `linux/arm64`; it publishes the versioned multi-platform image only after both platform builds succeed. Local Docker/multi-platform verification depends on an available daemon; configuration alone is not proof of a successful image build.

A maintainer must set the GHCR package visibility to **Public** before anonymous Docker or Portainer pulls work. GitHub initially creates container packages as private; no GitHub login or personal access token is required to pull a public package. See [registry visibility](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

#### Pull and start

Choose an available explicit version:

```sh
docker pull ghcr.io/tanguy-rdt/opticutlist:1.2.3
docker volume create opticutlist-data
docker run -d \
  --name opticutlist \
  --restart unless-stopped \
  --stop-timeout 30 \
  -p 127.0.0.1:8080:3000 \
  -e OCL_ORIGIN=http://127.0.0.1:8080 \
  -v opticutlist-data:/data \
  ghcr.io/tanguy-rdt/opticutlist:1.2.3
```

Open **`http://127.0.0.1:8080/opticutlist/`**. Use that exact hostname: `localhost` is a different origin. Publishing to host loopback restricts access to the Docker host; the backend still listens on `0.0.0.0` inside its bridge-network container. No host networking, privileged mode or Docker socket mount is used.

| Setting | Image default / required value |
| --- | --- |
| `OCL_ORIGIN` | **Required:** exact browser-facing HTTP(S) origin, with port when nonstandard, without path/trailing slash |
| `OCL_HOST` | `0.0.0.0`; leave unchanged in the container |
| `OCL_PORT` | `3000`; normally change the published host port instead |
| `OCL_DATABASE_PATH` | `/data/opticutlist.sqlite`; keep databases under the mounted `/data` directory |
| `OCL_FRONTEND_PATH` | `/app/dist-self-hosted`; leave unchanged |
| Runtime user | `node`, UID/GID `1000:1000` |
| Persistent mount | Named volume `opticutlist-data` → `/data`, read/write |

The builder uses `npm ci` with the lockfile and `npm run build:self-hosted`, which explicitly selects server storage. The runtime contains only compiled frontend/backend files, package/license metadata and the SSR backend's external Zod package. SQLite is built into Node; no compiler or SQLite addon is installed. If the backend gains another external package, update the runtime dependency copies in the Dockerfile. The build context allowlist excludes unrelated repository files, databases, secrets, caches and tests.

An empty named volume receives the image's writable `/data` directory. SQLite and its WAL/journal sidecars stay together there; the image contains no database. Existing databases are opened and checked with the current transactional migrations, never reset. Migration/permission failures stop startup. For a bind mount or an imported volume, the directory and database must be writable by UID/GID `1000:1000`; configure ownership deliberately while stopped rather than running the application as root. See [Docker volumes](https://docs.docker.com/engine/storage/volumes/).

#### Optional local build

Contributors can still build from the repository root, using the same Dockerfile and root build context:

```sh
docker build -f docker/Dockerfile -t opticutlist:local .
```

Use `opticutlist:local` instead of the GHCR image in the start command. This path needs the repository source and network access to the official Node base image and locked npm packages; it does not publish anything.

#### Status, logs and lifecycle

```sh
docker ps --filter name=opticutlist
docker inspect --format '{{.State.Health.Status}}' opticutlist
docker logs --tail 100 opticutlist
docker stop --time 30 opticutlist
docker start opticutlist
docker restart --time 30 opticutlist
```

[Readiness regression tests](../server/__tests__/health.spec.ts) exercise the actual Dockerfile probe against a local Node service, including database failure, recovery and external-Host handling. These are not a substitute for running the image on a Docker daemon. `GET /api/v1/health` performs a serialized SQLite transaction that reads migration metadata. Database failure returns a sanitized **503**; healthy responses retain the existing public service/schema identity. The image probe calls the internal loopback listener with the configured external Host header, so custom host ports and HTTPS origins do not bypass or break origin checks. It uses Node, not curl/wget, with a four-second socket timeout. Docker runs it every 30 seconds with a five-second limit, a 15-second startup grace period and three failure retries.

An unhealthy result does not itself trigger Docker's restart policy. Inspect logs and health details; fix the cause, then restart. Missing/incorrect `OCL_ORIGIN` prevents startup or causes 403 responses. `EACCES` indicates volume ownership or permissions. Do not delete a database to fix an upgrade failure; retain the file and restore a compatible backup or use the matching application version.

#### Portainer: create a container

Use the target Docker environment's **Containers → Add container** interface, not a Stack. Enter the explicit GHCR version below and enable **Always pull the image** for this public image. No registry credentials, Git checkout, Node.js or local build is needed. For a locally built `opticutlist:local` image instead, it must already exist on that Docker host and **Always pull** must be disabled.

| Portainer field | Value |
| --- | --- |
| Name | `opticutlist` |
| Image | `ghcr.io/tanguy-rdt/opticutlist:1.2.3` (choose an available release version) |
| Manual port publishing | Host `8080` → container `3000`, TCP; disable automatic publication of all exposed ports |
| Environment | `OCL_ORIGIN=http://127.0.0.1:8080` for Docker-host loopback access; otherwise the exact approved HTTPS origin |
| Volumes | Create/select named volume `opticutlist-data`, mount at `/data`, writable |
| Restart policy | Unless stopped |
| Command / entrypoint / user | Keep image defaults |
| Network / privileged | Default bridge; privileged disabled |

Restrict the published Host IP to `127.0.0.1` when the interface supports it. If your Portainer version cannot express that binding, use the loopback Docker CLI command above or arrange Docker-aware network access restrictions **before** deployment; a plain `8080:3000` mapping publishes on all host interfaces. Portainer on another computer does not make `127.0.0.1` refer to the Docker host. Portainer's own login protects its management interface, not OptiCutList. See Portainer's [container creation](https://docs.portainer.io/user/docker/containers/add) and [advanced settings](https://docs.portainer.io/user/docker/containers/advanced).

#### Changing ports and enabling remote access

To use host port `9090`, recreate the container with `-p 127.0.0.1:9090:3000` and `-e OCL_ORIGIN=http://127.0.0.1:9090`. Retain the same named volume. Restarting alone cannot change an existing container's ports, environment or image.

For explicit LAN access, bind only the chosen private host address, for example `-p 192.168.1.20:8080:3000`, instead of loopback, and set `OCL_ORIGIN` to the **actual HTTPS browser origin**, such as `https://cutting.lan`. Use existing access-controlled TLS infrastructure and restrict access to the trusted LAN/VPN. The proxy must preserve Host and Origin. The image does not provide TLS or a proxy. Plain HTTP to a remote LAN IP is insufficient for existing secure-context browser APIs; loopback HTTP remains supported.

**No authentication is provided. Everyone who can reach the application shares the entire database. Do not expose this image directly to the public Internet.** There is no wildcard CORS or automatic browser-data migration.

#### Consistent backups and restoration

Stop **every writer** to the volume before taking this offline backup. Copy the complete quiescent directory, including any WAL/SHM/journal files, rather than copying a live main database. Keep backups outside the repository and protect them as application data.

```sh
mkdir -p ../opticutlist-backups
backup_file="../opticutlist-backups/opticutlist-data-$(date -u +%Y%m%dT%H%M%SZ).tar"
docker stop --time 30 opticutlist
docker cp -a opticutlist:/data/. - > "$backup_file"
docker start opticutlist
```

Use a fresh backup filename. Check that the copy command succeeded before relying on the archive; an interrupted copy is not a valid backup. Docker supports tar streaming and copying from stopped containers; `-a` preserves ownership for restoration. See [Docker copy semantics](https://docs.docker.com/reference/cli/docker/container/cp/).

Restore into a **new, empty volume** and a new container name, keeping the original dataset untouched. Set `backup_file` to the completed archive if using a new shell. The example uses port 8081 so the original container can remain intact. Use the application image version corresponding to the backup:

```sh
docker volume create opticutlist-restored-data
docker create \
  --name opticutlist-restored \
  --restart unless-stopped \
  --stop-timeout 30 \
  -p 127.0.0.1:8081:3000 \
  -e OCL_ORIGIN=http://127.0.0.1:8081 \
  -v opticutlist-restored-data:/data \
  ghcr.io/tanguy-rdt/opticutlist:1.2.3
docker cp -a - opticutlist-restored:/data/ < "$backup_file"
docker start opticutlist-restored
```

Verify health, projects and physical inventory before choosing the restored instance. Do not combine unrelated main/WAL files, restore into a live volume or downgrade an incompatible migrated database.

#### Updating the image

1. Take and verify a [consistent SQLite backup](#consistent-backups-and-restoration).
2. Pull the desired available newer version (the example below uses `1.2.4`).
3. Stop and remove only the old **container**.
4. Recreate it with the new version, the **same named volume**, and the same ports/environment.
5. Verify health, projects and inventory before accepting the upgrade.

```sh
docker pull ghcr.io/tanguy-rdt/opticutlist:1.2.4
docker stop --time 30 opticutlist
docker rm opticutlist
docker run -d \
  --name opticutlist \
  --restart unless-stopped \
  --stop-timeout 30 \
  -p 127.0.0.1:8080:3000 \
  -e OCL_ORIGIN=http://127.0.0.1:8080 \
  -v opticutlist-data:/data \
  ghcr.io/tanguy-rdt/opticutlist:1.2.4
docker inspect --format '{{.State.Health.Status}}' opticutlist
docker logs --tail 100 opticutlist
```

In Portainer, stop the container, use **Duplicate/Edit** to change the image version, pull/redeploy and replace the container, preserving the existing volume, environment, published port and restart policy. Inspect the replacement's health and logs. Do not select any option that deletes the persistent volume.

For local-source images, rebuild with `docker build --pull -f docker/Dockerfile -t opticutlist:local .` and recreate using that local image instead. Pulling or rebuilding alone does not update a running container; there is no automatic updater.

Never remove the volume as part of an update. Startup migrations run before HTTP listening; if an upgrade fails, preserve the volume and inspect logs. Database migrations may make downgrading unsafe: roll back an image only when its schema remains compatible, otherwise restore the matching backup into a fresh volume.



---

**Continue exploring:** [Storage internals](storage.md#self-hosted-storage) · [Release automation](ci-cd.md) · [Documentation home](README.md)
