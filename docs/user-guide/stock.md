# Stock and offcuts

[Documentation home](../README.md) / [User Guide](README.md)

Stock is material you physically own. A catalog reference describes a panel a supplier offers; it does not increase your stock until you explicitly record the panel as owned.

## Record panels you already own

If the panel is in your catalog:

1. Open **Catalog** and find the product under its supplier.
2. Click the product row's **Add to stock** action.
3. Enter the number of panels and confirm the addition.
4. Open **Stock** in the main sidebar to check the panels.

For a panel not represented by a catalog product:

1. Open **Stock** in the main sidebar and click **Add to stock**.
2. Choose an existing material and item type, then enter the dimensions, **Grain direction** and **Owned quantity**.
3. Click **Add stock item** and check the new item. If the material is missing, create the appropriate material through the Catalog workflow first.

Use this global Stock page to search, inspect, edit or delete owned items. Read confirmation messages carefully. A change may be rejected if another operation has already used or changed the item.

## Keep offcuts from a cutting plan

1. Open a project with a saved cutting result and select its **Stock** tab.
2. Expand a panel group with its chevron. Each group shows the number of offcuts.
3. Click an offcut row or its area in the drawing to inspect it. Hovering highlights the matching row and drawing area.
4. Tick its checkbox if you want to keep that offcut in physical stock.
5. Wait for **Synchronizing stock…** to finish. There is no separate Save or Apply button.
6. Open global **Stock** to find your kept offcuts.

Clicking or hovering a row does not tick its checkbox. Only the checkbox changes whether the offcut is kept. **Offcut 1**, **Offcut 2** and similar labels restart for each panel and are inspection labels, not permanent stock names.

Uncheck an offcut to remove it only when it has not already been used or changed elsewhere. A conflict message means the application cannot safely reverse that change. Keep the existing records and review which project used them.

## Reuse an offcut in another project

1. Open the other project's **Materials** tab.
2. Choose the offcut's material.
3. Select the offcut under **Stock**.
4. Enter compatible parts and optimize as usual.

An offcut cannot be used as a source panel in the same project that generated it. Stock availability also accounts for panels already allocated to a saved result; rerunning a project does not grant extra physical panels.

Deleting a project offers separate choices for keeping current stock or restoring its initial stock when safe. See [project deletion](projects.md#delete-a-project-carefully).

---

**Continue exploring:** [Import and export stock](files.md#import-or-export-stock) · [Materials](materials.md) · [Documentation home](../README.md)
