/**
 * DOM overlay: bars, meters, combo counter, announcer, subtitles and the action
 * picker. Pure presentation — it never reads match state directly, it is told.
 *
 * The health bar is two stacked elements: `fill` snaps to the true value while
 * `chip` trails it on a delayed transition, which is the whole reason a fighting
 * game hit reads as damage rather than as a number changing.
 */

import { ROUNDS_TO_WIN } from '../engine/types';
import type { PlayerAction, Speaker } from '../engine/types';
import type { FighterProfile } from '../fighters';

const ACTION_WINDOW_MS = 7000;
/** Longest caption tail kept on screen; the rest scrolls off like a live caption. */
const TAIL_CHARS = 170;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing HUD element: #${id}`);
  return found as T;
}

export interface Hud {
  show(): void;
  setFighters(p1: FighterProfile, p2: FighterProfile): void;
  setHealth(side: Speaker, value: number): void;
  setMeter(side: Speaker, value: number): void;
  setRounds(side: Speaker, won: number): void;
  setRound(round: number): void;
  setTimer(seconds: number): void;
  combo(side: Speaker, count: number): void;
  announce(text: string): void;
  subtitle(name: string, color: string, text: string): void;
  openActionWindow(): void;
  closeActionWindow(): PlayerAction;
}

export function createHud(): Hud {
  const hud = el('hud');
  const announcer = el('announcer');
  const timer = el('timer');
  const roundLabel = el('round-label');
  const subWho = el('sub-who');
  const subText = el('sub-text');
  const windowFill = el('action-window');
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.action')
  );

  const parts = {
    p1: {
      fill: el('p1-fill'),
      chip: el('p1-chip'),
      meter: el('p1-meter'),
      pips: el('p1-pips'),
      name: el('p1-name'),
      tag: el('p1-tag'),
      combo: el('p1-combo')
    },
    p2: {
      fill: el('p2-fill'),
      chip: el('p2-chip'),
      meter: el('p2-meter'),
      pips: el('p2-pips'),
      name: el('p2-name'),
      tag: el('p2-tag'),
      combo: el('p2-combo')
    }
  };

  let chosen: PlayerAction = 'NONE';
  let windowOpen = false;

  function choose(action: PlayerAction): void {
    if (!windowOpen) return;
    chosen = action;
    for (const button of buttons) {
      button.classList.toggle('chosen', button.dataset.action === action);
    }
  }

  for (const button of buttons) {
    button.addEventListener('click', () => choose(button.dataset.action as PlayerAction));
  }

  window.addEventListener('keydown', (event) => {
    const index = ['1', '2', '3', '4'].indexOf(event.key);
    if (index >= 0) choose(buttons[index]?.dataset.action as PlayerAction);
  });

  function buildPips(container: HTMLElement, won: number): void {
    container.innerHTML = '';
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      const pip = document.createElement('div');
      pip.className = i < won ? 'pip won' : 'pip';
      container.appendChild(pip);
    }
  }

  return {
    show() {
      hud.classList.add('live');
    },

    setFighters(p1, p2) {
      parts.p1.name.textContent = p1.name;
      parts.p1.tag.textContent = p1.tagline;
      parts.p2.name.textContent = p2.name;
      parts.p2.tag.textContent = p2.tagline;
      document.documentElement.style.setProperty('--p1', `#${p1.color.toString(16).padStart(6, '0')}`);
      document.documentElement.style.setProperty('--p2', `#${p2.color.toString(16).padStart(6, '0')}`);
      buildPips(parts.p1.pips, 0);
      buildPips(parts.p2.pips, 0);
    },

    setHealth(side, value) {
      const scale = Math.max(0, Math.min(1, value / 100));
      parts[side].fill.style.transform = `scaleX(${scale})`;
      parts[side].chip.style.transform = `scaleX(${scale})`;
    },

    setMeter(side, value) {
      parts[side].meter.style.width = `${Math.max(0, Math.min(100, value))}%`;
      parts[side].meter.parentElement?.classList.toggle('full', value >= 100);
    },

    setRounds(side, won) {
      buildPips(parts[side].pips, won);
    },

    setRound(round) {
      roundLabel.textContent = `ROUND ${round}`;
    },

    setTimer(seconds) {
      const clamped = Math.max(0, Math.ceil(seconds));
      timer.textContent = String(clamped).padStart(2, '0');
      timer.classList.toggle('low', clamped <= 10);
    },

    combo(side, count) {
      const node = parts[side].combo;
      // Escalation tiers: a 2-hit and a 6-hit combo used to render as the same
      // static line with the same pop, so a run of hits carried no build.
      const tier = count >= 6 ? 'tier-3' : count >= 4 ? 'tier-2' : 'tier-1';
      node.textContent = count >= 4 ? `${count} HIT COMBO!!` : `${count} HIT COMBO`;
      node.dataset.count = String(count);
      node.classList.remove('pop', 'tier-1', 'tier-2', 'tier-3');
      void node.offsetWidth; // restart the animation
      node.classList.add('pop', tier);
    },

    announce(text) {
      announcer.textContent = text;
      announcer.classList.remove('show');
      void announcer.offsetWidth;
      announcer.classList.add('show');
    },

    subtitle(name, color, text) {
      subWho.textContent = name;
      subWho.style.color = color;
      // Live-caption behaviour: the tail is what is being "said" right now, and the
      // full message is already legible on the fighter's own screen.
      subText.textContent = text.length > TAIL_CHARS ? `…${text.slice(-TAIL_CHARS)}` : text;
    },

    openActionWindow() {
      chosen = 'NONE';
      windowOpen = true;
      for (const button of buttons) {
        button.disabled = false;
        button.classList.remove('chosen');
      }
      windowFill.style.transition = 'none';
      windowFill.style.transform = 'scaleX(1)';
      void windowFill.offsetWidth;
      windowFill.style.transition = `transform ${ACTION_WINDOW_MS}ms linear`;
      windowFill.style.transform = 'scaleX(0)';
    },

    closeActionWindow() {
      windowOpen = false;
      for (const button of buttons) button.disabled = true;
      windowFill.style.transition = 'none';
      windowFill.style.transform = 'scaleX(0)';
      return chosen;
    }
  };
}
