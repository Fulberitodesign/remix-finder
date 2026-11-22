/*
 * Analyse audio dans le navigateur : tempo (BPM) et tonalité d'un extrait de 30 s.
 * Équivalent JavaScript de audio.py (qui utilise librosa côté Python).
 */
(function (global) {
  'use strict';

  var SR = 22050;
  var NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  var NOTES_FR = ['do', 'do#', 'ré', 'mi♭', 'mi', 'fa', 'fa#', 'sol', 'la♭', 'la', 'si♭', 'si'];
  // Profils de Krumhansl-Schmuckler
  var MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  var CAMELOT_MAJOR = { 0: 8, 7: 9, 2: 10, 9: 11, 4: 12, 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7 };
  var CAMELOT_MINOR = { 9: 8, 4: 9, 11: 10, 6: 11, 1: 12, 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7 };

  // ---------------------------------------------------------------- FFT (radix 2)
  var fftCache = {};
  function fftTables(n) {
    if (fftCache[n]) return fftCache[n];
    var rev = new Uint32Array(n), bits = Math.log2(n);
    for (var i = 0; i < n; i++) {
      var r = 0, x = i;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    var cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (var k = 0; k < n / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / n); sin[k] = -Math.sin(2 * Math.PI * k / n); }
    var win = new Float64Array(n);
    for (var w = 0; w < n; w++) win[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / n);
    return (fftCache[n] = { rev: rev, cos: cos, sin: sin, win: win });
  }
  // Retourne le spectre d'amplitude (n/2 + 1 valeurs) d'une trame fenêtrée
  function magnitude(signal, start, n, out) {
    var t = fftTables(n), re = new Float64Array(n), im = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var v = start + i < signal.length ? signal[start + i] : 0;
      re[t.rev[i]] = v * t.win[i];
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (var s = 0; s < n; s += size) {
        for (var j = 0; j < half; j++) {
          var k = j * step, a = s + j, b = a + half;
          var tr = re[b] * t.cos[k] - im[b] * t.sin[k];
          var ti = re[b] * t.sin[k] + im[b] * t.cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    for (var m = 0; m <= n / 2; m++) out[m] = Math.sqrt(re[m] * re[m] + im[m] * im[m]);
    return out;
  }

  // ---------------------------------------------------------------- décodage
  var ctx = null;
  function decode(arrayBuffer) {
    ctx = ctx || new (global.AudioContext || global.webkitAudioContext)();
    return new Promise(function (resolve, reject) {
      ctx.decodeAudioData(arrayBuffer, resolve, reject);
    }).then(function (buf) {
      // Rééchantillonnage en mono 22 050 Hz
      var off = new OfflineAudioContext(1, Math.ceil(buf.duration * SR), SR);
      var src = off.createBufferSource();
      src.buffer = buf; src.connect(off.destination); src.start();
      return off.startRendering();
    }).then(function (b) { return b.getChannelData(0); });
  }

  // ---------------------------------------------------------------- tonalité
  var KEY_PROFILE = 'krumhansl';
  var CHROMA = { n: 16384, fmin: 55, fmax: 1800, power: 1, sigma: 0.35, whiten: true, log: 0, norm: 'max', agg: 'mean' };
  function chroma(y, opt) {
    opt = Object.assign({}, CHROMA, opt || {});
    var n = opt.n, hop = n / 2, bins = n / 2 + 1, mag = new Float64Array(bins);
    var total = new Float64Array(12);
    // Chaque bin contribue aux classes de hauteur proches (pondération gaussienne en demi-tons)
    var map = [];
    for (var k = 1; k < bins; k++) {
      var f = k * SR / n;
      if (f < opt.fmin || f > opt.fmax) continue;
      var pitch = 12 * Math.log2(f / 440) + 69, near = Math.round(pitch), d = pitch - near;
      var w = Math.exp(-0.5 * (d / opt.sigma) * (d / opt.sigma));
      if (w > 0.05) map.push([k, ((near % 12) + 12) % 12, w]);
    }
    var smooth = new Float64Array(bins), frames = [];
    for (var start = 0; start + n <= y.length; start += hop) {
      magnitude(y, start, n, mag);
      if (opt.whiten) {
        // retire l'enveloppe spectrale (timbre) : moyenne glissante sur ~1/3 d'octave
        var win = 40;
        var acc = 0, lo = 0, hi = -1;
        for (var b = 0; b < bins; b++) {
          var nlo = Math.max(0, b - win), nhi = Math.min(bins - 1, b + win);
          while (hi < nhi) { hi++; acc += mag[hi]; }
          while (lo < nlo) { acc -= mag[lo]; lo++; }
          smooth[b] = acc / (hi - lo + 1);
        }
      }
      var c = new Float64Array(12), max = 0, sum = 0;
      for (var i = 0; i < map.length; i++) {
        var m = map[i], v = mag[m[0]];
        if (opt.whiten) v = Math.max(0, v - smooth[m[0]]);
        if (opt.log) v = Math.log(1 + opt.log * v);
        c[m[1]] += Math.pow(v, opt.power) * m[2];
      }
      for (var j = 0; j < 12; j++) { if (c[j] > max) max = c[j]; sum += c[j]; }
      var dn = opt.norm === 'sum' ? sum : opt.norm === 'none' ? 1 : max;
      if (dn > 0) frames.push(Array.prototype.map.call(c, function (x) { return x / dn; }));
    }
    for (var q = 0; q < 12; q++) {
      var col = frames.map(function (f) { return f[q]; });
      if (opt.agg === 'median') { col.sort(function (a, b) { return a - b; }); total[q] = col[Math.floor(col.length / 2)] || 0; }
      else total[q] = col.reduce(function (a, b) { return a + b; }, 0);
    }
    return total;
  }
  function corr(a, b) {
    var n = a.length, ma = 0, mb = 0, sab = 0, saa = 0, sbb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    for (i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
    return sab / Math.sqrt(saa * sbb || 1);
  }
  var PROFILES = {
    krumhansl: [MAJOR, MINOR],
    temperley: [[0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400],
                [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330]]
  };
  function detectKey(y, opt) {
    var c = chroma(y, opt), best = { r: -2 };
    var prof = PROFILES[(opt && opt.profile) || KEY_PROFILE];
    [['major', prof[0]], ['minor', prof[1]]].forEach(function (m) {
      for (var tonic = 0; tonic < 12; tonic++) {
        var rolled = [];
        for (var i = 0; i < 12; i++) rolled[i] = m[1][(i - tonic + 12) % 12];
        var r = corr(rolled, c);
        if (r > best.r) best = { r: r, tonic: tonic, mode: m[0] };
      }
    });
    return best;
  }
  function keyInfo(tonic, mode) {
    var num = (mode === 'major' ? CAMELOT_MAJOR : CAMELOT_MINOR)[tonic];
    return {
      tonalite: NOTES_FR[tonic] + ' ' + (mode === 'major' ? 'majeur' : 'mineur'),
      tonalite_courte: NOTES[tonic] + (mode === 'major' ? '' : 'm'),
      camelot: num + (mode === 'major' ? 'B' : 'A')
    };
  }

  // ---------------------------------------------------------------- tempo
  var TEMPO = { harmonics: false };
  function detectTempo(y, opt) {
    opt = Object.assign({}, TEMPO, opt || {});
    var n = 1024, hop = 512, fps = SR / hop, bins = n / 2 + 1;
    var prev = null, mag = new Float64Array(bins), env = [];
    for (var start = 0; start + n <= y.length; start += hop) {
      magnitude(y, start, n, mag);
      var cur = new Float64Array(bins), flux = 0;
      for (var k = 0; k < bins; k++) cur[k] = Math.log(1 + 100 * mag[k]);
      if (prev) for (var j = 0; j < bins; j++) { var d = cur[j] - prev[j]; if (d > 0) flux += d; }
      env.push(flux); prev = cur;
    }
    // Retire la moyenne locale (~1 s) pour garder les attaques
    var w = Math.round(fps / 2), onset = new Float64Array(env.length);
    for (var i = 0; i < env.length; i++) {
      var s = 0, c = 0;
      for (var t = Math.max(0, i - w); t <= Math.min(env.length - 1, i + w); t++) { s += env[t]; c++; }
      onset[i] = Math.max(0, env[i] - s / c);
    }
    // Autocorrélation pondérée autour de 120 BPM (comme librosa)
    var best = { score: -1, lag: 0 }, scores = {};
    var minLag = Math.floor(fps * 60 / 220), maxLag = Math.ceil(fps * 60 / 55);
    var lagLimit = Math.min(onset.length - 1, maxLag * 2);
    for (var lag = Math.max(1, Math.floor(minLag / 2)); lag <= lagLimit; lag++) {
      var acc = 0;
      for (var a = 0; a + lag < onset.length; a++) acc += onset[a] * onset[a + lag];
      acc /= (onset.length - lag);
      scores[lag] = acc;
    }
    for (var L = minLag; L <= maxLag; L++) {
      var sc = scores[L];
      // renforce les périodes dont le double est aussi régulier (évite les erreurs 3/2)
      if (opt.harmonics) sc += 0.5 * (scores[2 * L] || 0) + 0.25 * (scores[Math.round(L / 2)] || 0);
      var bp = 60 * fps / L;
      var pr = Math.exp(-0.5 * Math.pow(Math.log2(bp / 120) / 1.0, 2));
      if (sc * pr > best.score) best = { score: sc * pr, lag: L };
    }
    // Affinage par interpolation parabolique
    var l = best.lag, y0 = scores[l - 1], y1 = scores[l], y2 = scores[l + 1], shift = 0;
    if (y0 != null && y2 != null && (y0 - 2 * y1 + y2) !== 0) shift = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
    return 60 * fps / (l + Math.max(-0.5, Math.min(0.5, shift)));
  }

  // ---------------------------------------------------------------- API publique
  var CACHE_KEY = 'rf-analyse';
  function cacheAll() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; } }
  function cacheSet(id, v) {
    var all = cacheAll(); all[id] = v;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch (e) { /* stockage plein */ }
  }

  function analyzeSignal(y, deezerBpm) {
    var key = detectKey(y);
    var tempo = deezerBpm || detectTempo(y);
    return Object.assign({
      bpm: Math.round(tempo * 10) / 10,
      bpm_estime: !deezerBpm,
      confiance: Math.round(key.r * 100) / 100
    }, keyInfo(key.tonic, key.mode));
  }

  function analyzePreview(id, url, deezerBpm) {
    var cached = cacheAll()[id];
    if (cached) return Promise.resolve(cached);
    if (!url) return Promise.resolve(null);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('extrait ' + r.status);
      return r.arrayBuffer();
    }).then(decode).then(function (y) {
      if (y.length < SR * 5) return null;
      var res = analyzeSignal(y, deezerBpm);
      cacheSet(id, res);
      return res;
    }).catch(function (e) {
      console.warn('Analyse impossible', id, e);
      return null;
    });
  }

  // ---------------------------------------------------------------- compatibilité
  function tempoMatch(a, b) {
    var best = null;
    [[1, ''], [2, 'demi-tempo'], [0.5, 'double tempo']].forEach(function (f) {
      var diff = (b * f[0] - a) / a * 100;
      if (!best || Math.abs(diff) < Math.abs(best[0])) best = [diff, f[1]];
    });
    return best;
  }
  function camelotRelation(k1, k2) {
    var n1 = parseInt(k1, 10), l1 = k1.slice(-1), n2 = parseInt(k2, 10), l2 = k2.slice(-1);
    var step = Math.min(((n1 - n2) % 12 + 12) % 12, ((n2 - n1) % 12 + 12) % 12);
    if (l1 === l2 && step === 0) return [1, 'même tonalité'];
    if (l1 !== l2 && step === 0) return [0.85, 'relative ' + (l2 === 'B' ? 'majeure' : 'mineure')];
    if (l1 === l2 && step === 1) return [0.85, 'tonalité voisine'];
    if (l1 === l2 && step === 2) return [0.55, '+2 sur la roue (montée d\'énergie)'];
    return [0.15, 'tonalités éloignées'];
  }
  function compatibility(origin, other) {
    var tm = tempoMatch(origin.bpm, other.bpm), diff = tm[0], tlabel = tm[1];
    var tempoScore = Math.max(0, 1 - Math.abs(diff) / 8);
    var kr = camelotRelation(origin.camelot, other.camelot);
    var tnote = Math.abs(diff) < 1.5 ? (tlabel || 'même tempo')
      : (diff > 0 ? '+' : '') + Math.round(diff) + ' %' + (tlabel ? ' (' + tlabel + ')' : '');
    return {
      score: Math.round(100 * (0.55 * tempoScore + 0.45 * kr[0]) * (Math.abs(diff) > 12 ? 0.6 : 1)),
      ecart_tempo: Math.round(diff * 10) / 10,
      note_tempo: tnote,
      note_tonalite: kr[1],
      tempo_ok: Math.abs(diff) <= 4,
      tonalite_ok: kr[0] >= 0.8
    };
  }
  function explain(other, comp) {
    var parts = [];
    if (comp.tonalite_ok && comp.tempo_ok) parts.push('Tempo et tonalité compatibles : les deux titres peuvent tourner l\'un sur l\'autre presque sans retouche.');
    else if (comp.tempo_ok) parts.push('Tempo très proche, mais tonalités différentes : il faudra transposer l\'une des deux voix.');
    else if (comp.tonalite_ok) parts.push('Tonalité compatible (' + comp.note_tonalite + '), mais il faut ajuster le tempo (' + comp.note_tempo + ').');
    else parts.push('Mélange risqué : tempo et tonalité à retravailler.');
    if (/demi|double/.test(comp.note_tempo)) parts.push('Le rapport demi/double tempo marche bien pour poser un couplet calme sur un refrain rapide.');
    if (other.tendance) parts.push(other.titre_court + ' est dans le top en ce moment : bon potentiel de vues.');
    return parts.join(' ');
  }

  global.RFAudio = {
    _chroma: chroma, _detectKey: detectKey, _detectTempo: detectTempo,
    analyzePreview: analyzePreview, analyzeSignal: analyzeSignal, decode: decode,
    compatibility: compatibility, explain: explain, keyInfo: keyInfo, tempoMatch: tempoMatch, camelotRelation: camelotRelation
  };
})(window);
