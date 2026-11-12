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
| Title | "Browse Auctions" on the Buy tab, GameFontNormal (gold), centred on the title band | same, centred; Back/Forward on its left, the house and its freshness on its right |
| Search bar | top right (−12, −29), 618 × 40: favorites button (SquareIconButton, greyed with no favorites), search box 241 × 22 (SearchBoxTemplate: magnifier, "Search", clear button), Filter dropdown 93 wide, Search 132 × 22 (UIPanelButton, red) | same order and look; the box takes 40 % of the bar, Filter and Search sit at its right |
| Categories | left, 168 × 438, `auctionhouse-background-categories`, classic scrollbar (always shown, arrows at both ends) | same art and an always-shown bar with arrows (Chrome, Edge, Safari; Firefox draws its own thin bar in the same colours); 210 px wide at 1x, scaled (see Sizing) |
| Category button | `AuctionHouseFilterButton_SetUp`: a category is a dark rounded button, gold text (GameFontNormalSmall); a subcategory the same button indented 8, white text (GameFontHighlightSmall); a third-level entry no button, white text after `…-tertiary-filterline`. Hover `UI-Character-Tab-Highlight`; selected category and subcategory `auctionhouse-nav-button-select` / `-secondary-select` (yellow rim), selected third level `auctionhouse-ui-row-select` (gold bar). No counts. | the same, drawn from the in-game look (the FilterBg texture is too coarse to stretch); 28px tall (request: larger targets). The game's font (Friz Quadrata) where the player has it installed, else Georgia |
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
| Click a category | selects it and opens only its branch (other branches close); clicking the selected category, or one above it on the path, selects its parent. The whole selected path keeps its rim. Nothing is searched until Search. | the same selection. A category with subcategories only opens (results stay, as requested before); one without subcategories shows its items at once. |
| Choose what to show | Search searches the selected category (with the text and filters) | the same: select Armor, press Search, all armor. There are no "All …" entries. |
| Filter | Level Range (two boxes), Uncollected Only, Usable Only, then Rarity: a checkbox per quality (Poor … Legendary) in its colour; a red X on the button clears them | Level Range (applies on Enter or Search) and the six rarity checkboxes (apply when ticked); the red X clears them. Uncollected Only and Usable Only are left out: the website cannot tell what a character has collected or can use |
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

