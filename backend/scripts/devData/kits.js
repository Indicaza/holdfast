// Equipment kits for the development character generator. Every ID is a real
// Classic item so names, icons, and Blizzard lookups behave like production
// telemetry. Item details live in seed/devData/items.json, recorded by
// scripts/devData/recordGameData.mjs.

export const KITS = {
  warrior_fury_60: {
    head: 12640, neck: 15411, shoulder: 12927, back: 13340, chest: 11726,
    wrist: 12936, hands: 15063, waist: 13959, legs: 15062, feet: 12555,
    finger_1: 17713, finger_2: 18500, trinket_1: 11815, trinket_2: 13965,
    main_hand: 12940, off_hand: 12939, ranged: 18323, tabard: 5976,
  },
  warrior_prot_60: {
    head: 16731, neck: 17065, shoulder: 16733, back: 13397, chest: 16730,
    wrist: 16735, hands: 16737, waist: 16736, legs: 16732, feet: 16734,
    finger_1: 11669, finger_2: 18879, trinket_1: 11810, trinket_2: 11811,
    main_hand: 18348, off_hand: 12602, ranged: 12651, tabard: 5976,
  },
  warrior_arms_60: {
    head: 12640, neck: 15411, shoulder: 12927, back: 13340, chest: 11726,
    wrist: 12936, hands: 15063, waist: 13959, legs: 15062, feet: 12555,
    finger_1: 17713, finger_2: 18500, trinket_1: 11815, trinket_2: 13965,
    main_hand: 12784, ranged: 18323,
  },
  rogue_60: {
    head: 16707, neck: 15411, shoulder: 16708, back: 13340, chest: 16721,
    wrist: 16710, hands: 16712, waist: 16713, legs: 16709, feet: 16711,
    finger_1: 17713, finger_2: 18500, trinket_1: 11815, trinket_2: 13965,
    main_hand: 15806, off_hand: 18816, ranged: 12651, tabard: 5976,
  },
  mage_60: {
    head: 16686, neck: 18691, shoulder: 16689, back: 13386, chest: 16688,
    wrist: 16683, hands: 16684, waist: 16685, legs: 16687, feet: 16682,
    finger_1: 13001, finger_2: 942, trinket_1: 12930, trinket_2: 18820,
    main_hand: 13349, off_hand: 10796, ranged: 13396,
  },
  priest_60: {
    head: 16693, neck: 18723, shoulder: 16695, back: 13386, chest: 16690,
    wrist: 16697, hands: 16692, waist: 16696, legs: 16694, feet: 16691,
    finger_1: 13001, finger_2: 16058, trinket_1: 11819, trinket_2: 12930,
    main_hand: 11923, ranged: 11748, tabard: 5976,
  },
  paladin_60: {
    head: 16854, neck: 18723, shoulder: 16856, back: 13386, chest: 16853,
    wrist: 16857, hands: 16860, waist: 16858, legs: 16855, feet: 16859,
    finger_1: 13001, finger_2: 16058, trinket_1: 11819, trinket_2: 12930,
    main_hand: 11923,
  },
  hunter_60: {
    head: 16677, neck: 15411, shoulder: 16679, back: 13340, chest: 16674,
    wrist: 16681, hands: 16676, waist: 16680, legs: 16678, feet: 16675,
    finger_1: 17713, finger_2: 18500, trinket_1: 11815, trinket_2: 13965,
    main_hand: 11931, ranged: 18713,
  },
  druid_60: {
    head: 16720, neck: 18723, shoulder: 16718, back: 13386, chest: 16706,
    wrist: 16714, hands: 16717, waist: 16716, legs: 16719, feet: 16715,
    finger_1: 13001, finger_2: 16058, trinket_1: 11819, trinket_2: 12930,
    main_hand: 13000,
  },
  warlock_60: {
    head: 16698, neck: 18691, shoulder: 16701, back: 13386, chest: 16700,
    wrist: 16703, hands: 16705, waist: 16702, legs: 16699, feet: 16704,
    finger_1: 13001, finger_2: 942, trinket_1: 12930, trinket_2: 18820,
    main_hand: 13349, off_hand: 10796, ranged: 13396, tabard: 5976,
  },
  mail_plate_40: {
    head: 7719, shoulder: 7718, chest: 10328, wrist: 10333, hands: 10331,
    waist: 10329, legs: 10330, feet: 10332, main_hand: 7717,
  },
  cloth_40: {
    head: 7720, shoulder: 7712, chest: 7711, main_hand: 7713,
  },
  leather_25: {
    chest: 10399, legs: 10400, hands: 10401, feet: 10402, waist: 10403,
    main_hand: 5191,
  },
  plate_mail_20: {
    main_hand: 7230, back: 6449,
  },
  cloth_20: {
    chest: 6465, main_hand: 6505, back: 6449,
  },
};

export function kitItemIds() {
  return [...new Set(Object.values(KITS).flatMap((kit) => Object.values(kit)))].sort((a, b) => a - b);
}
