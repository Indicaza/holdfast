# Inventory art

Blizzard UI art for the bag windows, from the classic client's
`Interface/ContainerFrame` and `Interface/MoneyFrame` textures (the
`wow_classic_era` product on wago.tools), cropped and saved as lossless WebP.
Each bag piece is 194px wide, cut from x 62 of its 256px texture:

- `backpack`: UI-BackpackBackground (FileDataID 130981), rows 0-238: portrait,
  title bar, 4x4 slots and money bar
- `bag-top`: UI-Bag-4x4 (130998), rows 0-88: portrait ring, title bar and a
  full first row of slots
- `bag-top-partial`: UI-Bag-Components (131003), rows 95-162: the same top with
  two slots on the right, for bags whose size leaves two over
- `bag-row`: UI-Bag-4x4, rows 129-170: one row of four 42x41 slots
- `bag-bottom`: UI-Bag-4x4, rows 211-219: the frame's bottom edge
- `coin-gold`, `coin-silver`, `coin-copper`: UI-GoldIcon / -SilverIcon /
  -CopperIcon (237618, 237620, 237617)

InventoryPane.css places slots, the portrait and the title in percentages of
these pixel grids.
