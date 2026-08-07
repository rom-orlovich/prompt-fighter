/**
 * The heart of the game: translate what a model said into what it did.
 *
 * Every branch here corresponds to a row of the mapping table in the design spec.
 * Precedence matters — looping and conceding are checked before length, because
 * *how* you argued outranks *how much* you argued.
 */

import type { AnalyzeContext, MoveIntent, MoveKind, MoveTag } from './types';
import { rawWordCount, similarity } from './text';

const HEDGE =
  /\b(maybe|perhaps|possibly|might|it depends|not sure|could be|arguably|i think|somewhat|tends to|in some cases)\b/gi;
const ASSERT =
  /\b(clearly|obviously|in fact|certainly|definitely|the answer is|always|never|must)\b/gi;
const CONCEDE = /\b(you'?re right|you are right|i agree|good point|fair enough|i concede|granted)\b/i;
const CONTRAST = /\b(but|however|although|still|that said|yet|nonetheless)\b/i;
const SELF_CORRECT = /\b(actually|i was wrong|correction|i misspoke|let me reconsider|on reflection)\b/i;
/**
 * A direct attack on the opponent's reasoning — the message form of the `UNDERCUT`
 * player action's own instruction, "find the flaw in their argument" (§3).
 *
 * Deliberately narrow: only unambiguous rebuttal phrasing, never a bare negation
 * ("no", "that is a myth") that the length-based JAB/STRIKE/HEAVY branches already
 * classify correctly. A rebuttal that also *cites* something still resolves as
 * `CRIT`, because evidence outranks framing everywhere else in this table too.
 */
const UNDERCUT =
  /\b(that'?s (just )?(wrong|false|backwards)|that is (just )?(wrong|false|backwards)|the flaw (in|with)|you'?re (missing|ignoring|overlooking)|you are (missing|ignoring|overlooking)|does ?n'?t hold|does not hold|misses the point|fails to account|overlooks|ignores|contradicts|circular reasoning|begs the question|falls apart)\b/i;

const CODE_FENCE = /```[\s\S]*?```/;
const URL = /https?:\/\/\S+/;
const STAT =
  /\b\d+(\.\d+)?\s?(%|ms|s|x|mb|gb|kb|rps|qps|requests?|users?|lines?|tests?|hours?|minutes?|days?)(?![a-z])/i;
const QUOTED = /["“][^"”]*\d[^"”]*["”]/;

/** Above this self-similarity, the speaker is just repeating themselves. */
const LOOP_THRESHOLD = 0.6;
/** Below this overlap with the opponent's last message, the subject changed. */
const THREAD_THRESHOLD = 0.12;

const JAB_MAX_WORDS = 12;
const STRIKE_MAX_WORDS = 45;

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** Any Unicode letter, Unicode number, or an emoji (`Extended_Pictographic`).
 * A message with none of these is punctuation, whitespace or empty: it said
 * nothing, so it is not an argument at all. Deliberately script-agnostic —
 * the previous Latin/digit/Hebrew-only check silently WHIFFed real content
 * written in Cyrillic, CJK, Arabic, or emoji-only messages. */
const HAS_CONTENT = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

export function analyze(text: string, ctx: AnalyzeContext = {}): MoveIntent {
  const tags: MoveTag[] = [];
  const length = rawWordCount(text);

  // Empty / whitespace-only / punctuation-only input is not an offensive move —
  // without this guard `""` fell through to JAB (power 6) and `"!!! ???"` to
  // GRAPPLE (power 7), letting a blank submission land a real hit. It lands as a
  // no-op WHIFF instead: no damage dealt, none taken, no meter, no combo.
  if (text.trim() === '' || !HAS_CONTENT.test(text)) {
    return {
      kind: 'WHIFF',
      power: 0,
      tags: [],
      continuesThread: false,
      meterGain: 0,
      selfDamage: 0,
      label: 'SAID NOTHING'
    };
  }

  const hedges = count(text, HEDGE);
  const asserts = count(text, ASSERT);
  const hasEvidence =
    CODE_FENCE.test(text) || URL.test(text) || STAT.test(text) || QUOTED.test(text);
  const isQuestion = /\?\s*$/.test(text.trim());
  const concedes = CONCEDE.test(text);
  const contrasts = CONTRAST.test(text);
  const selfCorrects = SELF_CORRECT.test(text);
  const undercuts = UNDERCUT.test(text);

  const loopScore = ctx.previousOwnText ? similarity(text, ctx.previousOwnText) : 0;
  // With no prior opponent message there is no thread to break yet.
  const threadScore = ctx.previousOpponentText ? similarity(text, ctx.previousOpponentText) : 1;
  const continuesThread = threadScore >= THREAD_THRESHOLD;

  if (hasEvidence) tags.push('evidence');
  if (hedges >= 2) tags.push('hedge');
  if (asserts >= 1) tags.push('assertive');
  if (isQuestion) tags.push('question');
  if (concedes) tags.push('concession');
  if (selfCorrects) tags.push('self-correction');
  if (loopScore >= LOOP_THRESHOLD) tags.push('loop');
  if (!continuesThread) tags.push('topic-shift');

  const weight = length <= JAB_MAX_WORDS ? 6 : length <= STRIKE_MAX_WORDS ? 11 : 17;

  let kind: MoveKind;
  let power = 0;
  let meterGain = 5;
  let selfDamage = 0;
  let label: string;

  if (loopScore >= LOOP_THRESHOLD) {
    kind = 'SELF_HIT';
    selfDamage = 9;
    meterGain = 0;
    label = 'REPEATING YOURSELF';
  } else if (selfCorrects) {
    // Honesty costs credibility now and wins the meter that ends rounds later.
    kind = 'GUARD';
    power = 3;
    selfDamage = 6;
    meterGain = 28;
    label = 'HONEST CORRECTION';
  } else if (concedes && !contrasts) {
    kind = 'WHIFF';
    selfDamage = 10;
    meterGain = 0;
    label = 'CONCEDED THE POINT';
  } else if (concedes && contrasts) {
    kind = 'PARRY';
    power = 9;
    meterGain = 15;
    label = 'YES, BUT';
  } else if (isQuestion) {
    kind = 'GRAPPLE';
    power = 7;
    meterGain = 12;
    label = 'TURNED THE QUESTION';
  } else if (hasEvidence) {
    kind = 'CRIT';
    power = weight * 2;
    meterGain = 18;
    label = 'CITED EVIDENCE';
  } else if (undercuts) {
    // Ranked below CRIT (evidence still outranks framing) but above the plain
    // length branches: *going after the flaw* is a deliberate move, not just a
    // reply of some length. `PIVOT` is what beats it — see `combat.ts`.
    kind = 'UNDERCUT';
    power = weight;
    meterGain = 12;
    label = 'FOUND THE FLAW';
  } else if (hedges >= 2) {
    kind = 'GUARD';
    power = 3;
    meterGain = 10;
    label = 'HEDGING';
  } else if (length <= JAB_MAX_WORDS) {
    kind = 'JAB';
    power = weight;
    meterGain = 6;
    label = 'QUICK JAB';
  } else if (length <= STRIKE_MAX_WORDS) {
    kind = 'STRIKE';
    power = weight;
    meterGain = 9;
    label = 'CLEAN STRIKE';
  } else {
    kind = 'HEAVY';
    power = weight;
    meterGain = 11;
    label = 'HEAVY ARGUMENT';
  }

  if (asserts >= 1 && power > 0) power += 2;

  return { kind, power, tags, continuesThread, meterGain, selfDamage, label };
}
