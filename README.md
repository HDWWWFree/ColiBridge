# Colibridge

Application web (PWA) de **covoiturage de colis entre la France et le Maghreb** : des voyageurs
(voiture, fourgon, camionnette, avion, bus, bateau) publient la place qu'il leur reste, des expéditeurs
réservent de la place pour quelques affaires personnelles, avec chat, notation dans les deux sens et
code de remise à la livraison.

**Colibridge met en relation, rien de plus** : aucun paiement sur la plateforme, aucun prix imposé,
aucune assurance. Voir la [charte](docs/CHARTE.md).

- Front : HTML / CSS / JavaScript vanilla, **sans build**
- Backend : [Supabase](https://supabase.com) (PostgreSQL, Auth, Row Level Security, Realtime, Storage)
- Hébergement : GitHub Pages (gratuit)

## Fonctionnalités

- Compte unique (expéditeur et voyageur), inscription avec acceptation de la charte (horodatée côté serveur)
- Recherche de trajets (sens, pays, ville, date, mode de transport)
- Publication de trajet avec profil voyageur (pièce d'identité, plaque et permis pour les modes routiers) et badge « Voyageur vérifié »
- Réservation : poids, catégorie, contenu déclaré, destinataire, charte + acceptation du contrôle du contenu
- Cycle : en attente → acceptée → colis récupéré → livrée (ou refusée / annulée)
- **Code de remise à 6 chiffres** : seul l'expéditeur le voit ; le voyageur le saisit à la livraison (5 essais max)
- Chat par réservation en temps réel
- Notation dans les deux sens (après livraison) et paliers d'expérience
- Signalements, mode sombre, PWA installable

## Mise en route (≈ 15 min)

### 1. Supabase

1. Créez un **nouveau projet** sur supabase.com.
2. `SQL Editor` → New query → collez tout `supabase/schema.sql` → **Run**.
3. `Authentication` → `Providers` → Email : pour vos premiers tests, désactivez « Confirm email »
   (sinon chaque inscription demande de cliquer un lien reçu par mail).
4. `Authentication` → `URL Configuration` → **Site URL** = l'adresse GitHub Pages (étape 3).
5. `Project Settings` → `API` : notez **Project URL** et la clé **anon public**.

### 2. Configurer l'application

Éditez `config.js` et remplacez `SUPABASE_URL` et `SUPABASE_ANON_KEY`.
La clé « anon » peut être publique (la sécurité est assurée par les règles RLS du schéma).
**Ne mettez jamais la clé `service_role` dans ce dépôt.**

### 3. GitHub Pages

1. Créez un dépôt GitHub (ex. `colibridge`) et envoyez-y les fichiers de ce dossier.
2. `Settings` → `Pages` → Source : **Deploy from a branch** → branche `main`, dossier `/ (root)` → Save.
3. Après ~1 minute : `https://<votre-compte>.github.io/colibridge/`

En ligne de commande :

```bash
git init
git add .
git commit -m "Colibridge v0.1"
git branch -M main
git remote add origin https://github.com/<votre-compte>/colibridge.git
git push -u origin main
```

### 4. Tester en local (facultatif)

```bash
python3 -m http.server 8000     # puis ouvrir http://localhost:8000
```

## Scénario de test

1. Créez deux comptes (deux navigateurs, ou un en navigation privée) : **Sara** (expéditrice) et **Karim** (voyageur).
2. Karim : Profil → profil voyageur (pièce d'identité, plaque, permis) → Publier un trajet.
3. Sara : Trajets → ouvrir le trajet → réserver. Elle voit son **code de remise** dans « Mes envois ».
4. Karim : Mes trajets → Accepter → « J'ai récupéré le colis ».
5. Sara donne le code à son destinataire, qui le donne à Karim → Karim saisit le code → **Livrée**.
6. Les deux se notent. Le chat fonctionne pendant tout le cycle.

## Administration (dans le SQL Editor de Supabase)

```sql
-- Valider un voyageur (badge « Voyageur vérifié »)
update public.driver_profiles set verification_status = 'verified' where user_id = '<uuid>';

-- Bannir un compte
update public.profiles set is_banned = true where id = '<uuid>';

-- Voir les signalements ouverts
select * from public.reports where status = 'open' order by created_at desc;
```

Les pièces d'identité sont dans le bucket privé `identity-docs` (Storage) : seul le propriétaire du
dossier y a accès depuis l'application ; vous les consultez depuis le dashboard.

## Structure

```
index.html        coquille de l'app (PWA)
app.js            routeur, vues, formulaires, chat temps réel
style.css         interface (mobile d'abord, mode sombre)
charter.js        texte de la charte (source unique, versionnée)
config.js         URL et clé anon Supabase  ← à éditer
sw.js, manifest.json, icons/   PWA
supabase/schema.sql            tables, RLS, triggers, RPC
docs/CHARTE.md    charte en markdown (générée depuis charter.js)
```

## À savoir avant une ouverture au public

- **Juridique** : la charte est un modèle. Faites-la relire, ainsi que les CGU et la politique de
  confidentialité (RGPD : pièces d'identité, numéros de téléphone), par un juriste. Le transport de
  colis par des particuliers entre deux pays touche à la douane et, en avion, aux règles des compagnies.
  Toute monétisation (commission, paiement en ligne, prix imposés) change le statut de la plateforme
  et demande une analyse dédiée dans chaque pays visé.
- **Marque** : vérifier « Colibridge » à l'INPI (classes 35, 39, 42) avant communication publique ;
  le nom « Colisbridge » (fret à Orly) est proche.
- **Non géré pour l'instant** : annulation en cascade d'un trajet ayant des réservations, notifications
  (push / email), litige formel, langue arabe / RTL, suppression de compte en libre-service.

## Pistes suivantes

Notifications push, autocomplétion d'adresses (Nominatim), version arabe, lien de suivi partageable,
photo du colis à la remise, filtre par rayon, app native (Capacitor).
