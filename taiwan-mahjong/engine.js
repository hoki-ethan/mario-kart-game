// ============================================================
// Taiwan 16-tile mahjong engine (台灣十六張麻將)
// Pure logic, no DOM: tiles, shanten (幾近聽), waits (聽牌),
// discard analysis (牌效), scoring (台數) and settlement (算錢).
// Works in the browser (window.TWMJ) and in Node (require).
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TWMJ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ============================================================
  // TILES
  // 0-8 萬 (m), 9-17 筒 (p), 18-26 條 (s),
  // 27-30 東南西北, 31 中, 32 發, 33 白. Flowers are kept apart (0-7).
  // ============================================================
  const KINDS = 34;
  const RED = 31, GREEN = 32, WHITE = 33;
  const SUIT_NAMES = ['萬', '筒', '條'];
  const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const HONOR_NAMES = ['東', '南', '西', '北', '中', '發', '白'];
  const FLOWER_NAMES = ['春', '夏', '秋', '冬', '梅', '蘭', '竹', '菊'];
  const WIND_NAMES = ['東', '南', '西', '北'];

  function suitOf(t) { return t < 27 ? Math.floor(t / 9) : 3; }
  function rankOf(t) { return t < 27 ? t % 9 : t - 27; }
  function isHonor(t) { return t >= 27; }
  function tileName(t) {
    return t < 27 ? NUMERALS[t % 9] + SUIT_NAMES[suitOf(t)] : HONOR_NAMES[t - 27];
  }
  function flowerName(f) { return FLOWER_NAMES[f]; }

  // Compact notation: 123m 456p 789s, honors 1-7z = 東南西北中發白, flowers 1-8f = 春夏秋冬梅蘭竹菊
  function parse(str) {
    const tiles = [];
    const flowers = [];
    let digits = [];
    for (const ch of String(str).replace(/[\s,]+/g, '')) {
      if (ch >= '0' && ch <= '9') { digits.push(Number(ch)); continue; }
      const s = 'mpszf'.indexOf(ch.toLowerCase());
      if (s < 0) throw new Error(`看不懂「${ch}」，花色只能是 m/p/s/z/f`);
      if (!digits.length) throw new Error(`「${ch}」前面要有數字`);
      for (const d of digits) {
        if (s < 3) {
          if (d < 1 || d > 9) throw new Error(`${d}${ch} 不存在`);
          tiles.push(s * 9 + d - 1);
        } else if (s === 3) {
          if (d < 1 || d > 7) throw new Error(`${d}z 不存在（1-7z = 東南西北中發白）`);
          tiles.push(27 + d - 1);
        } else {
          if (d < 1 || d > 8) throw new Error(`${d}f 不存在（1-8f = 春夏秋冬梅蘭竹菊）`);
          flowers.push(d - 1);
        }
      }
      digits = [];
    }
    if (digits.length) throw new Error('數字後面要接花色 m/p/s/z/f');
    return { tiles, flowers };
  }

  function format(tiles, flowers) {
    const groups = [[], [], [], []];
    for (const t of [...tiles].sort((a, b) => a - b)) groups[suitOf(t)].push(rankOf(t) + 1);
    let out = '';
    groups.forEach((g, s) => { if (g.length) out += g.join('') + 'mpsz'[s]; });
    if (flowers && flowers.length) out += [...flowers].sort((a, b) => a - b).map(f => f + 1).join('') + 'f';
    return out;
  }

  function toCounts(tiles) {
    const c = new Array(KINDS).fill(0);
    for (const t of tiles) c[t]++;
    return c;
  }

  function fromCounts(c) {
    const tiles = [];
    for (let t = 0; t < KINDS; t++) for (let i = 0; i < c[t]; i++) tiles.push(t);
    return tiles;
  }

  function sortTiles(tiles) { return [...tiles].sort((a, b) => a - b); }

  // ============================================================
  // SHANTEN (幾近聽)
  // -1 = complete, 0 = tenpai (聽牌), n = n tiles away from tenpai.
  // Regular form: 5 melds + 1 pair. Taiwan special form: 嚦咕嚦咕
  // (7 pairs + 1 triplet, fully concealed). For a hand holding a
  // drawn tile (3n+2 tiles) the value is the shanten after the best discard.
  // ============================================================

  // For one suit (or the honors) list every non-dominated
  // (melds, partials) pair, without a head (np) and with one head (wp).
  const groupMemo = new Map();

  function groupOptions(cs, honor) {
    const key = (honor ? 'z' : 's') + cs.join('');
    let r = groupMemo.get(key);
    if (!r) {
      r = computeGroup(cs.slice(), honor);
      groupMemo.set(key, r);
    }
    return r;
  }

  function computeGroup(cs, honor) {
    let i = 0;
    while (i < cs.length && cs[i] === 0) i++;
    if (i === cs.length) return { np: [[0, 0]], wp: [] };

    const np = [];
    const wp = [];
    // Remove `parts` (index list), recurse on the rest, add (dm, dt) and restore.
    function take(parts, dm, dt, head) {
      for (const k of parts) cs[k]--;
      const sub = groupOptions(cs, honor);
      for (const k of parts) cs[k]++;
      if (head) {
        for (const [m, t] of sub.np) wp.push([m + dm, t + dt]);
      } else {
        for (const [m, t] of sub.np) np.push([m + dm, t + dt]);
        for (const [m, t] of sub.wp) wp.push([m + dm, t + dt]);
      }
    }

    // The lowest tile i is either: in a triplet, the start of a sequence,
    // the head, a pair partial, a two-tile partial, or left floating.
    if (cs[i] >= 3) take([i, i, i], 1, 0, false);
    if (!honor && i <= 6 && cs[i + 1] && cs[i + 2]) take([i, i + 1, i + 2], 1, 0, false);
    if (cs[i] >= 2) {
      take([i, i], 0, 0, true);
      take([i, i], 0, 1, false);
    }
    if (!honor && i <= 7 && cs[i + 1]) take([i, i + 1], 0, 1, false);
    if (!honor && i <= 6 && cs[i + 2]) take([i, i + 2], 0, 1, false);
    take([i], 0, 0, false);

    return { np: pareto(np), wp: pareto(wp) };
  }

  function pareto(list) {
    const out = [];
    for (const a of list) {
      const dominated = list.some(b => b[0] >= a[0] && b[1] >= a[1] && (b[0] > a[0] || b[1] > a[1]));
      if (!dominated && !out.some(b => b[0] === a[0] && b[1] === a[1])) out.push(a);
    }
    return out;
  }

  function shantenRegular(c, called) {
    const need = 5 - called;
    const groups = [
      groupOptions(c.slice(0, 9), false),
      groupOptions(c.slice(9, 18), false),
      groupOptions(c.slice(18, 27), false),
      groupOptions(c.slice(27, 34), true),
    ];
    // Combine the groups, keeping only non-dominated states per head flag
    let states = [[0, 0, 0]];
    for (const g of groups) {
      const next = [[], []];
      for (const [m, t, p] of states) {
        for (const [gm, gt] of g.np) next[p].push([m + gm, t + gt]);
        if (!p) for (const [gm, gt] of g.wp) next[1].push([m + gm, t + gt]);
      }
      states = [];
      for (const p of [0, 1]) for (const [m, t] of pareto(next[p])) states.push([m, t, p]);
    }
    let best = 2 * need;
    for (const [m, t, p] of states) {
      const M = Math.min(m, need);
      const T = Math.min(t, need - M);
      best = Math.min(best, 2 * need - 2 * M - T - p);
    }
    return best;
  }

  // 嚦咕嚦咕: 7 pairs + 1 triplet of 8 different kinds.
  function shantenLigu(c) {
    let total = 0;
    let pairs = 0;
    let singles = 0;
    for (const x of c) {
      total += x;
      if (x >= 2) pairs++;
      else if (x === 1) singles++;
    }
    if (total < 16) return Infinity; // needs a fully concealed hand
    let best = Infinity;
    for (let x = 0; x < KINDS; x++) {
      let p = pairs;
      let s = singles;
      if (c[x] >= 2) p--;
      else if (c[x] === 1) s--;
      let missing = 3 - Math.min(c[x], 3);
      let left = 7;
      left -= Math.min(p, left);
      const fromSingles = Math.min(s, left);
      left -= fromSingles;
      missing += fromSingles + 2 * left;
      best = Math.min(best, missing);
    }
    return best - 1;
  }

  function shanten(c, called, opts) {
    called = called || 0;
    const regular = shantenRegular(c, called);
    if (called === 0 && !(opts && opts.ligu === false)) return Math.min(regular, shantenLigu(c));
    return regular;
  }

  // Tiles still unseen from my point of view
  function remainingCounts(handCounts, seenCounts) {
    const r = new Array(KINDS);
    for (let t = 0; t < KINDS; t++) {
      r[t] = Math.max(0, 4 - handCounts[t] - (seenCounts ? seenCounts[t] : 0));
    }
    return r;
  }

  // 進張: tiles that lower the shanten (for a tenpai hand these are the waits)
  function usefulTiles(c, called, remaining, opts) {
    const base = shanten(c, called, opts);
    const tiles = [];
    let total = 0;
    for (let t = 0; t < KINDS; t++) {
      if (c[t] >= 4) continue;
      c[t]++;
      const s = shanten(c, called, opts);
      c[t]--;
      if (s < base) {
        const left = remaining ? remaining[t] : 4 - c[t];
        tiles.push({ tile: t, left });
        total += left;
      }
    }
    // Shape says tenpai but every wait is already in your hand (e.g. 9999m as 999m + 9m)
    const deadWait = base === 0 && tiles.length === 0;
    return { shanten: base, tiles, total, deadWait };
  }

  function waits(tiles, called, opts) {
    const c = toCounts(tiles);
    if (shanten(c, called, opts) !== 0) return [];
    return usefulTiles(c, called, null, opts).tiles.map(w => w.tile);
  }

  // Whole-hand advice for the 牌效 screen.
  //  - 17-3k tiles (just drew): rank every discard by shanten, then by 進張 count
  //  - 16-3k tiles (waiting to draw): shanten + useful tiles
  function analyze(hand, options) {
    const called = (options && options.called) || 0;
    const seen = (options && options.seen) || new Array(KINDS).fill(0);
    const opts = { ligu: !(options && options.ligu === false) };
    const c = toCounts(hand);
    const remaining = remainingCounts(c, seen);
    const drawSize = 17 - 3 * called;

    if (hand.length === drawSize) {
      const s = shanten(c, called, opts);
      if (s === -1) return { mode: 'win', shanten: -1, called };
      const discards = [];
      for (let t = 0; t < KINDS; t++) {
        if (!c[t]) continue;
        c[t]--;
        const u = usefulTiles(c, called, remaining, opts);
        c[t]++;
        discards.push({
          tile: t, shanten: u.shanten, tiles: u.tiles, total: u.total, kinds: u.tiles.length, deadWait: u.deadWait,
        });
      }
      // A "tenpai" whose only wait is a tile you hold all four of is worth less than a real one
      const rank = d => d.shanten + (d.deadWait ? 0.5 : 0);
      discards.sort((a, b) =>
        rank(a) - rank(b) || b.total - a.total || b.kinds - a.kinds || discardEase(b.tile) - discardEase(a.tile));
      const best = discards[0];
      for (const d of discards) {
        d.best = d.shanten === best.shanten && d.total === best.total;
        d.ratio = best.total ? d.total / best.total : 1;
      }
      return { mode: 'discard', shanten: best.shanten, called, discards, unseen: unseenTotal(c, seen) };
    }

    if (hand.length === drawSize - 1) {
      const u = usefulTiles(c, called, remaining, opts);
      return {
        mode: 'draw', shanten: u.shanten, called, tiles: u.tiles, total: u.total, deadWait: u.deadWait,
        unseen: unseenTotal(c, seen),
      };
    }

    return {
      mode: 'invalid', called,
      message: `吃碰 ${called} 組時，手牌要 ${drawSize - 1} 張（等摸牌）或 ${drawSize} 張（摸牌後要打），現在是 ${hand.length} 張`,
    };
  }

  // ============================================================
  // PROBABILITY
  // ============================================================
  // Tiles I cannot see (the wall plus everyone else's hands). Flowers are
  // left out: they get replaced as soon as they are drawn.
  function unseenTotal(handCounts, seenCounts) {
    let n = 0;
    for (let t = 0; t < KINDS; t++) n += Math.max(0, 4 - handCounts[t] - (seenCounts ? seenCounts[t] : 0));
    return n;
  }

  // Chance of drawing at least one of `good` tiles within `draws` draws out of `unseen`
  function drawChance(good, unseen, draws) {
    if (good <= 0 || unseen <= 0) return 0;
    let miss = 1;
    for (let i = 0; i < draws && unseen - i > 0; i++) {
      miss *= Math.max(0, unseen - good - i) / (unseen - i);
    }
    return 1 - miss;
  }

  // Tie-breaker only: honors and terminals are easier to let go of.
  function discardEase(t) {
    if (isHonor(t)) return 3;
    const r = rankOf(t);
    if (r === 0 || r === 8) return 2;
    if (r === 1 || r === 7) return 1;
    return 0;
  }

  // ============================================================
  // SCORING (台數)
  // Common Taiwanese values; every number is editable in the app because
  // house rules differ from table to table.
  // ============================================================
  const RULES = [
    { key: 'dealer', name: '莊家', tai: 1, note: '莊家胡牌，或莊家付錢時才算' },
    { key: 'streak', name: '連莊・拉莊（每連一次）', tai: 2, note: '連 N 拉 N 共 2N 台，同樣只在莊家有關時算' },
    { key: 'menqing', name: '門清', tai: 1, note: '沒有吃、碰、明槓（暗槓可以）' },
    { key: 'zimo', name: '自摸', tai: 1 },
    { key: 'menqingZimo', name: '門清自摸（不求人）', tai: 3, note: '取代門清＋自摸' },
    { key: 'dragonPung', name: '三元牌（中發白刻子）', tai: 1, note: '每組' },
    { key: 'roundWind', name: '圈風刻', tai: 1 },
    { key: 'seatWind', name: '門風刻', tai: 1 },
    { key: 'flowerSeat', name: '正花', tai: 1, note: '東家：春梅，南家：夏蘭，西家：秋竹，北家：冬菊；每張' },
    { key: 'flowerSet', name: '花槓', tai: 2, note: '春夏秋冬或梅蘭竹菊集滿一組' },
    { key: 'singleWait', name: '獨聽（單吊・中洞・邊張）', tai: 1, note: '只聽一種牌' },
    { key: 'robKong', name: '搶槓', tai: 1 },
    { key: 'kongBloom', name: '槓上開花', tai: 1 },
    { key: 'lastDraw', name: '海底撈月', tai: 1, note: '自摸最後一張' },
    { key: 'lastDiscard', name: '河底撈魚', tai: 1, note: '胡最後一張打出的牌' },
    { key: 'pinghu', name: '平胡', tai: 2, note: '五組順子、無字無花、聽兩面、不是自摸' },
    { key: 'allSeek', name: '全求人', tai: 2, note: '五組都吃碰來的，單吊別人打的牌' },
    { key: 'concealed3', name: '三暗刻', tai: 2 },
    { key: 'concealed4', name: '四暗刻', tai: 5 },
    { key: 'concealed5', name: '五暗刻', tai: 8 },
    { key: 'pongPong', name: '碰碰胡', tai: 4 },
    { key: 'halfFlush', name: '混一色', tai: 4 },
    { key: 'fullFlush', name: '清一色', tai: 8 },
    { key: 'littleDragons', name: '小三元', tai: 4, note: '不另計三元牌' },
    { key: 'bigDragons', name: '大三元', tai: 8, note: '不另計三元牌' },
    { key: 'littleWinds', name: '小四喜', tai: 8, note: '不另計風牌' },
    { key: 'bigWinds', name: '大四喜', tai: 16, note: '不另計風牌' },
    { key: 'allHonors', name: '字一色', tai: 16, note: '不另計碰碰胡' },
    { key: 'ligu', name: '嚦咕嚦咕', tai: 8, note: '七對加一刻，門清' },
    { key: 'eightFlowers', name: '八仙過海', tai: 8, note: '八張花全拿' },
    { key: 'sevenRobOne', name: '七搶一', tai: 8, note: '有七張花，搶別人摸到的第八張' },
    { key: 'heavenly', name: '天胡', tai: 24, note: '莊家起手就胡，不另計門清自摸' },
    { key: 'earthly', name: '地胡', tai: 16, note: '閒家第一輪自摸，不另計門清自摸' },
  ];

  function defaultRules() {
    const r = {};
    for (const rule of RULES) r[rule.key] = rule.tai;
    return r;
  }

  // Every way to split the concealed counts into `need` melds + 1 pair.
  function decompositions(c, need) {
    const out = [];
    for (let p = 0; p < KINDS; p++) {
      if (c[p] < 2) continue;
      c[p] -= 2;
      splitMelds(c, 0, [], need, p, out);
      c[p] += 2;
    }
    return out;
  }

  function splitMelds(c, i, groups, need, pair, out) {
    while (i < KINDS && c[i] === 0) i++;
    if (i === KINDS) {
      if (groups.length === need) out.push({ pair, groups: groups.slice() });
      return;
    }
    if (groups.length >= need) return;
    if (c[i] >= 3) {
      c[i] -= 3;
      groups.push({ type: 'pung', tile: i });
      splitMelds(c, i, groups, need, pair, out);
      groups.pop();
      c[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] && c[i + 2]) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      groups.push({ type: 'chow', tile: i });
      splitMelds(c, i, groups, need, pair, out);
      groups.pop();
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
  }

  function meldTiles(m) {
    if (m.type === 'chow') return [m.tile, m.tile + 1, m.tile + 2];
    if (m.type === 'pung') return [m.tile, m.tile, m.tile];
    return [m.tile, m.tile, m.tile, m.tile]; // kong / ankan
  }

  function isValidChowStart(t) { return t < 27 && t % 9 <= 6; }

  // Checks tile limits and hand size; returns an error string or null.
  function validateWin(input) {
    const melds = input.melds || [];
    for (const m of melds) {
      if (m.type === 'chow' && !isValidChowStart(m.tile)) return `${tileName(m.tile)} 開頭不能吃`;
    }
    if (input.winTile == null) return '還沒選胡的那張牌';
    const need = 16 - 3 * melds.length;
    if (input.hand.length !== need) {
      return `有 ${melds.length} 組吃碰槓時，手牌（不含胡的那張）要 ${need} 張，現在是 ${input.hand.length} 張`;
    }
    const all = [...input.hand, input.winTile];
    for (const m of melds) all.push(...meldTiles(m));
    const c = toCounts(all);
    for (let t = 0; t < KINDS; t++) if (c[t] > 4) return `${tileName(t)} 超過 4 張`;
    const flowers = input.flowers || [];
    if (new Set(flowers).size !== flowers.length) return '花牌重複了';
    return null;
  }

  // input: { hand, winTile, melds:[{type:'chow'|'pung'|'kong'|'ankan', tile}], flowers,
  //          selfDraw, seatWind, roundWind, lastTile, kongBloom, robKong, heavenly, earthly,
  //          special: 'eightFlowers'|'sevenRobOne'|undefined }
  // Returns the best reading of the hand: { total, items:[{key,name,tai}], waits, reading }
  function scoreHand(input, rules) {
    rules = Object.assign(defaultRules(), rules || {});

    // Flower wins ignore the hand entirely
    if (input.special === 'eightFlowers' || input.special === 'sevenRobOne') {
      const tai = rules[input.special] || 0;
      const items = tai ? [{ key: input.special, name: ruleName(input.special), tai }] : [];
      return { total: tai, items, waits: [], reading: null };
    }

    const error = validateWin(input);
    if (error) return { error };

    const called = (input.melds || []).length;
    const need = 5 - called;
    const c = toCounts([...input.hand, input.winTile]);
    const preWaits = waits(input.hand, called);
    const readings = [];

    for (const d of decompositions(c, need)) {
      // The winning tile may have completed the pair or any group that holds it
      if (d.pair === input.winTile) readings.push({ d, winGroup: -1 });
      d.groups.forEach((g, gi) => {
        const holds = g.type === 'pung' ? g.tile === input.winTile
          : input.winTile >= g.tile && input.winTile <= g.tile + 2;
        if (holds) readings.push({ d, winGroup: gi });
      });
    }
    if (called === 0 && shantenLigu(c) === -1) readings.push({ ligu: true });

    if (!readings.length) return { error: '這副牌還沒胡喔（湊不成五組加一對）' };

    let best = null;
    for (const r of readings) {
      const res = scoreReading(r, input, rules, preWaits);
      if (!best || res.total > best.total) best = res;
    }
    best.waits = preWaits;
    return best;
  }

  function ruleName(key) {
    const r = RULES.find(x => x.key === key);
    return r ? r.name.replace(/（.*）/, '') : key;
  }

  function scoreReading(reading, input, rules, preWaits) {
    const items = [];
    const add = (key, name, times) => {
      const tai = (rules[key] || 0) * (times || 1);
      if (tai) items.push({ key, name: name || ruleName(key), tai });
    };
    const melds = input.melds || [];
    const selfDraw = !!input.selfDraw;
    const open = melds.filter(m => m.type !== 'ankan');
    const menqing = open.length === 0;

    // Normalize every group as { type: 'chow'|'pung', tile, concealed }
    let groups;
    let pair = null;
    if (reading.ligu) {
      const c = toCounts([...input.hand, input.winTile]);
      const trip = c.findIndex(x => x >= 3);
      groups = [{ type: 'pung', tile: trip, concealed: true }];
    } else {
      pair = reading.d.pair;
      groups = reading.d.groups.map((g, gi) => ({
        type: g.type,
        tile: g.tile,
        // A triplet finished with someone else's discard counts as exposed
        concealed: !(gi === reading.winGroup && g.type === 'pung' && !selfDraw),
        hasWin: gi === reading.winGroup,
      }));
    }
    for (const m of melds) {
      groups.push({
        type: m.type === 'chow' ? 'chow' : 'pung',
        tile: m.tile,
        concealed: m.type === 'ankan',
        kong: m.type === 'kong' || m.type === 'ankan',
      });
    }

    const allTiles = [...input.hand, input.winTile];
    for (const m of melds) allTiles.push(...meldTiles(m));
    const suits = new Set(allTiles.filter(t => !isHonor(t)).map(suitOf));
    const hasHonor = allTiles.some(isHonor);
    const flowers = input.flowers || [];
    const singleWait = preWaits.length === 1;
    const allSeek = open.length === 5 && !selfDraw;
    const opening = input.heavenly || input.earthly;

    // 胡法
    if (input.heavenly) add('heavenly');
    if (input.earthly) add('earthly');
    if (!opening) {
      if (menqing && selfDraw) add('menqingZimo');
      else {
        if (menqing) add('menqing');
        if (selfDraw) add('zimo');
      }
    }
    if (input.lastTile) add(selfDraw ? 'lastDraw' : 'lastDiscard');
    if (input.kongBloom && selfDraw) add('kongBloom');
    if (input.robKong && !selfDraw) add('robKong');

    // 聽法
    if (allSeek) add('allSeek');
    else if (singleWait && !opening) add('singleWait');

    // 牌型
    const pungs = groups.filter(g => g.type === 'pung');
    if (reading.ligu) add('ligu');
    if (!reading.ligu && isPinghu()) add('pinghu');

    if (!suits.size) add('allHonors');
    else if (suits.size === 1) add(hasHonor ? 'halfFlush' : 'fullFlush');

    if (!reading.ligu && pungs.length === 5 && suits.size) add('pongPong');

    const concealedPungs = pungs.filter(g => g.concealed).length;
    if (concealedPungs >= 5) add('concealed5');
    else if (concealedPungs === 4) add('concealed4');
    else if (concealedPungs === 3) add('concealed3');

    // 三元牌
    const dragons = pungs.filter(g => g.tile >= RED).map(g => g.tile);
    const dragonPair = pair != null && pair >= RED;
    if (dragons.length === 3) add('bigDragons');
    else if (dragons.length === 2 && dragonPair) add('littleDragons');
    else for (const t of dragons) add('dragonPung', HONOR_NAMES[t - 27]);

    // 風牌
    const winds = pungs.filter(g => g.tile >= 27 && g.tile < RED).map(g => g.tile - 27);
    const windPair = pair != null && pair >= 27 && pair < RED;
    if (winds.length === 4) add('bigWinds');
    else if (winds.length === 3 && windPair) add('littleWinds');
    else {
      for (const w of winds) {
        if (w === input.roundWind) add('roundWind', `圈風 ${WIND_NAMES[w]}`);
        if (w === input.seatWind) add('seatWind', `門風 ${WIND_NAMES[w]}`);
      }
    }

    // 花牌
    for (const f of sortTiles(flowers)) {
      if (f % 4 === input.seatWind) add('flowerSeat', `正花 ${FLOWER_NAMES[f]}`);
    }
    if ([0, 1, 2, 3].every(f => flowers.includes(f))) add('flowerSet', '花槓 春夏秋冬');
    if ([4, 5, 6, 7].every(f => flowers.includes(f))) add('flowerSet', '花槓 梅蘭竹菊');

    return {
      total: items.reduce((s, it) => s + it.tai, 0),
      items,
      reading: reading.ligu ? { ligu: true } : { pair, groups },
    };

    function isPinghu() {
      if (selfDraw || flowers.length || hasHonor || singleWait) return false;
      if (groups.some(g => g.type !== 'chow')) return false;
      const g = groups.find(x => x.hasWin);
      if (!g) return false; // won on the pair = 單吊
      const r = rankOf(input.winTile);
      const start = rankOf(g.tile);
      // 兩面: the winning tile sits at an end and the other two are not 12 / 89
      if (r === start) return start !== 6;
      if (r === start + 2) return start !== 0;
      return false;
    }
  }

  // Dealer bonus: 莊家 + 連N拉N
  function dealerTai(streak, rules) {
    rules = Object.assign(defaultRules(), rules || {});
    return rules.dealer + rules.streak * (streak || 0);
  }

  // Who pays what. 底 + 台 × 台錢; dealer bonus only when the dealer wins or pays.
  function settle(opts) {
    const base = Number(opts.base) || 0;
    const perTai = Number(opts.perTai) || 0;
    const bonus = opts.dealerTai || 0;
    const line = (who, withDealer) => {
      const tai = opts.tai + (withDealer ? bonus : 0);
      return { who, tai, amount: base + tai * perTai };
    };
    let payers;
    if (!opts.selfDraw) {
      payers = [line(opts.discarderIsDealer ? '放槍的莊家' : '放槍的閒家', opts.winnerIsDealer || opts.discarderIsDealer)];
    } else if (opts.winnerIsDealer) {
      payers = [line('閒家 1', true), line('閒家 2', true), line('閒家 3', true)];
    } else {
      payers = [line('莊家', true), line('閒家', false), line('閒家', false)];
    }
    return { payers, total: payers.reduce((s, p) => s + p.amount, 0) };
  }

  // ============================================================
  // PRACTICE PROBLEMS
  // ============================================================
  // Small seedable PRNG so tests (and shared problems) are repeatable
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffledWall(random) {
    const wall = [];
    for (let t = 0; t < KINDS; t++) for (let i = 0; i < 4; i++) wall.push(t);
    for (let i = wall.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [wall[i], wall[j]] = [wall[j], wall[i]];
    }
    return wall;
  }

  // 打哪張: a random 17-tile hand that is 0-2 away from tenpai and
  // where the choice actually matters.
  function discardProblem(random, maxShanten) {
    random = random || Math.random;
    maxShanten = maxShanten == null ? 2 : maxShanten;
    let hand = null;
    for (let tries = 0; tries < 400; tries++) {
      hand = sortTiles(shuffledWall(random).slice(0, 17));
      const s = shanten(toCounts(hand), 0);
      if (s < 0 || s > maxShanten) continue;
      const a = analyze(hand);
      if (a.discards.some(d => !d.best)) return hand;
    }
    return hand;
  }

  // 聽什麼: a 16-tile tenpai hand built from a complete hand minus one tile.
  // flush = all one suit (清一色), the classic hard drill.
  function waitProblem(random, flush) {
    random = random || Math.random;
    const pick = n => Math.floor(random() * n);
    for (let tries = 0; tries < 500; tries++) {
      const c = new Array(KINDS).fill(0);
      const suit = pick(3);
      const anyTile = () => (flush ? suit * 9 + pick(9) : pick(KINDS));
      const pair = anyTile();
      c[pair] += 2;
      let ok = true;
      for (let m = 0; m < 5 && ok; m++) {
        let placed = false;
        for (let attempt = 0; attempt < 30 && !placed; attempt++) {
          const t = anyTile();
          if (random() < 0.62 && isValidChowStart(t)) {
            if (c[t] < 4 && c[t + 1] < 4 && c[t + 2] < 4) { c[t]++; c[t + 1]++; c[t + 2]++; placed = true; }
          } else if (c[t] <= 1) {
            c[t] += 3;
            placed = true;
          }
        }
        ok = placed;
      }
      if (!ok) continue;
      const full = fromCounts(c);
      full.splice(pick(full.length), 1);
      const w = waits(full, 0);
      if (!w.length) continue;
      if (flush && w.length < 2) continue;
      return { hand: full, waits: w };
    }
    return null;
  }

  // ============================================================
  // DEFENSE (讀牌)
  // ============================================================
  const SEATS = ['我', '下家', '對家', '上家'];
  const PUNG_BIAS = 2.5;       // people keep pungs more than pure chance suggests
  const SUIT_DROP = 0.2;       // each discard of a suit makes that suit a bit less likely in hand
  const MELD_SUIT_BOOST = 1.4; // calling from a suit hints at a one-suit hand
  const OWN_DISCARD = 0.35;    // waiting on a tile he already threw away is less likely (no 振聽 though)
  const NEAR_DISCARD = 0.85;   // holding a neighbour of a tile he threw away is a little less likely

  // Honors that score 台 for a player: 中發白, his seat wind and the round wind
  function valueHonors(seatWind, roundWind) {
    const v = new Array(KINDS).fill(false);
    v[RED] = v[GREEN] = v[WHITE] = true;
    if (seatWind != null) v[27 + seatWind] = true;
    if (roundWind != null) v[27 + roundWind] = true;
    return v;
  }

  // Bot discard: lowest shanten, then most useful tiles. Never breaks a pair
  // of 台 honors unless forced, and holds a single one for the first turns.
  function botDiscard(c, random, ctx) {
    ctx = ctx || {};
    const called = ctx.called || 0;
    let best = [];
    let low = Infinity;
    for (let t = 0; t < KINDS; t++) {
      if (!c[t]) continue;
      c[t]--;
      const s = shanten(c, called);
      c[t]++;
      if (s < low) { low = s; best = [t]; } else if (s === low) best.push(t);
    }
    if (best.length === 1) return best[0];
    let pick = best[0];
    let score = -Infinity;
    for (const t of best) {
      c[t]--;
      const u = usefulTiles(c, called, null).total;
      c[t]++;
      let keep = 0;
      if (ctx.value && ctx.value[t]) keep = c[t] >= 2 ? 1000 : (ctx.turn || 0) < 6 ? 15 : 0;
      const sc = u * 10 + discardEase(t) + random() * 3 - keep;
      if (sc > score) { score = sc; pick = t; }
    }
    return pick;
  }

  // Calling: always pung honors that score 台. Otherwise call only when it gets
  // closer to tenpai: sometimes while closed (門清 is worth 台), almost always
  // once the hand is already open. A tenpai hand never calls.
  const CALL_RATE = { open: 0.9, farClosed: 0.5, nearClosed: 0.3 };
  const callRate = (bot, now) => (bot.melds.length ? CALL_RATE.open : now >= 2 ? CALL_RATE.farClosed : CALL_RATE.nearClosed);

  function botPung(bot, d, random) {
    const k = bot.melds.length;
    if (bot.c[d] < 2) return null;
    const now = shanten(bot.c, k);
    if (now <= 0) return null;
    bot.c[d] -= 2;
    const after = shanten(bot.c, k + 1); // 3n+2 tiles: shanten after the best discard
    bot.c[d] += 2;
    if (after > now) return null;
    if (bot.value[d] || (after < now && random() < callRate(bot, now))) return { type: 'pung', tile: d, use: [d, d] };
    return null;
  }

  function botChow(bot, d, random) {
    if (d >= 27) return null;
    const k = bot.melds.length;
    const now = shanten(bot.c, k);
    if (now <= 0) return null;
    let best = null;
    for (let s = d - 2; s <= d; s++) {
      const r = d % 9 - (d - s);
      if (r < 0 || r > 6) continue;
      const use = [s, s + 1, s + 2].filter(x => x !== d);
      if (!bot.c[use[0]] || !bot.c[use[1]]) continue;
      bot.c[use[0]]--; bot.c[use[1]]--;
      const after = shanten(bot.c, k + 1);
      bot.c[use[0]]++; bot.c[use[1]]++;
      if (after < now && (!best || after < best.after)) best = { type: 'chow', tile: s, use, after };
    }
    return best && random() < callRate(bot, now) ? best : null;
  }

  // Four bots play from a fresh deal (I am the dealer, 東圈) until an opponent
  // is tenpai and it is my turn again (I just drew). Bots call 吃碰; I don't.
  // Hands where somebody already won are thrown away.
  function simulateTable(random, options) {
    random = random || Math.random;
    const minTurn = (options && options.minTurn) || 6;
    for (let attempt = 0; attempt < 300; attempt++) {
      const table = playUntilTenpai(random, minTurn);
      if (table) return table;
    }
    return null;
  }

  function playUntilTenpai(random, minTurn) {
    const wall = shuffledWall(random);
    const bots = [0, 1, 2, 3].map(p => ({
      c: toCounts(wall.slice(p * 16, p * 16 + 16)), melds: [], river: [], called: [], value: valueHonors(p, 0),
    }));
    const end = wall.length - 16; // the last 8 stacks stay in the wall
    let next = 64;
    let target = -1;
    let p = 0;
    let draw = true;
    for (;;) {
      const b = bots[p];
      if (draw) {
        if (next >= end) return null;
        b.c[wall[next++]]++;
        if (p === 0 && target > 0) break;
        if (shanten(b.c, b.melds.length) === -1) return null;
      }
      const d = botDiscard(b.c, random, { called: b.melds.length, value: b.value, turn: b.river.length });
      b.c[d]--;
      b.river.push(d);
      if (p > 0 && target < 0 && b.river.length >= minTurn && waits(fromCounts(b.c), b.melds.length).length) target = p;
      for (let q = 0; q < 4; q++) {
        if (q === p) continue;
        bots[q].c[d]++;
        const won = shanten(bots[q].c, bots[q].melds.length) === -1;
        bots[q].c[d]--;
        if (won) return null;
      }
      // 碰 from anyone, nearest in turn order first; otherwise 吃 by the next player
      let caller = -1;
      let meld = null;
      for (let i = 1; i < 4 && caller < 0; i++) {
        const q = (p + i) % 4;
        if (q === 0) continue;
        meld = botPung(bots[q], d, random);
        if (meld) caller = q;
      }
      if (caller < 0 && (p + 1) % 4 !== 0) {
        meld = botChow(bots[(p + 1) % 4], d, random);
        if (meld) caller = (p + 1) % 4;
      }
      if (caller >= 0) {
        for (const t of meld.use) bots[caller].c[t]--;
        bots[caller].melds.push({ type: meld.type, tile: meld.tile });
        b.called.push(b.river.length - 1);
        p = caller;
        draw = false;
      } else {
        p = (p + 1) % 4;
        draw = true;
      }
    }

    const players = [1, 2, 3].map(seat => {
      const bot = bots[seat];
      const hand = fromCounts(bot.c);
      return {
        seat, name: SEATS[seat], river: bot.river, called: bot.called, melds: bot.melds,
        hand, waits: waits(hand, bot.melds.length),
      };
    });
    const me = fromCounts(bots[0].c);
    // Only keep problems where the choice matters: some of my tiles deal in, some don't
    const danger = new Set();
    for (const pl of players) for (const t of pl.waits) danger.add(t);
    const kinds = new Set(me);
    const risky = [...kinds].filter(t => danger.has(t)).length;
    if (!risky || risky > kinds.size - 3) return null;
    return { me, myRiver: bots[0].river, myCalled: bots[0].called, players, target, roundWind: 0, wallLeft: end - next };
  }

  // Every tile I can see at a simulated table (a claimed discard counts once, in the meld)
  function tableVisible(tb) {
    const c = toCounts(tb.me);
    const addRiver = (river, called) => river.forEach((t, i) => { if (!called.includes(i)) c[t]++; });
    addRiver(tb.myRiver, tb.myCalled);
    for (const pl of tb.players) {
      addRiver(pl.river, pl.called);
      for (const m of pl.melds) for (const t of meldTiles(m)) c[t]++;
    }
    return c;
  }

  // Random complete hand (need groups + pair) drawn from the unseen pool.
  // Each shape is weighted by how many ways it can be made from what is left.
  function sampleCompleteHand(pool, need, weight, random) {
    const c = pool.slice();
    const out = [];
    const pick = cands => {
      let sum = 0;
      for (const x of cands) sum += x[0];
      if (sum <= 0) return null;
      let r = random() * sum;
      for (const x of cands) {
        r -= x[0];
        if (r <= 0) return x[1];
      }
      return cands[cands.length - 1][1];
    };
    let cands = [];
    for (let t = 0; t < KINDS; t++) {
      if (c[t] >= 2) cands.push([weight[suitOf(t)] * c[t] * (c[t] - 1) / 2, [t, t]]);
    }
    const pair = pick(cands);
    if (!pair) return null;
    for (const t of pair) c[t]--;
    out.push(...pair);
    for (let g = 0; g < need; g++) {
      cands = [];
      for (let t = 0; t < KINDS; t++) {
        const w = weight[suitOf(t)];
        if (c[t] >= 3) cands.push([w * PUNG_BIAS * c[t] * (c[t] - 1) * (c[t] - 2) / 6, [t, t, t]]);
        if (isValidChowStart(t) && c[t] && c[t + 1] && c[t + 2]) cands.push([w * c[t] * c[t + 1] * c[t + 2], [t, t + 1, t + 2]]);
      }
      const group = pick(cands);
      if (!group) return null;
      for (const t of group) c[t]--;
      out.push(...group);
    }
    return out;
  }

  // Winning tiles by shape (a winning tile always touches a tile in hand)
  function shapeWaits(hand, called) {
    const c = toCounts(hand);
    const out = [];
    for (let t = 0; t < KINDS; t++) {
      if (c[t] >= 4 || !touches(c, t)) continue;
      c[t]++;
      if (shanten(c, called) === -1) out.push(t);
      c[t]--;
    }
    return out;
  }

  // Same suit, one or two steps apart
  function closeBy(a, b) {
    if (a < 0 || b < 0 || a >= 27 || b >= 27 || suitOf(a) !== suitOf(b)) return false;
    const d = Math.abs(a - b);
    return d === 1 || d === 2;
  }

  function touches(c, t) {
    if (t >= 27) return c[t] > 0;
    const base = suitOf(t) * 9;
    const r = t % 9;
    for (let d = -2; d <= 2; d++) {
      if (r + d >= 0 && r + d < 9 && c[base + r + d]) return true;
    }
    return false;
  }

  // 他聽什麼: assuming the opponent is tenpai, the chance that each tile wins for him.
  //   river:   his discards (claimed ones included)   melds: his called melds [{type, tile}]
  //   visible: counts of every tile I can see (my hand, all rivers, all melds)
  function guessWaits(o) {
    const random = o.random || Math.random;
    const melds = o.melds || [];
    const samples = o.samples || 1000;
    const pool = new Array(KINDS);
    for (let t = 0; t < KINDS; t++) pool[t] = Math.max(0, 4 - (o.visible[t] || 0));
    const thrown = [0, 0, 0, 0];
    for (const t of o.river) thrown[suitOf(t)]++;
    const weight = thrown.map(n => 1 / (1 + SUIT_DROP * n));
    for (const m of melds) weight[suitOf(m.tile)] *= MELD_SUIT_BOOST;
    const inRiver = toCounts(o.river);

    const prob = new Array(KINDS).fill(0);
    let total = 0;
    for (let i = 0; i < samples; i++) {
      const full = sampleCompleteHand(pool, 5 - melds.length, weight, random);
      if (!full) continue;
      full.splice(Math.floor(random() * full.length), 1);
      const w = shapeWaits(full, melds.length);
      if (!w.length) continue;
      let wt = 1;
      for (const t of w) if (inRiver[t]) wt *= OWN_DISCARD;
      for (const h of full) {
        if (h >= 27) continue;
        const r = h % 9;
        for (let d = -2; d <= 2; d++) {
          if (d && r + d >= 0 && r + d < 9 && inRiver[h + d]) wt *= NEAR_DISCARD;
        }
      }
      total += wt;
      for (const t of w) prob[t] += wt;
    }
    if (total) for (let t = 0; t < KINDS; t++) prob[t] /= total;
    return { prob, suitWeight: weight };
  }

  // ============================================================
  // WHY (讀牌理由)
  // ============================================================
  // Measured on 600 simulated tables with calling bots: how a clue changes the
  // chance that a tile is the tenpai player's winning tile. An average tile is
  // 4.9%; each factor is relative to the tiles the clue is compared with.
  const CLUE_FACTORS = {
    ownDiscard: 0.01,   // he discarded this tile (vs. tiles he did not)
    honor: 0.09,        // honors (vs. an average tile)
    terminal: 0.67,     // 1 and 9
    middle: 1.6,        // 3 to 7
    nearLatest: 2.0,    // 1-2 steps from his latest discard
    nearEarly: 0.6,     // he discarded a neighbour in the first half of his river
    suji: 0.7,          // he discarded the tile 3 steps away (筋)
    untouchedSuit: 1.7, // he has not discarded this suit at all
    heavySuit: 0.4,     // he has discarded 5+ of this suit
    wall: 0.06,         // every chow that could wait on it is blocked by visible tiles (壁)
    noCopy: 0.25,       // all other copies are visible: no 單吊 / 對碰
    lastCopy: 0.5,      // one copy left: 單吊 only
  };

  // Every shape that could win on tile t, and whether what I can see rules it out
  function waitShapes(t, visible) {
    const left = x => Math.max(0, 4 - (visible[x] || 0));
    const shapes = [];
    const seq = (a, b, kind) => shapes.push({
      kind, tiles: [a, b], ok: left(a) > 0 && left(b) > 0, blockedBy: [a, b].filter(x => left(x) === 0),
    });
    if (t < 27) {
      const r = t % 9;
      if (r >= 2) seq(t - 2, t - 1, r === 2 ? 'edge' : 'twoSided');
      if (r <= 6) seq(t + 1, t + 2, r === 6 ? 'edge' : 'twoSided');
      if (r >= 1 && r <= 7) seq(t - 1, t + 1, 'closed');
    }
    shapes.push({ kind: 'single', tiles: [t], ok: left(t) >= 1, blockedBy: left(t) >= 1 ? [] : [t] });
    shapes.push({ kind: 'pair', tiles: [t, t], ok: left(t) >= 2, blockedBy: left(t) >= 2 ? [] : [t] });
    return shapes;
  }

  // Which measured clues apply to tile t, given his river and what I can see
  function tileClues(t, o) {
    const river = o.river;
    const out = [];
    const add = (key, extra) => out.push(Object.assign({ key, factor: CLUE_FACTORS[key] }, extra));
    const discarded = river.includes(t);
    if (discarded) add('ownDiscard');
    if (t >= 27) add('honor');
    else {
      const r = t % 9;
      if (r === 0 || r === 8) add('terminal');
      else if (r >= 2 && r <= 6) add('middle');
      const latest = river[river.length - 1];
      if (closeBy(t, latest)) add('nearLatest', { tiles: [latest] });
      if (!discarded) {
        const early = unique(river.slice(0, Math.ceil(river.length / 2)).filter(x => closeBy(x, t)));
        if (early.length) add('nearEarly', { tiles: early });
        const suji = unique(river.filter(x => x < 27 && suitOf(x) === suitOf(t) && Math.abs(x - t) === 3));
        if (suji.length) add('suji', { tiles: suji });
      }
      const sameSuit = river.filter(x => suitOf(x) === suitOf(t)).length;
      if (sameSuit === 0) add('untouchedSuit');
      else if (sameSuit >= 5) add('heavySuit', { count: sameSuit });
      const shapes = waitShapes(t, o.visible);
      const blocked = shapes.filter(sh => sh.tiles.length === 2 && sh.tiles[0] !== sh.tiles[1] && !sh.ok);
      if (blocked.length && blocked.length === shapes.filter(sh => sh.kind !== 'single' && sh.kind !== 'pair').length) {
        add('wall', { tiles: unique(blocked.flatMap(sh => sh.blockedBy)) });
      }
    }
    const left = Math.max(0, 4 - (o.visible[t] || 0));
    if (left === 0) add('noCopy');
    else if (left === 1) add('lastCopy');
    return out;
  }

  // What one tile in his river tells you
  function discardClues(river, index) {
    const d = river[index];
    const info = {
      tile: d, latest: index === river.length - 1, early: index < Math.ceil(river.length / 2),
      neighbours: [], suji: [],
    };
    if (d < 27) {
      const r = d % 9;
      for (const k of [-2, -1, 1, 2]) if (r + k >= 0 && r + k < 9) info.neighbours.push(d + k);
      for (const k of [-3, 3]) if (r + k >= 0 && r + k < 9) info.suji.push(d + k);
    }
    return info;
  }

  // How many of each suit (萬 筒 條 字) he has discarded
  function riverSuits(river) {
    const n = [0, 0, 0, 0];
    for (const t of river) n[suitOf(t)]++;
    return n;
  }

  function unique(list) { return [...new Set(list)]; }

  // Chance an opponent is already tenpai, by melds called (row: 0, 1, 2, 3+) and
  // discards made (column), measured from 2,400 bot games while still going.
  const TENPAI_TABLE = [
    [0, 0, 0, 0.01, 0.01, 0.03, 0.06, 0.1, 0.14, 0.19, 0.24, 0.29, 0.33, 0.38, 0.44, 0.47, 0.56],
    [0, 0, 0, 0.01, 0.03, 0.05, 0.09, 0.14, 0.19, 0.25, 0.31, 0.37, 0.45, 0.53, 0.58, 0.64, 0.76],
    [0, 0, 0.03, 0.05, 0.07, 0.13, 0.2, 0.28, 0.34, 0.42, 0.48, 0.58, 0.64, 0.69, 0.71, 0.73, 0.73],
    [0, 0, 0, 0, 0.33, 0.34, 0.43, 0.53, 0.58, 0.62, 0.68, 0.73, 0.76, 0.78, 0.81, 0.87, 0.87],
  ];
  function tenpaiChance(turns, meldCount) {
    const row = TENPAI_TABLE[Math.min(TENPAI_TABLE.length - 1, Math.max(0, meldCount || 0))];
    return row[Math.min(row.length - 1, Math.max(0, turns))];
  }

  return {
    KINDS, SUIT_NAMES, NUMERALS, HONOR_NAMES, FLOWER_NAMES, WIND_NAMES, RULES,
    suitOf, rankOf, isHonor, tileName, flowerName, parse, format,
    toCounts, fromCounts, sortTiles, meldTiles, isValidChowStart,
    shanten, shantenRegular, shantenLigu, remainingCounts, usefulTiles, waits, analyze,
    unseenTotal, drawChance, SEATS, valueHonors, botDiscard, botPung, botChow, simulateTable, tableVisible,
    guessWaits, shapeWaits, tenpaiChance, CLUE_FACTORS, waitShapes, tileClues, discardClues, riverSuits,
    defaultRules, decompositions, validateWin, scoreHand, dealerTai, settle,
    rng, discardProblem, waitProblem,
  };
});
