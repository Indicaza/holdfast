# Inventory art

Blizzard UI art for the bag windows, from WoW Forever's client (the
`wow_cn_beta` product on wago.tools), cropped from its texture atlases
(`UiTextureAtlasMember`) and saved as WebP. The 2x atlas pieces are drawn at
half size.

- `frame-corner-top-left`: UI-Frame-PortraitMetal-CornerTopLeftSmall (2x), the
  gold portrait ring
- `frame-corner-top-right`, `frame-corner-bottom-left`,
  `frame-corner-bottom-right`: UI-Frame-Metal-Corner* (2x)
- `frame-edge-top`, `frame-edge-bottom`, `frame-edge-left`, `frame-edge-right`:
  _UI-Frame-Metal-EdgeTop / -EdgeBottom, !UI-Frame-Metal-EdgeLeft / -EdgeRight
  (2x), tiled
- `frame-background`: Interface/FrameGeneral/UI-Background-Rock (FileDataID
  374155), tiled
- `slot`: bags-item-slot64-c60-2x, the empty bag slot
- `search-left`, `search-middle`, `search-right`, `search-icon`,
  `search-clear`: common-search-border-*, -magnifyingglass, -clearbutton
- `coin-gold`, `coin-silver`, `coin-copper`: Interface/MoneyFrame/UI-GoldIcon
  / -SilverIcon / -CopperIcon (237618, 237620, 237617)

InventoryPane.css places the nine-slice pieces with the client's
PortraitFrameTemplate offsets (13px left, 16px up, 4px right, 3px down of the
window).
