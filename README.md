# Gestion Gîte

Application web de gestion d'un gîte : réservations, planning, bilans financiers et vitrine publique. Zéro dépendance externe — Python 3.11+ stdlib uniquement, SQLite embarqué.

---

## Fonctionnalités

**Espace admin (`/gestion`)**

- Réservations et blocages (multi-chambre, séjours fractionnés)
- Calendrier mensuel et planning par chambre
- Bilans mensuels et annuels avec comparaison et ventilation par plateforme / chambre
- Export CSV
- Demandes de réservation publiques : acceptation, refus, conversion en réservation
- Notifications email à chaque nouvelle demande (SMTP configurable)
- Paramètres : nom du gîte, chambres, plateformes, devise, personnalisation visuelle du site vitrine
- Sauvegarde / restauration JSON
- Changement de mot de passe admin

**Vitrine publique (`/`)**

- Présentation du gîte, des chambres avec galerie photos et carousel
- Lightbox plein écran au clic sur une image
- Formulaire de demande de réservation avec vérification de disponibilité en temps réel
- Polices Google Fonts indépendantes pour les titres et le corps du texte
- Responsive mobile

---

## Lancer le projet

```bash
python3 server.py
```

Le serveur s'ouvre automatiquement dans le navigateur. Accès :

| URL | Description |
|---|---|
| `http://127.0.0.1:8001` | Vitrine publique |
| `http://127.0.0.1:8001/gestion` | Interface admin |

Les variables d'environnement `HOST` (défaut `0.0.0.0`) et `PORT` (défaut `8001`) permettent de changer l'adresse d'écoute.

### Premier lancement

Au premier démarrage, un mot de passe admin est généré aléatoirement et affiché dans le terminal :

```
WARNING  Mot de passe admin initial généré automatiquement : xxxxxxxxxxxxxxxx
```

Ce mot de passe peut être changé dans l'espace admin → Paramètres → Changer le mot de passe.

---

## Structure

```
├── server.py          Serveur HTTP + API REST (stdlib Python)
├── index.html         Interface admin
├── public.html        Vitrine publique
├── login.html         Page de connexion
├── styles.css         Styles partagés (admin + public)
├── app.js             Point d'entrée JS admin
├── public.js          JS vitrine publique
├── js/
│   ├── api.js         Appels API
│   ├── dom.js         Cache des éléments DOM
│   ├── handlers.js    Gestionnaires d'événements
│   ├── render.js      Fonctions de rendu
│   ├── state.js       État applicatif
│   └── utils.js       Utilitaires
├── data/              Base SQLite générée au premier lancement (non versionnée)
└── tests/
    └── test_server_logic.py  Tests unitaires
```

---

## API

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/public-site` | — | Données publiques du gîte |
| GET | `/api/availability` | — | Disponibilité d'une chambre (`?arrivalDate=&departureDate=`) |
| POST | `/api/booking-requests` | — | Soumettre une demande de réservation |
| GET | `/api/session` | — | État de la session admin |
| POST | `/api/login` | — | Connexion admin |
| POST | `/api/logout` | admin | Déconnexion |
| GET | `/api/state` | admin | État complet (paramètres, réservations, demandes) |
| GET | `/api/backup` | admin | Export JSON complet |
| PUT | `/api/settings` | admin | Sauvegarder les paramètres |
| POST | `/api/restore` | admin | Restaurer depuis un backup |
| POST | `/api/reservations` | admin | Créer / modifier une réservation |
| DELETE | `/api/reservations/:id` | admin | Supprimer une réservation |
| POST | `/api/booking-requests/:id` | admin | Accepter ou refuser une demande |
| POST | `/api/admin/password` | admin | Changer le mot de passe |
| POST | `/api/upload` | admin | Upload d'image |

---

## Notifications email

Chaque nouvelle demande de réservation peut déclencher un email. Configuration dans l'espace admin → Paramètres → **Notifications par email**.

| Champ | Description |
|---|---|
| Email destinataire | Laisser vide pour désactiver les notifications |
| Serveur SMTP | Ex : `smtp.gmail.com` |
| Port SMTP | `587` (STARTTLS) ou `465` (SSL) |
| Identifiant | Adresse email du compte SMTP |
| Mot de passe | Mot de passe SMTP |

> **Gmail** : utiliser un [mot de passe d'application](https://myaccount.google.com/apppasswords) (la validation en deux étapes doit être activée).

Les credentials SMTP sont stockés dans une table SQLite séparée (`notification_settings`) et ne sont jamais exposés via l'API publique.

---

## Tests

```bash
python3 -m pytest tests/
```

---

## Notes

- Aucune dépendance externe Python — stdlib uniquement
- Données stockées localement dans `data/` (SQLite), non versionnées
- Conçu pour une utilisation mono-utilisateur en auto-hébergement (réseau local ou VPS)
- Les mots de passe sont hachés avec PBKDF2-HMAC-SHA256 (120 000 itérations)
