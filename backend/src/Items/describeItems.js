import { itemsInDatabase } from "../Market/marketRepository.js";

// Fills in what the game's own tooltip needs for a page's items: the name,
// quality and icon when the caller only had an id, and the tooltip lines a
// player's game rendered for the item (or Blizzard's item text). Read from
// the website's item index (market_item_meta, public_game_items and the
// item catalog), two queries for the whole list, so hovering an item never
// asks the server anything. What the caller already knows is kept: a
// captured tooltip from the player's own add-on data wins over the public
// one, and nothing is ever invented for an item the website has not seen.

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function tooltipLineCount(item) {
  if (Array.isArray(item?.tooltip?.lines)) return item.tooltip.lines.length;
  if (Array.isArray(item?.tooltipLines)) return item.tooltipLines.length;
  return 0;
}

// One item with the index's facts folded in. `facts` is what
// itemsInDatabase returns for its id.
export function describedItem(item, facts) {
  if (!item || typeof item !== "object" || !facts) return item;
  const lines = Array.isArray(facts.tooltipLines) ? facts.tooltipLines : [];
  const described = {
    ...item,
    name: item.name || (facts.nameKnown ? facts.name : "") || item.name || facts.name || "",
    qualityId: item.qualityId ?? facts.qualityId ?? null,
    iconFileDataId: item.iconFileDataId ?? facts.iconFileDataId ?? null,
  };
  // A tooltip that is only the item's name says nothing: leave the item
  // waiting for a real one rather than show an empty frame.
  if (lines.length > 1 && tooltipLineCount(item) <= 1) {
    described.tooltip = { lines, source: facts.tooltipSource || null, gameBuild: facts.tooltipBuild || null };
  }
  return described;
}

// Describes every item in `items` (by `id`, default item.itemId). Items
// without a usable id come back unchanged.
export function describeItems(db, items, { id = (item) => item?.itemId } = {}) {
  const list = Array.isArray(items) ? items : [];
  const ids = [...new Set(list.map((item) => positiveInteger(id(item))).filter(Boolean))];
  if (!ids.length) return list;
  const facts = itemsInDatabase(db, ids);
  return list.map((item) => {
    const itemId = positiveInteger(id(item));
    return itemId ? describedItem(item, facts(itemId)) : item;
  });
}
