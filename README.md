# Suivi de réservations

Application web simple pour gérer les réservations d'un gîte.

## Fonctionnalités

- gestion des réservations et des blocages
- calendrier mensuel
- planning par chambre
- bilans mensuels et annuels
- personnalisation du nom du gîte, des chambres et des plateformes
- stockage local avec SQLite

## Lancer le projet

```bash
python3 server.py
```

Puis ouvrir :

- [http://127.0.0.1:8000](http://127.0.0.1:8000)

## Structure

- `index.html` : structure de l'interface
- `styles.css` : styles
- `app.js` et `js/` : logique front
- `server.py` : serveur Python et API
- `data/` : données locales générées au lancement

## Notes

- les données locales SQLite ne sont pas versionnées
- le projet peut être utilisé sur le réseau local
