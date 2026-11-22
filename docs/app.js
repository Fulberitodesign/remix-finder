/* Remix Finder – interface */
(function () {
  'use strict';

  // ------------------------------------------------------------ utilitaires
  var I = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
    dl: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.4 2.6 2.2 4.4 5 4.6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
  var CATS = {
    remix: { label: 'Remix', color: 'var(--remix)' },
    mashup: { label: 'Mashup', color: 'var(--mashup)' },
    bootleg: { label: 'Bootleg', color: 'var(--bootleg)' },
    edit: { label: 'Edit', color: 'var(--edit)' }
  };
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var EXAMPLES = [['The Weeknd', 'Blinding Lights'], ['Daft Punk', 'One More Time'], ['Aya Nakamura', 'Djadja'], ['Dua Lipa', 'Levitating']];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function fmtNum(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' Md';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' M';
    if (n >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(n);
  }
  function fmtDate(d) {
    if (!d) return '';
    var p = d.split('-');
    if (p.length === 1) return p[0];
    return MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }
  // Mode serveur (python app.py) si /api/status répond, sinon moteur du navigateur (GitHub Pages)
  var serverMode = null;
  var modeReady = fetch('api/status').then(function (r) {
    if (!r.ok) throw 0;
    return r.json();
  }).then(function (j) { serverMode = !!(j && j.serveur); }).catch(function () { serverMode = false; });
  function api(path, params) {
    return modeReady.then(function () {
      if (!serverMode) return window.RF.api(path, params);
      return serverApi(path, params);
    });
  }
  function serverApi(path, params) {
    var q = new URLSearchParams(params || {}).toString();
    return fetch(path.replace(/^\//, '') + (q ? '?' + q : '')).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || ('Erreur ' + r.status));
        return j;
      });
    });
  }
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  // ------------------------------------------------------------ état
  var S = {
    view: 'recherche',
    artist: '', title: '',
    loading: false, data: null, error: null,
    analysis: null, analysisLoading: false,
    ideas: null, ideasLoading: false, ideasError: null,
    cat: 'all', officialOnly: false, sort: 'pop', trendOnly: false,
    region: localStorage.getItem('rf-region') || 'fr',
    trends: {}, rising: {}, trendsLoading: false, fewOnly: false,
    youtube: false, soundcloud: false,
    origin: null, originKey: '', originLoading: false, originError: null,
    ideasKey: ''
  };
  var ideasSeq = 0;
  var searchSeq = 0;

  function recent() {
    try { return JSON.parse(localStorage.getItem('rf-recent') || '[]'); } catch (e) { return []; }
  }
  function pushRecent(a, t) {
    var list = recent().filter(function (x) { return !(x[0] === a && x[1] === t); });
    list.unshift([a, t]);
    localStorage.setItem('rf-recent', JSON.stringify(list.slice(0, 6)));
  }

  // ------------------------------------------------------------ routage
  function songKey(a, t) { return (a || '').toLowerCase() + '|' + (t || '').toLowerCase(); }
  function songHash(view, artist, title) {
    return '#/' + view + '?' + new URLSearchParams({ artist: artist, title: title }).toString();
  }
  // go() reste sur la page courante (recherche ou idées) ; les autres pages renvoient vers la recherche
  function go(artist, title, view) {
    view = view || (S.view === 'idees' ? 'idees' : 'recherche');
    location.hash = songHash(view, artist, title);
  }
  function onRoute() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('?');
    var view = parts[0] === 'tendances' ? 'tendances' : parts[0] === 'idees' ? 'idees' : 'recherche';
    var params = new URLSearchParams(parts[1] || '');
    S.view = view;
    document.querySelectorAll('.topbar .seg a').forEach(function (a) {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (view === 'recherche') {
      var a = params.get('artist') || '', t = params.get('title') || '';
      if (t && (a !== S.artist || t !== S.title || !S.data)) {
        S.artist = a; S.title = t;
        runSearch();
      } else if (!t) {
        S.artist = ''; S.title = ''; S.data = null;
      }
    } else if (view === 'idees') {
      var ia = params.get('artist') || '', it = params.get('title') || '';
      if (!it && S.title) {  // on garde la chanson de la dernière recherche
        history.replaceState(null, '', songHash('idees', S.artist, S.title));
        ia = S.artist; it = S.title;
      }
      if (it) {
        S.artist = ia; S.title = it;
        if (songKey(ia, it) + '|' + S.region !== S.ideasKey) loadIdeasPage();
      }
    } else {
      loadTrends();
    }
    render();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ recherche
  function runSearch() {
    var seq = ++searchSeq;
    S.loading = true; S.error = null; S.data = null; S.cat = 'all'; S.open = {};
    pushRecent(S.artist, S.title);
    api('/api/search', { artist: S.artist, title: S.title }).then(function (d) {
      if (seq !== searchSeq) return;
      S.loading = false; S.data = d;
      setOrigin(d.origine);
      render();
    }).catch(function (e) {
      if (seq !== searchSeq) return;
      S.loading = false; S.error = e.message; render();
    });
  }
  // Titre d'origine, partagé entre la page Recherche et la page Idées
  function setOrigin(o) {
    var key = songKey(S.artist, S.title);
    if (S.originKey === key && S.origin && o && S.origin.deezer_id === o.deezer_id) return;
    S.origin = o; S.originKey = key; S.originLoading = false; S.originError = null;
    S.analysis = null;
    if (o && o.deezer_id) loadAnalysis(key, o.deezer_id);
  }
  function loadAnalysis(key, id) {
    S.analysisLoading = true;
    api('/api/origin/analyse', { id: id }).then(function (a) {
      if (key !== S.originKey) return;
      S.analysis = a; S.analysisLoading = false; renderOrigin();
    }).catch(function () { S.analysisLoading = false; renderOrigin(); });
  }

  // ------------------------------------------------------------ idées de mashup
  function loadIdeasPage() {
    var key = songKey(S.artist, S.title);
    var seq = ++ideasSeq;
    S.ideasKey = key + '|' + S.region;
    S.ideas = null; S.ideasError = null; S.ideasLoading = true;
    pushRecent(S.artist, S.title);
    var ready = (S.originKey === key && S.origin) ? Promise.resolve(S.origin) :
      (S.originLoading = true, S.origin = null, S.originKey = key,
        api('/api/origin', { artist: S.artist, title: S.title }).then(function (d) {
          if (seq !== ideasSeq) return null;
          S.originKey = ''; setOrigin(d.origine);
          if (S.view === 'idees') renderOrigin();
          return d.origine;
        }));
    ready.then(function (o) {
      if (seq !== ideasSeq) return;
      if (!o) { S.ideasLoading = false; S.originLoading = false; S.ideasError = 'Titre introuvable sur Deezer : essaie une autre orthographe.'; return renderIdeasPage(); }
      renderIdeas();
      return api('/api/ideas', { id: o.deezer_id, region: S.region }).then(function (d) {
        if (seq !== ideasSeq) return;
        S.ideasLoading = false; S.ideas = d.idees || []; S.ideasError = d.error || null; renderIdeas();
      });
    }).catch(function (e) {
      if (seq !== ideasSeq) return;
      S.ideasLoading = false; S.originLoading = false; S.ideasError = e.message; renderIdeasPage();
    });
  }

  function visibleResults() {
    if (!S.data) return [];
    var list = S.data.resultats.filter(function (r) {
      return (S.cat === 'all' || r.categorie === S.cat) && (!S.officialOnly || r.officiel);
    });
    var key = { pop: 'popularite', rise: 'vues_par_jour', recent: 'date' }[S.sort];
    return list.slice().sort(function (a, b) {
      var x = a[key] || '', y = b[key] || '';
      if (x === y) return (b.popularite || 0) - (a.popularite || 0);
      return x < y ? 1 : -1;
    });
  }

  // Variantes d'un même morceau (slowed, nightcore, 8D…) regroupées sous une seule ligne
  var VARIANT_RE = /\s*[(\[][^)\]]*(slowed|sped ?up|nightcore|8d|reverb|muffled|bathroom|to perfection|tiktok|instrumental|extended|radio|clean|explicit)[^)\]]*[)\]]\s*/gi;
  function baseKey(r) {
    return (r.titre.replace(VARIANT_RE, ' ').toLowerCase().replace(/\s+/g, ' ').trim()) + '|' + (r.artiste || '').toLowerCase() + '|' + r.categorie;
  }
  function grouped(list) {
    var groups = [], byKey = {};
    list.forEach(function (r) {
      var k = baseKey(r);
      if (byKey[k]) byKey[k].variants.push(r);
      else { byKey[k] = { key: k, main: r, variants: [] }; groups.push(byKey[k]); }
    });
    return groups;
  }
  S.open = {};

  // ------------------------------------------------------------ rendu : recherche
  function heroHTML() {
    var ideasView = S.view === 'idees';
    var compact = ideasView ? !!(S.title) : !!(S.data || S.loading);
    var rec = recent();
    var chips = (rec.length ? rec : EXAMPLES).map(function (x) {
      return '<button type="button" class="chip" data-go="' + esc(JSON.stringify([x[0], x[1], S.view === 'idees' ? 'idees' : 'recherche'])) + '">' +
        (rec.length ? I.clock : I.note) + esc(x[1]) + ' <span class="muted">· ' + esc(x[0]) + '</span></button>';
    }).join('');
    return '<section class="hero"' + (compact ? ' style="padding-top:28px"' : '') + '>' +
      (compact ? '' : (ideasView ?
        '<h1>Trouve le titre parfait pour ton prochain <em>mashup</em>.</h1>' +
        '<p>Choisis une chanson : l\'appli analyse son tempo et sa tonalité, puis cherche les titres compatibles dans le top du moment et chez les artistes proches.</p>' :
        '<h1>Tous les <em>remix</em>, mashups et edits d\'une chanson, au même endroit.</h1>' +
        '<p>Recherche sur MusicBrainz, Deezer, Mixcloud' + (serverMode === false ? ' et YouTube' : ', SoundCloud et YouTube') + ', avec tri par popularité et par vues gagnées chaque jour.</p>')) +
      '<div class="searchbox">' +
      '<form id="search-form" role="search" autocomplete="off">' +
      '<label class="field">' + I.search +
      '<span class="hidden">Chanson ou artiste</span>' +
      '<input id="q" type="search" placeholder="Une chanson, ex. Blinding Lights" value="' + esc(S.title ? S.title + (S.artist ? ' – ' + S.artist : '') : '') + '" aria-autocomplete="list" aria-controls="suggest" aria-expanded="false"></label>' +
      '<button class="btn primary" type="submit" aria-label="Rechercher">' + I.search + '<span class="btn-label">Rechercher</span></button>' +
      '</form>' +
      '<ul id="suggest" class="suggest" role="listbox" hidden></ul>' +
      '</div>' +
      '<div class="chips"><span class="muted small">' + (rec.length ? 'Récents :' : 'Essaie :') + '</span>' + chips + '</div>' +
      '</section>';
  }

  function originHTML() {
    var onSearch = S.view !== 'idees';
    if (onSearch ? S.loading : S.originLoading) return '<div class="origin skeleton" style="height:180px"></div>';
    if (onSearch ? !S.data : !S.title) return '';
    var o = S.origin;
    var cta = onSearch ?
      '<a class="btn" href="' + esc(songHash('idees', S.artist, S.title)) + '">' + I.spark + ' Idées de mashup</a>' :
      '<a class="btn" href="' + esc(songHash('recherche', S.artist, S.title)) + '">' + I.search + ' Voir ses remix</a>';
    var src = (!onSearch || !S.data) ? '' : Object.keys(S.data.sources).map(function (k) {
      var s = S.data.sources[k];
      var cls = s.desactive ? 'off' : (s.ok ? '' : 'err');
      var label = s.desactive ? 'désactivé' : (s.ok ? s.n + ' trouvés' : 'erreur');
      return '<span class="src-pill ' + cls + '" title="' + esc(s.erreur || '') + '"><i></i>' + esc(k) + ' · ' + label + '</span>';
    }).join('');
    var a = S.analysis;
    function fact(label, value) {
      return '<div class="fact"><span>' + label + '</span><strong>' + value + '</strong></div>';
    }
    var sk = '<span class="skeleton sk-inline"></span>';
    var bpm = a && a.bpm ? (a.bpm_estime ? '≈ ' + Math.round(a.bpm) + ' <span class="muted small" title="Estimé sur l\'extrait : peut être le double ou la moitié">/ ' + Math.round(a.bpm < 100 ? a.bpm * 2 : a.bpm / 2) + '</span>' : Math.round(a.bpm)) : (S.analysisLoading ? sk : '—');
    var key = a && a.tonalite ? esc(a.tonalite) : (S.analysisLoading ? sk : '—');
    var cam = a && a.camelot ? esc(a.camelot) : (S.analysisLoading ? sk : '—');
    if (!o) {
      if (!onSearch) return '';
      return '<div class="origin"><div class="origin-inner"><div class="origin-text"><span class="eyebrow">Titre d\'origine</span><h2>' + esc(S.title) + '</h2><span class="muted">' + esc(S.artist) + ' · introuvable sur Deezer</span><div class="sources-status" style="margin-top:8px">' + src + '</div></div></div></div>';
    }
    return '<div class="origin">' +
      '<div class="origin-bg" style="background-image:url(\'' + esc(o.pochette_grande || o.pochette) + '\')"></div>' +
      '<div class="origin-inner">' +
      '<div class="origin-cover"><img src="' + esc(o.pochette_grande || o.pochette) + '" alt="Pochette de ' + esc(o.titre) + '">' + playBtn(o, 'icon-btn') + '</div>' +
      '<div class="origin-text"><span class="eyebrow">Titre d\'origine</span>' +
      '<h2>' + esc(o.titre) + '</h2><span class="muted">' + esc(o.artiste) + '</span>' +
      '<div class="facts" id="facts">' + fact('Tempo (BPM)', bpm) + fact('Tonalité', key) + fact('Camelot', cam) + '</div>' +
      '</div>' +
      '<div class="origin-cta">' + cta + tiktokLink(o.titre_court + ' ' + o.artiste, 'btn', 'TikTok') + '</div>' +
      (src ? '<div class="sources-status" style="flex-basis:100%">' + src + '</div>' : '') +
      '</div></div>';
  }

  // Lien vers la recherche TikTok (pas de clé : on ouvre simplement tiktok.com)
  function tiktokURL(q) { return 'https://www.tiktok.com/search?q=' + encodeURIComponent(q); }
  function tiktokLink(q, cls, label) {
    return '<a class="' + (cls || 'tt-link') + '" href="' + esc(tiktokURL(q)) + '" target="_blank" rel="noopener" title="Chercher « ' + esc(q) + ' » sur TikTok" aria-label="Chercher ' + esc(q) + ' sur TikTok">' + I.tiktok + (label ? ' ' + label : '') + '</a>';
  }

  function playBtn(t, cls) {
    if (!t.extrait) return '';
    var id = 'dz' + t.deezer_id;
    var on = player.id === id && !audio.paused;
    return '<button type="button" class="' + cls + (on ? ' playing' : '') + '" data-play="' + esc(id) + '" aria-label="' + (on ? 'Pause' : 'Écouter un extrait de ' + esc(t.titre)) + '">' + (on ? I.pause : I.play) + '</button>';
  }
  function thumbHTML(t) {
    var cat = CATS[t.categorie];
    var inner = t.pochette ? '<img src="' + esc(t.pochette) + '" alt="" loading="lazy">' : '<span style="color:' + (cat ? cat.color : 'var(--muted)') + '">' + I.note + '</span>';
    return '<div class="thumb">' + inner + playBtn(t, 'play') + '</div>';
  }

  function rowHTML(r, extra) {
    var cat = CATS[r.categorie] || { label: r.categorie, color: 'var(--muted)' };
    var rising = (r.vues_par_jour || 0) >= 2000;
    var meta = [];
    if (r.vues) meta.push(fmtNum(r.vues) + ' vues');
    else if (r.ecoutes) meta.push(fmtNum(r.ecoutes) + ' écoute' + (r.ecoutes > 1 ? 's' : ''));
    if (r.vues_par_jour) meta.push('<span class="rate' + (rising ? ' up' : '') + '">+' + fmtNum(r.vues_par_jour) + '/jour</span>');
    if (!r.vues && !r.ecoutes && r.rang_deezer) meta.push('<span class="popbar" title="Popularité Deezer">Popularité <b><i style="width:' + r.popularite + '%"></i></b></span>');
    if (r.date) meta.push(fmtDate(r.date));
    return '<article class="row">' + thumbHTML(r) +
      '<div class="row-main"><span class="row-title">' + esc(r.titre) + '</span>' +
      '<span class="muted small">' + esc(r.artiste || '—') + '</span>' +
      (meta.length ? '<span class="row-meta">' + meta.join('') + '</span>' : '') + '</div>' +
      '<div class="row-tags">' + (extra || '') +
      (rising ? '<span class="tag hot">' + I.up + ' En hausse</span>' : '') +
      '<span class="tag cat" style="background:' + cat.color + '">' + esc(cat.label) + '</span>' +
      (r.officiel ? '<span class="tag off">Officiel</span>' : '') +
      r.sources.map(function (s) { return '<span class="tag">' + esc(s) + '</span>'; }).join('') +
      '</div>' +
      tiktokLink(r.titre, 'row-open') +
      '<a class="row-open" href="' + esc(r.lien) + '" target="_blank" rel="noopener" aria-label="Ouvrir sur ' + esc(r.sources[0]) + '">' + I.ext + '</a>' +
      '</article>';
  }

  function groupHTML(g) {
    if (!g.variants.length) return rowHTML(g.main);
    var open = !!S.open[g.key];
    var btn = '<button type="button" class="variants-btn" data-variants="' + esc(g.key) + '" aria-expanded="' + open + '">' +
      (open ? 'Masquer' : '+ ' + g.variants.length) + ' variante' + (g.variants.length > 1 ? 's' : '') + '</button>';
    return rowHTML(g.main, btn) + (open ? '<div class="variants">' + g.variants.map(function (v) { return rowHTML(v); }).join('') + '</div>' : '');
  }

  function resultsHTML() {
    if (S.error) return '<div class="empty" style="margin-top:28px">' + esc(S.error) + '</div>';
    if (!S.data && !S.loading) return '';
    var all = S.data ? S.data.resultats : [];
    var counts = { all: 0 };
    all.forEach(function (r) {
      if (S.officialOnly && !r.officiel) return;
      counts.all++; counts[r.categorie] = (counts[r.categorie] || 0) + 1;
    });
    var tabs = [['all', 'Tout', 'var(--text)']].concat(Object.keys(CATS).map(function (k) { return [k, CATS[k].label, CATS[k].color]; }));
    var side = '<aside class="side">' +
      '<div class="panel"><p class="panel-title">Catégories</p>' +
      tabs.map(function (t) {
        return '<button type="button" class="cat-btn" data-cat="' + t[0] + '" aria-pressed="' + (S.cat === t[0]) + '"><span><span class="dot" style="background:' + t[2] + '"></span>' + t[1] + '</span><span class="n">' + (S.loading ? '' : (counts[t[0]] || 0)) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="panel" style="padding:4px 16px"><label class="check"><input type="checkbox" id="official"' + (S.officialOnly ? ' checked' : '') + '> Remix officiels uniquement</label></div>' +
      (serverMode === false ?
        (S.youtube ? '' : '<div class="notice">Ajoute ta clé YouTube dans les <button type="button" class="linklike" data-settings>réglages</button> pour les mashups et remix publiés sur YouTube.</div>') :
      (S.youtube && S.soundcloud ? '' : '<div class="notice">' +
        (S.youtube ? '' : 'Ajoute une clé <code>YOUTUBE_API_KEY</code> pour les mashups et remix publiés sur YouTube. ') +
        (S.soundcloud ? '' : 'Ajoute <code>SOUNDCLOUD_CLIENT_ID</code> et <code>SOUNDCLOUD_CLIENT_SECRET</code> pour chercher sur SoundCloud.') +
        ' Voir le README.</div>')) +
      '</aside>';

    var list;
    if (S.loading) {
      list = [1, 2, 3, 4, 5, 6].map(function () { return '<div class="skeleton sk-row"></div>'; }).join('');
    } else {
      var groups = grouped(visibleResults());
      list = groups.length ? groups.map(groupHTML).join('') : '<div class="empty">Aucun résultat avec ces filtres.</div>';
    }
    var sorts = [['pop', 'Popularité'], ['rise', 'En hausse'], ['recent', 'Récent']];
    var n = S.loading ? '' : grouped(visibleResults()).length;
    return '<div class="layout">' + side +
      '<div class="content">' +
      '<div class="toolbar"><h2>' + (S.loading ? '<span class="loading-line"><span class="spinner"></span>Recherche en cours…</span>' : n + ' résultat' + (n > 1 ? 's' : '')) + '</h2>' +
      '<div class="chips"><div class="seg" role="group" aria-label="Trier par">' +
      sorts.map(function (s) { return '<button type="button" data-sort="' + s[0] + '" aria-pressed="' + (S.sort === s[0]) + '">' + s[1] + '</button>'; }).join('') +
      '</div><button type="button" class="btn" id="csv"' + (S.loading ? ' disabled' : '') + '>' + I.dl + ' CSV</button></div></div>' +
      '<div id="results">' + list.replace(/<\/article>/g, '</article>') + '</div>' +
      '</div></div>';
  }

  function ideaHTML(c) {
    var color = c.score >= 75 ? 'var(--good)' : c.score >= 50 ? 'var(--accent)' : '#FF8A7A';
    var circ = 2 * Math.PI * 22;
    return '<article class="idea">' +
      '<div class="idea-top">' + thumbHTML(c) +
      '<div class="row-main"><span class="row-title">' + esc(c.titre_court || c.titre) + '</span><span class="muted small">' + esc(c.artiste) + '</span>' +
      (c.tendance ? '<span><span class="tag hot">Top ' + esc(c.rang || '') + '</span></span>' : '') + '</div>' +
      '<div class="ring" role="img" aria-label="Compatibilité ' + c.score + ' sur 100"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" stroke="var(--line-2)"/><circle cx="26" cy="26" r="22" stroke="' + color + '" stroke-dasharray="' + circ + '" stroke-dashoffset="' + (circ * (1 - c.score / 100)) + '"/></svg><span>' + c.score + '</span></div>' +
      '</div>' +
      '<div class="idea-facts">' +
      '<span class="tag ' + (c.tempo_ok ? 'ok' : 'warn') + '">' + Math.round(c.bpm) + ' BPM · ' + esc(c.note_tempo) + '</span>' +
      '<span class="tag ' + (c.tonalite_ok ? 'ok' : 'warn') + '">' + esc(c.camelot) + ' · ' + esc(c.note_tonalite) + '</span>' +
      '</div>' +
      '<p class="why">' + I.spark + '<span>' + esc(c.explication) + '</span></p>' +
      '<div class="idea-actions">' + tiktokLink((c.titre_court || c.titre) + ' ' + c.artiste, 'btn tt-square') +
      (c.extrait ? '<button type="button" class="btn" data-play="dz' + c.deezer_id + '">' + I.play + ' Écouter</button>' : '') +
      '<button type="button" class="btn subtle" data-go="' + esc(JSON.stringify([c.artiste, c.titre_court || c.titre, 'recherche'])) + '">Ses remix</button>' +
      '</div></article>';
  }

  function ideasInner() {
    if (S.ideasLoading) {
      return '<div class="loading-line"><span class="spinner"></span><span id="ideas-progress">Analyse du tempo et de la tonalité des titres tendance… (la première fois peut prendre une minute)</span></div>' +
        '<div class="grid">' + [1, 2, 3].map(function () { return '<div class="skeleton sk-card"></div>'; }).join('') + '</div>';
    }
    if (S.ideasError) return '<div class="empty">' + esc(S.ideasError) + '</div>';
    if (!S.ideas) return '';
    var list = S.ideas.filter(function (c) { return !S.trendOnly || c.tendance; });
    if (!list.length) return '<div class="empty">Aucune idée pour l\'instant.</div>';
    return '<div class="grid">' + list.map(ideaHTML).join('') + '</div>';
  }
  function ideasHTML() {
    if (!S.title) return '';
    var regions = [['fr', 'France'], ['world', 'Monde'], ['us', 'États-Unis']];
    return '<section class="section" id="ideas" aria-labelledby="ideas-title" style="margin-top:32px">' +
      '<div class="section-head"><div><h2 id="ideas-title">Titres compatibles</h2>' +
      '<p>Tempo proche et tonalité compatible (roue de Camelot), parmi le top ' + regionLabel(S.region) + ' et les artistes proches.</p></div>' +
      '<div class="chips"><div class="seg" role="group" aria-label="Top utilisé">' + regions.map(function (x) {
        return '<button type="button" data-region="' + x[0] + '" aria-pressed="' + (S.region === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div>' +
      '<label class="check"><input type="checkbox" id="trend-only"' + (S.trendOnly ? ' checked' : '') + '> Seulement les titres tendance</label></div></div>' +
      '<div id="ideas-inner">' + ideasInner() + '</div></section>';
  }
  function renderIdeasPage() { if (S.view === 'idees') render(); }

  // ------------------------------------------------------------ rendu : tendances
  function regionLabel(r) { return { fr: 'France', world: 'Monde', us: 'États-Unis' }[r] || r; }
  function loadTrends() {
    var r = S.region;
    if (S.trends[r]) return;
    S.trendsLoading = true;
    Promise.all([api('/api/trends', { region: r }), api('/api/rising', { region: r })]).then(function (res) {
      S.trends[r] = res[0].titres; S.rising[r] = res[1];
      S.trendsLoading = false;
      if (S.view === 'tendances') render();
    }).catch(function (e) {
      S.trendsLoading = false; toast(e.message);
      if (S.view === 'tendances') render();
    });
  }
  function trendsHTML() {
    var r = S.region;
    var regions = [['fr', 'France'], ['world', 'Monde'], ['us', 'États-Unis']];
    var head = '<div class="trend-head"><div><h1>Tendances</h1><p>Le top Deezer ' + regionLabel(r) + ', avec le nombre de remix déjà sortis pour chaque titre.</p></div>' +
      '<div class="seg" role="group" aria-label="Région">' + regions.map(function (x) {
        return '<button type="button" data-region="' + x[0] + '" aria-pressed="' + (r === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div></div>';
    var titles = S.trends[r];
    var main;
    if (!titles) {
      main = '<div class="loading-line" style="margin-bottom:12px"><span class="spinner"></span>Comptage des remix de chaque titre…</div>' +
        [1, 2, 3, 4, 5, 6].map(function () { return '<div class="skeleton sk-row" style="margin-bottom:8px"></div>'; }).join('');
    } else {
      var shown = titles.filter(function (t) { return !S.fewOnly || t.opportunite; });
      main = shown.map(function (t) {
        return '<div class="chart-row"><span class="rank">' + t.rang + '</span>' + thumbHTML(t) +
          '<div class="row-main"><span class="row-title">' + esc(t.titre_court) + '</span><span class="muted small">' + esc(t.artiste) + '</span></div>' +
          '<span class="count">' + t.nb_remix + (t.nb_remix_plus ? '+' : '') + ' remix</span>' +
          (t.opportunite ? '<span class="tag hot" title="Peu de remix existent : place à prendre">Opportunité</span>' : '<span class="tag">Déjà remixé</span>') +
          '<div class="chart-actions">' + tiktokLink(t.titre_court + ' ' + t.artiste, 'btn') +
          '<button type="button" class="btn" data-go="' + esc(JSON.stringify([t.artiste, t.titre_court, 'recherche'])) + '" title="Chercher ses remix">' + I.search + '<span class="hidden">Chercher les remix de ' + esc(t.titre_court) + '</span></button>' +
          '<button type="button" class="btn" data-go="' + esc(JSON.stringify([t.artiste, t.titre_court, 'idees'])) + '" title="Idées de mashup">' + I.spark + '<span class="hidden">Idées de mashup avec ' + esc(t.titre_court) + '</span></button>' +
          '</div>' +
          '</div>';
      }).join('') || '<div class="empty">Aucun titre peu remixé dans ce top.</div>';
    }
    var rise = S.rising[r];
    var riseHTML;
    if (!rise) riseHTML = '<div class="skeleton" style="height:160px"></div>';
    else if (rise.desactive) riseHTML = '<div class="notice">Cette liste vient de YouTube. ' + (serverMode === false ?
      'Ajoute ta clé YouTube dans les <button type="button" class="linklike" data-settings>réglages</button>' :
      'Lance l\'appli avec une clé <code>YOUTUBE_API_KEY</code>') + ' pour voir les remix et mashups qui gagnent le plus de vues en ce moment.</div>';
    else if (!rise.remix.length) riseHTML = '<div class="notice">Rien de notable ces 14 derniers jours.</div>';
    else riseHTML = rise.remix.map(function (x) {
      return '<div class="rise-row"><div class="thumb"><img src="' + esc(x.pochette) + '" alt="" loading="lazy"></div>' +
        '<div class="row-main"><span class="row-title small">' + esc(x.titre) + '</span><span class="muted small">' + esc(x.artiste) + ' · ' + fmtDate(x.date) + '</span></div>' +
        '<span class="rate up small">+' + fmtNum(x.vues_par_jour || 0) + '/j</span>' +
        tiktokLink(x.titre, 'row-open') +
        '<a class="row-open" href="' + esc(x.lien) + '" target="_blank" rel="noopener" aria-label="Ouvrir sur YouTube">' + I.ext + '</a></div>';
    }).join('');

    return head + '<div class="trend-layout">' +
      '<section class="panel trend-main" aria-labelledby="hot-title">' +
      '<div class="section-head" style="padding:4px 6px 10px"><h2 id="hot-title" style="font-size:20px">Titres du moment</h2>' +
      '<label class="check small"><input type="checkbox" id="few-only"' + (S.fewOnly ? ' checked' : '') + '> Peu remixés seulement</label></div>' +
      main + '</section>' +
      '<div class="trend-side">' +
      '<section class="panel" aria-labelledby="rise-title"><h2 id="rise-title" style="font-size:20px;margin-bottom:8px">Remix qui décollent</h2>' + riseHTML + '</section>' +
      '<section class="panel" aria-labelledby="tt-title"><h2 id="tt-title" style="font-size:20px;margin-bottom:8px">Sons TikTok</h2>' +
      '<p class="small" style="color:var(--soft);margin:0 0 10px">TikTok n\'a pas d\'API publique pour ses sons tendance. Consulte le Creative Center, puis lance une recherche ici.</p>' +
      '<a class="btn" href="https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/fr" target="_blank" rel="noopener">Ouvrir le Creative Center ' + I.ext + '</a></section>' +
      '</div></div>';
  }

  // ------------------------------------------------------------ rendu global
  function render() {
    var app = $('#app');
    if (S.view === 'tendances') {
      app.innerHTML = trendsHTML();
    } else if (S.view === 'idees') {
      app.innerHTML = heroHTML() + '<div id="origin-slot">' + originHTML() + '</div>' + ideasHTML();
      bindSearchBox();
    } else {
      app.innerHTML = heroHTML() + '<div id="origin-slot">' + originHTML() + '</div>' + resultsHTML();
      bindSearchBox();
    }
  }
  function renderOrigin() { var s = $('#origin-slot'); if (s) s.innerHTML = originHTML(); }
  function renderIdeas() { var s = $('#ideas-inner'); if (s) s.innerHTML = ideasInner(); }
  function renderResults() {
    // re-rendu partiel pour garder la position de défilement
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  // ------------------------------------------------------------ autocomplétion
  var sugg = [], suggIdx = -1, suggTimer, suggSeq = 0;
  function bindSearchBox() {
    var input = $('#q'), list = $('#suggest'), form = $('#search-form');
    if (!input) return;
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); suggIdx = -1; }
    function draw() {
      if (!sugg.length) return close();
      list.innerHTML = sugg.map(function (s, i) {
        return '<li><button type="button" role="option" data-i="' + i + '" aria-selected="' + (i === suggIdx) + '">' +
          '<img src="' + esc(s.pochette) + '" alt=""><span><strong>' + esc(s.titre_court) + '</strong><span class="muted small">' + esc(s.artiste) + '</span></span></button></li>';
      }).join('');
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    function pick(s) { close(); go(s.artiste, s.titre_court); }
    input.addEventListener('input', function () {
      clearTimeout(suggTimer);
      var q = input.value.trim();
      if (q.length < 2) { sugg = []; return close(); }
      suggTimer = setTimeout(function () {
        var seq = ++suggSeq;
        api('/api/suggest', { q: q }).then(function (d) {
          if (seq !== suggSeq) return;
          sugg = d; suggIdx = -1; draw();
        }).catch(function () {});
      }, 220);
    });
    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); suggIdx = Math.min(sugg.length - 1, suggIdx + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); suggIdx = Math.max(-1, suggIdx - 1); draw(); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]');
      if (b) pick(sugg[+b.dataset.i]);
    });
    input.addEventListener('blur', function () { setTimeout(close, 100); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (suggIdx >= 0 && sugg[suggIdx]) return pick(sugg[suggIdx]);
      var q = input.value.trim();
      if (!q) return;
      var m = q.split(/\s+[–-]\s+/);
      if (m.length === 2) {
        // « Titre – Artiste » (format affiché) ou « Artiste - Titre »
        var cur = S.title && rnorm(m[0]) === rnorm(S.title);
        return cur ? go(m[1], m[0]) : go(m[0], m[1]);
      }
      api('/api/suggest', { q: q }).then(function (d) {
        if (d.length) pick(d[0]); else go('', q);
      }).catch(function () { go('', q); });
    });
  }
  function rnorm(s) { return (s || '').toLowerCase().trim(); }

  // ------------------------------------------------------------ lecteur
  var audio = $('#audio');
  var player = { id: null, track: null };
  function findTrack(id) {
    var pools = [];
    if (S.data) pools = pools.concat(S.data.resultats);
    if (S.origin) pools.push(S.origin);
    if (S.ideas) pools = pools.concat(S.ideas);
    Object.keys(S.trends).forEach(function (k) { pools = pools.concat(S.trends[k]); });
    for (var i = 0; i < pools.length; i++) if ('dz' + pools[i].deezer_id === id) return pools[i];
    return null;
  }
  function play(id) {
    if (player.id === id) {
      if (audio.paused) audio.play(); else audio.pause();
      return;
    }
    var t = findTrack(id);
    if (!t || !t.extrait) return;
    player.id = id; player.track = t;
    audio.src = t.extrait;
    audio.play().catch(function () { toast('Extrait indisponible (lien expiré ?). Relance la recherche.'); });
    $('#player').hidden = false;
    $('#player-cover').src = t.pochette || '';
    $('#player-title').textContent = t.titre_court || t.titre;
    $('#player-artist').textContent = t.artiste || '';
  }
  function syncButtons() {
    document.querySelectorAll('[data-play]').forEach(function (b) {
      var on = b.dataset.play === player.id && !audio.paused;
      b.classList.toggle('playing', on);
      if (b.classList.contains('btn')) b.innerHTML = (on ? I.pause + ' Pause' : I.play + ' Écouter');
      else b.innerHTML = on ? I.pause : I.play;
    });
    var tg = $('#player-toggle');
    tg.innerHTML = audio.paused ? I.play : I.pause;
    tg.setAttribute('aria-label', audio.paused ? 'Lecture' : 'Pause');
  }
  function fmtTime(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  audio.addEventListener('play', syncButtons);
  audio.addEventListener('pause', syncButtons);
  audio.addEventListener('ended', syncButtons);
  audio.addEventListener('timeupdate', function () {
    var d = audio.duration || 30;
    $('#player-bar').style.width = (audio.currentTime / d * 100) + '%';
    $('#player-time').textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(d);
  });
  $('#player-toggle').addEventListener('click', function () { if (audio.paused) audio.play(); else audio.pause(); });
  $('#player-close').innerHTML = I.close;
  $('#player-close').addEventListener('click', function () { audio.pause(); player.id = null; $('#player').hidden = true; syncButtons(); });

  // ------------------------------------------------------------ export CSV
  function exportCSV() {
    var rows = visibleResults();
    var head = ['categorie', 'titre', 'artiste', 'sources', 'officiel', 'vues', 'vues_par_jour', 'popularite', 'date', 'lien'];
    var lines = [head.join(';')].concat(rows.map(function (r) {
      return head.map(function (h) {
        var v = h === 'sources' ? r.sources.join(', ') : (r[h] == null ? '' : r[h]);
        return '"' + String(v).replace(/"/g, '""') + '"';
      }).join(';');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'remix-' + (S.title || 'resultats').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ------------------------------------------------------------ événements délégués
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-play],[data-go],[data-cat],[data-sort],[data-region],[data-variants],#csv');
    if (!t) return;
    if (t.dataset.play) return play(t.dataset.play);
    if (t.dataset.variants) { S.open[t.dataset.variants] = !S.open[t.dataset.variants]; return renderResults(); }
    if (t.dataset.go) { var x = JSON.parse(t.dataset.go); return go(x[0], x[1], x[2] || 'recherche'); }
    if (t.dataset.cat) { S.cat = t.dataset.cat; return renderResults(); }
    if (t.dataset.sort) { S.sort = t.dataset.sort; return renderResults(); }
    if (t.dataset.region) {
      S.region = t.dataset.region; localStorage.setItem('rf-region', S.region);
      if (S.view === 'idees') { loadIdeasPage(); return render(); }
      loadTrends(); return render();
    }
    if (t.id === 'csv') return exportCSV();
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'official') { S.officialOnly = e.target.checked; renderResults(); }
    if (e.target.id === 'trend-only') { S.trendOnly = e.target.checked; renderIdeas(); }
    if (e.target.id === 'few-only') { S.fewOnly = e.target.checked; render(); }
  });
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('rf-progress', function (e) {
    var el = $('#ideas-progress');
    if (el) el.textContent = 'Analyse des extraits : ' + e.detail.done + ' / ' + e.detail.total + ' (mis en cache pour les prochaines fois)';
  });

  // Réglages (version navigateur) : clé YouTube stockée localement
  var dlg = $('#settings');
  function openSettings() { $('#yt-key').value = localStorage.getItem('rf-yt-key') || ''; dlg.showModal(); }
  dlg.addEventListener('close', function () {
    if (dlg.returnValue !== 'save') return;
    var v = $('#yt-key').value.trim();
    if (v) localStorage.setItem('rf-yt-key', v); else localStorage.removeItem('rf-yt-key');
    S.youtube = !!v; S.trends = {}; S.rising = {};
    toast(v ? 'Clé YouTube enregistrée dans ce navigateur.' : 'Clé YouTube supprimée.');
    if (S.view === 'recherche' && S.title) runSearch(); else onRoute();
  });
  $('#settings-btn').addEventListener('click', openSettings);
  document.addEventListener('click', function (e) { if (e.target.closest('[data-settings]')) openSettings(); });
  modeReady.then(function () { $('#settings-btn').hidden = serverMode; if (S.view === 'recherche' && !S.title) render(); });

  api('/api/status').then(function (s) { S.youtube = s.youtube; S.soundcloud = s.soundcloud; if (S.view === 'recherche') renderResults(); }).catch(function () {});
  onRoute();
})();
