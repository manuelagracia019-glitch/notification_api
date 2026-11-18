# Plateforme Courrier — notifications email et SMS

La plateforme est composée d’une API Node.js/Express, d’un tableau de bord Next.js et d’une base PostgreSQL pilotée par Prisma.

## Démarrage local

### 1. Configurer l’API et PostgreSQL

Créer une base PostgreSQL nommée `notification_api`, puis dans PowerShell :

```powershell
cd notification\notification-api
Copy-Item .env.example .env
npm install
```

Modifier `notification-api\.env` avec l’URL PostgreSQL, deux jetons distincts (`NOTIFICATION_API_TOKEN` et `ADMIN_API_TOKEN`) et une clé de chiffrement. La commande suivante génère une valeur aléatoire de 32 octets encodée en Base64 :

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Exécuter la commande **trois fois**, en générant une valeur différente à chaque fois : une pour `NOTIFICATION_API_TOKEN`, une pour `ADMIN_API_TOKEN` et une pour `SETTINGS_ENCRYPTION_KEY`. Ne réutilisez pas une valeur d’un champ à l’autre. Conservez ces valeurs dans le fichier `.env` local (non versionné), jamais dans une collection Postman partagée. Sauvegardez séparément `SETTINGS_ENCRYPTION_KEY` : la perdre rend les identifiants fournisseur enregistrés indéchiffrables.

Pour le développement local, renseignez `DATABASE_URL` avec l’URL de la base PostgreSQL utilisée. Si vous choisissez Neon, utilisez l’URL pooled pour `DATABASE_URL` et l’URL directe (sans `-pooler`) pour `DATABASE_URL_UNPOOLED`.

Appliquer le schéma et démarrer l’API :

```powershell
npm exec prisma migrate deploy
npm exec prisma generate
npm run dev
```

L’API écoute par défaut sur `http://localhost:3001`. Les routes d’envoi nécessitent un jeton Bearer `NOTIFICATION_API_TOKEN` ; le jeton administrateur peut également être utilisé par le tableau de bord. Toutes les routes `/api/admin/*` requièrent `ADMIN_API_TOKEN` et PostgreSQL.

### 2. Démarrer le tableau de bord Next.js

Dans un autre terminal :

```powershell
cd notification\notification-web
Copy-Item .env.example .env.local
npm install
npm run dev
```

Ouvrir `http://localhost:3000`, puis saisir `ADMIN_API_TOKEN`. Le tableau de bord permet de composer des emails/SMS, consulter l’historique, suivre les statistiques et configurer Gmail/Vonage. Les secrets saisis sont chiffrés en AES-256-GCM avant leur enregistrement.

`NEXT_PUBLIC_API_URL` dans `notification-web\.env.local` permet de changer l’adresse de l’API. En déploiement, servir les applications en HTTPS et restreindre l’accès réseau à la console d’administration.

## Déploiement Railway + Vercel

Déployer l’API et le tableau de bord comme deux services séparés :

1. Sur Railway, créer un service PostgreSQL et importer le dépôt comme un second service avec `notification/notification-api` comme dossier racine. Définir la commande de build `npm run build`, la commande de démarrage `npm start` et le healthcheck `/health`.
2. Dans les variables du service API Railway, définir `DATABASE_URL` comme référence à la variable `DATABASE_URL` du service PostgreSQL Railway. Supprimer toute ancienne variable `DATABASE_URL_UNPOOLED` qui pointe vers Neon : Prisma utilise cette variable en priorité pour les migrations. Sans elle, les migrations utilisent `DATABASE_URL` et donc PostgreSQL Railway.
3. Configurer aussi `ADMIN_API_TOKEN`, `NOTIFICATION_API_TOKEN` et `SETTINGS_ENCRYPTION_KEY` dans le service API. `PORT` est fourni par Railway. Les variables Gmail/Vonage sont facultatives si les fournisseurs sont configurés depuis le tableau de bord.
4. Créer le domaine public Railway, puis configurer `FRONTEND_URL` avec l’origine exacte du site Vercel, sans chemin ni slash final. Plusieurs origines peuvent être séparées par des virgules. Les requêtes sans en-tête `Origin` restent acceptées; les requêtes navigateur ne sont autorisées que depuis ces origines.
5. Exécuter `npm run migrate:deploy` comme commande pre-deploy Railway afin de créer le schéma PostgreSQL dans la base Railway.
6. Sur Vercel, importer le même dépôt comme un second projet avec `notification/notification-web` comme dossier racine. Ajouter `NEXT_PUBLIC_API_URL` avec l’URL publique Railway, puis déployer. Cette variable étant intégrée au build du frontend, redéployer après l’avoir modifiée.
7. Dans le tableau de bord, se connecter avec `ADMIN_API_TOKEN`. Ne pas ajouter ce jeton au projet frontend ni à une variable `NEXT_PUBLIC_*`.

Les données présentes dans une ancienne base Neon ne sont pas copiées par les migrations. Pour repartir proprement, ressaisir les identifiants fournisseur dans le tableau de bord. Pour conserver des secrets fournisseur déjà chiffrés lors d’un transfert, garder la même `SETTINGS_ENCRYPTION_KEY`.

Pour les déploiements Preview Vercel, ajouter leurs origines à `FRONTEND_URL` dans Railway ou utiliser un domaine Preview stable. Garder les bases et secrets de Preview séparés de la production.

## Configuration des fournisseurs

Les identifiants peuvent être fournis par les variables d’environnement de l’API ou configurés dans le tableau de bord :

- Email : adresse Gmail et mot de passe d’application Google.
- SMS : clé API, secret API et expéditeur Vonage autorisé.

Pour modifier seulement l’adresse ou l’expéditeur depuis la console, laisser le champ secret vide : le secret déjà enregistré est conservé. L’API ne renvoie jamais les secrets enregistrés.

## API principale

Toutes les réponses d’envoi sont protégées par `Authorization: Bearer <NOTIFICATION_API_TOKEN>`.

- `GET /health`
- `POST /api/notifications/email` — `{ "to", "subject", "text" }`
- `POST /api/notifications/sms` — `{ "to", "body" }`
- `GET /api/admin/overview`
- `GET /api/admin/notifications?limit=50` — maximum 100
- `GET /api/admin/settings`
- `PUT /api/admin/settings/email` — `{ "user", "appPassword" }`
- `PUT /api/admin/settings/sms` — `{ "apiKey", "apiSecret", "sender" }`
- `DELETE /api/admin/settings/email` et `DELETE /api/admin/settings/sms` — supprime les identifiants enregistrés et désactive la configuration du fournisseur, y compris celle provenant des variables d’environnement.

Les envois sont conservés avec leur canal, destinataire, contenu, état (`pending`, `sent` ou `failed`), identifiant fournisseur et erreur éventuelle. Un SMS accepté par Vonage signifie que le fournisseur a accepté la soumission, pas que le téléphone l’a nécessairement reçu. L’historique contient des données de destinataire et de message : protégez l’accès à la base et définissez une durée de conservation adaptée à votre usage.

La collection Postman [Notification API.postman_collection.json](./notification-api/Notification%20API.postman_collection.json) contient les requêtes d’envoi et d’administration. Renseigner ses variables de jeton avec des valeurs locales ; ne pas enregistrer de vrais secrets dans une collection partagée.
