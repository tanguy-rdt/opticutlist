# Install and update OptiCutList

[Documentation home](../README.md) / [User Guide](README.md)


Choose the online version for the quickest start. Docker and Portainer run a separate installed copy; the standalone download runs without either.

## Use online

[Open OptiCutList](https://tanguy-rdt.github.io/opticutlist/)

Create a project, select materials and panels, add your parts, then click **Optimize**. Open **Cutting Plans** to print or download the result.

Your data stays in this browser on this device. It is not shared with other browsers or installations. Export your projects, catalog and stock separately before clearing browser data. These exports are not a complete backup of stock history.

**Self-hosting safety:** Docker, Portainer and standalone installations have no built-in login. Anyone who can reach the application can access the same data. The Docker command below keeps access on one computer. Access from other devices needs a trusted network and properly protected HTTPS access set up by someone who manages that network. Do not expose OptiCutList directly to the Internet.

## Docker

Docker runs the application in a small, separate environment called a container. You need Docker installed and running on the computer where you want to use OptiCutList.

1. Install [Docker Desktop](https://docs.docker.com/get-started/get-docker/) if needed. Open it and wait until it is running. Use Linux containers if asked.
2. Choose an available version from the [published image versions](https://github.com/tanguy-rdt/opticutlist/pkgs/container/opticutlist). In the command below, replace **VERSION** with that exact version. There is no `latest` tag. These defaults apply to images containing the simplified local setup; see the older-image note below.
3. Open **Terminal** on macOS/Linux, or **PowerShell** on Windows. Paste the command and press Enter:

   ```sh
   docker run -d --name opticutlist --restart unless-stopped --stop-timeout 30 -p 127.0.0.1:3000:3000 -v opticutlist-data:/data ghcr.io/tanguy-rdt/opticutlist:VERSION
   ```

4. On that same computer, open [http://localhost:3000/opticutlist/](http://localhost:3000/opticutlist/). Use **localhost**, as written.

Docker downloads the image and creates `opticutlist-data` automatically. This volume is a separate storage area for your work. The application creates its database on first startup. No database setup or environment variables are needed with the new defaults.

To stop or start OptiCutList later, use `docker stop opticutlist` or `docker start opticutlist`.

**Keep your volume:** stopping or restarting the container keeps your work. When replacing the container, always include the same `-v opticutlist-data:/data`. Deleting and recreating a container without reattaching its volume can make your saved data appear lost, even if the old volume still exists. Never delete that volume unless you intend to erase its data.

**Older images:** this change must be included in a published image before the simpler setup works there. If an older image reports that `OCL_ORIGIN` is required, add `-e OCL_ORIGIN=http://localhost:3000` before the image name. Your existing explicit settings and volumes remain supported. If you already use another port or address, keep its matching settings when updating.

### If port 3000 is already in use

Use `-p 127.0.0.1:8080:3000` and add `-e OCL_ORIGIN=http://localhost:8080` before the image name. Then open **http://localhost:8080/opticutlist/**. The address must match the setting exactly.

## Portainer

Portainer is a web interface for managing Docker. You need Portainer already installed and connected to a Docker computer. These steps provide local access **on that computer**.

1. Sign in to Portainer and select your Docker environment from **Home**.
2. Open **Containers → Add container**. Enter `opticutlist` for **Name** and `ghcr.io/tanguy-rdt/opticutlist:VERSION` for **Image**, replacing **VERSION** with an available image version. Enable **Always pull the image**.
3. Under **Network ports configuration**, leave **Publish all exposed network ports** off. Click **Publish a new network port**. Enter host port `3000`, container port `3000`, and select **TCP**. Set the host IP to `127.0.0.1` if your version offers that field. Otherwise restrict network access with your firewall, or use the local-only Docker command above.
4. For a first installation, no manual volume creation is needed: the image declares `/data`, and Docker creates a persistent volume for it when you deploy. For an existing installation, go to **Advanced container settings → Volumes → Map additional volume**, select the existing data volume and mount it writable at `/data`.
5. Under **Restart policy**, choose **Unless stopped**, then click **Deploy the container**. No environment variables are required with the new image defaults. For an older image, add `OCL_ORIGIN` with value `http://localhost:3000` under **Env** before deploying.
6. Open the container's details and find its `/data` volume under **Volumes**. Note the volume name; an automatically created name may be a long string. Keep it when replacing the container.
7. On the Docker computer, open [http://localhost:3000/opticutlist/](http://localhost:3000/opticutlist/).

Portainer's own login does not protect OptiCutList. Do not use **Stacks**. A fresh volume creates an empty database; it does not recover data from a previous container. Always reattach the original `/data` volume during updates.

## Standalone download

This option runs the application without Docker. This option needs a standalone archive from GitHub Releases. If only source-code downloads are listed, choose the online or Docker option instead.

1. Open [OptiCutList Releases](https://github.com/tanguy-rdt/opticutlist/releases). Under **Assets**, download the file ending in `-self-hosted.tar.gz`. Do not choose **Source code**. If no such file is listed, use another option above.
2. Install [Node.js 24 or newer](https://nodejs.org/en/download) if needed. Node.js is the program that runs OptiCutList. Close and reopen your terminal after installing it.
3. Extract the downloaded archive with your computer's archive tool. If it first produces a `.tar` file, extract that too. Keep all the extracted files together in the `opticutlist` folder.
4. Open **Terminal** on macOS/Linux. Type `cd `, including the space, drag the extracted `opticutlist` folder into the window, and press Enter. Then run:

   ```sh
   node start.mjs
   ```

5. Open [http://127.0.0.1:3000/opticutlist/](http://127.0.0.1:3000/opticutlist/) on that same computer. Leave the terminal open while using the application. Press **Ctrl+C** to stop it.

Data is saved in the hidden `.opticutlist` folder in your user home folder, outside the extracted application. On macOS/Linux, use your file manager's **Go to Folder** or location field and enter `~/.opticutlist`. Keep this folder and use the same computer account after an update.

Standalone startup has been tested on macOS with Apple Silicon. Linux x64 is tested before each archive is uploaded. Windows has not been verified.

### Update standalone safely

1. Stop the application with **Ctrl+C**. Make sure no other copy is running.
2. Copy the entire `.opticutlist` folder from your home folder to a safe backup location. Include all its files. Do this only while the application is stopped.
3. Download and extract the newer archive into a new folder. Run `node start.mjs` there using the same computer account. Your data stays in the original home folder.
4. Open the application and check your projects and stock before removing the old application folder. Keep your backup: returning to an older version may require restoring it.


**No built-in login:** Keep this application on your own computer or a trusted, access-controlled network.


## Update and keep your data

### Online

Reopen the online application to use the deployed version. Keep the same browser and do not clear its stored data. Export important projects, catalog and stock regularly.

### Docker or Portainer

1. Close OptiCutList in your browser. For Docker, run the commands below. In Portainer, select the container and click **Stop**, then run only the second command in a terminal on the Docker computer. Make sure no other container uses the same data volume.

   ```sh
   docker stop --time 30 opticutlist
   docker cp -a opticutlist:/data/. - > opticutlist-backup.tar
   ```

   Use Terminal or PowerShell 7.4 or newer for the backup command; older Windows PowerShell can damage binary backups. Check that it succeeds and keep the backup somewhere safe. Move any older backup out of the way first: this command replaces a file with the same name.

2. Choose an available newer version from the [published image versions](https://github.com/tanguy-rdt/opticutlist/pkgs/container/opticutlist). Its image name starts with `ghcr.io/tanguy-rdt/opticutlist:` followed by that exact version. There is no `latest` version.
3. For Docker, run `docker rm opticutlist`, then repeat the Docker run command with the new image version. Keep `opticutlist-data` unchanged. For Portainer, choose the stopped container, click **Duplicate/Edit**, change **Image** to the new version, and deploy it with **Always pull the image** enabled. Before deploying the replacement, check **Volumes** and explicitly reattach the original volume at `/data` if it is not already listed. Keep the existing port and any custom environment settings.
4. Open the application and check your projects and stock. **Never delete the data volume during an update.**

### Standalone

Follow [Update standalone safely](#update-standalone-safely) above.

An update may change the database format. Returning to an older application version may require restoring its matching backup.

---

**Continue exploring:** [Create a project](projects.md) · [Save portable copies](files.md) · [Documentation home](../README.md)
