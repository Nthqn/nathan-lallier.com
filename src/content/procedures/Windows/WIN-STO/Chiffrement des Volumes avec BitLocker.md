---
modele: "procedure"
titre: "Chiffrement des Volumes avec BitLocker"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-STO-SEC"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit le chiffrement des volumes des serveurs Windows Server 2025 du domaine `lab.local` avec **BitLocker**. Elle couvre l'installation de la fonctionnalité, la vérification du TPM, l'activation du chiffrement sur le volume système et sur les volumes de données, la gestion des protecteurs de clé, la sauvegarde des mots de passe de récupération dans Active Directory, leur consultation avec la visionneuse de mots de passe de récupération, et le déverrouillage réseau (Network Unlock).

Le chiffrement des volumes partagés de cluster (CSV), BitLocker To Go et la gestion par Intune ou Microsoft Configuration Manager sortent du périmètre.

## Contexte et Justification

Un serveur dont les disques ne sont pas chiffrés expose toutes ses données à quiconque obtient un accès physique ou une copie de ses disques virtuels. Les scénarios courants sont :

- le vol d'un serveur physique ou d'un disque dans une salle technique mal protégée ;
- le retour en garantie ou la mise au rebut d'un disque qui contient encore des données ;
- la copie d'un fichier VHDX depuis un hôte Hyper-V ou un stockage partagé ;
- le démarrage du serveur sur un support externe pour lire ou modifier la base `NTDS.dit` d'un contrôleur de domaine.

BitLocker chiffre le volume entier en AES. Associé au TPM, il vérifie l'intégrité de la chaîne de démarrage avant de libérer la clé, ce qui empêche la lecture hors ligne. La sauvegarde des clés de récupération dans Active Directory garantit que l'organisation, et non le seul administrateur qui a activé le chiffrement, peut toujours récupérer les données.

## Concepts Clés

**Fonctionnalité BitLocker sur Windows Server.** BitLocker n'est pas installé par défaut sur Windows Server. La fonctionnalité s'appelle **BitLocker Drive Encryption** dans le Gestionnaire de serveur et `BitLocker` dans PowerShell. Son installation exige un redémarrage.

**TPM (Trusted Platform Module).** Puce ou composant firmware qui scelle la clé de chiffrement du volume système et ne la libère que si les mesures de démarrage sont conformes. Sur Hyper-V, une VM de génération 2 peut disposer d'un **TPM virtuel** (vTPM).

**Protecteur de clé.** Moyen de déverrouiller la clé maîtresse du volume. Un volume peut avoir plusieurs protecteurs :

| Protecteur | Usage | Remarque |
|------------|-------|----------|
| **TPM** | Volume système, déverrouillage transparent | Aucune intervention au démarrage |
| **TPM et PIN** | Volume système, authentification renforcée | PIN demandé à chaque démarrage |
| **Clé de démarrage (USB)** | Serveur sans TPM | Clé USB nécessaire au démarrage |
| **Mot de passe de récupération** | Récupération | 48 chiffres, à sauvegarder dans AD |
| **Mot de passe** | Volume de données | Saisi manuellement |
| **Déverrouillage automatique** | Volume de données | Clé stockée sur le volume système chiffré |
| **Network Unlock** | Volume système TPM et PIN | Déverrouillage automatique sur le réseau d'entreprise |

: Protecteurs de clé BitLocker

**Méthode de chiffrement.** XTS-AES 128 bits par défaut pour les volumes internes. XTS-AES 256 bits est recommandé pour les serveurs. La méthode se fixe avant le chiffrement et ne peut pas être modifiée sans déchiffrer le volume.

**Chiffrement de l'espace utilisé uniquement.** Option qui ne chiffre que les secteurs occupés. Elle accélère la mise en service d'un volume neuf, mais laisse lisibles les données supprimées avant l'activation sur un volume déjà utilisé.

**Sauvegarde dans AD DS.** Les informations de récupération sont stockées dans des objets enfants `msFVE-RecoveryInformation` de l'objet ordinateur. L'attribut `msFVE-RecoveryPassword` contient le mot de passe de récupération. Par défaut, seuls les Domain Admins peuvent les lire.

**Visionneuse de mots de passe de récupération BitLocker.** Extension de la console Utilisateurs et ordinateurs Active Directory (`dsa.msc`) qui ajoute l'onglet **BitLocker Recovery** aux objets ordinateur et la recherche **Find BitLocker Recovery Password** au niveau du domaine.

**Network Unlock.** Protecteur réseau pour les volumes système protégés par TPM et PIN. Au démarrage, le firmware UEFI obtient une adresse DHCP et envoie une requête à un serveur WDS équipé de la fonctionnalité **BitLocker Network Unlock**. Si le serveur répond, le volume est déverrouillé sans saisie du PIN. Hors du réseau d'entreprise, le PIN est demandé.

## Prérequis

- Un compte membre de **Domain Admins** pour la GPO, et administrateur local des serveurs à chiffrer.
- Des serveurs SRV-xxx-0x sous Windows Server 2025 dans `OU=Serveurs,DC=lab,DC=local`.
- Un TPM 2.0 activé dans le firmware, ou un vTPM sur une VM Hyper-V de génération 2 (paramètres de la VM > **Security** > **Enable Trusted Platform Module**).
- Un démarrage UEFI avec Secure Boot recommandé.
- La console GPMC (`gpmc.msc`) et la console `dsa.msc` sur SRV-DC-01 ou sur un poste d'administration.
- Pour Network Unlock : un serveur WDS (rôle Windows Deployment Services en service), un serveur DHCP distinct du serveur WDS, une autorité de certification ou un certificat auto-signé RSA 2048 bits, et des serveurs physiques dont le firmware UEFI prend en charge DHCP sur la première carte réseau.
- Une sauvegarde des données avant tout chiffrement d'un volume existant.

## Points de Vigilance

**Sauvegarder la clé de récupération avant de chiffrer.** Un volume chiffré dont le mot de passe de récupération est perdu est irrécupérable. Configurez la GPO de sauvegarde AD **avant** d'activer BitLocker, et vérifiez la présence de la clé dans AD avant de considérer le serveur comme terminé.

**Les volumes chiffrés avant la GPO ne sont pas sauvegardés automatiquement.** La GPO ne s'applique qu'aux protecteurs créés après son application. Pour un volume déjà chiffré, utilisez `Backup-BitLockerKeyProtector` ou `manage-bde -protectors -adbackup`.

**La méthode de chiffrement est figée.** Définissez XTS-AES 256 par GPO avant l'activation. Changer de méthode impose de déchiffrer puis de rechiffrer.

**Les mises à jour du firmware déclenchent la récupération.** Une mise à jour du BIOS ou UEFI, une modification de Secure Boot ou un changement de l'ordre de démarrage modifie les mesures du TPM. Suspendez BitLocker avant l'intervention avec `Suspend-BitLocker -RebootCount 1`.

**Le PIN au démarrage bloque les redémarrages à distance.** Sur un serveur protégé par TPM et PIN, chaque redémarrage (mises à jour mensuelles comprises) attend une saisie à la console. Network Unlock ou un protecteur TPM seul est nécessaire pour un serveur administré à distance.

**Le vTPM d'une VM est lié à son hôte.** Une VM avec vTPM déplacée vers un autre hôte Hyper-V hors d'une infrastructure protégée (Host Guardian Service) peut ne plus démarrer. Sur Azure, une VM désallouée perd les clés protégées par son TPM. Conservez systématiquement le mot de passe de récupération.

**BitLocker ne protège pas les données d'un serveur en fonctionnement.** BitLocker protège les données au repos. Une fois le serveur démarré, les données sont lisibles par tout processus autorisé. BitLocker ne remplace ni les permissions NTFS, ni le durcissement du serveur.

**Network Unlock a des exigences matérielles strictes.** La première carte réseau énumérée doit prendre en charge DHCP en UEFI natif, sans module de compatibilité (CSM). Si elle échoue, Network Unlock s'arrête et le PIN est demandé.

## Choix Architecturaux & Alternatives

### Quand choisir BitLocker

BitLocker convient à tout serveur Windows dont les disques ou les fichiers VHDX peuvent sortir du périmètre physique de confiance : serveurs en agence, salles techniques partagées, contrôleurs de domaine, hôtes Hyper-V, serveurs de fichiers. Il est natif, sans licence supplémentaire, et s'intègre à Active Directory pour la gestion des clés.

Le protecteur TPM seul est le bon compromis pour un serveur en salle sécurisée administré à distance. TPM et PIN, complété par Network Unlock, convient aux serveurs situés dans des lieux moins sûrs (agences) pour lesquels un vol de la machine entière est envisageable.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **BitLocker avec TPM et sauvegarde AD** | Serveurs Windows joints au domaine | Natif, transparent au démarrage, clés centralisées | Ne protège pas contre le vol de la machine entière démarrable | Gratuit |
| **BitLocker TPM et PIN avec Network Unlock** | Serveurs physiques en site peu sécurisé | Protection contre le vol de la machine, redémarrage automatique sur le LAN | Infrastructure WDS, DHCP et certificat, matériel UEFI compatible | Faible |
| **Chiffrement du stockage (SED, baie, SAN)** | Stockage centralisé, disques auto-chiffrants | Aucun impact sur l'OS, performances matérielles | Ne protège pas un VHDX copié depuis l'hôte | Moyen à Élevé |
| **Chiffrement de l'hyperviseur (VM chiffrées, Azure Disk Encryption, chiffrement côté hôte)** | VM hébergées | Gestion centralisée par l'hyperviseur | Dépend de la plateforme, clés gérées hors du domaine | Moyen |
| **EFS (Encrypting File System)** | Chiffrement de fichiers ciblés | Granularité par fichier | Ne chiffre pas le volume système ni les métadonnées | Gratuit |

### Impact des choix

- **Sécurité.** XTS-AES 256 et la sauvegarde AD obligatoire avant chiffrement assurent à la fois la confidentialité et la récupérabilité. Ajouter un PIN protège contre le vol de la machine complète.
- **Disponibilité.** Un TPM seul n'ajoute aucune intervention au redémarrage. Un PIN sans Network Unlock rend les redémarrages planifiés dépendants d'une présence physique ou d'une console distante.
- **Performance.** Sur un processeur avec AES-NI, l'impact en fonctionnement est faible. Le chiffrement initial consomme des ressources disque et processeur pendant plusieurs heures sur un gros volume.
- **Exploitation.** La sauvegarde AD et la visionneuse centralisent la récupération. Les interventions sur le firmware doivent intégrer la suspension de BitLocker.
- **Coût.** Aucune licence. Network Unlock requiert un serveur WDS et un certificat.

## Méthode 1 : Configuration via la Console de Gestion des Stratégies de Groupe (gpmc.msc) et le Gestionnaire de serveur

### Création de la GPO BitLocker

1. Ouvrez `gpmc.msc` et créez une GPO `GPO-SEC-BitLocker-Serveurs-V1`.
2. Faites un clic droit > **Edit**, puis naviguez jusqu'à **Computer Configuration > Policies > Administrative Templates > Windows Components > BitLocker Drive Encryption**.
3. Ouvrez **Choose drive encryption method and cipher strength (Windows 10 [Version 1511] and later)**, sélectionnez **Enabled** et choisissez **XTS-AES 256-bit** pour les lecteurs du système d'exploitation et les lecteurs de données fixes.
4. Dans **Operating System Drives**, ouvrez **Choose how BitLocker-protected operating system drives can be recovered**, sélectionnez **Enabled** et cochez :
   - **Save BitLocker recovery information to AD DS for operating system drives** ;
   - **Store recovery passwords and key packages** ;
   - **Do not enable BitLocker until recovery information is stored to AD DS for operating system drives**.
5. Dans **Fixed Data Drives**, configurez de la même façon **Choose how BitLocker-protected fixed drives can be recovered**.
6. Dans **Operating System Drives**, ouvrez **Require additional authentication at startup**, sélectionnez **Enabled**, puis :
   - **Configure TPM startup :** Allow TPM ;
   - **Configure TPM startup PIN :** Allow startup PIN with TPM ;
   - décochez **Allow BitLocker without a compatible TPM** sur les serveurs équipés de TPM.
7. Liez la GPO à `OU=Serveurs,DC=lab,DC=local`, puis exécutez `gpupdate /force` sur un serveur de test.

<div class="callout callout-note">

L'option **Do not enable BitLocker until recovery information is stored to AD DS** fait échouer l'activation si la sauvegarde AD n'aboutit pas. C'est le comportement souhaité, car il garantit qu'aucun volume n'est chiffré sans clé de récupération dans l'annuaire.

</div>

### Installation de la Fonctionnalité BitLocker

1. Sur SRV-APP-01, ouvrez le Gestionnaire de serveur > **Manage** > **Add Roles and Features**.
2. Sélectionnez **Role-based or feature-based installation**, puis le serveur SRV-APP-01.
3. Dans **Features**, cochez **BitLocker Drive Encryption** et acceptez les outils de gestion proposés.
4. Cochez **Restart the destination server automatically if required**, puis cliquez sur **Install**.

### Installation de la Visionneuse de Mots de Passe de Récupération

1. Sur SRV-DC-01 (ou sur le serveur d'administration), ouvrez **Add Roles and Features**.
2. Dans **Features**, développez **Remote Server Administration Tools > Feature Administration Tools > BitLocker Drive Encryption Administration Utilities** et cochez **BitLocker Recovery Password Viewer**.
3. Terminez l'installation et rouvrez `dsa.msc`.

### Activation du Chiffrement du Volume Système

1. Sur SRV-APP-01, ouvrez le **Panneau de configuration > System and Security > BitLocker Drive Encryption**.
2. En face du lecteur `C:`, cliquez sur **Turn on BitLocker**.
3. L'assistant vérifie le TPM. Choisissez de sauvegarder la clé de récupération (la sauvegarde AD est effectuée automatiquement par la GPO). Conservez une copie hors ligne uniquement si la politique de l'organisation le prévoit.
4. Choisissez **Encrypt entire drive** pour un serveur déjà en service, ou **Encrypt used disk space only** pour un serveur neuf.
5. Cochez **Run BitLocker system check**, puis redémarrez. Le chiffrement démarre après le redémarrage.

### Chiffrement d'un Volume de Données

1. Dans le même écran, en face du lecteur `D:`, cliquez sur **Turn on BitLocker**.
2. Choisissez une méthode de déverrouillage, puis cochez **Automatically unlock this drive on this computer** une fois le chiffrement démarré.
3. Le mot de passe de récupération est sauvegardé dans AD par la GPO.

### Consultation d'une Clé de Récupération

1. Dans `dsa.msc`, ouvrez les propriétés de l'ordinateur SRV-APP-01.
2. Sélectionnez l'onglet **BitLocker Recovery**. Chaque mot de passe est affiché avec sa date et son identifiant.
3. Pour rechercher une clé à partir de l'identifiant affiché sur l'écran de récupération, faites un clic droit sur le domaine `lab.local` > **Find BitLocker Recovery Password** et saisissez les huit premiers caractères de l'identifiant.

## Méthode 2 : Configuration via PowerShell

### Installation de la Fonctionnalité

```powershell
Install-WindowsFeature BitLocker -IncludeAllSubFeature -IncludeManagementTools -Restart
```

Sur SRV-DC-01, installation de la visionneuse de mots de passe de récupération :

```powershell
Get-WindowsFeature *BitLocker*
Install-WindowsFeature RSAT-Feature-Tools-BitLocker-BdeAducExt
```

### Vérification du TPM

```powershell
Get-Tpm | Select-Object TpmPresent, TpmReady, TpmEnabled, TpmActivated
```

`TpmPresent` et `TpmReady` doivent valoir `True`. Si `TpmReady` vaut `False`, `Initialize-Tpm` prépare le TPM.

### Activation sur le Volume Système

L'ajout du mot de passe de récupération **avant** l'activation garantit qu'un protecteur de récupération existe dès le départ.

```powershell
Add-BitLockerKeyProtector -MountPoint "C:" -RecoveryPasswordProtector
Enable-BitLocker -MountPoint "C:" -EncryptionMethod XtsAes256 -UsedSpaceOnly -TpmProtector
```

Pour un serveur protégé par TPM et PIN :

```powershell
$pin = Read-Host -AsSecureString -Prompt "PIN de démarrage"
Enable-BitLocker -MountPoint "C:" -EncryptionMethod XtsAes256 -TpmAndPinProtector -Pin $pin
```

<div class="callout callout-note">

Selon la configuration, un redémarrage peut être nécessaire pour le test matériel avant que le chiffrement ne commence. Le paramètre `-SkipHardwareTest` l'évite, au prix d'un risque de serveur non démarrable si le TPM ne fonctionne pas correctement.

</div>

### Activation sur un Volume de Données

```powershell
Enable-BitLocker -MountPoint "D:" -EncryptionMethod XtsAes256 -RecoveryPasswordProtector
Enable-BitLockerAutoUnlock -MountPoint "D:"
```

### Sauvegarde Manuelle dans Active Directory

Pour un volume chiffré avant l'application de la GPO, ou pour un nouveau protecteur :

```powershell
$vol = Get-BitLockerVolume -MountPoint "C:"
$rp  = $vol.KeyProtector | Where-Object KeyProtectorType -eq "RecoveryPassword"
foreach ($kp in $rp) {
    Backup-BitLockerKeyProtector -MountPoint "C:" -KeyProtectorId $kp.KeyProtectorId
}
```

Équivalent avec `manage-bde` :

```cmd
manage-bde -protectors -get C:
manage-bde -protectors -adbackup C: -id {IDENTIFIANT-DU-PROTECTEUR}
```

### Récupération d'une Clé depuis Active Directory

```powershell
$computer = Get-ADComputer -Identity "SRV-APP-01"
Get-ADObject -SearchBase $computer.DistinguishedName `
    -Filter 'objectClass -eq "msFVE-RecoveryInformation"' `
    -Properties msFVE-RecoveryPassword, whenCreated |
    Select-Object Name, whenCreated, msFVE-RecoveryPassword
```

Le nom de chaque objet contient la date de création et l'identifiant du mot de passe de récupération affiché sur l'écran de récupération.

### Commandes manage-bde Utiles

```cmd
:: État de chiffrement de tous les volumes
manage-bde -status

:: Activation du volume système avec mot de passe de récupération, XTS-AES 256, espace utilisé
manage-bde -on C: -RecoveryPassword -EncryptionMethod xts_aes256 -UsedSpaceOnly

:: Ajout d'un protecteur TPM
manage-bde -protectors -add C: -TPM

:: Déverrouillage d'un volume de données avec le mot de passe de récupération
manage-bde -unlock D: -RecoveryPassword 111111-222222-333333-444444-555555-666666-777777-888888
```

### Suspension avant une Intervention sur le Firmware

```powershell
Suspend-BitLocker -MountPoint "C:" -RebootCount 1
```

La protection reprend automatiquement après le nombre de redémarrages indiqué. `Resume-BitLocker -MountPoint "C:"` la réactive manuellement.

### Mise en Place de Network Unlock

**Sur le serveur WDS (par exemple SRV-WDS-01) :**

```powershell
Install-WindowsFeature WDS-Deployment
Install-WindowsFeature BitLocker-NetworkUnlock
Get-Service WDSServer
```

Créez ensuite un certificat RSA 2048 bits dédié à Network Unlock, à partir d'un modèle de l'autorité de certification ou d'un certificat auto-signé, puis :

1. Sur le serveur WDS, ouvrez `certlm.msc`, faites un clic droit sur **BitLocker Drive Encryption Network Unlock** > **All Tasks** > **Import**, et importez le fichier `.pfx` avec sa clé privée.
2. Dans une GPO liée aux serveurs concernés, ouvrez **Computer Configuration > Policies > Windows Settings > Security Settings > Public Key Policies > BitLocker Drive Encryption Network Unlock Certificate**, faites un clic droit > **Add Network Unlock Certificate** et importez le fichier `.cer`.
3. Dans la même GPO, activez **Computer Configuration > Policies > Administrative Templates > Windows Components > BitLocker Drive Encryption > Operating System Drives > Allow network unlock at startup**.
4. Redémarrez les serveurs clients. Le protecteur réseau est ajouté après le redémarrage si la stratégie et le certificat sont présents.

<div class="callout callout-note">

Un seul certificat Network Unlock peut être actif à la fois. Pour le renouveler, supprimez l'ancien dans la GPO avant d'ajouter le nouveau. Un fichier `bde-network-unlock.ini` placé à côté de `%windir%\System32\Nkpprov.dll` sur le serveur WDS permet de limiter le déverrouillage à certains sous-réseaux, par exemple 192.168.10.0/24.

</div>

## Vérifications

**État de chiffrement :** `Get-BitLockerVolume` sur SRV-APP-01 affiche `VolumeStatus : FullyEncrypted`, `ProtectionStatus : On` et `EncryptionMethod : XtsAes256` pour `C:` et `D:`.

**Protecteurs :** `manage-bde -protectors -get C:` liste au minimum un protecteur **TPM** (ou **TPM And PIN**) et un protecteur **Numerical Password**. Avec Network Unlock, un protecteur de type **TpmCertificate** apparaît également.

**Sauvegarde AD :** l'onglet **BitLocker Recovery** de SRV-APP-01 dans `dsa.msc` affiche un mot de passe dont l'identifiant correspond à celui donné par `manage-bde -protectors -get C:`.

**Déverrouillage automatique :** après un redémarrage, `D:` est accessible sans saisie.

**Network Unlock :** un serveur protégé par TPM et PIN redémarre sans demander de PIN lorsqu'il est connecté au réseau 192.168.10.0/24, et demande le PIN lorsqu'il est déconnecté.

## Dépannage

**L'activation échoue avec un message sur les informations de récupération :** l'option de la GPO exige la sauvegarde AD et celle-ci a échoué. Vérifiez la connectivité vers SRV-DC-01 et SRV-DC-02, l'application de la GPO avec `gpresult /scope computer /r`, et réessayez.

**Le TPM n'est pas détecté :** le TPM est désactivé dans le firmware, ou la VM n'a pas de vTPM. Activez-le dans le firmware ou dans les paramètres de sécurité de la VM de génération 2, puis vérifiez avec `Get-Tpm`.

**Le serveur démarre sur l'écran de récupération BitLocker :** une mise à jour du firmware, une modification de Secure Boot ou un changement matériel a modifié les mesures du TPM. Saisissez le mot de passe de récupération retrouvé dans AD avec l'identifiant affiché, puis, une fois le serveur démarré, suspendez et reprenez BitLocker pour resceller la clé avec les nouvelles mesures.

**L'onglet BitLocker Recovery est absent de dsa.msc :** la visionneuse n'est pas installée sur la machine où la console est ouverte. Installez la fonctionnalité correspondante et rouvrez la console.

**L'onglet BitLocker Recovery est vide :** le volume a été chiffré avant l'application de la GPO, ou la sauvegarde a échoué. Exécutez `Backup-BitLockerKeyProtector` pour chaque protecteur de type mot de passe de récupération.

**Network Unlock ne fonctionne pas et le PIN est demandé :** le protecteur **TpmCertificate** est absent, la première carte réseau ne prend pas en charge DHCP en UEFI, le service WDS est arrêté, ou le DHCP et WDS sont sur le même serveur. Contrôlez `manage-bde -protectors -get C:`, la valeur `OSManageNKP` sous `HKLM\SOFTWARE\Policies\Microsoft\FVE` et l'état du service `WDSServer`.

**Un volume de données reste verrouillé au démarrage :** le déverrouillage automatique n'est pas activé ou le volume système n'est pas chiffré. Exécutez `Enable-BitLockerAutoUnlock -MountPoint "D:"` après avoir vérifié l'état de `C:`.

## Conseils et Bonnes Pratiques

**Imposer la sauvegarde AD avant tout chiffrement.** L'option **Do not enable BitLocker until recovery information is stored to AD DS** est la protection la plus efficace contre la perte de données.

**Utiliser XTS-AES 256 sur tous les serveurs.** Fixez la méthode par GPO pour éviter des volumes chiffrés avec des méthodes différentes selon l'administrateur.

**Déléguer la lecture des clés à un groupe dédié.** Accordez la lecture des objets `msFVE-RecoveryInformation` à un groupe de support restreint plutôt que d'utiliser des comptes Domain Admins pour chaque récupération.

**Intégrer la suspension dans les procédures de maintenance.** Toute mise à jour de firmware, de contrôleur RAID ou de configuration Secure Boot commence par `Suspend-BitLocker -RebootCount 1`.

**Faire tourner le mot de passe de récupération après usage.** Un mot de passe de récupération affiché ou communiqué doit être considéré comme exposé. Supprimez le protecteur avec `Remove-BitLockerKeyProtector`, ajoutez-en un nouveau et sauvegardez-le dans AD.

**Chiffrer en priorité les contrôleurs de domaine et les hôtes Hyper-V.** Un DC volé ou un VHDX de DC copié donne accès à toutes les empreintes du domaine.

**Auditer régulièrement l'état du parc.** Un script qui interroge `Get-BitLockerVolume` sur chaque serveur et compare avec les objets `msFVE-RecoveryInformation` détecte les volumes non chiffrés ou sans clé sauvegardée.

## Procédures Liées

- [Installation de Windows Server 2025](/procedures/windows/installation-de-windows-server-2025) *(Serveur de base et activation du TPM)*
- [Déploiement de Hyper-V et Gestion des VM](/procedures/windows/deploiement-de-hyper-v-et-gestion-des-vm) *(VM de génération 2 et TPM virtuel)*
- [Déploiement d'un Serveur WDS pour l'Installation d'OS par le Réseau (PXE)](/procedures/windows/deploiement-dun-serveur-wds-pour-linstallation-dos-par-le-reseau-pxe) *(Serveur WDS requis par Network Unlock)*
- [Installation et Configuration d'un Serveur DHCP](/procedures/windows/installation-et-configuration-dun-serveur-dhcp) *(Serveur DHCP distinct requis par Network Unlock)*
- [Délégation de l'Administration Active Directory](/procedures/windows/delegation-de-ladministration-active-directory) *(Délégation de la lecture des clés de récupération)*
- [Durcissement de Windows Server avec OSConfig et Credential Guard](/procedures/windows/durcissement-de-windows-server-avec-osconfig-et-credential-guard) *(Durcissement complémentaire du serveur)*
