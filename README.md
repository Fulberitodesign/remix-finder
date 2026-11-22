# Remix Finder

Retrouve les remix, mashups, bootlegs et edits d'une chanson, avec les tendances du moment et des idées de mashup selon le tempo et la tonalité.

## Version en ligne (sans rien installer)

Le dossier `docs/` contient une version qui fonctionne entièrement dans le navigateur. Elle est publiée sur GitHub Pages :

**https://fulberitodesign.github.io/remix-finder/**

Différences avec la version Python :

| | En ligne (GitHub Pages) | Python (`app.py`) |
|---|---|---|
| Installation | aucune | Python + dépendances |
| Sources | MusicBrainz, Deezer, Mixcloud, YouTube (clé dans les réglages ⚙) | les mêmes + SoundCloud |
| Tempo et tonalité | analyse en JavaScript, un peu moins précise | librosa |
| Cache des analyses | dans le navigateur | `cache/analyse.json` |

La clé YouTube saisie dans les réglages reste dans ton navigateur (stockage local) et n'est envoyée qu'à Google. Limite-la à l'adresse du site dans la Google Cloud Console.

### Publier sur GitHub Pages

Dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/docs`. Sur un compte GitHub gratuit, le dépôt doit être public.

## Installation

Il faut Python 3.10 ou plus récent.

```bash
pip install -r requirements.txt
```

## Lancer l'appli web

```bash
python app.py
```

Puis ouvre http://localhost:5000 dans ton navigateur.

### Sources

| Source | Clé | Ce qu'elle apporte |
|---|---|---|
| MusicBrainz | aucune | remix officiels et liens « remix de » / « mashup de » |
| Deezer | aucune | remix en streaming, extraits audio, pochettes, tops |
| Mixcloud | aucune | remix et mashups publiés par des DJ |
| YouTube | `YOUTUBE_API_KEY` | mashups et remix amateurs, vues, « Remix qui décollent » |
| SoundCloud | `SOUNDCLOUD_CLIENT_ID` + `SOUNDCLOUD_CLIENT_SECRET` | remix, bootlegs et edits publiés sur SoundCloud |

### SoundCloud (facultatif)

SoundCloud exige une application enregistrée sur son portail développeur (https://soundcloud.com/you/apps). Les inscriptions sont parfois fermées ou soumises à validation. Une fois l'identifiant et le secret obtenus :

```bash
SOUNDCLOUD_CLIENT_ID=ton_id SOUNDCLOUD_CLIENT_SECRET=ton_secret python app.py
```

### YouTube (facultatif)

Sans clé, l'appli cherche dans MusicBrainz et Deezer. Avec une clé YouTube Data API v3 (gratuite, à créer dans la Google Cloud Console), elle trouve aussi les mashups et remix amateurs publiés sur YouTube, ainsi que les « Remix qui décollent » :

```bash
YOUTUBE_API_KEY=ta_cle python app.py
```

Sous Windows (PowerShell) :

```powershell
$env:YOUTUBE_API_KEY="ta_cle"; python app.py
```

## Fonctions

- **Recherche** avec autocomplétion, tri par popularité, par vues gagnées par jour ou par date, filtres par catégorie, variantes regroupées (slowed, nightcore…), extraits audio de 30 s et export CSV.
- **Titre d'origine** : tempo, tonalité et code Camelot, calculés à partir de l'extrait Deezer.
- **Idées de mashup** (page à part) : titres du top et d'artistes proches, notés selon la compatibilité de tempo et de tonalité (roue de Camelot).
- **Tendances** : top Deezer France, Monde et États-Unis, avec le nombre de remix existants pour repérer les titres encore peu remixés.

## Limites

- Le tempo et la tonalité sont estimés sur 30 secondes d'extrait. Dans la version en ligne, la tonalité trouvée est identique à celle de librosa dans environ 6 cas sur 10, et voisine sur la roue de Camelot dans la plupart des autres : le tempo peut sortir à la moitié ou au double, et la tonalité peut se tromper sur certains titres.
- La première recherche d'idées analyse une soixantaine d'extraits et peut prendre 30 à 60 secondes. Ensuite, le cache `cache/analyse.json` rend l'opération quasi instantanée.
- Le comptage des remix dans les tendances se base sur la recherche Deezer : c'est un ordre de grandeur, pas un chiffre exact.
- TikTok n'a pas d'API publique pour ses sons tendance : l'appli renvoie vers le TikTok Creative Center.

## Ligne de commande

Le script d'origine fonctionne toujours :

```bash
python remix_finder.py "The Weeknd" "Blinding Lights" --csv resultats.csv
```

## Organisation du code

- `docs/` : l'interface (HTML, CSS, JavaScript), partagée par les deux versions. `engine.js` et `analysis.js` sont le moteur du navigateur. L'interface utilise le serveur Python s'il répond, sinon ce moteur.
- `app.py` : serveur Flask (API + sert `docs/`).
- `remix_finder.py` : recherche dans les sources, utilisable aussi en ligne de commande.
- `audio.py` : analyse du tempo et de la tonalité avec librosa.
- `tests/` : tests hors ligne.

## Tester

### Tests automatiques (sans connexion)

```bash
pip install -r requirements-dev.txt
python -m pytest -q
```

Ils vérifient le tri des titres (remix, mashup, bootleg, edit, reprises écartées), la détection des faux positifs et le calcul de compatibilité tempo / tonalité.

### Test manuel de l'appli

1. `python app.py`, puis ouvre http://localhost:5000.
2. **Recherche** : tape « blinding » et choisis *Blinding Lights – The Weeknd* dans les suggestions. Tu dois voir la fiche du titre (171 BPM, fa mineur, 4A), les sources Deezer, MusicBrainz et Mixcloud en vert, et plus de 100 résultats.
3. Clique sur **Mashup** à gauche, puis sur « + 6 variantes » d'un résultat : les variantes s'affichent.
4. Essaie les tris **Popularité / En hausse / Récent**, le bouton **CSV**, l'écoute d'un extrait (lecteur en bas) et l'icône **TikTok** d'un résultat.
5. **Idées de mashup** : clique sur le bouton de la fiche. La première analyse prend 15 à 60 secondes. *Loser* de Tame Impala doit apparaître en tête avec une note d'environ 90.
6. **Tendances** : change de région, coche « Peu remixés seulement », puis utilise les boutons loupe et étoile d'un titre.
