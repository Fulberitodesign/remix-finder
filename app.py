#!/usr/bin/env python3
"""
Remix Finder – appli web.

Lancement :
    pip install -r requirements.txt
    python app.py
puis ouvrir http://localhost:5000

Clés facultatives :
  YOUTUBE_API_KEY                               mashups et remix amateurs, « Remix qui décollent »
  SOUNDCLOUD_CLIENT_ID + SOUNDCLOUD_CLIENT_SECRET  remix publiés sur SoundCloud
"""

import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from flask import Flask, jsonify, request, send_from_directory

import audio
import remix_finder as rf

app = Flask(__name__, static_folder="docs", static_url_path="")
POOL = ThreadPoolExecutor(max_workers=6)
CHARTS = {"fr": 1109890291, "world": 3155776842, "us": 1313621735}  # playlists Deezer « Top »
YT_REGION = {"fr": "FR", "world": None, "us": "US"}


# ------------------------------------------------------------------ petit cache mémoire
_mem = {}


def cached(key, ttl, fn):
    hit = _mem.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = fn()
    _mem[key] = (time.time(), value)
    return value


def yt_key():
    return os.environ.get("YOUTUBE_API_KEY", "").strip()


def sc_keys():
    cid = os.environ.get("SOUNDCLOUD_CLIENT_ID", "").strip()
    secret = os.environ.get("SOUNDCLOUD_CLIENT_SECRET", "").strip()
    return (cid, secret) if cid and secret else None


STANDALONE = ("YouTube", "Mixcloud", "SoundCloud")  # chaque upload reste une ligne à part


# ------------------------------------------------------------------ helpers Deezer
def deezer_track(track_id):
    return cached(f"dz-track-{track_id}", 86400,
                  lambda: rf.get(f"https://api.deezer.com/track/{track_id}") or {})


def deezer_album_date(album_id):
    if not album_id:
        return ""
    data = cached(f"dz-album-{album_id}", 86400,
                  lambda: rf.get(f"https://api.deezer.com/album/{album_id}") or {})
    return data.get("release_date", "")


def mixcloud_description(key):
    data = cached(f"mc-{key}", 86400, lambda: rf.get(f"https://api.mixcloud.com{key}") or {})
    return data.get("description", "") or ""


def short_track(t, **extra):
    album = t.get("album") or {}
    return {
        "deezer_id": t.get("id"),
        "titre": t.get("title", ""),
        "titre_court": t.get("title_short") or t.get("title", ""),
        "artiste": (t.get("artist") or {}).get("name", ""),
        "pochette": album.get("cover_medium", ""),
        "pochette_grande": album.get("cover_big", ""),
        "extrait": t.get("preview", ""),
        "lien": t.get("link", ""),
        "rang_deezer": t.get("rank", 0),
        **extra,
    }


def find_origin(artist, title):
    data = rf.get("https://api.deezer.com/search", {"q": f"{artist} {title}", "limit": 25}) or {}
    tracks = data.get("data", [])
    exact = [t for t in tracks
             if rf.norm(t.get("title_short") or t.get("title")) == rf.norm(title)
             and rf.norm(artist) in rf.norm((t.get("artist") or {}).get("name"))
             and not rf.classify(t.get("title", ""))]
    pool = exact or [t for t in tracks if rf.norm(title) in rf.norm(t.get("title"))] or tracks
    if not pool:
        return None
    best = max(pool, key=lambda t: t.get("rank", 0))
    return short_track(best)


def analyze_track(track):
    """Ajoute bpm/tonalité à un titre Deezer (en place)."""
    full = deezer_track(track["deezer_id"])
    preview = full.get("preview") or track.get("extrait")
    info = audio.analyze_preview(track["deezer_id"], preview, full.get("bpm") or 0)
    if info:
        track.update(info)
    return track


# ------------------------------------------------------------------ popularité
def popularity(item):
    """Score 0-100 comparable entre sources (approximatif)."""
    if item.get("vues"):
        return min(100, round(math.log10(item["vues"] + 1) / 9 * 100))
    if item.get("ecoutes"):
        return min(100, round(math.log10(item["ecoutes"] + 1) / 7 * 100))
    if item.get("rang_deezer"):
        return min(100, round(math.log10(item["rang_deezer"] + 1) / 6 * 100))
    return 0


def youtube_stats(items):
    ids = [i["video_id"] for i in items if i.get("video_id")]
    stats = {}
    for start in range(0, len(ids), 50):
        data = rf.get("https://www.googleapis.com/youtube/v3/videos",
                      {"part": "statistics,snippet", "id": ",".join(ids[start:start + 50]), "key": yt_key()}) or {}
        for v in data.get("items", []):
            stats[v["id"]] = v
    today = datetime.now(timezone.utc)
    for it in items:
        v = stats.get(it.get("video_id"))
        if not v:
            continue
        views = int(v.get("statistics", {}).get("viewCount", 0))
        links = rf.download_links(v["snippet"].get("description", ""))
        if links:
            it["liens_telechargement"] = links
        published = v["snippet"].get("publishedAt", "")
        it["vues"] = views
        it["date"] = published[:10]
        if published:
            days = max(1, (today - datetime.fromisoformat(published.replace("Z", "+00:00"))).days)
            it["vues_par_jour"] = round(views / days)


# ------------------------------------------------------------------ routes
@app.get("/")
def index():
    return send_from_directory("docs", "index.html")


@app.get("/api/status")
def status():
    return jsonify({"youtube": bool(yt_key()), "soundcloud": bool(sc_keys()), "serveur": True})


@app.get("/api/origin")
def origin():
    artist = request.args.get("artist", "").strip()
    title = request.args.get("title", "").strip()
    if not title:
        return jsonify({"error": "Indique au moins un titre."}), 400
    return jsonify({"origine": find_origin(artist, title)})


@app.get("/api/suggest")
def suggest():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify([])
    data = cached(f"suggest-{q.lower()}", 3600,
                  lambda: rf.get("https://api.deezer.com/search", {"q": q, "limit": 8}) or {})
    seen, out = set(), []
    for t in data.get("data", []):
        s = short_track(t)
        k = (rf.norm(s["titre_court"]), rf.norm(s["artiste"]))
        if k not in seen:
            seen.add(k)
            out.append(s)
    return jsonify(out[:6])


@app.get("/api/search")
def search():
    artist = request.args.get("artist", "").strip()
    title = request.args.get("title", "").strip()
    if not title:
        return jsonify({"error": "Indique au moins un titre."}), 400

    jobs = {
        "MusicBrainz": POOL.submit(rf.musicbrainz, artist, title),
        "Deezer": POOL.submit(rf.deezer, artist, title),
        "Mixcloud": POOL.submit(rf.mixcloud, artist, title),
    }
    if yt_key():
        jobs["YouTube"] = POOL.submit(rf.youtube, artist, title, yt_key())
    if sc_keys():
        jobs["SoundCloud"] = POOL.submit(rf.soundcloud, artist, title, *sc_keys())
    origin_job = POOL.submit(find_origin, artist, title)

    sources, found = {}, []
    for name, job in jobs.items():
        try:
            items = job.result(timeout=60)
            sources[name] = {"ok": True, "n": len(items)}
            found += items
        except Exception as e:
            sources[name] = {"ok": False, "erreur": str(e)}
    if not yt_key():
        sources["YouTube"] = {"ok": False, "erreur": "Clé YOUTUBE_API_KEY absente", "desactive": True}
    if not sc_keys():
        sources["SoundCloud"] = {"ok": False, "erreur": "Clés SOUNDCLOUD_CLIENT_ID / SECRET absentes", "desactive": True}

    results = rf.dedupe(found)

    # Fusion : un remix trouvé sur MusicBrainz ET Deezer n'apparaît qu'une fois
    merged = {}
    for r in results:
        k = rf.norm(r["titre"])
        if k in merged and r["source"] not in STANDALONE and merged[k]["source"] not in STANDALONE:
            m = merged[k]
            m["sources"] = sorted(set(m["sources"] + [r["source"].split()[0]]))
            for field in ("extrait", "pochette", "deezer_id", "album_id", "rang_deezer", "artiste", "date"):
                if not m.get(field) and r.get(field):
                    m[field] = r[field]
        else:
            r = dict(r)
            r["sources"] = [r["source"].split()[0]]
            merged[k if r["source"] not in STANDALONE else k + "|" + r["source"] + "|" + r.get("lien", "")] = r
    results = list(merged.values())

    # Officiel : un remix ou un edit qui crédite l'artiste d'origine (hors YouTube)
    for r in results:
        r["officiel"] = bool(
            artist and r["categorie"] in ("remix", "edit")
            and rf.norm(r.get("artiste")).startswith(rf.norm(artist))
            and not set(r["sources"]) & set(STANDALONE))

    # Liens de téléchargement légal dans les descriptions des mixes Mixcloud
    mc = [r for r in results if r.get("mixcloud_key")]
    for r, desc in zip(mc, POOL.map(mixcloud_description, [r["mixcloud_key"] for r in mc])):
        links = rf.download_links(desc)
        if links:
            r["liens_telechargement"] = links

    # Dates de sortie Deezer (via l'album) et stats YouTube
    albums = {r["album_id"] for r in results if r.get("album_id") and not r.get("date")}
    dates = dict(zip(albums, POOL.map(deezer_album_date, albums)))
    for r in results:
        if not r.get("date") and r.get("album_id"):
            r["date"] = dates.get(r["album_id"], "")
    if yt_key():
        youtube_stats([r for r in results if r.get("video_id")])
    today = date.today()
    for r in results:
        # écoutes par jour (Mixcloud, SoundCloud) depuis la publication
        if r.get("ecoutes") and r.get("date") and not r.get("vues_par_jour"):
            try:
                days = max(1, (today - date.fromisoformat(r["date"][:10])).days)
                r["vues_par_jour"] = round(r["ecoutes"] / days)
            except ValueError:
                pass
        r["popularite"] = popularity(r)

    origin = origin_job.result()
    return jsonify({"origine": origin, "resultats": results, "sources": sources})


@app.get("/api/origin/analyse")
def origin_analyse():
    track_id = request.args.get("id")
    if not track_id:
        return jsonify({}), 400
    t = analyze_track({"deezer_id": int(track_id)})
    return jsonify({k: t.get(k) for k in ("bpm", "bpm_estime", "tonalite", "tonalite_courte", "camelot", "confiance")})


def chart_tracks(region, limit=30):
    pid = CHARTS.get(region, CHARTS["fr"])
    data = cached(f"chart-{region}", 3 * 3600,
                  lambda: rf.get(f"https://api.deezer.com/playlist/{pid}/tracks", {"limit": 50}) or {})
    return [short_track(t, rang=i + 1) for i, t in enumerate(data.get("data", [])[:limit])]


@app.get("/api/ideas")
def ideas():
    track_id = request.args.get("id")
    region = request.args.get("region", "fr")
    if not track_id:
        return jsonify({"error": "id manquant"}), 400
    origin = analyze_track({"deezer_id": int(track_id), **short_track(deezer_track(track_id))})
    if not origin.get("camelot"):
        return jsonify({"error": "Impossible d'analyser l'extrait du titre d'origine.", "idees": []})

    candidates = [dict(t, tendance=True) for t in chart_tracks(region, 50)]
    # + titres populaires d'artistes proches de l'artiste d'origine
    artist_id = (deezer_track(track_id).get("artist") or {}).get("id")
    if artist_id:
        related = cached(f"related-{artist_id}", 86400,
                         lambda: rf.get(f"https://api.deezer.com/artist/{artist_id}/related", {"limit": 10}) or {})
        for a in related.get("data", [])[:10]:
            top = cached(f"top-{a['id']}", 86400,
                         lambda: rf.get(f"https://api.deezer.com/artist/{a['id']}/top", {"limit": 2}) or {})
            candidates += [short_track(t, tendance=False) for t in top.get("data", [])[:2]]

    seen, unique = {str(track_id)}, []
    for c in candidates:
        if str(c["deezer_id"]) not in seen and rf.norm(c["titre_court"]) != rf.norm(origin.get("titre_court")):
            seen.add(str(c["deezer_id"]))
            unique.append(c)

    analysed = [c for c in POOL.map(analyze_track, unique) if c.get("camelot")]
    out = []
    for c in analysed:
        comp = audio.compatibility(origin, c)
        score = comp["score"] + (6 if c.get("tendance") else 0)
        out.append({**c, **comp, "score": min(100, score),
                    "explication": audio.explain(origin.get("titre_court"), c, comp)})
    out.sort(key=lambda c: c["score"], reverse=True)
    good = [c for c in out if c["score"] >= 40] or out[:3]
    return jsonify({"idees": good[:12], "analyses": len(analysed)})


def count_remixes(track):
    title, artist = track["titre_court"], track["artiste"]
    data = cached(f"count-{rf.norm(title)}-{rf.norm(artist)}", 6 * 3600,
                  lambda: rf.get("https://api.deezer.com/search", {"q": f"{title} remix", "limit": 100}) or {})
    n = 0
    for t in data.get("data", []):
        name = t.get("title", "")
        cat = rf.classify(name)
        if not cat or not rf.mentions_song(name, title, cat):
            continue
        # titre très court (« 4 », « Dedans ») : on exige aussi le nom de l'artiste
        if len(rf.norm(title)) < 7 and rf.norm(artist) not in rf.norm(name + " " + (t.get("artist") or {}).get("name", "")):
            continue
        n += 1
    return n, data.get("total", 0) > 100 and n >= 90


@app.get("/api/trends")
def trends():
    region = request.args.get("region", "fr")
    tracks = chart_tracks(region, 30)
    counts = list(POOL.map(count_remixes, tracks))
    for t, (n, more) in zip(tracks, counts):
        t["nb_remix"] = n
        t["nb_remix_plus"] = more
        t["opportunite"] = n <= 3
    return jsonify({"titres": tracks})


@app.get("/api/rising")
def rising():
    if not yt_key():
        return jsonify({"desactive": True, "remix": []})
    region = request.args.get("region", "fr")

    def fetch():
        after = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ")
        params = {"part": "snippet", "type": "video", "q": "remix|mashup", "order": "viewCount",
                  "videoCategoryId": "10", "publishedAfter": after, "maxResults": 25, "key": yt_key()}
        if YT_REGION.get(region):
            params["regionCode"] = YT_REGION[region]
        data = rf.get("https://www.googleapis.com/youtube/v3/search", params) or {}
        items = []
        for it in data.get("items", []):
            sn = it["snippet"]
            cat = rf.classify(sn.get("title", ""))
            if not cat:
                continue
            items.append({"titre": sn["title"], "artiste": sn.get("channelTitle", ""), "categorie": cat,
                          "video_id": it["id"]["videoId"],
                          "lien": f"https://www.youtube.com/watch?v={it['id']['videoId']}",
                          "pochette": sn.get("thumbnails", {}).get("medium", {}).get("url", "")})
        youtube_stats(items)
        items.sort(key=lambda i: i.get("vues_par_jour", 0), reverse=True)
        return items[:10]

    return jsonify({"remix": cached(f"rising-{region}", 3 * 3600, fetch)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Remix Finder : http://localhost:{port}")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
