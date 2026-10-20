---
modele: "procedure"
titre: "Déploiement de DFS Namespaces et DFS Replication"
type: "PROCEDURE"
class: "03. Serveur"
reference: "WIN-STO-DEP"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit le déploiement d'un espace de noms DFS de domaine (DFS Namespaces, DFS-N) et d'un groupe de réplication DFS (DFS Replication, DFS-R) entre deux serveurs de fichiers Windows Server 2025 du domaine `lab.local`.

Le périmètre couvre l'installation des rôles, la création de l'espace de noms `\\lab.local\Partages` hébergé par deux serveurs d'espace de noms, la publication d'un dossier avec deux cibles, la création du groupe de réplication, le dimensionnement du dossier intermédiaire (staging), le suivi de la réplication initiale et le contrôle de santé avec `dfsdiag` et `Get-DfsrBacklog`. La réplication de SYSVOL, les espaces de noms autonomes en cluster et la configuration multisite détaillée sortent du périmètre.

## Contexte et Justification

Un serveur de fichiers unique pose trois problèmes en production :

- Les utilisateurs et les GPO de mappage pointent vers un nom de serveur (`\\SRV-FIC-01\Commun`). Remplacer ou renommer ce serveur impose de modifier tous les raccourcis, scripts et stratégies.
- La panne du serveur rend les données indisponibles jusqu'à sa restauration.
- Les sites distants accèdent aux fichiers à travers le WAN, avec une latence pénalisante.

DFS-N répond au premier point en présentant un chemin logique stable, indépendant des serveurs physiques. DFS-R répond aux deux autres en maintenant plusieurs copies synchronisées d'un même dossier, sur lesquelles l'espace de noms redirige les clients.

Le bénéfice opérationnel se mesure sur trois axes :

- **Découplage :** les serveurs peuvent être remplacés ou migrés sans changer le chemin utilisé par les clients.
- **Disponibilité :** si une cible devient injoignable, le client bascule sur une autre cible de la liste de références.
- **Efficacité réseau :** DFS-R ne réplique que les blocs modifiés grâce à la compression différentielle à distance (RDC).

## Concepts Clés

**Espace de noms (namespace).** Arborescence virtuelle de dossiers partagés, accessible par un chemin UNC unique. Un espace de noms de domaine (`\\lab.local\Partages`) stocke sa configuration dans Active Directory, contrairement à un espace de noms autonome (`\\SRV-FIC-01\Partages`) stocké dans le registre d'un seul serveur.

**Mode Windows Server 2008 (DomainV2).** Mode recommandé pour les espaces de noms de domaine. Il prend en charge l'énumération basée sur l'accès (ABE) et un nombre de dossiers bien supérieur au mode Windows 2000 Server.

**Serveur d'espace de noms et racine.** Le serveur d'espace de noms héberge la racine, matérialisée par un partage local (par défaut sous `C:\DFSRoots\<nom>`). Ajouter un second serveur d'espace de noms rend la racine elle-même redondante.

**Dossier et cible de dossier.** Un dossier de l'espace de noms (`\\lab.local\Partages\Commun`) pointe vers une ou plusieurs cibles, c'est-à-dire des partages réels (`\\SRV-FIC-01\Commun`, `\\SRV-FIC-02\Commun`).

**Référence (referral).** Liste ordonnée de cibles que le serveur d'espace de noms renvoie au client. Le tri dépend du site Active Directory du client et du coût des liens de site. Le client met cette liste en cache pendant une durée configurable (TTL).

**Groupe de réplication et dossier répliqué.** Le groupe de réplication rassemble les serveurs membres, leurs connexions (topologie) et la planification. Le dossier répliqué est le contenu synchronisé entre membres.

**Membre principal (primary member).** Membre désigné comme faisant autorité pendant la réplication initiale uniquement. Ses fichiers l'emportent sur les versions différentes présentes chez les autres membres.

**Dossier intermédiaire (staging).** Zone de travail située par défaut sous `<dossier répliqué>\DfsrPrivate\Staging`, où DFS-R prépare les fichiers à envoyer et reconstitue les fichiers reçus. Son quota par défaut est de 4 096 Mo, souvent insuffisant pour la réplication initiale.

**ConflictAndDeleted et PreExisting.** Dossiers cachés sous `DfsrPrivate`. Le premier reçoit les versions perdantes d'un conflit et les fichiers supprimés, le second les fichiers présents chez un membre non principal avant la réplication initiale.

**Backlog.** Nombre de mises à jour en attente entre un membre émetteur et un membre récepteur. Un backlog non nul indique de la latence, pas nécessairement une panne.

## Prérequis

- Un compte membre de **Admins du domaine**, ou disposant des droits délégués de gestion DFS et d'administrateur local sur les serveurs membres.
- Deux serveurs de fichiers Windows Server 2025 joints à `lab.local` dans le même site AD :
  - **SRV-FIC-01** (192.168.10.30), membre principal ;
  - **SRV-FIC-02** (192.168.10.31).
- Un volume de données `D:` formaté en **NTFS** sur chaque serveur. DFS-R ne prend pas en charge ReFS ni FAT.
- Le schéma AD en version 31 ou supérieure, ce qui est le cas de toute forêt dont les contrôleurs SRV-DC-01 et SRV-DC-02 sont sous Windows Server 2025.
- Les données existantes copiées sur SRV-FIC-01 dans `D:\Partages\Commun`, avec leurs ACL NTFS.
- Un antivirus dont l'éditeur confirme la compatibilité avec DFS-R, avec exclusion des dossiers `DfsrPrivate`.
- Les flux autorisés entre les deux serveurs : SMB (TCP 445), RPC Endpoint Mapper (TCP 135) et la plage RPC dynamique (TCP 49152 à 65535), sauf si un port statique DFS-R est configuré.
- La console **Gestion du système de fichiers distribués DFS** (`dfsmgmt.msc`) et les modules PowerShell DFSN et DFSR, installés avec la fonctionnalité `RSAT-DFS-Mgmt-Con`.

## Points de Vigilance

**DFS-R n'est pas un système de fichiers transactionnel.** Il ne gère pas le verrouillage de fichiers entre serveurs. Si deux utilisateurs modifient le même fichier sur deux membres avant la réplication, une version est conservée et l'autre part dans `ConflictAndDeleted`. Pour l'édition collaborative simultanée, privilégiez une cible active unique par dossier (les autres cibles désactivées dans l'espace de noms) ou une solution comme SharePoint.

**Le membre principal fait autorité pendant la réplication initiale.** Les fichiers différents présents sur SRV-FIC-02 sont déplacés dans `PreExisting` ou `ConflictAndDeleted`. Choisissez comme membre principal le serveur qui détient les données les plus à jour, et ne redéclarez jamais manuellement un membre principal après la réplication initiale.

**Le quota de staging par défaut est trop faible.** Microsoft recommande un quota au moins égal à la taille cumulée des **32 plus gros fichiers** du dossier répliqué. Un quota trop petit provoque des purges répétées (événements 4202 et 4208), ralentit fortement la réplication initiale et peut la bloquer.

**DFS-R ne supporte que NTFS.** Un volume ReFS, même issu de Storage Spaces, ne peut pas héberger un dossier répliqué. DFS-R ne réplique pas non plus de contenu situé sur un volume partagé de cluster (CSV).

**Les instantanés de VM corrompent DFS-R.** Restaurer un snapshot ou un point de contrôle d'un serveur DFS-R virtualisé provoque des incohérences de base de données et des pertes de données. Sauvegardez et restaurez depuis l'invité, jamais par snapshot côté hôte, et ne clonez pas une VM membre.

**Le filtre de fichiers par défaut exclut `~*`, `*.bak` et `*.tmp`.** Ces fichiers ne sont pas répliqués. Les fichiers portant l'attribut temporaire sont également ignorés. Vérifiez qu'aucune application métier n'en dépend.

**Les quotas et filtres FSRM doivent être identiques sur tous les membres.** Le dossier `DfsrPrivate` ne doit jamais être soumis à un quota ou à un filtre. Un quota strict peut être dépassé par la réplication et provoquer des tentatives de réplication en boucle.

**Un membre hors ligne plus de 60 jours est bloqué.** Au-delà de la valeur `MaxOfflineTimeInDays` (60 jours par défaut), DFS-R refuse de répliquer le dossier pour éviter la réintroduction de données obsolètes (événement 4012). Le membre doit alors être réinitialisé.

**WMIC n'est plus installé par défaut.** Sous Windows Server 2025, `wmic.exe` est une fonctionnalité à la demande en voie de retrait. Utilisez les cmdlets CIM de PowerShell dans les procédures de dépannage DFS-R qui citent encore WMIC.

## Choix Architecturaux & Alternatives

### Quand choisir DFS-N et DFS-R

DFS-N se justifie dès qu'un environnement Active Directory compte plus d'un serveur de fichiers, ou qu'une migration de serveur est prévisible. Son coût est nul et il simplifie toutes les migrations futures. Il reste utile même sans DFS-R, par exemple pour agréger plusieurs serveurs sous un chemin unique ou pour masquer une migration vers Azure Files.

DFS-R convient à la distribution de données vers des sites distants, à la consolidation de données de succursales vers un site central pour sauvegarde, et à la haute disponibilité de données peu modifiées en simultané (logiciels, modèles, documentation). Il ne convient pas aux bases de données, aux fichiers PST ouverts en permanence, ni aux dossiers édités simultanément depuis plusieurs sites.

Ne choisissez pas DFS-R comme unique mécanisme de haute disponibilité d'un serveur de fichiers critique à forte activité d'écriture. Un cluster de serveurs de fichiers ou Storage Replica offre une cohérence plus forte.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **DFS-N et DFS-R** | Multi-serveurs, succursales, chemin unique | Natif, réplication multimaître économe en bande passante | Pas de verrouillage de fichiers, NTFS uniquement | Gratuit, inclus dans Windows Server |
| **Azure File Sync** | Hybride, réduction du stockage local, sauvegarde cloud | Hiérarchisation cloud, copie complète dans Azure Files | Dépendance à Azure, coût de stockage et de transactions | Moyen |
| **Cluster de serveurs de fichiers (SOFS ou général)** | Haute disponibilité d'un partage unique | Basculement transparent, données cohérentes | Stockage partagé requis, complexité | Élevé |
| **Storage Replica** | Reprise après sinistre bloc à bloc | Réplication synchrone ou asynchrone de volume | Cible non accessible en écriture, Datacenter pour l'usage complet | Moyen à élevé |
| **Robocopy planifié** | Copie unidirectionnelle simple | Aucun rôle à installer | Pas de réplication continue, pas de gestion de conflits | Gratuit |

### Migration vers Azure File Sync

Microsoft recommande de remplacer DFS-R par Azure File Sync dans la plupart des cas, les deux produits étant des solutions de réplication. DFS-N reste compatible et peut continuer à publier les serveurs Azure File Sync. La piste de migration documentée est la suivante :

1. Créer un groupe de synchronisation représentant la topologie DFS-R à remplacer.
2. Installer l'agent Azure File Sync sur le serveur qui détient le jeu de données complet (ici SRV-FIC-01), l'enregistrer et créer un point de terminaison serveur **sans hiérarchisation cloud**.
3. Laisser la totalité des données se synchroniser vers le partage Azure (point de terminaison cloud).
4. Installer et enregistrer l'agent sur les autres membres DFS-R.
5. Désactiver DFS-R.
6. Créer un point de terminaison serveur sur chaque ancien membre, toujours sans hiérarchisation cloud.
7. Vérifier la fin de la synchronisation et tester la topologie.
8. Retirer DFS-R, puis activer la hiérarchisation cloud si besoin.

<div class="callout callout-note">

Pendant une coexistence, la hiérarchisation cloud doit rester désactivée sur les volumes qui hébergent des dossiers répliqués par DFS-R, et aucun point de terminaison serveur ne doit être créé sur un dossier DFS-R en lecture seule.

</div>

### Impact des choix

- **Disponibilité.** Deux serveurs d'espace de noms rendent la racine redondante. Deux cibles par dossier, synchronisées par DFS-R, permettent la bascule des clients. Le délai de bascule dépend du TTL des références et du délai de détection côté client.
- **Cohérence des données.** DFS-R est multimaître et asynchrone. Une perte de serveur peut faire perdre les modifications non encore répliquées (backlog). Surveillez le backlog et dimensionnez la planification en conséquence.
- **Sécurité.** Les ACL NTFS sont répliquées avec les fichiers. Les autorisations de partage ne le sont pas et doivent être identiques sur chaque cible. L'ABE de l'espace de noms masque les dossiers auxquels l'utilisateur n'a pas accès.
- **Exploitation.** La surveillance repose sur le journal **DFS Replication**, `Get-DfsrBacklog` et les rapports d'intégrité. Sans supervision, une réplication arrêtée peut passer inaperçue pendant des semaines.
- **Coût.** DFS-N et DFS-R sont inclus dans Windows Server. Le coût réel est le doublement du stockage et la charge de surveillance. Azure File Sync ajoute un coût récurrent mais réduit le stockage local et la charge de sauvegarde.

## Méthode 1 : Configuration via la Console Gestion du système de fichiers distribués DFS (dfsmgmt.msc)

### Installation des Rôles

1. Sur SRV-FIC-01 et SRV-FIC-02, ouvrez le **Gestionnaire de serveur** > **Gérer** > **Ajouter des rôles et fonctionnalités**.
2. Dans **Rôles de serveurs**, développez **Services de fichiers et de stockage** > **Services de fichiers et iSCSI**, puis cochez **Espaces de noms DFS** et **Réplication DFS**.
3. Acceptez l'ajout des **Outils de gestion DFS**, puis terminez l'assistant.

### Préparation des Partages

1. Sur SRV-FIC-01, vérifiez la présence des données dans `D:\Partages\Commun`.
2. Sur SRV-FIC-02, créez le dossier vide `D:\Partages\Commun`.
3. Sur les deux serveurs, partagez `D:\Partages\Commun` sous le nom `Commun`, avec les mêmes autorisations de partage (par exemple **Utilisateurs authentifiés** en **Modifier**). Le contrôle fin reste porté par les ACL NTFS.

<div class="callout callout-note">

Ne pré-remplissez SRV-FIC-02 que par une copie fidèle (Robocopy avec `/COPYALL`) ou par clonage de base DFS-R. Une copie qui altère les ACL ou les horodatages fait répliquer à nouveau tous les fichiers.

</div>

### Création de l'Espace de Noms

1. Ouvrez `dfsmgmt.msc`, faites un clic droit sur **Espaces de noms** > **Nouvel espace de noms**.
2. **Serveur d'espace de noms :** `SRV-FIC-01`.
3. **Nom de l'espace de noms :** `Partages`. Cliquez sur **Modifier les paramètres** pour vérifier le chemin local (`C:\DFSRoots\Partages`) et les autorisations du partage racine. Les autorisations par défaut (lecture seule pour tous) suffisent, la racine ne contenant que des liens.
4. **Type d'espace de noms :** **Espace de noms de domaine**, avec la case **Activer le mode Windows Server 2008** cochée. Le chemin affiché est `\\lab.local\Partages`.
5. Cliquez sur **Créer**, puis **Fermer**.
6. Faites un clic droit sur `\\lab.local\Partages` > **Ajouter un serveur d'espace de noms**, et saisissez `SRV-FIC-02`.
7. Dans les **Propriétés** de l'espace de noms, onglet **Avancé**, cochez **Activer l'énumération basée sur l'accès pour cet espace de noms**.

### Création du Dossier et de ses Cibles

1. Faites un clic droit sur `\\lab.local\Partages` > **Nouveau dossier**.
2. **Nom :** `Commun`.
3. Cliquez sur **Ajouter** et saisissez `\\SRV-FIC-01\Commun`, puis de nouveau **Ajouter** avec `\\SRV-FIC-02\Commun`.
4. Validez avec **OK**. La console propose de créer un groupe de réplication pour ce dossier : répondez **Oui**. L'assistant **Répliquer le dossier** s'ouvre.

### Création du Groupe de Réplication

1. **Nom du groupe de réplication et du dossier répliqué :** acceptez les noms proposés (`lab.local\partages\commun` et `Commun`) ou adaptez-les à la convention maison.
2. **Éligibilité de la réplication :** vérifiez que les deux cibles sont éligibles.
3. **Membre principal :** sélectionnez `SRV-FIC-01`.
4. **Topologie :** **Maille pleine** (adaptée à deux ou trois membres). Au-delà de dix membres, préférez une topologie hub and spoke.
5. **Planification et bande passante :** **Répliquer continuellement en utilisant la bande passante spécifiée**, bande passante **Totale** sur le LAN.
6. Cliquez sur **Créer**, puis **Fermer**. Un message rappelle que la réplication démarre après la propagation de la configuration dans AD et l'interrogation d'AD par chaque membre.

### Dimensionnement du Dossier Intermédiaire

1. Calculez sur SRV-FIC-01 la taille des 32 plus gros fichiers (voir la commande dans la Méthode 2).
2. Dans `dfsmgmt.msc`, ouvrez **Réplication** > le groupe créé > onglet **Appartenances**.
3. Pour chaque membre, faites un clic droit > **Propriétés** > onglet **Intermédiaire**, et saisissez le quota calculé arrondi au gigaoctet supérieur. Pour la réplication initiale, une valeur plus élevée est recommandée si l'espace disque le permet.
4. Dans l'onglet **Fichiers en conflit et supprimés**, ajustez le quota selon la volumétrie de modifications attendue.

### Suivi de la Réplication Initiale

1. Ouvrez l'**Observateur d'événements** sur SRV-FIC-02 > **Journaux des applications et des services** > **DFS Replication**.
2. Attendez l'événement **4102** (début de la réplication initiale), puis l'événement **4104** (réplication initiale terminée) sur le membre non principal.
3. Sur SRV-FIC-01, l'événement **4112** confirme qu'il est le membre principal désigné.
4. Tant que l'événement 4104 n'est pas journalisé, laissez la cible `\\SRV-FIC-02\Commun` **désactivée** dans l'espace de noms (clic droit sur la cible > **Désactiver la cible de dossier**), pour éviter que des clients lisent un contenu incomplet.

## Méthode 2 : Configuration via PowerShell

### Installation des Rôles

```powershell
# Sur SRV-FIC-01 et SRV-FIC-02
Install-WindowsFeature -Name FS-DFS-Namespace, FS-DFS-Replication, RSAT-DFS-Mgmt-Con -IncludeManagementTools
```

### Préparation des Partages

```powershell
# Sur chaque serveur membre
New-Item -Path "D:\Partages\Commun" -ItemType Directory -Force
New-SmbShare -Name "Commun" -Path "D:\Partages\Commun" -ChangeAccess "LAB\Utilisateurs du domaine" -FullAccess "LAB\Admins du domaine"

# Partage de la racine d'espace de noms
New-Item -Path "C:\DFSRoots\Partages" -ItemType Directory -Force
New-SmbShare -Name "Partages" -Path "C:\DFSRoots\Partages" -ReadAccess "Tout le monde"
```

<div class="callout callout-note">

Les noms de groupes et de principaux de sécurité dépendent de la langue d'installation. Sur un système en anglais, remplacez par `LAB\Domain Users`, `LAB\Domain Admins` et `Everyone`.

</div>

### Création de l'Espace de Noms et du Dossier

```powershell
# Racine de domaine en mode Windows Server 2008, hébergée par les deux serveurs
New-DfsnRoot -Path "\\lab.local\Partages" -TargetPath "\\SRV-FIC-01\Partages" -Type DomainV2
New-DfsnRootTarget -Path "\\lab.local\Partages" -TargetPath "\\SRV-FIC-02\Partages"

# Dossier avec ses deux cibles
New-DfsnFolder -Path "\\lab.local\Partages\Commun" -TargetPath "\\SRV-FIC-01\Commun"
New-DfsnFolderTarget -Path "\\lab.local\Partages\Commun" -TargetPath "\\SRV-FIC-02\Commun" -State Offline
```

<div class="callout callout-note">

La seconde cible est créée à l'état `Offline` pour qu'aucun client n'y soit dirigé avant la fin de la réplication initiale. Elle sera activée à l'étape « Activation de la Seconde Cible ».

</div>

### Calcul du Quota de Staging

```powershell
# Sur SRV-FIC-01 : taille des 32 plus gros fichiers, en Go
$big32 = Get-ChildItem -Path "D:\Partages\Commun" -Recurse -File |
    Sort-Object Length -Descending |
    Select-Object -First 32 |
    Measure-Object -Property Length -Sum
[math]::Ceiling($big32.Sum / 1GB)
```

### Création du Groupe de Réplication

```powershell
$rg = "RG-Partages-Commun"
$rf = "Commun"

New-DfsReplicationGroup -GroupName $rg -DomainName "lab.local" |
    New-DfsReplicatedFolder -FolderName $rf -DfsnPath "\\lab.local\Partages\Commun" |
    Add-DfsrMember -ComputerName "SRV-FIC-01","SRV-FIC-02"

# Connexion bidirectionnelle (maille pleine à deux membres)
Add-DfsrConnection -GroupName $rg -SourceComputerName "SRV-FIC-01" -DestinationComputerName "SRV-FIC-02"

# Membre principal, chemin de contenu et quota de staging (ici 16 Go)
Set-DfsrMembership -GroupName $rg -FolderName $rf -ComputerName "SRV-FIC-01" `
    -ContentPath "D:\Partages\Commun" -PrimaryMember $true -StagingPathQuotaInMB 16384 -Force

Set-DfsrMembership -GroupName $rg -FolderName $rf -ComputerName "SRV-FIC-02" `
    -ContentPath "D:\Partages\Commun" -StagingPathQuotaInMB 16384 -Force

# Forcer la lecture de la configuration AD sur les membres
Update-DfsrConfigurationFromAD -ComputerName "SRV-FIC-01","SRV-FIC-02"
```

<div class="callout callout-note">

`Add-DfsrConnection` crée par défaut les deux connexions (aller et retour). Le paramètre `-DfsnPath` de `New-DfsReplicatedFolder` associe le dossier répliqué au dossier de l'espace de noms dans la console. Il est facultatif.

</div>

### Suivi de la Réplication Initiale

```powershell
# Sur SRV-FIC-02 : événements de début (4102) et de fin (4104) de réplication initiale
Get-WinEvent -FilterHashtable @{ LogName = "DFS Replication"; Id = 4102, 4104 } -MaxEvents 10 |
    Format-Table TimeCreated, Id, Message -Wrap

# Nombre de fichiers en attente de SRV-FIC-01 vers SRV-FIC-02
Get-DfsrBacklog -GroupName "RG-Partages-Commun" -FolderName "Commun" `
    -SourceComputerName "SRV-FIC-01" -DestinationComputerName "SRV-FIC-02" -Verbose
```

### Activation de la Seconde Cible

```powershell
# Après l'événement 4104 sur SRV-FIC-02
Set-DfsnFolderTarget -Path "\\lab.local\Partages\Commun" -TargetPath "\\SRV-FIC-02\Commun" -State Online
```

## Vérifications

**Espace de noms :** `Get-DfsnRoot -Path "\\lab.local\Partages"` renvoie l'état **Online** et le type **Domain V2**. `Get-DfsnRootTarget -Path "\\lab.local\Partages"` liste SRV-FIC-01 et SRV-FIC-02.

**Cibles de dossier :** `Get-DfsnFolderTarget -Path "\\lab.local\Partages\Commun"` affiche les deux cibles à l'état **Online**.

**Diagnostic de l'espace de noms :**

```cmd
dfsdiag /testdcs /domain:lab.local
dfsdiag /testdfsconfig /DFSRoot:\\lab.local\Partages
dfsdiag /testdfsintegrity /DFSRoot:\\lab.local\Partages /recurse /full
dfsdiag /testreferral /DFSpath:\\lab.local\Partages\Commun
```

Aucune erreur ne doit être signalée. Les avertissements de cohérence d'ACL entre cibles doivent être corrigés.

**Accès client :** depuis un poste du domaine, ouvrez `\\lab.local\Partages\Commun`. Dans les **Propriétés** d'un fichier, l'onglet **DFS** indique la cible active. La commande `dfsutil cache referral` affiche le contenu du cache de références du client.

**Réplication :** la commande `Get-DfsrBacklog ... -Verbose` dans les deux sens renvoie un compte nul ou faible et décroissant. `Get-DfsrState -ComputerName "SRV-FIC-02"` montre les fichiers en cours de traitement.

**Test de propagation :**

```powershell
Start-DfsrPropagationTest -GroupName "RG-Partages-Commun" -FolderName "Commun" -ReferenceComputerName "SRV-FIC-01"
# Quelques minutes plus tard
Write-DfsrPropagationReport -GroupName "RG-Partages-Commun" -FolderName "Commun" -ReferenceComputerName "SRV-FIC-01" -Path "C:\Rapports"
Write-DfsrHealthReport -GroupName "RG-Partages-Commun" -ReferenceComputerName "SRV-FIC-01" -MemberComputerName "SRV-FIC-02" -Path "C:\Rapports" -CountFiles
```

Les rapports HTML générés dans `C:\Rapports` ne doivent signaler aucune erreur.

## Dépannage

**« La réplication initiale ne démarre pas, aucun événement 4102 » :** la configuration n'est pas encore connue des membres. Vérifiez la réplication AD entre SRV-DC-01 et SRV-DC-02 (`repadmin /replsummary`), puis exécutez `Update-DfsrConfigurationFromAD` sur chaque membre. Contrôlez aussi que le service **Réplication DFS** (`DFSR`) est démarré.

**« La réplication est très lente, événements 4202 et 4208 en série » :** le quota de staging est trop faible. Les événements 4202 et 4204 isolés sont normaux. Des 4208 répétés imposent d'augmenter `StagingPathQuotaInMB` au moins à la taille des 32 plus gros fichiers. La modification ne nécessite pas de redémarrage, mais attend la réplication AD et l'interrogation d'AD par DFS-R.

**« Des fichiers ont disparu de SRV-FIC-02 après la réplication initiale » :** ils ont été déplacés dans `D:\Partages\Commun\DfsrPrivate\PreExisting` ou `ConflictAndDeleted`, parce que SRV-FIC-01 faisait autorité. Récupérez-les depuis ces dossiers avec une copie qui conserve les ACL.

**« Événement 4012, le dossier répliqué n'est plus répliqué » :** le membre a été déconnecté plus longtemps que `MaxOfflineTimeInDays`. Si ses données sont obsolètes, désactivez puis réactivez son appartenance pour forcer une réinitialisation non principale. Ne relevez pas la valeur sans comprendre que des fichiers supprimés ailleurs pourraient réapparaître.

**« Événement 2213, réplication arrêtée après un arrêt brutal » :** depuis Windows Server 2012, la reprise automatique après arrêt non propre est désactivée par défaut. Le message de l'événement contient le GUID du volume et la commande de reprise. Sous Windows Server 2025, utilisez l'équivalent CIM plutôt que WMIC :

```powershell
Get-CimInstance -Namespace "root\microsoftdfs" -ClassName "DfsrVolumeConfig" -Filter "VolumeGuid='<GUID>'" |
    Invoke-CimMethod -MethodName ResumeReplication
```

**« Les clients sont toujours dirigés vers une cible arrêtée » :** le cache de références du client n'a pas expiré. Videz-le avec `dfsutil cache referral flush` sur le poste, et vérifiez que la cible est bien marquée **Offline** dans l'espace de noms pendant la maintenance.

**« dfsdiag /testsites signale une incohérence de site » :** un serveur est associé à des sites différents selon les contrôleurs de domaine, ou le sous-réseau 192.168.10.0/24 n'est pas déclaré dans **Sites et services Active Directory**. Corrigez la déclaration du sous-réseau puis relancez le test.

## Conseils et Bonnes Pratiques

**Utilisez systématiquement le chemin d'espace de noms.** Les GPO de mappage, scripts et raccourcis doivent pointer vers `\\lab.local\Partages\...`, jamais vers un nom de serveur. C'est la condition pour que les migrations futures restent transparentes.

**Une cible active par dossier pour les données collaboratives.** Pour les dossiers modifiés par plusieurs utilisateurs, conservez une seule cible active et gardez la seconde désactivée comme secours chaud. La bascule manuelle évite les conflits de modification simultanée.

**Prédimensionnez le staging pour la réplication initiale.** Pendant la réplication initiale, un quota de staging large accélère nettement le traitement. Il peut être réduit ensuite, sans descendre sous le seuil des 32 plus gros fichiers.

**Pré-remplissez les gros volumes.** Pour plusieurs centaines de gigaoctets, copiez les données au préalable avec `robocopy /E /B /COPYALL /R:6 /W:5 /MT:64 /XD DfsrPrivate`, ou utilisez le clonage de base (`Export-DfsrClone` et `Import-DfsrClone`). La réplication initiale se limite alors à la comparaison des hachages.

**Surveillez le backlog et le journal DFS Replication.** Planifiez un script qui exécute `Get-DfsrBacklog -Verbose` dans les deux sens et alerte au-delà d'un seuil, et transférez le journal **DFS Replication** vers un collecteur d'événements ou un SIEM.

**Fixez un port RPC statique entre sites filtrés.** Si un pare-feu sépare les membres, configurez un port statique pour DFS-R avec `Set-DfsrServiceConfiguration -RPCPort <port>` et ouvrez uniquement ce port et le TCP 135.

**Excluez `DfsrPrivate` des quotas, filtres et analyses antivirus.** Appliquez les quotas FSRM sur les sous-dossiers métier, et alignez à l'identique les modèles FSRM sur tous les membres.

**Documentez le membre principal et la date de réplication initiale.** Cette information est indispensable en cas de reconstruction de base DFS-R ou d'audit d'un incident de perte de données.

## Procédures Liées

- [Mise en Place d'un Serveur de Fichiers avec Partages et Sécurité NTFS](/procedures/windows/mise-en-place-dun-serveur-de-fichiers-avec-partages-et-securite-ntfs) *(Partages et ACL publiés comme cibles DFS)*
- [Configuration de FSRM (Quotas et Filtrage de Fichiers)](/procedures/windows/configuration-de-fsrm-quotas-et-filtrage-de-fichiers) *(Quotas et filtres à aligner sur tous les membres)*
- [Mappage de Lecteurs Réseau avec les Stratégies de Groupe (GPO)](/procedures/windows/mappage-de-lecteurs-reseau-avec-les-strategies-de-groupe-gpo) *(Mappage vers le chemin d'espace de noms)*
- [Configuration des Sites et de la Réplication AD](/procedures/windows/configuration-des-sites-et-de-la-replication-ad) *(Tri des références par site et propagation de la configuration)*
- [Déploiement d'un Azure File Sync](/procedures/azure/deploiement-dun-azure-file-sync) *(Cible de migration de DFS-R)*
- [Configuration des Storage Spaces et de la Déduplication](/procedures/windows/configuration-des-storage-spaces-et-de-la-deduplication) *(Volume NTFS de données des membres)*
