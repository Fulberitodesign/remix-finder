/*
 * Moteur de Remix Finder dans le navigateur (version GitHub Pages).
 * Reprend la logique de remix_finder.py et app.py, sans serveur :
 *   - Deezer par JSONP (son API n'autorise pas les appels directs depuis un site)
 *   - MusicBrainz, Mixcloud et YouTube par fetch
 * Expose RF.api(chemin, paramètres), qui renvoie les mêmes données que l'API Flask.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- texte
  function norm(t) {
    return (t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  var CATEGORIES = [
    ['mashup', [/mash ?-?up/, /\bvs\.?\b/, /\bx\b/, /\bmegamix\b/]],
    ['bootleg', [/\bbootleg\b/]],
    ['remix', [/\bremix\b/, /\bmix\b/, /\brework\b/, /\bflip\b/, /\bdub\b/, /\bvip\b/, /\bremake\b/, /\bblend\b/]],
    ['edit', [/\bedit\b/, /\bslowed\b/, /\bsped ?up\b/, /\bnightcore\b/, /\bextended\b/, /\b8d\b/, /\bclub version\b/]]
  ];
  var EXCLUDE = [/\bkaraoke\b/, /\bcover\b/, /\btutorial\b/, /\btuto\b/, /\breaction\b/,
    /\blyrics?\b(?!.*remix)/, /\bpiano\b(?!.*remix)/, /\binstrumental\b(?!.*remix)/,
    /\bradio edit\b/, /\boriginal mix\b/];
  function classify(text) {
    var t = norm(text);
    for (var i = 0; i < EXCLUDE.length; i++) if (EXCLUDE[i].test(t)) return null;
    for (var c = 0; c < CATEGORIES.length; c++) {
      if (CATEGORIES[c][1].some(function (p) { return p.test(t); })) return CATEGORIES[c][0];
    }
    return null;
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function mentionsSong(text, title, category) {
    var t = norm(title);
    if (!t) return false;
    var re = new RegExp('\\b' + escRe(t) + '\\b');
    if (!re.test(norm(text))) return false;
    if (category === 'mashup') return true;
    var segs = (text || '').split(/\s[-–|:]\s/);
    for (var i = 0; i < segs.length; i++) {
      var main = segs[i].split(/[(\[]/)[0];
      if (norm(main).indexOf(t) === 0) return true;
      if (re.test(norm(segs[i])) && norm(main).indexOf(t) < 0) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- réseau
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function qs(params) { return new URLSearchParams(params || {}).toString(); }

  // Deezer : JSONP, limité à ~8 requêtes / seconde (quota : 50 / 5 s)
  var dzQueue = Promise.resolve(), dzN = 0;
  function dzSlot() {
    var p = dzQueue.then(function () { return sleep(125); });
    dzQueue = p;
    return p;
  }
  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var cb = '__dz' + (++dzN) + '_' + Date.now();
      var s = document.createElement('script');
      var timer = setTimeout(function () { cleanup(); reject(new Error('Deezer ne répond pas')); }, 15000);
      function cleanup() { clearTimeout(timer); delete global[cb]; s.remove(); }
      global[cb] = function (data) { cleanup(); resolve(data); };
      s.onerror = function () { cleanup(); reject(new Error('Deezer injoignable')); };
      s.src = url + (url.indexOf('?') < 0 ? '?' : '&') + 'output=jsonp&callback=' + cb;
      document.head.appendChild(s);
    });
  }
  function deezer(path, params, attempt) {
    attempt = attempt || 0;
    return dzSlot().then(function () {
      return jsonp('https://api.deezer.com' + path + (params ? '?' + qs(params) : ''));
    }).then(function (d) {
      if (d && d.error) {
        if (d.error.code === 4 && attempt < 3) return sleep(1500).then(function () { return deezer(path, params, attempt + 1); });
        return {};
      }
      return d || {};
    }).catch(function () { return {}; });
  }
  function getJSON(url, params) {
    return fetch(url + (params ? '?' + qs(params) : '')).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  // MusicBrainz : 1 requête par seconde
  var mbQueue = Promise.resolve();
  function mb(path, params) {
    var p = mbQueue.then(function () {
      return getJSON('https://musicbrainz.org/ws/2' + path, Object.assign({ fmt: 'json' }, params))
        .catch(function () { return sleep(1500).then(function () { return getJSON('https://musicbrainz.org/ws/2' + path, Object.assign({ fmt: 'json' }, params)); }); })
        .catch(function () { return {}; });
    });
    mbQueue = p.then(function () { return sleep(1100); });
    return p;
  }
  function mapLimit(items, n, fn) {
    var out = new Array(items.length), i = 0;
    function next() {
      if (i >= items.length) return Promise.resolve();
      var k = i++;
      return Promise.resolve(fn(items[k], k)).then(function (v) { out[k] = v; return next(); });
    }
    var workers = [];
    for (var w = 0; w < Math.min(n, items.length); w++) workers.push(next());
    return Promise.all(workers).then(function () { return out; });
  }
  var mem = {};
  function cached(key, ttl, fn) {
    var hit = mem[key];
    if (hit && Date.now() - hit.t < ttl * 1000) return hit.v;
    var v = Promise.resolve(fn()).catch(function (e) { delete mem[key]; throw e; });
    mem[key] = { t: Date.now(), v: v };
    return v;
  }
  function ytKey() { return (localStorage.getItem('rf-yt-key') || '').trim(); }

  // ---------------------------------------------------------------- sources
  var SUFFIXES = ['remix', 'mashup', 'edit', 'bootleg', 'rework', 'flip', 'vs'];

  function shortTrack(t, extra) {
    var album = t.album || {};
    return Object.assign({
      deezer_id: t.id, titre: t.title || '', titre_court: t.title_short || t.title || '',
      artiste: (t.artist || {}).name || '', pochette: album.cover_medium || '', pochette_grande: album.cover_big || '',
      extrait: t.preview || '', lien: t.link || '', rang_deezer: t.rank || 0
    }, extra || {});
  }

  function srcDeezer(artist, title) {
    return Promise.all(SUFFIXES.map(function (s) {
      return deezer('/search', { q: title + ' ' + s, limit: 100 });
    })).then(function (pages) {
      var out = [];
      pages.forEach(function (d) {
        (d.data || []).forEach(function (t) {
          var cat = classify(t.title);
          if (cat && mentionsSong(t.title, title, cat)) {
            var album = t.album || {};
            out.push({ categorie: cat, titre: t.title, artiste: (t.artist || {}).name || '', source: 'Deezer',
              lien: t.link, deezer_id: t.id, album_id: album.id, pochette: album.cover_medium || '',
              extrait: t.preview || '', rang_deezer: t.rank || 0 });
          }
        });
      });
      return out;
    });
  }

  function srcMusicBrainz(artist, title) {
    var out = [];
    var q1 = 'recording:"' + title + '"' + (artist ? ' AND artist:"' + artist + '"' : '');
    return mb('/recording', { query: q1, limit: 5 }).then(function (d) {
      var originals = (d.recordings || []).filter(function (r) { return norm(r.title) === norm(title); }).slice(0, 2);
      return mapLimit(originals, 1, function (rec) {
        return mb('/recording/' + rec.id, { inc: 'recording-rels+artist-credits' }).then(function (det) {
          (det.relations || []).forEach(function (rel) {
            var cat = { remix: 'remix', 'mashes up': 'mashup', edit: 'edit' }[rel.type];
            var target = rel.recording || {};
            if (cat && target.id) out.push({ categorie: cat, titre: target.title || '', artiste: '', source: 'MusicBrainz',
              lien: 'https://musicbrainz.org/recording/' + target.id });
          });
        });
      });
    }).then(function () {
      return mb('/recording', { query: 'recording:"' + title + '" AND (remix OR mix OR mashup OR edit OR bootleg)', limit: 100 });
    }).then(function (d) {
      (d.recordings || []).forEach(function (rec) {
        var cat = classify(rec.title + ' ' + (rec.disambiguation || ''));
        if (cat && mentionsSong(rec.title, title, cat)) {
          var credit = (rec['artist-credit'] || []).map(function (a) { return (a.name || '') + (a.joinphrase || ''); }).join('').trim();
          out.push({ categorie: cat, titre: rec.title + (rec.disambiguation ? ' (' + rec.disambiguation + ')' : ''),
            artiste: credit, source: 'MusicBrainz', lien: 'https://musicbrainz.org/recording/' + rec.id,
            date: rec['first-release-date'] || '' });
        }
      });
      return out;
    });
  }

  function srcMixcloud(artist, title) {
    return Promise.all(['remix', 'mashup', 'bootleg', 'edit'].map(function (s) {
      return getJSON('https://api.mixcloud.com/search/', { q: title + ' ' + s, type: 'cloudcast', limit: 50 }).catch(function () { return {}; });
    })).then(function (pages) {
      var out = [];
      pages.forEach(function (d) {
        (d.data || []).forEach(function (c) {
          var cat = classify(c.name);
          if (cat && mentionsSong(c.name, title, cat)) out.push({ categorie: cat, titre: c.name, artiste: (c.user || {}).name || '',
            source: 'Mixcloud', lien: c.url, pochette: (c.pictures || {}).large || '', date: (c.created_time || '').slice(0, 10),
            ecoutes: c.play_count || 0 });
        });
      });
      return out;
    });
  }

  function srcYouTube(artist, title, key) {
    return Promise.all(SUFFIXES.map(function (s) {
      return getJSON('https://www.googleapis.com/youtube/v3/search',
        { part: 'snippet', type: 'video', maxResults: 50, q: artist + ' ' + title + ' ' + s, key: key }).catch(function () { return {}; });
    })).then(function (pages) {
      var out = [];
      pages.forEach(function (d) {
        (d.items || []).forEach(function (it) {
          var sn = it.snippet || {}, cat = classify(sn.title);
          if (cat && mentionsSong(sn.title, title, cat)) out.push({ categorie: cat, titre: decodeEntities(sn.title), artiste: sn.channelTitle || '',
            source: 'YouTube', lien: 'https://www.youtube.com/watch?v=' + it.id.videoId, video_id: it.id.videoId,
            pochette: ((sn.thumbnails || {}).medium || {}).url || '', date: (sn.publishedAt || '').slice(0, 10) });
        });
      });
      return out;
    });
  }
  function decodeEntities(s) { var t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; }

  function youtubeStats(items) {
    var key = ytKey(), ids = items.filter(function (i) { return i.video_id; }).map(function (i) { return i.video_id; });
    var chunks = [];
    for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    return Promise.all(chunks.map(function (c) {
      return getJSON('https://www.googleapis.com/youtube/v3/videos', { part: 'statistics,snippet', id: c.join(','), key: key }).catch(function () { return {}; });
    })).then(function (pages) {
      var stats = {};
      pages.forEach(function (p) { (p.items || []).forEach(function (v) { stats[v.id] = v; }); });
      items.forEach(function (it) {
        var v = stats[it.video_id];
        if (!v) return;
        var views = parseInt((v.statistics || {}).viewCount || '0', 10);
        it.vues = views;
        it.date = (v.snippet.publishedAt || '').slice(0, 10);
        var days = Math.max(1, Math.floor((Date.now() - new Date(v.snippet.publishedAt)) / 864e5));
        it.vues_par_jour = Math.round(views / days);
      });
    });
  }

  // ---------------------------------------------------------------- fusion
  var STANDALONE = ['YouTube', 'Mixcloud', 'SoundCloud'];
  function popularity(it) {
    if (it.vues) return Math.min(100, Math.round(Math.log10(it.vues + 1) / 9 * 100));
    if (it.ecoutes) return Math.min(100, Math.round(Math.log10(it.ecoutes + 1) / 7 * 100));
    if (it.rang_deezer) return Math.min(100, Math.round(Math.log10(it.rang_deezer + 1) / 6 * 100));
    return 0;
  }
  function dedupeAndMerge(found) {
    var seen = {}, list = [];
    found.forEach(function (it) {
      var k = norm(it.titre) + '|' + norm(it.artiste) + '|' + it.source;
      if (!seen[k]) { seen[k] = 1; list.push(it); }
    });
    var merged = {}, order = [];
    list.forEach(function (r) {
      var k = norm(r.titre), standalone = STANDALONE.indexOf(r.source) >= 0;
      if (!standalone && merged[k] && STANDALONE.indexOf(merged[k].source) < 0) {
        var m = merged[k];
        if (m.sources.indexOf(r.source) < 0) m.sources.push(r.source);
        m.sources.sort();
        ['extrait', 'pochette', 'deezer_id', 'album_id', 'rang_deezer', 'artiste', 'date'].forEach(function (f) {
          if (!m[f] && r[f]) m[f] = r[f];
        });
      } else {
        var c = Object.assign({}, r, { sources: [r.source] });
        var key = standalone ? k + '|' + r.source + '|' + r.lien : k;
        merged[key] = c; order.push(key);
      }
    });
    return order.map(function (k) { return merged[k]; });
  }

  // ---------------------------------------------------------------- endpoints
  function findOrigin(artist, title) {
    return deezer('/search', { q: artist + ' ' + title, limit: 25 }).then(function (d) {
      var tracks = d.data || [];
      var exact = tracks.filter(function (t) {
        return norm(t.title_short || t.title) === norm(title) && norm((t.artist || {}).name).indexOf(norm(artist)) >= 0 && !classify(t.title);
      });
      var pool = exact.length ? exact : tracks.filter(function (t) { return norm(t.title).indexOf(norm(title)) >= 0; });
      if (!pool.length) pool = tracks;
      if (!pool.length) return null;
      var best = pool.reduce(function (a, b) { return (b.rank || 0) > (a.rank || 0) ? b : a; });
      return shortTrack(best);
    });
  }

  function search(p) {
    var artist = (p.artist || '').trim(), title = (p.title || '').trim();
    if (!title) return Promise.reject(new Error('Indique au moins un titre.'));
    var jobs = { MusicBrainz: srcMusicBrainz(artist, title), Deezer: srcDeezer(artist, title), Mixcloud: srcMixcloud(artist, title) };
    if (ytKey()) jobs.YouTube = srcYouTube(artist, title, ytKey());
    var names = Object.keys(jobs), sources = {}, found = [];
    var originP = findOrigin(artist, title);
    return Promise.all(names.map(function (n) {
      return jobs[n].then(function (items) { sources[n] = { ok: true, n: items.length }; found = found.concat(items); })
        .catch(function (e) { sources[n] = { ok: false, erreur: String(e && e.message || e) }; });
    })).then(function () {
      if (!ytKey()) sources.YouTube = { ok: false, desactive: true, erreur: 'Ajoute ta clé YouTube dans les réglages' };
      sources.SoundCloud = { ok: false, desactive: true, erreur: 'Disponible seulement avec la version Python (clé secrète)' };
      var results = dedupeAndMerge(found);
      results.forEach(function (r) {
        r.officiel = !!(artist && (r.categorie === 'remix' || r.categorie === 'edit') &&
          norm(r.artiste).indexOf(norm(artist)) === 0 && !r.sources.some(function (s) { return STANDALONE.indexOf(s) >= 0; }));
      });
      // Dates de sortie Deezer (via l'album), pour les 40 albums les plus populaires
      var albums = [];
      results.slice().sort(function (a, b) { return (b.rang_deezer || 0) - (a.rang_deezer || 0); }).forEach(function (r) {
        if (r.album_id && !r.date && albums.indexOf(r.album_id) < 0 && albums.length < 40) albums.push(r.album_id);
      });
      return mapLimit(albums, 4, function (id) {
        return cached('album-' + id, 86400, function () { return deezer('/album/' + id); });
      }).then(function (ds) {
        var dates = {};
        albums.forEach(function (id, i) { dates[id] = (ds[i] || {}).release_date || ''; });
        results.forEach(function (r) { if (!r.date && r.album_id) r.date = dates[r.album_id] || ''; });
        return ytKey() ? youtubeStats(results.filter(function (r) { return r.video_id; })) : null;
      }).then(function () {
        results.forEach(function (r) {
          if (r.ecoutes && r.date && !r.vues_par_jour) {
            var days = Math.max(1, Math.floor((Date.now() - new Date(r.date)) / 864e5));
            if (days === days) r.vues_par_jour = Math.round(r.ecoutes / days);
          }
          r.popularite = popularity(r);
        });
        return originP;
      }).then(function (origine) {
        return { origine: origine, resultats: results, sources: sources };
      });
    });
  }

  function trackDetail(id) { return cached('track-' + id, 86400, function () { return deezer('/track/' + id); }); }

  function analyzeTrack(track) {
    return trackDetail(track.deezer_id).then(function (full) {
      return RFAudio.analyzePreview(track.deezer_id, full.preview || track.extrait, full.bpm || 0);
    }).then(function (info) { if (info) Object.assign(track, info); return track; });
  }

  var CHARTS = { fr: 1109890291, world: 3155776842, us: 1313621735 };
  function chartTracks(region, limit) {
    var id = CHARTS[region] || CHARTS.fr;
    return cached('chart-' + region, 3 * 3600, function () { return deezer('/playlist/' + id + '/tracks', { limit: 50 }); })
      .then(function (d) {
        return (d.data || []).slice(0, limit).map(function (t, i) { return shortTrack(t, { rang: i + 1 }); });
      });
  }

  function progress(done, total) {
    global.dispatchEvent(new CustomEvent('rf-progress', { detail: { done: done, total: total } }));
  }

  function ideas(p) {
    var id = p.id, region = p.region || 'fr', origin;
    return trackDetail(id).then(function (full) {
      origin = shortTrack(full);
      return analyzeTrack(origin);
    }).then(function () {
      if (!origin.camelot) return { error: 'Impossible d\'analyser l\'extrait du titre d\'origine.', idees: [] };
      return chartTracks(region, 50).then(function (chart) {
        var cands = chart.map(function (t) { return Object.assign(t, { tendance: true }); });
        return trackDetail(id).then(function (full) {
          var aid = (full.artist || {}).id;
          if (!aid) return cands;
          return deezer('/artist/' + aid + '/related', { limit: 10 }).then(function (rel) {
            return mapLimit((rel.data || []).slice(0, 10), 3, function (a) {
              return deezer('/artist/' + a.id + '/top', { limit: 2 });
            }).then(function (tops) {
              tops.forEach(function (t) { (t.data || []).slice(0, 2).forEach(function (x) { cands.push(shortTrack(x, { tendance: false })); }); });
              return cands;
            });
          });
        });
      }).then(function (cands) {
        var seen = {}, unique = [];
        seen[String(id)] = 1;
        cands.forEach(function (c) {
          if (!seen[String(c.deezer_id)] && norm(c.titre_court) !== norm(origin.titre_court)) { seen[String(c.deezer_id)] = 1; unique.push(c); }
        });
        var done = 0;
        progress(0, unique.length);
        return mapLimit(unique, 2, function (c) {
          // Les titres du top ont déjà leur extrait : pas besoin d'un appel Deezer de plus
          return RFAudio.analyzePreview(c.deezer_id, c.extrait, 0).then(function (info) {
            if (info) Object.assign(c, info);
            progress(++done, unique.length);
            return c;
          });
        });
      }).then(function (analysed) {
        analysed = analysed.filter(function (c) { return c.camelot; });
        var out = analysed.map(function (c) {
          var comp = RFAudio.compatibility(origin, c);
          var score = Math.min(100, comp.score + (c.tendance ? 6 : 0));
          return Object.assign({}, c, comp, { score: score, explication: RFAudio.explain(c, comp) });
        }).sort(function (a, b) { return b.score - a.score; });
        var good = out.filter(function (c) { return c.score >= 40; });
        if (!good.length) good = out.slice(0, 3);
        return { idees: good.slice(0, 12), analyses: analysed.length };
      });
    });
  }

  function countRemixes(track) {
    var title = track.titre_court, artist = track.artiste;
    return cached('count-' + norm(title) + '-' + norm(artist), 6 * 3600, function () {
      return deezer('/search', { q: title + ' remix', limit: 100 });
    }).then(function (d) {
      var n = 0;
      (d.data || []).forEach(function (t) {
        var cat = classify(t.title);
        if (!cat || !mentionsSong(t.title, title, cat)) return;
        if (norm(title).length < 7 && norm(t.title + ' ' + ((t.artist || {}).name || '')).indexOf(norm(artist)) < 0) return;
        n++;
      });
      return [n, (d.total || 0) > 100 && n >= 90];
    });
  }

  function trends(p) {
    return chartTracks(p.region || 'fr', 30).then(function (tracks) {
      return mapLimit(tracks, 4, countRemixes).then(function (counts) {
        tracks.forEach(function (t, i) { t.nb_remix = counts[i][0]; t.nb_remix_plus = counts[i][1]; t.opportunite = counts[i][0] <= 3; });
        return { titres: tracks };
      });
    });
  }

  function rising(p) {
    var key = ytKey();
    if (!key) return Promise.resolve({ desactive: true, remix: [] });
    var region = { fr: 'FR', us: 'US' }[p.region];
    return cached('rising-' + p.region + key, 3 * 3600, function () {
      var after = new Date(Date.now() - 14 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
      var params = { part: 'snippet', type: 'video', q: 'remix|mashup', order: 'viewCount', videoCategoryId: '10',
        publishedAfter: after, maxResults: 25, key: key };
      if (region) params.regionCode = region;
      return getJSON('https://www.googleapis.com/youtube/v3/search', params).then(function (d) {
        var items = [];
        (d.items || []).forEach(function (it) {
          var sn = it.snippet, cat = classify(sn.title);
          if (cat) items.push({ titre: decodeEntities(sn.title), artiste: sn.channelTitle || '', categorie: cat, video_id: it.id.videoId,
            lien: 'https://www.youtube.com/watch?v=' + it.id.videoId, pochette: ((sn.thumbnails || {}).medium || {}).url || '' });
        });
        return youtubeStats(items).then(function () {
          items.sort(function (a, b) { return (b.vues_par_jour || 0) - (a.vues_par_jour || 0); });
          return { remix: items.slice(0, 10) };
        });
      });
    });
  }

  function suggest(p) {
    var q = (p.q || '').trim();
    if (q.length < 2) return Promise.resolve([]);
    return cached('suggest-' + q.toLowerCase(), 3600, function () { return deezer('/search', { q: q, limit: 8 }); }).then(function (d) {
      var seen = {}, out = [];
      (d.data || []).forEach(function (t) {
        var s = shortTrack(t), k = norm(s.titre_court) + '|' + norm(s.artiste);
        if (!seen[k]) { seen[k] = 1; out.push(s); }
      });
      return out.slice(0, 6);
    });
  }

  var ROUTES = {
    '/api/status': function () { return Promise.resolve({ youtube: !!ytKey(), soundcloud: false, web: true }); },
    '/api/suggest': suggest,
    '/api/search': search,
    '/api/origin': function (p) { return findOrigin(p.artist || '', p.title || '').then(function (o) { return { origine: o }; }); },
    '/api/origin/analyse': function (p) {
      return analyzeTrack({ deezer_id: p.id }).then(function (t) {
        return { bpm: t.bpm, bpm_estime: t.bpm_estime, tonalite: t.tonalite, tonalite_courte: t.tonalite_courte, camelot: t.camelot, confiance: t.confiance };
      });
    },
    '/api/ideas': ideas,
    '/api/trends': trends,
    '/api/rising': rising
  };

  global.RF = {
    api: function (path, params) {
      var fn = ROUTES[path];
      if (!fn) return Promise.reject(new Error('Inconnu : ' + path));
      return Promise.resolve().then(function () { return fn(params || {}); });
    },
    classify: classify, mentionsSong: mentionsSong, norm: norm
  };
})(window);
