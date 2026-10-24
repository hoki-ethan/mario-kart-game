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
    df: { mode: 'sim', task: 'safe', table: null, read: null, answer: null, picks: [], loading: false },
    dm: {
      river: tileList('1z 7z 6z 8s 1m 1p 8s 4z 1s 9p 8m 4s'), melds: [], mine: parseTiles('1234m123678899p5688s'),
      seen: M.toCounts(parseTiles('1122235789m123p1112369s1122333444556677z')), target: 'river', example: true, read: null,
    },
    stats: {
      discard: savedStats.discard || newStats(), wait: savedStats.wait || newStats(),
      defense: savedStats.defense || newStats(), guess: savedStats.guess || newStats(),
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

  function tileTags(t, inRiver, visible) {
    const tags = [];
    if (inRiver[t]) tags.push('他打過');
    if (visible[t] >= 3) tags.push(`看得到 ${visible[t]} 張`);
    if (t >= 27) tags.push('字牌');
    else if (t % 9 === 0 || t % 9 === 8) tags.push('么九');
    return tags;
  }

  // My tiles from safest to most dangerous; factor = chance he is tenpai
  function dangerListHTML(kinds, prob, factor, ctx) {
    const rows = kinds.map(t => ({ t, p: prob[t] * factor })).sort((a, b) => a.p - b.p || a.t - b.t);
    const max = Math.max(0.01, ...rows.map(r => r.p));
    return '<ul class="dlist">' + rows.map(({ t, p }) => {
      const hit = ctx.actual && ctx.actual.includes(t);
      const tags = tileTags(t, ctx.inRiver, ctx.visible).map(x => `<span>${x}</span>`).join('');
      return `<li class="dl-row${hit ? ' hit' : ''}${ctx.chosen === t ? ' chosen' : ''}">
        ${tileHTML(t, { size: 'sm' })}
        <div class="dl-main">
          <span class="meter"><b style="width:${Math.round((p / max) * 100)}%"></b></span>
          <div class="dl-tags">${tags}${hit ? '<b class="badge hot">會放槍</b>' : ''}${ctx.chosen === t ? '<b class="badge warn">你打的</b>' : ''}</div>
        </div>
        <span class="dl-pct">${pct(p)}</span>
      </li>`;
    }).join('') + '</ul>';
  }

  function renderDefense() {
    const d = S.df;
    $('#df-mode').innerHTML = segHTML('df-mode', [['sim', '模擬牌局'], ['manual', '自己輸入']], d.mode);
    $('#df-sim').hidden = d.mode !== 'sim';
    $('#df-manual').hidden = d.mode !== 'manual';
    if (d.mode === 'manual') return renderManual();
    if (!d.table && !d.loading) return newTable();
    $('#df-sim').innerHTML = simHTML();
  }

  actions['df-mode'] = v => { S.df.mode = v; renderDefense(); };

  // ---------- 模擬牌局 ----------
  const targetOf = tb => tb.players.find(p => p.seat === tb.target);

  function newTable() {
    const d = S.df;
    Object.assign(d, { loading: true, table: null, read: null, answer: null, picks: [] });
    renderDefense();
    // Let the loading state paint before the bots play
    setTimeout(() => {
      d.table = M.simulateTable(Math.random);
      d.loading = false;
      if (S.tab === 'defense') renderDefense();
      setTimeout(ensureRead, 30);
    }, 30);
  }

  function ensureRead() {
    const d = S.df;
    if (d.table && !d.read) {
      const tgt = targetOf(d.table);
      d.read = M.guessWaits({ river: tgt.river, melds: tgt.melds, visible: M.tableVisible(d.table) });
    }
    return d.read;
  }

  function simHTML() {
    const d = S.df;
    const key = d.task === 'safe' ? 'defense' : 'guess';
    const st = S.stats[key];
    let stats;
    if (!st.n) stats = d.task === 'safe' ? '還沒開始。紀錄存在這台裝置上。' : '還沒開始。最多選 5 張，選到他真的聽的牌就算猜中。';
    else if (d.task === 'safe') stats = `打了 <b>${st.n}</b> 局・沒放槍 <b>${pct(st.good / st.n)}</b>・連續安全 <b>${st.streak}</b>（最高 ${st.best}）`;
    else stats = `猜了 <b>${st.n}</b> 局・有猜中 <b>${pct(st.good / st.n)}</b>`;
    const top = `<div class="drill-top">
        <div class="seg" role="group" aria-label="練什麼">${segHTML('df-task', [['safe', '挑安全牌'], ['guess', '猜他聽什麼']], d.task)}</div>
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
    const info = `<div class="table-info"><span>第 ${tgt.river.length} 巡</span><span>牌牆剩 ${tb.wallLeft} 張</span><span>電腦照牌效打，會吃碰，留中發白跟自己的風</span></div>`;
    const myHand = M.sortTiles(tb.me);

    let body;
    if (d.task === 'safe' && !d.answer) {
      body = `<p class="prompt">輪到你，剛摸完牌。${tgt.name}聽牌了，打哪張？</p>
        <div class="tiles">${myHand.map(t => tileHTML(t, { act: 'df-safe', label: '打' + M.tileName(t) })).join('')}</div>
        <p class="hint">先看他打過什麼、吃碰了什麼，還有哪一門他都不丟。淡掉的牌是被吃碰走的。</p>`;
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
    return top + info + `<div class="rivers">${rivers}</div>` + body;
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

  function safeRevealHTML() {
    const d = S.df;
    const tb = d.table;
    const tgt = targetOf(tb);
    const read = ensureRead();
    const visible = M.tableVisible(tb);
    const kinds = [...new Set(tb.me)];
    const actual = [...new Set(tb.players.flatMap(p => p.waits))];
    const risky = kinds.filter(t => actual.includes(t)).length;
    const safest = kinds.reduce((x, y) => (read.prob[x] <= read.prob[y] ? x : y));
    const name = M.tileName(d.answer.tile);
    const dealt = d.answer.dealtTo;
    const sub = (dealt.length ? `打${name}放槍給${dealt.join('、')}。` : `打${name}沒事。`) +
      `你手上 ${kinds.length} 種牌裡有 ${risky} 種會放槍。模型認為最安全的是${M.tileName(safest)}（${pct(read.prob[safest])}）。`;
    return `<div class="feedback ${dealt.length ? 'bad' : 'good'}"><p class="big">${dealt.length ? '放槍了！' : '安全！'}</p><p>${sub}</p></div>
      ${handsRevealHTML(tb)}
      <h3>你的牌對${tgt.name}有多危險（假設他聽了）</h3>
      ${dangerListHTML(kinds, read.prob, 1, { inRiver: M.toCounts(tgt.river), visible, actual, chosen: d.answer.tile })}
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
  actions['df-new'] = () => newTable();
  actions['df-safe'] = v => {
    const d = S.df;
    if (d.answer || !d.table) return;
    const tile = Number(v);
    ensureRead();
    const dealtTo = d.table.players.filter(p => p.waits.includes(tile)).map(p => p.name);
    d.answer = { tile, dealtTo };
    record('defense', !dealtTo.length);
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
      m.read = M.guessWaits({ river: m.river, melds: m.melds, visible: manualVisible() });
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
    const inRiver = M.toCounts(m.river);
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
      ${kinds.length ? `<h3>我的牌：如果他聽了，打出去會放槍的機率</h3>
        ${dangerListHTML(kinds, m.read.prob, 1, { inRiver, visible })}
        <p class="hint">只算這一家。他還沒聽的話，實際風險再乘上 ${pct(pT)}。</p>` : ''}
      <h3>他聽每張牌的機率</h3>
      ${heatGridHTML(m.read.prob, visible, null)}
    </div>`;
  }

  function touchManual() {
    S.dm.example = false;
    renderManual();
  }

  actions['dm-target'] = v => { S.dm.target = v; renderManual(); };
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

  function start(saved) {
    saved = saved || {};
    for (const k of ['an', 'sc', 'dr', 'df', 'dm']) {
      if (saved[k] && typeof saved[k] === 'object') Object.assign(S[k], saved[k]);
    }
    // Tables saved by an older version have no 吃碰 data: deal a new one
    if (S.df.table && !S.df.table.myCalled) Object.assign(S.df, { table: null, read: null, answer: null, picks: [] });
    bindCodeForm();
    bindStakes();
    bindRules();
    renderGuide();
    renderAnalyze();
    renderScore();
    const fromHash = location.hash.slice(1);
    showTab(TABS.includes(fromHash) ? fromHash : saved.tab || 'analyze', true);
  }

  // Keep in-progress state across live updates of the published page
  const hot = window.claude && window.claude.hot;
  try {
    if (hot && typeof hot.snapshot === 'function') {
      hot.snapshot(() => ({ tab: S.tab, an: S.an, sc: S.sc, dr: S.dr, df: Object.assign({}, S.df, { loading: false }), dm: S.dm }));
    }
  } catch (e) { /* not in a viewer */ }
  if (hot && typeof hot.ready === 'function') hot.ready(start);
  else start(hot && hot.data);
})();
