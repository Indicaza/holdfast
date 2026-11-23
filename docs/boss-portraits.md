# Boss portraits

The Journal's boss faces are the game's own: a temporary add-on draws each
creature with `SetPortraitTextureFromCreatureDisplayID` on a magenta sheet and
takes a screenshot. Capture is **semi-manual**: someone must start the game and
type one command.

```bash
node scripts/buildBossPortraits.mjs addon --art <DungeonJournalArt.generated.lua> --addons "/Applications/World of Warcraft/_forever_/Interface/AddOns" --out <work dir>
```

Start WoW Forever, enter the world somewhere safe, type `/gwportraits`, and
wait for "done". The screen shows magenta sheets meanwhile.

```bash
node scripts/buildBossPortraits.mjs ingest --screens "/Applications/World of Warcraft/_forever_/Screenshots" --out <work dir>
```

`ingest` reads each sheet's corner marks and number, crops 256 x 256 PNGs with
transparent corners, rejects blank or flat images and duplicate faces, and
updates `backend/src/Atlas/data/sources/boss-portraits.json`. Running `addon`
again captures only what is missing. Delete the
`GuildweaverPortraitCapture` add-on folder afterwards.

Images are Content Studio media with purpose `portrait`, named
`boss-portrait-d<displayId>.png`. A portrait an editor set on a boss wins. A
boss without a captured face shows the game's skull; a display ID is never
guessed.
