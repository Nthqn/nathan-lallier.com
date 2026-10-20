---
modele: "procedure"
titre: "Mise en Place d'un Cluster de Basculement Hyper-V"
type: "PROCEDURE"
class: "04. Virtualisation"
reference: "WIN-CPT-DEP"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la mise en place d'un cluster de basculement Hyper-V à deux nœuds, SRV-HV-01 et SRV-HV-02, sous Windows Server 2025 dans le domaine `lab.local`. Elle couvre la validation de la configuration avec `Test-Cluster`, la création du cluster avec `New-Cluster`, le choix et la configuration du témoin (disque, partage de fichiers ou cloud), la conversion du stockage partagé en volumes partagés de cluster (CSV), la création de VM hautement disponibles, la migration dynamique (Live Migration) et la mise à jour automatisée avec Cluster-Aware Updating (CAU).

La mise en œuvre du stockage partagé lui-même (cible iSCSI, baie SAN ou Storage Spaces Direct) sort du périmètre. On suppose deux LUN iSCSI déjà présentées aux deux nœuds.

## Contexte et Justification

Un hôte Hyper-V isolé arrête toutes ses VM lors d'une panne matérielle ou d'un simple redémarrage pour mise à jour. Les fenêtres de maintenance mensuelles imposent alors des interruptions de service planifiées, et une panne imprévue peut durer jusqu'au remplacement du matériel.

Le cluster de basculement répond à ces deux situations :

- **Panne d'un nœud :** le service de cluster détecte la perte du nœud et redémarre automatiquement ses VM sur le nœud survivant, en quelques minutes.
- **Maintenance sans interruption :** la migration dynamique déplace les VM en fonctionnement vers l'autre nœud avant un redémarrage, sans coupure perceptible.
- **Mises à jour orchestrées :** CAU vide, met à jour, redémarre et réintègre chaque nœud l'un après l'autre.
- **Administration centralisée :** les VM se gèrent comme des rôles du cluster, indépendamment du nœud qui les héberge.

## Concepts Clés

**Nœud.** Serveur membre du cluster. Tous les nœuds exécutent la même version de Windows Server, le rôle Hyper-V et la fonctionnalité Clustering avec basculement.

**Objet nom de cluster (CNO).** Compte ordinateur créé dans AD au nom du cluster (`SRV-HVCLU-01`). Il porte l'adresse IP d'administration du cluster et crée à son tour les comptes ordinateurs des rôles clusterisés.

**Quorum et témoin.** Le cluster ne fonctionne que si une majorité de votes est présente. Avec deux nœuds, la perte d'un seul nœud ferait perdre la majorité sans un troisième vote : le **témoin**. Le quorum dynamique ajuste ensuite les votes automatiquement.

| Type de témoin | Support | Cas d'usage |
|----------------|---------|-------------|
| Disque | Petite LUN partagée (1 Go suffit) | Cluster avec stockage SAN ou iSCSI sur un seul site |
| Partage de fichiers | Partage SMB sur un serveur hors cluster | Pas de LUN disponible, ou cluster multisite avec un troisième site |
| Cloud | Compte de stockage Azure | Cluster multisite, ou absence de troisième site, avec accès HTTPS sortant |

: Types de témoin de quorum

**Stockage partagé.** Les VHDX des VM hautement disponibles doivent être accessibles par tous les nœuds : LUN iSCSI ou Fibre Channel d'une baie, partage SMB 3 d'un serveur de fichiers scale-out, ou Storage Spaces Direct (S2D) qui agrège les disques locaux des nœuds.

**Volume partagé de cluster (CSV).** Volume NTFS ou ReFS monté simultanément sur tous les nœuds sous `C:\ClusterStorage\VolumeN`. Chaque nœud lit et écrit directement les VHDX de ses VM, ce qui permet de déplacer une VM sans changer le propriétaire du disque.

**Migration dynamique (Live Migration).** Transfert de la mémoire d'une VM en fonctionnement d'un nœud à l'autre, avec une interruption de l'ordre de quelques millisecondes. Le transport utilise TCP 6600, avec trois options de performance : TCP/IP, Compression ou SMB (SMB Direct avec RDMA).

**Migration rapide (Quick Migration).** La VM est mise en état enregistré, déplacée, puis restaurée. L'interruption dure quelques secondes à quelques minutes.

**Cluster-Aware Updating (CAU).** Orchestrateur de mises à jour du cluster. En mode **auto-mise à jour**, un rôle CAU s'exécute dans le cluster et lance les cycles selon un planning. En mode **mise à jour à distance**, un poste d'administration déclenche le cycle à la demande.

## Prérequis

- Deux serveurs physiques identiques (même modèle, même processeur, mêmes cartes) sous **Windows Server 2025 Datacenter**, avec les mêmes mises à jour :
  - SRV-HV-01 : gestion 192.168.10.40 ;
  - SRV-HV-02 : gestion 192.168.10.41.
- Les deux nœuds joints au domaine `lab.local`, dans une OU dédiée `OU=Hyper-V,OU=Serveurs,DC=lab,DC=local`.
- Une adresse IP libre pour le cluster : 192.168.10.45, nom `SRV-HVCLU-01`.
- Des réseaux séparés recommandés :
  - gestion et VM : 192.168.10.0/24 sur le commutateur SET `vSwitch-SET` ;
  - cluster et migration dynamique : 172.16.10.0/24, non routé ;
  - stockage iSCSI : 172.16.20.0/24, non routé, deux chemins avec MPIO.
- Deux LUN iSCSI présentées aux deux nœuds : une LUN de 1 Go pour le témoin disque, une LUN de données pour le CSV. Les disques doivent être en ligne, initialisés en GPT, et ne porter aucune lettre ni volume en usage local.
- Les rôles et fonctionnalités **Hyper-V**, **Failover-Clustering** et **Multipath-IO** installés sur les deux nœuds.
- Des commutateurs virtuels portant exactement le même nom sur les deux nœuds.
- Un compte membre du groupe **Administrateurs** local des deux nœuds, disposant du droit **Create Computer objects** sur l'OU des nœuds (ou un CNO préparé à l'avance par un administrateur du domaine).
- Pour le témoin partage de fichiers : un partage sur un serveur hors cluster (ici `\\SRV-FIC-01.lab.local\Witness-SRV-HVCLU-01`), avec contrôle total pour le compte ordinateur `SRV-HVCLU-01$`.
- Pour le témoin cloud : un compte de stockage Azure (usage général, LRS) et un accès HTTPS sortant depuis les nœuds.

## Points de Vigilance

**Un rapport de validation sans erreur est une condition de support.** Microsoft ne supporte un cluster que si l'assistant de validation passe sans erreur bloquante. Conservez le rapport HTML généré et relancez la validation après tout changement matériel ou de pilote.

**La validation du stockage met les disques hors ligne.** Les tests de stockage prennent le contrôle des LUN. Ne lancez jamais la validation complète sur un cluster en production avec des VM actives sur ces disques : excluez la catégorie stockage ou planifiez une fenêtre de maintenance.

**Les noms de commutateurs virtuels doivent être identiques.** Une VM déplacée vers un nœud qui ne possède pas le même nom de commutateur démarre sans réseau ou échoue à migrer.

**Le CNO doit pouvoir créer des objets dans AD.** Si l'administrateur n'a pas le droit de créer des comptes ordinateurs dans l'OU, la création du cluster échoue. Si le CNO n'a pas ce droit, les rôles qui exigent un point d'accès client (Broker Hyper-V Replica, serveur de fichiers) échouent ensuite.

**Ne jamais formater ni monter localement un disque de cluster.** Une opération dans `diskmgmt.msc` sur un nœud alors que le disque appartient au cluster peut corrompre le volume.

**Les processeurs différents bloquent la migration dynamique.** Entre deux générations de processeurs du même fabricant, activez la compatibilité processeur sur la VM (VM éteinte). La migration dynamique entre Intel et AMD n'est pas possible.

**Storage Spaces Direct exige l'édition Datacenter et du matériel validé.** S2D n'est mentionné ici qu'en alternative au SAN. Sa mise en œuvre suit une procédure distincte.

**Cluster Sets est déprécié.** La fonctionnalité Cluster Sets n'est plus développée à partir de Windows Server 2025. N'en faites pas la base d'une nouvelle architecture.

**Clusters de groupe de travail.** Windows Server 2025 supporte les VM Hyper-V et leur migration dynamique dans un cluster sans domaine AD, authentifié par des comptes locaux identiques et des certificats. Ce mode n'est pas traité ici, et plusieurs fonctions dépendantes d'AD n'y sont pas disponibles.

## Choix Architecturaux & Alternatives

### Quand choisir un cluster de basculement Hyper-V

Le cluster de basculement est le bon choix dès que les VM d'un site doivent survivre à la panne d'un hôte et que les maintenances ne doivent plus interrompre le service. Il convient à partir de deux nœuds, avec un stockage partagé existant (baie iSCSI ou FC) ou avec des disques locaux en S2D sur matériel validé.

Il est surdimensionné pour un petit site où quelques heures d'interruption sont acceptables : un hôte unique protégé par Hyper-V Replica coûte moins cher. Il ne protège pas d'un sinistre de site : combinez-le avec Hyper-V Replica ou Azure Site Recovery vers un second site.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Cluster Hyper-V avec SAN iSCSI ou FC** | Site unique, baie existante | Architecture éprouvée, stockage mutualisé | La baie devient un point critique, coût de la baie | Moyen |
| **Cluster Hyper-V avec Storage Spaces Direct** | Hyperconvergé sur serveurs standards | Pas de baie, performances locales, montée en charge par nœud | Édition Datacenter, matériel validé, réseau RDMA recommandé | Élevé |
| **Azure Local** | Hyperconvergé géré depuis Azure | Cycle de vie et supervision par Azure Arc | Abonnement par cœur, matériel validé | Élevé |
| **Hôte unique avec Hyper-V Replica** | Petit site, budget limité | Simple, sans stockage partagé | Bascule manuelle, perte de données bornée par le RPO | Faible |
| **Cluster de groupe de travail** | Site isolé sans AD (DMZ, edge) | Aucune dépendance AD | Fonctions dépendantes d'AD indisponibles, comptes locaux à gérer | Moyen |

### Impact des choix

- **Disponibilité.** Le cluster redémarre automatiquement les VM d'un nœud défaillant. Avec deux nœuds, le témoin est indispensable. Chaque nœud doit pouvoir porter seul toute la charge : dimensionnez la RAM et le processeur à N+1.
- **Sécurité.** Les réseaux de cluster, de migration et de stockage doivent être isolés et non routés. Le flux de migration dynamique transporte la mémoire des VM, donc des secrets potentiels.
- **Performance.** Un réseau dédié à 10 Gbit/s ou plus pour la migration dynamique, avec l'option SMB et RDMA si les cartes le permettent, réduit fortement la durée des migrations.
- **Exploitation.** CAU supprime les maintenances manuelles nœud par nœud. Le cluster impose en contrepartie une discipline stricte : nœuds identiques, pilotes et microcodes alignés, changements validés.
- **Coût.** Les licences Windows Server Datacenter couvrent les VM en illimité sur chaque nœud, ce qui est presque toujours nécessaire en cluster puisque toute VM peut s'exécuter sur tout nœud. S'y ajoutent le stockage partagé et le réseau.

## Méthode 1 : Configuration via le Gestionnaire du Cluster de Basculement (cluadmin.msc)

### Installation des Rôles et Fonctionnalités

Sur SRV-HV-01 puis SRV-HV-02 :

1. **Server Manager** > **Manage** > **Add Roles and Features**.
2. Rôle **Hyper-V** (sans créer de commutateur dans l'assistant si `vSwitch-SET` existe déjà).
3. Fonctionnalités **Failover Clustering** et **Multipath I/O**, avec leurs outils de gestion.
4. **Install**, puis redémarrez.
5. Connectez les deux LUN iSCSI depuis l'**iSCSI Initiator** (`iscsicpl.exe`) sur les deux nœuds, avec les deux chemins de stockage, et activez MPIO pour les périphériques iSCSI (`mpiocpl.exe` > **Discover Multi-Paths** > **Add support for iSCSI devices**).

### Validation de la Configuration

1. Ouvrez `cluadmin.msc` sur SRV-HV-01.
2. **Actions** > **Validate Configuration**.
3. **Select Servers or a Cluster :** ajoutez `SRV-HV-01` et `SRV-HV-02`.
4. **Testing Options :** **Run all tests (recommended)**.
5. Lancez la validation, puis ouvrez le rapport avec **View Report**.
6. Corrigez toutes les erreurs. Les avertissements doivent être compris et documentés (par exemple un seul chemin réseau en lab).

### Création du Cluster

1. Dans la page **Summary** du rapport, cochez **Create the cluster now using the validated nodes**, ou **Actions** > **Create Cluster**.
2. **Access Point for Administering the Cluster :**
   - **Cluster Name :** `SRV-HVCLU-01` ;
   - **Address :** 192.168.10.45 sur le réseau 192.168.10.0/24.
3. **Confirmation :** décochez **Add all eligible storage to the cluster**. Les disques seront ajoutés de façon maîtrisée.
4. **Finish**. Le cluster apparaît dans le volet de gauche.

### Configuration des Réseaux du Cluster

1. **SRV-HVCLU-01** > **Networks**. Renommez chaque réseau selon son rôle : `Gestion`, `Cluster-LM`, `iSCSI`.
2. Clic droit > **Properties** :
   - `Gestion` : **Allow cluster network communication on this network** et **Allow clients to connect through this network** ;
   - `Cluster-LM` : **Allow cluster network communication on this network**, sans accès client ;
   - `iSCSI` : **Do not allow cluster network communication on this network**.
3. Clic droit sur **Networks** > **Live Migration Settings**. Cochez uniquement `Cluster-LM` et placez-le en tête de liste.

### Ajout du Stockage et Création du CSV

1. **Storage** > **Disks** > **Add Disk**. Sélectionnez les deux LUN.
2. Identifiez le disque de 1 Go (témoin) et le disque de données.
3. Clic droit sur le disque de données > **Add to Cluster Shared Volumes**. Il devient accessible sur les deux nœuds sous `C:\ClusterStorage\Volume1`.
4. Renommez le volume de montage si besoin depuis l'Explorateur, par exemple `C:\ClusterStorage\CSV-VM01`.

### Configuration du Témoin

1. Clic droit sur **SRV-HVCLU-01** > **More Actions** > **Configure Cluster Quorum Settings**.
2. **Select the quorum witness**, puis l'une des options :
   - **Configure a disk witness :** sélectionnez le disque de 1 Go ;
   - **Configure a file share witness :** `\\SRV-FIC-01.lab.local\Witness-SRV-HVCLU-01` ;
   - **Configure a cloud witness :** nom du compte de stockage Azure, clé d'accès, point de terminaison par défaut.
3. **Next** jusqu'à **Finish**. Le témoin apparaît dans **Cluster Core Resources**.

### Création d'une VM Hautement Disponible

1. **Roles** > **Virtual Machines** > **New Virtual Machine**, sélectionnez le nœud cible.
2. L'assistant Hyper-V s'ouvre. Indiquez l'emplacement `C:\ClusterStorage\Volume1\SRV-APP-01` pour la configuration et le disque, génération 2, commutateur `vSwitch-SET`.
3. À la fin, l'assistant **High Availability** ajoute la VM comme rôle du cluster.
4. Pour une VM existante stockée sur le CSV : **Roles** > **Configure Role** > **Virtual Machine**, puis sélectionnez la VM.

### Migration Dynamique et Maintenance d'un Nœud

1. **Roles**, clic droit sur `SRV-APP-01` > **Move** > **Live Migration** > **Select Node**, puis SRV-HV-02. La colonne **Information** affiche la progression.
2. Pour une maintenance : **Nodes**, clic droit sur SRV-HV-01 > **Pause** > **Drain Roles**. Toutes les VM migrent vers SRV-HV-02.
3. Après maintenance : clic droit sur SRV-HV-01 > **Resume** > **Fail Roles Back**.

### Configuration de Cluster-Aware Updating

1. Depuis un poste d'administration avec les outils RSAT Clustering, ouvrez **Cluster-Aware Updating** (Server Manager > **Tools**), puis connectez-vous à `SRV-HVCLU-01`.
2. **Analyze cluster updating readiness**. Corrigez les tests en échec (règle de pare-feu Remote Shutdown, source de mises à jour identique, mises à jour automatiques non installées par Windows Update).
3. **Configure cluster self-updating options** :
   - cochez **Add the CAU clustered role, with self-updating mode enabled, to this cluster** ;
   - planning : **Monthly**, troisième mardi, 22 h ;
   - options avancées : **MaxFailedNodes** à 0, **RequireAllNodesOnline** coché.
4. Pour un cycle immédiat : **Apply updates to this cluster**.

## Méthode 2 : Configuration via PowerShell

### Installation des Fonctionnalités

```powershell
Invoke-Command -ComputerName SRV-HV-01, SRV-HV-02 -ScriptBlock {
    Install-WindowsFeature -Name Hyper-V, Failover-Clustering, Multipath-IO `
                           -IncludeManagementTools -Restart
}
```

Après redémarrage, activez la prise en charge MPIO pour iSCSI sur chaque nœud :

```powershell
Invoke-Command -ComputerName SRV-HV-01, SRV-HV-02 -ScriptBlock {
    Enable-MSDSMAutomaticClaim -BusType iSCSI
}
```

### Validation

```powershell
Test-Cluster -Node SRV-HV-01, SRV-HV-02 -ReportName 'C:\Rapports\Validation-SRV-HVCLU-01'
```

Le rapport HTML est enregistré à l'emplacement indiqué. Examinez chaque avertissement avant de poursuivre.

### Création du Cluster

```powershell
New-Cluster -Name 'SRV-HVCLU-01' `
            -Node SRV-HV-01, SRV-HV-02 `
            -StaticAddress 192.168.10.45 `
            -NoStorage
```

### Réseaux du Cluster

```powershell
Get-ClusterNetwork -Cluster SRV-HVCLU-01 | Select-Object Name, Address, Role

(Get-ClusterNetwork -Cluster SRV-HVCLU-01 -Name 'Cluster Network 1').Name = 'Gestion'
(Get-ClusterNetwork -Cluster SRV-HVCLU-01 -Name 'Cluster Network 2').Name = 'Cluster-LM'
(Get-ClusterNetwork -Cluster SRV-HVCLU-01 -Name 'Cluster Network 3').Name = 'iSCSI'

# Rôles : 3 = cluster et clients, 1 = cluster uniquement, 0 = aucun
(Get-ClusterNetwork -Cluster SRV-HVCLU-01 -Name 'Gestion').Role    = 3
(Get-ClusterNetwork -Cluster SRV-HVCLU-01 -Name 'Cluster-LM').Role = 1
(Get-ClusterNetwork -Cluster SRV-HVCLU-01 -Name 'iSCSI').Role      = 0
```

<div class="callout callout-note">

Vérifiez la correspondance entre `Cluster Network N` et les sous-réseaux avec la colonne `Address` avant de renommer.

</div>

### Stockage et CSV

```powershell
Get-ClusterAvailableDisk -Cluster SRV-HVCLU-01 | Add-ClusterDisk -Cluster SRV-HVCLU-01
Get-ClusterResource -Cluster SRV-HVCLU-01 | Where-Object ResourceType -eq 'Physical Disk'

# Disque de données converti en CSV
Add-ClusterSharedVolume -Cluster SRV-HVCLU-01 -Name 'Cluster Disk 2'
Get-ClusterSharedVolume -Cluster SRV-HVCLU-01
```

### Témoin

```powershell
# Témoin disque
Set-ClusterQuorum -Cluster SRV-HVCLU-01 -DiskWitness 'Cluster Disk 1'

# Ou témoin partage de fichiers
Set-ClusterQuorum -Cluster SRV-HVCLU-01 -FileShareWitness '\\SRV-FIC-01.lab.local\Witness-SRV-HVCLU-01'

# Ou témoin cloud
Set-ClusterQuorum -Cluster SRV-HVCLU-01 -CloudWitness `
                  -AccountName 'stwitnesslab01' `
                  -AccessKey '<clé du compte de stockage>'

Get-ClusterQuorum -Cluster SRV-HVCLU-01
```

<div class="callout callout-note">

Ne laissez pas la clé du compte de stockage dans un script. Récupérez-la au moment de l'exécution depuis un coffre de secrets. Le cluster ne stocke pas la clé, il en dérive un jeton SAS.

</div>

### Paramètres de Migration Dynamique

```powershell
Invoke-Command -ComputerName SRV-HV-01, SRV-HV-02 -ScriptBlock {
    Set-VMHost -MaximumVirtualMachineMigrations 2 `
               -VirtualMachineMigrationPerformanceOption Compression
}
```

Remplacez `Compression` par `SMB` si les cartes du réseau `Cluster-LM` supportent RDMA.

### Création et Gestion d'une VM Hautement Disponible

```powershell
New-VM -Name 'SRV-APP-01' -ComputerName SRV-HV-01 -Generation 2 `
       -MemoryStartupBytes 4GB `
       -Path 'C:\ClusterStorage\Volume1' `
       -NewVHDPath 'C:\ClusterStorage\Volume1\SRV-APP-01\SRV-APP-01-OS.vhdx' `
       -NewVHDSizeBytes 80GB `
       -SwitchName 'vSwitch-SET'

Add-ClusterVirtualMachineRole -Cluster SRV-HVCLU-01 -VMName 'SRV-APP-01'
Start-ClusterGroup -Cluster SRV-HVCLU-01 -Name 'SRV-APP-01'

# Migration dynamique vers SRV-HV-02
Move-ClusterVirtualMachineRole -Cluster SRV-HVCLU-01 -Name 'SRV-APP-01' `
                               -Node SRV-HV-02 -MigrationType Live
```

Compatibilité processeur, VM éteinte, si les nœuds n'ont pas la même génération de processeur :

```powershell
Set-VMProcessor -ComputerName SRV-HV-01 -VMName 'SRV-APP-01' -CompatibilityForMigrationEnabled $true
```

### Maintenance d'un Nœud

```powershell
Suspend-ClusterNode -Cluster SRV-HVCLU-01 -Name SRV-HV-01 -Drain
# ... maintenance, redémarrage ...
Resume-ClusterNode -Cluster SRV-HVCLU-01 -Name SRV-HV-01 -Failback Immediate
```

### Cluster-Aware Updating

```powershell
# Test de préparation
Test-CauSetup -ClusterName SRV-HVCLU-01

# Rôle CAU en mode auto-mise à jour, troisième mardi du mois
$cau = @{
    ClusterName           = 'SRV-HVCLU-01'
    DaysOfWeek            = 'Tuesday'
    WeeksOfMonth          = 3
    MaxFailedNodes        = 0
    MaxRetriesPerNode     = 2
    RequireAllNodesOnline = $true
    EnableFirewallRules   = $true
    Force                 = $true
}
Add-CauClusterRole @cau

# Cycle immédiat à distance
Invoke-CauRun -ClusterName SRV-HVCLU-01 -MaxFailedNodes 0 -RequireAllNodesOnline `
              -EnableFirewallRules -Force
```

## Vérifications

**État général :**

```powershell
Get-ClusterNode -Cluster SRV-HVCLU-01 | Select-Object Name, State
Get-ClusterGroup -Cluster SRV-HVCLU-01 | Select-Object Name, OwnerNode, State
Get-ClusterQuorum -Cluster SRV-HVCLU-01
```

Les deux nœuds sont `Up`, le groupe **Cluster Group** est `Online` et le témoin est configuré.

**CSV :** `Get-ClusterSharedVolumeState -Cluster SRV-HVCLU-01` affiche l'état `Direct` sur les deux nœuds. Un état `FileSystemRedirected` ou `BlockRedirected` signale un problème d'accès au stockage depuis un nœud.

**Réseaux :** `Get-ClusterNetwork -Cluster SRV-HVCLU-01` affiche les trois réseaux `Up` avec les rôles attendus.

**Basculement :** arrêtez brutalement SRV-HV-02 (coupure d'alimentation en lab). Les VM qu'il hébergeait redémarrent sur SRV-HV-01 en quelques minutes, et le cluster reste en ligne grâce au témoin.

**Migration dynamique :** un `ping -t` continu vers `SRV-APP-01` pendant `Move-ClusterVirtualMachineRole` ne perd au plus qu'un ou deux paquets.

**CAU :** `Get-CauClusterRole -ClusterName SRV-HVCLU-01` affiche le planning, et `Get-CauReport -ClusterName SRV-HVCLU-01 -Last -Detailed` donne le résultat du dernier cycle.

## Dépannage

**La création du cluster échoue avec une erreur de création d'objet ordinateur :** le compte utilisé n'a pas le droit de créer des comptes ordinateurs dans l'OU, ou le quota de jonction est atteint. Faites préparer le CNO `SRV-HVCLU-01` désactivé dans l'OU, avec le contrôle total pour le compte d'installation, ou déléguez le droit **Create Computer objects** sur l'OU.

**Un rôle avec point d'accès client (Broker, serveur de fichiers) ne démarre pas :** le CNO `SRV-HVCLU-01$` n'a pas le droit de créer des objets dans l'OU. Accordez-lui **Create Computer objects** sur l'OU, puis remettez le rôle en ligne.

**Le témoin partage de fichiers reste hors ligne :** le compte `SRV-HVCLU-01$` n'a pas les droits NTFS et de partage sur `Witness-SRV-HVCLU-01`, ou SRV-FIC-01 n'est pas joignable. Vérifiez les autorisations et `Test-NetConnection SRV-FIC-01.lab.local -Port 445` depuis chaque nœud.

**Le témoin cloud ne passe pas en ligne :** le port 443 sortant est bloqué, le proxy n'est pas configuré pour le compte système, ou TLS 1.2 n'est pas négocié. Vérifiez la connectivité vers `<compte>.blob.core.windows.net` depuis chaque nœud et le nom ou la clé saisis.

**La migration dynamique échoue :** commutateur virtuel de nom différent sur la cible, processeurs incompatibles, réseau de migration indisponible, ou mémoire insuffisante sur la cible. Consultez le journal **Microsoft-Windows-Hyper-V-VMMS-Admin** sur les deux nœuds et le message détaillé dans `cluadmin.msc`.

**Un CSV passe en mode redirigé :** perte du chemin iSCSI d'un nœud, filtre de stockage tiers (antivirus) incompatible, ou problème MPIO. Vérifiez `Get-ClusterSharedVolumeState`, les sessions iSCSI et les exclusions antivirus sur `C:\ClusterStorage`.

**Le cluster perd le quorum après la panne d'un nœud :** aucun témoin n'est configuré ou le témoin est inaccessible. Configurez un témoin joignable des deux nœuds. Pour démarrer le service de cluster en urgence sur le nœud survivant, utilisez `Start-ClusterNode -Name SRV-HV-01 -FixQuorum`, puis corrigez le témoin.

**Rapport CAU en échec sur un nœud :** la règle de pare-feu Remote Shutdown est désactivée par une GPO, ou un nœud utilise une autre source de mises à jour. Relancez `Test-CauSetup` et corrigez les points signalés.

## Conseils et Bonnes Pratiques

**Garder des nœuds strictement identiques.** Même matériel, même microcode, mêmes pilotes, mêmes mises à jour. La moindre divergence finit par bloquer une migration ou un basculement.

**Dimensionner en N+1.** Chaque nœud doit pouvoir héberger seul toutes les VM en cas de panne de l'autre. Surveillez la RAM réservée : au-delà de 50 % par nœud dans un cluster à deux nœuds, la reprise totale n'est plus garantie.

**Séparer les flux réseau.** Gestion, cluster et migration, stockage. Les réseaux de cluster et de stockage restent non routés. Sur Windows Server 2025, Network ATC peut automatiser cette configuration par intentions.

**Relancer la validation après chaque changement.** Ajout de nœud, nouveau pilote, nouvelle LUN : une validation ciblée (en excluant le stockage en production) détecte les écarts avant l'incident.

**Utiliser CAU et proscrire les mises à jour manuelles.** CAU vide les nœuds, respecte l'ordre et s'arrête au premier échec si `MaxFailedNodes` vaut 0. Désactivez l'installation automatique par Windows Update sur les nœuds.

**Définir les préférences de propriétaire.** Pour répartir la charge, fixez les **Preferred Owners** des VM et activez l'équilibrage de charge des VM du cluster (Balancer) en mode modéré.

**Compléter avec un plan de reprise multisite.** Le cluster protège d'une panne d'hôte, pas de la perte du site ou de la baie. Ajoutez Hyper-V Replica avec un Broker, ou Azure Site Recovery, et une sauvegarde externalisée.

## Procédures Liées

- [Déploiement de Hyper-V et Gestion des VM](/procedures/windows/deploiement-de-hyper-v-et-gestion-des-vm) *(Préparation des nœuds SRV-HV-01 et SRV-HV-02)*
- [Configuration d'Hyper-V Replica](/procedures/windows/configuration-dhyper-v-replica) *(Reprise multisite et rôle Broker)*
- [Configuration des Storage Spaces et de la Déduplication](/procedures/windows/configuration-des-storage-spaces-et-de-la-deduplication) *(Alternative de stockage local)*
- [Déploiement de Windows Admin Center](/procedures/windows/deploiement-de-windows-admin-center) *(Gestion du cluster avec Cluster Manager)*
- [Délégation de l'Administration Active Directory](/procedures/windows/delegation-de-ladministration-active-directory) *(Droits de création du CNO dans l'OU)*
- [Supervision avec l'Analyseur de Performances et le Transfert d'Événements](/procedures/windows/supervision-avec-lanalyseur-de-performances-et-le-transfert-devenements) *(Suivi des nœuds et des journaux du cluster)*
