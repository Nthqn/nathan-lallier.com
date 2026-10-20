---
modele: "procedure"
titre: "Configuration de FSRM (Quotas et Filtrage de Fichiers)"
type: "PROCEDURE"
class: "03. Serveur"
reference: "WIN-STO-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la configuration du Gestionnaire de ressources du serveur de fichiers (File Server Resource Manager, FSRM) sur le serveur de fichiers SRV-FIC-01 du domaine `lab.local`, sous Windows Server 2025.

Le périmètre couvre l'installation du rôle, les paramètres de notification, les modèles de quotas stricts et souples, les quotas appliqués automatiquement aux dossiers personnels, les groupes de fichiers, les filtres de fichiers actifs et passifs, les exceptions, et les rapports de stockage. L'infrastructure de classification des fichiers (FCI) et les tâches de gestion de fichiers sont présentées en mention, sans configuration détaillée.

## Contexte et Justification

Un serveur de fichiers sans gouvernance dérive rapidement :

- Quelques utilisateurs consomment l'essentiel de l'espace avec des vidéos, des archives ou des sauvegardes personnelles de leur poste.
- Des fichiers sans rapport avec l'activité (musique, exécutables portables, images disque) s'accumulent dans les partages et alourdissent les sauvegardes.
- Le volume se remplit sans préavis, ce qui bloque toutes les écritures et toutes les applications qui en dépendent.

Les quotas NTFS natifs ne répondent que partiellement à ce besoin : ils s'appliquent par utilisateur et par volume, sans notion de dossier, et sans notification exploitable.

FSRM apporte une gouvernance à l'échelle du dossier :

- **Maîtrise de la capacité :** limites par dossier, alertes progressives et application automatique aux nouveaux dossiers.
- **Hygiène des données :** blocage ou surveillance de catégories de fichiers selon leur extension.
- **Visibilité :** rapports planifiés sur les gros fichiers, les doublons, les fichiers anciens et l'utilisation des quotas.

## Concepts Clés

**Quota strict (hard quota).** Limite qui empêche toute écriture au-delà de la taille définie. L'utilisateur reçoit une erreur d'espace disque insuffisant.

**Quota souple (soft quota).** Limite de surveillance uniquement. Les écritures restent autorisées au-delà de la taille définie, mais les seuils déclenchent les notifications configurées.

**Seuil et notification.** Pourcentage de la limite (par exemple 85 %, 95 %, 100 %) qui déclenche une ou plusieurs actions : courrier électronique, entrée dans le journal des événements, exécution d'une commande, génération de rapports.

**Modèle de quota.** Définition réutilisable (taille, type, seuils, actions). Les quotas dérivés d'un modèle peuvent être mis à jour en masse lorsque le modèle change.

**Quota appliqué automatiquement (auto apply quota).** Modèle associé à un dossier parent. FSRM crée un quota sur chaque sous-dossier existant et sur chaque nouveau sous-dossier. C'est le mécanisme adapté aux dossiers personnels (`D:\Partages\Utilisateurs\<login>`).

**Groupe de fichiers.** Liste de modèles de noms à inclure (`*.mp3`, `*.mkv`) et éventuellement à exclure. Le filtrage FSRM repose sur le nom et l'extension, pas sur le contenu du fichier.

**Filtre de fichiers actif.** Bloque l'enregistrement des fichiers correspondant aux groupes sélectionnés et déclenche les notifications.

**Filtre de fichiers passif.** N'empêche rien et se contente de notifier. Il sert à mesurer l'impact d'une règle avant de la rendre active, ou à surveiller sans bloquer.

**Exception de filtre de fichiers.** Autorise un groupe de fichiers dans un sous-dossier précis malgré un filtre posé sur un dossier parent.

**Rapport de stockage.** Analyse d'un ensemble de dossiers produisant des rapports (gros fichiers, doublons, fichiers par propriétaire, fichiers les moins récemment utilisés, utilisation des quotas, audit de filtrage). Il peut être planifié, généré à la demande ou déclenché par un seuil de quota.

**Variables de notification.** Jetons remplacés à l'envoi, par exemple `[Admin Email]`, `[Source Io Owner]`, `[Source Io Owner Email]`, `[Quota Path]`, `[Quota Threshold]`, `[Source File Path]` ou `[Violated File Group]`. La liste complète est proposée par le bouton **Insérer une variable** de la console.

## Prérequis

- Un compte membre du groupe **Administrateurs** local de SRV-FIC-01 (192.168.10.30), par exemple via un groupe d'administration des serveurs de fichiers.
- SRV-FIC-01 sous Windows Server 2025, joint à `lab.local`.
- Le volume de données `D:` formaté en **NTFS**. FSRM ne prend pas en charge ReFS.
- L'arborescence existante :
  - `D:\Partages\Commun` pour les données d'équipe ;
  - `D:\Partages\Utilisateurs` contenant un sous-dossier par utilisateur.
- Un relais SMTP interne joignable depuis SRV-FIC-01 sur le port 25, acceptant les messages de ce serveur sans authentification (par exemple `smtp.lab.local`).
- Une adresse d'administration, par exemple `admin-stockage@lab.local`.
- La console **Gestionnaire de ressources du serveur de fichiers** (`fsrm.msc`) et le module PowerShell **FileServerResourceManager**, installés avec le rôle.

## Points de Vigilance

**FSRM ne fonctionne que sur NTFS.** Les volumes ReFS ne peuvent recevoir ni quota ni filtre. Si les données doivent être sur ReFS (par exemple pour la déduplication ReFS de Windows Server 2025), FSRM n'est pas utilisable sur ce volume.

**Les notifications par courrier n'utilisent qu'un SMTP simple.** Les options de FSRM ne proposent ni authentification SMTP ni paramétrage de chiffrement. Si la messagerie impose TLS et authentification (Exchange Online par exemple), il faut un relais interne autorisé par adresse IP. Le service SMTP intégré à Windows Server (IIS SMTP) a été **retiré de Windows Server 2025** et ne peut plus servir de relais local.

**Le filtrage porte sur le nom, pas sur le contenu.** Renommer `film.mkv` en `film.dat` contourne un filtre. FSRM est un outil d'hygiène et d'alerte, pas un contrôle de sécurité fiable contre un utilisateur déterminé.

**Un quota strict posé sur un dossier déjà plein bloque immédiatement les écritures.** Mesurez l'occupation existante avant d'appliquer un quota strict, ou commencez par un quota souple pendant une période d'observation.

**Les quotas imbriqués se cumulent.** Un sous-dossier ne peut jamais dépasser l'espace restant du quota de son parent. Un utilisateur peut donc être bloqué alors que son propre quota n'est pas atteint.

**Un filtre actif sur `*.tmp` casse des applications.** Microsoft Office et de nombreuses applications écrivent des fichiers temporaires lors de l'enregistrement. Bloquer ces extensions provoque des erreurs de sauvegarde difficiles à diagnostiquer.

**Interaction avec DFS Replication.** Sur un dossier répliqué, les quotas et filtres doivent être identiques sur tous les membres, le dossier `DfsrPrivate` ne doit jamais être filtré ni limité, et les quotas stricts doivent être employés avec prudence, car la réplication peut les dépasser.

**FSRM crée un journal des modifications USN sur chaque volume.** Ce journal consomme un peu d'espace. Depuis Windows Server version 1803, sa création peut être désactivée par registre (`SkipUSNCreationForSystem` ou `SkipUSNCreationForVolumes`), au prix de la perte de la classification en temps réel.

## Choix Architecturaux & Alternatives

### Quand choisir FSRM

FSRM est le bon choix pour un serveur de fichiers Windows on-premise qui héberge des partages d'équipe et des dossiers personnels, lorsque l'objectif est de piloter la capacité par dossier et de limiter les fichiers hors périmètre métier. Il est inclus dans Windows Server, ne nécessite aucun agent sur les postes et se configure en quelques minutes.

Ne choisissez pas FSRM comme protection principale contre les rançongiciels : un filtre passif sur des extensions connues fournit une alerte précoce, mais il ne remplace ni un EDR ni des sauvegardes immuables. Ne le choisissez pas non plus pour des données sur ReFS, ni pour des partages Azure Files, qui disposent de leurs propres quotas de partage.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **FSRM** | Serveur de fichiers NTFS, quotas par dossier et filtrage | Granularité par dossier, notifications, rapports intégrés | NTFS uniquement, filtrage par extension seulement, SMTP sans authentification | Gratuit, inclus dans Windows Server |
| **Quotas de disque NTFS** | Limite par utilisateur sur un volume entier | Simple, natif, sans rôle supplémentaire | Pas de notion de dossier, pas de modèle, notifications pauvres | Gratuit |
| **Quotas de partage Azure Files** | Partages SMB hébergés dans Azure | Aucune infrastructure à gérer | Quota par partage uniquement, pas de filtrage de fichiers | Moyen |
| **Solutions tierces de gouvernance des données (Varonis, Netwrix, etc.)** | Audit, classification et détection de comportements anormaux | Analyse d'accès et détection comportementale | Coût de licence, déploiement plus lourd | Élevé |

### Impact des choix

- **Disponibilité.** Un quota strict mal dimensionné bloque les utilisateurs et peut interrompre une application métier qui écrit dans le partage. Les quotas souples ne présentent pas ce risque mais n'empêchent pas la saturation du volume.
- **Sécurité.** Le filtrage par extension réduit la surface (exécutables dans les partages, fichiers de rançongiciels connus) mais reste contournable. Il s'utilise en complément des ACL NTFS et d'un antivirus.
- **Exploitation.** Les modèles et quotas appliqués automatiquement réduisent fortement la charge d'administration. Les notifications doivent être dosées pour ne pas noyer l'équipe d'exploitation, d'où l'intérêt des limites de fréquence.
- **Coût.** FSRM est gratuit. Le coût réel est celui du relais SMTP et du temps passé à traiter les alertes et les demandes d'augmentation de quota.

## Méthode 1 : Configuration via la Console Gestionnaire de ressources du serveur de fichiers (fsrm.msc)

### Installation du Rôle

1. Ouvrez le **Gestionnaire de serveur** > **Gérer** > **Ajouter des rôles et fonctionnalités**.
2. Dans **Rôles de serveurs**, développez **Services de fichiers et de stockage** > **Services de fichiers et iSCSI**, puis cochez **Gestionnaire de ressources du serveur de fichiers**.
3. Acceptez l'ajout des outils de gestion et terminez l'assistant. Aucun redémarrage n'est nécessaire.

### Configuration des Options Générales

1. Ouvrez `fsrm.msc`, faites un clic droit sur **Gestionnaire de ressources du serveur de fichiers (local)** > **Configurer les options**.
2. Onglet **Notifications par courrier électronique** :
   - **Nom du serveur SMTP ou adresse IP :** `smtp.lab.local` ;
   - **Destinataires administrateurs par défaut :** `admin-stockage@lab.local` ;
   - **Adresse « De » par défaut :** `fsrm-srv-fic-01@lab.local`.
3. Cliquez sur **Envoyer un message de test** et vérifiez la réception.
4. Onglet **Limites de notification** : conservez 60 minutes pour chaque type, ou augmentez la valeur sur un serveur très sollicité.
5. Onglet **Audit du filtrage des fichiers** : cochez **Enregistrer l'activité de filtrage des fichiers dans la base de données d'audit**, nécessaire aux rapports d'audit de filtrage.

### Création des Modèles de Quotas

1. Développez **Gestion de quota** > **Modèles de quotas**, puis **Créer un modèle de quota**.
2. Premier modèle, pour les dossiers personnels :
   - **Nom du modèle :** `QT-Utilisateur-5Go-Strict` ;
   - **Limite d'espace :** 5 Go ;
   - **Quota inconditionnel (strict) :** sélectionné.
3. Dans **Seuils de notification**, cliquez sur **Ajouter** :
   - Seuil **85 %**, onglet **Message électronique** : cochez l'envoi à l'administrateur et à l'utilisateur ayant dépassé le seuil, puis rédigez le message avec les variables `[Quota Path]` et `[Quota Threshold]` ;
   - Seuil **100 %**, onglets **Message électronique** et **Journal des événements** (type Avertissement), et onglet **Rapport** avec le rapport **Fichiers volumineux** envoyé à l'administrateur.
4. Second modèle, pour les dossiers d'équipe :
   - **Nom du modèle :** `QT-Equipe-200Go-Souple` ;
   - **Limite d'espace :** 200 Go ;
   - **Quota conditionnel (souple)** sélectionné, avec seuils à 90 % et 100 % notifiant l'administrateur.

<div class="callout callout-note">

Préférez des modèles personnalisés aux modèles fournis. Leur nom porte la convention maison et leur modification n'affecte pas les autres serveurs qui utiliseraient les modèles par défaut.

</div>

### Application des Quotas

1. Dans **Gestion de quota** > **Quotas**, cliquez sur **Créer un quota**.
2. Pour les dossiers personnels :
   - **Chemin d'accès du quota :** `D:\Partages\Utilisateurs` ;
   - sélectionnez **Appliquer automatiquement le modèle et créer des quotas sur les sous-dossiers existants et nouveaux** ;
   - **Dériver les propriétés de ce modèle de quota :** `QT-Utilisateur-5Go-Strict`.
3. Pour le dossier d'équipe :
   - **Chemin d'accès du quota :** `D:\Partages\Commun` ;
   - sélectionnez **Créer un quota sur le chemin d'accès** et dérivez de `QT-Equipe-200Go-Souple`.
4. Vérifiez dans la liste que chaque sous-dossier de `D:\Partages\Utilisateurs` dispose d'un quota dérivé.

### Création des Groupes de Fichiers

1. Développez **Gestion du filtrage de fichiers** > **Groupes de fichiers** > **Créer un groupe de fichiers**.
2. Groupe `FG-Multimedia` :
   - **Fichiers à inclure :** `*.mp3`, `*.mp4`, `*.mkv`, `*.avi`, `*.mov`, `*.flac`, `*.wav`.
3. Groupe `FG-Executables` :
   - **Fichiers à inclure :** `*.exe`, `*.msi`, `*.com`, `*.scr`, `*.bat`, `*.cmd`, `*.ps1`, `*.vbs` ;
   - **Fichiers à exclure :** laissez vide, les exceptions seront gérées par dossier.
4. Groupe `FG-Images-Disque` :
   - **Fichiers à inclure :** `*.iso`, `*.vhd`, `*.vhdx`, `*.vmdk`.

### Création des Filtres de Fichiers

1. Dans **Modèles de filtres de fichiers**, cliquez sur **Créer un modèle de filtre de fichiers** :
   - **Nom :** `FS-Partages-Actif` ;
   - **Type de filtrage :** **Filtrage actif** ;
   - **Groupes de fichiers :** `FG-Multimedia`, `FG-Executables`, `FG-Images-Disque` ;
   - onglet **Message électronique** : notifier l'administrateur et l'utilisateur avec `[Source File Path]` et `[Violated File Group]` ;
   - onglet **Journal des événements** : type Avertissement.
2. Créez de la même façon `FS-Partages-Passif` en **Filtrage passif**, avec les mêmes groupes, notification par journal des événements uniquement.
3. Dans **Filtres de fichiers**, cliquez sur **Créer un filtre de fichiers** :
   - commencez par **Chemin d'accès :** `D:\Partages` dérivé de `FS-Partages-Passif` ;
   - après une à deux semaines d'observation et d'ajustement, modifiez le filtre pour le dériver de `FS-Partages-Actif`.

### Création d'une Exception

1. Dans **Filtres de fichiers**, cliquez sur **Créer une exception de filtre de fichiers**.
2. **Chemin d'accès de l'exception :** `D:\Partages\Commun\Logiciels`.
3. **Groupes de fichiers autorisés :** `FG-Executables`.

### Planification des Rapports de Stockage

1. Développez **Gestion des rapports de stockage** > **Planifier une nouvelle tâche de rapport**.
2. Onglet **Paramètres** :
   - **Nom :** `RPT-Mensuel-Partages` ;
   - **Étendue :** ajoutez `D:\Partages` ;
   - **Rapports :** **Fichiers volumineux**, **Fichiers en double**, **Fichiers les moins récemment utilisés**, **Utilisation des quotas** et **Audit du filtrage des fichiers** ;
   - **Formats :** DHTML et CSV.
3. Onglet **Remise** : cochez l'envoi à `admin-stockage@lab.local`.
4. Onglet **Planification** : mensuelle, le 1er du mois à 02:00.
5. Pour un contrôle immédiat, utilisez **Générer les rapports maintenant**. Les rapports sont enregistrés par défaut sous `C:\StorageReports`.

### Gestion de la Classification

La branche **Gestion de la classification** permet de définir des propriétés de classification (confidentialité, service, durée de conservation) et des règles qui les attribuent automatiquement selon l'emplacement ou le contenu. Les **Tâches de gestion de fichiers** exploitent ensuite ces propriétés pour expirer, chiffrer ou traiter les fichiers par commande personnalisée. Ces fonctions alimentent aussi le Contrôle d'accès dynamique. Elles font l'objet d'un déploiement distinct, à concevoir avec les métiers et le responsable de la sécurité des données.

## Méthode 2 : Configuration via PowerShell

### Installation et Options Générales

```powershell
Install-WindowsFeature -Name FS-Resource-Manager -IncludeManagementTools

Set-FsrmSetting -SmtpServer "smtp.lab.local" `
    -FromEmailAddress "fsrm-srv-fic-01@lab.local" `
    -AdminEmailAddress "admin-stockage@lab.local"

Send-FsrmTestEmail -ToEmailAddress "admin-stockage@lab.local" -Confirm:$false
```

### Création des Modèles de Quotas

```powershell
# Actions de notification
$mail85 = New-FsrmAction -Type Email -MailTo "[Admin Email];[Source Io Owner Email]" `
    -Subject "Quota à 85 % sur [Quota Path]" `
    -Body "Le dossier [Quota Path] a atteint [Quota Threshold] % de son quota. Libérez de l'espace ou contactez le support." `
    -RunLimitInterval 120

$mail100 = New-FsrmAction -Type Email -MailTo "[Admin Email];[Source Io Owner Email]" `
    -Subject "Quota atteint sur [Quota Path]" `
    -Body "Le quota du dossier [Quota Path] est atteint. Les nouvelles écritures sont refusées." `
    -RunLimitInterval 60

$evt100 = New-FsrmAction -Type Event -EventType Warning `
    -Body "Quota atteint sur [Quota Path] par [Source Io Owner]." -RunLimitInterval 60

$rpt100 = New-FsrmAction -Type Report -ReportTypes LargeFiles

# Seuils
$s85  = New-FsrmQuotaThreshold -Percentage 85 -Action $mail85
$s100 = New-FsrmQuotaThreshold -Percentage 100 -Action $mail100, $evt100, $rpt100

# Modèle strict pour les dossiers personnels
New-FsrmQuotaTemplate -Name "QT-Utilisateur-5Go-Strict" -Size 5GB -Threshold $s85, $s100

# Modèle souple pour les dossiers d'équipe
$mailAdm = New-FsrmAction -Type Email -MailTo "[Admin Email]" `
    -Subject "Quota souple [Quota Threshold] % sur [Quota Path]" `
    -Body "Le dossier [Quota Path] a atteint [Quota Threshold] % de sa limite de surveillance."
$s90  = New-FsrmQuotaThreshold -Percentage 90 -Action $mailAdm
$s100b = New-FsrmQuotaThreshold -Percentage 100 -Action $mailAdm
New-FsrmQuotaTemplate -Name "QT-Equipe-200Go-Souple" -Size 200GB -SoftLimit -Threshold $s90, $s100b
```

<div class="callout callout-note">

Le paramètre `-ReportTypes` accepte notamment `LargeFiles`, `DuplicateFiles`, `FilesByOwner` et `QuotaUsage`. Les paramètres `-MailTo`, `-Subject` et `-Body` ne s'emploient qu'avec une action de type `Email` (et `-Body` aussi avec `Event`). Les rapports déclenchés par un seuil sont déposés sous `C:\StorageReports\Incident`, et leur envoi aux administrateurs se règle dans l'onglet **Rapport** du seuil dans la console.

</div>

### Application des Quotas

```powershell
# Quota appliqué automatiquement aux dossiers personnels existants et futurs
New-FsrmAutoQuota -Path "D:\Partages\Utilisateurs" -Template "QT-Utilisateur-5Go-Strict"

# Quota souple sur le dossier d'équipe
New-FsrmQuota -Path "D:\Partages\Commun" -Template "QT-Equipe-200Go-Souple"

# Modification ultérieure d'un modèle, propagée à tous les quotas dérivés
Set-FsrmQuotaTemplate -Name "QT-Utilisateur-5Go-Strict" -Size 8GB -UpdateDerived
```

### Création des Groupes de Fichiers et des Filtres

```powershell
New-FsrmFileGroup -Name "FG-Multimedia" -IncludePattern @("*.mp3","*.mp4","*.mkv","*.avi","*.mov","*.flac","*.wav")
New-FsrmFileGroup -Name "FG-Executables" -IncludePattern @("*.exe","*.msi","*.com","*.scr","*.bat","*.cmd","*.ps1","*.vbs")
New-FsrmFileGroup -Name "FG-Images-Disque" -IncludePattern @("*.iso","*.vhd","*.vhdx","*.vmdk")

$groupes = @("FG-Multimedia","FG-Executables","FG-Images-Disque")

$notifMail = New-FsrmAction -Type Email -MailTo "[Admin Email];[Source Io Owner Email]" `
    -Subject "Fichier refusé sur SRV-FIC-01" `
    -Body "L'enregistrement de [Source File Path] a été refusé (groupe [Violated File Group])." `
    -RunLimitInterval 120
$notifEvt = New-FsrmAction -Type Event -EventType Warning `
    -Body "[Source Io Owner] a tenté d'enregistrer [Source File Path] (groupe [Violated File Group])."

# Modèle actif (bloquant) et modèle passif (surveillance seule)
New-FsrmFileScreenTemplate -Name "FS-Partages-Actif" -IncludeGroup $groupes -Notification $notifMail, $notifEvt -Active
New-FsrmFileScreenTemplate -Name "FS-Partages-Passif" -IncludeGroup $groupes -Notification $notifEvt

# Phase d'observation : filtre passif
New-FsrmFileScreen -Path "D:\Partages" -Template "FS-Partages-Passif"

# Exception pour le dépôt de logiciels
New-FsrmFileScreenException -Path "D:\Partages\Commun\Logiciels" -IncludeGroup "FG-Executables"
```

### Passage du Filtre en Mode Actif

```powershell
# Après la période d'observation
Set-FsrmFileScreen -Path "D:\Partages" -Template "FS-Partages-Actif"
Get-FsrmFileScreen -Path "D:\Partages" | Select-Object Path, Template, Active
```

### Planification des Rapports de Stockage

```powershell
$planif = New-FsrmScheduledTask -Time (Get-Date "02:00") -Monthly 1

New-FsrmStorageReport -Name "RPT-Mensuel-Partages" -Namespace @("D:\Partages") `
    -ReportType @("LargeFiles","DuplicateFiles","LeastRecentlyAccessed","QuotaUsage","FileScreenAuditFiles") `
    -ReportFormat @("DHtml","Csv") -LargeFileMinimum 500MB -LeastAccessedMinimum 365 `
    -MailTo "admin-stockage@lab.local" -Schedule $planif

# Rapport immédiat, enregistré sous C:\StorageReports\Interactive
New-FsrmStorageReport -Name "RPT-Ponctuel-GrosFichiers" -Namespace @("D:\Partages") `
    -ReportType @("LargeFiles") -LargeFileMinimum 1GB -Interactive
```

## Vérifications

**Paramètres :** `Get-FsrmSetting` affiche le serveur SMTP et les adresses configurées. Le message de test est reçu.

**Quotas :** `Get-FsrmAutoQuota` liste `D:\Partages\Utilisateurs` et son modèle. `Get-FsrmQuota | Select-Object Path, Template, Size, Usage, SoftLimit` affiche un quota par dossier utilisateur et le quota souple de `D:\Partages\Commun`.

**Quota strict :** connecté avec un compte de test, copiez dans son dossier personnel des fichiers dépassant 5 Go. La copie échoue avec une erreur d'espace insuffisant, le message de 100 % est reçu et un événement **SRMSVC** de niveau Avertissement apparaît dans le journal **Application**.

**Filtre passif :** copiez un fichier `test.mp3` dans `D:\Partages\Commun`. La copie réussit et un événement d'avertissement SRMSVC est journalisé.

**Filtre actif :** après bascule, la même copie est refusée avec un message d'accès refusé. Une copie de `setup.exe` dans `D:\Partages\Commun\Logiciels` réussit grâce à l'exception.

**Rapports :** `Start-FsrmStorageReport -Name "RPT-Mensuel-Partages"` génère les rapports sous `C:\StorageReports\Scheduled` et les envoie par courrier.

## Dépannage

**« Aucun courrier de notification n'est reçu » :** testez avec `Send-FsrmTestEmail`. Si le test échoue, vérifiez la résolution DNS de `smtp.lab.local`, l'ouverture du port 25 depuis SRV-FIC-01 et l'autorisation de relais anonyme pour l'adresse 192.168.10.30. Si le relais exige TLS ou une authentification, FSRM ne peut pas l'utiliser directement. Contrôlez aussi les limites de notification, qui suppriment les messages répétés pendant l'intervalle configuré.

**« Impossible de créer un quota ou un filtre sur le volume » :** vérifiez le système de fichiers avec `Get-Volume -DriveLetter D`. FSRM ne gère que NTFS. Un volume ReFS doit être migré vers NTFS pour utiliser FSRM.

**« L'espace disponible affiché ne correspond pas à la limite du quota » :** un quota parent plus restrictif s'applique. Dans `fsrm.msc`, sélectionnez le quota puis **Afficher les quotas affectant le dossier** pour identifier le quota limitant.

**« Les utilisateurs ne peuvent plus enregistrer de documents Office » :** un groupe de fichiers inclut `*.tmp` ou un modèle trop large. Retirez ces extensions des groupes utilisés par le filtre actif, ou repassez le filtre en mode passif le temps de l'analyse.

**« Les nouveaux dossiers utilisateurs n'ont pas de quota » :** le quota a été créé sur le chemin au lieu d'un quota appliqué automatiquement. Supprimez-le et recréez-le avec `New-FsrmAutoQuota`. Pour aligner les quotas existants sur le modèle, utilisez `Set-FsrmAutoQuota -Path "D:\Partages\Utilisateurs" -Template "QT-Utilisateur-5Go-Strict" -UpdateDerived`.

**« La console FSRM renvoie Accès refusé ou le service ne démarre pas » :** la configuration stockée sous `<volume>\System Volume Information\SRM` est corrompue ou ses autorisations sont altérées. Consultez le journal **Application** (source SRMSVC), sauvegardez la configuration, puis suivez la procédure Microsoft de réparation des autorisations ou de réenregistrement du service avant de reconfigurer.

## Conseils et Bonnes Pratiques

**Commencer en mode souple et passif.** Appliquez d'abord des quotas souples et des filtres passifs pendant une à deux semaines. Analysez les rapports et les événements, ajustez les limites et les groupes, puis basculez en strict et actif.

**Piloter par modèles, jamais par quotas isolés.** Toute modification se fait sur le modèle avec `-UpdateDerived` ou `-UpdateDerivedMatching`. Un quota modifié manuellement sort de la gouvernance et sera oublié.

**Exporter la configuration.** Les modèles s'exportent avec `dirquota template export` et `filescrn template export`. Conservez ces fichiers XML dans le référentiel de configuration et importez-les sur chaque nouveau serveur de fichiers ou membre DFS-R pour garantir des règles identiques.

**Doser les notifications.** Utilisez `-RunLimitInterval` et les limites globales pour éviter les tempêtes de messages. Réservez le courrier aux utilisateurs pour les quotas personnels, et le journal des événements, transféré vers un collecteur ou un SIEM, pour l'exploitation.

**Utiliser un filtre passif comme détecteur de rançongiciel.** Un groupe de fichiers contenant des extensions et des noms de notes de rançon connus, associé à un filtre passif et à une action **Commande** qui alerte l'équipe de sécurité, fournit un signal précoce. Maintenez la liste à jour et ne la considérez pas comme une protection suffisante.

**Exclure les dossiers techniques.** Ne posez ni quota ni filtre sur `DfsrPrivate`, sur les dossiers de profils itinérants en cours de synchronisation ou sur les dossiers applicatifs dont vous ne maîtrisez pas les extensions.

**Documenter chaque exception.** Une exception de filtre ou une augmentation de quota doit être tracée avec un numéro de ticket et une date de revue. Une revue semestrielle évite l'accumulation d'exceptions obsolètes.

## Procédures Liées

- [Mise en Place d'un Serveur de Fichiers avec Partages et Sécurité NTFS](/procedures/windows/mise-en-place-dun-serveur-de-fichiers-avec-partages-et-securite-ntfs) *(Arborescence et ACL des partages gouvernés)*
- [Déploiement de DFS Namespaces et DFS Replication](/procedures/windows/deploiement-de-dfs-namespaces-et-dfs-replication) *(Alignement des quotas et filtres entre membres)*
- [Configuration des Storage Spaces et de la Déduplication](/procedures/windows/configuration-des-storage-spaces-et-de-la-deduplication) *(Choix NTFS ou ReFS du volume de données)*
- [Supervision avec l'Analyseur de Performances et le Transfert d'Événements](/procedures/windows/supervision-avec-lanalyseur-de-performances-et-le-transfert-devenements) *(Centralisation des événements SRMSVC)*
- [Déploiement de Windows Admin Center](/procedures/windows/deploiement-de-windows-admin-center) *(Administration à distance du serveur de fichiers)*
