# Parts

[Documentation home](../README.md) / [User Guide](README.md)

A part is a finished rectangular piece you need to cut. Enter its finished size, not the size of the starting panel.

## Add a part

1. Open your project's **Parts** tab.
2. Click **New part**, or **Add first part** if the list is empty.
3. Enter a **Name** and choose a **Material** selected for this project.
4. Fill in **Length (mm)**, **Width (mm)** and **Thickness (mm)**. All three must be greater than zero.
5. Choose **Grain direction** if the visible grain must run along the length or width. Use no grain constraint if it does not matter.
6. Enter **Quantity**, the number of copies you need.
7. If there is no grain constraint, choose whether **90° rotation** is allowed.
8. Click **Create part**.

For example, a shelf 600 mm long, 300 mm wide and 18 mm thick needs those three sizes entered separately. A quantity of 3 requests three copies of that shelf.

## Edit or remove a part

1. Find the part using the search field or list.
2. Select it to inspect its details and dimension preview.
3. Use its edit action, change the fields, then click **Save changes**.
4. Use its delete action only when you want to remove that part, and confirm the request.

After changing parts, return to **Optimization** and run **Optimize** again. Check the new result before printing.

## Understand grain and rotation

When both a part and its panel specify grain, their grain directions must line up. This can determine whether the part is turned. The application does not ignore grain to make a piece fit.

Without a grain direction on both sides, the part's rotation choice controls whether it may turn by 90 degrees. A part's thickness never changes when it is turned.

## If you cannot choose a material

1. Return to **Materials** and select a material or an eligible panel using it.
2. Come back to **Parts** and reopen the form.
3. If an existing part shows an unavailable material, select a suitable project material or restore the missing project selection.

Changing selections does not silently replace a part's material. If older unassigned parts are offered for review, adopt only the ones that belong to this project; they are not assigned automatically.

To add an existing parts file, open the menu beside **New part** and choose **Import parts**. See [import instructions](files.md#import-a-parts-list).

---

**Continue exploring:** [Optimize cuts](optimization.md) · [Import parts](files.md#import-a-parts-list) · [Documentation home](../README.md)
