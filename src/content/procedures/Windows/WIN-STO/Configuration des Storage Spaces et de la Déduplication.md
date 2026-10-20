---
modele: "procedure"
titre: "Configuration des Storage Spaces et de la Déduplication"
type: "PROCEDURE"
class: "03. Serveur"
reference: "WIN-STO-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la mise en œuvre des espaces de stockage (Storage Spaces) sur un serveur autonome et l'activation de la déduplication des données sur le serveur de fichiers SRV-FIC-01 du domaine `lab.local`, sous Windows Server 2025.

Le périmètre couvre la création d'un pool de stockage, de disques virtuels selon les dispositions simple, miroir et parité, le choix entre provisionnement fixe et dynamique, le formatage en NTFS ou ReFS, puis l'activation, l'exécution et le suivi de la déduplication. Storage Spaces Direct (S2D), qui repose sur un cluster de basculement, est présenté en mention et sort du périmètre de configuration.

## Contexte et Justification

Un serveur de fichiers équipé de plusieurs disques sans contrôleur RAID matériel, ou installé en machine virtuelle avec plusieurs disques de données, doit offrir de la résilience et de la capacité sans investissement matériel supplémentaire. Les limites des approches classiques sont connues :

- Les volumes dynamiques et le RAID logiciel de la console **Gestion des disques** sont anciens, peu souples et non extensibles à chaud.
- Un contrôleur RAID matériel ajoute un coût, un point de défaillance et une dépendance au fournisseur.
- Les données de fichiers bureautiques contiennent beaucoup de redondance (versions successives, copies de documents, images d'installation), ce qui gaspille de l'espace et alourdit les sauvegardes.

Storage Spaces agrège des disques physiques en pool et y découpe des disques virtuels résilients, extensibles et provisionnables à la demande. La déduplication réduit ensuite l'espace consommé par les données redondantes.

Le bénéfice opérationnel se mesure sur trois axes :

- **Résilience logicielle :** protection contre la perte d'un ou deux disques sans contrôleur RAID.
- **Souplesse :** ajout de disques au pool et extension des disques virtuels sans reconstruction.
- **Économie d'espace :** gains de déduplication couramment de l'ordre de 30 à 50 % sur des partages bureautiques, selon les données.

## Concepts Clés

**Pool de stockage.** Ensemble de disques physiques regroupés. Les disques éligibles apparaissent d'abord dans le pool **primordial** (`CanPool = True`). Un pool peut contenir des disques de réserve à chaud (hot spare).

**Disque virtuel (espace de stockage).** Unité logique créée dans un pool, présentée à Windows comme un disque ordinaire sur lequel on crée des volumes.

**Disposition (résilience).** Elle détermine la répartition des données :

| Disposition | Principe | Disques minimum | Tolérance | Usage recommandé |
|-------------|----------|-----------------|-----------|------------------|
| Simple | Entrelacement sans redondance | 1 | Aucune | Données temporaires ou reconstructibles |
| Miroir double | Deux copies des données | 2 | 1 disque | Partages de fichiers, usage général |
| Miroir triple | Trois copies des données | 5 | 2 disques | Données critiques |
| Parité | Données et parité entrelacées | 3 | 1 disque | Archives, sauvegardes, écritures séquentielles |

: Dispositions Storage Spaces sur serveur autonome

**Colonnes et entrelacement.** Le nombre de colonnes (`NumberOfColumns`) indique sur combien de disques les données sont réparties en parallèle. Il conditionne les performances et la manière d'étendre le disque virtuel, qui exige des disques libres en nombre suffisant pour respecter la disposition.

**Provisionnement fixe.** L'espace est réservé dans le pool dès la création. Pas de risque de surallocation, mais pas d'optimisation de l'espace.

**Provisionnement dynamique (thin).** L'espace est consommé au fur et à mesure de l'écriture. La somme des tailles des disques virtuels peut dépasser la capacité du pool, ce qui impose une surveillance de l'espace libre.

**NTFS et ReFS.** NTFS reste le système de fichiers universel, requis par FSRM, DFS Replication, les quotas de disque NTFS et le volume de démarrage. ReFS apporte les flux d'intégrité, la réparation automatique sur un espace résilient et le clonage de blocs, mais ne prend en charge ni FSRM ni DFS Replication.

**Déduplication des données.** Fonction de post-traitement : les fichiers sont écrits normalement, puis une tâche d'optimisation les découpe en blocs de taille variable, stocke les blocs uniques dans le magasin de blocs (chunk store, sous `System Volume Information`) et remplace le contenu des fichiers par des points d'analyse. La lecture est transparente pour les utilisateurs.

**Types d'utilisation.** Préréglages de la déduplication :

| Type | Charge visée | Âge minimal des fichiers | Fichiers ouverts optimisés |
|------|--------------|--------------------------|----------------------------|
| Default | Serveur de fichiers généraliste | 3 jours | Non |
| HyperV | Infrastructure VDI | 3 jours | Oui |
| Backup | Applications de sauvegarde virtualisées (type DPM) | 0 jour | Oui |

: Types d'utilisation de la déduplication

**Tâches de déduplication.** **Optimization** (toutes les heures par défaut), **GarbageCollection** (récupération de l'espace des blocs non référencés, le samedi à 02:35), **Scrubbing** (contrôle d'intégrité du magasin, le samedi à 03:35) et **Unoptimization** (manuelle, pour annuler la déduplication).

## Prérequis

- Un compte membre du groupe **Administrateurs** local de SRV-FIC-01 (192.168.10.30).
- SRV-FIC-01 sous Windows Server 2025, joint à `lab.local`.
- Quatre disques de données vierges d'au moins 4 Go, non initialisés et sans volume, par exemple quatre disques VHDX de 200 Go attachés à la VM. Un cinquième disque est optionnel pour la réserve à chaud.
- Des contrôleurs de type HBA simples. Sur un serveur physique, tout mode RAID doit être désactivé sur le contrôleur, qui ne doit ni masquer les disques ni mettre en cache les écritures.
- Une mémoire suffisante pour la déduplication : au minimum 300 Mo plus 50 Mo par To de données logiques, idéalement 1 Go par To.
- Le module PowerShell **Storage** (natif) et, pour la déduplication, la fonctionnalité **Déduplication des données** (`FS-Data-Deduplication`).

## Points de Vigilance

**Un espace de stockage ne peut pas héberger le système d'exploitation.** Le volume `C:` reste sur un disque classique ou sur un RAID matériel.

**La disposition simple n'offre aucune protection.** La perte d'un seul disque du pool entraîne la perte de toutes les données du disque virtuel simple. Ne l'utilisez jamais pour des données non reconstructibles.

**La parité est lente en écriture sur un serveur autonome.** Chaque écriture impose un calcul et une écriture de parité. Réservez-la aux archives et aux sauvegardes, pas aux partages actifs ni aux machines virtuelles.

**Le provisionnement dynamique peut saturer le pool.** Lorsque le pool n'a plus d'espace physique, les disques virtuels dynamiques passent hors ligne en écriture. Surveillez `AllocatedSize` et `Size` du pool et définissez un seuil d'alerte.

**Le choix du système de fichiers engage la suite.** Un volume ReFS ne pourra recevoir ni quotas ni filtres FSRM, ni dossier répliqué DFS-R. Pour un partage de fichiers gouverné et répliqué, formatez en NTFS.

**La déduplication n'est pas prise en charge sur le volume système ou de démarrage.** Elle ne traite pas non plus les fichiers de moins de 32 Ko, les fichiers chiffrés par EFS, ni les fichiers portant des attributs étendus.

**La déduplication change la sauvegarde.** Une sauvegarde au niveau fichier réhydrate les données et perd le gain. Utilisez une solution de sauvegarde compatible avec la déduplication (sauvegarde optimisée au niveau bloc), et testez la restauration.

**L'annulation de la déduplication exige de l'espace.** La tâche **Unoptimization** réécrit tous les fichiers sous leur forme complète. Vérifiez que l'espace libre couvre la taille logique des données avant de l'exécuter.

**Storage Spaces partagé sur SAS est en fin de développement.** Microsoft n'investit plus dans les espaces de stockage en cluster sur boîtier SAS partagé, au profit de Storage Spaces Direct. La configuration autonome décrite ici n'est pas concernée.

## Choix Architecturaux & Alternatives

### Quand choisir Storage Spaces et la déduplication

Storage Spaces autonome est adapté à un serveur de fichiers ou de sauvegarde unique, physique sans contrôleur RAID ou virtuel avec plusieurs disques, qui a besoin de résilience logicielle et d'une capacité extensible. Le miroir double convient à la grande majorité des partages, la parité aux archives.

La déduplication est recommandée sans réserve pour les serveurs de fichiers généralistes (partages d'équipe, dossiers personnels, redirection de dossiers), la VDI et les dépôts de sauvegarde virtualisés. Pour les hôtes Hyper-V généralistes, SQL Server et les applications métier, elle doit être évaluée au préalable avec `DDPEval.exe`.

Ne choisissez pas Storage Spaces autonome pour une haute disponibilité à l'échelle du serveur : le pool reste attaché à une seule machine. Dans ce cas, Storage Spaces Direct ou un stockage partagé en cluster est nécessaire.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Storage Spaces autonome** | Serveur de fichiers ou de sauvegarde unique | Résilience logicielle, extension souple, gratuit | Pas de haute disponibilité inter-serveurs, parité lente | Gratuit |
| **Storage Spaces Direct (S2D)** | Cluster hyperconvergé ou Scale-Out File Server | Haute disponibilité, cache, performances élevées | Édition Datacenter, matériel certifié, cluster de 2 à 16 nœuds | Élevé |
| **RAID matériel** | Serveur physique avec contrôleur dédié | Performances, cache protégé par batterie | Dépendance au contrôleur, pas d'extension souple | Moyen |
| **Volume RAID de la Gestion des disques** | Besoin hérité ou très simple | Aucun prérequis | Technologie ancienne, peu extensible | Gratuit |
| **Azure Files avec Azure File Sync** | Réduction du stockage local | Capacité cloud, hiérarchisation | Coût récurrent, dépendance au réseau | Moyen |

**Storage Spaces Direct.** S2D agrège les disques locaux de plusieurs nœuds d'un cluster de basculement en un pool partagé, avec cache et résilience entre serveurs. Il exige Windows Server Datacenter, un réseau à faible latence (idéalement RDMA) et du matériel validé. Il fait l'objet d'une procédure de cluster distincte.

**Déduplication ReFS de Windows Server 2025.** Windows Server 2025 introduit un moteur de déduplication et de compression propre à ReFS, piloté par le module `Microsoft.ReFsDedup.Commands` (`Enable-ReFSDedup -Volume <volume> -Type DedupAndCompress`). Il est distinct de la déduplication classique décrite ici et cible surtout les volumes ReFS de machines virtuelles. Évaluez-le séparément avant tout usage en production.

### Impact des choix

- **Disponibilité.** Le miroir double tolère un disque perdu, le miroir triple deux. Un disque de réserve à chaud ou une capacité libre suffisante dans le pool permet la reconstruction automatique. Le serveur reste néanmoins un point de défaillance unique.
- **Performances.** Le miroir offre le meilleur compromis. La parité pénalise les écritures aléatoires. La déduplication ajoute une latence de lecture sur disques rotatifs pour les accès aléatoires, négligeable sur SSD pour un usage bureautique.
- **Capacité.** Le miroir double consomme deux fois l'espace utile, la parité à trois disques environ une fois et demie. La déduplication compense une partie de ce surcoût sur les données bureautiques.
- **Exploitation.** Le provisionnement dynamique et la déduplication imposent une surveillance régulière de l'espace du pool et de l'état des tâches. Un pool sans alerte peut se remplir silencieusement.
- **Coût.** Storage Spaces et la déduplication sont inclus dans Windows Server Standard. S2D exige l'édition Datacenter et du matériel validé.

## Méthode 1 : Configuration via le Gestionnaire de serveur (Services de fichiers et de stockage)

### Création du Pool de Stockage

1. Ouvrez le **Gestionnaire de serveur** > **Services de fichiers et de stockage** > **Volumes** > **Pools de stockage**.
2. Vérifiez que le pool **Primordial** liste les quatre disques de données dans **Disques physiques**. S'il n'apparaît pas, les disques ne remplissent pas les prérequis (déjà initialisés, partitionnés ou masqués par un contrôleur RAID).
3. Dans **Pools de stockage**, ouvrez **Tâches** > **Nouveau pool de stockage**.
4. **Nom :** `Pool-Donnees`. Sélectionnez le sous-système **Windows Storage** du serveur.
5. Cochez les quatre disques. Pour un cinquième disque éventuel, choisissez **Réserve à chaud** dans la colonne **Allocation**.
6. Cliquez sur **Créer**, puis cochez **Créer un disque virtuel à la fermeture de l'assistant** avant de fermer.

### Création d'un Disque Virtuel Miroir Fixe

1. Dans l'assistant **Nouveau disque virtuel**, sélectionnez `Pool-Donnees`.
2. **Nom :** `VD-Partages`.
3. **Disposition du stockage :** **Mirror** (miroir double avec quatre disques).
4. **Type d'approvisionnement :** **Fixe**.
5. **Taille :** 300 Go, en cochant **Créer le plus grand disque virtuel possible, jusqu'à la taille spécifiée** pour éviter une erreur liée à l'espace consommé par la résilience.
6. Cliquez sur **Créer**, puis laissez cochée **Créer un volume à la fermeture de l'assistant**.

### Création du Volume NTFS

1. Dans l'assistant **Nouveau volume**, sélectionnez SRV-FIC-01 et le disque `VD-Partages`.
2. **Taille :** toute la capacité.
3. **Lettre de lecteur :** `D`.
4. **Système de fichiers :** **NTFS**, taille d'unité d'allocation **Par défaut**, **Nom de volume :** `Partages`.
5. Si l'assistant propose la déduplication sur cette page, laissez-la désactivée : elle sera configurée après l'installation du rôle.
6. Cliquez sur **Créer**.

### Création d'un Disque Virtuel Parité Dynamique pour les Archives

1. Dans **Disques virtuels**, ouvrez **Tâches** > **Nouveau disque virtuel**.
2. **Nom :** `VD-Archives`, **Disposition :** **Parity**, **Type d'approvisionnement :** **Dynamique** (thin), **Taille :** 400 Go.
3. Créez le volume `E:` en **ReFS**, nommé `Archives`.

<div class="callout callout-note">

Le miroir fixe de 300 Go consomme 600 Go bruts sur les 800 Go du pool. Le disque de parité dynamique de 400 Go consommerait, une fois plein, plus que les 200 Go bruts restants. C'est un exemple volontaire de surallocation, qui impose la surveillance décrite dans « Vérifications ».

</div>

### Installation et Activation de la Déduplication

1. Ouvrez **Gérer** > **Ajouter des rôles et fonctionnalités** > **Rôles de serveurs** > **Services de fichiers et de stockage** > **Services de fichiers et iSCSI**, cochez **Déduplication des données** et terminez l'installation.
2. Dans **Services de fichiers et de stockage** > **Volumes**, faites un clic droit sur `D:` > **Configurer la déduplication des données**.
3. **Déduplication des données :** **Serveur de fichiers à usage général** (type Default).
4. **Dédupliquer les fichiers de plus de (en jours) :** 3, valeur par défaut.
5. **Extensions de fichiers à exclure :** ajoutez par exemple `pst` si des fichiers PST sont ouverts en permanence. **Dossiers à exclure :** ajoutez les dossiers applicatifs sensibles à la latence.
6. Cliquez sur **Définir la planification de la déduplication** pour vérifier que l'optimisation en arrière-plan est activée, et ajoutez si besoin une fenêtre d'optimisation de débit la nuit.
7. Validez avec **OK**.

## Méthode 2 : Configuration via PowerShell

### Inventaire des Disques

```powershell
Get-PhysicalDisk -CanPool $true |
    Select-Object FriendlyName, SerialNumber, MediaType, BusType, @{n="TailleGo";e={[math]::Round($_.Size/1GB)}}
```

### Création du Pool

```powershell
$disques = Get-PhysicalDisk -CanPool $true
New-StoragePool -FriendlyName "Pool-Donnees" -StorageSubsystemFriendlyName "Windows Storage*" -PhysicalDisks $disques

# Optionnel : ajouter un disque comme réserve à chaud
# $spare = Get-PhysicalDisk -FriendlyName "<NomDuDisque>"
# Add-PhysicalDisk -StoragePoolFriendlyName "Pool-Donnees" -PhysicalDisks $spare -Usage HotSpare
```

### Création des Disques Virtuels et des Volumes

```powershell
# Miroir double, provisionnement fixe, volume NTFS D:
New-VirtualDisk -StoragePoolFriendlyName "Pool-Donnees" -FriendlyName "VD-Partages" `
    -ResiliencySettingName Mirror -NumberOfDataCopies 2 -ProvisioningType Fixed -Size 300GB |
    Get-Disk | Initialize-Disk -PartitionStyle GPT -PassThru |
    New-Partition -DriveLetter D -UseMaximumSize |
    Format-Volume -FileSystem NTFS -NewFileSystemLabel "Partages" -Confirm:$false

# Parité, provisionnement dynamique, volume ReFS E:
New-VirtualDisk -StoragePoolFriendlyName "Pool-Donnees" -FriendlyName "VD-Archives" `
    -ResiliencySettingName Parity -ProvisioningType Thin -Size 400GB |
    Get-Disk | Initialize-Disk -PartitionStyle GPT -PassThru |
    New-Partition -DriveLetter E -UseMaximumSize |
    Format-Volume -FileSystem ReFS -NewFileSystemLabel "Archives" -Confirm:$false

# Exemple de disque simple pour des données temporaires (aucune résilience)
# New-VirtualDisk -StoragePoolFriendlyName "Pool-Donnees" -FriendlyName "VD-Temp" `
#     -ResiliencySettingName Simple -ProvisioningType Thin -Size 50GB
```

### Évaluation et Activation de la Déduplication

```powershell
Install-WindowsFeature -Name FS-Data-Deduplication

# Estimation du gain avant activation
& "$env:SystemRoot\System32\DDPEval.exe" "D:\Partages"

# Activation avec le type serveur de fichiers généraliste
Enable-DedupVolume -Volume "D:" -UsageType Default

# Ajustements facultatifs
Set-DedupVolume -Volume "D:" -MinimumFileAgeDays 3 -ExcludeFileType "pst"
```

### Exécution Manuelle des Tâches

```powershell
# Optimisation immédiate (utile après une migration massive de données)
Start-DedupJob -Volume "D:" -Type Optimization

# Suivi de la tâche en cours
Get-DedupJob -Volume "D:"

# Récupération de l'espace et contrôle d'intégrité
Start-DedupJob -Volume "D:" -Type GarbageCollection
Start-DedupJob -Volume "D:" -Type Scrubbing
```

### Désactivation Propre de la Déduplication

```powershell
# Réhydrate tous les fichiers : vérifier l'espace libre au préalable
Start-DedupJob -Volume "D:" -Type Unoptimization
```

<div class="callout callout-note">

La tâche **Unoptimization** désactive la déduplication sur le volume à la fin de son exécution. N'utilisez pas `Disable-DedupVolume` seul pour revenir en arrière : il arrête les nouvelles optimisations mais laisse les fichiers existants dédupliqués.

</div>

## Vérifications

**Pool :** `Get-StoragePool -FriendlyName "Pool-Donnees" | Select-Object FriendlyName, HealthStatus, OperationalStatus, Size, AllocatedSize` affiche **Healthy** et **OK**. L'écart entre `Size` et `AllocatedSize` donne l'espace physique restant.

**Disques virtuels :** `Get-VirtualDisk | Select-Object FriendlyName, ResiliencySettingName, NumberOfDataCopies, ProvisioningType, HealthStatus, OperationalStatus` montre `VD-Partages` en **Mirror** et `VD-Archives` en **Parity**, tous deux **Healthy**.

**Disques physiques :** `Get-StoragePool -FriendlyName "Pool-Donnees" | Get-PhysicalDisk | Select-Object FriendlyName, Usage, HealthStatus` affiche les disques en **Auto-Select** (ou **Hot Spare**) et **Healthy**.

**Volumes :** `Get-Volume -DriveLetter D, E | Select-Object DriveLetter, FileSystem, HealthStatus, SizeRemaining, Size` confirme NTFS sur `D:` et ReFS sur `E:`.

**Déduplication :** après au moins une tâche d'optimisation, `Get-DedupStatus -Volume "D:" | Format-List Volume, SavedSpace, OptimizedFilesCount, InPolicyFilesCount, LastOptimizationTime, LastOptimizationResult` indique un espace économisé non nul et un résultat de dernière optimisation sans erreur. `Get-DedupVolume -Volume "D:" | Select-Object Volume, UsageType, SavingsRate` affiche le taux de gain.

**Journaux :** l'**Observateur d'événements** > **Journaux des applications et des services** > **Microsoft** > **Windows** > **Deduplication** > **Operational** journalise le début et la fin de chaque tâche.

**Résilience :** sur la VM de lab, retirez à chaud un des quatre disques. `VD-Partages` passe en **Degraded** (ou **Incomplete**) mais `D:` reste accessible. Après remise en place ou remplacement du disque, `Repair-VirtualDisk -FriendlyName "VD-Partages"` reconstruit la redondance.

## Dépannage

**« Le pool primordial n'apparaît pas ou un disque n'est pas proposé » :** le disque est déjà initialisé ou partitionné, ou le contrôleur présente un volume RAID. Vérifiez avec `Get-PhysicalDisk | Select-Object FriendlyName, CanPool, CannotPoolReason`. Un disque de lab réutilisé peut être nettoyé avec `Clear-Disk -Number <n> -RemoveData -Confirm:$false` après vérification de son numéro.

**« La création du disque virtuel échoue faute d'espace » :** la taille demandée ne tient pas compte du surcoût de résilience. Utilisez l'option de plus grande taille possible dans l'assistant, ou réduisez `-Size`. Pour la parité et le miroir triple, vérifiez aussi le nombre minimal de disques.

**« Un disque virtuel dynamique passe hors ligne » :** le pool est plein. Ajoutez des disques avec `Add-PhysicalDisk -StoragePoolFriendlyName "Pool-Donnees" -PhysicalDisks (Get-PhysicalDisk -CanPool $true)`, libérez de l'espace, puis remettez le disque en ligne avec `Connect-VirtualDisk -FriendlyName "<nom>"` si nécessaire.

**« Remplacer un disque défaillant » :** marquez-le comme retiré avec `Set-PhysicalDisk -FriendlyName "<disque>" -Usage Retired`, lancez `Repair-VirtualDisk` sur les disques virtuels concernés, attendez la fin des tâches (`Get-StorageJob`), puis retirez-le du pool avec `Remove-PhysicalDisk -StoragePoolFriendlyName "Pool-Donnees" -PhysicalDisks (Get-PhysicalDisk -FriendlyName "<disque>")`.

**« La déduplication n'économise rien » :** les fichiers sont plus récents que `MinimumFileAgeDays`, ou aucune tâche d'optimisation n'a encore abouti. Consultez `Get-DedupStatus` (`InPolicyFilesCount`, `LastOptimizationResult`), puis lancez `Start-DedupJob -Type Optimization`. Les fichiers compressés (vidéos, archives ZIP) se dédupliquent peu.

**« Les tâches de déduplication ne se terminent jamais » :** le serveur manque de mémoire ou la fenêtre d'exécution est trop courte face au volume de modifications. Augmentez la mémoire, planifiez une tâche d'optimisation de débit en heures creuses, et consultez le journal **Deduplication/Operational**.

**« Le volume est plein alors que des fichiers ont été supprimés » :** l'espace des blocs n'est rendu qu'après la tâche **GarbageCollection**. Exécutez-la manuellement avec `Start-DedupJob -Volume "D:" -Type GarbageCollection`.

## Conseils et Bonnes Pratiques

**Privilégier le miroir pour les données actives.** Le miroir double est le choix par défaut pour les partages. Réservez la parité aux archives et aux sauvegardes, et la disposition simple aux données jetables.

**Conserver de la capacité libre dans le pool.** Gardez l'équivalent d'au moins un disque de capacité non allouée, ou un disque de réserve à chaud, pour permettre la reconstruction automatique après une panne.

**Surveiller l'allocation des disques dynamiques.** Créez une alerte lorsque `AllocatedSize` dépasse 80 % de `Size` du pool, via un script planifié ou un outil de supervision.

**Prévoir l'extension dès la conception.** L'ajout de capacité à un disque virtuel dépend du nombre de colonnes. Ajoutez les disques par lots cohérents avec la disposition (par paires pour un miroir double à deux colonnes, par exemple), puis étendez avec `Resize-VirtualDisk` et `Resize-Partition`.

**Évaluer avant de dédupliquer.** Exécutez `DDPEval.exe` sur un échantillon représentatif. Pour les charges non recommandées, menez un pilote et mesurez la latence avant la généralisation.

**Planifier les tâches hors production.** Pour un serveur très sollicité en journée, désactivez l'optimisation en arrière-plan aux heures ouvrées et planifiez des tâches d'optimisation de débit la nuit avec `New-DedupSchedule`.

**Adapter la sauvegarde.** Validez que la solution de sauvegarde gère les volumes dédupliqués et testez une restauration complète de fichier et de volume. Une sauvegarde par fichier non compatible multiplie la volumétrie sauvegardée.

**Choisir NTFS pour les partages gouvernés.** Gardez NTFS pour tout volume qui portera des quotas FSRM ou des dossiers répliqués par DFS-R, et réservez ReFS aux archives, aux dépôts de sauvegarde et aux volumes de machines virtuelles.

## Procédures Liées

- [Mise en Place d'un Volume à Tolérance de Panne (RAID)](/procedures/windows/mise-en-place-dun-volume-a-tolerance-de-panne-raid) *(Alternative héritée par la Gestion des disques)*
- [Configuration de FSRM (Quotas et Filtrage de Fichiers)](/procedures/windows/configuration-de-fsrm-quotas-et-filtrage-de-fichiers) *(Gouvernance du volume NTFS créé)*
- [Déploiement de DFS Namespaces et DFS Replication](/procedures/windows/deploiement-de-dfs-namespaces-et-dfs-replication) *(Réplication du volume de partages)*
- [Mise en Place d'un Cluster de Basculement Hyper-V](/procedures/windows/mise-en-place-dun-cluster-de-basculement-hyper-v) *(Socle requis pour Storage Spaces Direct)*
- [Chiffrement des Volumes avec BitLocker](/procedures/windows/chiffrement-des-volumes-avec-bitlocker) *(Chiffrement des volumes créés sur le pool)*
- [Déploiement de Windows Admin Center](/procedures/windows/deploiement-de-windows-admin-center) *(Gestion graphique du stockage et de la déduplication)*
