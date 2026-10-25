// ============================================================
// 大殺四方 UI: four tabs (牌效 / 台數 / 練習 / 小抄) on top of engine.js.
// All state lives in S. Each tab has a render function that redraws its
// dynamic parts; clicks are routed through data-act attributes.
// ============================================================
(function () {
  'use strict';
  const M = window.TWMJ;
  const $ = sel => document.querySelector(sel);

  const TABS = ['analyze', 'defense', 'score', 'drill', 'guide'];
  const SHANTEN_NAMES = ['聽牌', '一近聽', '二近聽', '三近聽', '四近聽', '五近聽', '六近聽', '七近聽', '八近聽'];
  const MELD_NAMES = { chow: '吃', pung: '碰', kong: '明槓', ankan: '暗槓' };
  const PRESETS = [[30, 10], [50, 20], [100, 20], [100, 50], [300, 100]];

  const shantenName = s => (s < 0 ? '胡了' : SHANTEN_NAMES[s] || `${s} 近聽`);
  const zeros = () => new Array(M.KINDS).fill(0);
  const money = n => Number(n).toLocaleString('zh-TW');
  const parseTiles = s => M.parse(s).tiles;
  const tileList = s => s.split(' ').map(x => M.parse(x).tiles[0]); // keeps order, for rivers
  const pct = p => (p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);

  // ============================================================
  // STORAGE (best effort; the page works without it)
  // ============================================================
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('twmj.' + key);
        return v ? JSON.parse(v) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('twmj.' + key, JSON.stringify(value));
      } catch (e) { /* storage blocked */ }
    },
  };

  // ============================================================
  // STATE (opens on example hands so every tab shows something)
  // ============================================================
  const newStats = () => ({ n: 0, good: 0, streak: 0, best: 0 });
  const stakes = store.get('stakes', { base: 100, perTai: 20 });
  const savedStats = store.get('stats', {});

  const S = {
    tab: 'analyze',
    rules: Object.assign(M.defaultRules(), store.get('rules', {})),
    an: {
      hand: parseTiles('13456m246779p3458s55z'), seen: zeros(), called: 0,
      target: 'hand', last: null, example: true, showAll: false,
    },
    sc: {
      hand: parseTiles('123m456m789p555z34s77s'), winTile: parseTiles('5s')[0], melds: [], flowers: [1],
      target: 'hand', selfDraw: true, seatWind: 1, roundWind: 0, discarderIsDealer: false, streak: 1,
      lastTile: false, kongBloom: false, robKong: false, heavenly: false, earthly: false, special: '',
      base: stakes.base, perTai: stakes.perTai, example: true,
    },
    dr: { mode: 'discard', flush: false, problem: null, answer: null, picks: [] },
    df: { mode: 'sim', task: 'safe', table: null, read: null, reads: {}, answer: null, picks: [], loading: false, hint: null },
    dm: {
      river: tileList('1z 7z 6z 8s 1m 1p 8s 4z 1s 9p 8m 4s'), melds: [], mine: parseTiles('1234m123678899p5688s'),
      seen: M.toCounts(parseTiles('1122235789m123p1112369s1122333444556677z')), target: 'river', example: true, read: null, hint: 11,
      dealer: false, oppTai: 1.3,
    },
    dw: { wall: 28, oppTai: 1.3, sure: 1, dealer: false },
    stats: {
      discard: savedStats.discard || newStats(), wait: savedStats.wait || newStats(),
      pushfold: Object.assign({ dealt: 0 }, savedStats.pushfold || newStats()), guess: savedStats.guess || newStats(),
    },
  };

  // ============================================================
  // SHARED PIECES
  // ============================================================
  function tileHTML(t, o) {
    let cls = 'tile';
    let inner;
    if (t < 27) {
      cls += ' ' + ['man', 'pin', 'sou'][M.suitOf(t)];
      inner = `<span class="num">${M.NUMERALS[t % 9]}</span><span class="suit">${M.SUIT_NAMES[M.suitOf(t)]}</span>`;
    } else if (t === 33) {
      cls += ' hon';
      inner = '<span class="frame"></span>';
    } else {
      cls += ' hon' + (t === 31 ? ' red' : t === 32 ? ' green' : '');
      inner = `<span class="hon-ch">${M.HONOR_NAMES[t - 27]}</span>`;
    }
    return wrapTile(cls, inner, M.tileName(t), t, o || {});
  }

  function flowerHTML(f, o) {
    const cls = 'tile flo ' + (f < 4 ? 'season' : 'plant');
    const inner = `<span class="fl">${M.FLOWER_NAMES[f]}</span><span class="fk">${(f % 4) + 1}</span>`;
    return wrapTile(cls, inner, M.FLOWER_NAMES[f], f, o || {});
  }

  function wrapTile(cls, inner, name, value, o) {
    if (o.size) cls += ' ' + o.size;
    if (o.cls) cls += ' ' + o.cls;
    const label = o.label || name;
    if (!o.act) return `<span class="${cls}" role="img" aria-label="${label}" title="${label}">${inner}</span>`;
    const pressed = o.pressed == null ? '' : ` aria-pressed="${o.pressed}"`;
    const v = o.value != null ? o.value : value;
    return `<button type="button" class="${cls}" aria-label="${label}" title="${label}" data-act="${o.act}" data-v="${v}"${pressed}${o.disabled ? ' disabled' : ''}>${inner}</button>`;
  }

  function miniCount(u) {
    return `<span class="mt${u.left ? '' : ' zero'}">${tileHTML(u.tile, { size: 'sm' })}<i>${u.left}</i></span>`;
  }

  function groupHTML(list) {
    return `<span class="tiles tight">${list.map(t => tileHTML(t, { size: 'sm' })).join('')}</span>`;
  }

  // 34-tile picker; `used` shows how many of each are already placed
  function paletteHTML(act, used, disable) {
    const rows = [[0, 9], [9, 18], [18, 27], [27, 34]];
    return rows.map(([a, b]) => {
      const cells = [];
      for (let t = a; t < b; t++) {
        const n = used[t] || 0;
        const off = n >= 4 || (disable && disable(t));
        cells.push(`<span class="pal">${tileHTML(t, { act, disabled: off })}${n ? `<i class="used">${n}</i>` : ''}</span>`);
      }
      return `<div class="palette-row">${cells.join('')}</div>`;
    }).join('');
  }

  function segHTML(act, options, current, isDisabled) {
    return options.map(([value, label]) => {
      const off = isDisabled && isDisabled(value) ? ' disabled' : '';
      return `<button type="button" data-act="${act}" data-v="${value}" aria-pressed="${String(value) === String(current)}"${off}>${label}</button>`;
    }).join('');
  }

  function verdictHTML(status, statusCls, big, sub) {
    return `<div class="verdict"><span class="status ${statusCls || ''}">${status}</span>` +
      (big ? `<p class="big">${big}</p>` : '') + (sub ? `<p class="sub">${sub}</p>` : '') + '</div>';
  }

  function namesList(tiles, max) {
    const names = tiles.map(M.tileName);
    return names.length > max ? names.slice(0, max).join('、') + ' 等' : names.join('、');
  }

  function discardRowHTML(d, chosen, unseen) {
    const label = d.deadWait ? '假聽' : shantenName(d.shanten);
    const live = d.shanten === 0 && !d.deadWait;
    return `<li class="drow${d.best ? ' best' : ''}${chosen ? ' chosen' : ''}">
      ${tileHTML(d.tile)}
      <div class="drow-main">
        <div class="drow-head"><b>打${M.tileName(d.tile)}</b><span class="status${live ? ' tenpai' : ''}">${label}</span>${d.best ? '<span class="badge">最佳</span>' : ''}${chosen ? '<span class="badge warn">你打的</span>' : ''}</div>
        <div class="tiles tight">${d.tiles.map(miniCount).join('')}</div>
      </div>
      <div class="drow-count"><b>${d.total}</b><span>張・${d.kinds} 種</span>${unseen ? `<span>下一張 ${pct(d.total / unseen)}</span>` : ''}</div>
    </li>`;
  }

  // One decomposition of a complete 17-tile hand, for explanations
  function readingHTML(handWithWin) {
    const c = M.toCounts(handWithWin);
    const d = M.decompositions(c, 5)[0];
    if (!d) return '<span class="hint">嚦咕嚦咕（七對加一刻）</span>';
    const groups = d.groups.map(g => groupHTML(M.meldTiles(g)));
    groups.push(groupHTML([d.pair, d.pair]));
    return groups.join('');
  }

  let toastTimer = null;
  function toast(msg) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  // ============================================================
  // CLICK ROUTING
  // ============================================================
  const actions = {};
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el.dataset.v, el);
  });

  actions.tab = (_, el) => showTab(el.dataset.tab);

  function showTab(tab, skipHash) {
    if (!TABS.includes(tab)) tab = 'analyze';
    S.tab = tab;
    for (const t of TABS) {
      $('#view-' + t).hidden = t !== tab;
      $('#tab-' + t).setAttribute('aria-selected', String(t === tab));
    }
    if (tab === 'drill' && !S.dr.problem) newProblem();
    renderers[tab]();
    if (!skipHash) {
      try { history.replaceState(null, '', '#' + tab); } catch (e) { /* sandboxed */ }
    }
  }

  // ============================================================
  // 牌效 (discard analysis)
  // ============================================================
  const anLimit = () => 17 - 3 * S.an.called;

  function renderAnalyze() {
    const a = S.an;
    const limit = anLimit();
    const used = M.toCounts(a.hand);
    let seenTotal = 0;
    const seenTiles = [];
    for (let t = 0; t < M.KINDS; t++) {
      used[t] += a.seen[t];
      seenTotal += a.seen[t];
      if (a.seen[t]) {
        seenTiles.push(`<span class="mt">${tileHTML(t, { size: 'sm', act: 'an-unsee', label: '拿掉一張' + M.tileName(t) })}<i>×${a.seen[t]}</i></span>`);
      }
    }
    const handTiles = M.sortTiles(a.hand).map(t => tileHTML(t, { act: 'an-remove', label: '拿掉' + M.tileName(t) }));

    $('#an-target').innerHTML = segHTML('an-target', [['hand', '點牌放進手牌'], ['seen', '點牌記成已見']], a.target);
    $('#an-builder').innerHTML = `
      <div class="slot">
        <div class="slot-head">
          <span class="slot-label">我的手牌</span>
          <span class="slot-count${a.hand.length >= limit - 1 ? ' full' : ''}">${a.hand.length} 張・要 ${limit - 1} 或 ${limit} 張</span>
          ${a.example ? '<span class="example-tag">範例</span>' : ''}
          <span class="slot-actions">
            <button type="button" class="btn ghost small" data-act="an-random">隨機一手</button>
            <button type="button" class="btn ghost small" data-act="an-clear">清空</button>
          </span>
        </div>
        <div class="tiles">${handTiles.join('') || '<span class="empty-slot">點下面的牌放進來</span>'}</div>
      </div>
      <div class="slot">
        <div class="slot-head">
          <span class="slot-label">場上已見</span>
          <span class="slot-count">${seenTotal} 張</span>
          ${seenTotal ? '<span class="slot-actions"><button type="button" class="btn ghost small" data-act="an-clear-seen">清空</button></span>' : ''}
        </div>
        ${seenTiles.length ? `<div class="tiles tight">${seenTiles.join('')}</div>` : '<p class="hint">別人打出來、吃碰出去的牌記在這裡，算進張時會扣掉。</p>'}
      </div>
      <div class="cond">
        <span>我已吃碰</span>
        <span class="stepper">
          <button type="button" data-act="an-called" data-v="-1" aria-label="少一組">−</button>
          <output>${a.called}</output>
          <button type="button" data-act="an-called" data-v="1" aria-label="多一組">＋</button>
          <span>組</span>
        </span>
      </div>`;
    $('#an-palette').innerHTML = paletteHTML('an-add', used);
    renderAnalyzeResult();
  }

  function renderAnalyzeResult() {
    const a = S.an;
    const el = $('#an-result');
    if (!a.hand.length) {
      el.innerHTML = verdictHTML('等你放牌', '', null, '點牌放進手牌，或按「隨機一手」先玩玩看。');
      return;
    }
    const r = M.analyze(a.hand, { called: a.called, seen: a.seen });

    if (r.mode === 'invalid') {
      el.innerHTML = verdictHTML('還不能算', '', null, r.message);
      return;
    }
    if (r.mode === 'win') {
      el.innerHTML = verdictHTML('胡了', 'win', '已經胡了！', '去算台數，看這把收多少。') +
        (a.called === 0 ? '<button type="button" class="btn" data-act="an-to-score">帶去算台數</button>' : '');
      return;
    }
    if (r.mode === 'draw') {
      let big;
      if (r.shanten === 0) big = r.deadWait ? '聽的牌都在你手上' : `聽 ${r.tiles.length} 種，還剩 ${r.total} 張`;
      else big = `進張 ${r.tiles.length} 種 ${r.total} 張`;
      const odds = n => pct(M.drawChance(r.total, r.unseen, n));
      const chance = `${r.shanten === 0 ? '自摸' : '摸到進張'}的機率：下一張 ${odds(1)}，3 巡內 ${odds(3)}，5 巡內 ${odds(5)}。`;
      const sub = chance + (r.shanten === 0 ? '這些牌來了就胡：' : '摸到這些牌會更接近聽牌：');
      el.innerHTML = verdictHTML(shantenName(r.shanten), r.shanten === 0 ? 'tenpai' : '', big, sub) +
        `<div class="tiles tight">${r.tiles.map(miniCount).join('')}</div>`;
      return;
    }

    const best = r.discards.filter(d => d.best);
    const top = best[0];
    const bestNames = namesList(best.map(d => d.tile), 3);
    const big = r.shanten === 0 && !top.deadWait ? `打${bestNames}就聽牌` : `打${bestNames}最好`;
    const odds = n => pct(M.drawChance(top.total, r.unseen, n));
    const sub = top.shanten === 0
      ? `聽 ${top.kinds} 種，還剩 ${top.total} 張。自摸機率：下一張 ${odds(1)}，5 巡內 ${odds(5)}（還沒算別人放槍）。`
      : `打完是${shantenName(top.shanten)}，進張 ${top.kinds} 種 ${top.total} 張。下一張就摸到進張的機率 ${odds(1)}，3 巡內 ${odds(3)}。`;
    const rows = a.showAll ? r.discards : r.discards.slice(0, 6);
    el.innerHTML = verdictHTML(shantenName(r.shanten), r.shanten === 0 ? 'tenpai' : '', big, sub) +
      `<ul class="drows">${rows.map(d => discardRowHTML(d, false, r.unseen)).join('')}</ul>` +
      (r.discards.length > 6
        ? `<button type="button" class="btn ghost small more" data-act="an-more">${a.showAll ? '只看前 6 名' : `看全部 ${r.discards.length} 種打法`}</button>`
        : '') +
      '<p class="hint">只算速度（進張），沒算台數。中發白、圈風、門風的對子碰到有台，速度差不多時可以留。</p>';
  }

  function touchAnalyze() {
    S.an.example = false;
    renderAnalyze();
  }

  actions['an-target'] = v => { S.an.target = v; renderAnalyze(); };
  actions['an-add'] = v => {
    const t = Number(v);
    if (S.an.target === 'seen') {
      S.an.seen[t]++;
    } else {
      if (S.an.hand.length >= anLimit()) return toast(`手牌最多 ${anLimit()} 張`);
      S.an.hand.push(t);
      S.an.last = t;
    }
    touchAnalyze();
  };
  actions['an-remove'] = v => {
    const t = Number(v);
    const i = S.an.hand.lastIndexOf(t);
    if (i >= 0) S.an.hand.splice(i, 1);
    if (S.an.last === t) S.an.last = null;
    touchAnalyze();
  };
  actions['an-unsee'] = v => { S.an.seen[Number(v)]--; touchAnalyze(); };
  actions['an-clear'] = () => { S.an.hand = []; S.an.last = null; touchAnalyze(); };
  actions['an-clear-seen'] = () => { S.an.seen = zeros(); touchAnalyze(); };
  actions['an-random'] = () => {
    S.an.hand = M.discardProblem();
    S.an.seen = zeros();
    S.an.called = 0;
    S.an.last = null;
    touchAnalyze();
  };
  actions['an-called'] = v => {
    S.an.called = Math.max(0, Math.min(4, S.an.called + Number(v)));
    touchAnalyze();
  };
  actions['an-more'] = () => { S.an.showAll = !S.an.showAll; renderAnalyzeResult(); };
  actions['an-to-score'] = () => {
    const hand = S.an.hand.slice();
    const win = S.an.last != null ? S.an.last : hand[hand.length - 1];
    hand.splice(hand.lastIndexOf(win), 1);
    Object.assign(S.sc, { hand, winTile: win, melds: [], flowers: [], example: false, target: 'hand' });
    showTab('score');
  };

  function bindCodeForm() {
    $('#an-code-form').addEventListener('submit', e => {
      e.preventDefault();
      const err = $('#an-code-error');
      try {
        const tiles = M.parse($('#an-code').value).tiles;
        const c = M.toCounts(tiles);
        if (!tiles.length) throw new Error('沒有讀到牌');
        if (c.some(x => x > 4)) throw new Error('有牌超過 4 張');
        if (tiles.length > anLimit()) throw new Error(`最多 ${anLimit()} 張，你輸入了 ${tiles.length} 張`);
        S.an.hand = tiles;
        S.an.last = tiles[tiles.length - 1];
        for (let t = 0; t < M.KINDS; t++) S.an.seen[t] = Math.min(S.an.seen[t], 4 - c[t]);
        err.hidden = true;
        touchAnalyze();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  }


  // ============================================================
  // 防守 (reading opponents)
  // ============================================================
  const dangerLevel = p => (p >= 0.12 ? 'high' : p >= 0.05 ? 'mid' : '');

  // 34-tile map: how likely each tile is to win for him
  function heatGridHTML(prob, visible, actual) {
    const max = Math.max(0.01, ...prob);
    return '<div class="heat-grid">' + [[0, 9], [9, 18], [18, 27], [27, 34]].map(([a, b]) => {
      const cells = [];
      for (let t = a; t < b; t++) {
        const dead = visible[t] >= 4;
        const cls = ['heat', dangerLevel(prob[t]), dead ? 'dead' : '', actual && actual.includes(t) ? 'actual' : ''].filter(Boolean).join(' ');
        cells.push(`<span class="${cls}">${tileHTML(t, { size: 'sm' })}<span class="meter"><b style="width:${Math.round((prob[t] / max) * 100)}%"></b></span><i>${dead ? '—' : pct(prob[t])}</i></span>`);
      }
      return `<div class="heat-row">${cells.join('')}</div>`;
    }).join('') + '</div>';
  }

  // ---------- 理由 ----------
  const SHAPE_NAMES = { twoSided: '兩面', edge: '邊張', closed: '嵌張', single: '單吊', pair: '對碰' };
  const suitName = t => (t >= 27 ? '字牌' : M.SUIT_NAMES[M.suitOf(t)] + '子');

  // Short chip + one-sentence reason for each measured clue
  const CLUE_TEXT = {
    ownDiscard: { chip: '他打過', say: () => '他自己打過這張（現物）。電腦牌局裡幾乎不會是他聽的；但台灣沒有振聽，不是絕對安全。' },
    honor: { chip: '字牌', say: () => '字牌只能被單吊或對碰，比數字牌安全很多。' },
    terminal: { chip: '么九', say: () => '一、九只能被一種兩面、單吊或對碰胡，聽法比中張少。' },
    middle: { chip: '中張', say: () => '三到七能湊的聽法最多（兩種兩面、嵌張、單吊、對碰），本來就比較危險。' },
    nearLatest: { chip: '他剛打的旁邊', say: c => `他最新打的是${namesList(c.tiles, 3)}，就在這張旁邊 1–2 格。聽牌前拆掉的牌，常常就在他聽的牌旁邊。` },
    nearEarly: { chip: '早巡打過旁邊', say: c => `他前半段就打了${namesList(c.tiles, 4)}，很早就不要這一帶。` },
    suji: { chip: '筋', say: c => `他打過隔三格的${namesList(c.tiles, 2)}（筋）：用兩面等這張的機會小一點。筋只擋兩面，${closedText(c)}單吊、對碰照樣會胡。` },
    sujiLatest: { chip: '剛打的筋', say: c => `筋來自他最新打的${namesList(c.tiles, 1)}：電腦牌局裡這種筋被胡的時候，一半以上是中洞（打五釣二）。${c.closed ? `他可能留著${namesList(c.closed, 2)}等這張。` : '中洞已經被看得到的牌擋住，這點比較放心。'}` },
    sujiTrap: { chip: '騙筋', say: c => `你設定這家會騙筋：他打過${namesList(c.tiles, 2)}也不算數，當成一般的牌看。${c.closed ? `尤其小心${namesList(c.closed, 2)}的中洞。` : ''}` },
    untouchedSuit: { chip: '他不打這門', say: (c, t) => `${suitName(t)}他一張都沒打，手上可能有很多。` },
    heavySuit: { chip: '這門他狂丟', say: (c, t) => `${suitName(t)}他已經打了 ${c.count} 張，手上這門的牌不多。` },
    wall: { chip: '壁', say: c => `${namesList(c.tiles, 3)}四張都看得到，用順子等這張的聽法全被擋住，只剩單吊、對碰。` },
    oneChance: { chip: 'one-chance', say: c => `${namesList(c.tiles, 2)}外面只剩 1 張：還能用順子等這張的聽法，都要用到那最後一張，電腦牌局裡被聽的機率剩約 4 成。` },
    interFour: { chip: '間四間', say: c => `他打過${namesList(c.tiles, 2)}（間四間）：中間這張常常是被留下的兩面在等，電腦牌局裡約 1.5 倍危險。日麻的牌譜研究說這招不準，真人不一定。` },
    freshHonor: { chip: '生張字', say: () => '這張字牌一張都還沒出現，是字牌裡最危險的一種（電腦牌局 1.8%；已經出現兩張的只有 0.4%），可能是他的對碰或單吊。' },
    noCopy: { chip: '他沒有這張', say: () => '這張四張都在看得到的地方（含你手上的），他不可能有：不會被單吊或對碰。' },
    lastCopy: { chip: '只剩 1 張', say: () => '外面只剩 1 張，他最多單吊這張，不會對碰。' },
  };

  function factorText(f) {
    if (f >= 1) return `約 ${f} 倍`;
    if (f >= 0.1) return `剩約 ${Math.round(f * 10)} 成`;
    return '幾乎不會';
  }

  function clueChipHTML(c) {
    return `<span class="clue ${c.factor >= 1 ? 'up' : 'down'}">${c.factor >= 1 ? '↑' : '↓'} ${CLUE_TEXT[c.key].chip}</span>`;
  }

  function shapesHTML(t, visible) {
    return '<ul class="shapes">' + M.waitShapes(t, visible).map(sh => {
      let why = '';
      if (!sh.ok) {
        if (sh.kind === 'single') why = '他不可能有這張';
        else if (sh.kind === 'pair') why = '外面不到 2 張';
        else why = `${namesList(sh.blockedBy, 2)}四張都看得到`;
      }
      return `<li class="${sh.ok ? 'ok' : 'no'}"><span class="mark">${sh.ok ? '可能' : '擋住'}</span><span class="shape-name">${SHAPE_NAMES[sh.kind]}</span>${groupHTML(sh.tiles)}${why ? `<span class="hint">${why}</span>` : ''}</li>`;
    }).join('') + '</ul>';
  }

  function closedText(c) {
    return c.closed ? `中洞（${namesList(c.closed, 2)}）、` : '中洞、';
  }

  function whyHTML(t, ctx, p) {
    const clues = M.tileClues(t, { river: ctx.river, visible: ctx.visible, trickster: ctx.trickster });
    const list = clues.map(c => `<li>${clueChipHTML(c)}<span class="clue-factor">${factorText(c.factor)}</span><span>${CLUE_TEXT[c.key].say(c, t)}</span></li>`).join('');
    return `<details class="why"><summary>為什麼是 ${pct(p)}</summary>
      <p class="hint">誰能用什麼聽法胡${M.tileName(t)}：</p>
      ${shapesHTML(t, ctx.visible)}
      ${list ? `<ul class="clue-list">${list}</ul>` : '<p class="hint">沒有特別的線索，照一般機率。</p>'}
      <p class="hint">倍數來自 600 局電腦牌局的統計；${pct(p)} 是模型把所有線索一起算的結果。</p>
    </details>`;
  }

  // My tiles from safest to most dangerous, each with its reasons
  function dangerListHTML(kinds, prob, factor, ctx) {
    const rows = kinds.map(t => ({ t, p: prob[t] * factor })).sort((a, b) => a.p - b.p || a.t - b.t);
    const max = Math.max(0.01, ...rows.map(r => r.p));
    return '<ul class="dlist">' + rows.map(({ t, p }) => {
      const hit = ctx.actual && ctx.actual.includes(t);
      const chips = M.tileClues(t, { river: ctx.river, visible: ctx.visible, trickster: ctx.trickster }).map(clueChipHTML).join('');
      return `<li class="dl-row${hit ? ' hit' : ''}${ctx.chosen === t ? ' chosen' : ''}">
        ${tileHTML(t, { size: 'sm' })}
        <div class="dl-main">
          <span class="meter"><b style="width:${Math.round((p / max) * 100)}%"></b></span>
          <div class="dl-tags">${chips}${hit ? '<b class="badge hot">會放槍</b>' : ''}${ctx.chosen === t ? '<b class="badge warn">你打的</b>' : ''}</div>
        </div>
        <span class="dl-pct">${pct(p)}</span>
        ${whyHTML(t, ctx, p)}
      </li>`;
    }).join('') + '</ul>';
  }

  // 讀河: suit counts plus what the tapped discard tells you
  function riverReadHTML(river, called, selected, act, trickster) {
    const n = M.riverSuits(river);
    const notes = [];
    for (let s = 0; s < 3; s++) {
      const name = M.SUIT_NAMES[s] + '子';
      if (!n[s]) notes.push(`<b>${name}一張都沒打</b>，他手上可能很多，${name}要小心（約 1.7 倍）。`);
      else if (n[s] >= 5) notes.push(`${name}已經打了 ${n[s]} 張，比較安全（剩約 4 成）。`);
    }
    const tiles = river.map((t, i) => tileHTML(t, {
      size: 'sm', act, value: i, cls: [called.includes(i) ? 'called' : '', selected === i ? 'picked' : ''].join(' '),
      label: `看${M.tileName(t)}透露什麼`,
    })).join('');
    return `<div class="read-box">
      <p><b>他的河：</b>萬 ${n[0]}・筒 ${n[1]}・條 ${n[2]}・字 ${n[3]} 張。${notes.join('')}</p>
      <div class="tiles tight">${tiles}</div>
      ${selected == null || selected >= river.length ? '<p class="hint">點他河裡的牌，看那張透露什麼。</p>' : discardHintHTML(river, called, selected, trickster)}
    </div>`;
  }

  function discardHintHTML(river, called, i, trickster) {
    const c = M.discardClues(river, i);
    const name = M.tileName(c.tile);
    const lines = [];
    if (called.includes(i)) lines.push('這張被別人吃碰走了，但還是他打出來的牌，一樣能讀。');
    const signal = c.latest ? M.tenpaiSignal(c.tile, river.length) : null;
    if (signal) {
      const what = { middle: '三到七的中張', twoEight: '二或八', terminal: '一或九', honor: '字牌' }[signal.kind];
      const compare = signal.kind === 'honor' ? '打中張是 22%' : '打字牌只有 3%';
      lines.push(`<b>聽牌信號：</b>他第 ${river.length} 張打出${what}。電腦牌局裡，中盤打出${what}時有 ${pct(signal.chance)} 是剛好聽牌（${compare}）。`);
    }
    if (c.tile >= 27) {
      lines.push('字牌：通常只是在整理手牌，透露的不多。');
    } else if (c.latest) {
      lines.push(`<b>這是他最新打的牌。</b>旁邊 1–2 格的${namesList(c.neighbours, 4)}，在電腦牌局裡被聽的機率約一般牌的 2 倍：聽牌前拆掉的，常常是聽牌旁邊的搭子。`);
    } else if (c.early) {
      lines.push(`<b>前半段就打掉</b>，他很早就不要這一帶：旁邊的${namesList(c.neighbours, 4)}危險度剩約 6 成。`);
    } else {
      lines.push('後半段打的，但不是最新一張：電腦牌局裡，它旁邊的牌沒有比較安全，參考價值低。');
    }
    if (c.suji.length) {
      if (trickster) lines.push(`隔三格的${namesList(c.suji, 2)}看起來是筋，但這家會騙筋，不算數。`);
      else if (c.latest) lines.push(`<b>小心打五釣二：</b>隔三格的${namesList(c.suji, 2)}看起來是筋，但他剛打這張，這種筋被胡的時候一半以上是中洞。`);
      else lines.push(`隔三格的${namesList(c.suji, 2)}是筋，危險度剩約 6 成；但筋只擋兩面，中洞、單吊、對碰照樣會胡。`);
    }
    lines.push(`${name}本身是現物：電腦牌局裡幾乎不會是他聽的，但不是絕對安全。`);
    return `<div class="hint-note"><p class="hint-title">第 ${i + 1} 張・${name}</p><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul></div>`;
  }

  function renderDefense() {
    const d = S.df;
    $('#df-mode').innerHTML = segHTML('df-mode', [['sim', '模擬牌局'], ['manual', '自己輸入'], ['when', '何時棄胡']], d.mode);
    $('#df-sim').hidden = d.mode !== 'sim';
    $('#df-manual').hidden = d.mode !== 'manual';
    $('#df-when').hidden = d.mode !== 'when';
    if (d.mode === 'manual') return renderManual();
    if (d.mode === 'when') return renderWhen();
    if (!d.table && !d.loading) return newTable();
    $('#df-sim').innerHTML = simHTML();
  }

  actions['df-mode'] = v => { S.df.mode = v; renderDefense(); };

  // ---------- 模擬牌局 ----------
  const targetOf = tb => tb.players.find(p => p.seat === tb.target);

  function newTable() {
    const d = S.df;
    Object.assign(d, { loading: true, table: null, read: null, reads: {}, answer: null, picks: [], hint: null });
    renderDefense();
    // Let the loading state paint before the bots play, then read every opponent in the background
    setTimeout(() => {
      const tb = M.simulateTable(Math.random);
      d.table = tb;
      d.loading = false;
      if (S.tab === 'defense') renderDefense();
      const warm = seats => {
        if (!seats.length || d.table !== tb) return;
        readFor(seats[0]);
        setTimeout(() => warm(seats.slice(1)), 30);
      };
      setTimeout(() => warm([tb.target, ...tb.players.map(p => p.seat).filter(x => x !== tb.target)]), 30);
    }, 30);
  }

  function readFor(seat) {
    const d = S.df;
    if (!d.reads[seat]) {
      const p = d.table.players.find(x => x.seat === seat);
      d.reads[seat] = M.guessWaits({ river: p.river, melds: p.melds, visible: M.tableVisible(d.table) });
    }
    return d.reads[seat];
  }

  function ensureRead() {
    const d = S.df;
    if (d.table && !d.read) d.read = readFor(d.table.target);
    return d.read;
  }

  // The tenpai target for sure; the other two only as likely as their turn count and melds say
  function tableThreats(tb) {
    return tb.players.map(p => ({
      prob: readFor(p.seat).prob,
      tenpai: p.seat === tb.target ? 1 : M.tenpaiChance(p.river.length, p.melds.length),
    }));
  }

  function simHTML() {
    const d = S.df;
    const key = d.task === 'safe' ? 'pushfold' : 'guess';
    const st = S.stats[key];
    let stats;
    if (!st.n) stats = d.task === 'safe' ? '還沒開始。紀錄存在這台裝置上。' : '還沒開始。最多選 5 張，選到他真的聽的牌就算猜中。';
    else if (d.task === 'safe') stats = `打了 <b>${st.n}</b> 局・判斷正確 <b>${pct(st.good / st.n)}</b>・連續 <b>${st.streak}</b>（最高 ${st.best}）・放槍 ${st.dealt || 0} 次`;
    else stats = `猜了 <b>${st.n}</b> 局・有猜中 <b>${pct(st.good / st.n)}</b>`;
    const top = `<div class="drill-top">
        <div class="seg" role="group" aria-label="練什麼">${segHTML('df-task', [['safe', '攻守判斷'], ['guess', '猜他聽什麼']], d.task)}</div>
        <button type="button" class="btn ghost small" data-act="df-new">換一局</button>
      </div>
      <p class="stats">${stats}</p>`;
    if (d.loading || !d.table) return top + '<p class="loading">洗牌，四家打牌中…</p>';

    const tb = d.table;
    const tgt = targetOf(tb);
    // Claimed discards stay in the river, faded, so the discard order is still readable
    const riverRow = (name, river, called, melds, isTarget) => `
      <div class="river-row${isTarget ? ' target' : ''}">
        <div class="river-head"><b>${name}</b>${isTarget ? '<span class="badge hot">聽牌了</span>' : ''}<span class="hint">打了 ${river.length} 張</span></div>
        <div class="river-body">
          <div class="tiles tight">${river.map((t, i) => tileHTML(t, called.includes(i) ? { size: 'sm', cls: 'called', label: M.tileName(t) + '（被吃碰走）' } : { size: 'sm' })).join('')}</div>
          ${melds.length ? `<div class="river-melds">${melds.map(meldChipHTML).join('')}</div>` : ''}
        </div>
      </div>`;
    const rivers = tb.players.map(p => riverRow(p.name, p.river, p.called, p.melds, p.seat === tb.target)).join('') +
      riverRow('我', tb.myRiver, tb.myCalled, [], false);
    const read = `<h3>讀${tgt.name}的河</h3>${riverReadHTML(tgt.river, tgt.called, d.hint, 'df-hint')}`;
    const info = `<div class="table-info"><span>第 ${tgt.river.length} 巡</span><span>牌牆剩 ${tb.wallLeft} 張</span><span>電腦照牌效打，會吃碰，留中發白跟自己的風</span></div>`;
    const myHand = M.sortTiles(tb.me);

    let body;
    if (d.task === 'safe' && !d.answer) {
      body = `<p class="prompt">輪到你，剛摸完牌。${tgt.name}聽牌了，攻還是守？打哪張？</p>
        <div class="tiles">${myHand.map(t => tileHTML(t, { act: 'df-safe', label: '打' + M.tileName(t) })).join('')}</div>
        <p class="hint">最好的打法不一定是最安全的：自己的牌夠好就該衝。淡掉的牌是被吃碰走的。</p>`;
    } else if (d.task === 'safe') {
      body = safeRevealHTML();
    } else if (!d.answer) {
      const visible = M.tableVisible(tb);
      const cell = t => {
        const on = d.picks.includes(t);
        return tileHTML(t, { act: 'df-pick', pressed: on, cls: on ? 'picked' : '', disabled: visible[t] >= 4, label: (on ? '取消' : '選') + M.tileName(t) });
      };
      const rows = [[0, 9], [9, 18], [18, 27], [27, 34]].map(([a, b]) => {
        const cells = [];
        for (let t = a; t < b; t++) cells.push(cell(t));
        return `<div class="palette-row">${cells.join('')}</div>`;
      }).join('');
      body = `<div class="slot"><span class="slot-label">我的手牌</span><div class="tiles tight">${myHand.map(t => tileHTML(t, { size: 'sm' })).join('')}</div></div>
        <p class="prompt">${tgt.name}聽牌了。他最可能聽哪幾張？</p>
        <div class="palette">${rows}</div>
        <div class="drill-actions">
          <button type="button" class="btn" data-act="df-guess-check">對答案</button>
          <span class="hint">選了 ${d.picks.length} / 5 張</span>
        </div>`;
    } else {
      body = guessRevealHTML();
    }
    return top + info + `<div class="rivers">${rivers}</div>` + read + body;
  }

  function meldChipHTML(m) {
    return `<span class="meld">${groupHTML(M.meldTiles(m))}<span class="meld-tag">${MELD_NAMES[m.type]}</span></span>`;
  }

  function handsRevealHTML(tb) {
    return '<div class="reveal">' + tb.players
      .filter(p => p.seat === tb.target || p.waits.length)
      .map(p => `<div class="reveal-row"><b>${p.name}</b>${groupHTML(p.hand)}${p.melds.map(meldChipHTML).join('')}<span class="hint">聽</span>${groupHTML(p.waits)}</div>`)
      .join('') + '</div>';
  }

  const signed = v => `${v >= 0 ? '+' : '−'}${money(Math.round(Math.abs(v)))}`;

  function afterText(r) {
    if (r.shanten === 0) return r.useful ? `聽牌 ${r.waits.length} 種 ${r.useful} 張` : '聽牌，但等的牌都看不到了';
    return `${shantenName(r.shanten)}，進張 ${r.useful} 張`;
  }

  // Why the best play attacks or folds
  function planReasonHTML(pf) {
    const best = pf.best;
    const loss = money(Math.round(pf.loss));
    if (best.plan === 'push' && best.dealIn < 0.01) {
      return `這手可以<b>邊守邊攻</b>：打${M.tileName(best.tile)}幾乎不會放槍，打完還是${afterText(best)}，有人聽牌時胡牌率約 ${pct(best.win)}，不用急著棄胡。`;
    }
    if (best.plan === 'push') {
      return `這手該<b>攻</b>：打${M.tileName(best.tile)}之後${afterText(best)}，有人聽牌時最後胡牌的機率約 ${pct(best.win)}，胡了平均收 ${money(Math.round(best.gain))} 元；放槍一次大約賠 ${loss} 元。打這張放槍的機率 ${pct(best.dealIn)}，值得冒。`;
    }
    // The best you could do by attacking anyway
    const top = pf.rows.reduce((a, r) => {
      const v = -r.dealIn * pf.loss + (1 - r.dealIn) * r.attack;
      return !a || v > a.v ? { r, v } : a;
    }, null);
    return `這手該<b>守</b>：最好的攻法是打${M.tileName(top.r.tile)}（打完${afterText(top.r)}），但胡牌率只有 ${pct(top.r.win)}，繼續衝之後還有 ${pct(top.r.pushLater)} 會放槍，期望值 ${signed(top.v)} 元。改打${M.tileName(best.tile)}守住，期望值 ${signed(best.ev)} 元（守了之後還是有約 ${pct(pf.foldLater)} 會放槍，安全牌可能用完）。`;
  }

  // Every discard ranked by expected money, with the danger reasons folded in
  function pushFoldListHTML(pf, ctx) {
    return '<ul class="dlist">' + pf.rows.map((r, i) => {
      const t = r.tile;
      const hit = ctx.actual && ctx.actual.includes(t);
      const chips = M.tileClues(t, { river: ctx.river, visible: ctx.visible, trickster: ctx.trickster }).map(clueChipHTML).join('');
      const isBest = r.ev >= pf.best.ev - ctx.tolerance;
      return `<li class="dl-row pf-row${isBest ? ' best' : ''}${hit ? ' hit' : ''}${ctx.chosen === t ? ' chosen' : ''}">
        ${tileHTML(t, { size: 'sm' })}
        <div class="dl-main">
          <div class="pf-line"><span class="plan ${r.plan}">${r.plan === 'push' ? '攻' : '守'}</span><span>放槍 ${pct(r.dealIn)}</span><span>打完${afterText(r)}</span>${r.plan === 'push' ? `<span>胡牌率 ${pct(r.win)}</span>` : ''}</div>
          <div class="dl-tags">${chips}${isBest ? '<b class="badge">最佳</b>' : ''}${hit ? '<b class="badge hot">會放槍</b>' : ''}${ctx.chosen === t ? '<b class="badge warn">你打的</b>' : ''}</div>
        </div>
        <span class="dl-pct ev ${r.ev >= 0 ? 'plus' : 'minus'}">${signed(r.ev)}<small>元</small></span>
        ${whyHTML(t, ctx, r.dealIn)}
      </li>`;
    }).join('') + '</ul>';
  }

  function safeRevealHTML() {
    const d = S.df;
    const tb = d.table;
    const a = d.answer;
    const pf = a.pf;
    const visible = M.tableVisible(tb);
    const actual = [...new Set(tb.players.flatMap(p => p.waits))];
    const chosen = pf.rows.find(r => r.tile === a.tile);
    const name = M.tileName(a.tile);
    const big = { good: chosen === pf.best ? '最佳解！' : '判斷正確！', ok: '差一點', bad: '可惜' }[a.grade];
    const truth = a.dealtTo.length ? `實際上打${name}放槍給${a.dealtTo.join('、')}了。` : `實際上打${name}沒放槍。`;
    return `<div class="feedback ${a.grade}"><p class="big">${big}</p>
        <p>你打${name}：期望值 ${signed(chosen.ev)} 元。最佳是打${namesList(pf.rows.filter(r => r.ev >= pf.best.ev - a.tolerance).map(r => r.tile), 3)}：${signed(pf.best.ev)} 元。</p>
        <p>${planReasonHTML(pf)}</p>
        <p class="hint">${truth}結果好壞有運氣，判斷看的是期望值。</p>
      </div>
      ${handsRevealHTML(tb)}
      <h3>每張牌的攻守（照台數頁的底 ${money(S.sc.base)}／每台 ${money(S.sc.perTai)}，你是莊家）</h3>
      ${pushFoldListHTML(pf, { river: targetOf(tb).river, visible, actual, chosen: a.tile, tolerance: a.tolerance })}
      <p class="hint">期望值 ＝ 胡牌率 × 胡了收的錢 − 放槍率 × 放槍賠的錢 − 之後再放槍的風險。別人自摸要付的錢不管攻守都一樣，沒算進去。胡牌率、之後放槍的機率、平均台數都是電腦牌局量的。</p>
      <div class="drill-actions"><button type="button" class="btn" data-act="df-new">下一局</button></div>`;
  }

  function guessRevealHTML() {
    const d = S.df;
    const tb = d.table;
    const tgt = targetOf(tb);
    const read = ensureRead();
    const visible = M.tableVisible(tb);
    const hits = d.picks.filter(t => tgt.waits.includes(t));
    const order = [...Array(M.KINDS).keys()].sort((a, b) => read.prob[b] - read.prob[a]).slice(0, 5);
    const modelHits = order.filter(t => tgt.waits.includes(t)).length;
    const picks = d.picks.map(t => tileHTML(t, { size: 'sm', cls: tgt.waits.includes(t) ? 'mark-good' : 'mark-bad' })).join('');
    const sub = `${tgt.name}聽${namesList(tgt.waits, 9)}。模型前 5 名是${namesList(order, 5)}，猜中 ${modelHits} 張。`;
    return `<div class="feedback ${hits.length ? 'good' : 'bad'}"><p class="big">${hits.length ? `猜中 ${hits.length} 張！` : '沒猜中'}</p><p>${sub}</p></div>
      <div class="reveal-row"><b>你選的</b><span class="tiles tight">${picks}</span></div>
      ${handsRevealHTML(tb)}
      <h3>他聽每張牌的機率（模型估計，紅框是答案）</h3>
      ${heatGridHTML(read.prob, visible, tgt.waits)}
      <p class="hint">猜中聽牌本來就難，模型自己前 5 名也只有不到 4 成猜得到。真正有用的是反過來看：機率低的牌比較能打。</p>
      <div class="drill-actions"><button type="button" class="btn" data-act="df-new">下一局</button></div>`;
  }

  actions['df-task'] = v => { S.df.task = v; newTable(); };
  actions['df-hint'] = v => { S.df.hint = S.df.hint === Number(v) ? null : Number(v); renderDefense(); };
  actions['df-new'] = () => newTable();
  actions['df-safe'] = v => {
    const d = S.df;
    if (d.answer || !d.table) return;
    const tile = Number(v);
    const tb = d.table;
    ensureRead();
    const pf = M.pushFold({
      hand: tb.me, visible: M.tableVisible(tb), wallLeft: tb.wallLeft, threats: tableThreats(tb),
      base: S.sc.base, perTai: S.sc.perTai, dealer: true, seatWind: 0, roundWind: tb.roundWind,
    });
    const chosen = pf.rows.find(r => r.tile === tile);
    // Differences of a few 元 are noise; treat them as equally good
    const tolerance = Math.max(3, 0.03 * pf.loss);
    let grade = 'bad';
    if (chosen.ev >= pf.best.ev - tolerance) grade = 'good';
    else if (chosen.ev >= pf.best.ev - Math.max(10, 0.12 * pf.loss)) grade = 'ok';
    const dealtTo = tb.players.filter(p => p.waits.includes(tile)).map(p => p.name);
    d.answer = { tile, dealtTo, pf, grade, tolerance };
    record('pushfold', grade === 'good');
    if (dealtTo.length) {
      S.stats.pushfold.dealt = (S.stats.pushfold.dealt || 0) + 1;
      store.set('stats', S.stats);
    }
    renderDefense();
  };
  actions['df-pick'] = v => {
    const t = Number(v);
    const i = S.df.picks.indexOf(t);
    if (i >= 0) S.df.picks.splice(i, 1);
    else if (S.df.picks.length >= 5) return toast('最多選 5 張');
    else S.df.picks.push(t);
    renderDefense();
  };
  actions['df-guess-check'] = () => {
    const d = S.df;
    if (!d.picks.length) return toast('先點你覺得他聽的牌');
    ensureRead();
    d.answer = { guess: true };
    record('guess', d.picks.some(t => targetOf(d.table).waits.includes(t)));
    renderDefense();
  };

  // ---------- 何時棄胡 ----------
  const OPP_TAI = [['1.3', '一般（約 1 台）'], ['3', '3 台'], ['5', '5 台'], ['8', '8 台以上']];
  const WHEN_ROWS = [
    ['聽牌，外面 7 張以上能胡', 0, 8], ['聽牌，5–6 張', 0, 5.5], ['聽牌，3–4 張', 0, 3.5], ['聽牌，1–2 張', 0, 1.5],
    ['一近聽，進張 31 張以上', 1, 35], ['一近聽，進張 21–30', 1, 25], ['一近聽，進張 11–20', 1, 15], ['一近聽，進張 10 以下', 1, 6],
    ['二近聽', 2, 30], ['三近聽以上', 3, 40],
  ];
  const WHEN_COLS = [0.01, 0.03, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4];

  // Grid of attack/fold for each hand state against the danger of the tile you would cut
  function renderWhen() {
    const w = S.dw;
    const row = (label, body) => `<div class="cond"><span>${label}</span><span class="cond-body">${body}</span></div>`;
    const lines = WHEN_ROWS.map(([name, sh, useful]) => {
      const r = M.foldThreshold({ shanten: sh, useful, wallLeft: w.wall, base: S.sc.base, perTai: S.sc.perTai, oppTai: w.oppTai, dealer: w.dealer });
      // Attack minus fold when the tile you cut deals in with chance d (folding throws a safe tile)
      const edge = d => -d * r.loss + (1 - d) * r.attack - r.fold;
      const tol = Math.max(3, 0.03 * r.loss);
      // The grid is in "if he is tenpai" terms; doubt about his tenpai stretches the bar
      return { name, r, edge, tol, bar: Math.min(1, r.threshold / w.sure), clearFold: edge(0) < -tol };
    });
    const cells = lines.map(l => `<tr><th scope="row">${l.name}</th>${WHEN_COLS.map(c => {
      const e = l.edge(c * w.sure);
      const [cls, text] = e > l.tol ? ['push', '攻'] : e < -l.tol ? ['fold', '守'] : ['even', '≈'];
      return `<td class="${cls}" title="攻比守${e >= 0 ? '多' : '少'} ${money(Math.round(Math.abs(e)))} 元">${text}</td>`;
    }).join('')}<td class="bar">${l.clearFold ? '一律守' : l.bar >= 0.995 ? '都能衝' : pct(l.bar)}</td></tr>`).join('');

    const always = lines.filter(l => l.clearFold).map(l => l.name);
    const close = lines.filter(l => !l.clearFold && l.bar < 0.03).map(l => l.name);
    const brave = lines.filter(l => !l.clearFold && l.bar >= 0.03);
    const summary = [];
    if (always.length) summary.push(`<b>一律棄胡：</b>${always.join('、')}。就算要打的那張很安全，繼續攻也不划算，改打安全牌。`);
    if (close.length) summary.push(`<b>差不多：</b>${close.join('、')}。攻守的期望值很接近，要打的那張只要有點危險就守。`);
    if (brave.length) summary.push(`<b>還能攻的：</b>${brave.map(l => `${l.name}（那張放槍率 ${pct(l.bar)} 以下）`).join('、')}。`);
    const one = lines[0].r;
    summary.push(`這個設定下，胡一把平均收約 ${money(Math.round(one.gain))} 元，放槍一次約賠 ${money(Math.round(one.loss))} 元；棄胡之後還是有約 ${pct(-one.fold / one.loss)} 會放槍。`);

    $('#df-when').innerHTML = `
      <div class="view-head"><h3>什麼時候該放棄胡牌</h3>
        <p class="hint">有人聽牌了，你要攻就得打一張危險牌。表格告訴你：照你離胡牌多近、那張牌多危險，攻和守哪個期望值高。</p></div>
      <div class="conds">
        ${row('牌牆還剩', `<span class="seg">${segHTML('dw-wall', [['40', '40 張（前段）'], ['28', '28（中段）'], ['16', '16（後段）'], ['6', '6（尾段）']], w.wall)}</span>`)}
        ${row('他這手大概', `<span class="seg">${segHTML('dw-opp', OPP_TAI, w.oppTai)}</span>`)}
        ${row('他聽了嗎', `<span class="seg">${segHTML('dw-sure', [['1', '確定聽了'], ['0.5', '一半一半'], ['0.25', '不太像']], w.sure)}</span>`)}
        ${row('', `<button type="button" class="chip" data-act="dw-dealer" aria-pressed="${w.dealer}">我是莊家</button><span class="hint">底台照台數頁：${money(S.sc.base)}／${money(S.sc.perTai)}</span>`)}
      </div>
      <div class="table-wrap">
        <table class="when-table">
          <thead><tr><th scope="col">打完之後，你</th>${WHEN_COLS.map(c => `<th scope="col">${pct(c)}</th>`).join('')}<th scope="col">最多能冒</th></tr></thead>
          <tbody>${cells}</tbody>
        </table>
      </div>
      <p class="hint">欄位是「要打的那張，如果他聽了會放槍的機率」，防守頁每張牌都有。攻：照牌效打下去；守：從這張開始打安全牌、放棄胡牌；≈：差不到放槍金額的 3%。</p>
      <div class="when-summary">${summary.map(x => `<p>${x}</p>`).join('')}</div>`;
  }

  actions['dw-wall'] = v => { S.dw.wall = Number(v); renderWhen(); };
  actions['dw-opp'] = v => { S.dw.oppTai = Number(v); renderWhen(); };
  actions['dw-sure'] = v => { S.dw.sure = Number(v); renderWhen(); };
  actions['dw-dealer'] = () => { S.dw.dealer = !S.dw.dealer; renderWhen(); };

  // ---------- 自己輸入 ----------
  const DM_TARGETS = [['river', '他的河'], ['chow', '他吃'], ['pung', '他碰'], ['kong', '他槓'], ['mine', '我的手牌'], ['seen', '其他已見']];
  const DM_HINTS = {
    river: '照順序點他打出的牌。',
    chow: '他吃：點順子最小的那張。',
    pung: '他碰：點碰的那張牌。',
    kong: '他槓：點槓的那張牌。',
    mine: '點你手上的牌（16 或 17 張）。',
    seen: '其他家的河、吃碰，還有你自己打過的牌。',
  };
  let readTimer = null;

  function manualVisible() {
    const m = S.dm;
    const c = M.toCounts(m.river.concat(m.mine));
    for (const meld of m.melds) for (const t of M.meldTiles(meld)) c[t]++;
    for (let t = 0; t < M.KINDS; t++) c[t] += m.seen[t];
    return c;
  }

  function renderManual() {
    const m = S.dm;
    const used = manualVisible();
    $('#dm-target').innerHTML = segHTML('dm-target', DM_TARGETS, m.target);
    const seenTiles = [];
    let seenTotal = 0;
    for (let t = 0; t < M.KINDS; t++) {
      if (!m.seen[t]) continue;
      seenTotal += m.seen[t];
      seenTiles.push(`<span class="mt">${tileHTML(t, { size: 'sm', act: 'dm-unsee', label: '拿掉一張' + M.tileName(t) })}<i>×${m.seen[t]}</i></span>`);
    }
    const melds = m.melds.map((meld, i) =>
      `<button type="button" class="meld" data-act="dm-remove-meld" data-v="${i}" aria-label="拿掉這組${MELD_NAMES[meld.type]}">` +
      `${groupHTML(M.meldTiles(meld))}<span class="meld-tag">${MELD_NAMES[meld.type]}</span></button>`);
    const empty = text => `<span class="empty-slot">${text}</span>`;
    $('#dm-builder').innerHTML = `
      <div class="slot">
        <div class="slot-head">
          <span class="slot-label">他的河</span><span class="slot-count">${m.river.length} 張</span>
          ${m.example ? '<span class="example-tag">範例</span>' : ''}
          <span class="slot-actions"><button type="button" class="btn ghost small" data-act="dm-clear">全部清空</button></span>
        </div>
        <div class="tiles tight">${m.river.map((t, i) => tileHTML(t, { size: 'sm', act: 'dm-remove-river', value: i, label: '拿掉' + M.tileName(t) })).join('') || empty('照順序點他打出的牌')}</div>
      </div>
      ${melds.length ? `<div class="slot"><div class="slot-head"><span class="slot-label">他吃碰槓</span><span class="slot-count">${melds.length} 組</span></div><div class="tiles">${melds.join('')}</div></div>` : ''}
      <div class="slot">
        <div class="slot-head"><span class="slot-label">我的手牌</span><span class="slot-count">${m.mine.length} 張</span></div>
        <div class="tiles tight">${M.sortTiles(m.mine).map(t => tileHTML(t, { size: 'sm', act: 'dm-remove-mine', label: '拿掉' + M.tileName(t) })).join('') || empty('放進來就會算每張的放槍機率')}</div>
      </div>
      <div class="slot">
        <div class="slot-head"><span class="slot-label">其他已見</span><span class="slot-count">${seenTotal} 張</span></div>
        ${seenTiles.length ? `<div class="tiles tight">${seenTiles.join('')}</div>` : '<p class="hint">其他家的河、吃碰，還有你打過的牌。看到越多，算得越準。</p>'}
      </div>`;
    const disable = {
      chow: t => !M.isValidChowStart(t) || used[t + 1] >= 4 || used[t + 2] >= 4,
      pung: t => used[t] > 1,
      kong: t => used[t] > 0,
    }[m.target];
    $('#dm-palette').innerHTML = `<p class="hint">${DM_HINTS[m.target]}</p>${paletteHTML('dm-add', used, disable)}`;
    scheduleRead();
  }

  // The model takes a moment, so recompute shortly after the last change
  function scheduleRead() {
    const m = S.dm;
    m.read = m.read && { prob: m.read.prob, stale: true };
    renderManualResult();
    clearTimeout(readTimer);
    readTimer = setTimeout(() => {
      if (!m.river.length && !m.melds.length) return;
      m.read = M.guessWaits({ river: m.river, melds: m.melds, visible: manualVisible(), trickster: m.trickster });
      renderManualResult();
    }, 250);
  }

  function renderManualResult() {
    const m = S.dm;
    const el = $('#dm-result');
    if (!m.river.length && !m.melds.length) {
      el.innerHTML = verdictHTML('等你輸入', '', null, '先輸入要防的那家打過的牌，有吃碰也放進來。');
      return;
    }
    if (!m.read) {
      el.innerHTML = '<p class="loading">計算中…</p>';
      return;
    }
    const visible = manualVisible();
    const pT = M.tenpaiChance(m.river.length, m.melds.length);
    const order = [...Array(M.KINDS).keys()].filter(t => visible[t] < 4).sort((a, b) => m.read.prob[b] - m.read.prob[a]).slice(0, 4);
    const likely = order.map(t => `${M.tileName(t)} ${pct(m.read.prob[t])}`).join('、');
    const kinds = [...new Set(m.mine)];
    el.innerHTML = `<div class="result-body${m.read.stale ? ' computing' : ''}">
      <div class="verdict">
        <span class="status">打了 ${m.river.length} 張・吃碰 ${m.melds.length} 組</span>
        <p class="big">最可能聽 ${namesList(order.slice(0, 2), 2)}</p>
        <p class="sub">如果他聽了：${likely}。他現在已經聽牌的機率約 ${pct(pT)}（照 2,400 局電腦牌局的巡目跟吃碰組數估的）。</p>
      </div>
      <h3>讀他的河</h3>
      <div class="chips"><button type="button" class="chip" data-act="dm-trick" aria-pressed="${!!m.trickster}">這家會騙筋（打五釣二）</button></div>
      ${riverReadHTML(m.river, [], m.hint, 'dm-hint', m.trickster)}
      ${manualDecisionHTML(kinds, visible, pT)}
      <h3>他聽每張牌的機率</h3>
      ${heatGridHTML(m.read.prob, visible, null)}
    </div>`;
  }

  // 17 tiles (just drew): rank discards by expected money; otherwise just the danger
  function manualDecisionHTML(kinds, visible, pT) {
    const m = S.dm;
    if (!kinds.length) return '';
    if (m.mine.length !== 17) {
      return `<h3>我的牌：如果他聽了，打出去會放槍的機率</h3>
        ${dangerListHTML(kinds, m.read.prob, 1, { river: m.river, visible, trickster: m.trickster })}
        <p class="hint">只算這一家。他還沒聽的話，實際風險再乘上 ${pct(pT)}。放滿 17 張（剛摸完牌）就會幫你算攻還是守。</p>`;
    }
    const wallLeft = Math.max(0, 56 - 4 * m.river.length);
    const pf = M.pushFold({
      hand: m.mine, visible, wallLeft, threats: [{ prob: m.read.prob, tenpai: pT }],
      base: S.sc.base, perTai: S.sc.perTai, dealer: m.dealer, seatWind: m.dealer ? 0 : 1, oppTai: m.oppTai,
    });
    const tolerance = Math.max(3, 0.03 * pf.loss);
    return `<h3>攻還是守：打哪張</h3>
      <div class="cond"><span>他這手大概</span><span class="seg">${segHTML('dm-opp', OPP_TAI, m.oppTai)}</span></div>
      <div class="chips"><button type="button" class="chip" data-act="dm-dealer" aria-pressed="${m.dealer}">我是莊家</button></div>
      <p>${planReasonHTML(pf)}</p>
      ${pushFoldListHTML(pf, { river: m.river, visible, tolerance, trickster: m.trickster })}
      <p class="hint">只算這一家，他聽牌的機率用 ${pct(pT)}。牌牆大約剩 ${wallLeft} 張（照他打了幾張估）。底台照台數頁：${money(S.sc.base)}／${money(S.sc.perTai)}。</p>`;
  }

  function touchManual() {
    S.dm.example = false;
    renderManual();
  }

  actions['dm-target'] = v => { S.dm.target = v; renderManual(); };
  actions['dm-dealer'] = () => { S.dm.dealer = !S.dm.dealer; renderManualResult(); };
  actions['dm-trick'] = () => { S.dm.trickster = !S.dm.trickster; scheduleRead(); };
  actions['dm-opp'] = v => { S.dm.oppTai = Number(v); renderManualResult(); };
  actions['dm-hint'] = v => { S.dm.hint = S.dm.hint === Number(v) ? null : Number(v); renderManualResult(); };
  actions['dm-add'] = v => {
    const m = S.dm;
    const t = Number(v);
    if (m.target === 'river') m.river.push(t);
    else if (m.target === 'mine') {
      if (m.mine.length >= 17) return toast('手牌最多 17 張');
      m.mine.push(t);
    } else if (m.target === 'seen') m.seen[t]++;
    else {
      if (m.melds.length >= 5) return toast('最多 5 組');
      m.melds.push({ type: m.target, tile: t });
    }
    touchManual();
  };
  actions['dm-remove-river'] = v => { S.dm.river.splice(Number(v), 1); touchManual(); };
  actions['dm-remove-meld'] = v => { S.dm.melds.splice(Number(v), 1); touchManual(); };
  actions['dm-remove-mine'] = v => {
    const i = S.dm.mine.lastIndexOf(Number(v));
    if (i >= 0) S.dm.mine.splice(i, 1);
    touchManual();
  };
  actions['dm-unsee'] = v => { S.dm.seen[Number(v)]--; touchManual(); };
  actions['dm-clear'] = () => {
    Object.assign(S.dm, { river: [], melds: [], mine: [], seen: zeros(), read: null, target: 'river' });
    touchManual();
  };

  // ============================================================
  // 台數 (scoring + settlement)
  // ============================================================
  const scNeed = () => 16 - 3 * S.sc.melds.length;
  const SC_TARGETS = [['hand', '手牌'], ['win', '胡的牌'], ['chow', '吃'], ['pung', '碰'], ['kong', '明槓'], ['ankan', '暗槓'], ['flower', '花']];
  const SC_HINTS = {
    hand: '點牌放進手牌（不含胡的那張）。',
    win: '點你胡的那一張。',
    chow: '吃：點順子最小的那張，例如點三萬就是三四五萬。',
    pung: '碰：點碰的那張牌。',
    kong: '明槓：點槓的那張牌（含加槓）。',
    ankan: '暗槓：點自己摸齊四張的那張牌。',
    flower: '點你亮出來的花，再點一次拿掉。',
  };

  function scUsed() {
    const s = S.sc;
    const c = M.toCounts(s.hand);
    if (s.winTile != null) c[s.winTile]++;
    for (const m of s.melds) for (const t of M.meldTiles(m)) c[t]++;
    return c;
  }

  // Effective extra conditions (hidden ones never count)
  function scFlags() {
    const s = S.sc;
    const dealer = s.seatWind === 0;
    return {
      lastTile: s.lastTile,
      kongBloom: s.kongBloom && s.selfDraw,
      robKong: s.robKong && !s.selfDraw,
      heavenly: s.heavenly && s.selfDraw && dealer,
      earthly: s.earthly && s.selfDraw && !dealer,
    };
  }

  function renderScore() {
    const s = S.sc;
    const need = scNeed();
    const used = scUsed();

    $('#sc-target').innerHTML = segHTML('sc-target', SC_TARGETS, s.target);

    const hand = M.sortTiles(s.hand).map(t => tileHTML(t, { act: 'sc-remove', label: '拿掉' + M.tileName(t) }));
    const win = s.winTile == null
      ? '<span class="empty-slot">還沒選</span>'
      : tileHTML(s.winTile, { act: 'sc-remove-win', label: '拿掉胡的牌' + M.tileName(s.winTile), cls: 'picked' });
    const melds = s.melds.map((m, i) =>
      `<button type="button" class="meld" data-act="sc-remove-meld" data-v="${i}" aria-label="拿掉這組${MELD_NAMES[m.type]}">` +
      `${groupHTML(M.meldTiles(m))}<span class="meld-tag">${MELD_NAMES[m.type]}</span></button>`);
    const flowers = M.sortTiles(s.flowers).map(f => flowerHTML(f, { act: 'sc-flower', size: 'sm', label: '拿掉' + M.FLOWER_NAMES[f] }));

    $('#sc-builder').innerHTML = `
      <div class="slot">
        <div class="slot-head">
          <span class="slot-label">手牌</span>
          <span class="slot-count${s.hand.length === need ? ' full' : ''}">${s.hand.length} / ${need} 張</span>
          ${s.example ? '<span class="example-tag">範例</span>' : ''}
          <span class="slot-actions"><button type="button" class="btn ghost small" data-act="sc-clear">清空重來</button></span>
        </div>
        <div class="tiles">${hand.join('') || '<span class="empty-slot">點下面的牌放進來</span>'}</div>
      </div>
      <div class="slot-pair">
        <div class="slot">
          <div class="slot-head"><span class="slot-label">胡的牌</span></div>
          <div class="tiles">${win}</div>
        </div>
        <div class="slot">
          <div class="slot-head"><span class="slot-label">花</span><span class="slot-count">${s.flowers.length} 張</span></div>
          <div class="tiles tight">${flowers.join('') || '<span class="empty-slot">沒有花</span>'}</div>
        </div>
      </div>
      ${melds.length ? `<div class="slot"><div class="slot-head"><span class="slot-label">吃碰槓</span><span class="slot-count">${melds.length} 組</span></div><div class="tiles">${melds.join('')}</div></div>` : ''}`;

    let palette;
    if (s.target === 'flower') {
      const cells = [];
      for (let f = 0; f < 8; f++) {
        const on = s.flowers.includes(f);
        cells.push(flowerHTML(f, { act: 'sc-flower', pressed: on, cls: on ? 'picked' : '' }));
      }
      palette = `<div class="palette-row">${cells.join('')}</div>`;
    } else {
      const disable = {
        chow: t => !M.isValidChowStart(t) || used[t + 1] >= 4 || used[t + 2] >= 4,
        pung: t => used[t] > 1,
        kong: t => used[t] > 0,
        ankan: t => used[t] > 0,
      }[s.target];
      palette = paletteHTML('sc-add', used, disable);
    }
    $('#sc-palette').innerHTML = `<p class="hint">${SC_HINTS[s.target]}</p>${palette}`;

    renderScoreConds();
    renderScoreResult();
  }

  function renderScoreConds() {
    const s = S.sc;
    const dealer = s.seatWind === 0;
    const winds = M.WIND_NAMES;
    const row = (label, body) => `<div class="cond"><span>${label}</span><span class="cond-body">${body}</span></div>`;
    const chip = (key, label) => `<button type="button" class="chip" data-act="sc-flag" data-v="${key}" aria-pressed="${!!s[key]}">${label}</button>`;

    const extras = [chip('lastTile', s.selfDraw ? '海底撈月' : '河底撈魚')];
    if (s.selfDraw) extras.push(chip('kongBloom', '槓上開花'));
    else extras.push(chip('robKong', '搶槓'));
    if (s.selfDraw && dealer) extras.push(chip('heavenly', '天胡'));
    if (s.selfDraw && !dealer) extras.push(chip('earthly', '地胡'));

    let html = '';
    html += row('胡法', `<span class="seg">${segHTML('sc-self', [['1', '自摸'], ['0', '別人放槍']], s.selfDraw ? '1' : '0', () => !!s.special)}</span>`);
    html += row('我的門風', `<span class="seg">${segHTML('sc-seat', winds.map((w, i) => [i, i === 0 ? '東（莊家）' : w]), s.seatWind)}</span>`);
    html += row('現在是', `<span class="seg">${segHTML('sc-round', winds.map((w, i) => [i, w + '風圈']), s.roundWind)}</span>`);
    if (!s.selfDraw && !dealer) {
      const who = s.special === 'sevenRobOne' ? '被搶的是' : '放槍的是';
      html += row(who, `<span class="seg">${segHTML('sc-discarder', [['1', '莊家'], ['0', '閒家']], s.discarderIsDealer ? '1' : '0')}</span>`);
    }
    html += row('莊家連莊', `<span class="stepper">
        <button type="button" data-act="sc-streak" data-v="-1" aria-label="少連一次">−</button>
        <output>${s.streak}</output>
        <button type="button" data-act="sc-streak" data-v="1" aria-label="多連一次">＋</button>
        <span class="hint">${s.streak ? `連${s.streak}拉${s.streak}` : '剛當莊'}</span>
      </span>`);
    html += row('加台', `<span class="chips">${extras.join('')}</span>`);
    html += row('花胡', `<span class="seg">${segHTML('sc-special', [['', '沒有'], ['eightFlowers', '八仙過海'], ['sevenRobOne', '七搶一']], s.special)}</span>`);
    $('#sc-conds').innerHTML = html;
  }

  function renderScoreResult() {
    const s = S.sc;
    const el = $('#sc-result');
    const dealer = s.seatWind === 0;
    const input = Object.assign({
      hand: s.hand, winTile: s.winTile, melds: s.melds, flowers: s.flowers, selfDraw: s.selfDraw,
      seatWind: s.seatWind, roundWind: s.roundWind, special: s.special || undefined,
    }, scFlags());
    const r = M.scoreHand(input, S.rules);
    if (r.error) {
      el.innerHTML = verdictHTML('還不能算', '', null, r.error);
      return;
    }

    const dTai = M.dealerTai(s.streak, S.rules);
    const discarderIsDealer = !dealer && !s.selfDraw && s.discarderIsDealer;
    const pay = M.settle({
      tai: r.total, dealerTai: dTai, selfDraw: s.selfDraw, winnerIsDealer: dealer, discarderIsDealer,
      base: s.base, perTai: s.perTai,
    });

    let dealerNote = '';
    if (dealer) dealerNote = '你是莊家，每家都要加';
    else if (s.selfDraw) dealerNote = '只有莊家那份要加';
    else if (discarderIsDealer) dealerNote = '莊家放槍，要加';
    const streakText = s.streak ? `・連${s.streak}拉${s.streak}` : '';

    const items = r.items.map(it => `<li><span>${it.name}</span><span>${it.tai} 台</span></li>`);
    if (!items.length) items.push('<li><span>沒有台（屁胡）</span><span>0 台</span></li>');
    if (dealerNote && dTai) items.push(`<li class="cond-item"><span>莊家${streakText}（${dealerNote}）</span><span>${dTai} 台</span></li>`);

    let reading = '';
    if (r.reading && r.reading.groups) {
      const groups = r.reading.groups.map(g => {
        const n = g.type === 'chow' ? null : g.kong ? 4 : 3;
        const list = n ? new Array(n).fill(g.tile) : [g.tile, g.tile + 1, g.tile + 2];
        return `<span class="meld">${groupHTML(list)}<span class="meld-tag">${g.type === 'chow' ? '順' : g.concealed ? '暗刻' : '明刻'}</span></span>`;
      });
      groups.push(`<span class="meld">${groupHTML([r.reading.pair, r.reading.pair])}<span class="meld-tag">眼</span></span>`);
      reading = `<div class="reading">${groups.join('')}</div>`;
    } else if (r.reading && r.reading.ligu) {
      reading = '<p>嚦咕嚦咕：七對加一刻。</p>';
    }
    const waits = r.waits && r.waits.length
      ? `<p>胡之前聽 ${r.waits.length} 種：</p><div class="tiles tight">${r.waits.map(t => tileHTML(t, { size: 'sm' })).join('')}</div>`
      : '';

    el.innerHTML = `
      <div class="score-top"><span class="big">${r.total}</span><span class="unit">台</span>${dealerNote && dTai ? `<span class="status">另加莊家 ${dTai} 台</span>` : ''}</div>
      <ul class="items">${items.join('')}</ul>
      <h3>算錢・底 ${money(s.base)}／每台 ${money(s.perTai)}</h3>
      <ul class="pay">${pay.payers.map(p => `<li><span>${p.who}付（${p.tai} 台）</span><b>${money(p.amount)}</b></li>`).join('')}</ul>
      <div class="pay-total"><span>你總共收</span><b>${money(pay.total)}</b></div>
      ${reading || waits ? `<details><summary>怎麼拆的、胡前聽什麼</summary>${reading}${waits}</details>` : ''}`;
  }

  function touchScore() {
    S.sc.example = false;
    renderScore();
  }

  actions['sc-target'] = v => { S.sc.target = v; renderScore(); };
  actions['sc-add'] = v => {
    const s = S.sc;
    const t = Number(v);
    if (s.target === 'hand') {
      if (s.hand.length >= scNeed()) return toast(`手牌已經 ${scNeed()} 張，胡的那張放「胡的牌」`);
      s.hand.push(t);
      if (s.hand.length === scNeed() && s.winTile == null) s.target = 'win';
    } else if (s.target === 'win') {
      s.winTile = t;
    } else {
      if (s.melds.length >= 5) return toast('最多 5 組');
      s.melds.push({ type: s.target, tile: t });
    }
    touchScore();
  };
  actions['sc-remove'] = v => {
    const i = S.sc.hand.lastIndexOf(Number(v));
    if (i >= 0) S.sc.hand.splice(i, 1);
    touchScore();
  };
  actions['sc-remove-win'] = () => { S.sc.winTile = null; S.sc.target = 'win'; touchScore(); };
  actions['sc-remove-meld'] = v => { S.sc.melds.splice(Number(v), 1); touchScore(); };
  actions['sc-flower'] = v => {
    const f = Number(v);
    const i = S.sc.flowers.indexOf(f);
    if (i >= 0) S.sc.flowers.splice(i, 1);
    else S.sc.flowers.push(f);
    touchScore();
  };
  actions['sc-clear'] = () => {
    Object.assign(S.sc, { hand: [], winTile: null, melds: [], flowers: [], target: 'hand' });
    touchScore();
  };
  actions['sc-self'] = v => { S.sc.selfDraw = v === '1'; renderScore(); };
  actions['sc-seat'] = v => { S.sc.seatWind = Number(v); renderScore(); };
  actions['sc-round'] = v => { S.sc.roundWind = Number(v); renderScore(); };
  actions['sc-discarder'] = v => { S.sc.discarderIsDealer = v === '1'; renderScore(); };
  actions['sc-streak'] = v => { S.sc.streak = Math.max(0, Math.min(20, S.sc.streak + Number(v))); renderScore(); };
  actions['sc-flag'] = v => { S.sc[v] = !S.sc[v]; renderScore(); };
  actions['sc-special'] = v => {
    S.sc.special = v;
    if (v === 'eightFlowers') S.sc.selfDraw = true;
    if (v === 'sevenRobOne') S.sc.selfDraw = false;
    renderScore();
  };
  actions['sc-preset'] = v => {
    const [base, perTai] = v.split('/').map(Number);
    setStakes(base, perTai);
    $('#sc-base').value = base;
    $('#sc-tai').value = perTai;
  };

  function setStakes(base, perTai) {
    S.sc.base = Math.max(0, base || 0);
    S.sc.perTai = Math.max(0, perTai || 0);
    store.set('stakes', { base: S.sc.base, perTai: S.sc.perTai });
    renderPresets();
    renderScoreResult();
    renderMoney();
  }

  function renderPresets() {
    $('#sc-presets').innerHTML = PRESETS.map(([b, t]) =>
      `<button type="button" class="chip" data-act="sc-preset" data-v="${b}/${t}" aria-pressed="${S.sc.base === b && S.sc.perTai === t}">${b}／${t}</button>`).join('');
  }

  function bindStakes() {
    $('#sc-base').value = S.sc.base;
    $('#sc-tai').value = S.sc.perTai;
    const update = () => setStakes(Number($('#sc-base').value), Number($('#sc-tai').value));
    $('#sc-base').addEventListener('input', update);
    $('#sc-tai').addEventListener('input', update);
    renderPresets();
  }

  // ============================================================
  // 練習 (drills)
  // ============================================================
  function newProblem() {
    const d = S.dr;
    d.answer = null;
    d.picks = [];
    d.problem = d.mode === 'discard' ? { hand: M.discardProblem() } : M.waitProblem(Math.random, d.flush);
  }

  function record(key, good) {
    const st = S.stats[key];
    st.n++;
    if (good) {
      st.good++;
      st.streak++;
      st.best = Math.max(st.best, st.streak);
    } else {
      st.streak = 0;
    }
    store.set('stats', S.stats);
  }

  function renderDrill() {
    const d = S.dr;
    $('#dr-mode').innerHTML = segHTML('dr-mode', [['discard', '打哪張'], ['wait', '聽什麼']], d.mode);
    const flush = $('#dr-flush');
    flush.hidden = d.mode !== 'wait';
    flush.innerHTML = segHTML('dr-flush', [['0', '混合'], ['1', '清一色']], d.flush ? '1' : '0');
    const st = S.stats[d.mode];
    $('#dr-stats').innerHTML = st.n
      ? `答了 <b>${st.n}</b> 題・答對 <b>${Math.round((st.good / st.n) * 100)}%</b>・連對 <b>${st.streak}</b>（最高 ${st.best}）`
      : '還沒開始。答對率存在這台裝置上。';
    $('#dr-body').innerHTML = d.mode === 'discard' ? drillDiscardHTML() : drillWaitHTML();
  }

  function drillDiscardHTML() {
    const { problem, answer } = S.dr;
    if (!answer) {
      return `<p class="prompt">剛摸完牌，這 17 張要打哪張？</p>
        <div class="tiles">${problem.hand.map(t => tileHTML(t, { act: 'dr-discard', label: '打' + M.tileName(t) })).join('')}</div>
        <p class="hint">點一張打出去。題目都是沒吃碰的手牌，只比牌效。</p>`;
    }
    const a = answer.analysis;
    const chosen = a.discards.find(x => x.tile === answer.tile);
    const top = a.discards[0];
    const bestNames = namesList(a.discards.filter(x => x.best).map(x => x.tile), 3);
    const big = { good: chosen.best ? '最佳解！' : '幾乎一樣好！', ok: '差一點', bad: '可惜' }[answer.grade];
    const sub = chosen.best
      ? `打${M.tileName(chosen.tile)}：${shantenName(chosen.shanten)}，進張 ${chosen.total} 張。`
      : `你打${M.tileName(chosen.tile)}：${shantenName(chosen.shanten)}、${chosen.total} 張。最好是打${bestNames}：${shantenName(top.shanten)}、${top.total} 張。`;
    const rows = a.discards.slice(0, 5);
    if (!rows.includes(chosen)) rows.push(chosen);
    let picked = false;
    const hand = answer.hand.map(t => {
      const mark = !picked && t === answer.tile;
      if (mark) picked = true;
      return tileHTML(t, { cls: mark ? 'picked' : '' });
    });
    return `<div class="feedback ${answer.grade}"><p class="big">${big}</p><p>${sub}</p></div>
      <div class="tiles">${hand.join('')}</div>
      <ul class="drows">${rows.map(x => discardRowHTML(x, x === chosen, a.unseen)).join('')}</ul>
      <div class="drill-actions"><button type="button" class="btn" data-act="dr-next">下一題</button></div>`;
  }

  function drillWaitHTML() {
    const { problem, answer, picks, flush } = S.dr;
    const suit = M.suitOf(problem.hand[0]);
    const candidates = [];
    if (flush) for (let r = 0; r < 9; r++) candidates.push(suit * 9 + r);
    else for (let t = 0; t < M.KINDS; t++) candidates.push(t);

    const cell = t => {
      const on = picks.includes(t);
      if (!answer) return tileHTML(t, { act: 'dr-pick', pressed: on, cls: on ? 'picked' : '', label: (on ? '取消' : '選') + M.tileName(t) });
      const isWait = problem.waits.includes(t);
      const cls = on && isWait ? 'mark-good' : on ? 'mark-bad' : isWait ? 'mark-miss' : '';
      return tileHTML(t, { cls });
    };
    const rows = flush
      ? `<div class="palette-row">${candidates.map(cell).join('')}</div>`
      : [[0, 9], [9, 18], [18, 27], [27, 34]].map(([a, b]) => `<div class="palette-row">${candidates.slice(a, b).map(cell).join('')}</div>`).join('');

    const hand = `<div class="tiles">${problem.hand.map(t => tileHTML(t)).join('')}</div>`;
    if (!answer) {
      return `<p class="prompt">這 16 張聽什麼？把會胡的牌全部點起來。</p>${hand}
        <div class="palette">${rows}</div>
        <div class="drill-actions">
          <button type="button" class="btn" data-act="dr-check">對答案</button>
          <span class="hint">選了 ${picks.length} 種</span>
        </div>`;
    }

    const missed = problem.waits.filter(t => !picks.includes(t));
    const wrong = picks.filter(t => !problem.waits.includes(t));
    let msg = `聽 ${problem.waits.length} 種：${namesList(problem.waits, 9)}。`;
    if (missed.length) msg += `漏了 ${namesList(missed, 9)}。`;
    if (wrong.length) msg += `${namesList(wrong, 9)} 不會胡。`;
    const explain = problem.waits.map(w =>
      `<li>${tileHTML(w, { size: 'sm' })}<span class="arrow">胡這張 →</span>${readingHTML(problem.hand.concat(w))}</li>`).join('');
    return `<div class="feedback ${answer.grade}"><p class="big">${answer.grade === 'good' ? '全對！' : '再看一次'}</p><p>${msg}</p></div>
      ${hand}
      <div class="palette">${rows}</div>
      <p class="hint">綠框：答對。紅框：不會胡。黃框：漏掉的。</p>
      <h3>每一張怎麼胡</h3>
      <ul class="wait-explain">${explain}</ul>
      <div class="drill-actions"><button type="button" class="btn" data-act="dr-next">下一題</button></div>`;
  }

  actions['dr-mode'] = v => { S.dr.mode = v; newProblem(); renderDrill(); };
  actions['dr-flush'] = v => { S.dr.flush = v === '1'; newProblem(); renderDrill(); };
  actions['dr-next'] = () => { newProblem(); renderDrill(); };
  actions['dr-discard'] = v => {
    const d = S.dr;
    if (d.answer) return;
    const tile = Number(v);
    const analysis = M.analyze(d.problem.hand);
    const chosen = analysis.discards.find(x => x.tile === tile);
    const top = analysis.discards[0];
    let grade = 'bad';
    if (chosen.best || (chosen.shanten === top.shanten && chosen.ratio >= 0.9)) grade = 'good';
    else if (chosen.shanten === top.shanten) grade = 'ok';
    d.answer = { tile, analysis, grade, hand: d.problem.hand };
    record(S.dr.mode, grade === 'good');
    renderDrill();
  };
  actions['dr-pick'] = v => {
    const t = Number(v);
    const i = S.dr.picks.indexOf(t);
    if (i >= 0) S.dr.picks.splice(i, 1);
    else S.dr.picks.push(t);
    renderDrill();
  };
  actions['dr-check'] = () => {
    const d = S.dr;
    if (!d.picks.length) return toast('先點你覺得會胡的牌');
    const good = d.picks.length === d.problem.waits.length && d.picks.every(t => d.problem.waits.includes(t));
    d.answer = { grade: good ? 'good' : 'bad' };
    record(S.dr.mode, good);
    renderDrill();
  };

  // ============================================================
  // 小抄 (rules table + money table)
  // ============================================================
  function renderGuide() {
    const defaults = M.defaultRules();
    $('#rules-body').innerHTML = M.RULES.map(r => `
      <tr class="${S.rules[r.key] !== defaults[r.key] ? 'changed' : ''}">
        <td><label for="rule-${r.key}">${r.name}</label></td>
        <td><input id="rule-${r.key}" type="number" inputmode="numeric" min="0" max="99" data-rule="${r.key}" value="${S.rules[r.key]}"></td>
        <td>${r.note || ''}</td>
      </tr>`).join('');
    renderMoney();
  }

  function renderMoney() {
    const { base, perTai } = S.sc;
    const rows = [0, 1, 2, 3, 4, 5, 8].map(tai => {
      const one = base + tai * perTai;
      const times = base ? (one / base).toFixed(1) : '—';
      return `<tr><td>${tai ? tai + ' 台' : '屁胡'}</td><td>${money(one)}</td><td>${money(one * 3)}</td><td>${times} 倍</td></tr>`;
    });
    $('#money-table').innerHTML =
      `<caption class="sr">底 ${base}／每台 ${perTai} 的收入</caption>
      <thead><tr><th scope="col">台數</th><th scope="col">放槍收</th><th scope="col">自摸收</th><th scope="col">是屁胡的</th></tr></thead>
      <tbody>${rows.join('')}</tbody>`;
  }

  function bindRules() {
    $('#rules-body').addEventListener('input', e => {
      const key = e.target.dataset.rule;
      if (!key) return;
      const v = Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0)));
      S.rules[key] = v;
      store.set('rules', S.rules);
      e.target.closest('tr').classList.toggle('changed', v !== M.defaultRules()[key]);
    });
  }

  actions['rules-reset'] = () => {
    S.rules = M.defaultRules();
    store.set('rules', {});
    renderGuide();
    toast('已恢復常見規則');
  };

  // ============================================================
  // BOOT
  // ============================================================
  const renderers = { analyze: renderAnalyze, defense: renderDefense, score: renderScore, drill: renderDrill, guide: renderGuide };

  function start() {
    bindCodeForm();
    bindStakes();
    bindRules();
    renderGuide();
    renderAnalyze();
    renderScore();
    const fromHash = location.hash.slice(1);
    showTab(TABS.includes(fromHash) ? fromHash : 'analyze', true);
  }

  start();
})();
