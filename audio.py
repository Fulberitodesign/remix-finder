"""
Analyse audio des extraits Deezer (30 s) : tempo (BPM) et tonalité.

Les résultats sont mis en cache dans cache/analyse.json pour ne pas
réanalyser un titre déjà vu.
"""

import json
import os
import tempfile
import threading

import numpy as np
import requests

CACHE_FILE = os.path.join(os.path.dirname(__file__), "cache", "analyse.json")
_lock = threading.Lock()
_cache = None

NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
NOTES_FR = ["do", "do#", "ré", "mi♭", "mi", "fa", "fa#", "sol", "la♭", "la", "si♭", "si"]
# Profils de Krumhansl-Schmuckler
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
# Roue de Camelot : index de note -> numéro
CAMELOT_MAJOR = {0: 8, 7: 9, 2: 10, 9: 11, 4: 12, 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7}
CAMELOT_MINOR = {9: 8, 4: 9, 11: 10, 6: 11, 1: 12, 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7}


def _load_cache():
    global _cache
    if _cache is None:
        try:
            with open(CACHE_FILE, encoding="utf-8") as f:
                _cache = json.load(f)
        except (OSError, ValueError):
            _cache = {}
    return _cache


def _save_cache():
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    tmp = CACHE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_cache, f)
    os.replace(tmp, CACHE_FILE)


def key_info(tonic, mode):
    """mode = 'major' | 'minor'"""
    number = (CAMELOT_MAJOR if mode == "major" else CAMELOT_MINOR)[tonic]
    letter = "B" if mode == "major" else "A"
    return {
        "tonalite": f"{NOTES_FR[tonic]} {'majeur' if mode == 'major' else 'mineur'}",
        "tonalite_courte": NOTES[tonic] + ("" if mode == "major" else "m"),
        "camelot": f"{number}{letter}",
    }


def analyze_preview(track_id, preview_url, deezer_bpm=0):
    """Retourne {bpm, bpm_estime, tonalite, camelot, confiance} ou None."""
    cache = _load_cache()
    key = str(track_id)
    if key in cache:
        return cache[key]
    if not preview_url:
        return None

    import librosa  # import tardif : lent à charger

    try:
        data = requests.get(preview_url, timeout=20).content
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(data)
            path = f.name
        try:
            y, sr = librosa.load(path, sr=22050, mono=True)
        finally:
            os.unlink(path)
        if len(y) < sr * 5:
            return None
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(tempo)[0])
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
        best = max(
            (float(np.corrcoef(np.roll(profile, i), chroma)[0, 1]), i, mode)
            for mode, profile in (("major", MAJOR), ("minor", MINOR))
            for i in range(12)
        )
    except Exception as e:  # extrait illisible, réseau…
        print(f"  ! Analyse impossible pour {track_id} : {e}")
        return None

    result = {
        # Deezer donne parfois le vrai BPM : on le préfère à l'estimation
        "bpm": round(deezer_bpm, 1) if deezer_bpm else round(tempo, 1),
        "bpm_estime": not bool(deezer_bpm),
        "confiance": round(best[0], 2),
        **key_info(best[1], best[2]),
    }
    with _lock:
        cache[key] = result
        _save_cache()
    return result


# ------------------------------------------------------------------ compatibilité
def tempo_match(a, b):
    """Écart en % entre deux tempos, en acceptant demi et double tempo."""
    best = None
    for factor, label in ((1, ""), (2, "demi-tempo"), (0.5, "double tempo")):
        diff = (b * factor - a) / a * 100
        if best is None or abs(diff) < abs(best[0]):
            best = (diff, label)
    return best


def camelot_relation(k1, k2):
    n1, l1 = int(k1[:-1]), k1[-1]
    n2, l2 = int(k2[:-1]), k2[-1]
    step = min((n1 - n2) % 12, (n2 - n1) % 12)
    if l1 == l2 and step == 0:
        return 1.0, "même tonalité"
    if l1 != l2 and step == 0:
        return 0.85, "relative " + ("majeure" if l2 == "B" else "mineure")
    if l1 == l2 and step == 1:
        return 0.85, "tonalité voisine"
    if l1 == l2 and step == 2:
        return 0.55, "+2 sur la roue (montée d'énergie)"
    return 0.15, "tonalités éloignées"


def compatibility(origin, other):
    diff, tlabel = tempo_match(origin["bpm"], other["bpm"])
    tempo_score = max(0.0, 1 - abs(diff) / 8)  # au-delà de 8 % d'écart, trop d'étirement
    key_score, klabel = camelot_relation(origin["camelot"], other["camelot"])
    if abs(diff) < 1.5:
        tnote = tlabel or "même tempo"
    else:
        tnote = f"{diff:+.0f} %" + (f" ({tlabel})" if tlabel else "")
    return {
        # au-delà de 12 % d'écart de tempo, le mashup demande trop d'étirement : score réduit
        "score": round(100 * (0.55 * tempo_score + 0.45 * key_score) * (0.6 if abs(diff) > 12 else 1)),
        "ecart_tempo": round(diff, 1),
        "note_tempo": tnote,
        "note_tonalite": klabel,
        "tempo_ok": abs(diff) <= 4,
        "tonalite_ok": key_score >= 0.8,
    }


def explain(origin_title, other, comp):
    parts = []
    if comp["tonalite_ok"] and comp["tempo_ok"]:
        parts.append(f"Tempo et tonalité compatibles : les deux titres peuvent tourner l'un sur l'autre presque sans retouche.")
    elif comp["tempo_ok"]:
        parts.append("Tempo très proche, mais tonalités différentes : il faudra transposer l'une des deux voix.")
    elif comp["tonalite_ok"]:
        parts.append(f"Tonalité compatible ({comp['note_tonalite']}), mais il faut ajuster le tempo ({comp['note_tempo']}).")
    else:
        parts.append("Mélange risqué : tempo et tonalité à retravailler.")
    if "demi" in comp["note_tempo"] or "double" in comp["note_tempo"]:
        parts.append("Le rapport demi/double tempo marche bien pour poser un couplet calme sur un refrain rapide.")
    if other.get("tendance"):
        parts.append(f"{other['titre']} est dans le top en ce moment : bon potentiel de vues.")
    return " ".join(parts)
