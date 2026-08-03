/**
 * Wiring only: source → engine → renderer.
 *
 * Everything interesting lives behind an interface — swap `createReplaySource`
 * for a live-model source and nothing below this file has to change.
 */

import './style.css';

import { FightEngine } from './engine/match';
import type { CombatEvent, PlayerAction, Speaker } from './engine/types';
import { profileFor } from './fighters';
import { createReplaySource, loadTranscript } from './sources/replay';
import type { MatchSource, StreamHandlers } from './sources/types';
import { createAudio } from './render/audio';
import { createFighter, type FighterRig } from './render/fighter';
import { createFx } from './render/fx';
import { createHud } from './render/hud';
import { createStage } from './render/scene';

const ROUND_SECONDS = 99;
/**
 * Arcade seconds, not real ones. At 1.0 the clock outruns the debate and almost
 * every round ends on a judges' decision instead of a knockout.
 */
const CLOCK_RATE = 0.75;
const RECOVERY_MS = 700;

const STAGES = [
  { file: 'microservices.json', vs: 'CLAUDE vs CODEX', topic: 'should a 3-person team use microservices?' },
  { file: 'tabs-vs-spaces.json', vs: 'GEMINI vs LOCAL 7B', topic: 'tabs or spaces' }
];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = createStage(canvas);
const fx = createFx(stage, document.getElementById('fx-layer')!);
const hud = createHud();
const sfx = createAudio();

const titleOverlay = document.getElementById('title')!;
const resultOverlay = document.getElementById('result')!;
const resultTitle = document.getElementById('result-title')!;
const resultSub = document.getElementById('result-sub')!;

let rigs: Record<Speaker, FighterRig> | null = null;
let engine: FightEngine | null = null;
let source: MatchSource | null = null;
let roundJustEnded = false;
let fighting = false;
let roundClock = ROUND_SECONDS;

stage.onFrame((dt, elapsed) => {
  if (rigs) {
    rigs.p1.update(dt, elapsed);
    rigs.p2.update(dt, elapsed);
  }
  fx.update(dt);

  if (fighting && engine && !engine.matchOver) {
    roundClock = Math.max(0, roundClock - dt * CLOCK_RATE);
    hud.setTimer(roundClock);
    if (roundClock === 0 && !roundJustEnded) engine.endRoundOnTime();
  }
});
stage.start();

// --- stage picker --------------------------------------------------------

const picker = document.getElementById('stage-picker')!;
for (const entry of STAGES) {
  const card = document.createElement('button');
  card.className = 'stage-card';
  card.innerHTML = `<span class="vs">${entry.vs}</span><span class="topic">${entry.topic}</span>`;
  card.addEventListener('click', () => void startMatch(entry.file));
  picker.appendChild(card);
}

document.getElementById('rematch')!.addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  titleOverlay.classList.remove('hidden');
});

// --- match lifecycle -----------------------------------------------------

async function startMatch(file: string): Promise<void> {
  source?.stop();

  const transcript = await loadTranscript(`${import.meta.env.BASE_URL}transcripts/${file}`);
  const p1 = profileFor(transcript.p1);
  const p2 = profileFor(transcript.p2);

  if (rigs) {
    rigs.p1.group.removeFromParent();
    rigs.p2.group.removeFromParent();
  }
  rigs = { p1: createFighter(p1, -1), p2: createFighter(p2, 1) };
  stage.add(rigs.p1.group);
  stage.add(rigs.p2.group);
  stage.setFighterColors(p1.color, p2.color);

  engine = new FightEngine('p1', transcript.p1, transcript.p2);
  engine.on(handleEvent);

  hud.setFighters(p1, p2);
  hud.setHealth('p1', 100);
  hud.setHealth('p2', 100);
  hud.setMeter('p1', 0);
  hud.setMeter('p2', 0);
  hud.setRound(1);
  hud.subtitle(transcript.topic, '#ffd166', '');
  hud.show();

  titleOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');

  source = createReplaySource(transcript);
  roundClock = ROUND_SECONDS;
  roundJustEnded = false;
  fighting = true;

  sfx.bell();
  hud.announce('ROUND 1');
  await sleep(1100);
  hud.announce('FIGHT!');

  void runLoop();
}

const handlers: StreamHandlers = {
  onTurnStart(speaker) {
    if (!rigs) return;
    rigs[speaker].setPose('windup');
    rigs[speaker].setScreenText('');
    hud.openActionWindow();
  },

  onTurnChunk(speaker, textSoFar) {
    if (!rigs || !engine) return;
    rigs[speaker].setScreenText(textSoFar);
    rigs[speaker].setCharge(Math.min(1, textSoFar.split(' ').length / 45));
    hud.subtitle(engine.state[speaker].name, colorOf(speaker), textSoFar);
  },

  onTurnEnd(speaker, fullText) {
    if (!rigs || !engine) return;
    const action: PlayerAction = hud.closeActionWindow();
    engine.setPlayerAction(action);
    rigs[speaker].setCharge(0);
    engine.completeTurn(speaker, fullText);

    setTimeout(() => {
      if (!engine || engine.matchOver || !rigs) return;
      rigs.p1.setPose('idle');
      rigs.p2.setPose('idle');
    }, RECOVERY_MS);
  }
};

async function runLoop(): Promise<void> {
  while (engine && !engine.matchOver) {
    if (roundJustEnded) {
      roundJustEnded = false;
      await sleep(2200);
      source?.reset();
      roundClock = ROUND_SECONDS;
      syncBars();
      hud.setRound(engine.state.round);
      hud.announce(`ROUND ${engine.state.round}`);
      sfx.bell();
      await sleep(1200);
      hud.announce('FIGHT!');
      rigs?.p1.setPose('idle');
      rigs?.p2.setPose('idle');
      continue;
    }

    const more = await source?.nextTurn(handlers);
    if (!more && !roundJustEnded && engine && !engine.matchOver) {
      // Transcript exhausted with both fighters still standing: call it on credibility.
      engine.endRoundOnTime();
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
  if (!rigs || !engine) return;

  switch (event.type) {
    case 'attack': {
      rigs[event.by].setPose('attack');
      sfx.whoosh();
      if (LOUD_LABELS.has(event.label)) hud.announce(event.label);
      break;
    }

    case 'hit': {
      const rig = rigs[event.target];
      rig.setPose(event.damage > 0 ? 'hurt' : 'idle');
      rig.flash(1);
      stage.shake(event.crit ? 0.62 : 0.3);
      stage.hitstop(event.crit ? 150 : 80);
      stage.zoomPunch(event.crit ? 0.55 : 0.22);
      fx.burst(rig.headPosition(), event.crit ? 0xff5470 : 0xffd166, event.crit ? 90 : 40, 6);
      fx.damageNumber(rig.headPosition(), event.damage, event.crit);
      event.crit ? sfx.crit() : sfx.hit();
      syncBars();
      break;
    }

    case 'blocked': {
      const rig = rigs[event.target];
      rig.setPose('guard');
      stage.shake(0.12);
      fx.burst(rig.headPosition(), 0x6ee7ff, 18, 3);
      fx.damageNumber(rig.headPosition(), event.damage, false);
      sfx.block();
      syncBars();
      break;
    }

    case 'counter': {
      hud.announce('COUNTER!');
      rigs[event.by].setPose('attack');
      const victim = rigs[event.by === 'p1' ? 'p2' : 'p1'];
      victim.setPose('hurt');
      victim.flash(1.4);
      stage.shake(0.7);
      stage.hitstop(170);
      fx.burst(victim.headPosition(), 0xffffff, 80, 7);
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

    case 'meter': {
      hud.setMeter(event.who, event.value);
      break;
    }

    case 'super': {
      hud.announce(event.name);
      stage.shake(1.1);
      stage.hitstop(260);
      stage.zoomPunch(1.1);
      sfx.crit();
      break;
    }

    case 'ko': {
      const winner: Speaker = event.loser === 'p1' ? 'p2' : 'p1';
      rigs[event.loser].setPose('ko');
      rigs[winner].setPose('win');
      hud.announce('K.O.');
      stage.shake(1.3);
      stage.hitstop(320);
      sfx.ko();
      syncBars();
      break;
    }

    case 'roundEnd': {
      roundJustEnded = true;
      if (event.winner) hud.setRounds(event.winner, engine.state[event.winner].roundsWon);
      break;
    }

    case 'matchEnd': {
      fighting = false;
      source?.stop();
      const name = engine.state[event.winner].name;
      resultTitle.textContent = event.winner === engine.state.playerSide ? 'YOU WIN' : 'YOU LOSE';
      resultSub.textContent = `${name} took the argument ${engine.state[event.winner].roundsWon}–${
        engine.state[event.winner === 'p1' ? 'p2' : 'p1'].roundsWon
      }`;
      setTimeout(() => resultOverlay.classList.remove('hidden'), 2200);
      break;
    }

    case 'announce': {
      hud.announce(event.text);
      break;
    }
  }
}
