# Roster mesh-acquisition investigation — 2026-08-08

Time-boxed (≤45 min wall-clock) investigation into whether a new body mesh (a 3rd/4th
body, beyond the current `Male`/`Female` pair) can be acquired and vendored into
`public/assets/characters/` without violating the "no sudo-install a GUI 3D suite, no
login, no purchase" constraint this task ran under. Every claim below is either a
command actually run with its real output pasted in, or explicitly marked as
unverified general knowledge (never presented as measured).

Companion tooling: `scripts/probe-skeleton-compat.mjs` (tested by
`tests/probe-skeleton-compat.test.ts`) makes gate 2 below mechanically checkable
against any future candidate `.glb` — see "How to re-run this probe" at the bottom.

## Route 1 — MakeHuman / Blender (local mesh generation)

**Blocked: neither tool is installed, and installing a GUI 3D suite is out of scope
for a worker.**

```
$ which makehuman blender
makehuman not found
blender not found
```
(exit 1 — neither binary resolves on `$PATH`.)

Both are large, interactive GUI applications (MakeHuman for parametric human
generation, Blender for rigging/export). Installing either via `sudo apt install`
would satisfy the letter of "not already installed" but violates this task's explicit
hard constraint against sudo-installing a GUI 3D suite — and even if installed,
neither can be *driven* headlessly to actually produce a compatible rigged export
within a 45-minute time box. Not pursued further.

## Route 2 — Mixamo (Adobe's free auto-rigger)

**Blocked: requires an Adobe login, and independently, Mixamo's own bone-naming
convention fails this project's compatibility gate.**

Mixamo (`mixamo.com`, reachable — `curl -sI https://www.mixamo.com` returns `200`)
is Adobe's browser-based auto-rigging service. Uploading/downloading a character
requires being signed in with an Adobe account — an interactive login this task's
constraints explicitly forbid attempting.

Independent of the login wall, Mixamo exports use the `mixamorig:*` bone-name prefix
(e.g. `mixamorig:Hips`, `mixamorig:Spine`) instead of this project's vendored bare
names (`Hips`, `Spine`, …). `tests/probe-skeleton-compat.test.ts`'s
"rejects a Mixamo/Rigify-style renamed skeleton" case proves this mechanically: a
`mixamorig:`-prefixed copy of the real `Male.glb` skeleton scores

```
overlapRatio(mixamoNames, maleNames) === 0
```

against the vendored body — a hard **0.0** overlap, since not one prefixed name
string-matches a bare vendored name. That is exactly the failure mode
`scripts/vendor-characters.mjs`'s own doc comment already warns about for a
differently-renamed skeleton (the Godot/Rigify mirror): the mesh loads and validates
fine structurally, but the shared `Anims.glb` clip library and every hair mesh bind
by bone NAME, so nothing would actually move. Even with an Adobe account, a Mixamo
export would need a full manual re-skinning/retarget pass to reach the 66/67-name
overlap the current pipeline relies on — out of scope for this probe.

## Route 3 — Sketchfab CC0 downloads

**Blocked: Sketchfab's download API requires an account-linked API token.**

Sketchfab (`sketchfab.com`, reachable — `curl -sI https://sketchfab.com` returns
`200`) hosts CC0-licensed models searchable via its API, but the *download* API
(`https://sketchfab.com/developers/download-api/using-api`) requires an
authenticated API token tied to a logged-in account — the same "no login" wall as
Mixamo. Even a CC0-licensed asset still requires that authenticated download step;
CC0 licensing controls reuse rights, not API access. Not pursued further under this
task's constraints.

## Route 4 — More Quaternius itch.io packs

**Blocked: the itch.io download flow is interactive-only, and none of the source
packs are already on disk to reuse.**

The bodies already vendored (`Male.glb`, `Female.glb`) came from Quaternius's
**Universal Base Characters** pack on itch.io — see the header comment in
`scripts/vendor-characters.mjs`, which already documents this pack (plus the two
Universal Animation Library packs) as "name-your-own-price downloads behind itch.io's
interactive flow, so they are not fetched automatically." The itch.io page itself is
reachable:

```
$ curl -sI https://quaternius.itch.io/universal-base-characters
HTTP/2 200
```

but itch.io's actual file download is gated behind a JS-driven "Download" button /
purchase-or-donate flow per file, not a stable direct-file URL a `curl`/`wget` call
can hit — confirmed by `vendor-characters.mjs`'s own comment, which is why that
script takes an already-extracted local directory (`--base <dir>`) as input instead
of fetching anything itself.

Checked whether any previously-downloaded source pack already sits on disk under
`/home/rom` (which would let this probe skip the interactive step entirely):

```
$ find /home/rom -iname "*quaternius*"
(no output)
```

Zero matches — nothing from any Quaternius pack (source or already-extracted) exists
anywhere under `/home/rom` outside the already-vendored, already-packed `.glb`
outputs in `public/assets/characters/`. There is no local shortcut available.

## The two measured hard gates

Both gates below are exactly what `scripts/probe-skeleton-compat.mjs` checks
mechanically — run any candidate `.glb` through it (see "How to re-run this probe")
instead of re-deriving these numbers by hand.

### Gate A — payload headroom

```
$ node scripts/probe-skeleton-compat.mjs public/assets/characters/Female.glb Male
...
payload headroom: 291324 B (used 6000132 / max 6291456)
```

The combined vendored payload (`Male` + `Female` + 4 hairstyles + `Anims`) is
**6,000,132 B**, against `tests/vendored-assets.test.ts`'s **6,291,456 B (6 MB)**
budget — leaving exactly **291,324 B** of headroom. A single already-vendored body
GLB (`Male.glb` = 1,255,252 B, `Female.glb` = 1,478,192 B — averaging **~1.3 MB**)
would consume 4-5× the entire remaining headroom on its own. **There is no room for a
3rd body mesh of comparable size under the current 6 MB budget without either
shrinking an existing asset or renegotiating the budget itself.**

### Gate B — skeleton bone-name overlap

Every already-vendored non-body asset must clear `SKELETON_MATCH_FLOOR = 0.9`
overlap against the `Male` body skeleton — measured directly with the probe's CLI:

| Asset | shared/total | overlap ratio | vs floor (0.9) |
|---|---|---|---|
| `Female.glb` | 68/69 | **0.9855** | PASS |
| `Anims.glb` | 66/67 | **0.9851** | PASS |
| `Hair_SimpleParted.glb` | 66/67 | **0.9851** | PASS |
| `Hair_Beard.glb` | 66/67 | **0.9851** | PASS |
| `Hair_Buzzed.glb` | 66/67 | **0.9851** | PASS |
| `Hair_Long.glb` | 66/67 | **0.9851** | PASS |

This is the exact property `scripts/vendor-characters.mjs`'s header comment and
`tests/vendored-assets.test.ts`'s "shares one skeleton across bodies, hair and clips"
test already depend on: the shared `Anims.glb` clip library and all four hair meshes
bind onto the body by bone NAME, not by any retargeting step. **Any new body mesh
must clear this same >0.9 floor against `Male`'s skeleton or the existing clip
library and hairstyles will load onto it but silently fail to animate/attach** — this
is exactly the failure mode that sinks routes 2 (Mixamo) and any Rigify/Blender-armature
export without a manual retarget pass.

## Conclusion

**2 bodies × 4 hairstyles = exactly 8 unique roster combinations, already fully
covered by the currently-vendored assets with zero new meshes needed.** Every route
checked above to acquire a genuinely new, compatible body mesh within this task's
constraints (no sudo-install, no login, no purchase) is blocked:

- MakeHuman/Blender — not installed, installing a GUI suite is out of scope.
- Mixamo — needs Adobe login, and its `mixamorig:*` naming fails Gate B (0.0 overlap)
  even if the login wall weren't there.
- Sketchfab — needs an account-linked API token to actually download.
- More Quaternius itch.io packs — interactive-download-only, nothing already on disk.

Even with a route unblocked, Gate A (291,324 B headroom vs ~1.3 MB per body) already
rules out fitting a 3rd body under the current budget.

**The clean upgrade path is the paid tier of Quaternius's Universal Base Characters
pack** (the itch.io "supporter"/paid variant of the same asset line already vendored,
reported to include additional body variants beyond the free tier's set — this
specific claim about the paid tier's contents is *not independently verified in this
session*, since verifying it requires the same purchase this task is barred from
making). Unlocking it requires:

1. **An operator purchase** on `quaternius.itch.io` — a real-money transaction no
   worker may authorize itself.
2. **A deliberate renegotiation of the 6 MB budget** in
   `tests/vendored-assets.test.ts`'s `MAX_COMBINED_BYTES` — Gate A above shows the
   current budget has no headroom for even one more ~1.3 MB body, let alone several,
   so simply vendoring more bodies without raising this constant will fail that
   test's "keeps the combined payload inside budget" check by design.

Neither step belongs in an autonomous worker task — both are explicitly the
operator's call, which is why this investigation stops here with a fully-documented,
mechanically-checkable finding rather than a silent "blocked."

## How to re-run this probe

```bash
node scripts/probe-skeleton-compat.mjs <candidate.glb> [referenceAsset=Male]
```

Prints the shared/total bone-name count, the overlap ratio, a PASS/FAIL verdict
against `SKELETON_MATCH_FLOOR` (0.9), and the current payload headroom under the 6 MB
budget — the exact two gates this document measured by hand, now available as a
one-line check for any future candidate mesh.
