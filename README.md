# OptiCutList

![OptiCutList — Smarter cuts. Less waste.](assets/branding/banner.svg)

OptiCutList turns a list of rectangular parts into efficient panel layouts and printable cutting plans for woodworking and DIY projects.

Use it online or on your own server. Cutting optimization runs in your browser either way.

## Use online

**[Open OptiCutList](https://tanguy-rdt.github.io/opticutlist/)** — no installation or account required.

Your data stays in the current browser and is not automatically shared with other browsers or devices. Export projects, catalogs and stock separately to keep copies before clearing browser data.

Create a project, select materials and panels, add parts, then choose **Optimize**. Open **Cutting Plans** to print or download your document, and **Stock** to keep reusable offcuts.

## Self-host with Docker

You need Docker Desktop or Docker Engine running Linux containers and an Internet connection. No separate Node.js or SQLite installation is needed.

A public version of `ghcr.io/tanguy-rdt/opticutlist` could not be verified. These instructions build the existing image locally.

1. Download the source from [this repository](https://github.com/tanguy-rdt/opticutlist) using **Code → Download ZIP**, then extract it.
2. Open a terminal in the extracted folder containing `docker/` and `package.json`.
3. Build and start the application:

```sh
docker build -f docker/Dockerfile -t opticutlist:local .
docker volume create opticutlist-data
docker run -d \
  --name opticutlist \
  --restart unless-stopped \
  --stop-timeout 30 \
  -p 127.0.0.1:8080:3000 \
  -e OCL_ORIGIN=http://127.0.0.1:8080 \
  -v opticutlist-data:/data \
  opticutlist:local
```

On the Docker host, open **[http://127.0.0.1:8080/opticutlist/](http://127.0.0.1:8080/opticutlist/)**. Use `127.0.0.1`, not `localhost`.

The `opticutlist-data` volume keeps SQLite data under `/data` across container replacements. Devices using this server share its stored data; online browser data remains separate.

**There is no built-in authentication.** Use trusted networks or access-controlled deployments only. Do not expose the application directly to the Internet.

For a remote server with SSH access, run this on your computer. Replace `USER` and `SERVER` with your SSH login and server address:

```sh
ssh -N -L 8080:127.0.0.1:8080 USER@SERVER
```

Keep the tunnel open and use the application URL above. Direct remote access requires trusted HTTPS and a matching `OCL_ORIGIN`. If you change port `8080`, also change it in `OCL_ORIGIN` and the URL.

## Self-host with Portainer

Use Portainer's container interface, without Compose or Stacks:

1. Build `opticutlist:local` as above **on the Docker host managed by Portainer**. Manage an already-running `opticutlist` container instead of creating a duplicate.
2. In **Volumes**, create `opticutlist-data` if it does not exist.
3. Choose **Containers → Add container**. Set the name to `opticutlist` and image to `opticutlist:local`. Disable **Always pull the image**.
4. Map TCP host port `8080` to container port `3000`, with host IP `127.0.0.1`. If Portainer cannot restrict the host IP, use the Docker command above for loopback-only access; unrestricted mapping exposes the port to the network.
5. Mount the existing `opticutlist-data` volume at `/data`, read/write.
6. Add the environment variable `OCL_ORIGIN` with value `http://127.0.0.1:8080`.
7. Set restart policy **Unless stopped**. Keep default command, user and bridge network; privileged mode off. Choose **Deploy the container**.
8. Open the application URL locally, or use the SSH tunnel. Portainer's login does not protect OptiCutList.

## Update without losing data

1. Stop the container and back up its complete data directory while no other container is writing to the volume:

```sh
docker stop --time 30 opticutlist
docker cp -a opticutlist:/data/. - > "../opticutlist-backup-$(date +%Y%m%d-%H%M%S).tar"
```

2. Confirm the backup succeeded. Download newer source, open a terminal in its folder and rebuild:

```sh
docker build --pull -f docker/Dockerfile -t opticutlist:local .
```

3. Run `docker rm opticutlist`, then repeat **docker run** above with the same volume and settings. In Portainer, use **Duplicate/Edit** to redeploy the rebuilt image, preserving the volume and settings.
4. Check that the replacement becomes healthy:

```sh
docker inspect --format '{{.State.Health.Status}}' opticutlist
docker logs --tail 100 opticutlist
```

Never delete the data volume during an update. Database upgrades may make downgrading unsafe without restoring a matching backup.

## Features

- Manage projects, parts, materials and supplier panel references.
- Optimize cuts with grain, rotation, thickness, kerf and edge margins.
- Inspect dimensioned layouts and make validated edits with undo/redo.
- Track owned panels and reusable offcuts.
- Preview, print and download customizable PDF cutting documents.
- Import and export projects, catalogs and stock through JSON files.

## License

Open source under the [GNU General Public License v3.0](LICENSE).
