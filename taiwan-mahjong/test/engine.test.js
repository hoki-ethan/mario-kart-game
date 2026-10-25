// Run with: node --test   (from the taiwan-mahjong folder)
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../engine.js');

const tiles = s => M.parse(s).tiles;
const counts = s => M.toCounts(tiles(s));
const names = list => list.map(M.tileName).join(' ');

test('parse / format round trip', () => {
  const p = M.parse('123m 456p 789s 1234567z 15f');
  assert.equal(p.tiles.length, 16);
  assert.deepEqual(p.flowers, [0, 4]);
  assert.equal(M.format(p.tiles, p.flowers), '123m456p789s1234567z15f');
  assert.equal(M.tileName(M.parse('5z').tiles[0]), '中');
  assert.equal(M.tileName(M.parse('7z').tiles[0]), '白');
  assert.throws(() => M.parse('0m'));
  assert.throws(() => M.parse('8z'));
  assert.throws(() => M.parse('123'));
});

test('shanten: complete, tenpai and far hands', () => {
  assert.equal(M.shanten(counts('123m456m789m123p456p55s'), 0), -1);
  assert.equal(M.shanten(counts('123m456m789m123p45p99s'), 0), 0);
  assert.equal(M.shanten(counts('123m456m789m123p4p99s1z'), 0), 1);
  // Five isolated honors and scattered tiles are far away
  assert.ok(M.shanten(counts('159m159p159s1234567z'), 0) >= 5);
});

test('shanten respects called melds', () => {
  // Two melds called: 10 concealed tiles + 1 drawn = complete with 3 melds + pair
  assert.equal(M.shanten(counts('123m456p789s11z'), 2), -1);
  assert.equal(M.shanten(counts('123m456p78s11z'), 2), 0);
});

test('waits: two-sided, edge, closed and nine-gates shapes', () => {
  assert.equal(names(M.waits(tiles('123m456m789m123p45p99s'), 0)), '三筒 六筒');
  assert.equal(names(M.waits(tiles('123m456m789m123p12p99s'), 0)), '三筒');
  assert.equal(names(M.waits(tiles('123m456m789m123p46p99s'), 0)), '五筒');
  // 1112345678999m + 123p waits on every 萬
  assert.equal(M.waits(tiles('1112345678999m123p'), 0).length, 9);
});

test('嚦咕嚦咕 (7 pairs + 1 triplet)', () => {
  const win = counts('11m22m33p44p55s66s77z999s');
  assert.equal(M.shantenLigu(win), -1);
  assert.equal(M.shanten(win, 0), -1);
  // 8 pairs is tenpai on any of the 8
  assert.equal(M.waits(tiles('11m22m33p44p55s66s77z88s'), 0).length >= 8, true);
  // The special form can be switched off (e.g. for tables that do not play it)
  assert.equal(M.shanten(counts('11m22m33p44p55s66s77z88s'), 0, { ligu: false }), 4);
});

test('analyze ranks discards by shanten then by useful tiles', () => {
  // Drawing a lone 北 next to a tenpai hand: dropping 北 keeps tenpai
  const a = M.analyze(tiles('123m456m789m123p45p99s4z'));
  assert.equal(a.mode, 'discard');
  assert.equal(M.tileName(a.discards[0].tile), '北');
  assert.equal(a.discards[0].shanten, 0);
  assert.equal(a.discards[0].total, 7); // 3筒 ×3 (one is in hand) + 6筒 ×4
  assert.ok(a.discards[0].best);

  const d = M.analyze(tiles('123m456m789m123p45p99s'));
  assert.equal(d.mode, 'draw');
  assert.equal(d.total, 7);

  // Seen tiles reduce the counts
  const seen = M.toCounts(tiles('333p'));
  assert.equal(M.analyze(tiles('123m456m789m123p45p99s'), { seen }).total, 4);

  // Holding all four 9萬: the shape "waits" on 9萬 but nothing can come
  assert.ok(M.analyze(tiles('1223349999m345s666z')).deadWait);

  assert.equal(M.analyze(tiles('123m')).mode, 'invalid');
  assert.equal(M.analyze(tiles('123m456m789m123p456p55s')).mode, 'win');
});

test('score: 門清自摸 + 中', () => {
  const r = M.scoreHand({
    hand: tiles('123m456m789p555z34s77s'),
    winTile: tiles('5s')[0],
    selfDraw: true, seatWind: 1, roundWind: 0,
  });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.items.map(i => i.name), ['門清自摸', '中']);
  assert.equal(r.total, 4);
});

test('score: 平胡 needs a two-sided wait and no self draw', () => {
  const base = { hand: tiles('123m456m789p34s678s55p'), winTile: tiles('2s')[0], seatWind: 0, roundWind: 0 };
  const r = M.scoreHand(base);
  assert.deepEqual(r.items.map(i => i.name).sort(), ['平胡', '門清'].sort());
  assert.equal(r.total, 3);
  const z = M.scoreHand(Object.assign({}, base, { selfDraw: true }));
  assert.ok(!z.items.some(i => i.key === 'pinghu'));
  // Edge wait (12 waiting 3) is not 平胡 but is 獨聽
  const edge = M.scoreHand({ hand: tiles('12m456m789p345s678s55p'), winTile: tiles('3m')[0], seatWind: 0, roundWind: 0 });
  assert.ok(!edge.items.some(i => i.key === 'pinghu'));
  assert.ok(edge.items.some(i => i.key === 'singleWait'));
});

test('score: triplet finished on a discard is not concealed', () => {
  // 111m 222p 333s concealed, 44z pair... win 9s on discard makes the 4th triplet
  const hand = tiles('111m222p333s99s456m44z');
  const ron = M.scoreHand({ hand, winTile: tiles('9s')[0], seatWind: 0, roundWind: 0 });
  assert.ok(ron.items.some(i => i.key === 'concealed3'));
  const tsumo = M.scoreHand({ hand, winTile: tiles('9s')[0], selfDraw: true, seatWind: 0, roundWind: 0 });
  assert.ok(tsumo.items.some(i => i.key === 'concealed4'));
});

test('score: 清一色 碰碰胡 with called melds', () => {
  const r = M.scoreHand({
    hand: tiles('2223338p'),
    winTile: tiles('8p')[0],
    melds: [{ type: 'pung', tile: tiles('5p')[0] }, { type: 'pung', tile: tiles('9p')[0] }, { type: 'kong', tile: tiles('1p')[0] }],
    seatWind: 0, roundWind: 0,
  });
  const keys = r.items.map(i => i.key);
  assert.ok(keys.includes('fullFlush'));
  assert.ok(keys.includes('pongPong'));
  assert.ok(!keys.includes('menqing'));
});

test('score: 大三元 replaces the single dragon points, 小四喜 replaces wind points', () => {
  const big = M.scoreHand({ hand: tiles('555666777z123m4m'), winTile: tiles('4m')[0], melds: [{ type: 'chow', tile: tiles('2p')[0] }], seatWind: 0, roundWind: 0 });
  const keys = big.items.map(i => i.key);
  assert.ok(keys.includes('bigDragons'));
  assert.ok(!keys.includes('dragonPung'));

  const winds = M.scoreHand({ hand: tiles('111222333z4z123m789m'), winTile: tiles('4z')[0], selfDraw: true, seatWind: 0, roundWind: 0 });
  const wk = winds.items.map(i => i.key);
  assert.ok(wk.includes('littleWinds'));
  assert.ok(!wk.includes('roundWind'));
});

test('score: flowers, 嚦咕嚦咕, specials and errors', () => {
  const r = M.scoreHand({
    hand: tiles('11m22m33p44p55s66s77z99s'), winTile: tiles('9s')[0],
    selfDraw: true, seatWind: 2, roundWind: 0, flowers: [2, 6, 0],
  });
  const keys = r.items.map(i => i.key);
  assert.ok(keys.includes('ligu'));
  assert.equal(r.items.filter(i => i.key === 'flowerSeat').length, 2); // 秋 and 竹 for 西家

  const set = M.scoreHand({ hand: tiles('123m456m789p555z34s77s'), winTile: tiles('5s')[0], seatWind: 0, roundWind: 0, flowers: [0, 1, 2, 3] });
  assert.ok(set.items.some(i => i.key === 'flowerSet'));

  assert.equal(M.scoreHand({ special: 'eightFlowers' }).total, 8);
  assert.match(M.scoreHand({ hand: tiles('123m'), winTile: 0 }).error, /手牌/);
  assert.match(M.scoreHand({ hand: tiles('123m456m789p135s79s11z'), winTile: 0, seatWind: 0, roundWind: 0 }).error, /還沒胡/);
  assert.match(M.scoreHand({ hand: tiles('1111m456m789p345s779s'), winTile: 0, seatWind: 0, roundWind: 0 }).error, /超過/);
});

test('custom house rules change the values', () => {
  const r = M.scoreHand(
    { hand: tiles('123m456m789p555z34s77s'), winTile: tiles('5s')[0], selfDraw: true, seatWind: 1, roundWind: 0 },
    { menqingZimo: 2, dragonPung: 2 });
  assert.equal(r.total, 4);
});

test('settle: dealer bonus only when the dealer wins or pays', () => {
  const dealer = M.dealerTai(1); // 莊 1 + 連1拉1 2
  assert.equal(dealer, 3);
  const ron = M.settle({ tai: 2, dealerTai: dealer, selfDraw: false, winnerIsDealer: false, discarderIsDealer: false, base: 100, perTai: 20 });
  assert.equal(ron.total, 140);
  const ronDealer = M.settle({ tai: 2, dealerTai: dealer, selfDraw: false, winnerIsDealer: false, discarderIsDealer: true, base: 100, perTai: 20 });
  assert.equal(ronDealer.total, 200);
  const tsumo = M.settle({ tai: 2, dealerTai: dealer, selfDraw: true, winnerIsDealer: false, base: 100, perTai: 20 });
  assert.deepEqual(tsumo.payers.map(p => p.amount), [200, 140, 140]);
  const dealerTsumo = M.settle({ tai: 2, dealerTai: dealer, selfDraw: true, winnerIsDealer: true, base: 100, perTai: 20 });
  assert.equal(dealerTsumo.total, 600);
});

test('practice problems are well formed', () => {
  const random = M.rng(42);
  for (let i = 0; i < 20; i++) {
    const hand = M.discardProblem(random);
    assert.equal(hand.length, 17);
    assert.ok(M.toCounts(hand).every(x => x <= 4));
    const s = M.shanten(M.toCounts(hand), 0);
    assert.ok(s >= 0 && s <= 2);
  }
  for (const flush of [false, true]) {
    for (let i = 0; i < 20; i++) {
      const p = M.waitProblem(random, flush);
      assert.equal(p.hand.length, 16);
      assert.ok(M.toCounts(p.hand).every(x => x <= 4));
      assert.deepEqual(p.waits, M.waits(p.hand, 0));
      if (flush) {
        assert.equal(new Set(p.hand.map(M.suitOf)).size, 1);
        assert.ok(p.waits.length >= 2);
      }
    }
  }
});

test('drawChance is a hypergeometric "at least one" chance', () => {
  assert.equal(M.drawChance(0, 80, 5), 0);
  assert.ok(Math.abs(M.drawChance(8, 80, 1) - 0.1) < 1e-9);
  // 1 - (72/80)(71/79)
  assert.ok(Math.abs(M.drawChance(8, 80, 2) - (1 - (72 / 80) * (71 / 79))) < 1e-9);
  assert.equal(M.drawChance(5, 5, 1), 1);
  const a = M.analyze(tiles('123m456m789m123p45p99s'));
  assert.equal(a.unseen, 136 - 16);
});

test('simulated tables: an opponent is tenpai and my hand has both safe and unsafe tiles', () => {
  const random = M.rng(3);
  let melds = 0;
  for (let i = 0; i < 6; i++) {
    const tb = M.simulateTable(random);
    assert.equal(tb.me.length, 17);
    const target = tb.players.find(p => p.seat === tb.target);
    assert.ok(target.waits.length > 0);
    for (const p of tb.players) {
      assert.deepEqual(p.waits, M.waits(p.hand, p.melds.length));
      assert.equal(p.hand.length, 16 - 3 * p.melds.length);
      melds += p.melds.length;
    }
    // Every tile exists at most 4 times: hands, melds, and discards that were not claimed
    const all = M.tableVisible(tb);
    for (const p of tb.players) for (const t of p.hand) all[t]++;
    assert.ok(all.every(x => x <= 4));
    // Each meld claimed exactly one discard from somebody's river
    const claimed = tb.players.reduce((n, p) => n + p.called.length, tb.myCalled.length);
    assert.equal(claimed, tb.players.reduce((n, p) => n + p.melds.length, 0));
    const danger = new Set(tb.players.flatMap(p => p.waits));
    const kinds = new Set(tb.me);
    assert.ok([...kinds].some(t => danger.has(t)));
    assert.ok([...kinds].some(t => !danger.has(t)));
  }
  assert.ok(melds > 0, 'bots should call 吃碰 sometimes');
});

test('bots pung honors that score 台 and only chow when it helps', () => {
  const bot = (hand, seat) => ({ c: M.toCounts(tiles(hand)), melds: [], value: M.valueHonors(seat, 0) });
  const never = () => 0.99; // calls that are left to chance do not happen
  // 中 pair: always pung, even with a closed hand
  assert.deepEqual(M.botPung(bot('55z12m45m78m23p56p8s9s1z9p', 1), tiles('5z')[0], never).use, tiles('55z'));
  // 北 is not 台 for 南家 in 東圈, and calling is left to chance
  assert.equal(M.botPung(bot('44z12m45m78m23p56p8s9s1z9p', 1), tiles('4z')[0], never), null);
  // Every chow on 7萬 would break a finished meld, so it is refused even when chance allows it
  assert.equal(M.botChow(bot('123456789m159p159s1z', 1), tiles('7m')[0], () => 0), null);
  // 13萬 嵌張 + 二萬 from 上家: 123萬 takes the hand from 2 to 1 away from tenpai
  const ch = M.botChow(bot('13m456789p234s55z9s13z', 1), tiles('2m')[0], () => 0);
  assert.deepEqual([ch.type, ch.tile], ['chow', tiles('1m')[0]]);
});

test('guessWaits: impossible tiles get nothing, discarded tiles get less, probabilities are sane', () => {
  const river = tiles('1z 2z 9m 1p 5s 9p'.replace(/ /g, ''));
  const visible = M.toCounts(river.concat(tiles('5555z')));
  const g = M.guessWaits({ river, visible, random: M.rng(8), samples: 600 });
  assert.equal(g.prob[tiles('5z')[0]], 0); // all four 中 are visible
  assert.ok(g.prob.every(p => p >= 0 && p <= 1));
  // He threw away a 5條, so 5條 should be less likely than an untouched middle tile like 5萬
  assert.ok(g.prob[tiles('5s')[0]] < g.prob[tiles('5m')[0]]);
  // A suit he calls from looks more dangerous
  const melded = M.guessWaits({ river, melds: [{ type: 'pung', tile: tiles('7p')[0] }, { type: 'chow', tile: tiles('2p')[0] }], visible: M.toCounts(river.concat(tiles('777p234p'))), random: M.rng(8), samples: 600 });
  const pinShare = p => p.slice(9, 18).reduce((a, b) => a + b, 0);
  assert.ok(pinShare(melded.prob) > pinShare(g.prob));
});

test('tenpaiChance grows with turns and with called melds', () => {
  assert.equal(M.tenpaiChance(0, 0), 0);
  assert.ok(M.tenpaiChance(10, 0) > M.tenpaiChance(6, 0));
  assert.ok(M.tenpaiChance(8, 2) > M.tenpaiChance(8, 0));
  assert.ok(M.tenpaiChance(8, 9) >= M.tenpaiChance(8, 3));
  assert.ok(M.tenpaiChance(40, 0) <= 1);
});

test('reasons: wait shapes, the wall and clues from the river', () => {
  const river = tiles('1z9m2p4s5m'.replace(/ /g, ''));
  const visible = M.toCounts(river.concat(tiles('7777m')));
  const keys = t => M.tileClues(tiles(t)[0], { river, visible }).map(c => c.key);
  // All four 七萬 visible: 八萬 can only be won by 單吊 / 對碰
  const eight = M.waitShapes(tiles('8m')[0], visible);
  assert.deepEqual(eight.filter(s => s.ok).map(s => s.kind), ['single', 'pair']);
  assert.ok(keys('8m').includes('wall'));
  assert.ok(keys('8m').includes('nearEarly')); // 九萬 was thrown early
  assert.ok(keys('8m').includes('sujiLatest')); // 五萬 is three away, and it is his latest discard
  // 六萬 still has the 45萬 two-sided shape, and sits next to his latest discard 五萬
  assert.ok(!keys('6m').includes('wall'));
  assert.ok(keys('6m').includes('nearLatest'));
  assert.ok(keys('9m').includes('ownDiscard'));
  assert.ok(keys('3z').includes('freshHonor')); // nobody has shown a 西 yet
  assert.ok(keys('1z').includes('honor'));
  // 條子: he threw one; 萬子 none would be untouchedSuit
  assert.ok(M.tileClues(tiles('5m')[0], { river: tiles('1z2z'), visible: M.toCounts([]) }).some(c => c.key === 'untouchedSuit'));
  // 1 copy left -> 單吊 only
  const v2 = M.toCounts(tiles('555p'));
  assert.ok(M.tileClues(tiles('5p')[0], { river: [], visible: v2 }).some(c => c.key === 'lastCopy'));
  // What a discard says
  const d = M.discardClues(river, river.length - 1);
  assert.ok(d.latest);
  assert.deepEqual(d.neighbours.map(M.tileName), ['三萬', '四萬', '六萬', '七萬']);
  assert.deepEqual(d.suji.map(M.tileName), ['二萬', '八萬']);
  assert.deepEqual(M.riverSuits(river), [2, 1, 1, 1]);
});

test('push or fold: attack when a little risk buys tenpai, fold when the hand is far away', () => {
  const zeros = () => new Array(34).fill(0);
  // Throwing 東 (a bit dangerous) makes tenpai on 3筒/6筒; anything else breaks the hand
  const hand = tiles('123m456m789m123p45p99s1z');
  const prob = zeros();
  prob[tiles('1z')[0]] = 0.06;
  const pf = M.pushFold({
    hand, visible: M.toCounts(hand), wallLeft: 30, threats: [{ prob, tenpai: 1 }],
    base: 100, perTai: 20, dealer: false,
  });
  assert.equal(M.tileName(pf.best.tile), '東');
  assert.equal(pf.best.plan, 'push');
  assert.equal(pf.best.shanten, 0);
  assert.ok(pf.rows.every((r, i) => i === 0 || pf.rows[i - 1].ev >= r.ev));

  // A hopeless hand facing a tenpai player: give up the honors he wants, throw a safe number tile
  const far = tiles('159m159p159s1234567z2m');
  const honors = zeros();
  for (let t = 27; t < 34; t++) honors[t] = 0.3;
  const pf2 = M.pushFold({
    hand: far, visible: M.toCounts(far), wallLeft: 20, threats: [{ prob: honors, tenpai: 1 }],
    base: 100, perTai: 20, dealer: false,
  });
  assert.equal(pf2.best.plan, 'fold');
  assert.equal(pf2.best.dealIn, 0);
  assert.ok(pf2.best.tile < 27);

  // More tiles to wait on and more wall left never lowers the win chance
  assert.ok(M.winChance(0, 8, 30) >= M.winChance(0, 2, 30));
  assert.ok(M.winChance(1, 15, 30) >= M.winChance(1, 15, 6));
  assert.ok(M.winChance(0, 4, 20) > M.winChance(2, 40, 20));
});

test('fold threshold: far hands always fold, big hands and late turns lower the bar', () => {
  const at = o => M.foldThreshold(Object.assign({ base: 100, perTai: 20, wallLeft: 28, dealer: false }, o)).threshold;
  assert.equal(at({ shanten: 2, useful: 30 }), 0);
  assert.equal(at({ shanten: 1, useful: 6 }), 0);
  const tenpai = at({ shanten: 0, useful: 8 });
  assert.ok(tenpai > 0.4);
  assert.ok(at({ shanten: 0, useful: 8, oppTai: 8 }) < tenpai);
  assert.ok(at({ shanten: 0, useful: 8, wallLeft: 6 }) < tenpai);
  assert.ok(at({ shanten: 1, useful: 35 }) > at({ shanten: 1, useful: 15 }));
});

test('筋 from his latest discard is flagged, and a trickster turns 筋 off', () => {
  // He just threw 五萬; 二萬 is its 筋, and the 一三萬 中洞 is still possible
  const river = tiles('1z9p5m');
  const visible = M.toCounts(river);
  const two = M.tileClues(tiles('2m')[0], { river, visible });
  const latest = two.find(c => c.key === 'sujiLatest');
  assert.ok(latest);
  assert.deepEqual(latest.closed.map(M.tileName), ['一萬', '三萬']);
  // The same 筋 thrown earlier counts as normal 筋
  const early = M.tileClues(tiles('2m')[0], { river: tiles('5m1z9p'), visible });
  assert.ok(early.some(c => c.key === 'suji'));
  // All four 三萬 visible: no 中洞 left to worry about
  const walled = M.tileClues(tiles('2m')[0], { river, visible: M.toCounts(river.concat(tiles('3333m'))) });
  assert.equal(walled.find(c => c.key === 'sujiLatest').closed, null);
  // Against someone who sets 筋 traps it is no protection at all
  const trap = M.tileClues(tiles('2m')[0], { river, visible, trickster: true });
  assert.equal(trap.find(c => c.key === 'sujiTrap').factor, 1);
  // ...and the read model stops discounting shapes next to his discards
  const a = M.guessWaits({ river: tiles('5m5m5p'), visible: M.toCounts(tiles('5m5m5p')), random: M.rng(3), samples: 800 });
  const b = M.guessWaits({ river: tiles('5m5m5p'), visible: M.toCounts(tiles('5m5m5p')), random: M.rng(3), samples: 800, trickster: true });
  const near5 = p => p[tiles('3m')[0]] + p[tiles('4m')[0]] + p[tiles('6m')[0]] + p[tiles('7m')[0]];
  assert.ok(near5(b.prob) > near5(a.prob));
});

test('one-chance, 間四間, fresh honors and the mid-game tenpai signal', () => {
  // Three 七萬 visible: 八萬 can still be waited on with 79 or 67, but only through the last 七萬
  const vis3 = M.toCounts(tiles('777m'));
  assert.ok(M.tileClues(tiles('8m')[0], { river: tiles('1z'), visible: vis3 }).some(c => c.key === 'oneChance'));
  assert.ok(!M.tileClues(tiles('8m')[0], { river: tiles('1z'), visible: M.toCounts([]) }).some(c => c.key === 'oneChance'));
  // He threw 一萬 and 六萬: 二萬 and 五萬 are the 間四間 tiles
  const river = tiles('1m6m1z');
  const v = M.toCounts(river);
  assert.ok(M.tileClues(tiles('2m')[0], { river, visible: v }).some(c => c.key === 'interFour'));
  assert.ok(M.tileClues(tiles('5m')[0], { river, visible: v }).some(c => c.key === 'interFour'));
  assert.ok(!M.tileClues(tiles('3m')[0], { river, visible: v }).some(c => c.key === 'interFour'));
  // An honor nobody has shown is flagged apart from ordinary honors
  assert.ok(M.tileClues(tiles('5z')[0], { river, visible: v }).some(c => c.key === 'freshHonor'));
  assert.ok(M.tileClues(tiles('1z')[0], { river, visible: v }).some(c => c.key === 'honor'));
  // Mid-game middle tiles signal tenpai more than honors; early discards say nothing
  assert.ok(M.tenpaiSignal(tiles('5p')[0], 8).chance > M.tenpaiSignal(tiles('3z')[0], 8).chance);
  assert.equal(M.tenpaiSignal(tiles('5p')[0], 3), null);
});

test('跟打: the tile 上家 just threw is safe against the players who passed on it', () => {
  const tb = M.simulateTable(M.rng(41), { need: 2, minShanten: 1 });
  assert.ok(tb.tenpai.length >= 2);
  assert.ok(M.shanten(M.toCounts(tb.me), 0) >= 1);
  const up = tb.players.find(p => p.seat === 3);
  assert.equal(tb.passed, up.river[up.river.length - 1]);
  // Nobody won on it, so it is not a winning tile for 下家 or 對家
  for (const p of tb.players) if (p.seat !== 3) assert.ok(!p.waits.includes(tb.passed));
  const visible = M.tableVisible(tb);
  const next = tb.players.find(p => p.seat === 1);
  const read = M.guessWaits({ river: next.river, melds: next.melds, visible, passed: tb.passed, random: M.rng(2), samples: 200 });
  assert.equal(read.prob[tb.passed], 0);
  assert.ok(M.tileClues(tb.passed, { river: next.river, visible, passed: tb.passed }).some(c => c.key === 'passed' && c.factor === 0));
});

test('盯牌: chow shapes, feed risk and the marking answer', () => {
  const none = M.toCounts([]);
  assert.equal(M.chowShapes(tiles('5m')[0], none, []).open, 3);
  assert.equal(M.chowShapes(tiles('1m')[0], none, []).open, 1);
  assert.equal(M.chowShapes(tiles('5z')[0], none, []).open, 0);
  // All four 四萬 visible: only 67 can still take 五萬
  assert.equal(M.chowShapes(tiles('5m')[0], M.toCounts(tiles('4444m')), []).open, 1);
  // 下家 threw 三萬: 一萬 and 二萬 are outside it (外側), every shape needs his 三萬
  const threw3 = tiles('3m');
  assert.deepEqual(M.chowShapes(tiles('2m')[0], none, threw3), { open: 2, live: 0, through: threw3 });
  assert.equal(M.chowShapes(tiles('1m')[0], none, threw3).live, 0);
  assert.equal(M.chowShapes(tiles('4m')[0], none, threw3).live, 1);
  const next = { river: [], melds: [] };
  assert.ok(M.feedRisk(tiles('2m')[0], { seen: none, next: { river: threw3, melds: [] }, turn: 4 }).chow < 0.02);
  const fresh = M.feedRisk(tiles('5z')[0], { seen: none, next, turn: 8 });
  const dead = M.feedRisk(tiles('5z')[0], { seen: M.toCounts(tiles('55z')), next, turn: 8 });
  assert.equal(fresh.chow, 0);
  assert.equal(dead.pung, 0);
  assert.ok(fresh.pung > 0.2);
  assert.ok(M.feedRisk(tiles('5z')[0], { seen: none, next, turn: 2 }).pung < fresh.pung);
  // More open chow shapes, more chows for 下家
  assert.ok(M.feedRisk(tiles('5m')[0], { seen: none, next, turn: 4 }).chow > M.feedRisk(tiles('1m')[0], { seen: none, next, turn: 4 }).chow);

  const tb = M.markProblem(M.rng(7));
  const ok = tb.options.filter(r => r.efficient);
  assert.ok(ok.length >= 2 && tb.players.every(p => !p.waits.length));
  const least = Math.min(...ok.map(r => r.feed.total));
  for (const r of tb.options) {
    if (r.best) assert.ok(r.efficient && r.feed.total <= least + 0.01);
  }
  assert.ok(tb.options.some(r => r.best));
});
