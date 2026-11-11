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
| Window | 800 × 538, metal portrait frame, rock background | Same frame pieces (`inventory-art`, `auction-art/frame-portrait-corner`); width 800–1180 px, grows with the page, never stretched further |
| Portrait | the auctioneer NPC (`SetPortraitToUnit("npc")`) | INV_Misc_Coin_01 (no NPC on a website) |
| Title | "Auction House", GameFontNormal (gold), on the title band | same |
| Search bar | top right (−12, −29), 618 × 40: favorites button, search box 241 × 22, Filter dropdown, Search 132 × 22 (UIPanelButton, red) | same order; box fills the space; the Filter dropdown holds level range and rarity |
| Categories | left, 168 × 438, `auctionhouse-background-categories`, classic scrollbar | same |
| Category button | 132 × 21, `UI-AuctionFrame-FilterBg`; hover `UI-Character-Tab-Highlight`; selected `auctionhouse-nav-button-select` (additive); third level drawn with `…-tertiary-filterline` | same art; 28px tall (request: larger targets) |
| Results | `auctionhouse-background-index`, headers 19px on `WhoFrame-ColumnTabs`, rows 20px on `auctionhouse-rowstripe-1/2`, hover `…-row-highlight`, selected `…-row-select` (both additive) | same art; rows 36px, icons 28px (request) |
| Browse columns | Price 120 (sortable, default) · Name (fill, sortable) · detail 55 (Req. Level for Weapons, Armor, Consumables) · Available · favorite 29 | same |
| Coins | `auctionhouse-icon-coin-*` | same |
| Tabs | bottom left: Buy, Sell, Auctions (CharacterFrameTab art) | Buy, Sell, Shopping (see below) |
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
the house and how fresh its data is, then the price levels (unit price,
quantity, auctions at that price; cheapest first), a summary (total listed,
lowest, typical, 7-day median, coverage), and History (charts) on its own tab.
Sellers are never shown: neither Blizzard's API nor the add-on reports them.

## Tabs

- **Buy**: browse, search, favorites.
- **Sell**: an item's price levels and recent history, to decide a price
  before posting in game (the Sell view's right-hand list).
- **Shopping**: shopping lists.
- Auctions (the player's own) is left out: the website has no data on them.
- Diagnostics is a link for administrators, outside the tabs.
