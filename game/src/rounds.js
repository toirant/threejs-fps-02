// Rounds and money. Buy phase, live round, planted fuse, end. A round is won
// by eliminating the other team, by the spike exploding, or by defusing it /
// running the clock out without a plant. First to 5 rounds takes the match.
// Money: kills, plants, wins and losses all pay; the buy menu spends it.
import * as THREE from 'three';
import { SITES } from './map.js';

const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const FUSE_SECONDS = 35;
const END_SECONDS = 4;
const WIN_ROUNDS = 5;
const START_MONEY = 800;

export function createRounds(deps) {
  const { audio, effects, scene } = deps;
  const bombMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.22),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#ff7a1a'), roughness: 0.4, metalness: 0.4, emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 0.7 }),
  );
  bombMesh.visible = false;
  scene.add(bombMesh);
  const bombLight = new THREE.PointLight(new THREE.Color('#ff7a1a'), 0, 6);
  scene.add(bombLight);

  const state = {
    phase: 'buy', // buy | live | planted | end
    round: 1,
    score: { ember: 0, slate: 0 },
    timeLeft: BUY_SECONDS,
    money: START_MONEY,
    armor: 0,
    frags: 0,
    smokes: 0,
    bombPlanted: false,
    bombSite: null,
    bombPos: new THREE.Vector3(),
    plantProgress: 0,
    defuseProgress: 0,
    matchOver: false,
    lastWinner: null,
  };

  let phaseCb = null;
  let winCb = null;

  function setPhase(phase, seconds) {
    state.phase = phase;
    state.timeLeft = seconds;
    if (phaseCb) phaseCb(phase);
  }

  function endRound(winner, reason) {
    if (state.phase === 'end') return;
    state.score[winner] += 1;
    state.lastWinner = winner;
    state.money += winner === 'ember' ? 325 : 190;
    if (winner === 'ember') audio.roundWin();
    else audio.roundLose();
    setPhase('end', END_SECONDS);
    if (winCb) winCb(winner, reason, state.score);
  }

  function startRound() {
    state.bombPlanted = false;
    state.bombSite = null;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    bombMesh.visible = false;
    bombLight.intensity = 0;
    setPhase('buy', BUY_SECONDS);
  }

  function nextRound() {
    if (state.score.ember >= WIN_ROUNDS || state.score.slate >= WIN_ROUNDS) {
      state.matchOver = true;
      return;
    }
    state.round += 1;
    startRound();
  }

  function plantBomb(siteKey, pos) {
    state.bombPlanted = true;
    state.bombSite = siteKey;
    state.bombPos.copy(pos);
    state.money += 300;
    bombMesh.position.set(pos.x, 0.15, pos.z);
    bombMesh.visible = true;
    setPhase('planted', FUSE_SECONDS);
  }

  function step(dt, alive) {
    if (state.phase === 'end') {
      state.timeLeft -= dt;
      return;
    }
    state.timeLeft -= dt;
    if (state.phase === 'planted') {
      bombLight.intensity = 6 + Math.sin(state.timeLeft * 8) * 4;
      bombLight.position.set(state.bombPos.x, 0.6, state.bombPos.z);
      if (state.timeLeft <= 0) {
        effects.explosion(state.bombPos);
        audio.explosion();
        endRound('ember', 'The spike detonated at ' + (SITES[state.bombSite]?.name ?? 'the site') + '.');
      }
      return;
    }
    if (state.phase === 'live' && state.timeLeft <= 0) {
      endRound('slate', 'Time expired — the spike was never planted.');
      return;
    }
    if (state.phase === 'live' || state.phase === 'buy') {
      if (alive.ember === 0 && alive.slate > 0) {
        endRound(state.bombPlanted ? 'ember' : 'slate', 'Slate wiped the Ember squad.');
      } else if (alive.slate === 0 && alive.ember > 0) {
        endRound('ember', 'Ember wiped the Slate squad.');
      }
    }
  }

  function buy(itemId, price) {
    if (state.money < price || state.phase !== 'buy') return false;
    state.money -= price;
    return true;
  }

  return {
    state, setPhase, endRound, startRound, nextRound, plantBomb, step, buy,
    onPhase(cb) { phaseCb = cb; },
    onWin(cb) { winCb = cb; },
    buySeconds: BUY_SECONDS,
    roundSeconds: ROUND_SECONDS,
    winRounds: WIN_ROUNDS,
  };
}
