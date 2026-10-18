# Optimization

[Documentation home](../README.md) / [User Guide](README.md)

Optimization arranges your requested parts on the selected panels. It respects material, thickness, grain, rotation and the space needed for cuts.

## Set up your cuts

1. Open the project's **Optimization** tab.
2. Open **Cutting settings** using the settings control near **Optimize**.
3. Set **Saw kerf (mm)**: the width of material removed by the saw blade.
4. Set **Edge margin (mm)**: the border to leave unused around each panel.
5. Leave **Prefer stock panels** ticked if you want to favor panels you already own over catalog panels.
6. Click **Save settings**. This saves the choices; it does not start optimization.

Use the real blade width and margin for your workshop. A panel that is too small after margins and cuts cannot hold the part even if its outside size looks sufficient.

## Generate and review a layout

1. Click **Optimize** and wait for the result. You can cancel a running calculation.
2. Choose a used panel in the left list to inspect its drawing.
3. Select a part in the list or drawing to inspect its position and dimensions.
4. Review **Unplaced parts** if shown. Open a listed item to inspect why it could not be placed.
5. Check every panel before proceeding to **Cutting Plans**.

Unplaced pieces have not been made to fit. Check their dimensions, material, thickness and grain. Select other suitable panels or add stock if needed, then optimize again. The result is a useful cutting arrangement, not a promise of the best possible arrangement for every job.

## Adjust a layout

Use the drawing's available editing controls to rotate or swap compatible pieces. An edit is accepted only when it keeps the plan valid; not every apparent move is possible. Dragging pans the view rather than freely moving a piece.

Use **Undo** and **Redo** for accepted edits in the current editing session. These buttons are not a permanent history after a reload. Accepted layouts save automatically. Resolve a save error before leaving or trying to print; an older result is not a safe substitute for the edit you see.

## Stock changes happen automatically

Saving a current result updates the physical stock used by that plan. Clicking **Optimize** does not place a supplier order. Catalog panels remain external references; owned Stock panels are tracked against your inventory.

If the application reports that stock or an offcut has changed elsewhere, stop and review the conflict. Do not delete and recreate stock records to bypass the warning.

---

**Continue exploring:** [Cutting plans and PDF](cutting-plans.md) · [Offcuts and stock](stock.md) · [Documentation home](../README.md)
