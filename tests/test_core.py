"""Tests hors ligne : tri des titres et compatibilité des tonalités.

Lancer :  python -m pytest -q
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import audio  # noqa: E402
import remix_finder as rf  # noqa: E402


def test_classify_categories():
    assert rf.classify("Blinding Lights (Chromatics Remix)") == "remix"
    assert rf.classify("Stay x Blinding Lights") == "mashup"
    assert rf.classify("Blinding Lights (Aems Bootleg)") == "bootleg"
    assert rf.classify("Blinding Lights (slowed + reverb)") == "edit"


def test_classify_excludes_covers_and_originals():
    assert rf.classify("Blinding Lights") is None
    assert rf.classify("Blinding Lights (Piano Cover)") is None
    assert rf.classify("Blinding Lights - Karaoke") is None
    assert rf.classify("Blinding Lights (Radio Edit)") is None


def test_mentions_song():
    t = "Blinding Lights"
    assert rf.mentions_song("Blinding Lights Tropical Mix", t, "remix")
    assert rf.mentions_song("The Weeknd - Blinding Lights (Remix)", t, "remix")
    assert rf.mentions_song("Starboy (Blinding Lights Remix)", t, "remix")
    assert rf.mentions_song("Let's Love (Blinding Lights Dance Mashup)", t, "mashup")
    # autre chanson qui contient le titre
    assert not rf.mentions_song("City of Blinding Lights (Filo bootleg)", t, "bootleg")
    assert not rf.mentions_song("Blinding Lightsaber remix", t, "remix")


def test_camelot_keys():
    assert audio.key_info(5, "minor")["camelot"] == "4A"   # fa mineur
    assert audio.key_info(0, "major")["camelot"] == "8B"   # do majeur
    assert audio.key_info(9, "minor")["camelot"] == "8A"   # la mineur


def test_tempo_match_half_and_double():
    diff, label = audio.tempo_match(171, 85.5)
    assert abs(diff) < 0.1 and label == "demi-tempo"
    diff, label = audio.tempo_match(85, 170)
    assert abs(diff) < 0.1 and label == "double tempo"


def test_compatibility_scores():
    origin = {"bpm": 171, "camelot": "4A"}
    good = audio.compatibility(origin, {"bpm": 170, "camelot": "4A"})
    bad = audio.compatibility(origin, {"bpm": 120, "camelot": "10B"})
    assert good["score"] > 90 and good["tempo_ok"] and good["tonalite_ok"]
    assert bad["score"] < 30
    assert audio.camelot_relation("4A", "4B")[1].startswith("relative")
    assert audio.camelot_relation("12A", "1A")[1] == "tonalité voisine"


def test_download_links_only_artist_platforms():
    text = ("Free DL: https://hypeddit.com/dj/track-remix. Buy: https://artist.bandcamp.com/track/x "
            "Beatport https://www.beatport.com/release/y/1 and https://www.dropbox.com/s/abc/file.mp3 "
            "https://mega.nz/file/zzz")
    links = rf.download_links(text)
    names = [(l["nom"], l["type"]) for l in links]
    assert ("Hypeddit", "gratuit") in names
    assert ("Bandcamp", "achat") in names
    assert ("Beatport", "achat") in names
    # les hébergeurs de fichiers génériques sont ignorés
    assert not any("dropbox" in l["url"] or "mega.nz" in l["url"] for l in links)
    assert links[0]["url"] == "https://hypeddit.com/dj/track-remix"
