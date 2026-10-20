---
modele: "procedure"
titre: "Durcissement de Windows Server avec OSConfig et Credential Guard"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-SEC-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit le durcissement des serveurs Windows Server 2025 du domaine `lab.local` avec deux outils complémentaires. **OSConfig** applique la ligne de base de sécurité Microsoft adaptée au rôle du serveur et la protège contre la dérive. **Credential Guard** isole les secrets d'authentification dans un environnement protégé par la sécurité basée sur la virtualisation (VBS).

Le périmètre couvre l'installation du module PowerShell `Microsoft.OSConfig`, l'application, la vérification, la personnalisation et le retrait des scénarios de ligne de base, la vérification et la configuration de Credential Guard, et l'alternative par GPO avec le Security Compliance Toolkit. L'application à grande échelle par Azure Policy et Azure Arc est mentionnée sans être détaillée.

## Contexte et Justification

Une installation par défaut de Windows Server privilégie la compatibilité. Plusieurs centaines de paramètres restent dans un état permissif : protocoles hérités actifs, audit incomplet, signature SMB facultative, comptes locaux utilisables à distance. Configurer ces paramètres un par un est long, source d'erreurs et difficile à maintenir.

Les lignes de base Microsoft répondent à ce besoin en fournissant un ensemble cohérent et testé de paramètres. Sur Windows Server 2025, OSConfig apporte deux avantages par rapport à une simple GPO :

- **Adaptation au rôle :** une ligne de base distincte pour contrôleur de domaine, serveur membre et serveur de groupe de travail.
- **Contrôle de dérive :** OSConfig rétablit automatiquement les paramètres modifiés localement.

Credential Guard complète ce socle. Même avec une ligne de base appliquée, un attaquant administrateur local peut lire la mémoire de LSASS pour extraire empreintes NTLM et tickets Kerberos. Credential Guard déplace ces secrets dans le processus isolé `LsaIso.exe`, inaccessible au système d'exploitation, ce qui neutralise les outils de vol d'identifiants classiques.

## Concepts Clés

**OSConfig.** Agent de gestion de la configuration de sécurité intégré à Windows Server 2025. Il est piloté localement par le module PowerShell `Microsoft.OSConfig`, distribué sur PowerShell Gallery, ou à grande échelle par Azure Policy Machine Configuration via Azure Arc. OSConfig ne prend pas en charge les versions antérieures à Windows Server 2025.

**Scénario.** Ensemble de paramètres identifié par un nom. Les scénarios de ligne de base suivent la forme `SecurityBaseline/WindowsServer/2025/<Rôle>` :

| Rôle du serveur | Scénario |
|-----------------|----------|
| Contrôleur de domaine | `SecurityBaseline/WindowsServer/2025/DomainController` |
| Serveur membre | `SecurityBaseline/WindowsServer/2025/MemberServer` |
| Serveur de groupe de travail | `SecurityBaseline/WindowsServer/2025/WorkgroupMember` |

: Scénarios de ligne de base OSConfig

Des scénarios complémentaires existent : `SecuredCore`, `Defender/Antivirus/WindowsServer/2025` et `LAPS/WindowsServer/2025/MemberServer`.

**Versionnement.** La ligne de base est livrée dans le module. Mettre à jour le module puis réappliquer le scénario installe la nouvelle version complète, qui remplace la précédente.

**Dérive.** Écart entre l'état réel et l'état souhaité. OSConfig corrige automatiquement la dérive sur les paramètres qu'il gère. Si une autre source (GPO, script, Intune) impose une valeur différente, les deux sources se contredisent en boucle.

**VBS (Virtualization-Based Security).** Utilise l'hyperviseur Windows pour créer une zone mémoire isolée du noyau. Credential Guard, l'intégrité du code protégée par l'hyperviseur (HVCI) et la protection des comptes machine reposent sur VBS.

**Credential Guard.** Protège les empreintes NTLM, les TGT Kerberos et les identifiants de domaine stockés. Il ne protège ni la base Active Directory d'un contrôleur de domaine, ni les comptes locaux, ni les tickets de service Kerberos. Lorsqu'il est actif, NTLMv1, MS-CHAPv2, Digest et CredSSP ne peuvent plus utiliser les identifiants de session, et Kerberos refuse la délégation non contrainte et DES.

**Activation par défaut sur Windows Server 2025.** Credential Guard est activé par défaut, sans verrou UEFI, sur un serveur Windows Server 2025 qui remplit simultanément ces conditions :

- matériel et logiciel compatibles avec VBS ;
- serveur joint à un domaine ;
- serveur qui **n'est pas** contrôleur de domaine ;
- Credential Guard non désactivé explicitement avant la mise à niveau.

Sur SRV-DC-01 et SRV-DC-02, Credential Guard n'est donc **pas** activé par défaut.

**Verrou UEFI.** Mode d'activation qui enregistre la configuration dans une variable UEFI. Credential Guard ne peut alors plus être désactivé par simple modification de registre ou de GPO.

## Prérequis

- Des serveurs sous **Windows Server 2025** : contrôleurs SRV-DC-01 et SRV-DC-02, serveurs membres SRV-APP-01, SRV-APP-02, etc.
- Une session PowerShell élevée sur chaque serveur ciblé, ou un accès PowerShell Remoting.
- Un accès à PowerShell Gallery depuis les serveurs, ou un partage interne (`\\SRV-APP-01\Modules`) pour l'installation hors ligne.
- Pour Credential Guard : processeur 64 bits avec extensions de virtualisation et SLAT, UEFI avec Secure Boot. Un TPM 2.0 est recommandé.
- Pour les machines virtuelles Hyper-V : VM de **génération 2** et hôte disposant d'une IOMMU. Credential Guard n'est pas pris en charge sur les VM de génération 1.
- Pour l'alternative GPO : la console GPMC (`gpmc.msc`) et le package **Windows Server 2025 Security Baseline** du Security Compliance Toolkit, téléchargé depuis le Centre de téléchargement Microsoft.
- Un serveur de test par rôle et un instantané ou une sauvegarde avant application.

## Points de Vigilance

**Une ligne de base appliquée change le comportement du serveur.** Microsoft liste notamment les effets suivants :

- le mot de passe administrateur local doit être changé après application sur un serveur membre ou de groupe de travail (14 caractères minimum avec complexité) ;
- TLS est limité à la version 1.2 ou supérieure, ce qui peut couper des connexions vers d'anciens systèmes ;
- SMB 3.0 minimum est exigé, ce qui peut bloquer des serveurs Samba anciens ou des NAS ;
- la redirection des lecteurs en RDP (copier-coller de fichiers) est désactivée ;
- le verrouillage de compte intervient après trois échecs pendant 15 minutes.

Testez chaque rôle sur un serveur de préproduction avant toute généralisation.

**Ne combinez pas OSConfig et une GPO sur les mêmes paramètres.** Avec le contrôle de dérive, deux sources qui imposent des valeurs différentes provoquent des changements permanents. Choisissez une source par paramètre. Si la ligne de base SCT est déjà déployée par GPO, n'appliquez pas en plus le scénario OSConfig équivalent sur les mêmes serveurs.

**Un redémarrage est nécessaire.** L'application et le retrait d'une ligne de base OSConfig exigent un redémarrage. La personnalisation peut en exiger un selon le paramètre modifié.

**Le retrait ne garantit pas le retour à l'état initial.** `Remove-OSConfigDesiredConfiguration` arrête la gestion, mais ne restaure pas forcément les valeurs d'origine. Conservez un instantané ou un export de la configuration avant application.

**Credential Guard casse certains usages.** La migration dynamique Hyper-V qui repose sur la délégation CredSSP échoue lorsque l'hôte source a Credential Guard actif. Utilisez la délégation Kerberos contrainte. L'authentification unique via MS-CHAPv2 (PEAP-MSCHAPv2, certains VPN et Wi-Fi), WDigest et NTLMv1 ne fonctionne plus et une saisie manuelle des identifiants est demandée.

**Credential Guard n'est pas recommandé sur les contrôleurs de domaine.** Il ne protège pas la base `NTDS.dit` et n'apporte pas de protection supplémentaire pertinente sur un DC. Le scénario OSConfig DomainController gère le durcissement des DC sans dépendre de Credential Guard.

**Le verrou UEFI complique le retour arrière.** Avec **Enabled with UEFI lock**, la désactivation exige une procédure locale avec accès console au démarrage. Préférez **Enabled without lock** pendant la phase de test.

**La protection des comptes machine par Credential Guard est suspendue.** Depuis la mise à jour d'avril 2025 (KB5055523), la fonctionnalité Credential Guard protected machine accounts est temporairement désactivée sur Windows Server 2025 en raison d'un problème de rotation du mot de passe machine. Ne l'activez pas avant confirmation du correctif par Microsoft.

**Retraits et dépréciations à prendre en compte.** NTLMv1 et DES sont retirés de Windows Server 2025, TLS 1.0 et 1.1 y sont désactivés par défaut, et RC4 pour Kerberos est déprécié. Une ligne de base appliquée met en évidence plus rapidement les applications qui en dépendent encore.

## Choix Architecturaux & Alternatives

### Quand choisir OSConfig et Credential Guard

OSConfig est le choix privilégié pour des serveurs Windows Server 2025, qu'ils soient joints à un domaine ou non, lorsqu'on souhaite une ligne de base adaptée au rôle et protégée contre la dérive. Il convient particulièrement aux serveurs gérés via Azure Arc, car la même ligne de base peut alors être suivie dans Azure Policy.

La GPO alimentée par le Security Compliance Toolkit reste pertinente pour un parc mixte (Windows Server 2019, 2022 et 2025) que l'on veut gérer de façon homogène, ou pour une équipe qui pilote déjà toute sa configuration par GPO.

Credential Guard doit rester actif sur tous les serveurs membres Windows Server 2025 compatibles. Il ne se désactive que pour un besoin identifié (migration dynamique CredSSP non migrable, dépendance MS-CHAPv2) et après analyse du risque.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **OSConfig (local, PowerShell)** | Serveurs Windows Server 2025, lab et petites flottes | Ligne de base par rôle, contrôle de dérive | Windows Server 2025 uniquement, application serveur par serveur | Gratuit |
| **OSConfig via Azure Arc et Azure Policy** | Flotte hybride à grande échelle | Conformité centralisée, rapports dans Azure | Dépendance à Azure Arc, configuration initiale | Faible à Moyen |
| **GPO issue du Security Compliance Toolkit** | Parc AD multi-versions | Natif AD, multi-versions, analyse avec Policy Analyzer | Pas de contrôle de dérive en temps réel, maintenance manuelle à chaque nouvelle ligne de base | Gratuit |
| **Benchmarks CIS (GPO ou outils CIS)** | Exigence de conformité CIS explicite | Référentiel externe reconnu | Outillage et licence CIS pour l'automatisation | Moyen |
| **Configuration manuelle** | Serveur isolé de démonstration | Aucun outil requis | Non reproductible, non auditable | Gratuit, à proscrire |

### Impact des choix

- **Sécurité.** OSConfig et la GPO SCT appliquent des paramètres très proches. La différence porte sur la persistance : OSConfig corrige une modification locale, alors qu'une GPO n'est réappliquée qu'au cycle suivant. Credential Guard ajoute une protection qu'aucune ligne de base seule ne peut fournir.
- **Disponibilité.** Une ligne de base mal testée peut couper des flux (TLS, SMB, NTLM). Le déploiement par vagues, rôle par rôle, limite ce risque.
- **Exploitation.** OSConfig impose de gérer le module PowerShell et ses versions sur chaque serveur. La GPO se gère depuis un point central mais demande un suivi des écarts avec Policy Analyzer.
- **Coût.** OSConfig local et la GPO SCT sont gratuits. Azure Arc est gratuit pour l'inventaire, mais Azure Policy Machine Configuration et les services associés peuvent être facturés pour les serveurs hors Azure.

## Méthode 1 : Configuration via la Console de Gestion des Stratégies de Groupe (gpmc.msc)

Cette méthode s'applique lorsque le durcissement est piloté par GPO. Elle remplace le scénario OSConfig sur les serveurs ciblés.

### Import de la Ligne de Base du Security Compliance Toolkit

1. Téléchargez le package **Windows Server 2025 Security Baseline** du Security Compliance Toolkit et extrayez-le sur SRV-DC-01, par exemple dans `C:\Baselines\WS2025`.
2. Ouvrez `gpmc.msc` et créez dans **Group Policy Objects** une GPO vide nommée `GPO-SEC-Baseline-WS2025-MemberServer`.
3. Faites un clic droit sur la GPO > **Import Settings**, puis suivez l'assistant.
4. À l'étape **Backup Location**, sélectionnez le dossier `GPOs` du package extrait.
5. À l'étape **Source GPO**, sélectionnez la GPO de ligne de base **Member Server** de Windows Server 2025.
6. Terminez l'assistant. Répétez l'opération pour la ligne de base **Domain Controller** dans une GPO `GPO-SEC-Baseline-WS2025-DC`.

<div class="callout callout-note">

Le package contient aussi un dossier `Scripts` avec des scripts d'import automatisés et un rapport des paramètres au format Excel. Lisez le fichier de documentation du package avant import, car certaines GPO sont prévues pour être liées en complément (par exemple les paramètres propres à Microsoft Defender Antivirus).

</div>

### Configuration de Credential Guard par GPO

1. Créez une GPO `GPO-SEC-CredentialGuard-V1`, puis faites un clic droit > **Edit**.
2. Naviguez jusqu'à **Computer Configuration > Policies > Administrative Templates > System > Device Guard**.
3. Ouvrez **Turn On Virtualization Based Security** et sélectionnez **Enabled**.
4. Renseignez les options :
   - **Select Platform Security Level :** **Secure Boot** (ou **Secure Boot and DMA Protection** si le matériel le permet) ;
   - **Credential Guard Configuration :** **Enabled without lock** pendant la phase de test, **Enabled with UEFI lock** en production ;
   - **Machine Identity Isolation Configuration :** **Not Configured** tant que la fonctionnalité reste suspendue sur Windows Server 2025.
5. Validez avec **OK**.

### Liaison des GPO

1. Liez `GPO-SEC-Baseline-WS2025-MemberServer` et `GPO-SEC-CredentialGuard-V1` à `OU=Serveurs,DC=lab,DC=local`.
2. Liez `GPO-SEC-Baseline-WS2025-DC` à l'OU **Domain Controllers**.
3. Sur un serveur de test, exécutez `gpupdate /force`, puis redémarrez-le pour activer VBS.

<div class="callout callout-note">

Ne liez pas la GPO Credential Guard à l'OU **Domain Controllers**. Pour empêcher toute activation sur les DC, un paramètre **Disabled** peut être appliqué par une GPO dédiée liée à cette OU.

</div>

## Méthode 2 : Configuration via PowerShell

### Installation du Module OSConfig

Sur chaque serveur Windows Server 2025, dans une session PowerShell élevée :

```powershell
Install-Module -Name Microsoft.OSConfig -Scope AllUsers -Force
Get-Module -ListAvailable -Name Microsoft.OSConfig
```

Si le serveur n'a pas accès à PowerShell Gallery, préparez le module depuis un poste connecté puis importez-le :

```powershell
# Sur un poste connecté
Save-Module -Name Microsoft.OSConfig -Path "\\SRV-APP-01\Modules"

# Sur le serveur cible
Import-Module "\\SRV-APP-01\Modules\Microsoft.OSConfig\*\Microsoft.OSConfig.psd1"
```

### Application de la Ligne de Base selon le Rôle

```powershell
# Serveur membre (SRV-APP-01, SRV-APP-02...)
Set-OSConfigDesiredConfiguration -Scenario SecurityBaseline/WindowsServer/2025/MemberServer -Default

# Contrôleur de domaine (SRV-DC-01, SRV-DC-02)
Set-OSConfigDesiredConfiguration -Scenario SecurityBaseline/WindowsServer/2025/DomainController -Default

# Compléments optionnels
Set-OSConfigDesiredConfiguration -Scenario Defender/Antivirus/WindowsServer/2025 -Default
Set-OSConfigDesiredConfiguration -Scenario SecuredCore -Default
```

Redémarrez ensuite le serveur :

```powershell
Restart-Computer
```

<div class="callout callout-note">

Appliquez la ligne de base SRV-DC-01 et SRV-DC-02 l'un après l'autre, en contrôlant la réplication et l'authentification entre les deux, pour ne jamais perdre les deux contrôleurs en même temps.

</div>

### Contrôle de Conformité

```powershell
Get-OSConfigDesiredConfiguration -Scenario SecurityBaseline/WindowsServer/2025/MemberServer |
    Format-Table Name,
        @{ Name = "Status"; Expression = { $_.Compliance.Status } },
        @{ Name = "Reason"; Expression = { $_.Compliance.Reason } } -AutoSize -Wrap
```

### Personnalisation d'un Paramètre

L'exemple suivant réactive la redirection des lecteurs en RDP sur un serveur membre, puis vérifie la valeur appliquée. Le contrôle de dérive s'applique à la nouvelle valeur.

```powershell
Set-OSConfigDesiredConfiguration -Scenario SecurityBaseline/WindowsServer/2025/MemberServer `
    -Setting RemoteDesktopServicesDoNotAllowDriveRedirection -Value 0

Get-OSConfigDesiredConfiguration -Scenario SecurityBaseline/WindowsServer/2025/MemberServer `
    -Setting RemoteDesktopServicesDoNotAllowDriveRedirection
```

### Mise à Jour de la Ligne de Base

```powershell
Update-Module -Name Microsoft.OSConfig
Set-OSConfigDesiredConfiguration -Scenario SecurityBaseline/WindowsServer/2025/MemberServer -Default
Restart-Computer
```

Si une version antérieure de la ligne de base est appliquée, OSConfig demande de la retirer avant d'installer la nouvelle. Confirmez l'invite.

### Retrait d'une Ligne de Base

```powershell
Remove-OSConfigDesiredConfiguration -Scenario SecurityBaseline/WindowsServer/2025/MemberServer
Restart-Computer
```

### Vérification de Credential Guard

```powershell
$dg = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard
$dg | Select-Object VirtualizationBasedSecurityStatus, SecurityServicesConfigured, SecurityServicesRunning
```

`VirtualizationBasedSecurityStatus` à `2` signifie que VBS est actif. La présence de la valeur `1` dans `SecurityServicesRunning` signifie que Credential Guard est en cours d'exécution.

### Activation de Credential Guard par le Registre

Sur un serveur qui ne reçoit ni GPO ni ligne de base, par exemple un serveur de groupe de travail :

```powershell
$dgKey  = "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard"
$lsaKey = "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa"

New-ItemProperty -Path $dgKey  -Name "EnableVirtualizationBasedSecurity" -PropertyType DWord -Value 1 -Force
New-ItemProperty -Path $dgKey  -Name "RequirePlatformSecurityFeatures"   -PropertyType DWord -Value 1 -Force
New-ItemProperty -Path $lsaKey -Name "LsaCfgFlags"                       -PropertyType DWord -Value 2 -Force

Restart-Computer
```

`LsaCfgFlags` à `2` active Credential Guard sans verrou UEFI, à `1` avec verrou UEFI.

## Vérifications

**Module installé :** `Get-Module -ListAvailable -Name Microsoft.OSConfig` retourne une version.

**Ligne de base conforme :** le contrôle de conformité affiche un statut **Compliant** pour la grande majorité des paramètres. Les écarts restants sont justifiés (personnalisation documentée, matériel non compatible).

**Contrôle de dérive :** modifiez localement un paramètre géré, par exemple désactivez l'audit d'un sous-ensemble avec `auditpol`, puis vérifiez après quelques minutes que la valeur de la ligne de base est rétablie.

**Credential Guard actif :** sur SRV-APP-01, `msinfo32.exe` affiche **Credential Guard** dans **Virtualization-based security Services Running**, et la requête `Win32_DeviceGuard` retourne `1` dans `SecurityServicesRunning`.

**Credential Guard absent des DC :** sur SRV-DC-01, `SecurityServicesRunning` ne contient pas `1`.

**GPO appliquées (Méthode 1) :** `gpresult /scope computer /r` sur SRV-APP-01 liste `GPO-SEC-Baseline-WS2025-MemberServer` et `GPO-SEC-CredentialGuard-V1`.

## Dépannage

**Set-OSConfigDesiredConfiguration est introuvable :** le module n'est pas chargé ou le serveur n'est pas sous Windows Server 2025. Vérifiez la version avec `Get-ComputerInfo -Property OsName` et réinstallez le module.

**Des paramètres changent sans arrêt :** une GPO et OSConfig gèrent le même paramètre avec des valeurs différentes. Identifiez la GPO avec `gpresult /h rapport.html`, puis retirez le paramètre de la GPO ou personnalisez la valeur OSConfig pour l'aligner.

**Connexion impossible vers un ancien serveur ou un NAS après application :** la cause est la restriction TLS 1.2 ou SMB 3.0. Mettez à jour l'équipement distant. En dernier recours, personnalisez le paramètre concerné et documentez l'exception.

**Message d'erreur de traduction de SID lors de l'application :** Microsoft indique que ces erreurs peuvent apparaître dans certaines configurations de domaine sans impact sur le reste de la ligne de base.

**Credential Guard configuré mais non actif :** VBS ne démarre pas. Vérifiez dans `msinfo32.exe` les lignes **Virtualization-based security** et **Secure Boot State**. Sur une VM Hyper-V, confirmez qu'il s'agit d'une génération 2 et que Secure Boot est actif.

**La migration dynamique Hyper-V échoue après mise à niveau :** l'hôte source utilise la délégation CredSSP avec Credential Guard actif. Configurez la délégation Kerberos contrainte entre les hôtes et utilisez Kerberos comme protocole d'authentification de migration.

**Un VPN ou un réseau 802.1X demande les identifiants à chaque session :** la connexion repose sur MS-CHAPv2. Migrez vers une authentification par certificat (EAP-TLS ou PEAP-TLS).

## Conseils et Bonnes Pratiques

**Appliquer le scénario correspondant au rôle réel.** Une ligne de base de serveur membre appliquée à un contrôleur de domaine, ou l'inverse, produit des paramètres inadaptés. Après une promotion ou une rétrogradation, retirez l'ancien scénario et appliquez le nouveau.

**Déployer par vagues.** Commencez par un serveur de test par rôle, puis un serveur de production peu critique, puis le reste. Laissez au moins une semaine d'observation entre les vagues.

**Documenter chaque personnalisation.** Chaque écart par rapport à la ligne de base doit être tracé avec sa justification, sa date et son responsable.

**Maintenir le module à jour.** Une nouvelle version du module apporte la dernière ligne de base. Planifiez une revue trimestrielle et une réapplication contrôlée.

**Combiner avec Windows LAPS et AppLocker.** OSConfig fournit un scénario LAPS pour les serveurs membres, et AppLocker ou App Control complètent la ligne de base en contrôlant l'exécution d'applications.

**Garder Credential Guard sans verrou UEFI pendant la validation.** Passez au verrou UEFI une fois les usages validés, pour empêcher qu'un attaquant administrateur ne le désactive par registre.

**Centraliser les journaux d'audit.** La ligne de base active un audit détaillé (création de processus avec ligne de commande, accès aux partages). Transférez ces événements vers un collecteur, faute de quoi ils ne serviront qu'en investigation locale.

## Procédures Liées

- [Installation de Windows Server 2025](/procedures/windows/installation-de-windows-server-2025) *(Serveur de base à durcir)*
- [Déploiement de Windows LAPS](/procedures/windows/deploiement-de-windows-laps) *(Gestion du mot de passe administrateur local exigée par la ligne de base)*
- [Configuration du Pare-feu Windows et des Règles de Sécurité de Connexion](/procedures/windows/configuration-du-pare-feu-windows-et-des-regles-de-securite-de-connexion) *(Règles de flux après activation du pare-feu par la ligne de base)*
- [Configuration d'AppLocker par GPO](/procedures/windows/configuration-dapplocker-par-gpo) *(Contrôle de l'exécution d'applications en complément)*
- Intégration de Serveurs avec Azure Arc *(Application d'OSConfig à grande échelle par Azure Policy)*
- [Stratégies de Mots de Passe Affinées et Groupe Protected Users](/procedures/windows/strategies-de-mots-de-passe-affinees-et-groupe-protected-users) *(Protection complémentaire des comptes à privilèges)*
