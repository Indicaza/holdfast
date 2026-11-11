# Auction House art

Blizzard UI art for the Auction House, from WoW Forever's client (build
1.60.1.70450, the `wow_cn_beta` product on wago.tools), saved as lossless
WebP. Forever's auction house is `Blizzard_AuctionHouseUI` with the Classic
family templates (see `docs/AUCTION_HOUSE_UI.md`); these are the textures
those templates name. Atlas pieces are cropped with the client's
`UiTextureAtlasMember` coordinates; 2x pieces are drawn at half size.

From atlas 3046538 (`auctionhouse-*` UI pieces):

- `row-stripe-1`, `row-stripe-2`: auctionhouse-rowstripe-1 / -2, the list rows
- `row-select`, `row-highlight`: auctionhouse-ui-row-select / -row-highlight (drawn additively)
- `nav-button-select`, `nav-button-highlight`: auctionhouse-nav-button-select / -highlight (category button, additive)
- `nav-filterline`: auctionhouse-nav-button-tertiary-filterline (third-level category line)
- `coin-gold`, `coin-silver`, `coin-copper`: auctionhouse-icon-coin-*
- `favorite`, `favorite-off`: auctionhouse-icon-favorite / -favorite-off
- `sort-arrow`: auctionhouse-ui-sortarrow
- `icon-border-small`: auctionhouse-itemicon-small-border
- `item-header`: auctionhouse-itemheaderframe (the item header of the buy and sell views)
- `input-left`, `input-middle`, `input-right`: auctionhouse-ui-inputfield-*
- `filter-clear`: auctionhouse-ui-filter-redx
- `clock`: auctionhouse-icon-clock
- `spinner`: auctionhouse-ui-loadingspinner

From atlas 3054898 (`auctionhouse-background-*`):

- `background-categories`, `background-index`, `background-commodities`,
  `background-sell-left`, `background-sell-right`, `background-header`

From atlas 2406979: `frame-portrait-corner` (UI-Frame-PortraitMetal-CornerTopLeft-2x,
the large gold portrait ring of PortraitFrameTemplate). The other frame pieces
are shared with `../inventory-art`.

Whole files:

- `filter-bg`: Interface/AuctionFrame/UI-AuctionFrame-FilterBg (130696), the category button
- `tab-highlight`: Interface/PaperDollInfoFrame/UI-Character-Tab-Highlight (136580)
- `text-background`: Interface/QuestFrame/UI-TextBackground-BackdropBackground (136812)
- `tab-active`, `tab-inactive`: Interface/PaperDollInfoFrame/UI-Character-ActiveTab / -InActiveTab (136544, 136564)
- `button-up`, `button-down`: Interface/Buttons/UI-Panel-Button-Up / -Down (130828, 130825)
- `column-tabs`: Interface/FriendsFrame/WhoFrame-ColumnTabs (131139), the column headers
- `scrollbar-knob`, `scroll-up`, `scroll-down`: Interface/Buttons/UI-ScrollBar-* (130849, 130857, 130853)
- `portrait-coin`: Interface/Icons/INV_Misc_Coin_01 (133784). The game shows the
  auctioneer's portrait here; a website has no NPC to show, so the coin stands in.

`button-up`, `button-down`, `column-tabs`, `filter-bg` and the tabs are cropped
to the texture coordinates their templates use (UIPanelButtonTemplate
0–0.625 × 0–0.6875; WhoFrame-ColumnTabs 0–0.96875 × 0–0.59375;
AuctionCategoryButtonTemplate 0–0.53125 × 0–0.625; the tabs to their painted
area), so the stylesheet can nine-slice them with `border-image`.
