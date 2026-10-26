# Prototype dessin 3D Slidep

Spécification du prototype de tracé 3D de nœuds et de segments.

## Contexte

**Slidep** est une application web open source de conception mécanique 2D. On y dessine des mécanismes faits de poutres, pivots, glissières et courroies, puis on les simule (statique, cinématique, dynamique). La philosophie est « dessiner, c'est déjà simuler » : passer d'une idée à un mécanisme simulé en moins de 2 minutes, avec une UX simple plutôt que la précision d'une CAO. Les calculs tournent côté client, hors ligne. Le public visé : ingénieurs en idéation, étudiants, makers, enseignants.

L'évolution envisagée de cet outil est **Slidep 3D** : un outil rapide d'esquisse de structures en poutres dans l'espace. À terme, ces structures seront calculées et animées. Une étude des outils existants a montré que personne ne combine dans un navigateur, gratuitement, un croquis 3D rapide, le calcul des efforts et l'animation de mécanismes :

- SketchUp, Shapr3D, Tinkercad et Vention sont rapides, mais ne calculent pas.
- SkyCiv et Karamba calculent, mais leur saisie est lente.
- Onshape et Fusion animent, mais au prix d'une CAO lourde.

Avant toute physique, il faut valider le geste le plus risqué, **le tracé 3D à la souris**. Le curseur est en 2D, donc chaque clic doit savoir à quelle profondeur il tombe. Ce prototype sert uniquement à ça.

**Références d'interface retenues après essai :**

- **SketchUp** (outil Ligne) : alignement automatique sur les axes X/Y/Z colorés, verrouillage d'axe, longueur tapée au clavier pendant le tracé.
- **Vention MachineBuilder** : rendu 3D qui fait bien sentir l'orientation (volumes simples, grille au sol, repère), placement avec accrochage par incréments. C'est l'inspiration principale pour le placement 3D.

## Objectif

Prouver qu'on peut tracer une ossature 3D de nœuds et de segments aussi vite qu'un croquis 2D dans Slidep, sans jamais se perdre en profondeur.

Le prototype est isolé du reste de l'application et n'a **aucune physique**.

## Décisions techniques

| Sujet | Choix |
| --- | --- |
| Framework | Svelte 5 |
| Moteur 3D | Threlte 8 (Three.js). Passer par Three.js directement là où la performance compte (par exemple `InstancedMesh` pour les poutres) |
| Axe vertical | Z vers le haut (régler `camera.up` et `Object3D.DEFAULT_UP` en conséquence) |
| Projection | Toujours orthographique |
| Plan actif par défaut | Plan des 3 derniers nœuds placés. S'il y en a moins de 3, ou s'ils sont alignés : le plan XY, XZ ou YZ le plus face à la caméra, passant par le dernier nœud. En vue alignée, voir « Vue alignée sur un plan » |
| Souris | Clic droit pour orbiter, molette appuyée ou scroll trackpad horizontal/vertical pour déplacer, molette pour zoomer vers le curseur (style Onshape, utilisable au pavé tactile) |
| Unités et grille | mm, pas de 10 mm, grille adaptative qui s'affine quand on zoome |
| Langage | TypeScript |

**Architecture** : toute la logique de placement (accrochages, choix du plan, verrous, vue alignée) est dans un module TypeScript pur, indépendant de Threlte (`src/lib/core/placement.ts`). Il prend un rayon caméra, l'état de la scène et les verrous, et renvoie un point et le type d'accrochage. La règle du pivot d'orbite est aussi un module pur (`src/lib/core/pivot.ts`). Ces modules sont testés avec vitest, ainsi que l'état de l'éditeur (chaîne, Échap, coordonnées). Les composants Svelte et Threlte ne font qu'afficher et transmettre les événements.

## Ce que le prototype doit faire

### Modèle de données

- **Nœud** : `id`, position `(x, y, z)` en mm.
- **Segment** : `id`, `nodeA`, `nodeB`. Un nœud partagé par plusieurs segments est un seul nœud.
- La scène ne garde jamais de nœud isolé : le premier point d'une chaîne n'est créé qu'avec le deuxième.
- Sauvegarde et rechargement de la scène en JSON, au clavier (Ctrl+S, Ctrl+O). La scène est aussi conservée automatiquement dans le navigateur.

### Tracer

- L'outil Poutre trace une **chaîne** : chaque clic pose un nœud et crée le segment depuis le nœud précédent.
- Cliquer sur un segment le coupe en deux avec un nouveau nœud ; la chaîne continue.
- **Arriver sur un nœud existant** le réutilise, crée la poutre et termine la chaîne : on revient à la première étape. Commencer une chaîne sur un nœud existant ne la termine pas.
- Le double-clic termine la chaîne.
- **Échap**, par étapes : termine la chaîne en cours (retour à la première étape, même si une longueur est tapée ou un axe verrouillé), puis passe en Sélection, puis vide la sélection.
- Passer en Poutre avec **un seul nœud sélectionné** démarre la chaîne sur ce nœud, directement en deuxième étape.

### Placer le point, par ordre de priorité

C'est le cœur du prototype. L'ordre est fixe, pour que l'utilisateur puisse prévoir où tombera le point.

1. **Nœud existant** sous le curseur (tolérance en pixels écran).
2. **Point sur un segment** : milieu, extrémité, ou point quelconque.
3. **Axe X, Y ou Z depuis le dernier nœud**, quand la direction visée en est proche (seuil angulaire en écran). La profondeur est le point de l'axe le plus proche du rayon caméra, c'est-à-dire le point le plus proche entre deux droites. C'est ce qui permet de tracer une verticale à la souris.
4. **Guide d'alignement** : parallèle à un segment existant, ou même coordonnée qu'un autre nœud. Une ligne pointillée montre la référence.
5. **Plan actif** : intersection du rayon caméra avec le plan défini dans les décisions ci-dessus.

Les positions sont arrondies au pas de la grille, comme les incréments de Vention.

### Vue alignée sur un plan

Quand la caméra regarde dans l'axe (à moins de 15° d'un axe : vue de dessus, de face, de côté) et qu'aucun plan n'est forcé par Tab :

- Le plan d'axes face à la caméra devient le plan de travail. Il passe par le dernier nœud de la chaîne, sinon par l'origine.
- La grille s'affiche sur ce plan.
- On ne s'accroche qu'aux nœuds et segments contenus dans ce plan, et aux **points où un segment le traverse**. Poser un point de traversée coupe le segment.
- Les axes et les parallèles qui sortent du plan sont ignorés. Les alignements « même coordonnée qu'un nœud » restent actifs, même avec un nœud hors du plan.
- Pour dessiner dans un autre plan parallèle : sélectionner un nœud de ce plan, puis Poutre.

### Verrous et saisie

| Commande | Effet |
| --- | --- |
| X, Y, Z | verrouille l'axe (relâché après chaque point posé) |
| Shift maintenu | fige l'inférence en cours |
| Tab | force le plan actif sur XY, puis XZ, puis YZ, puis revient en automatique |
| chiffres + Entrée | longueur exacte (mm) dans la direction visée |
| Échap | voir « Tracer » |
| L / V | outil Poutre / Sélection |
| H, F | vue Maison, cadrer |
| Suppr | supprime la sélection |
| Ctrl+Z, Ctrl+Y | annuler, rétablir |

### Retour visuel

- Ligne en cours colorée selon l'axe (rouge X, vert Y, bleu Z), avec le libellé de l'accrochage près du curseur (« milieu », « sur axe Z », « parallèle à S3 », « traversée de S3 »).
- Près du curseur, sous le libellé : les **coordonnées X, Y, Z** du point visé, et la **longueur présentée comme un champ de saisie**. Avant de taper, le champ montre en gris la longueur en direct et « tapez une longueur » ; ensuite, la valeur tapée avec « Entrée pour valider ».
- **Pointillés vers les plans d'axes**, chacun de la couleur de l'axe qu'il suit : bleu jusqu'au plan XY, rouge jusqu'au plan YZ, vert jusqu'au plan XZ. Ombre du point sur le sol (z = 0).
- Grille adaptative, une seule à la fois. Le sol n'affiche que les grands traits, sauf vu de dessus. En vue de face ou de côté, une grille verticale (XZ ou YZ) le remplace.
- Repère d'axes : X et Y tracés dans la grille, Z en ligne infinie.
- Poutres affichées en volume simple (tube carré) pour lire l'orientation, nœuds en sphères. Survol et sélection mis en évidence.

### Caméra

- Orbite (clic droit glissé), déplacement, zoom vers le curseur.
- **Pivot de l'orbite**, montré par une cible orange pendant qu'on tourne :
  1. scène vide : l'origine ;
  2. nœud ou segment sous le curseur : ce point ;
  3. sinon : le point du rayon curseur le plus proche du centre de la géométrie, ramené dans sa boîte englobante. Le pivot reste ainsi dans le volume de la géométrie tout en suivant le curseur.
- Le tracé en cours reste actif pendant qu'on tourne.
- **Cube d'orientation** chanfreiné : 6 faces (octogones), 12 arêtes et 8 coins (hexagones, plus grands que les arêtes), soit 26 vues. Un clic oriente la vue et recadre la scène. Les coins ont une zone de clic élargie, qui déborde du cube ; le curseur change sur toute zone cliquable. Clic droit glissé sur le cube : orbite autour du centre de la géométrie.
- Sous le cube, le choix Perspective / Ortho. Scène vide : le cadrage se centre sur l'origine.

### Éditer

- Sélectionner nœuds et segments, supprimer, annuler et rétablir, vider la scène (annulable).
- Déplacer des nœuds avec un gizmo à trois flèches, aux pas de la grille.
- **Coordonnées éditables** : en sélection, une étiquette près du nœud affiche X, Y, Z dans des champs modifiables (Entrée ou clic ailleurs pour valider, Échap pour annuler). Un nœud seul prend la valeur ; plusieurs nœuds se déplacent ensemble pour que leur centre la prenne.

## Hors périmètre

Physique et solveurs, liaisons mécaniques, sections réelles, miroir et réseau, tactile, intégration dans l'éditeur 2D existant. Tout cela viendra une fois le geste de tracé validé.

## Critères de réussite

- [ ] Un cadre de vélo complet se trace en moins de 2 minutes, sans saisie au clavier.
- [ ] Un portique de 3 m × 2 m avec contreventement se trace aux cotes exactes en moins de 3 minutes.
- [ ] Aucun nœud ne tombe à une profondeur inattendue pendant ces deux essais.
- [ ] 200 segments restent fluides (60 images/s) sur un portable courant.
