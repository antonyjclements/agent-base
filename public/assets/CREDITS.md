# Bundled art

The `.glb` files in this folder are built by `npm run assets` from four asset packs by
**[Kay Lousberg](https://kaylousberg.com)** (KayKit) and **[Kenney](https://kenney.nl)**. All four are
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), which places them in the public domain, so
they are not covered by this project's MIT license. CC0 asks for nothing in return; crediting Kay and
Kenney costs nothing and is gladly done.

| File | Built from | Version and tier | Source | License | Retrieved | Archive SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `spacebase.glb` | KayKit : Space Base Bits (buildings) | 1.0, Extra | https://kaylousberg.itch.io/space-base-bits | CC0 1.0 | 2026-09-26 | `190e0cf51f93910ea42eb676dce81ce6bbc667bbb52bbc3a6a8c9537416bb860` |
| `forest.glb` | KayKit : Forest Nature Pack (trees, bushes, rocks) | 1.0, Extra | https://kaylousberg.itch.io/kaykit-forest | CC0 1.0 | 2026-09-26 | `807a4c9bffd78295602a269f00b3365e696d152cec33c3f9e0b7149039871bbc` |
| `bot.glb` | KayKit : Character Animations (Mannequin_Medium rig and animation clips) | 1.1, Source | https://kaylousberg.itch.io/kaykit-character-animations | CC0 1.0 | 2026-09-26 | `4509abbc51076466a6631b7e5efcb4e343bb91a74cfe761328994924bb3fc8c7` |
| `nature.glb` | Kenney : Nature Kit (palms, cacti, pines and other scatter, recoloured by `tools/build-nature.mjs`) | 2.1 | https://kenney.nl/assets/nature-kit | CC0 1.0 | 2026-09-26 | `fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d` |

The Extra and Source tiers of the KayKit packs are paid; each pack's own `License.txt` states CC0 for the
whole tier. The archive hashes identify exactly what the models were built from.

## What is Moon Base's own

The bot's body and motion are KayKit's mannequin and animations, above. Its look (the head's shape, the
screen, the side lamps or dish, the mast and the paint) is Moon Base's own design, drawn in code in
`src/agents/model.js` and `src/agents/looks.js`, and is MIT licensed with the rest of the code. It is not
derived from any other project's character.

## Rebuilding

Put the four packs in the `assets-src/` folder (which is not checked in), unpacked as they come, and run
`npm run assets`. The build finds each pack by its name, so the free, extra and source tiers all work. With
`assets-src/` absent the build keeps the models already here.
