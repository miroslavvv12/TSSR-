# Outil de révision TSSR — consignes pour Claude

## Objectif
Rendre l'outil de révision TSSR de Dimitri optimal pour sa formation, et utilisable **100 % en local et hors réseau** :
- sur PC (Windows, grand écran) ;
- sur iPhone (appli installée depuis GitHub Pages).

## Règles (dans tout le travail)
- Répondre en **français, simplement** : Dimitri est débutant. Chaque terme technique employé dans un message doit avoir une définition de 2-3 phrases.
- **Ne jamais committer les cours ni les TP** : le dépôt est public. S'il faut les copier sur le disque, les mettre dans `cours_prives/`, qui est listé dans `.gitignore`.
- Contenu **uniquement tiré des cours et TP joints**. Ne rien inventer.
  - Chaque nouvelle question indique sa source dans le champ `s` : nom du fichier + page ou partie.
  - Une définition absente des cours doit être vérifiée en croisant plusieurs sources fiables, sources notées. Jamais de définition inventée. Ces questions sont marquées « hors cours ».
- **Noir et blanc doux** (palette existante). Juste/faux se distinguent par la forme, jamais par la couleur.
- **Git** : jamais de force-push ni de réécriture d'historique. Merge et push normaux. Pas d'identifiant de modèle dans les commits.
- N'utiliser **aucun document personnel** (santé, administratif, jeux).
- Lancer `python3 outils/build_entrainement.py` **après chaque modification**.

## Cours déjà exploités (à ne pas refaire)
VLAN, NAT/PAT, DHCP, DNS, Routeurs, Droits NTFS, Systèmes Windows (cours avancé), Partitionnement, Machines virtuelles, Veille technologique, Câblage réseau, Hardware + Poste de travail Hardware, Introduction à Linux, Initiation aux réseaux, Modèle OSI, Prise en main Windows 11. Les TP sont ignorés (consigne de Dimitri).
Ces cours sont dans `outils/quiz/*.json` et `outils/ouvertes/*.json`. Avant d'ajouter un fichier, comparer son thème au champ `t` et sa source au champ `s` des JSON.

## Fichiers du projet
- `outils/entrainement.frag.html` : source de la page (HTML, CSS et JS en un seul fichier).
  - Navigation : menu latéral (`<aside id="side">`, bouton ☰ `#menuBtn` en haut à gauche). Sur PC (≥ 1000 px) il reste ouvert (☰ le replie, choix gardé dans `S.pref.sideOff`) ; sur iPhone c'est un tiroir qui glisse (fermé par ✕, le voile, Échap ou un glissement vers la gauche). Rubriques : Accueil, puis
    - Cours : QCM, Questions ouvertes, À revoir (compteur), Examen blanc (chronométré, note sur 20, historique dans `S.exams`), Fiches, Mon bilan (points faibles + tableau « Couverture TSSR ») ; ce sont les valeurs de `qMode` (`qcm`, `ouv`, `rev`, `exam`, `fiche`, `bilan`), changées par `setQMode()` ;
    - Pratique : Commandes, Cisco, Linux, Sous-réseaux ;
    - Mémo : Ports, OSI, Dépannage.
  - **Mon titre TSSR** (`#titre`, 1er lien du menu après Accueil) : Dimitri passe le **nouveau titre RNCP 42463** (arrêté du 16 juin 2026, parcours commencés à partir du 1er septembre 2026 ; il a commencé après cette date). Constante `TITRE` : 3 blocs (BC01 Support aux utilisateurs, BC02 Exploiter les éléments de l'infrastructure, BC03 Maintenir en conditions opérationnelles) et 10 compétences, chacune avec `t` (thèmes du quiz qui la préparent), `go` (exercices pratiques) et `gap` (ce qui manque). La page affiche l'examen (mise en situation sur VM + traçabilité + oral, questionnaire avec au moins une question sur une doc technique en anglais par bloc, entretien technique, entretien final 15 min avec le dossier professionnel ; 7 h au total ; durées par bloc 3 h 15 / 3 h 30 / 3 h), la réussite par compétence (`tStats`) et des boutons QCM / examen blanc ciblés (`goQuiz`). Sources : fiche France compétences RNCP 42463 et Légifrance JORFTEXT000054273839 (lues via la recherche web : les sites ne sont pas joignables depuis l'environnement).
  - Filtre de thème `qTheme` : aussi `bc:0..2` (un bloc) et `cp:N` (une compétence de `TCOMP`) ; l'examen blanc accepte aussi `bc:N` comme périmètre. « Mon bilan » commence par un tableau par bloc ; « Couverture TSSR » est rangée par compétence du titre.
  - **Manques à combler** (cours à demander à Dimitri, ou questions hors cours vérifiées) : IA (usage et encadrement ; optimisation de scripts avec l'IA), anglais technique (questionnaire), environnement hybride, déploiement de postes et outils collaboratifs, gestion des mises à jour.
  - Page d'accueil (`#home`, « Aujourd'hui ») affichée à chaque ouverture. Elle ne répète pas le menu : 4 cartes « quoi faire » : Reprendre (dernière rubrique, `S.pref.lastTab`), À revoir (questions du jour), Point faible (thème le moins réussi, ≥ 3 questions répondues → QCM filtré sur ce thème), Ma progression (questions vues, % de réussite, dernier examen → Mon bilan).
  - Cisco et Linux : on arrive sur la liste des labs (cartes : n°, niveau, titre, avancement `ST.labs[id].n` ou ✓ Réussi, « dernier ouvert ») ; le lab s'ouvre au clic, avec « ← Tous les labs » pour revenir. `tab()` remet la liste à chaque arrivée par le menu.
  - Dans un lab, sur téléphone et petit écran (< 1024 px) : seule la tâche en cours s'affiche au-dessus du terminal (`#ciCur` / `#lxCur`, avec Indice) ; « Voir toutes les tâches et le schéma » déplie le détail (classe `full` sur `.labview`). Le terminal est moins haut et la ligne de saisie reste visible quand le clavier s'ouvre (elle passe à la ligne si l'invite est longue, ex. « Destination filename »). Liens : Indice, Voir toutes les tâches, Recommencer ce lab. Sur PC, rien ne change.
  - **Séries de 10** (QCM, Questions ouvertes, Commandes « De mémoire ») : barre « Série · 4/10 », puis un bilan (note, erreurs avec la bonne réponse, boutons « Revoir mes N erreurs » et « Série suivante »). État dans `S.ser[mode]`, erreurs à revoir dans `S.serRev[mode]` (modes `qcm`, `ouv`, `cmd`). « À revoir » et l'examen blanc ont déjà leur propre fin.
  - Thèmes et niveaux du quiz : dans le bouton repliable « Filtres » (`#qFiltres`, résumé des filtres choisis à côté).
  - Ce fragment, sans doctype, est aussi publié en Artifact claude.ai : https://claude.ai/artifact/GXvby1DYXEJd367ti3sapm (republier avec ce `url`).
- `outils/quiz/*.json` : QCM `{t, s, q, o[4], e, x[3], n}`.
  - `o[0]` est la bonne réponse ; elle est mélangée à l'affichage.
  - `e` est l'explication, `x` explique chaque mauvaise réponse.
  - `n` est le niveau, de 0 à 5.
- `outils/ouvertes/*.json` : questions ouvertes `{t, s, q, r, p:[[libellé, [mots-clés]]], n}`.
  - `r` est la réponse modèle.
  - Les mots-clés sont cherchés dans la réponse en minuscules et sans accents. Éviter les mots trop courants.
- Questions hors cours : `s` = « Notion générale (pas dans les cours que j'ai pu lire) ». Elles sont dans `outils/quiz/hors_cours.json` et `outils/ouvertes/hors_cours.json`. Elles s'affichent avec la mention « hors cours » et sont exclues du filtre « Mes cours seulement ». Quand un cours sur le même sujet arrive, remplacer ces questions par des questions tirées du cours.
- `outils/cisco_sim.js` : simulateur Cisco IOS (`CiscoSim`), labs (`CiscoLabs.LABS`) et interface du terminal. On peut le charger sous Node pour les tests.
- `outils/fiches/*.json` : fiches « À retenir » `{t, src, intro, blocs:[[titre, [points]]], pieges}`, rédigées à partir des cours (pages citées). Le thème `t` doit exister dans le quiz. Les thèmes sans fiche affichent un « mémo express » généré à partir des QCM de niveau 0 à 2.
- **Indices automatiques** (bouton « Indice », touche I ; pas en examen blanc) : 1er clic = rappel de cours (partie de la fiche choisie par la page citée dans `s` ou par les mots communs, sinon explications de questions voisines du même thème, sinon explication d'une mauvaise réponse) ; les points trop proches de la bonne réponse sont masqués (`hideAns`). 2e clic en QCM = deux mauvaises réponses écartées. Questions ouvertes : rappel + liste des points attendus. Réussie avec indice = revient le lendemain.
- **Commandes → « Dérouler (niveau 0) »** : les commandes de `CMDS` d'une catégorie défilent dans l'ordre ; on recopie chacune (commande + explication affichées), série de 10, 25, 50 ou toutes, à rejouer en boucle. Prévu plus tard (Dimitri le demandera quand il aura plus utilisé l'outil) : niveaux 1 à 5 pour Cisco (un objectif → taper la commande, du plus simple au plus complexe, derniers niveaux = mises en situation enchaînant plusieurs commandes), niveaux 1 à 4 (recopier dans le désordre, compléter, de mémoire, en situation) et plus de commandes Cisco et Linux.
- **Signalements** : lien « Signaler une erreur » sous chaque correction ; liste dans `S.reports` (pied de page « Mes signalements », bouton « Copier la liste » pour l'envoyer à Claude).
- `outils/linux_sim.js` : terminal Linux simulé (`LinuxSim`), labs (`LinuxLabs.LABS`) et interface de l'onglet Linux. Système de fichiers en mémoire avec inodes, droits UGO, utilisateurs et groupes (`/etc/passwd`, `/etc/group`, `/etc/shadow` régénérés), sudo et su (mots de passe : dimitri = tssr, alice = alice), liens, tubes et redirections, processus. Notions du cours Initiation à Linux ; les commandes sont des notions générales (hors cours).
- `outils/build_entrainement.py` :
  - injecte les JSON et le simulateur dans le fragment, entre les marqueurs `/*QUIZ_DEBUT*/…/*QUIZ_FIN*/`, `/*OUV_DEBUT*/…/*OUV_FIN*/`, `/*LINUX_DEBUT*/…/*LINUX_FIN*/` et `/*CISCO_DEBUT*/…/*CISCO_FIN*/` ;
  - génère `entrainement.html` ;
  - met à jour le nom du cache de `sw.js` (PWA hors ligne).

## Contenu actuel
- **571 QCM** :
  - 426 tirés des cours ;
  - 139 hors cours (AD et GPO, Windows Server et PowerShell, Linux, scripts, sauvegarde/RAID/PRA, supervision, sécurité, ITIL, virtualisation et cloud, Wi-Fi/VoIP/IPv6, messagerie et web) ;
  - 6 notions générales réparties dans les thèmes des cours.
- **62 questions ouvertes**.
- **Tirage des questions** :
  - une question ratée revient 8 questions plus tard ;
  - sinon, une question jamais vue, en commençant par le niveau le plus bas ;
  - sinon, une question parmi le quart le plus ancien.
- Clés `localStorage` : `tssr-entrainement` (quiz), `tssr-cisco` (labs Cisco) et `tssr-linux` (labs Linux).
- **Révision espacée** (mode « À revoir aujourd'hui ») : `S.srs[clé] = [boîte, jour d'échéance]`. Une question réussie revient dans 3, 7, 14 puis 30 jours ; ratée, elle revient le lendemain.
- **Transfert de progression** entre appareils, sans réseau : un code `TSSRz1:` (gzip + base64) ou `TSSR1:` qui contient les trois clés `localStorage`. L'import remplace la progression de l'appareil.
- **Appli iPhone** : `index.html` (copie de `outils/shell.html`) déchiffre `content.enc` (le site de cours d'une autre session) et y ajoute un bouton « Entraînement » dans la barre du haut (`header`, à droite ; la barre se décale pour ne rien recouvrir ; à défaut, bouton fixe en haut à droite), pour ne pas être caché par la bannière de mise à jour en bas. `entrainement.html` a un lien « ← Mes cours » pour revenir. `outils/build_app.py` garde `entrainement.html` dans l'appli et dans le cache hors ligne.
- **Appli PC (et autres navigateurs)** : `entrainement.html` est installable seule (`manifest-entrainement.webmanifest`, start_url `entrainement.html`) et enregistre elle-même `sw.js` (hors ligne après la 1re visite, bannière « Nouvelle version disponible · Mettre à jour »). Lien : https://miroslavvv12.github.io/TSSR-/entrainement.html → dans Edge ou Chrome, « Installer ». Le script d'enregistrement est ajouté par `build_entrainement.py` (pas dans le fragment, donc pas dans l'Artifact).
- **Publication** : GitHub Pages lit la branche `main`. Un changement n'arrive sur l'iPhone qu'une fois fusionné dans `main`.
- **Simulateur Cisco** :
  - modes, abréviations, `?`, Tab ;
  - VLAN, trunks, sous-interfaces ;
  - routes statiques, RIP, OSPF ;
  - ACL standard et étendues, NAT et PAT ;
  - serveur DHCP et relais ;
  - SSH et Telnet (`login local`, `transport input`, `access-class`) ;
  - port-security, STP (affichage seulement), CDP, table MAC ;
  - `logging synchronous` (retenu et affiché), plage `line vty 0 N` retenue, `show controllers <série>` (DCE = 1er appareil du lien) ;
  - PC : `ipconfig /renew` et `/release`, `ping`, `curl`, `ssh` et `telnet` avec session distante.
- **7 labs Linux** : arbo, fich, droits, users, liens, proc, libre. Tous se valident avec leur solution.
- **21 labs Cisco** (numérotés automatiquement dans l'ordre de `LABS`) : base, if, **swbase, rtbase** (configuration de base d'un switch 2960 et d'un routeur, d'après les fiches photographiées par Dimitri le 27/11 : hostname, no ip domain-lookup, interface vlan 1 + ip default-gateway ou G0/1 + S0/0/0 avec clock rate côté DCE, enable secret, line console 0 et line vty 0 15 / 0 4 avec password, login, logging synchronous, service password-encryption, copy run start, vérifications, ping et telnet depuis PC1), **swdefi, rtdefi** (mêmes tâches, valeurs tirées au hasard à chaque « Recommencer » : `make()` remplit `lab.p`, gardé dans `N.params` ; `tasks`, `topo` et `intro` sont des accesseurs calculés à partir de `lab.p`), vlan, trunk, static, rip, ros, ospf, acl, nat, dhcp, secu, 4 labs de dépannage (dep1 routage, dep2 VLAN/trunk, dep3 DHCP/relais, dep4 ACL : pannes préconfigurées à trouver), libre (bac à sable). Tous les labs qui ont des tâches se valident avec leur solution ; aucune tâche n'est validée au départ (la tâche « Sauvegarde » exige que les autres soient réussies).

## Tests
- **Node** : `require('./outils/cisco_sim.js')`, puis exécuter la solution de chaque lab et vérifier ses tâches.
- **Playwright** (Chromium préinstallé) sur `entrainement.html` :
  - aucune erreur de page ;
  - en 1366×768 et sur iPhone 13, pas de défilement horizontal.
