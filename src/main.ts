/**
 * Wiring only: source → engine → renderer.
 *
 * Everything interesting lives behind an interface — swap `createReplaySource`
 * for a live-model source and nothing below this file has to change.
 */

import './style.css';

import type { Vector3 } from 'three';
import { FightEngine } from './engine/match';
import type { CombatEvent, PlayerAction, Speaker } from './engine/types';
import { MAX_METER } from './engine/types';
import { ROSTER, profileFor } from './fighters';
import type { FighterId } from './engine/selection';
import { selectMatchup } from './engine/selection';
import type { MatchupSelectionResult } from './engine/selection';
import { simulateTranscript } from './engine/simulate';
import type { SimulateResult } from './engine/simulate';
import { createReplaySource, loadTranscript } from './sources/replay';
import { createLiveSource } from './sources/live';
import type { MatchSource, StreamHandlers } from './sources/types';
import { createBrain } from './brains/index';
import { createAudio, SFX_CUES, type Sfx, type SfxCue } from './render/audio';
import { createFighter, type FighterRig, type PoseName } from './render/fighter';
import { createFx } from './render/fx';
import { createHud } from './render/hud';
import { createSelectScreen } from './render/select';
import { createStage } from './render/scene';

/**
 * `?fast=1` compresses every artificial pause (turn streaming, round intros, the
 * result-card delay) so a full match plays out in a couple of seconds instead of
 * minutes — used by the Playwright end-to-end suite. It changes only timing, never
 * the sequence of events the engine emits.
 */
const QUERY = new URLSearchParams(window.location.search);
const FAST = QUERY.get('fast') === '1';

/**
 * `?hold=1` keeps the *dramatic* pauses — the beat after a K.O., the round
 * transition, the wait before the result card — at full length even under
 * `?fast=1`, which otherwise blinks past them in a tenth of a second.
 *
 * It exists because the K.O. and win/lose tableaux are the two moments this
 * whole file is for, and they were the only two a fast end-to-end run could not
 * observe. It changes no game logic and no event ordering — only how long the
 * renderer lingers on a moment that has already been decided.
 */
const HOLD = QUERY.get('hold') === '1';

/**
 * `?draw=1` forces the real WebGL loop even under `?fast=1`, which otherwise
 * runs the simulation headlessly. Combined with `?hold=1` it gives a fast but
 * fully *watchable* match — the only way to screenshot a K.O. or a win/lose
 * tableau without sitting through a full-length real-time debate (`ROUND_SECONDS`
 * is 99 arcade seconds, and `CLOCK_RATE` stretches that to ~132 real ones).
 */
const DRAW = QUERY.get('draw') === '1';

const ROUND_SECONDS = 99;
/**
 * Arcade seconds, not real ones. At 1.0 the clock outruns the debate and almost
 * every round ends on a judges' decision instead of a knockout.
 */
const CLOCK_RATE = 0.75;
const RECOVERY_MS = FAST && !HOLD ? 30 : 700;
const REPLAY_PACE = FAST ? 0.03 : 1;
const ROUND_INTRO_MS = FAST && !HOLD ? 60 : 1100;
const ROUND_TRANSITION_MS = FAST && !HOLD ? 120 : 2200;
const RESULT_DELAY_MS = FAST && !HOLD ? 150 : 2200;
/** Safety valve: how many full, KO-free passes through a transcript a single
 * match may take before the run loop gives up rather than spin forever. */
const MAX_EXHAUSTED_PASSES = 8;

const STAGES = [
  { file: 'microservices.json', vs: 'CLAUDE vs CODEX', topic: 'should a 3-person team use microservices?' },
  { file: 'tabs-vs-spaces.json', vs: 'GEMINI vs LOCAL 7B', topic: 'tabs or spaces' }
];

/**
 * Live Mode: same names/topic `cli/fight.ts` defaults to with no flags, so a browser
 * live match and `npm run fight` demonstrate the identical matchup out of the box.
 * Both brains are always the deterministic `local` one (see `brains/local.ts`) — a
 * real `OPENROUTER_API_KEY` is a server-side secret (`brains/openrouter.ts` reads it
 * from `process.env`, the CLI/server's Node process); a browser bundle served to
 * every visitor is never a safe place to hold or forward that key, so this UI never
 * offers an "openrouter" brain choice. This mirrors the CLI's own default (`--brain`
 * defaults to `"local"` unless a caller explicitly opts into `--brain openrouter`),
 * so "no key configured" behaves identically in both places without any key-sniffing
 * logic here.
 */
const LIVE_NAMES = { p1: 'CLAUDE', p2: 'CODEX' };
const LIVE_TOPIC = 'LIVE MODE: WHICH MODEL ARGUES BETTER';
/** Per-word streaming delay for a live turn, mirroring `replay.ts`'s own CHUNK_MS
 * cadence (scaled by the same `?fast=1` pace) so a live match reads at the same
 * arcade pace as a scripted one instead of a local brain's near-instant reply
 * rendering the whole turn in a single frame. */
const LIVE_CHUNK_MS = FAST ? 2 : 55;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// --- debug bridge ----------------------------------------------------------
//
// A small, deliberately loose window hook the Playwright suite (and anyone
// poking around in devtools) uses to observe and drive a match headlessly,
// without needing to read pixels or race DOM animations.

type Vec3 = [number, number, number];

/** A live read of one fighter's rig — pose plus the bones that prove contact. */
interface RigSnapshot {
  pose: PoseName;
  /** World position of the whole fighter (neutral X plus lunge/knockback). */
  position: Vec3;
  /** The X this fighter recovers back to. */
  neutralX: number;
  /** World position of the striking fist. */
  hand: Vec3;
  /** World position of the chest — a punch's target. */
  chest: Vec3;
  /** World position of the hips; drops toward the floor on a K.O. */
  root: Vec3;
  /** Tallest hip height seen while this fighter was upright, for comparison. */
  standingRootY: number;
  /** Signed knockback displacement, isolated from the step-in lunge. */
  knockback: number;
  /**
   * The rig's current eased "coiled power" read (G21) — 0 at rest, 1 at full
   * super meter or deep in a combo streak, see `updateAggression` below and
   * `setAggression` on `FighterRig`. Exposed so a test can prove the
   * silhouette rim/ground glow actually MOVES between a neutral moment and a
   * high-meter/combo moment in a real match, not just that it was requested.
   */
  aggression: number;
  /** Whether this rig's model is currently rendered (G22) — see `visible()`
   * on `FighterRig`. `false` for a brief window while the body/hair/clip
   * library are still loading; every frame observed AFTER that must never
   * also read `bindPose: true` (see `bindPoseFlashSeen`). */
  visible: boolean;
  /** The objective, animation-independent bind-pose signal (G22) — see
   * `inBindPose()` on `FighterRig`. */
  bindPose: boolean;
}

/**
 * One landed blow, measured. Written when the impact fires and then filled in
 * over the following ~1.6s of frames, so a test can assert on the whole arc of
 * a hit (did it connect, did it knock back, did the camera move, did the
 * defender recover) from a single object instead of racing the render loop.
 */
interface ContactRecord {
  kind: 'hit' | 'counter' | 'super';
  by: Speaker;
  target: Speaker;
  damage: number;
  crit: boolean;
  /** `performance.now()` at the moment the event fired. */
  t: number;
  /** Centre-to-centre X distance between the fighters at the impact frame. */
  gapAtEvent: number;
  /** Closest the two fighters got during the strike. */
  minGap: number;
  /** Closest the attacker's fist got to the defender's chest. */
  minHandChest: number;
  /** Defender X on the last frame *before* the impact. */
  targetXBefore: number;
  /**
   * Were BOTH fighters standing at neutral spacing when this landed?
   *
   * Blows arrive faster than a body can settle — a crit can land while either
   * fighter is still sliding from the blow before it, and a super throws its
   * victim most of the way across the ring. Absolute-spacing claims are only
   * meaningful from a neutral start; this flag is what lets a test say so
   * instead of averaging the two cases together and picking a threshold that
   * means nothing for either.
   */
  atRest: boolean;
  /** Defender X on the first frame at or after impact + 150ms. */
  targetXAt150: number | null;
  /** How long after the impact that sample actually landed, in milliseconds. */
  at150Since: number | null;
  /**
   * The defender's knockback displacement at that same sample.
   *
   * Measured from the knockback component rather than raw world X: under
   * `?fast=1` the defender's own next turn starts ~150ms after it was hit, and
   * its step-in lunge would otherwise cancel out the very shove being measured.
   */
  knockAt150: number | null;
  /** Largest knockback displacement reached during the window. */
  peakKnockback: number;
  /** Milliseconds until the knockback first fell back under 0.1 world units. */
  settledMs: number | null;
  /** Largest camera deviation from its resting position during the window. */
  cameraPeak: number;
  /**
   * The combo streak this blow belonged to when it landed (G14). 1 means
   * "opening blow, no combo in progress"; `hit`/`counter`/`super` events that
   * extend `streakSide`/`streakCount` record the post-extension value here, so
   * a test can correlate a landed blow's on-screen impact with how deep into
   * a combo it was — see `comboScale` below, which is what actually reads
   * this number back to escalate the presentation.
   */
  streak: number;
}

interface DebugBridge {
  /** Every CombatEvent emitted by the current (or most recent) match, in order. */
  events: CombatEvent[];
  /** Flips true the moment a `matchEnd` event fires. */
  matchEnded: boolean;
  /** `performance.now()` of the most recent `matchEnd`, or null. */
  matchEndedAt: number | null;
  /** `performance.now()` of the most recent `ko`, or null. */
  koAt: number | null;
  /** The static roster — colors, taglines, super names, visuals. */
  roster: typeof ROSTER;
  /** The fighter matchup resolved for the current (or most recent) match. */
  selection: MatchupSelectionResult | null;
  /** Live per-side rig state — pose, world position, hand/chest/hip bones. */
  rigs: Record<Speaker, RigSnapshot> | null;
  /** The stage camera's current world position, and the position it rests at. */
  camera: { position: Vec3; rest: Vec3 };
  /** How many times each audio cue has fired this page-load. */
  audio: Record<SfxCue, number>;
  /** Every measured impact of the current (or most recent) match. */
  contacts: ContactRecord[];
  /**
   * Every time the HUD combo counter actually popped, presentation-side, for
   * the current (or most recent) match — distinct from the engine's own
   * `combo` event, which needs the same attacker to land two `continuesThread`
   * hits in a row and never reaches count >= 2 against an alternating-speaker
   * transcript. See `streakSide`/`streakCount` in `handleEvent` (G11).
   */
  presentationCombos: { side: Speaker; count: number }[];
  /**
   * Every damaging blow that actually extended a fighter's combo streak this
   * match (G18) — the chain position it landed at, and the exact attack clip
   * that threw it. Distinct from `contacts`: this only covers blows that ran
   * through `extendStreak` (the same ones the HUD combo counter and the
   * impact-escalation math read), so a blocked hit or a self-damage tick —
   * neither of which is a beat in a combo chain — never shows up here. See
   * the per-streak clip-sequence and chain-reset assertions in
   * e2e/fight-feel.test.ts.
   *
   * `followsSuper` is true for the `hit` event a `super` turn always fires
   * immediately after its own `super` event (see the long comment above
   * `streakSide`, and `turnSuperFired` below) — that `hit` extends the
   * streak an extra notch for the SAME physical strike the super's own event
   * already logged, so it never got a fresh `attack` pose of its own and
   * must not be held to the position -> clip mapping a genuinely new strike
   * would be.
   */
  comboChain: { side: Speaker; position: number; clip: string | null; followsSuper: boolean }[];
  /** Runs a bundled transcript through the engine with no rendering, no timers
   * and no player input — the fastest way to inspect a deterministic outcome. */
  simulate(file: string): Promise<SimulateResult>;
  /**
   * Counts every `THREE.Sprite` currently in the arena scene graph (G13). The
   * fighters used to each own a screen-space billboard sprite that floated
   * above their head — this stayed at 0 once it was removed, which is what
   * `e2e/fight-feel.test.ts` asserts against a live match instead of hoping
   * nothing re-introduces a head-occluding sprite later.
   */
  spriteCount(): number;
  /**
   * Every vendored animation clip NAME that has actually played on either
   * fighter this page-load — union of both rigs' `playedClips()` (G17). A
   * clip that's vendored but never triggered isn't a move, it's dead weight;
   * see the "distinct clips" assertion in e2e/fight-feel.test.ts.
   */
  playedClips(): string[];
  /**
   * Every abstract `PoseName` actually observed live on `side` — i.e. read
   * back from `rig.currentPose()` inside a REAL rendered frame (`stage.
   * onFrame`), not merely requested via `setPose()` (G20a). This is the
   * measured half of "a pose actually goes live": a pose set from an event
   * handler and crossfaded away before a frame ever paints it (the
   * same-synchronous-batch trap `comboBreakVictim`/`jumpSide` in this file
   * exist to avoid) would never show up here even though `setPose` was
   * called. See the jump assertion in e2e/fight-feel.test.ts.
   */
  posesSeen(side: Speaker): string[];
  /**
   * `true` if, on ANY real rendered frame (`stage.onFrame`, same accounting
   * as `posesSeen`) since the current match started, `side`'s rig was both
   * `visible` and `inBindPose` at once — i.e. the arms-out bind/T-pose the
   * critic caught actually painted a frame (G22). Accumulated inside the
   * app's own frame loop rather than polled from outside: an external
   * `page.evaluate` poll runs at whatever cadence the test script asks for
   * and can miss a single-frame flash entirely, but nothing rendered by this
   * loop ever skips this check. Reset every time a fresh match — and so a
   * fresh pair of rigs — starts (see where `posesSeen` is cleared).
   */
  bindPoseFlashSeen(side: Speaker): boolean;
}

declare global {
  interface Window {
    __pf: DebugBridge;
  }
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = createStage(canvas);
const fx = createFx(stage, document.getElementById('fx-layer')!);
const hud = createHud();

// Every cue is counted on the way through, so an end-to-end run can assert that
// each event type actually made a sound — the one property of the audio layer a
// headless browser can check.
const audioCounts = Object.fromEntries(SFX_CUES.map((cue) => [cue, 0])) as Record<SfxCue, number>;
const sfx: Sfx = (() => {
  const real = createAudio();
  const counted = {} as Sfx;
  for (const cue of SFX_CUES) {
    counted[cue] = () => {
      audioCounts[cue] += 1;
      try {
        real[cue]();
      } catch {
        // No AudioContext (headless, or before the first gesture) must never
        // take the match down with it.
      }
    };
  }
  return counted;
})();

window.__pf = {
  events: [],
  matchEnded: false,
  matchEndedAt: null,
  koAt: null,
  roster: ROSTER,
  selection: null,
  rigs: null,
  camera: { position: [0, 0, 0], rest: stage.cameraRest.toArray() as Vec3 },
  audio: audioCounts,
  contacts: [],
  presentationCombos: [],
  comboChain: [],
  async simulate(file) {
    const transcript = await loadTranscript(`${import.meta.env.BASE_URL}transcripts/${file}`);
    return simulateTranscript(transcript);
  },
  spriteCount() {
    let count = 0;
    stage.scene.traverse((object) => {
      if ((object as { isSprite?: boolean }).isSprite) count += 1;
    });
    return count;
  },
  playedClips() {
    if (!rigs) return [];
    return [...new Set([...rigs.p1.playedClips(), ...rigs.p2.playedClips()])];
  },
  posesSeen(side) {
    return [...posesSeen[side]];
  },
  bindPoseFlashSeen(side) {
    return bindPoseFlash[side];
  }
};

const titleOverlay = document.getElementById('title')!;
const resultOverlay = document.getElementById('result')!;
const resultTitle = document.getElementById('result-title')!;
const resultSub = document.getElementById('result-sub')!;

// The character-select screen is built once at startup and lives for the whole
// session — picking a card only records the player's override, it never rebuilds
// the grid or blocks on a match starting.
let playerCardOverride: FighterId | null = null;
const selectScreen = createSelectScreen(document.getElementById('select-grid')!, {
  onPick(name) {
    playerCardOverride = name;
  }
});

let rigs: Record<Speaker, FighterRig> | null = null;
let engine: FightEngine | null = null;
let source: MatchSource | null = null;
let roundJustEnded = false;
let fighting = false;
let roundClock = ROUND_SECONDS;

/**
 * Set by `case 'comboBreak'` below, consumed (and cleared) by the very next
 * `onTurnEnd`'s recovery beat — see the long comment on `comboBreak` for why
 * `dodge` is applied there instead of inline.
 */
let comboBreakVictim: Speaker | null = null;

/**
 * Set by `case 'attack'` below whenever this turn's move is `GRAPPLE`-kind
 * (G20a — `isQuestion` in the analyzer, "TURNED THE QUESTION"), consumed (and
 * cleared) by the very next `onTurnEnd`'s recovery beat — same deferred slot
 * `comboBreakVictim`/`dodge` above already use, and for the same reason: a
 * GRAPPLE that gets FACT_STRIKE-countered (its tags can still include `hedge`
 * even though its kind is GRAPPLE, not HEAVY) fires a `counter` event THIS
 * SAME turn that re-poses its target — this turn's attacker — to `hurtHeavy`
 * (see `case 'counter'`). A `jump` set inline from `case 'attack'` would be
 * crossfaded over before a frame ever rendered it, the exact trap documented
 * on `comboBreakVictim` below. Always the ATTACKER's own side (`event.by`),
 * which is structurally disjoint from `comboBreakVictim` (always the
 * attacker's OPPONENT) — the two flags can never collide on the same side in
 * the same turn.
 */
let jumpSide: Speaker | null = null;

/** Hip heights seen while each fighter was upright — the K.O. drop is measured against these. */
const standingRootY: Record<Speaker, number> = { p1: 0, p2: 0 };
/** See `posesSeen` on `DebugBridge` (G20a). */
const posesSeen: Record<Speaker, Set<PoseName>> = { p1: new Set(), p2: new Set() };
/** See `bindPoseFlashSeen` on `DebugBridge` (G22). */
const bindPoseFlash: Record<Speaker, boolean> = { p1: false, p2: false };
/** Impacts still being measured; each is dropped once its window closes. */
const openContacts: { record: ContactRecord; deadline: number }[] = [];

const UPRIGHT_POSES: ReadonlySet<PoseName> = new Set<PoseName>(['idle', 'windup', 'guard', 'attack']);
/** How long after an impact the bridge keeps measuring it, in milliseconds. */
const CONTACT_WINDOW_MS = 1600;
/**
 * How long after an impact `cameraPeak` keeps tracking it, in milliseconds
 * (G14). Deliberately much shorter than `CONTACT_WINDOW_MS`: shake and zoom
 * decay with a ~100ms half-life (`SHAKE_HALF_LIFE_S`/`ZOOM_HALF_LIFE_S` in
 * `scene.ts`), so by 500ms a blow's own contribution is gone. Under `?fast=1`
 * blows land every ~150-450ms — well inside the full 1600ms contact window —
 * so tracking `cameraPeak` for that whole window meant an early, small hit's
 * record stayed open long enough to pick up a LATER, unrelated hit's much
 * bigger shake and report it as its own: two hits three streak-levels apart
 * would show the same "peak" simply because they were both open when a third,
 * bigger blow landed nearby. That made per-blow escalation unmeasurable, which
 * is what `e2e/fight-feel.test.ts`'s "impact escalates with a running combo"
 * spec caught. Scoping the window this way is what makes `cameraPeak` mean
 * "how big did THIS impact's own shake get" again, matching its own doc
 * comment on `ContactRecord`.
 *
 * 220ms is not about catching a peak mid-oscillation — `stage.shakeIntensity()`
 * (see `Stage`) reads the shake/zoom envelope directly, set synchronously the
 * instant `shake()`/`zoomPunch()` are called, so a single rendered frame after
 * the event already reads close to the true value. It just needs to be wide
 * enough to guarantee at least one frame renders inside it even under load,
 * while staying well under the ~150ms fastest gap between blows so a later
 * hit's bigger request can't bleed backward into an earlier one's window.
 */
const CAMERA_PEAK_WINDOW_MS = 220;

function snapshot(side: Speaker): RigSnapshot {
  const rig = rigs![side];
  return {
    pose: rig.currentPose(),
    position: rig.worldPosition().toArray() as Vec3,
    neutralX: rig.neutralX(),
    hand: rig.handPosition().toArray() as Vec3,
    chest: rig.chestPosition().toArray() as Vec3,
    root: rig.rootPosition().toArray() as Vec3,
    standingRootY: standingRootY[side],
    knockback: rig.knockbackOffset(),
    aggression: rig.aggression(),
    visible: rig.visible(),
    bindPose: rig.inBindPose()
  };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

stage.onFrame((dt, elapsed, real) => {
  if (rigs) {
    rigs.p1.update(dt, elapsed, real);
    rigs.p2.update(dt, elapsed, real);
  }
  fx.update(dt);

  if (rigs) {
    const live = { p1: snapshot('p1'), p2: snapshot('p2') };
    for (const side of ['p1', 'p2'] as const) {
      if (UPRIGHT_POSES.has(live[side].pose)) {
        standingRootY[side] = Math.max(standingRootY[side], live[side].root[1]);
        live[side].standingRootY = standingRootY[side];
      }
      // G20a: records a pose only once a real frame has actually painted it —
      // see `posesSeen` on `DebugBridge`.
      posesSeen[side].add(live[side].pose);
      // G22: latches true the moment a real rendered frame shows the model
      // both visible and in its bind pose — see `bindPoseFlashSeen`.
      if (live[side].visible && live[side].bindPose) bindPoseFlash[side] = true;
    }
    window.__pf.rigs = live;
    const camera = stage.camera.position;
    window.__pf.camera.position = [camera.x, camera.y, camera.z];

    // Fill in every impact still inside its measurement window.
    const now = performance.now();
    const gap = Math.abs(live.p1.position[0] - live.p2.position[0]);
    // `stage.shakeIntensity()` reads the shake/zoom envelope directly rather
    // than sampling the jittered, oscillating `camera.position` — see G14 on
    // `Stage.shakeIntensity` for why the raw position was frame-rate-luck
    // sensitive under real contention.
    const shakeIntensity = stage.shakeIntensity();
    for (let i = openContacts.length - 1; i >= 0; i -= 1) {
      const open = openContacts[i]!;
      const record = open.record;
      const attacker = live[record.by];
      const target = live[record.target];
      const since = now - record.t;

      record.minGap = Math.min(record.minGap, gap);
      record.minHandChest = Math.min(record.minHandChest, distance(attacker.hand, target.chest));
      if (since <= CAMERA_PEAK_WINDOW_MS) {
        record.cameraPeak = Math.max(record.cameraPeak, shakeIntensity);
      }

      const shoved = Math.abs(target.knockback);
      record.peakKnockback = Math.max(record.peakKnockback, shoved);
      if (record.targetXAt150 === null && since >= 150) {
        record.targetXAt150 = target.position[0];
        record.at150Since = since;
        record.knockAt150 = shoved;
      }
      if (record.settledMs === null && since >= 150 && shoved < 0.1) record.settledMs = since;

      if (now >= open.deadline) openContacts.splice(i, 1);
    }
    lastFrameX = { p1: live.p1.position[0], p2: live.p2.position[0] };
  }

  if (fighting && engine && !engine.matchOver) {
    roundClock = Math.max(0, roundClock - dt * CLOCK_RATE);
    hud.setTimer(roundClock);
    if (roundClock === 0 && !roundJustEnded) engine.endRoundOnTime();
  }
});

/** Fighter X positions as of the previous frame — the "before the hit" reading. */
let lastFrameX: Record<Speaker, number> = { p1: 0, p2: 0 };

/**
 * Starts measuring one landed blow, and returns the world point where it
 * connected: on the defender's chest, biased toward the attacker's fist.
 */
function beginContact(
  kind: ContactRecord['kind'],
  by: Speaker,
  target: Speaker,
  damage: number,
  crit: boolean,
  streak: number
): Vector3 {
  const attacker = rigs![by];
  const defender = rigs![target];
  const chest = defender.chestPosition();
  const point = chest.clone().lerp(attacker.handPosition(), CONTACT_BIAS);

  const record: ContactRecord = {
    kind,
    by,
    target,
    damage,
    crit,
    t: performance.now(),
    gapAtEvent: Math.abs(attacker.worldPosition().x - defender.worldPosition().x),
    minGap: Infinity,
    minHandChest: Infinity,
    targetXBefore: lastFrameX[target],
    atRest:
      Math.abs(defender.knockbackOffset()) < 0.1 && Math.abs(attacker.knockbackOffset()) < 0.1,
    targetXAt150: null,
    at150Since: null,
    knockAt150: null,
    peakKnockback: 0,
    settledMs: null,
    cameraPeak: 0,
    streak
  };
  window.__pf.contacts.push(record);
  openContacts.push({ record, deadline: record.t + CONTACT_WINDOW_MS });
  return point;
}
// The arena render loop is pure spectacle — no game-logic path reads back from
// it. `?fast=1` still skips the WebGL *draw* (racing a real frame budget under
// a software rasteriser is what the fast path exists to avoid) but now runs the
// same simulation step on a timer, so knockback, hit-stop, shake and the bone
// positions the debug bridge reports are all live in an end-to-end run.
if (FAST && !DRAW) stage.startSimulation();
else stage.start();

// --- stage picker --------------------------------------------------------

const picker = document.getElementById('stage-picker')!;
for (const entry of STAGES) {
  const card = document.createElement('button');
  card.className = 'stage-card';
  card.innerHTML = `<span class="vs">${entry.vs}</span><span class="topic">${entry.topic}</span>`;
  card.addEventListener('click', () => void startMatch(entry.file));
  picker.appendChild(card);
}

// Live Mode entry point — a real fighter brain plays both sides automatically
// instead of replaying a bundled transcript. Visually distinct from (and placed
// apart from) the `.stage-card` grid above: those pick a *scripted* fight, this
// starts a *live* one.
document.getElementById('live-mode-btn')!.addEventListener('click', () => void startLiveMatch());

document.getElementById('rematch')!.addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  titleOverlay.classList.remove('hidden');
  selectScreen.highlight(null, null);
});

// --- match lifecycle -----------------------------------------------------

async function startMatch(file: string): Promise<void> {
  const transcript = await loadTranscript(`${import.meta.env.BASE_URL}transcripts/${file}`);
  const replaySource = createReplaySource(transcript, { pace: REPLAY_PACE });

  // Transcript name first, deterministic hash otherwise (selectFighter's own
  // rule) — with the player's chosen character-select card, if any, overriding
  // which fighter p1 resolves to. p2 always follows the transcript.
  await beginMatch(replaySource, {
    topic: transcript.topic,
    names: { p1: transcript.p1, p2: transcript.p2 },
    p1TranscriptFighter: playerCardOverride ?? transcript.p1
  });
}

/**
 * Live Mode: the same `MatchSource` seam a replay uses, just driven by two
 * `FighterBrain`s (`brains/local.ts`, deterministic — see the doc comment on
 * `LIVE_NAMES` for why this UI never offers the `openrouter` brain) instead of a
 * bundled transcript. `beginMatch` below cannot tell the two sources apart — this
 * is the entire point of the `MatchSource` interface (`sources/types.ts`) — so a
 * live match gets the exact same round/HUD/renderer pipeline a scripted one does,
 * with zero duplicated wiring.
 */
async function startLiveMatch(): Promise<void> {
  const brains = { p1: createBrain('local'), p2: createBrain('local') };
  const liveSource = createLiveSource(LIVE_TOPIC, LIVE_NAMES, brains, { chunkMs: LIVE_CHUNK_MS });

  await beginMatch(liveSource, {
    topic: LIVE_TOPIC,
    names: LIVE_NAMES,
    p1TranscriptFighter: playerCardOverride ?? LIVE_NAMES.p1
  });
}

interface BeginMatchOptions {
  topic: string;
  names: { p1: string; p2: string };
  /** What `selectFighter` treats as the transcript-side override for p1 — a real
   * bundled transcript's own `p1` name, or (for live mode) the player's chosen
   * character-select card, falling back to `LIVE_NAMES.p1`. p2 always follows
   * `names.p2` directly, matching `startMatch`'s pre-existing asymmetric rule. */
  p1TranscriptFighter: string;
}

/** Shared match bring-up: resolves the fighter matchup, resets every debug-bridge
 * and presentation counter, builds the two rigs, and starts `runLoop` against
 * whichever `MatchSource` the caller built (`createReplaySource` or
 * `createLiveSource`) — the one thing a replay and a live match do differently. */
async function beginMatch(matchSource: MatchSource, options: BeginMatchOptions): Promise<void> {
  source?.stop();

  const { topic, names, p1TranscriptFighter } = options;
  const matchup = selectMatchup(
    { modelName: names.p1, transcriptFighter: p1TranscriptFighter },
    { modelName: names.p2, transcriptFighter: names.p2 }
  );
  window.__pf.selection = matchup;
  window.__pf.events = [];
  window.__pf.matchEnded = false;
  window.__pf.matchEndedAt = null;
  window.__pf.koAt = null;
  window.__pf.contacts = [];
  window.__pf.presentationCombos = [];
  window.__pf.comboChain = [];
  openContacts.length = 0;
  standingRootY.p1 = 0;
  standingRootY.p2 = 0;
  posesSeen.p1.clear();
  posesSeen.p2.clear();
  bindPoseFlash.p1 = false;
  bindPoseFlash.p2 = false;
  turnAttacker = null;
  turnSuperFired = null;
  resetStreak();

  const p1 = profileFor(matchup.p1.fighter);
  const p2 = profileFor(matchup.p2.fighter);

  if (rigs) {
    rigs.p1.group.removeFromParent();
    rigs.p2.group.removeFromParent();
  }
  rigs = { p1: createFighter(p1, -1), p2: createFighter(p2, 1) };
  stage.add(rigs.p1.group);
  stage.add(rigs.p2.group);
  stage.setFighterColors(p1.color, p2.color);

  engine = new FightEngine('p1', matchup.p1.fighter, matchup.p2.fighter);
  engine.on(handleEvent);

  hud.setFighters(p1, p2);
  hud.setHealth('p1', 100);
  hud.setHealth('p2', 100);
  hud.setMeter('p1', 0);
  hud.setMeter('p2', 0);
  hud.setRound(1);
  hud.subtitle(topic, '#ffd166', '');
  hud.show();

  selectScreen.highlight(matchup.p1.fighter, matchup.p2.fighter);

  titleOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');

  source = matchSource;
  roundClock = ROUND_SECONDS;
  roundJustEnded = false;
  fighting = true;

  sfx.bell();
  hud.announce('ROUND 1');
  await sleep(ROUND_INTRO_MS);
  hud.announce('FIGHT!');

  void runLoop();
}

const handlers: StreamHandlers = {
  onTurnStart(speaker) {
    if (!rigs) return;
    rigs[speaker].setPose('windup');
    hud.openActionWindow();
  },

  onTurnChunk(speaker, textSoFar) {
    if (!rigs || !engine) return;
    rigs[speaker].setCharge(Math.min(1, textSoFar.split(' ').length / 45));
    hud.subtitle(engine.state[speaker].name, colorOf(speaker), textSoFar);
  },

  onTurnEnd(speaker, fullText) {
    if (!rigs || !engine) return;
    const action: PlayerAction = hud.closeActionWindow();
    engine.setPlayerAction(action);
    rigs[speaker].setCharge(0);
    engine.completeTurn(speaker, fullText);
    // Captured into a local NOW, not read from inside the timeout below: a
    // turn's own synchronous event batch (including any `comboBreak` above)
    // has already fully run by this point in `onTurnEnd`, but the next
    // turn's `onTurnStart`/`onTurnEnd` can fire before THIS turn's
    // `RECOVERY_MS` timeout does (turns don't wait on each other's recovery
    // timer) — reading the shared variable from inside the closure would
    // risk applying a stale or a too-early victim from whichever turn
    // happens to run first. A per-call local has no such race.
    const dodgeSide = comboBreakVictim;
    comboBreakVictim = null;
    // See the long comment on `jumpSide` above for why this is captured and
    // cleared here, the same way `dodgeSide` is.
    const jumpingSide = jumpSide;
    jumpSide = null;

    setTimeout(() => {
      if (!engine || engine.matchOver || !rigs) return;
      // Return to the guard — but NEVER out of a knockdown or a victory pose.
      // This reset used to be guarded only by `matchOver`, so a round-ending
      // K.O. (which is not match-over) had its death animation wiped ~700ms
      // later and the loser stood back up mid-count. `ko` and `win` are held
      // until the next round explicitly clears them.
      for (const side of ['p1', 'p2'] as const) {
        if (TERMINAL_POSES.has(rigs[side].currentPose())) continue;
        // G17: a fighter whose opponent's combo broke THIS turn ducks/leans
        // instead of going straight back to idle — see `case 'comboBreak'`.
        // G20a: a fighter who threw a GRAPPLE this turn hops clear instead —
        // see `jumpSide`. `dodgeSide` and `jumpingSide` can never name the
        // same side in the same turn (see `jumpSide`'s doc comment), so this
        // is never ambiguous.
        const pose = side === dodgeSide ? 'dodge' : side === jumpingSide ? 'jump' : 'idle';
        rigs[side].setPose(pose);
      }
    }, RECOVERY_MS);
  }
};

async function runLoop(): Promise<void> {
  // Safety valve: a transcript that never produces a KO would otherwise reset
  // and replay forever, chasing a round win that never comes. Each full,
  // KO-free pass through the transcript counts against this budget.
  let exhaustedPasses = 0;

  while (engine && !engine.matchOver) {
    if (roundJustEnded) {
      roundJustEnded = false;
      await sleep(ROUND_TRANSITION_MS);
      source?.reset();
      roundClock = ROUND_SECONDS;
      syncBars();
      hud.setRound(engine.state.round);
      hud.announce(`ROUND ${engine.state.round}`);
      sfx.bell();
      await sleep(ROUND_INTRO_MS);
      hud.announce('FIGHT!');
      // Back to your corners: a fighter dropped at the end of the last round
      // must be upright and back at neutral spacing before the next one starts,
      // or the whole round is fought from wherever the K.O. left them.
      for (const side of ['p1', 'p2'] as const) {
        rigs?.[side].resetStance();
        rigs?.[side].setPose('idle');
      }
      continue;
    }

    const more = await source?.nextTurn(handlers);
    if (!more) {
      exhaustedPasses += 1;
      if (exhaustedPasses > MAX_EXHAUSTED_PASSES) break;
      if (!roundJustEnded && engine && !engine.matchOver) {
        // Transcript exhausted with both fighters still standing: call it on credibility.
        engine.endRoundOnTime();
      }
    }
  }
  fighting = false;
}

// --- event → spectacle ---------------------------------------------------

function colorOf(side: Speaker): string {
  if (!engine) return '#ffffff';
  const profile = profileFor(engine.state[side].name);
  return `#${profile.color.toString(16).padStart(6, '0')}`;
}

function syncBars(): void {
  if (!engine) return;
  hud.setHealth('p1', engine.state.p1.credibility);
  hud.setHealth('p2', engine.state.p2.credibility);
  hud.setMeter('p1', engine.state.p1.meter);
  hud.setMeter('p2', engine.state.p2.meter);
}

/**
 * Poses that own the fighter until the match state itself changes. Nothing on
 * the recovery path may overwrite them — a fighter that stands back up out of
 * its own death animation is the single most immersion-breaking thing the
 * renderer can do.
 */
const TERMINAL_POSES: ReadonlySet<PoseName> = new Set<PoseName>(['ko', 'win']);

/**
 * How far the contact point is pulled off the defender's chest toward the
 * attacker's fist. 0 puts the burst inside the body, 1 puts it on the glove;
 * a third of the way out reads as the moment of connection.
 */
const CONTACT_BIAS = 0.35;

/** Baseline shove a landed blow imparts, before damage scaling, in world units. */
const KNOCKBACK_BASE = 0.45;
/** Extra shove per point of damage. */
const KNOCKBACK_PER_DAMAGE = 0.022;
/** Multiplier applied to a critical hit's shove. */
const KNOCKBACK_CRIT = 1.6;

/** How far a fighter steps in on its own strike (0-1, scaled in the rig). */
const LUNGE_STRENGTH = 1;

/**
 * Presentation-side combo tracking (G11).
 *
 * The engine's own `combo` event needs the SAME attacker to land two
 * `continuesThread` hits in consecutive turns — but every bundled transcript
 * alternates speakers, so the attacker always changes turn to turn and that
 * count never exceeds 1. It is not a bug in the counter, it is a trigger that
 * cannot fire against this content, and it is left untouched (HARD
 * CONSTRAINT: `src/engine/` and its own `combo` event are out of scope).
 *
 * Loop 2 keyed the HUD counter off "2+ `hit` events landed in a single turn",
 * which only happens when a super also carries a `drain` effect — i.e. only
 * GEMINI's kit. That is one ability's shape, not a combo.
 *
 * What a fighting-game HUD actually means by "combo" is a STREAK: how many
 * damaging blows the same fighter has landed in a row, whether they came from
 * one flashy turn (a super plus its own drain, still two `hit` events against
 * the same defender) or from several ordinary turns in which the other side
 * kept whiffing or getting blocked. Tracking it that way subsumes Loop 2's
 * same-turn rule for free — a super+drain turn is still two consecutive
 * same-attacker hits — while also firing in matchups that never throw a
 * multi-hit turn at all.
 *
 * A landed `super` counts toward the streak on its OWN event, in addition to
 * the `hit`/`blocked` event that follows it for the actual credibility change
 * (see the `super` case below). That is not double-counting one blow: a super
 * already renders as two distinct connect beats on screen — its own named-move
 * flourish (hitstop, camera zoom, themed FX) fires first, then a separate
 * impact flash/burst/knockback plays when its damage lands — so counting it
 * as two blows matches what the player actually watches happen, and matches
 * how the critic's reference numbers (max streak 5 for microservices, 3 for
 * tabs-vs-spaces) were measured: consecutive `hit`/`counter`/`super` events
 * with damage > 0 by the same attacker.
 *
 * `blocked` and `whiff` do NOT break the streak. Two reasons: (1) neither
 * hands the other fighter anything — the streak's owner didn't get hit back,
 * they just didn't fully connect, so treating a partial block as equivalent
 * to eating a counter would read as harsher than what actually happened on
 * screen; (2) it keeps this in step with the critic's measurement above,
 * which by construction skips over blocked/whiff turns rather than treating
 * them as interruptions. The streak DOES reset the moment the opponent lands
 * a damaging blow of their own (a clean `hit`, `counter` or `super`), and at
 * every round boundary and match end — a combo does not survive into the next
 * round, let alone the next fight.
 */
let streakSide: Speaker | null = null;
let streakCount = 0;

/**
 * Registers one damaging blow landed by `side`, pops the HUD if it's 2+, and
 * returns the resulting streak count (1 if `damage <= 0` left it unchanged) —
 * every call site uses this return value to scale that same blow's impact
 * presentation via `comboScale` (G14), so the number driving the HUD counter
 * and the number driving the shake/hitstop/flash/particles are the same read,
 * not two counters that can drift apart.
 */
function extendStreak(side: Speaker, damage: number): number {
  if (damage <= 0) return streakCount;
  streakCount = side === streakSide ? streakCount + 1 : 1;
  streakSide = side;
  if (streakCount >= 2) {
    hud.combo(side, streakCount);
    window.__pf.presentationCombos.push({ side, count: streakCount });
  }
  updateAggression(side);
  return streakCount;
}

/** Round boundary or match end: a combo never carries into what comes next. */
function resetStreak(): void {
  streakSide = null;
  streakCount = 0;
  updateAggression('p1');
  updateAggression('p2');
}

/**
 * Last `meter` event value seen per side, 0-1 — the other half (besides combo
 * streak) of the "how dangerous does this fighter currently read" signal fed
 * to `FighterRig.setAggression` (G21).
 */
const meterFraction: Record<Speaker, number> = { p1: 0, p2: 0 };

/**
 * Recomputes and pushes `side`'s aggression to its rig — the higher of its
 * super-meter fill and its live combo-streak fraction (a fighter deep in a
 * combo reads as dangerous even mid-round with an empty meter; a full meter
 * reads as dangerous even between combos — either alone should light the rig
 * up, not just their average). Called on every `meter` event and every combo
 * streak change, so the rig's eased value (see `AGGRESSION_EASE_S` in
 * `fighter.ts`) always chases the true current state of both.
 */
function updateAggression(side: Speaker): void {
  if (!rigs) return;
  const streakFraction = streakSide === side ? Math.min(1, streakCount / COMBO_CAP_STREAK) : 0;
  rigs[side].setAggression(Math.max(meterFraction[side], streakFraction));
}

/**
 * The chain position the NEXT landed blow from `side` would occupy if it
 * connects (G18) — read at the moment an `attack` fires, before its
 * `hit`/`blocked`/`whiff` outcome is known, so the STRIKE itself (not just
 * the reaction after it lands) can be chosen by chain position — see the
 * `case 'attack'` below and `attackClipForPosition` in `fighter.ts`.
 * 1-indexed, same convention as `extendStreak`: the fighter already
 * mid-streak throws the next beat; anyone else (or nobody) opens back at
 * beat 1.
 */
function predictedChainPosition(side: Speaker): number {
  return side === streakSide ? streakCount + 1 : 1;
}

/**
 * How far a landed blow's presentation escalates with `streak` (G14).
 *
 * Streak 1 (the opening blow, or no combo at all) always resolves to exactly
 * 1 — the baseline single-hit feel every earlier loop tuned is untouched. From
 * streak 2 on, the multiplier climbs linearly by `step` per streak level and
 * is clamped at `COMBO_CAP_STREAK`: this is a 20-second demo clip, not an
 * endurance test, so the top of the curve has to stay dramatic rather than
 * become nauseating past a 5-hit run. Crit and streak are independent — this
 * scale multiplies whatever the crit/non-crit base value already is, so a
 * crit that lands at the end of a streak stacks both instead of one replacing
 * the other.
 *
 * Two different `step` values are used at the call sites: a strong one for
 * shake/zoom/flash/particle-count, and a much gentler one for hit-stop, which
 * is the single easiest tool here to overdo — escalating it as hard as the
 * others would turn a 5-streak into a slideshow instead of a beating.
 */
const COMBO_CAP_STREAK = 5;
const COMBO_STEP = 0.5; // shake / zoom-punch / flash / particle count, per streak level
const COMBO_HITSTOP_STEP = 0.08; // hit-stop, per streak level — deliberately much flatter
function comboScale(streak: number, step: number): number {
  const clamped = Math.min(Math.max(streak, 1), COMBO_CAP_STREAK);
  return 1 + (clamped - 1) * step;
}

/**
 * Chain position at which a victim's reaction escalates to `hurtHeavy` on
 * chain position alone (G18), composing with — not replacing — the existing
 * crit/counter/super rule at each call site below: either one being true is
 * enough to earn the heavier reaction. 3 matches `attack`'s own beat mapping
 * in `fighter.ts` (`attackClipForPosition`): the hook is the 3rd-and-beyond
 * beat, so the reaction it provokes is the heaviest one too — a chain's
 * finisher looks and feels like one.
 */
const CHAIN_HEAVY_REACTION_STREAK = 3;

/** The real attacker of the in-flight turn, from its `attack` event — used to
 * tell a `hit` landed on the opponent apart from a self-damage `hit` (e.g. an
 * overreach ability), which the `hit` event alone can't distinguish. */
let turnAttacker: Speaker | null = null;

/**
 * Set by `case 'super'` below, cleared by the next `case 'attack'` (i.e. once
 * per turn). A super turn always fires its own `super` event AND a following
 * `hit`/`blocked` event for the same physical strike — `combat.ts` computes
 * the super's damage once, announces it via `super`, then runs it through the
 * exact same block/counter/shield pipeline every other blow uses, which is
 * where the `hit` actually comes from (see the long comment above
 * `streakSide` in this file for why that's intentional: it's two distinct
 * on-screen beats, the flourish then the impact). Both extend the streak, but
 * only ONE `attack` pose was ever thrown for either of them — this is what
 * lets `case 'hit'` below tell "a genuinely new punch was thrown" apart from
 * "the super I already logged this turn is having its credibility change
 * applied", see `followsSuper` on `DebugBridge.comboChain`.
 */
let turnSuperFired: Speaker | null = null;

const LOUD_LABELS = new Set([
  'CITED EVIDENCE',
  'HONEST CORRECTION',
  'YES, BUT',
  'REPEATING YOURSELF',
  'CONCEDED THE POINT',
  'TURNED THE QUESTION',
  'HEDGING'
]);

function handleEvent(event: CombatEvent): void {
  window.__pf.events.push(event);
  if (!rigs || !engine) return;

  switch (event.type) {
    case 'attack': {
      // Step in on the strike. The fighters used to stand a fixed 5.1 units
      // apart for the whole match, so every punch was thrown into empty air —
      // this, plus the tightened neutral spacing, is what makes a blow connect.
      // The strike is picked by chain position, not a free-running cursor
      // (G18): 1st beat jab, 2nd cross, 3rd-and-beyond hook. `predictedChainPosition`
      // reads the CURRENT streak, before this attack's own outcome is known.
      rigs[event.by].setPose('attack', predictedChainPosition(event.by));
      rigs[event.by].lunge(LUNGE_STRENGTH);
      sfx.whoosh();
      if (LOUD_LABELS.has(event.label)) hud.announce(event.label);
      turnAttacker = event.by;
      // A fresh strike was just thrown — any `super` this new turn fires is
      // its own turn, not a continuation of a previous one.
      turnSuperFired = null;
      // G20a: a GRAPPLE ("TURNED THE QUESTION") earns a jump at THIS turn's
      // recovery beat — see `jumpSide`'s doc comment for why it's deferred
      // rather than applied here.
      if (event.kind === 'GRAPPLE') jumpSide = event.by;
      break;
    }

    case 'hit': {
      const attacker: Speaker = event.target === 'p1' ? 'p2' : 'p1';
      const rig = rigs[event.target];

      // A hit against the attacker itself (self-damage, e.g. an overreach
      // ability) doesn't extend anyone's streak — only blows that actually
      // landed on the opponent do, and only those get the escalation below.
      let streak = 1;
      const extendsChain = event.target !== turnAttacker && turnAttacker !== null && event.damage > 0;
      if (event.target !== turnAttacker && turnAttacker !== null) {
        streak = extendStreak(turnAttacker, event.damage);
      }
      const scale = comboScale(streak, COMBO_STEP);
      const hitstopScale = comboScale(streak, COMBO_HITSTOP_STEP);

      const point = beginContact('hit', attacker, event.target, event.damage, event.crit, streak);
      // G18: log which clip actually threw this beat, at its chain position —
      // only for blows that really extended the chain (see `extendsChain`).
      // `followsSuper` flags the credibility-change `hit` that always
      // follows this turn's own `super` event (see `turnSuperFired`): same
      // physical strike, no fresh `attack` pose, so its clip is expected to
      // equal the super's, not the position -> clip mapping.
      if (extendsChain) {
        window.__pf.comboChain.push({
          side: attacker,
          position: streak,
          clip: rigs[attacker].lastAttackClip(),
          followsSuper: turnSuperFired === attacker
        });
      }

      // A crit OR a deep-enough chain position gets the heavier reaction
      // (G17 for crit; G18 composes chain position on top — see
      // `CHAIN_HEAVY_REACTION_STREAK` — so a combo's finisher reads as hard
      // as a crit even without one).
      const heavyReaction = event.crit || streak >= CHAIN_HEAVY_REACTION_STREAK;
      rig.setPose(event.damage > 0 ? (heavyReaction ? 'hurtHeavy' : 'hurt') : 'idle', streak);
      rig.flash(1);
      rig.knockback(
        (KNOCKBACK_BASE + event.damage * KNOCKBACK_PER_DAMAGE) * (event.crit ? KNOCKBACK_CRIT : 1)
      );

      stage.shake((event.crit ? 0.85 : 0.5) * scale);
      stage.hitstop(Math.round((event.crit ? 160 : 90) * hitstopScale));
      stage.zoomPunch((event.crit ? 0.7 : 0.3) * scale);

      const color = event.crit ? 0xff5470 : 0xffd166;
      fx.impactFlash(point, event.crit ? 0xffffff : color, (event.crit ? 1.1 : 0.7) * scale);
      fx.burst(point, color, Math.round((event.crit ? 170 : 80) * scale), event.crit ? 9 : 6.5, {
        size: (event.crit ? 0.38 : 0.28) * Math.sqrt(scale)
      });
      fx.damageNumber(rig.headPosition(), event.damage, event.crit);
      event.crit ? sfx.crit() : sfx.hit();
      syncBars();

      break;
    }

    case 'blocked': {
      const attacker: Speaker = event.target === 'p1' ? 'p2' : 'p1';
      const rig = rigs[event.target];
      // A block neither extends nor breaks a streak (see the comment above
      // `streakSide`), so it never escalates — it's just recorded against
      // whatever streak was already in progress.
      const point = beginContact('hit', attacker, event.target, event.damage, false, streakCount);
      rig.setPose('guard');
      // A guarded blow still shoves — less than a clean hit, which is what
      // makes blocking read as absorbing something rather than ignoring it.
      rig.knockback(0.42 + event.damage * 0.012);
      stage.shake(0.25);
      stage.hitstop(45);
      fx.impactFlash(point, 0x6ee7ff, 0.6);
      fx.burst(point, 0x6ee7ff, 34, 4, { size: 0.22 });
      fx.damageNumber(rig.headPosition(), event.damage, false);
      sfx.block();
      syncBars();
      break;
    }

    case 'counter': {
      hud.announce('COUNTER!');
      const target: Speaker = event.by === 'p1' ? 'p2' : 'p1';
      rigs[event.by].setPose('attack', predictedChainPosition(event.by));
      rigs[event.by].lunge(LUNGE_STRENGTH);
      const victim = rigs[target];
      // A counter is the defender striking back — it both lands a damaging
      // blow for `event.by` and, per the reset rule above, is exactly the
      // kind of blow that ends the opponent's streak. `extendStreak` handles
      // both: it starts a fresh streak at 1 for `event.by` whenever they
      // aren't already its owner, and this counter's own escalation rides on
      // whatever that call returns.
      const streak = extendStreak(event.by, event.damage);
      const scale = comboScale(streak, COMBO_STEP);
      const hitstopScale = comboScale(streak, COMBO_HITSTOP_STEP);
      const point = beginContact('counter', event.by, target, event.damage, true, streak);
      if (event.damage > 0) {
        window.__pf.comboChain.push({
          side: event.by,
          position: streak,
          clip: rigs[event.by].lastAttackClip(),
          followsSuper: false
        });
      }
      // A counter is always the heavier reaction (G17) — it's already always
      // treated as a crit for damage/FX purposes above.
      victim.setPose('hurtHeavy', streak);
      victim.flash(1.4);
      victim.knockback(0.9 + event.damage * KNOCKBACK_PER_DAMAGE);
      stage.shake(0.95 * scale);
      stage.hitstop(Math.round(190 * hitstopScale));
      stage.zoomPunch(0.85 * scale);
      fx.impactFlash(point, 0xffffff, 1.25 * scale);
      fx.burst(point, 0xffffff, Math.round(150 * scale), 8.5, { size: 0.36 * Math.sqrt(scale) });
      fx.damageNumber(victim.headPosition(), event.damage, true);
      sfx.crit();
      syncBars();
      break;
    }

    case 'whiff': {
      hud.announce('WHIFF');
      sfx.whoosh();
      break;
    }

    case 'combo': {
      if (event.count >= 2) hud.combo(event.by, event.count);
      break;
    }

    case 'comboBreak': {
      // G17: previously unhandled — nothing happened on screen when a
      // fighter's combo broke, even though the engine already fires this
      // every time an argument fails to continue the thread (3x per bundled
      // stage, measured; unlike `whiff`, which the analyzer can never
      // actually produce). The PIVOT action's own hint text already frames
      // breaking a combo as "evade" (`<i>evade · breaks their combo</i>` in
      // index.html), so the OPPONENT — not the fighter whose combo broke —
      // is who gets to play the dodge: reads as them slipping the pattern
      // and disrupting the rhythm, not the attacker's own animation.
      //
      // Recorded here, not applied here: `comboBreak` fires synchronously in
      // the SAME event batch as this turn's `hit`/`blocked` — both target the
      // opponent — and `emitAll` (match.ts) has no gap between events, so a
      // `setPose('dodge')` made right here would be crossfaded over by the
      // very next event before a single frame ever rendered it (verified:
      // two real, headed-GPU screenshot passes never once caught it as the
      // live pose). `onTurnEnd`'s existing post-turn recovery beat — a real
      // `setTimeout`, not a same-tick call — is where it actually gets
      // applied, once the turn's own hit reaction has already had its moment.
      comboBreakVictim = event.by === 'p1' ? 'p2' : 'p1';
      break;
    }

    case 'meter': {
      hud.setMeter(event.who, event.value);
      meterFraction[event.who] = Math.max(0, Math.min(1, event.value / MAX_METER));
      updateAggression(event.who);
      break;
    }

    case 'super': {
      hud.announce(event.name);
      const target: Speaker = event.by === 'p1' ? 'p2' : 'p1';
      const attacker = rigs[event.by];
      const victim = rigs[target];
      attacker.setPose('attack', predictedChainPosition(event.by));
      attacker.lunge(1.25);
      // Marks the `hit` this same turn is about to fire (see `turnSuperFired`'s
      // doc comment) as a continuation of THIS strike, not a fresh one.
      turnSuperFired = event.by;
      // A super is its own landed blow for streak purposes, on top of whatever
      // `hit`/`blocked` event follows it for the actual credibility change —
      // see the comment above `streakSide` for why. Its own escalation rides
      // on the streak this call returns, same as every other landed blow.
      const streak = extendStreak(event.by, event.damage);
      const scale = comboScale(streak, COMBO_STEP);
      const point = beginContact('super', event.by, target, 0, true, streak);
      if (event.damage > 0) {
        window.__pf.comboChain.push({
          side: event.by,
          position: streak,
          clip: attacker.lastAttackClip(),
          followsSuper: false
        });
      }
      // A super is always the heaviest reaction (G17) — it already always
      // knocks back the hardest of any event type below.
      victim.setPose('hurtHeavy', streak);
      victim.flash(1.8);
      victim.knockback(1.4);
      // The named-special FX carry their own themed burst/ring and shake the
      // stage themselves; only fall back to the generic treatment when this
      // super isn't one of the four catalogued moves.
      const spec = fx.special(event.name, point, attacker.handPosition());
      if (!spec) {
        stage.shake(0.95 * scale);
        fx.burst(point, 0xffffff, Math.round(180 * scale), 9, { size: 0.4 * Math.sqrt(scale) });
      }
      fx.impactFlash(point, 0xffffff, 1.6 * scale);
      stage.hitstop(Math.round(300 * comboScale(streak, COMBO_HITSTOP_STEP)));
      stage.zoomPunch(1.1 * scale);
      sfx.crit();
      break;
    }

    case 'ability': {
      const rig = rigs[event.by];
      hud.announce(event.name);
      const spec = fx.special(event.name, rig.chestPosition());
      if (!spec) {
        fx.burst(rig.chestPosition(), 0xffe08a, 70, 5, { size: 0.26 });
        fx.impactFlash(rig.chestPosition(), 0xffe08a, 1.1);
        stage.shake(0.4);
      }
      sfx.hit();
      break;
    }

    case 'ko': {
      const winner: Speaker = event.loser === 'p1' ? 'p2' : 'p1';
      rigs[event.loser].setPose('ko');
      // A knockdown throws the loser clear — the only moment worth a shove this
      // big, and the visual difference between "lost the round" and "got dropped".
      rigs[event.loser].knockback(1.1);
      rigs[winner].setPose('win');
      hud.announce('K.O.');
      window.__pf.koAt = performance.now();
      stage.shake(0.95);
      stage.hitstop(340);
      stage.zoomPunch(1.3);
      fx.impactFlash(rigs[event.loser].chestPosition(), 0xffffff, 1.9);
      fx.burst(rigs[event.loser].chestPosition(), 0xffd166, 200, 10, { size: 0.4, life: 1.1 });
      sfx.ko();
      syncBars();
      break;
    }

    case 'roundEnd': {
      roundJustEnded = true;
      if (event.winner) hud.setRounds(event.winner, engine.state[event.winner].roundsWon);
      // A combo is a property of the fight in progress — the next round starts
      // with nobody having landed anything yet.
      resetStreak();
      break;
    }

    case 'matchEnd': {
      fighting = false;
      source?.stop();
      window.__pf.matchEnded = true;
      window.__pf.matchEndedAt = performance.now();
      resetStreak();

      // The win/lose tableau: the winner celebrates, the loser stays down, and
      // both hold for as long as the result card is up. Nothing clears these —
      // `TERMINAL_POSES` keeps the recovery timer off them and the run loop has
      // already stopped, so this is the last pose either fighter takes.
      const loser: Speaker = event.winner === 'p1' ? 'p2' : 'p1';
      rigs[event.winner].setPose('win');
      rigs[loser].setPose('ko');
      sfx.win();

      const name = engine.state[event.winner].name;
      resultTitle.textContent = event.winner === engine.state.playerSide ? 'YOU WIN' : 'YOU LOSE';
      resultSub.textContent = `${name} took the argument ${engine.state[event.winner].roundsWon}–${
        engine.state[event.winner === 'p1' ? 'p2' : 'p1'].roundsWon
      }`;
      setTimeout(() => resultOverlay.classList.remove('hidden'), RESULT_DELAY_MS);
      break;
    }

    case 'announce': {
      hud.announce(event.text);
      break;
    }
  }
}
