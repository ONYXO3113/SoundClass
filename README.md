# ClassSound

ClassSound est un soundboard collaboratif en ligne inspiré des soundboards de mèmes et des salles de classe. Il permet à plusieurs PC d’entrer dans une même salle, sélectionner des destinataires et diffuser des sons en temps réel avec Socket.IO.

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + Socket.IO
- Audio: lecture dans le navigateur via l’API HTMLAudioElement
- Déploiement: compatible avec Render / Railway / VPS Linux / Node server with HTTPS

## Démarrage local

1. Installer les dépendances racine :
   npm install
2. Démarrer le projet complet :
   npm run dev
3. Ouvrir le frontend :
   http://localhost:5173
4. Le backend écoute sur :
   http://localhost:3001

## Variables d’environnement

Copier le fichier .env.example vers .env puis ajuster les valeurs si besoin.

## Build de production

npm run build
npm run start

## Déploiement gratuit

### Render

1. Créer un nouveau Web Service sur Render.
2. Brancher le dépôt GitHub.
3. Choisir le dossier racine du projet.
4. Définir le build command :
   npm install && npm run build
5. Définir le start command :
   npm run start
6. Ajouter les variables d’environnement :
   PORT=10000
   NODE_ENV=production
   CLIENT_ORIGIN=https://your-app.onrender.com
   VITE_SOCKET_URL=https://your-app.onrender.com
   VITE_API_URL=https://your-app.onrender.com

### Railway / Fly.io / VPS

Le backend et le frontend peuvent être déployés sur un même service Node ou sur deux services séparés si vous souhaitez un découpage plus propre.

## Limites connues

- Les URLs d’audio publiques utilisées pour les sons de démonstration peuvent être limitées selon le fournisseur d’assets.
- Les fichiers téléchargés persisteront sur le disque du serveur, pas dans le stockage objet gratuit sans configuration supplémentaire.
- La lecture audio dépend des permissions du navigateur et du système d’exploitation.
- Le mode HTTPS est nécessaire pour un déploiement fiable en production avec WebSocket.

## Fonctionnement du vote

- Un vote peut être lancé contre un membre connecté.
- Les électeurs éligibles sont les autres membres de la salle.
- Le seuil est de 60 % des votes exprimés.
- Le quorum est de 3 votes valides lorsque 3 électeurs ou plus sont éligibles.
- Une restriction active place la cible en réception uniquement pendant 2 minutes.
- La restriction est calculée côté serveur et ne dépend pas du navigateur.

## Événements Socket.IO

- join:room
- room:state
- sound:play
- sound:accepted
- vote:start
- vote:created
- vote:cast
- vote:update
- vote:result
- vote:cancelled

## Fichiers audios personnalisés

Les fichiers audio téléversés sont enregistrés côté serveur dans le dossier uploads pour un prototype durable.

## Tests

npm run test

## Notes de sécurité

- Ne pas exposer de secrets dans le dépôt.
- Vérifier les permissions d’origine CORS en production.
- Contrôler les tailles de fichiers et les formats autorisés.
