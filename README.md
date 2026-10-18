# OptiCutList

![OptiCutList — Smarter cuts. Less waste.](assets/branding/banner.svg)

OptiCutList helps you plan rectangular panel cuts for woodworking and DIY projects. Enter your parts, choose your materials, and create cutting plans you can print or save as a PDF.

## Getting started

Choose one of the four options below. The online version is the easiest way to begin.

### 1. Use online — no installation

[Open OptiCutList](https://tanguy-rdt.github.io/opticutlist/)

Create a project, select materials and panels, add your parts, then click **Optimize**. Open **Cutting Plans** to print or download the result.

Your data stays in this browser on this device. It is not shared with other browsers or installations. Export your projects, catalog and stock separately before clearing browser data. These exports are not a complete backup of stock history.

### 2. Use Docker

Docker runs the application in a small, separate environment called a container. You need Docker installed and running on the computer where you want to use OptiCutList.

1. Install [Docker Desktop](https://docs.docker.com/get-started/get-docker/) if needed. Open it and wait until it is running. Use Linux containers if asked.
2. Open **Terminal** on macOS/Linux, or **PowerShell** on Windows. This is the window where you paste commands. Paste each line below and press Enter. The first command downloads OptiCutList; it may take a few minutes. The available image below is a **beta**, a preview version that may still have problems.

   ```sh
   docker pull ghcr.io/tanguy-rdt/opticutlist:1.1.0-beta
   docker volume create opticutlist-data
   docker run -d --name opticutlist --restart unless-stopped --stop-timeout 30 -p 127.0.0.1:8080:3000 -e OCL_ORIGIN=http://127.0.0.1:8080 -v opticutlist-data:/data ghcr.io/tanguy-rdt/opticutlist:1.1.0-beta
   ```

3. On that same computer, open [http://127.0.0.1:8080/opticutlist/](http://127.0.0.1:8080/opticutlist/). Use this exact address, including `127.0.0.1`.

Data is saved in `opticutlist-data`, a Docker volume: a storage area kept separately from the application. Its SQLite database is at `/data/opticutlist.sqlite` inside the container. Keep this volume when replacing the application.

To stop or start OptiCutList later, use `docker stop opticutlist` or `docker start opticutlist`.

### 3. Use Portainer

Portainer is a web interface for managing Docker. You need Portainer already installed and connected to a Docker computer. These settings let you open OptiCutList **on that computer**, not from another device.

1. Sign in to Portainer and select your Docker environment from **Home**.
2. Open **Volumes → Add volume**. Enter `opticutlist-data` as the name and click **Create the volume**. If it already exists, keep it.
3. Open **Containers → Add container**. Enter `opticutlist` for **Name** and `ghcr.io/tanguy-rdt/opticutlist:1.1.0-beta` for **Image**. Enable **Always pull the image**. This is the same beta version as above.
4. Under **Network ports configuration**, leave **Publish all exposed network ports** off. Click **Publish a new network port**. Enter host port `8080`, container port `3000`, and select **TCP**. Set the host IP to `127.0.0.1`. If your Portainer version has no host IP field, use the Docker instructions above instead to keep access local.
5. Under **Advanced container settings → Volumes**, click **Map additional volume**. Select **Volume**, choose `opticutlist-data`, and enter `/data` for **Container**. Leave it writable.
6. Open **Env → Add environment variable**. Enter `OCL_ORIGIN` as the name and `http://127.0.0.1:8080` as its value.
7. Under **Restart policy**, choose **Unless stopped**. Leave the other settings unchanged and click **Deploy the container**. Do not use **Stacks**.
8. On the Docker computer, open [http://127.0.0.1:8080/opticutlist/](http://127.0.0.1:8080/opticutlist/).

Data stays in the `opticutlist-data` volume. Portainer's own login does not protect OptiCutList.

### 4. Use the standalone download

This option runs the application without Docker. **No standalone download is currently listed on GitHub Releases.** When an archive is available, follow these steps:

1. Open [OptiCutList Releases](https://github.com/tanguy-rdt/opticutlist/releases). Under **Assets**, download the file ending in `-self-hosted.tar.gz`. Do not choose **Source code**. If no such file is listed, use another option above.
2. Install [Node.js 24 or newer](https://nodejs.org/en/download) if needed. Node.js is the program that runs OptiCutList. Close and reopen your terminal after installing it.
3. Extract the downloaded archive with your computer's archive tool. If it first produces a `.tar` file, extract that too. Keep all the extracted files together in the `opticutlist` folder.
4. Open **Terminal** on macOS/Linux. Type `cd `, including the space, drag the extracted `opticutlist` folder into the window, and press Enter. Then run:

   ```sh
   node start.mjs
   ```

5. Open [http://127.0.0.1:3000/opticutlist/](http://127.0.0.1:3000/opticutlist/) on that same computer. Leave the terminal open while using the application. Press **Ctrl+C** to stop it.

Data is saved in the hidden `.opticutlist` folder in your user home folder, outside the extracted application. On macOS/Linux, use your file manager's **Go to Folder** or location field and enter `~/.opticutlist`. Keep this folder and use the same computer account after an update.

Standalone startup has been tested on macOS with Apple Silicon. The release process also tests Linux x64 before uploading an archive. Windows has not been verified.

**Self-hosting safety:** Docker, Portainer and standalone installations have no built-in login. Anyone who can reach the application can access the same data. The examples above keep access on one computer. Access from other devices needs a trusted network and properly protected HTTPS access set up by someone who manages that network. Do not expose OptiCutList directly to the Internet.

## Update without losing your work

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
3. For Docker, run `docker rm opticutlist`, then repeat the Docker installation commands with the new version in both image names. Keep `opticutlist-data` unchanged. For Portainer, choose the stopped container, click **Duplicate/Edit**, change **Image** to the new version, and deploy it with **Always pull the image** enabled. Keep the same volume, ports and environment variable.
4. Open the application and check your projects and stock. **Never delete the data volume during an update.**

### Standalone

1. Stop the application with **Ctrl+C**. Make sure no other copy is running.
2. Copy the entire `.opticutlist` folder from your home folder to a safe backup location. Include all its files. Do this only while the application is stopped.
3. Download and extract the newer archive into a new folder. Run `node start.mjs` there using the same computer account. Your data stays in the original home folder.
4. Open the application and check your projects and stock before removing the old application folder.

An update may change the database format. Returning to an older application version may require restoring its matching backup.

## Features

- Organize projects, parts, materials and supplier panels.
- Optimize panel cuts while respecting grain, rotation and saw-cut spacing.
- View dimensioned plans and make checked layout edits.
- Track owned panels and reusable offcuts.
- Preview, print and download customizable PDF documents.
- Import and export projects, catalogs and stock.

## License

Open source under the [GNU General Public License v3.0](LICENSE).
