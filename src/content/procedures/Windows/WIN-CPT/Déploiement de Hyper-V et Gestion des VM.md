---
modele: "procedure"
titre: "Déploiement de Hyper-V et Gestion des VM"
type: "PROCEDURE"
class: "04. Virtualisation"
reference: "WIN-CPT-DEP"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit l'installation du rôle Hyper-V sur un serveur physique Windows Server 2025 joint au domaine `lab.local`, puis la création et la gestion des machines virtuelles.

Le périmètre couvre l'installation du rôle, les quatre types de commutateurs virtuels (externe, interne, privé et Switch Embedded Teaming), les disques VHDX, le choix entre génération 1 et génération 2, la mémoire dynamique, les points de contrôle standard et de production, et la virtualisation imbriquée. Chaque opération est décrite avec le Gestionnaire Hyper-V puis avec PowerShell. La haute disponibilité (cluster) et la réplication sont traitées dans des procédures dédiées.

## Contexte et Justification

Un parc de serveurs physiques dédiés à une seule application sous-utilise le matériel, multiplie les coûts d'énergie et de maintenance, et rend chaque renouvellement de serveur long et risqué.

Hyper-V répond à ces problèmes avec un hyperviseur de type 1 intégré à Windows Server :

- **Consolidation :** plusieurs serveurs logiques partagent un même hôte physique, avec une isolation forte entre machines virtuelles.
- **Agilité :** une VM se crée, se clone, se déplace ou se restaure en quelques minutes.
- **Coût maîtrisé :** le rôle est inclus dans Windows Server. L'édition Datacenter autorise un nombre illimité de VM Windows Server sur l'hôte licencié, l'édition Standard en autorise deux.
- **Intégration :** Hyper-V s'administre avec les mêmes outils que le reste du parc (PowerShell, Windows Admin Center, Active Directory, GPO) et sert de socle au cluster de basculement et à Hyper-V Replica.

## Concepts Clés

**Hyperviseur et partition parente.** Une fois le rôle installé, l'hyperviseur démarre avant Windows. Le système d'exploitation de l'hôte devient la partition parente (racine), qui gère les pilotes et la pile de virtualisation. Chaque VM s'exécute dans une partition enfant isolée.

**Commutateur virtuel (vSwitch).** Composant logiciel de niveau 2 qui relie les cartes réseau virtuelles des VM :

| Type | Connectivité | Usage typique |
|------|--------------|---------------|
| Externe | VM, hôte et réseau physique, via une carte physique | Production, accès au LAN 192.168.10.0/24 |
| Interne | VM et hôte uniquement | Lab isolé avec accès depuis l'hôte, NAT |
| Privé | VM entre elles uniquement | Segment isolé (DMZ de test, réseau de cluster invité) |
| Externe avec SET | Comme externe, sur plusieurs cartes physiques agrégées | Production avec redondance réseau |

: Types de commutateurs virtuels

**Switch Embedded Teaming (SET).** Agrégation de deux à huit cartes physiques identiques directement dans le commutateur virtuel. Le mode est toujours indépendant du commutateur physique. Les algorithmes de répartition disponibles sont **HyperVPort** et **Dynamic**. SET remplace l'association de cartes LBFO, qui ne peut plus porter un commutateur Hyper-V depuis Windows Server 2022.

**VHDX.** Format de disque virtuel par défaut, jusqu'à 64 To, résistant aux coupures d'alimentation. Un VHDX est soit **dynamique** (alloué au fil de l'eau), soit **fixe** (alloué en totalité à la création), soit **de différenciation** (enfant d'un disque parent en lecture seule). Le format VHD hérité est limité à 2 To.

**Génération de VM.**

| Critère | Génération 1 | Génération 2 |
|---------|--------------|--------------|
| Micrologiciel | BIOS émulé | UEFI |
| Démarrage | IDE, carte réseau héritée | SCSI, carte réseau synthétique (PXE) |
| Secure Boot et vTPM | Non | Oui |
| Systèmes invités | Anciens systèmes 32 bits | Windows Server 2012 et plus, Windows 10 et 11, Linux récents |

: Génération 1 et génération 2

La génération se choisit à la création et ne se modifie plus ensuite.

**Mémoire dynamique.** Hyper-V ajuste la RAM d'une VM entre une valeur minimale et une valeur maximale selon la pression mémoire mesurée par les services d'intégration. Le **tampon** (buffer) réserve un pourcentage supplémentaire, et le **poids** donne la priorité entre VM en cas de contention.

**Points de contrôle (checkpoints).**

- **Standard :** capture l'état des disques et de la mémoire. Restaurer ramène la VM exactement à l'instant de la capture, applications ouvertes comprises. Adapté au développement et au test.
- **Production :** utilise VSS dans l'invité Windows (ou le gel du système de fichiers sous Linux). Aucune mémoire n'est capturée, la VM restaurée redémarre éteinte, dans un état cohérent comme après une restauration de sauvegarde.

Le type se règle avec `-CheckpointType` : `Disabled`, `Production` (repli sur standard en cas d'échec), `ProductionOnly` (aucun point de contrôle en cas d'échec) ou `Standard`.

**Virtualisation imbriquée.** Expose les extensions de virtualisation du processeur à une VM pour y installer Hyper-V. Sur processeur Intel VT-x avec EPT, l'hôte doit être en Windows Server 2016 ou plus et la VM en version de configuration 8.0 ou plus. Sur processeur AMD EPYC ou Ryzen, l'hôte doit être en Windows Server 2022 ou plus et la VM en version de configuration 9.3 ou plus.

## Prérequis

- Un serveur physique SRV-HV-01 (192.168.10.40) sous **Windows Server 2025 Datacenter**, joint au domaine `lab.local`, avec les mises à jour cumulatives à jour.
- Un processeur 64 bits avec virtualisation matérielle (Intel VT-x ou AMD-V) et traduction d'adresses de second niveau (SLAT), activées dans l'UEFI, ainsi que la prévention d'exécution des données (DEP).
- Au moins 16 Go de RAM pour un lab, davantage selon le nombre de VM.
- Deux cartes réseau physiques identiques (`NIC1` et `NIC2`) reliées au réseau 192.168.10.0/24 pour le commutateur SET.
- Un volume de données dédié `D:` en NTFS ou ReFS pour stocker VM et disques, distinct du volume système.
- Un compte membre du groupe **Administrateurs** local de SRV-HV-01, ou du groupe **Hyper-V Administrators** pour la seule gestion des VM.
- Les ISO d'installation des systèmes invités dans `D:\ISO`.

## Points de Vigilance

**La création d'un commutateur externe coupe brièvement le réseau de l'hôte.** La carte physique est liée au commutateur et l'adresse IP de l'hôte migre vers la carte virtuelle `vEthernet`. Réalisez cette opération depuis la console locale ou l'iDRAC/iLO, jamais depuis une session RDP sur la carte concernée sans `-AllowManagementOS $true`.

**LBFO n'est plus supporté sous un commutateur Hyper-V.** Depuis Windows Server 2022, un commutateur virtuel ne peut plus être lié à une équipe LBFO. Utilisez SET. Le Gestionnaire Hyper-V ne sait pas créer de commutateur SET : la création passe par PowerShell ou Windows Admin Center.

**Un point de contrôle n'est pas une sauvegarde.** Les fichiers AVHDX sont stockés à côté des disques de la VM, sur le même volume. Une chaîne de points de contrôle longue dégrade les performances disque et grossit sans limite. Supprimez les points de contrôle dès que le changement est validé.

**Les points de contrôle standard sont dangereux pour les applications répliquées.** Restaurer un point de contrôle standard sur un contrôleur de domaine, un nœud SQL Server AlwaysOn ou tout service répliqué réintroduit un état ancien sur le réseau. Les contrôleurs de domaine depuis Windows Server 2012 détectent ce retour arrière grâce au VM-Generation ID, mais restez sur des points de contrôle de production et préférez une vraie sauvegarde.

**La génération est définitive.** Une VM créée en génération 1 ne se convertit pas en génération 2 sans outil tiers ou réinstallation. Choisissez la génération 2 par défaut.

**Secure Boot bloque certaines distributions Linux.** Une VM de génération 2 utilise par défaut le modèle `MicrosoftWindows`. Pour une distribution Linux signée, choisissez le modèle `MicrosoftUEFICertificateAuthority`.

**Mémoire dynamique et charges sensibles.** Certaines applications (SQL Server mal configuré, Exchange) supportent mal les variations de mémoire. Pour ces charges, utilisez une mémoire statique. Une VM qui héberge Hyper-V imbriqué ne bénéficie plus de la mémoire dynamique tant que l'hyperviseur invité tourne.

**Le stockage des VM sur le volume système est à proscrire.** Un volume `C:` saturé par un VHDX dynamique ou des AVHDX bloque l'hôte entier.

**Hyper-V Server gratuit n'existe plus.** Hyper-V Server 2019 est la dernière édition autonome gratuite. Pour Windows Server 2025, Hyper-V s'installe comme rôle sur Windows Server Standard ou Datacenter, éventuellement en Server Core.

## Choix Architecturaux & Alternatives

### Quand choisir Hyper-V

Hyper-V est le bon choix pour un environnement majoritairement Windows Server, déjà licencié en édition Datacenter, administré par des équipes à l'aise avec PowerShell et Active Directory. Il convient aux PME comme aux grands comptes, du serveur isolé au cluster de plusieurs dizaines de nœuds, et s'intègre nativement à Azure (Azure Arc, Azure Site Recovery, Azure Local).

Il est moins adapté à une équipe déjà outillée sur un autre hyperviseur avec des procédures et des sauvegardes rodées, ou à un besoin d'hyperviseur open source sans licence Windows.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Hyper-V (rôle Windows Server)** | Parc Windows, AD, licence Datacenter | Inclus dans Windows Server, PowerShell complet, intégration Azure | Écosystème d'outils tiers moins large que VMware | Faible |
| **Azure Local** | Hyperconvergé moderne piloté depuis Azure | Gestion par Azure Arc, cycle de mises à jour géré | Matériel validé requis, abonnement par cœur | Élevé |
| **VMware vSphere** | Grands comptes déjà équipés | Maturité, écosystème, vCenter | Coût de licence fortement relevé depuis le rachat par Broadcom | Élevé |
| **Proxmox VE** | PME, labs, environnements Linux | Open source, KVM et conteneurs LXC, interface web | Support commercial optionnel, intégration AD moins poussée | Gratuit à Faible |
| **Hyper-V sur Windows 11 Pro** | Poste de développement, lab personnel | Disponible sans serveur | Pas de réplica ni de cluster, usage non production | Gratuit |

### Impact des choix

- **Disponibilité.** Un hôte Hyper-V seul est un point de défaillance unique. Pour la production, prévoyez au minimum Hyper-V Replica vers un second hôte, et idéalement un cluster de basculement.
- **Sécurité.** La génération 2 apporte Secure Boot et le vTPM, prérequis de BitLocker dans l'invité et de Windows 11. Installer l'hôte en Server Core réduit la surface d'attaque et le nombre de correctifs.
- **Performance.** SET avec l'algorithme HyperVPort répartit les VM sur les cartes physiques et préserve les files VMQ. Les VHDX fixes offrent des performances plus prévisibles que les dynamiques, au prix de l'espace disque.
- **Exploitation.** Les points de contrôle de production simplifient les retours arrière avant mise à jour, à condition de les supprimer rapidement. La virtualisation imbriquée permet de monter des labs de cluster complets sur un seul serveur.
- **Coût.** Le rôle est gratuit. Le coût réel tient à la licence Windows Server de l'hôte (par cœur physique) et à la licence des systèmes invités, couverte en illimité par l'édition Datacenter.

## Méthode 1 : Configuration via le Gestionnaire Hyper-V (virtmgmt.msc)

### Installation du Rôle Hyper-V

1. Sur SRV-HV-01, ouvrez **Server Manager** > **Manage** > **Add Roles and Features**.
2. Choisissez **Role-based or feature-based installation**, puis le serveur SRV-HV-01.
3. Cochez **Hyper-V** et acceptez l'ajout des outils de gestion.
4. Page **Create Virtual Switches** : ne sélectionnez aucune carte. Les commutateurs seront créés ensuite de manière maîtrisée.
5. Page **Virtual Machine Migration** : laissez décoché pour un hôte autonome.
6. Page **Default Stores** : indiquez `D:\Hyper-V\Virtual Hard Disks` pour les disques et `D:\Hyper-V` pour les fichiers de configuration.
7. Cochez **Restart the destination server automatically if required**, puis **Install**. Le serveur redémarre deux fois.

### Création des Commutateurs Virtuels

1. Ouvrez `virtmgmt.msc`, sélectionnez SRV-HV-01, puis **Virtual Switch Manager** dans le volet **Actions**.
2. Pour un commutateur externe sur une seule carte : **New virtual network switch** > **External** > **Create Virtual Switch**.
   - **Name :** `vSwitch-Externe`.
   - **External network :** la carte `NIC1`.
   - Cochez **Allow management operating system to share this network adapter**.
3. Pour un commutateur interne : **Internal**, nom `vSwitch-Interne`.
4. Pour un commutateur privé : **Private**, nom `vSwitch-Prive`.
5. Validez avec **OK** et confirmez l'avertissement de coupure réseau.

<div class="callout callout-note">

Un commutateur SET ne se crée pas depuis cette console. Utilisez la commande `New-VMSwitch -EnableEmbeddedTeaming $true` de la Méthode 2, ou Windows Admin Center. Une fois créé, il apparaît dans le Gestionnaire Hyper-V comme un commutateur externe.

</div>

### Création d'une VM de Génération 2

1. **Actions** > **New** > **Virtual Machine**, puis **Next**.
2. **Specify Name and Location :** `SRV-APP-01`. Cochez **Store the virtual machine in a different location** et indiquez `D:\Hyper-V`.
3. **Specify Generation :** **Generation 2**.
4. **Assign Memory :** 4096 Mo, cochez **Use Dynamic Memory for this virtual machine**.
5. **Configure Networking :** `vSwitch-Externe` (ou le commutateur SET).
6. **Connect Virtual Hard Disk :** **Create a virtual hard disk**, nom `SRV-APP-01-OS.vhdx`, taille 80 Go. Le disque est créé en VHDX dynamique.
7. **Installation Options :** **Install an operating system from a bootable image file**, puis l'ISO `D:\ISO\WS2025.iso`.
8. **Finish**.

### Réglage des Paramètres de la VM

Clic droit sur `SRV-APP-01` > **Settings** :

1. **Security :** vérifiez **Enable Secure Boot** avec le modèle **Microsoft Windows**, et cochez **Enable Trusted Platform Module**.
2. **Memory :** ajustez **Minimum RAM** à 1024 Mo, **Maximum RAM** à 8192 Mo et **Memory buffer** à 20 %.
3. **Processor :** passez **Number of virtual processors** à 2.
4. **SCSI Controller** > **Hard Drive** > **Add** pour ajouter un disque de données. Choisissez **New**, puis le type **Fixed size** pour un disque de base de données.
5. **Checkpoints :** sélectionnez **Production checkpoints** et décochez **Create standard checkpoints if it's not possible to create a production checkpoint**.
6. **Automatic Start Action :** **Always start this virtual machine automatically**. **Automatic Stop Action :** **Shut down the guest operating system**.
7. **Apply** puis **OK**, et démarrez la VM avec **Connect** > **Start**.

<div class="callout callout-note">

Pour une VM Linux de génération 2, sélectionnez le modèle **Microsoft UEFI Certificate Authority** dans **Security**, sinon le chargeur de démarrage est refusé.

</div>

### Gestion des Points de Contrôle

1. Clic droit sur la VM > **Checkpoint**. Le point de contrôle apparaît dans le volet **Checkpoints**.
2. Renommez-le selon la convention, par exemple `2026-10-16 Avant MAJ KB`.
3. Pour revenir en arrière : clic droit sur le point de contrôle > **Apply**, puis **Create Checkpoint and Apply** pour conserver l'état courant, ou **Apply** pour l'écraser.
4. Une fois le changement validé : clic droit > **Delete Checkpoint**. Hyper-V fusionne le fichier AVHDX dans le disque parent en arrière-plan.

### Gestion des Disques Virtuels

1. **Actions** > **Edit Disk**, sélectionnez le VHDX (VM arrêtée pour une conversion).
2. Choisissez l'action :
   - **Compact** pour récupérer l'espace d'un VHDX dynamique ;
   - **Convert** pour passer de dynamique à fixe ou de VHD à VHDX ;
   - **Expand** pour agrandir le disque, puis étendez le volume dans l'invité.

### Activation de la Virtualisation Imbriquée

Cette option n'existe pas dans le Gestionnaire Hyper-V. Utilisez la commande `Set-VMProcessor` de la Méthode 2, VM éteinte.

## Méthode 2 : Configuration via PowerShell

### Installation du Rôle

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

Après redémarrage, définissez les emplacements par défaut :

```powershell
Set-VMHost -VirtualHardDiskPath 'D:\Hyper-V\Virtual Hard Disks' `
           -VirtualMachinePath 'D:\Hyper-V'
```

### Création des Commutateurs Virtuels

```powershell
# Commutateur SET sur deux cartes physiques, partagé avec l'hôte
New-VMSwitch -Name 'vSwitch-SET' `
             -NetAdapterName 'NIC1','NIC2' `
             -EnableEmbeddedTeaming $true `
             -AllowManagementOS $true

# Algorithme de répartition recommandé pour Hyper-V
Set-VMSwitchTeam -Name 'vSwitch-SET' -LoadBalancingAlgorithm HyperVPort

# Commutateur externe sur une seule carte (alternative sans SET)
New-VMSwitch -Name 'vSwitch-Externe' -NetAdapterName 'NIC1' -AllowManagementOS $true

# Commutateurs interne et privé
New-VMSwitch -Name 'vSwitch-Interne' -SwitchType Internal
New-VMSwitch -Name 'vSwitch-Prive'   -SwitchType Private
```

<div class="callout callout-note">

`New-VMSwitch` accepte soit `-NetAdapterName` (commutateur externe), soit `-SwitchType Internal` ou `Private`. Les deux paramètres ne se combinent pas.

</div>

### Création d'une VM de Génération 2

```powershell
$vm = 'SRV-APP-01'

New-VM -Name $vm `
       -Generation 2 `
       -MemoryStartupBytes 4GB `
       -Path 'D:\Hyper-V' `
       -NewVHDPath "D:\Hyper-V\Virtual Hard Disks\$vm-OS.vhdx" `
       -NewVHDSizeBytes 80GB `
       -SwitchName 'vSwitch-SET'

Set-VMProcessor -VMName $vm -Count 2

Set-VMMemory -VMName $vm `
             -DynamicMemoryEnabled $true `
             -MinimumBytes 1GB `
             -StartupBytes 4GB `
             -MaximumBytes 8GB `
             -Buffer 20

# Lecteur DVD, ordre de démarrage et Secure Boot
Add-VMDvdDrive -VMName $vm -Path 'D:\ISO\WS2025.iso'
Set-VMFirmware -VMName $vm `
               -FirstBootDevice (Get-VMDvdDrive -VMName $vm) `
               -EnableSecureBoot On `
               -SecureBootTemplate MicrosoftWindows

# vTPM avec protecteur de clé local
Set-VMKeyProtector -VMName $vm -NewLocalKeyProtector
Enable-VMTPM -VMName $vm

# Points de contrôle et actions automatiques
Set-VM -Name $vm `
       -CheckpointType ProductionOnly `
       -AutomaticStartAction Start `
       -AutomaticStopAction ShutDown

Start-VM -Name $vm
```

### Ajout d'un Disque de Données

```powershell
New-VHD -Path "D:\Hyper-V\Virtual Hard Disks\$vm-DATA.vhdx" -SizeBytes 100GB -Fixed
Add-VMHardDiskDrive -VMName $vm -ControllerType SCSI `
                    -Path "D:\Hyper-V\Virtual Hard Disks\$vm-DATA.vhdx"
```

### Gestion des Points de Contrôle

```powershell
Checkpoint-VM -Name $vm -SnapshotName '2026-10-16 Avant MAJ KB'
Get-VMCheckpoint -VMName $vm

# Retour arrière
Restore-VMCheckpoint -VMName $vm -Name '2026-10-16 Avant MAJ KB' -Confirm:$false

# Suppression après validation (fusion des AVHDX)
Remove-VMCheckpoint -VMName $vm -Name '2026-10-16 Avant MAJ KB'
```

### Maintenance des Disques Virtuels

```powershell
# Agrandissement à chaud d'un VHDX sur contrôleur SCSI
Resize-VHD -Path "D:\Hyper-V\Virtual Hard Disks\$vm-OS.vhdx" -SizeBytes 120GB

# Conversion dynamique vers fixe (VM arrêtée)
Convert-VHD -Path 'D:\Hyper-V\Virtual Hard Disks\SRV-OLD.vhdx' `
            -DestinationPath 'D:\Hyper-V\Virtual Hard Disks\SRV-OLD-fixe.vhdx' `
            -VHDType Fixed

# Compactage d'un VHDX dynamique (disque non attaché ou monté en lecture seule)
Optimize-VHD -Path 'D:\Hyper-V\Virtual Hard Disks\SRV-OLD.vhdx' -Mode Full
```

### Activation de la Virtualisation Imbriquée

```powershell
$lab = 'LAB-HV-NESTED'
Stop-VM -Name $lab
Set-VMProcessor -VMName $lab -ExposeVirtualizationExtensions $true
Set-VMMemory -VMName $lab -DynamicMemoryEnabled $false -StartupBytes 8GB
Get-VMNetworkAdapter -VMName $lab | Set-VMNetworkAdapter -MacAddressSpoofing On
Start-VM -Name $lab
```

L'usurpation d'adresse MAC permet aux VM de second niveau de communiquer à travers les deux commutateurs virtuels. Installez ensuite le rôle Hyper-V dans `LAB-HV-NESTED` comme sur un serveur physique.

## Vérifications

**Rôle installé et hyperviseur actif :**

```powershell
Get-WindowsFeature -Name Hyper-V
Get-VMHost | Select-Object Name, VirtualMachinePath, VirtualHardDiskPath
```

**Commutateurs :** `Get-VMSwitch` liste les quatre commutateurs avec leur type. `Get-VMSwitchTeam -Name 'vSwitch-SET'` affiche les deux cartes membres et l'algorithme `HyperVPort`.

**VM :**

```powershell
Get-VM -Name SRV-APP-01 | Select-Object Name, State, Generation, Version, CheckpointType
Get-VMMemory -VMName SRV-APP-01
Get-VMFirmware -VMName SRV-APP-01 | Select-Object SecureBoot, SecureBootTemplate
Get-VMSecurity -VMName SRV-APP-01 | Select-Object TpmEnabled
```

**Connectivité :** depuis la VM, un `ping 192.168.10.10` vers SRV-DC-01 répond et `Test-NetConnection SRV-DC-01.lab.local -Port 389` renvoie `TcpTestSucceeded : True`.

**Mémoire dynamique :** dans le Gestionnaire Hyper-V, les colonnes **Assigned Memory** et **Memory Demand** évoluent avec la charge de la VM.

**Virtualisation imbriquée :** `Get-VMProcessor -VMName LAB-HV-NESTED | Select-Object ExposeVirtualizationExtensions` renvoie `True`.

## Dépannage

**Le rôle Hyper-V refuse de s'installer ou les VM ne démarrent pas, avec un message indiquant que l'hyperviseur n'est pas en cours d'exécution :** la virtualisation matérielle ou la DEP est désactivée dans l'UEFI, ou le type de lancement de l'hyperviseur a été désactivé. Vérifiez avec `Get-ComputerInfo -Property 'HyperV*'`, activez les options dans l'UEFI, et contrôlez `bcdedit /enum` : la valeur `hypervisorlaunchtype` doit être `Auto`.

**Perte de connexion à l'hôte après création du commutateur externe :** l'option de partage avec le système de gestion n'a pas été cochée, ou la configuration IP n'a pas été reprise sur la carte `vEthernet`. Depuis la console locale, vérifiez `Get-NetIPAddress -InterfaceAlias 'vEthernet*'` et réattribuez l'adresse 192.168.10.40 si nécessaire.

**La VM Linux de génération 2 ne démarre pas, échec de la vérification de signature :** le modèle Secure Boot est `MicrosoftWindows`. Exécutez `Set-VMFirmware -VMName <VM> -SecureBootTemplate MicrosoftUEFICertificateAuthority`, VM éteinte.

**Le point de contrôle de production échoue :** les services d'intégration ou le service VSS de l'invité ne répondent pas. Vérifiez `Get-VMIntegrationService -VMName <VM>`, en particulier **Backup (volume shadow copy)**, et contrôlez le journal d'événements de l'invité. En mode `ProductionOnly`, aucun point de contrôle n'est créé tant que le problème persiste.

**Le volume D: se remplit sans raison apparente :** des fichiers AVHDX orphelins ou une longue chaîne de points de contrôle. Listez `Get-VM | Get-VMCheckpoint`, supprimez les points de contrôle obsolètes et laissez la fusion se terminer (colonne **Status** de la VM).

**Hyper-V refuse de s'installer dans une VM :** les extensions de virtualisation ne sont pas exposées, la VM est de génération 1, ou elle a été démarrée avec la mémoire dynamique. Éteignez la VM, appliquez `Set-VMProcessor -ExposeVirtualizationExtensions $true` et vérifiez sa version de configuration avec `Get-VM | Select-Object Name, Version`.

## Conseils et Bonnes Pratiques

**Installer l'hôte en Server Core.** Moins de composants, moins de correctifs, moins de redémarrages. L'administration se fait à distance avec le Gestionnaire Hyper-V, Windows Admin Center ou PowerShell.

**Dédier l'hôte au rôle Hyper-V.** N'installez aucun autre rôle (DHCP, fichiers, AD DS) sur la partition parente. Chaque service supplémentaire augmente la surface d'attaque et le risque d'interruption de toutes les VM.

**Privilégier la génération 2 et le vTPM.** C'est le socle de Secure Boot, de BitLocker dans l'invité et des exigences de Windows 11. La génération 1 reste réservée aux systèmes anciens sans support UEFI.

**Normaliser les noms.** Commutateurs `vSwitch-<Usage>`, disques `<VM>-OS.vhdx` et `<VM>-DATA.vhdx`, points de contrôle `<Date> <Motif>`. Les mêmes noms de commutateurs sur tous les hôtes sont indispensables à la migration dynamique et à la réplication.

**Utiliser les points de contrôle de production en mode ProductionOnly.** Le repli silencieux sur un point de contrôle standard masque un problème VSS et produit un état incohérent pour les applications.

**Surveiller l'hôte.** Suivez les compteurs **Hyper-V Hypervisor Logical Processor\% Total Run Time**, **Hyper-V Dynamic Memory Balancer\Available Memory** et la latence des volumes de stockage. Transférez les journaux **Microsoft-Windows-Hyper-V-VMMS** vers un collecteur central.

**Préparer la haute disponibilité dès la conception.** Des cartes identiques, des noms de commutateurs homogènes et un stockage séparé du système facilitent l'évolution vers Hyper-V Replica puis vers un cluster de basculement.

## Procédures Liées

- [Installation de Windows Server 2025](/procedures/windows/installation-de-windows-server-2025) *(Préparation du système de l'hôte SRV-HV-01)*
- [Configuration d'Hyper-V Replica](/procedures/windows/configuration-dhyper-v-replica) *(Protection des VM sur un second hôte)*
- [Mise en Place d'un Cluster de Basculement Hyper-V](/procedures/windows/mise-en-place-dun-cluster-de-basculement-hyper-v) *(Haute disponibilité des VM)*
- [Déploiement de Windows Admin Center](/procedures/windows/deploiement-de-windows-admin-center) *(Administration web d'Hyper-V et création de SET)*
- [Configuration des Storage Spaces et de la Déduplication](/procedures/windows/configuration-des-storage-spaces-et-de-la-deduplication) *(Stockage local des VHDX)*
- [Durcissement de Windows Server avec OSConfig et Credential Guard](/procedures/windows/durcissement-de-windows-server-avec-osconfig-et-credential-guard) *(Sécurisation de l'hôte)*
