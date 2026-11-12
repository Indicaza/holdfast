# Auction House UI specification

What Guildweaver's Auction House reproduces from WoW Forever's own auction
house, where it comes from, and where it differs on purpose. Read with
`AUCTION_HOUSE.md` (data) and `frontend/public/auction-art/README.md` (art).

## Which auction house Forever has

Sources studied:

- Forever's interface code: `Gethe/wow-ui-source`, branch `forever`
  (1.60.1, build 70888), `Interface/AddOns/Blizzard_AuctionHouseUI`.
- The 1.12 classic auction house, for comparison: `satan666/WOW-UI-SOURCE`,
  `AddOns/Blizzard_AuctionUI` (`Blizzard_AuctionUI.xml`, `…Templates.xml`, `….lua`).
- Forever's client textures: wago.tools, product `wow_cn_beta`, build
  1.60.1.70450 (atlas tables `UiTextureAtlas`, `UiTextureAtlasMember`).

Forever ships only `Blizzard_AuctionHouseUI`, the modern auction house (Buy,
Sell, Auctions; Price, Name, Available), not the 1.12 frame
(`Blizzard_AuctionUI`: Browse, Bids, Auctions; 37px rows, bid and buyout
boxes). Its `.toc` loads the Shared files, the **Classic** family templates
(`[Family]`) and, for Forever only, `Camelot/Blizzard_AuctionData.lua`: the
category tree. Guildweaver follows that combination. Nothing from the 1.12
frame or from the Mainline family is mixed in. The screenshots mentioned in
the request were not attached, so this is checked against the source and the
client art, not against screenshots.

## Window (`AuctionHouseFrame`, PortraitFrameTemplate)

| Part | Forever | Guildweaver |
| --- | --- | --- |
| Window | 800 × 538, metal portrait frame, rock background | Same frame pieces (`inventory-art`, `auction-art/frame-portrait-corner`); fills the dashboard's content area (up to 2600 px wide), see Sizing |
| Portrait | the auctioneer NPC (`SetPortraitToUnit("npc")`) | INV_Misc_Coin_01 (no NPC on a website) |
| Title | "Browse Auctions" on the Buy tab, GameFontNormal (gold), on the title band | "Browse Auctions" |
| Search bar | top right (−12, −29), 618 × 40: favorites button, search box 241 × 22, Filter dropdown, Search 132 × 22 (UIPanelButton, red) | same order; box fills the space; the Filter dropdown holds level range and rarity |
| Categories | left, 168 × 438, `auctionhouse-background-categories`, classic scrollbar | same art; 210 px wide at 1x, scaled (see Sizing) |
| Category button | 132 × 21, `UI-AuctionFrame-FilterBg`; hover `UI-Character-Tab-Highlight`; selected `auctionhouse-nav-button-select` (additive); third level drawn with `…-tertiary-filterline` | same art; 28px tall (request: larger targets) |
| Results | `auctionhouse-background-index`, headers 19px on `WhoFrame-ColumnTabs`, rows 20px on `auctionhouse-rowstripe-1/2`, hover `…-row-highlight`, selected `…-row-select` (both additive) | same art; rows 36px, icons 28px (request) |
| Browse columns | Price 120 (sortable, default) · Name (fill, sortable) · detail 55 (Req. Level for Weapons, Armor, Consumables) · Available · favorite 29 | same |
| Coins | `auctionhouse-icon-coin-*` | same |
| Tabs | bottom left: Buy, Sell, Auctions (CharacterFrameTab art) | none: Browse is the only screen (see below) |
| Money | the player's gold, bottom left | not shown (the website has no wallet) |

## Category tree (Forever, `Camelot/Blizzard_AuctionData.lua`)

Weapons (One-Handed, Two-Handed, Ranged, Miscellaneous ›
Fishing Poles, Other) · Armor (Plate, Mail, Leather, Cloth, each by slot:
Head, Shoulder, Chest (with robes), Waist, Legs, Feet, Wrist, Hands; Relic ›
Idols, Librams, Totems; Miscellaneous › Neck, Cloak, Finger, Trinket,
Held In Off-hand, Shields, Shirts) · Containers (Standard, Ammo, Reagent
bags) · Consumables (by subclass, with Item Enhancement after Bandages) ·
Trade Goods (by subclass) · Projectile · Recipes (by profession, Books last) ·
Quest Items · Miscellaneous · WoW Token. There are no Gems or Glyphs
categories in Forever. `backend/src/Market/marketCategories.js` builds this
tree; the website draws whatever it sends.

## Behaviour

| Action | Forever | Guildweaver |
| --- | --- | --- |
| Click a category | selects it, opens only its branch, searches | **opens or closes it only**: results, search and selection stay (requested). Several branches can stay open. |
| Choose what to show | the selected category | a leaf, or "All ‹category›" at the top of an open branch |
| Search | Search button or Enter, within the category | same; typing never searches, suggestions only |
| Click a row | selects; commodities and items open their buy view | selects only, fills the bar under the list |
| Double-click | — | opens the item's window (price levels, history) |
| Hover icon or name | item tooltip | same tooltip, from what the game showed (`GameTooltipBody`) |
| Favorites | star button above the categories lists favorites | the Buy tab with nothing searched shows favorites |
| Back, Forward | — | buttons in the title bar and the browser's; each search, category, sort, page or house is one step |
| Buy, bid, post | in game | never: the website is read-only |

## Item window (Guildweaver's own)

Forever's commodity buy view (a header with a large icon, then
Unit Price · Available) is the model: a 52px icon and name (tooltip on hover),
the favorite star, the house and how fresh its data is, then Prices: a summary
(lowest and typical buyout, available and auctions, 7-day median, 24-hour
change, when seen) and the price levels (unit price, quantity, auctions at
that price; cheapest first) with "Cost to buy": a quantity, walked level by
level (never the lowest price times the quantity; clicking a level fills in
everything up to it). History (price and supply charts, metrics) is on its
own tab. Sellers are never shown: neither Blizzard's API nor the add-on
reports them. No buy, sell or shopping-list controls.

## Tabs

None. The website cannot buy, post or cancel auctions, so the game's Sell and
Auctions tabs (and the Sell and Shopping tabs earlier versions had) would only
mislead; the window is the game's Buy screen, titled "Browse Auctions" as in
the game. Old links with `tab=sell`, `tab=appraiser`, `tab=shopping` or
`tab=lists` open Browse (`tab=sell&item=…` opens that item's window).
Shopping lists keep their data and their API (`/api/market/lists`) for a
later planning page. Diagnostics is a link for administrators.

## Sizing

The window fills the dashboard's content area (the shell's `gw-content--fill`
gives it the full width and height under the top bar), keeping the game's
proportions: categories on the left, the search bar over a wide results list.
Sizes inside it scale with one unit, `--ah-u`: 1px up to about 1650 px of
browser width, about 1.1px at 1920, 1.3px from about 2500 (`clamp(1px,
0.035vw + 0.43px, 1.3px)`). Text, rows (38 at 1x), icons (28), category
buttons (30) and columns use it; the frame art keeps its own pixel sizes. No
CSS transform, so text and icons stay sharp. Below 860 px wide the categories
go above the results.

Before: `.ah` had `max-width: 1180px` and every size was fixed, so on a
1650 px browser the window took about 60 % of the content width and on 2560
px less than half.

