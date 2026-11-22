#!/usr/bin/env python3
"""
remix_finder.py - Retrouve les remix, mashups, edits et bootlegs d'une chanson.

Sources :
  - MusicBrainz (sans clé)  : remix officiels et liens "remix de" / "mashup de"
  - Deezer      (sans clé)  : remix et versions disponibles en streaming
  - Mixcloud    (sans clé)  : remix et mashups publiés par des DJ
  - YouTube     (clé option): mashups et remix amateurs (variable YOUTUBE_API_KEY)
  - SoundCloud  (clé option): SOUNDCLOUD_CLIENT_ID et SOUNDCLOUD_CLIENT_SECRET

Usage :
  python remix_finder.py "The Weeknd" "Blinding Lights"
  python remix_finder.py "Daft Punk" "One More Time" --csv resultats.csv
  YOUTUBE_API_KEY=xxxx python remix_finder.py "Dua Lipa" "Levitating"
"""

import argparse
import csv
import os
import re
import sys
import time
import unicodedata

import requests

USER_AGENT = "remix-finder/0.1 (outil personnel)"
SEARCH_SUFFIXES = ["remix", "mashup", "edit", "bootleg", "rework", "flip", "vs"]

# Mots qui indiquent une version dérivée, classés par catégorie (ordre = priorité)
CATEGORIES = [
    ("mashup", [r"mash ?-?up", r"\bvs\.?\b", r"\bx\b", r"\bmegamix\b"]),
    ("bootleg", [r"\bbootleg\b"]),
    ("remix", [r"\bremix\b", r"\bmix\b", r"\brework\b", r"\bflip\b", r"\bdub\b",
               r"\bvip\b", r"\bremake\b", r"\bblend\b"]),
    ("edit", [r"\bedit\b", r"\bslowed\b", r"\bsped ?up\b", r"\bnightcore\b",
              r"\bextended\b", r"\b8d\b", r"\bclub version\b"]),
]
# Résultats à écarter (reprises, tutos, etc.)
EXCLUDE = [r"\bkaraoke\b", r"\bcover\b", r"\btutorial\b", r"\btuto\b", r"\breaction\b",
           r"\blyrics?\b(?!.*remix)", r"\bpiano\b(?!.*remix)", r"\binstrumental\b(?!.*remix)",
           r"\bradio edit\b", r"\boriginal mix\b"]


def norm(text):
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def classify(text):
    t = norm(text)
    for pattern in EXCLUDE:
        if re.search(pattern, t):
            return None
    for name, patterns in CATEGORIES:
        if any(re.search(p, t) for p in patterns):
            return name
    return None


def mentions_song(text, title, category=None):
    """Le texte parle-t-il de la chanson ? (évite « City of Blinding Lights » pour « Blinding Lights »)"""
    t = norm(title)
    if not re.search(r"\b" + re.escape(t) + r"\b", norm(text)):
        return False
    if category == "mashup":
        return True
    # Pour un remix / edit : le titre doit ouvrir le nom du morceau, ou être cité entre parenthèses
    for segment in re.split(r"\s[-–|:]\s", text or ""):
        main = re.split(r"[(\[]", segment)[0]
        if norm(main).startswith(t):
            return True
        if re.search(r"\b" + re.escape(t) + r"\b", norm(segment)) and t not in norm(main):
            return True
    return False


# Plateformes où les artistes proposent eux-mêmes leurs morceaux (gratuitement ou à l'achat).
# Les hébergeurs de fichiers génériques (Dropbox, Drive, Mega, WeTransfer…) sont volontairement ignorés.
DOWNLOAD_HOSTS = [
    (r"hypeddit\.com", "Hypeddit", "gratuit"),
    (r"toneden\.io", "ToneDen", "gratuit"),
    (r"(?:[a-z0-9-]+\.)?bandcamp\.com", "Bandcamp", "achat"),
    (r"beatport\.com", "Beatport", "achat"),
    (r"traxsource\.com", "Traxsource", "achat"),
    (r"junodownload\.com", "Juno Download", "achat"),
]
_URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)


def download_links(text):
    """Liens de téléchargement légal trouvés dans une description (YouTube, Mixcloud, SoundCloud)."""
    out, seen = [], set()
    for url in _URL_RE.findall(text or ""):
        url = url.rstrip(".,;")
        host = re.sub(r"^https?://(www\.)?", "", url, flags=re.I).split("/")[0].lower()
        for pattern, name, kind in DOWNLOAD_HOSTS:
            if re.fullmatch(pattern, host) and url not in seen:
                seen.add(url)
                out.append({"nom": name, "url": url, "type": kind})
    return out


def get(url, params=None, headers=None, retries=3):
    headers = {"User-Agent": USER_AGENT, **(headers or {})}
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=20)
            if r.status_code == 503:  # limite de débit MusicBrainz
                time.sleep(2 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == retries - 1:
                print(f"  ! Erreur sur {url.split('/')[2]} : {e}", file=sys.stderr)
    return None


# ---------------------------------------------------------------- MusicBrainz
MB = "https://musicbrainz.org/ws/2"


def musicbrainz(artist, title):
    results = []
    # 1) Retrouver l'enregistrement original puis ses relations "remix"/"mashup"
    data = get(f"{MB}/recording", {"query": f'recording:"{title}" AND artist:"{artist}"',
                                   "fmt": "json", "limit": 5})
    originals = [r for r in (data or {}).get("recordings", [])
                 if norm(r.get("title")) == norm(title)][:2]
    for rec in originals:
        time.sleep(1.1)  # MusicBrainz : 1 requête / seconde
        detail = get(f"{MB}/recording/{rec['id']}",
                     {"inc": "recording-rels+artist-credits", "fmt": "json"})
        for rel in (detail or {}).get("relations", []):
            if rel.get("type") not in ("remix", "mashes up", "edit"):
                continue
            target = rel.get("recording") or {}
            cat = {"remix": "remix", "mashes up": "mashup", "edit": "edit"}[rel["type"]]
            results.append({
                "categorie": cat,
                "titre": target.get("title", ""),
                "artiste": "",
                "source": "MusicBrainz (lien officiel)",
                "lien": f"https://musicbrainz.org/recording/{target.get('id')}",
            })

    # 2) Recherche texte : enregistrements dont le titre contient la chanson + "remix" etc.
    time.sleep(1.1)
    data = get(f"{MB}/recording", {"query": f'recording:"{title}" AND (remix OR mix OR mashup OR edit OR bootleg)',
                                   "fmt": "json", "limit": 100})
    for rec in (data or {}).get("recordings", []):
        full = f"{rec.get('title', '')} {rec.get('disambiguation', '')}"
        cat = classify(full)
        if cat and mentions_song(rec.get("title"), title, cat):
            credit = " ".join(a.get("name", "") + a.get("joinphrase", "")
                              for a in rec.get("artist-credit", []))
            results.append({
                "categorie": cat,
                "titre": rec.get("title", "") + (f" ({rec['disambiguation']})" if rec.get("disambiguation") else ""),
                "artiste": credit.strip(),
                "source": "MusicBrainz",
                "lien": f"https://musicbrainz.org/recording/{rec['id']}",
                "date": rec.get("first-release-date", ""),
            })
    return results


# ---------------------------------------------------------------- Deezer
def deezer(artist, title):
    results = []
    for suffix in SEARCH_SUFFIXES:
        data = get("https://api.deezer.com/search", {"q": f"{title} {suffix}", "limit": 100})
        for t in (data or {}).get("data", []):
            name = t.get("title", "")
            cat = classify(name)
            if cat and mentions_song(name, title, cat):
                album = t.get("album") or {}
                results.append({
                    "categorie": cat,
                    "titre": name,
                    "artiste": (t.get("artist") or {}).get("name", ""),
                    "source": "Deezer",
                    "lien": t.get("link", ""),
                    "deezer_id": t.get("id"),
                    "album_id": album.get("id"),
                    "pochette": album.get("cover_medium", ""),
                    "extrait": t.get("preview", ""),
                    "rang_deezer": t.get("rank", 0),
                    "duree": t.get("duration", 0),
                })
    return results


# ---------------------------------------------------------------- YouTube
def youtube(artist, title, key):
    results = []
    for suffix in SEARCH_SUFFIXES:
        data = get("https://www.googleapis.com/youtube/v3/search",
                   {"part": "snippet", "type": "video", "maxResults": 50,
                    "q": f"{artist} {title} {suffix}", "key": key})
        for item in (data or {}).get("items", []):
            sn = item.get("snippet", {})
            name = sn.get("title", "")
            cat = classify(name)
            if cat and mentions_song(name, title, cat):
                results.append({
                    "categorie": cat,
                    "titre": name,
                    "artiste": sn.get("channelTitle", ""),
                    "source": "YouTube",
                    "lien": f"https://www.youtube.com/watch?v={item['id']['videoId']}",
                    "video_id": item["id"]["videoId"],
                    "pochette": ((sn.get("thumbnails") or {}).get("medium") or {}).get("url", ""),
                    "date": (sn.get("publishedAt") or "")[:10],
                })
    return results


# ---------------------------------------------------------------- Mixcloud (sans clé)
def mixcloud(artist, title):
    results = []
    for suffix in ["remix", "mashup", "bootleg", "edit"]:
        data = get("https://api.mixcloud.com/search/", {"q": f"{title} {suffix}", "type": "cloudcast", "limit": 50})
        for c in (data or {}).get("data", []):
            name = c.get("name", "")
            cat = classify(name)
            if cat and mentions_song(name, title, cat):
                results.append({
                    "categorie": cat,
                    "titre": name,
                    "artiste": (c.get("user") or {}).get("name", ""),
                    "source": "Mixcloud",
                    "lien": c.get("url", ""),
                    "pochette": (c.get("pictures") or {}).get("large", ""),
                    "date": (c.get("created_time") or "")[:10],
                    "ecoutes": c.get("play_count", 0),
                    "jour_publication": c.get("created_time", ""),
                    "mixcloud_key": c.get("key", ""),
                })
    return results


# ---------------------------------------------------------------- SoundCloud (clé obligatoire)
_sc_token = {"value": None, "expires": 0}


def soundcloud_token(client_id, client_secret):
    """Jeton OAuth « client credentials » de l'API officielle SoundCloud."""
    if _sc_token["value"] and time.time() < _sc_token["expires"] - 60:
        return _sc_token["value"]
    r = requests.post("https://secure.soundcloud.com/oauth/token",
                      data={"grant_type": "client_credentials"},
                      auth=(client_id, client_secret),
                      headers={"User-Agent": USER_AGENT, "accept": "application/json; charset=utf-8"},
                      timeout=20)
    r.raise_for_status()
    tok = r.json()
    _sc_token["value"] = tok["access_token"]
    _sc_token["expires"] = time.time() + int(tok.get("expires_in", 3600))
    return _sc_token["value"]


def soundcloud(artist, title, client_id, client_secret):
    token = soundcloud_token(client_id, client_secret)
    results = []
    for suffix in ["remix", "mashup", "bootleg", "edit"]:
        data = get("https://api.soundcloud.com/tracks",
                   {"q": f"{title} {suffix}", "limit": 50, "access": "playable,preview"},
                   headers={"Authorization": f"OAuth {token}", "accept": "application/json; charset=utf-8"})
        items = data.get("collection", []) if isinstance(data, dict) else (data or [])
        for t in items:
            name = t.get("title", "")
            cat = classify(name)
            if cat and mentions_song(name, title, cat):
                created = (t.get("created_at") or "").replace("/", "-")
                results.append({
                    "categorie": cat,
                    "titre": name,
                    "artiste": (t.get("user") or {}).get("username", ""),
                    "source": "SoundCloud",
                    "lien": t.get("permalink_url", ""),
                    "pochette": (t.get("artwork_url") or "").replace("-large.", "-t300x300."),
                    "date": created[:10],
                    "ecoutes": t.get("playback_count", 0) or 0,
                    "jour_publication": created[:10],
                    # bouton « Télécharger » activé par l'artiste, + liens de sa description
                    "liens_telechargement": ([{"nom": "SoundCloud", "url": t.get("permalink_url", ""), "type": "gratuit"}]
                                             if t.get("downloadable") else []) + download_links(t.get("description", "")),
                })
    return results


# ---------------------------------------------------------------- Fusion / affichage
def dedupe(items):
    seen, out = set(), []
    for it in items:
        key = (norm(it["titre"]), norm(it["artiste"]), it["source"].split()[0])
        if key not in seen:
            seen.add(key)
            out.append(it)
    order = {name: i for i, (name, _) in enumerate(CATEGORIES)}
    return sorted(out, key=lambda x: (order.get(x["categorie"], 99), norm(x["titre"])))


def main():
    p = argparse.ArgumentParser(description="Retrouve les remix et mashups d'une chanson.")
    p.add_argument("artiste")
    p.add_argument("titre")
    p.add_argument("--csv", help="exporter les résultats dans un fichier CSV")
    p.add_argument("--sans-musicbrainz", action="store_true", help="ignorer MusicBrainz (plus rapide)")
    args = p.parse_args()

    found = []
    if not args.sans_musicbrainz:
        print("> MusicBrainz…", file=sys.stderr)
        found += musicbrainz(args.artiste, args.titre)
    print("> Deezer…", file=sys.stderr)
    found += deezer(args.artiste, args.titre)
    print("> Mixcloud…", file=sys.stderr)
    found += mixcloud(args.artiste, args.titre)
    sc_id, sc_secret = os.environ.get("SOUNDCLOUD_CLIENT_ID"), os.environ.get("SOUNDCLOUD_CLIENT_SECRET")
    if sc_id and sc_secret:
        print("> SoundCloud…", file=sys.stderr)
        found += soundcloud(args.artiste, args.titre, sc_id, sc_secret)
    key = os.environ.get("YOUTUBE_API_KEY")
    if key:
        print("> YouTube…", file=sys.stderr)
        found += youtube(args.artiste, args.titre, key)
    else:
        print("> YouTube ignoré (pas de YOUTUBE_API_KEY)", file=sys.stderr)

    results = dedupe(found)
    current = None
    for r in results:
        if r["categorie"] != current:
            current = r["categorie"]
            print(f"\n=== {current.upper()} ===")
        artist = f" — {r['artiste']}" if r["artiste"] else ""
        print(f"• {r['titre']}{artist}  [{r['source']}]\n  {r['lien']}")
    print(f"\n{len(results)} résultat(s).")

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["categorie", "titre", "artiste", "source", "lien"],
                               extrasaction="ignore")
            w.writeheader()
            w.writerows(results)
        print(f"Exporté dans {args.csv}")


if __name__ == "__main__":
    main()
