---
modele: "procedure"
titre: "Sauvegarde de Serveurs Linux avec rsync et BorgBackup"
type: "PROCEDURE"
class: "03. Serveur"
reference: "LNX-BCK-CFG"
creation: "18/10/2026"
revision: "18/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la sauvegarde de serveurs Linux Debian 13 (trixie) et Ubuntu 24.04 LTS avec deux outils complémentaires : **rsync**, pour la copie et la synchronisation de fichiers, et **BorgBackup**, pour des sauvegardes versionnées, dédupliquées, compressées et chiffrées.

Le périmètre couvre les options essentielles de rsync et son usage prudent de `--delete`, puis le cycle de vie complet d'un dépôt Borg : initialisation chiffrée, création d'archives, rétention (`prune`), libération d'espace (`compact`), contrôle d'intégrité (`check`), restauration (`extract` et `mount`), et automatisation par un timer systemd. L'exemple sauvegarde srv-lnx-01 (192.168.10.21) vers un serveur de sauvegarde srv-lnx-04 (192.168.10.24). La sauvegarde cohérente des bases de données (dump préalable) est évoquée sans être détaillée.

## Contexte et Justification

Un serveur Linux sans sauvegarde externalisée expose l'entreprise à plusieurs risques :

- **Erreur humaine :** une commande `rm` ou une mise à jour mal maîtrisée détruit des données.
- **Panne matérielle :** un RAID protège contre la perte d'un disque, pas contre la corruption ou l'effacement logique.
- **Rançongiciel :** les données et parfois les sauvegardes accessibles en écriture sont chiffrées par l'attaquant.
- **Obligations :** la continuité d'activité et certaines réglementations exigent une restauration démontrée dans un délai défini.

Une simple copie avec rsync ne conserve que le dernier état : une suppression ou un chiffrement est répliqué à la synchronisation suivante. Borg conserve un historique d'archives, déduplique les blocs identiques et chiffre le dépôt côté client, ce qui permet de garder des mois d'historique sur un espace réduit.

## Concepts Clés

**Règle 3-2-1 :** Trois copies des données, sur deux supports différents, dont une hors site. Une variante 3-2-1-1-0 ajoute une copie hors ligne ou immuable et zéro erreur lors des tests de restauration.

**rsync :** Outil de synchronisation qui ne transfère que les différences entre source et destination. Il fonctionne en local ou à travers SSH.

| Option rsync | Effet |
|--------------|-------|
| `-a` | Mode archive : récursif, conserve liens symboliques, permissions, dates, propriétaire, groupe et fichiers spéciaux |
| `-H` | Conserve les liens physiques |
| `-A` | Conserve les ACL |
| `-X` | Conserve les attributs étendus |
| `--numeric-ids` | Conserve les UID et GID numériques sans correspondance de noms |
| `--delete` | Supprime de la destination les fichiers absents de la source |
| `-n`, `--dry-run` | Simule le transfert sans rien modifier |
| `-i`, `--itemize-changes` | Détaille chaque modification |
| `--link-dest=DIR` | Crée des liens physiques vers un instantané précédent pour les fichiers inchangés |

: Options rsync principales

**Dépôt Borg (repository) :** Dossier qui contient toutes les archives, local ou distant via SSH.

**Archive Borg :** Instantané d'un ensemble de fichiers à un instant donné, identifié par un nom unique.

**Déduplication :** Borg découpe les fichiers en blocs (chunks) et ne stocke qu'une fois chaque bloc, quelle que soit l'archive ou le fichier qui le contient.

**Modes de chiffrement :** `repokey-blake2` stocke la clé chiffrée par la phrase secrète dans le dépôt, `keyfile-blake2` la stocke côté client dans `~/.config/borg/keys/`. Dans les deux cas, la clé et la phrase secrète sont indispensables à la restauration.

**prune et compact :** `borg prune` supprime les archives qui sortent de la politique de rétention. Depuis Borg 1.2, l'espace n'est réellement libéré qu'après `borg compact`.

**Versions de Borg :** La branche stable est Borg 1.x. Ubuntu 24.04 LTS fournit Borg 1.2, Debian 13 et Ubuntu 26.04 LTS une version 1.4. Borg 2.0 est toujours en phase de test au 16/10/2026 et n'est pas compatible avec les dépôts 1.x.

## Prérequis

- Un serveur source srv-lnx-01 et un serveur de sauvegarde srv-lnx-04 sous Debian 13 ou Ubuntu 24.04 LTS, avec un compte membre de `sudo`.
- Sur srv-lnx-04, un volume dédié monté sur `/srv/borg`, dimensionné pour la volumétrie et l'historique visé.
- La même branche majeure de Borg (1.x) des deux côtés. Une version 1.4 du client fonctionne avec un serveur 1.2, mais alignez les versions quand c'est possible.
- Un accès SSH par clé de srv-lnx-01 vers srv-lnx-04.
- Un emplacement sûr et hors des serveurs (coffre de mots de passe) pour la phrase secrète et l'export de clé Borg.
- Une copie hors site prévue pour respecter la règle 3-2-1 (second dépôt distant, support amovible ou stockage objet).

## Points de Vigilance

**--delete propage les suppressions et les erreurs.** Une erreur de chemin source (oubli de la barre oblique finale, dossier source vide ou non monté) peut vider la destination. Lancez toujours une simulation avec `--dry-run` avant la première exécution, et ne l'utilisez pas sur une copie censée servir d'historique.

**La barre oblique finale change le sens de la commande.** `rsync -a /srv/data /backup/` crée `/backup/data`, alors que `rsync -a /srv/data/ /backup/` copie le contenu de `data` directement dans `/backup/`.

**Perte de la clé ou de la phrase secrète.** Un dépôt Borg chiffré est irrécupérable sans clé et sans phrase secrète. Exportez la clé avec `borg key export` et conservez-la avec la phrase secrète hors du serveur sauvegardé.

**Borg 2.0 n'est pas encore une version stable.** Borg 2.0 change profondément la ligne de commande (`borg repo-create` au lieu de `borg init`, option `-r` au lieu de la syntaxe `dépôt::archive`, URL distantes au format `ssh://` obligatoire) et utilise un format de dépôt incompatible. N'utilisez pas les versions bêta en production, et prévoyez une migration avec `borg transfer` lorsqu'elle sera publiée.

**prune sans compact ne libère pas d'espace.** Depuis Borg 1.2, oublier `borg compact` laisse le dépôt grossir alors que les archives semblent supprimées.

**Un serveur compromis peut détruire ses sauvegardes.** Si la clé SSH du serveur source permet un accès shell complet au serveur de sauvegarde, un attaquant root peut supprimer le dépôt. Restreignez la clé à `borg serve` et à un seul chemin, et ajoutez une copie hors ligne ou en mode ajout seul.

**Cohérence des bases de données.** Copier les fichiers d'une base MariaDB ou PostgreSQL en cours d'écriture produit une sauvegarde inutilisable. Exportez la base (`mariadb-dump`, `pg_dump`) avant la sauvegarde Borg, ou utilisez un instantané LVM.

## Choix Architecturaux & Alternatives

### Quand choisir rsync et BorgBackup

**rsync** convient pour une copie miroir rapide (migration de serveur, réplication d'un partage vers un second serveur, préparation d'une restauration), ou pour des instantanés simples avec `--link-dest`. Ce n'est pas un outil de sauvegarde versionnée à lui seul.

**BorgBackup** convient pour la sauvegarde quotidienne de serveurs Linux avec un historique long, un chiffrement côté client et un stockage économe. Il est adapté à un serveur de sauvegarde Linux interne ou à un service d'hébergement compatible Borg pour la copie hors site.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **rsync** | Miroir, migration, réplication de fichiers | Universel, transferts différentiels | Pas de versionnement ni de chiffrement natif | Gratuit |
| **BorgBackup 1.x** | Sauvegarde versionnée de serveurs Linux | Déduplication, compression, chiffrement côté client | Dépôt monoclient conseillé, pas de stockage objet natif | Gratuit |
| **restic** | Sauvegarde vers stockage objet (S3, Azure Blob) | Nombreux back-ends, binaire unique | Consommation mémoire sur gros dépôts | Gratuit |
| **Proxmox Backup Server** | Parc de VM Proxmox et hôtes Linux | Interface web, déduplication, vérification planifiée | Écosystème centré sur Proxmox | Gratuit, support payant |
| **Solution commerciale (Veeam Agent for Linux)** | Environnement Veeam existant | Console centralisée, support éditeur | Licences | Moyen à élevé |

### Impact des choix

- **Sécurité.** Borg chiffre avant l'envoi : le serveur de sauvegarde ou l'hébergeur ne voit jamais les données en clair. rsync à travers SSH chiffre le transport mais stocke en clair.
- **Disponibilité.** La règle 3-2-1 impose au moins un second dépôt hors site. Borg recommande des dépôts distincts plutôt qu'une synchronisation du dépôt par rsync, qui propagerait une corruption.
- **Exploitation.** Un timer systemd et un script unique par serveur suffisent. Le contrôle `borg check` et les tests de restauration doivent être planifiés.
- **Coût.** Les outils sont gratuits. Le coût porte sur le stockage, fortement réduit par la déduplication, et sur l'éventuel stockage hors site.

## Configuration

### Installer les outils

Sur srv-lnx-01 et srv-lnx-04 :

```bash
sudo apt update
sudo apt install rsync borgbackup
borg --version
```

### Synchroniser des fichiers avec rsync

Copie d'un dossier vers le serveur de sauvegarde à travers SSH, en conservant les métadonnées :

```bash
sudo rsync -aHAX --numeric-ids -e ssh /srv/partage/ backup@srv-lnx-04.lab.local:/srv/miroir/srv-lnx-01/partage/
```

Avant toute utilisation de `--delete`, simulez la commande et lisez la liste des suppressions :

```bash
sudo rsync -aHAX --numeric-ids --delete --dry-run --itemize-changes \
  -e ssh /srv/partage/ backup@srv-lnx-04.lab.local:/srv/miroir/srv-lnx-01/partage/ | grep '^\*deleting'
```

Si la liste est conforme, relancez la commande sans `--dry-run`.

<div class="callout callout-note">

Pour limiter les dégâts d'une erreur, `--max-delete=NUM` interrompt les suppressions au-delà d'un nombre de fichiers, et `--backup --backup-dir=DIR` déplace les fichiers supprimés ou remplacés au lieu de les effacer.

</div>

### Préparer le serveur de sauvegarde Borg

Sur srv-lnx-04, créez un compte dédié et le dossier du dépôt :

```bash
sudo adduser --system --group --home /srv/borg --shell /bin/bash borg
sudo mkdir -p /srv/borg/srv-lnx-01
sudo chown -R borg:borg /srv/borg
```

Sur srv-lnx-01, générez une clé SSH dédiée pour root :

```bash
sudo ssh-keygen -t ed25519 -f /root/.ssh/id_borg -N "" -C "borg@srv-lnx-01"
sudo cat /root/.ssh/id_borg.pub
```

Sur srv-lnx-04, ajoutez la clé publique dans `/srv/borg/.ssh/authorized_keys`, restreinte à `borg serve` et au seul dépôt du serveur :

```text
command="borg serve --restrict-to-path /srv/borg/srv-lnx-01",restrict ssh-ed25519 AAAA... borg@srv-lnx-01
```

```bash
sudo chown -R borg:borg /srv/borg/.ssh
sudo chmod 700 /srv/borg/.ssh
sudo chmod 600 /srv/borg/.ssh/authorized_keys
```

<div class="callout callout-note">

L'ajout de `--append-only` à la commande `borg serve` empêche le client de supprimer des données du dépôt. Il protège contre un client compromis, mais la rétention (`prune`, `compact`) doit alors être exécutée depuis une machine de confiance.

</div>

### Initialiser le dépôt chiffré

Sur srv-lnx-01, en root :

```bash
sudo -i
export BORG_RSH="ssh -i /root/.ssh/id_borg"
export BORG_REPO="ssh://borg@srv-lnx-04.lab.local/srv/borg/srv-lnx-01"
borg init --encryption=repokey-blake2
```

Saisissez une phrase secrète longue et enregistrez-la dans le coffre de mots de passe. Exportez immédiatement la clé :

```bash
borg key export "$BORG_REPO" /root/borg-key-srv-lnx-01.txt
```

Copiez ce fichier hors du serveur, puis supprimez-le localement.

### Créer une archive

```bash
borg create --stats --compression zstd,6 --exclude-caches \
  --exclude '/home/*/.cache' \
  ::'{hostname}-{now:%Y-%m-%d_%H%M}' \
  /etc /home /srv /var/backups
```

La syntaxe `::nom` utilise le dépôt défini par `BORG_REPO`. Les variables `{hostname}` et `{now}` construisent un nom unique.

### Appliquer la rétention et libérer l'espace

```bash
borg prune --list --glob-archives '{hostname}-*' \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6
borg compact
```

Cette politique conserve 7 archives quotidiennes, 4 hebdomadaires et 6 mensuelles. L'option `--glob-archives` limite la rétention aux archives de ce serveur. Testez une nouvelle politique avec `--dry-run` avant de l'appliquer.

### Contrôler l'intégrité

```bash
borg check
```

Sur un dépôt volumineux, `borg check --repository-only` est plus rapide. `borg check --verify-data` relit et déchiffre toutes les données, ce qui est long mais exhaustif.

### Restaurer des fichiers

```bash
borg list
cd /tmp/restauration
borg extract ::srv-lnx-01-2026-10-15_0200 etc/nginx
```

`borg extract` restaure dans le dossier courant, sans la barre oblique initiale des chemins.

Pour parcourir une archive comme un système de fichiers :

```bash
mkdir -p /mnt/borg
borg mount ::srv-lnx-01-2026-10-15_0200 /mnt/borg
ls /mnt/borg/etc
borg umount /mnt/borg
```

<div class="callout callout-note">

`borg mount` nécessite FUSE. Si la commande signale l'absence de support FUSE, installez le paquet `fuse3` et le module Python FUSE proposé par la distribution pour votre version de Borg.

</div>

### Automatiser avec un script et un timer systemd

Stockez la phrase secrète dans un fichier lisible par root seul :

```bash
sudo install -m 600 /dev/null /root/.borg-passphrase
sudo nano /root/.borg-passphrase
```

Créez le script `/usr/local/sbin/borg-backup.sh` :

```bash
#!/usr/bin/env bash
set -euo pipefail

export BORG_REPO="ssh://borg@srv-lnx-04.lab.local/srv/borg/srv-lnx-01"
export BORG_RSH="ssh -i /root/.ssh/id_borg"
export BORG_PASSCOMMAND="cat /root/.borg-passphrase"

borg create --stats --compression zstd,6 --exclude-caches \
  ::'{hostname}-{now:%Y-%m-%d_%H%M}' \
  /etc /home /srv /var/backups

borg prune --list --glob-archives '{hostname}-*' \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6

borg compact
```

```bash
sudo chmod 700 /usr/local/sbin/borg-backup.sh
```

Créez le service `/etc/systemd/system/borg-backup.service` :

```text
[Unit]
Description=Sauvegarde BorgBackup vers srv-lnx-04
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/borg-backup.sh
Nice=10
IOSchedulingClass=idle
```

Créez le timer `/etc/systemd/system/borg-backup.timer` :

```text
[Unit]
Description=Sauvegarde Borg quotidienne

[Timer]
OnCalendar=*-*-* 02:00:00
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
```

Activez le timer :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now borg-backup.timer
```

`Persistent=true` déclenche la sauvegarde au démarrage si le serveur était éteint à l'heure prévue.

Planifiez en plus un contrôle hebdomadaire `borg check` par un second couple service et timer.

## Vérifications

**Timer :** `systemctl list-timers borg-backup.timer` affiche la prochaine exécution.

**Dernière exécution :** `sudo journalctl -u borg-backup.service -n 50` affiche les statistiques de `borg create` et la fin de `borg compact` sans erreur. `systemctl status borg-backup.service` indique un code de sortie 0.

**Archives présentes :** en root avec les variables du script, `borg list` affiche les archives datées, et `borg info` affiche la taille originale, compressée et dédupliquée.

**Intégrité :** `borg check` se termine sans erreur.

**Test de restauration :** restaurez chaque mois un dossier dans `/tmp`, comparez-le avec l'original par `diff -r`, et consignez le résultat.

**rsync :** relancer la commande rsync avec `--dry-run --itemize-changes` juste après une synchronisation n'affiche aucune différence.

## Dépannage

**« Remote: Permission denied » ou « Repository path not allowed » :** le chemin du dépôt ne correspond pas à `--restrict-to-path` dans `authorized_keys`, ou la clé utilisée n'est pas la bonne. Vérifiez `BORG_RSH` et le chemin exact.

**« Failed to create/acquire the lock » :** une sauvegarde précédente est en cours ou s'est interrompue brutalement. Vérifiez qu'aucun processus `borg` ne tourne sur les deux serveurs, puis exécutez `borg break-lock`.

**« passphrase supplied in BORG_PASSPHRASE, by BORG_PASSCOMMAND or via BORG_PASSPHRASE_FD is incorrect » :** le fichier de phrase secrète contient une erreur ou un caractère en trop. Testez avec `borg list` en saisie interactive.

**« Le dépôt grossit malgré la rétention » :** `borg compact` n'est pas exécuté après `borg prune`, ou le dépôt est en mode ajout seul.

**« Cache, or information obtained from the security directory is newer than repository » :** le dépôt a été restauré ou remplacé par une copie plus ancienne. Ne poursuivez pas sans comprendre la cause : cet avertissement peut signaler une attaque par rejeu.

**« rsync a supprimé des fichiers sur la destination » :** la source était vide ou mal orthographiée lors d'une exécution avec `--delete`. Restaurez depuis l'archive Borg, puis ajoutez `--max-delete` ou une vérification de la source dans le script.

## Conseils et Bonnes Pratiques

**Appliquer la règle 3-2-1.** Les données sur srv-lnx-01, un dépôt Borg sur srv-lnx-04, un second dépôt Borg distinct hors site. Créez deux dépôts indépendants plutôt que de copier le dépôt par rsync.

**Tester les restaurations.** Une sauvegarde jamais restaurée n'est pas une sauvegarde. Planifiez un test mensuel et un exercice de restauration complète par an.

**Restreindre l'accès SSH.** `command="borg serve --restrict-to-path ..."` et l'option `restrict` empêchent l'usage de la clé pour un shell.

**Protéger la clé et la phrase secrète.** Conservez l'export de clé et la phrase secrète dans un coffre de mots de passe, avec une copie papier dans un coffre physique pour la reprise après sinistre.

**Superviser les sauvegardes.** Alertez si `borg-backup.service` échoue ou si aucune archive n'a été créée depuis plus de 26 heures.

**Préparer Borg 2.0 sans précipitation.** Suivez la publication de la version stable, testez-la sur un dépôt de lab, puis migrez les archives avec `borg transfer` et adaptez les scripts (`borg repo-create`, option `-r`, `--match-archives`).

## Procédures Liées

- [Planification des Tâches avec cron et les Timers systemd](/procedures/linux/planification-des-taches-avec-cron-et-les-timers-systemd) *(Automatisation des sauvegardes par timer)*
- [Sécurisation d'OpenSSH (Clés, Durcissement, Fail2ban)](/procedures/linux/securisation-dopenssh-cles-durcissement-fail2ban) *(Clés SSH restreintes vers le serveur de sauvegarde)*
- [Gestion des Disques avec LVM et Montage par fstab](/procedures/linux/gestion-des-disques-avec-lvm-et-montage-par-fstab) *(Volume dédié au dépôt et instantanés LVM)*
- [Automatisation de l'Administration avec des Scripts Bash](/procedures/linux/automatisation-de-ladministration-avec-des-scripts-bash) *(Écriture et durcissement du script de sauvegarde)*
- [Gestion des Services avec systemd et journald](/procedures/linux/gestion-des-services-avec-systemd-et-journald) *(Suivi des exécutions dans le journal)*
