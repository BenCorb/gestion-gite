# Gestion Gîte

Gestion Gîte est une application open source pour administrer un gîte ou des
chambres d'hôtes et publier leur site vitrine depuis une seule interface.

- Réservations, blocages et planning par chambre
- Demandes de séjour depuis la vitrine publique
- Bilans financiers et export CSV
- Site personnalisable, responsive et optimisé pour le SEO
- Données locales dans SQLite
- Python standard, JavaScript vanilla, aucune dépendance serveur externe

## Exemple en production

[Le Clos des Vignes](https://closdesvignes.com/) est un exemple d'intégration
réelle de Gestion Gîte pour une maison d'hôtes.

Le nom, les textes, les chambres, les photos et les coordonnées visibles sur ce
site proviennent de sa propre base SQLite. Ils ne sont pas inclus dans ce dépôt.

## Installation rapide avec Docker

Prérequis : Docker et Docker Compose.

```bash
git clone https://github.com/BenCorb/gestion-gite.git
cd gestion-gite
cp .env.example .env
docker compose up -d --build
```

Ouvrir ensuite :

- Vitrine publique : <http://127.0.0.1:8080>
- Administration : <http://127.0.0.1:8080/gestion>

Le mot de passe administrateur initial est généré automatiquement. Pour le
retrouver :

```bash
docker compose logs gestion-gite
```

Les données et les images sont conservées dans `./data` grâce au montage
`./data:/app/data`.

## Installation sans Docker

Prérequis : Python 3.11 ou supérieur.

```bash
git clone https://github.com/BenCorb/gestion-gite.git
cd gestion-gite
python3 server.py
```

Le serveur écoute par défaut sur <http://127.0.0.1:8080>. Taper `exit`, puis
Entrée dans sa console pour l'arrêter proprement.

## Configuration

Toute la configuration métier se fait depuis `/gestion` :

- identité et coordonnées de l'établissement ;
- chambres, capacités, tarifs, équipements et photos ;
- plateformes de réservation ;
- apparence de la vitrine ;
- notifications SMTP ;
- titre, description, URL canonique et publication SEO.

Une nouvelle vitrine reste en `noindex` jusqu'à sa publication depuis la section
**Référencement et publication**.

Variables d'environnement principales :

| Variable | Défaut | Description |
|---|---:|---|
| `HOST` | `0.0.0.0` | Adresse d'écoute du serveur |
| `PORT` | `8080` | Port HTTP |
| `GITE_COOKIE_SECURE` | `0` | Utiliser `1` derrière HTTPS |
| `GITE_SESSION_DAYS` | `7` | Durée des sessions administrateur |

## Mise en production

Pour une installation publique :

1. placer l'application derrière un reverse proxy HTTPS ;
2. définir `GITE_COOKIE_SECURE=1` dans `.env` ;
3. sauvegarder régulièrement `data/` et `.env` ;
4. renseigner l'URL officielle et l'adresse structurée dans l'administration ;
5. publier la vitrine, puis vérifier `/robots.txt` et `/sitemap.xml`.

Ne jamais versionner ni publier `data/`, `.env` ou les images téléversées : ils
peuvent contenir des réservations, des coordonnées clients et des identifiants
SMTP.

## Tests

```bash
python3 -m pytest tests/
```

## Architecture

```text
server.py          Point d'entrée du serveur
gite/              Serveur HTTP, logique métier, SQLite et rendu SEO
index.html         Interface d'administration
public.html        Modèle de la vitrine publique
js/                Modules JavaScript vanilla
css/               Styles admin et vitrine
data/              Données propres à l'installation, non versionnées
tests/             Tests unitaires et HTTP
```

## Licence

Gestion Gîte est distribué sous [licence MIT](LICENSE).
