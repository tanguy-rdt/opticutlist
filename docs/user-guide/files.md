# Import, export and saved copies

[Documentation home](../README.md) / [User Guide](README.md)

Export saves a file on your computer. Import reads a compatible file into the application. Read the preview and confirm before importing; choosing a file alone does not finish the import.

## Save or import a project

To save a portable project:

1. Click **All projects**.
2. Open the project's three-dot menu.
3. Choose **Export project** and save the downloaded file. Its name ends in **.oclproject.json**.

To open a saved project file:

1. On **Home**, choose **Import Project**, or use **Projects → New project**'s arrow menu and choose **Import project**.
2. Choose the saved project file. Older **.pocl** and **.json** filenames are also accepted when their contents are supported.
3. Review the project name, counts and any conflicts.
4. Click **Confirm Import** and approve the confirmation message.
5. Open the imported project. Existing projects are not overwritten.

A project file carries its parts, relevant catalog references and saved plans. It does not carry the physical panels, offcut decisions or stock history. A plan that used stock on another installation may need its missing stock references reviewed before it can be used there.

## Import or export the catalog

1. Open **Settings** at the bottom of the sidebar.
2. Under **Catalog**, choose **Export Catalog** to download a **.cocl** file, or **Import Catalog** to select one.
3. For an import, read **Catalog import preview** and click **Confirm Catalog Import**.
4. Check the Catalog after the import finishes.

The catalog file includes materials and supplier products, not owned panels or projects. Existing records are not overwritten. Conflicting records can be imported as separate records.

## Import or export stock

1. Open **Settings → Stock**.
2. Choose **Export Stock** to download **stock.oclstock.json**, or **Import Stock** to select a compatible file.
3. Read **Stock import preview**. The required materials and catalog references must already exist and match. Import the catalog first if needed.
4. Click **Confirm Stock Import** only when the preview is appropriate.

Stock import adds new independent stock, leaves identical existing records unchanged and does not merge quantities. Unsafe conflicts block the import. It does not recreate missing generated offcuts or restore stock history. Do not use it to undo stock consumption.

## Import a parts list

1. Open a project's **Parts** tab.
2. Open the arrow menu beside **New part** and choose **Import parts**.
3. Choose a supported **.oclparts.json** or **.json** parts file.
4. Review the rows and choose a project material for each row that needs one. A CAD file may omit material, grain and rotation. Missing grain means no grain constraint; missing rotation allows turning the part. Review those defaults before importing.
5. Click **Import parts** and confirm when asked.

Parts are added to this project, without replacing existing ones. Importing the same parts list twice adds a second batch. There is no separate parts export; export the project when you want to save its parts.

## What your saved files contain

Keep project, catalog and stock exports separately. None is a complete backup of the application, and exporting all three still does not preserve the full stock history.

For online use, browser data may be lost if it is cleared or the browser removes it. Export important work regularly and keep copies outside the browser.

For an installed server, use a stopped-database backup for a complete saved copy. The [installation guide](installation.md#update-and-keep-your-data) explains how to preserve Docker volumes or the standalone data folder during updates. Do not copy only a database file while the application is running.

If an import reports a problem, keep the original file. Read the error and correct the underlying missing selection or dependency. Renaming an unrelated file to one of these extensions does not make it a compatible export.

---

**Continue exploring:** [Your projects](projects.md) · [Update and preserve data](installation.md#update-and-keep-your-data) · [Documentation home](../README.md)
