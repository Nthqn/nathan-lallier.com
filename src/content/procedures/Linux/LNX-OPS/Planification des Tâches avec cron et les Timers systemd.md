---
modele: "procedure"
titre: "Planification des Tâches avec cron et les Timers systemd"
type: "PROCEDURE"
class: "03. Serveur"
reference: "LNX-OPS-CFG"
creation: "18/10/2026"
revision: "18/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la planification de tâches récurrentes sur un serveur Linux Debian 13 ou Ubuntu Server 24.04 LTS avec les deux mécanismes disponibles : `cron` (tables personnelles `crontab`, fichiers système de `/etc/cron.d`, répertoires `cron.daily` et suivants, `anacron`) et les timers systemd (`OnCalendar`, `Persistent`, timers monotones), avec la validation des expressions par `systemd-analyze calendar`.

Le fil conducteur est un script de sauvegarde `/usr/local/sbin/sauvegarde-config` exécuté chaque nuit sur srv-lnx-01 (192.168.10.21), planifié successivement avec cron puis avec un timer systemd.

## Contexte et Justification

Un serveur exécute de nombreuses tâches périodiques : sauvegardes, purges de fichiers temporaires, rotations de journaux, exports, contrôles de santé. Lancées à la main, elles finissent par être oubliées. Mal planifiées, elles posent d'autres problèmes :

- Une tâche prévue à 2 h du matin ne s'exécute jamais si le serveur était arrêté à ce moment.
- Une tâche dont la sortie n'est lue par personne échoue en silence pendant des semaines.
- Deux exécutions se chevauchent quand la première dure plus longtemps que l'intervalle.
- Toutes les machines d'un parc lancent la même tâche à la même seconde et saturent un serveur central.

cron et les timers systemd répondent à ces besoins avec des approches différentes :

- **cron :** syntaxe compacte et universelle, connue de tous les administrateurs, adaptée aux tâches simples.
- **Timers systemd :** rattrapage des exécutions manquées, journalisation par journald, non chevauchement natif, délai aléatoire et confinement de la tâche par les options systemd.

## Concepts Clés

**Démon cron.** Service `cron` qui lit chaque minute les tables de planification et lance les commandes dont l'horaire correspond. Debian 13 et Ubuntu 24.04 fournissent le cron historique de Debian (paquet `cron`) ; `cronie` est disponible en alternative.

**Expression cron.** Cinq champs, minute (0 à 59), heure (0 à 23), jour du mois (1 à 31), mois (1 à 12) et jour de la semaine (0 à 7, 0 et 7 pour dimanche), suivis de la commande. `*/15` signifie toutes les 15 unités, `1-5` une plage, `1,15` une liste. Des raccourcis existent : `@reboot`, `@hourly`, `@daily`, `@weekly`, `@monthly`.

**crontab utilisateur.** Table personnelle éditée avec `crontab -e`, stockée dans `/var/spool/cron/crontabs/<utilisateur>`. Elle n'a pas de champ utilisateur : les commandes s'exécutent sous l'identité de son propriétaire.

**/etc/crontab et /etc/cron.d.** Tables système qui comportent un sixième champ, l'utilisateur d'exécution, placé avant la commande. Les paquets déposent leurs tâches dans `/etc/cron.d`.

**cron.hourly, cron.daily, cron.weekly, cron.monthly.** Répertoires de scripts exécutés par `run-parts` à la fréquence correspondante. Ils ne contiennent que des exécutables, sans expression horaire.

**anacron.** Outil qui exécute les tâches quotidiennes, hebdomadaires et mensuelles manquées pendant un arrêt de la machine. Il raisonne en jours, pas en heures. Quand le paquet `anacron` est installé, c'est lui qui lance `cron.daily`, `cron.weekly` et `cron.monthly`.

**Timer systemd.** Unité `.timer` qui déclenche une unité `.service` du même nom. Un timer est réaltime (`OnCalendar=`, basé sur l'horloge) ou monotone (`OnBootSec=`, `OnUnitActiveSec=`, basé sur un délai).

**Persistent.** Option d'un timer `OnCalendar` qui enregistre la dernière exécution sur disque. Si une échéance a été manquée pendant un arrêt, le service est lancé dès le démarrage suivant.

**Format OnCalendar.** `JourSemaine Année-Mois-Jour Heure:Minute:Seconde`, par exemple `Mon..Fri *-*-* 07:00:00`. Des raccourcis existent (`daily`, `weekly`, `hourly`) et un fuseau horaire peut être ajouté en fin d'expression.

## Prérequis

- Un serveur Debian 13 ou Ubuntu Server 24.04 LTS, ici srv-lnx-01.
- Un compte membre du groupe `sudo`.
- Le service cron actif, vérifiable avec `systemctl status cron`. S'il est absent, `sudo apt install cron`.
- Pour anacron, le paquet `anacron`, souvent absent d'une installation serveur : `sudo apt install anacron`.
- Le script à planifier, ici `/usr/local/sbin/sauvegarde-config`, testé manuellement et exécutable.
- Un fuseau horaire correct sur le serveur (`timedatectl`), ici `Europe/Paris`, et une horloge synchronisée.

## Points de Vigilance

**L'environnement de cron est minimal.** cron lance les commandes avec un `PATH` réduit (`/usr/bin:/bin`), sans les variables de la session interactive. Utilisez des chemins absolus ou définissez `PATH` en tête de table.

**Le caractère % est spécial dans une crontab.** Il est converti en retour à la ligne. Une commande `date +%F` doit s'écrire `date +\%F`, ou être déplacée dans un script.

**Les noms de fichiers sont filtrés.** Sur Debian et Ubuntu, les fichiers de `/etc/cron.d` et les scripts des répertoires `cron.daily` et suivants ne sont pris en compte que si leur nom ne comporte que des lettres, chiffres, tirets et soulignés. Un fichier `sauvegarde.sh` ou `sauvegarde.conf` est ignoré sans message.

**La sortie d'une tâche cron part par courrier.** Sans serveur de messagerie local configuré, la sortie est perdue. Redirigez-la vers un fichier ou vers journald (`systemd-cat`), ou préférez un timer.

**Les jours du mois et de la semaine se combinent par un OU.** `0 2 1 * 1` s'exécute le 1er du mois et tous les lundis, pas uniquement les lundis 1er.

**Un timer sans Persistent ne rattrape rien.** Seuls les timers `OnCalendar` avec `Persistent=true` exécutent les échéances manquées. Les timers monotones repartent du démarrage.

**Les changements d'heure affectent cron.** Une tâche placée entre 2 h et 3 h peut être sautée ou doublée lors des passages à l'heure d'été ou d'hiver. Évitez cette plage ou utilisez un fuseau UTC pour les tâches critiques.

## Choix Architecturaux & Alternatives

### Quand choisir cron ou un timer systemd

cron convient aux tâches simples, courtes et non critiques, et aux équipes qui partagent des tables avec d'autres systèmes Unix. Sa syntaxe tient en une ligne et reste lisible.

Les timers systemd sont préférables pour les tâches importantes : sauvegardes, synchronisations, purges. Ils rattrapent les exécutions manquées, n'exécutent jamais deux instances simultanées du même service, journalisent tout dans journald, permettent un délai aléatoire pour étaler la charge d'un parc et héritent des options de confinement de systemd. Debian et Ubuntu utilisent eux-mêmes des timers pour leurs tâches internes (`apt-daily`, `logrotate`, `fstrim`).

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **crontab et /etc/cron.d** | Tâches simples et récurrentes | Syntaxe universelle et compacte | Pas de rattrapage, sortie par courrier, pas de non chevauchement | Gratuit |
| **anacron** | Postes ou serveurs souvent éteints | Rattrape les tâches quotidiennes et plus | Granularité au jour, horaire non maîtrisé | Gratuit |
| **Timer systemd** | Sauvegardes et tâches critiques | Rattrapage, journalisation, délai aléatoire, confinement | Deux fichiers par tâche, syntaxe moins connue | Gratuit |
| **systemd-run --on-calendar** | Tâche ponctuelle ou test | Aucun fichier à créer | Non persistant après redémarrage | Gratuit |
| **Ordonnanceur central (Rundeck, AWX, Jenkins)** | Enchaînements inter-serveurs, parc important | Vue centralisée, dépendances, historique | Infrastructure à exploiter | Moyen |

### Impact des choix

- **Disponibilité.** `Persistent=true` garantit qu'une sauvegarde manquée pendant une maintenance est rattrapée au redémarrage. cron ne l'assure qu'avec anacron et pour les tâches quotidiennes et plus.
- **Exploitation.** Les timers se listent avec leur prochaine et dernière exécution (`systemctl list-timers`), et leur résultat est dans journald. Une tâche cron impose sa propre journalisation.
- **Sécurité.** Une tâche systemd peut tourner sous un compte dédié avec un système de fichiers en lecture seule. Les fichiers `cron.allow` et `cron.deny` limitent qui peut créer des crontabs.
- **Coût.** Aucun coût logiciel. Un ordonnanceur central se justifie au delà de quelques dizaines de serveurs ou de chaînes de tâches dépendantes.

## Configuration

### Préparer le script

```bash
sudo install -m 0750 -o root -g root /dev/stdin /usr/local/sbin/sauvegarde-config <<'EOF'
#!/bin/bash
set -euo pipefail
dest=/srv/backup/config
mkdir -p "$dest"
tar -czf "$dest/etc-$(hostname -s)-$(date +%F).tar.gz" /etc
find "$dest" -name 'etc-*.tar.gz' -mtime +14 -delete
EOF
sudo /usr/local/sbin/sauvegarde-config
```

### Planifier avec une crontab utilisateur

```bash
crontab -e
```

```text
# m  h  dom mon dow  commande
MAILTO=""
*/15 *  *   *   *    /home/alice.martin/bin/verif-espace >> /home/alice.martin/verif-espace.log 2>&1
```

Listez ou supprimez la table :

```bash
crontab -l
crontab -r                       # supprime toute la table, sans confirmation
sudo crontab -l -u alice.martin  # consulter la table d'un autre compte
```

### Planifier avec /etc/cron.d

Créez un fichier sans extension, avec le champ utilisateur :

```bash
sudo nano /etc/cron.d/sauvegarde-config
```

```text
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
# m  h  dom mon dow  utilisateur  commande
30   1  *   *   *    root         /usr/local/sbin/sauvegarde-config 2>&1 | systemd-cat -t sauvegarde-config
```

```bash
sudo chmod 0644 /etc/cron.d/sauvegarde-config
```

<div class="callout callout-note">

cron relit automatiquement `/etc/cron.d` et les crontabs, aucun redémarrage du service n'est nécessaire. La redirection vers `systemd-cat` envoie la sortie dans journald sous l'identifiant `sauvegarde-config`.

</div>

### Utiliser cron.daily et anacron

Pour une tâche quotidienne sans horaire précis, déposez un exécutable sans extension :

```bash
sudo ln -s /usr/local/sbin/sauvegarde-config /etc/cron.daily/sauvegarde-config
sudo run-parts --test /etc/cron.daily
```

`run-parts --test` liste les scripts qui seraient exécutés, ce qui confirme que le nom est accepté.

Si `anacron` est installé, il lance ces répertoires et rattrape les jours manqués. Sa table est `/etc/anacrontab` (période en jours, délai en minutes, identifiant, commande) :

```text
1   5   cron.daily    run-parts --report /etc/cron.daily
7   10  cron.weekly   run-parts --report /etc/cron.weekly
@monthly 15 cron.monthly run-parts --report /etc/cron.monthly
```

Les horodatages des dernières exécutions sont dans `/var/spool/anacron`. Sur Debian et Ubuntu, anacron est déclenché par l'unité `anacron.timer`.

### Créer un timer systemd

Créez d'abord le service, de type `oneshot` :

```bash
sudo nano /etc/systemd/system/sauvegarde-config.service
```

```ini
[Unit]
Description=Sauvegarde de /etc vers /srv/backup/config

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/sauvegarde-config
Nice=10
IOSchedulingClass=idle
```

Puis le timer portant le même nom :

```bash
sudo nano /etc/systemd/system/sauvegarde-config.timer
```

```ini
[Unit]
Description=Sauvegarde quotidienne de /etc

[Timer]
OnCalendar=*-*-* 01:30:00
Persistent=true
RandomizedDelaySec=15min

[Install]
WantedBy=timers.target
```

Activez le timer, pas le service :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sauvegarde-config.timer
```

<div class="callout callout-note">

Si la tâche est aussi planifiée dans `/etc/cron.d`, supprimez l'entrée cron pour éviter une double exécution.

</div>

Exemple de timer monotone, 10 minutes après le démarrage puis toutes les heures après la dernière exécution :

```ini
[Timer]
OnBootSec=10min
OnUnitActiveSec=1h
```

### Valider les expressions avec systemd-analyze calendar

```bash
systemd-analyze calendar '*-*-* 01:30:00'
systemd-analyze calendar --iterations=5 'Mon..Fri *-*-* 07:00'
systemd-analyze calendar 'Sat *-*-1..7 03:00'          # premier samedi du mois
systemd-analyze calendar 'daily'
```

La commande affiche la forme normalisée et la prochaine échéance (`Next elapse`), ou une erreur si l'expression est invalide.

### Lancer une tâche ponctuelle avec systemd-run

```bash
sudo systemd-run --on-calendar='2026-10-17 22:00' --unit=maintenance-ponctuelle /usr/local/sbin/sauvegarde-config
```

Le timer transitoire disparaît après l'exécution ou au redémarrage.

## Vérifications

**Table cron :** `sudo cat /etc/cron.d/sauvegarde-config` affiche la ligne attendue et `journalctl -u cron --since today` montre l'exécution (`CMD (...)`) à 01:30.

**Sortie de la tâche cron :** `journalctl -t sauvegarde-config --since yesterday` affiche la sortie du script.

**Timer actif :** `systemctl list-timers sauvegarde-config.timer` affiche les colonnes `NEXT` et `LAST` renseignées.

**Exécution du service :** `journalctl -u sauvegarde-config.service -n 20` montre le démarrage et la fin du service, sans erreur.

**Test immédiat :** `sudo systemctl start sauvegarde-config.service` produit une nouvelle archive dans `/srv/backup/config`.

**Rattrapage :** après un arrêt du serveur couvrant 01:30, le service s'exécute au démarrage suivant, visible dans `journalctl -u sauvegarde-config.service -b`.

## Dépannage

**La tâche cron fonctionne à la main mais pas depuis cron :** l'environnement diffère. Comparez avec une tâche de diagnostic `* * * * * env > /tmp/env-cron.txt`, utilisez des chemins absolus et définissez `PATH`.

**Un fichier de /etc/cron.d ou de cron.daily est ignoré :** son nom contient un point ou un caractère non autorisé. Renommez-le sans extension et contrôlez avec `run-parts --test`.

**« (CRON) info (No MTA installed, discarding output) » dans les journaux :** la tâche produit une sortie que cron tente d'envoyer par courrier. Redirigez la sortie ou définissez `MAILTO=""`.

**« bad minute » ou « errors in crontab file, can't install » :** l'expression comporte un champ invalide. Vérifiez le nombre de champs et, dans `/etc/cron.d`, la présence du champ utilisateur.

**Le timer n'apparaît pas dans list-timers :** il n'a pas été activé ou `daemon-reload` a été omis. Lancez `sudo systemctl enable --now <nom>.timer`.

**« Failed to parse calendar specification » :** l'expression `OnCalendar` est invalide. Testez-la avec `systemd-analyze calendar` avant de l'écrire dans l'unité.

## Conseils et Bonnes Pratiques

**Préférez les timers pour les tâches critiques.** Sauvegardes, synchronisations et purges bénéficient du rattrapage, de la journalisation et du non chevauchement natifs.

**Étalez la charge.** `RandomizedDelaySec` évite que tout un parc sollicite le même serveur de sauvegarde à la même seconde.

**Mettez la logique dans un script.** La ligne cron ou l'unité ne contient qu'un appel. Le script se teste, se versionne et gère ses propres erreurs avec `set -euo pipefail`.

**Empêchez les chevauchements avec cron.** Si cron reste imposé, encadrez la commande avec `flock -n /run/lock/<tâche>.lock` pour qu'une seconde instance s'arrête immédiatement.

**Restreignez l'accès à cron.** Un fichier `/etc/cron.allow` limite la création de crontabs aux comptes listés.

**Supervisez le résultat, pas seulement l'exécution.** Contrôlez l'âge de la dernière archive ou l'état `Result` du service (`systemctl show -p Result sauvegarde-config.service`) depuis l'outil de supervision.

## Procédures Liées

- [Gestion des Services avec systemd et journald](/procedures/linux/gestion-des-services-avec-systemd-et-journald) *(Unités de service, drop-ins et journalctl)*
- [Automatisation de l'Administration avec des Scripts Bash](/procedures/linux/automatisation-de-ladministration-avec-des-scripts-bash) *(Écriture des scripts planifiés)*
- [Sauvegarde de Serveurs Linux avec rsync et BorgBackup](/procedures/linux/sauvegarde-de-serveurs-linux-avec-rsync-et-borgbackup) *(Planification des sauvegardes)*
- [Synchronisation de l'Heure avec chrony](/procedures/linux/synchronisation-de-lheure-avec-chrony) *(Horloge fiable pour les échéances)*
- [Centralisation des Journaux avec rsyslog](/procedures/linux/centralisation-des-journaux-avec-rsyslog) *(Suivi centralisé des exécutions)*
