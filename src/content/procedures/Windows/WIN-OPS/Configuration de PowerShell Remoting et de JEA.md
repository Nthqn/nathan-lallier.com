---
modele: "procedure"
titre: "Configuration de PowerShell Remoting et de JEA"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-OPS-SEC"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la configuration de PowerShell Remoting (WinRM) dans le domaine `lab.local`, puis la mise en place de Just Enough Administration (JEA) pour déléguer des tâches précises sans accorder de droits d'administrateur. Elle couvre l'activation et le contrôle de WinRM, l'écouteur HTTPS, le paramètre TrustedHosts pour les machines hors domaine, le problème du double saut (second hop) et ses solutions, ainsi que la création, l'enregistrement et l'audit d'un point de terminaison JEA.

L'exemple de JEA donne au groupe `LAB\GG-JEA-Helpdesk` le droit de consulter les services et les journaux du serveur de fichiers SRV-FIC-01 et de redémarrer le service d'impression, sans aucun autre droit sur le serveur.

## Contexte et Justification

L'administration à distance par PowerShell est le socle de l'automatisation Windows : scripts de masse, Windows Admin Center, Server Manager et la plupart des outils de gestion reposent sur WinRM. Mal configurée, elle expose des identifiants ou ouvre un accès administrateur complet à des personnes qui n'en ont pas besoin.

JEA répond au principe du moindre privilège :

- **Délégation précise :** l'utilisateur n'accède qu'aux commandes, paramètres et valeurs autorisés par son rôle.
- **Aucun droit d'administrateur pour l'utilisateur :** les commandes s'exécutent sous un compte virtuel ou un gMSA privilégié, mais l'utilisateur lui-même n'est pas administrateur du serveur.
- **Traçabilité :** chaque session peut être transcrite dans un fichier, en plus de la journalisation PowerShell.
- **Réduction du risque de vol d'identifiants :** les comptes à privilèges ne se connectent plus sur les serveurs pour des tâches courantes.
- **Sans coût de licence :** JEA est inclus dans Windows PowerShell 5.1.

## Concepts Clés

**WinRM et WS-Management.** PowerShell Remoting utilise le service **Windows Remote Management (WS-Management)**, qui écoute sur le port TCP 5985 en HTTP et TCP 5986 en HTTPS. Sur Windows Server, le remoting est activé par défaut. Sur Windows client, il doit être activé avec `Enable-PSRemoting`.

**Chiffrement en HTTP.** Dans un domaine, l'authentification Kerberos chiffre le contenu des messages WinRM même sur le port 5985. Le transport HTTPS ajoute l'authentification du serveur par certificat et le chiffrement TLS de bout en bout. L'authentification Basic n'apporte aucun chiffrement en HTTP.

**Points de terminaison (session configurations).** Chaque connexion distante aboutit à un point de terminaison nommé. `Microsoft.PowerShell` est le point de terminaison par défaut de Windows PowerShell, réservé aux administrateurs et au groupe **Remote Management Users**. `Enable-PSRemoting` exécuté depuis PowerShell 7 crée des points de terminaison `PowerShell.7` distincts.

**TrustedHosts.** Liste d'ordinateurs que le client accepte de contacter sans authentification Kerberos mutuelle, typiquement des machines hors domaine jointes par adresse IP. TrustedHosts n'authentifie rien : avec NTLM, le client ne peut pas vérifier l'identité du serveur.

**Double saut (second hop).** Depuis SRV-ADM-01, un administrateur ouvre une session sur SRV-FIC-01 (premier saut), puis tente d'accéder à une ressource sur un troisième serveur (second saut). Par défaut, Kerberos ne délègue pas les identifiants et l'accès est refusé.

| Solution | Principe | Recommandation |
|----------|----------|----------------|
| CredSSP | Transmet les identifiants au premier serveur | Déconseillé, identifiants exposés en cas de compromission |
| Délégation contrainte basée sur les ressources (RBCD) | Le serveur cible autorise le premier serveur à déléguer | Recommandé pour les accès SMB, ne couvre pas un second saut WinRM |
| Délégation contrainte classique (KCD) | Délégation configurée sur le premier serveur | Possible, mais exige des droits d'administrateur de domaine |
| JEA avec gMSA | Les commandes s'exécutent sous un gMSA qui a les droits réseau | Recommandé pour les tâches déléguées récurrentes |
| Identifiants passés dans le bloc de script | `Invoke-Command` avec `-Credential` à l'intérieur de la session | Acceptable ponctuellement, identifiants manipulés par l'utilisateur |

: Solutions au double saut

**Fichier de capacité de rôle (.psrc).** Définit ce qu'un rôle peut faire : cmdlets, fonctions, paramètres et valeurs autorisés, commandes externes, fournisseurs. Il est créé avec `New-PSRoleCapabilityFile` et doit être placé dans un sous-dossier `RoleCapabilities` d'un module PowerShell présent dans `$env:PSModulePath`.

**Fichier de configuration de session (.pssc).** Définit le point de terminaison : type de session, compte d'exécution, dossier de transcription, correspondance entre groupes AD et rôles. Il est créé avec `New-PSSessionConfigurationFile` et enregistré avec `Register-PSSessionConfiguration`.

**Session RestrictedRemoteServer.** Type de session de JEA. Le mode de langage est `NoLanguage` et seules huit commandes de base sont disponibles par défaut (`Clear-Host`, `Exit-PSSession`, `Get-Command`, `Get-FormatData`, `Get-Help`, `Measure-Object`, `Out-Default`, `Select-Object`), complétées par les rôles.

**Compte d'exécution.** Un compte virtuel est un compte local temporaire créé pour la session. Il est membre des Administrateurs locaux sur un serveur membre, et membre des Admins du domaine sur un contrôleur de domaine. Un gMSA est un compte de domaine utilisable lorsque la session doit accéder à des ressources réseau.

## Prérequis

- Un serveur cible **SRV-FIC-01.lab.local** sous Windows Server 2025, joint au domaine `lab.local`, avec Windows PowerShell 5.1 (présent par défaut).
- Un poste d'administration **SRV-ADM-01.lab.local** joint au domaine, sous Windows 11 ou Windows Server 2025.
- Les contrôleurs de domaine SRV-DC-01 et SRV-DC-02 opérationnels pour l'authentification Kerberos et la résolution DNS.
- Un groupe de sécurité global `LAB\GG-JEA-Helpdesk` contenant les comptes du support, sans droits d'administrateur sur SRV-FIC-01.
- Un compte membre du groupe **Administrateurs** local de SRV-FIC-01 pour la configuration.
- La console **Group Policy Management** (`gpmc.msc`) et le droit de lier une GPO à l'unité d'organisation des serveurs.
- Pour l'écouteur HTTPS : un certificat dans `Cert:\LocalMachine\My` de SRV-FIC-01, émis par l'autorité de certification interne, avec l'EKU **Server Authentication** et le FQDN `SRV-FIC-01.lab.local` dans le nom commun ou le SAN.
- Pour la délégation RBCD : le module **RSAT-AD-PowerShell** sur le poste qui la configure.
- Pour un compte d'exécution gMSA : un gMSA existant, par exemple `LAB\gmsa-JEA-FS$`, autorisé sur SRV-FIC-01 et installé avec `Install-ADServiceAccount`.

## Points de Vigilance

**Windows PowerShell 2.0 est retiré.** Le moteur Windows PowerShell 2.0, qui permettait de contourner la journalisation et JEA par `powershell.exe -Version 2`, a été supprimé de Windows Server 2025 et de Windows 11 24H2 par les mises à jour de 2025. Sur les systèmes plus anciens, désinstallez la fonctionnalité **MicrosoftWindowsPowerShellV2**.

**Protocoles d'authentification obsolètes.** NTLMv1 est supprimé de Windows Server 2025 et l'usage de RC4 avec Kerberos est déprécié. TLS 1.0 et 1.1 sont désactivés par défaut. Un écouteur HTTPS doit donc s'appuyer sur TLS 1.2 ou 1.3, et les clients hors domaine sur NTLMv2 au minimum.

**CredSSP expose les identifiants.** Avec CredSSP, les identifiants de l'utilisateur sont transmis au serveur distant. Un attaquant qui contrôle ce serveur peut les récupérer. N'activez pas CredSSP pour résoudre le double saut, sauf contrainte documentée et temporaire.

**TrustedHosts avec le caractère générique.** `Set-Item WSMan:\localhost\Client\TrustedHosts -Value '*'` désactive toute vérification de l'identité des serveurs contactés en NTLM. Limitez la liste aux adresses nécessaires et préférez HTTPS pour les machines hors domaine.

**Compte virtuel sur un contrôleur de domaine.** Sur SRV-DC-01 ou SRV-DC-02, le compte virtuel d'une session JEA est membre des Admins du domaine. Un rôle mal conçu donne alors un contrôle total sur le domaine. Sur un contrôleur de domaine, utilisez `RunAsVirtualAccountGroups` ou un gMSA aux droits limités, et faites relire chaque rôle.

**Commandes dangereuses dans un rôle.** Autoriser une commande capable d'exécuter du code arbitraire annule JEA : `Invoke-Expression`, `Start-Process`, `New-Service`, `Add-LocalGroupMember`, les éditeurs de texte, ou une commande externe comme `cmd.exe`. Restreignez toujours les paramètres avec `ValidateSet` ou `ValidatePattern`.

**Modification d'un point de terminaison.** Toute modification du fichier `.pssc` nécessite de désenregistrer puis réenregistrer le point de terminaison. Les modifications d'un fichier `.psrc` s'appliquent aux nouvelles sessions sans réenregistrement.

**Redémarrage de WinRM.** `Register-PSSessionConfiguration` redémarre le service WinRM et coupe les sessions distantes en cours, y compris celles de Windows Admin Center.

**Le dossier de transcription est écrit par SYSTEM.** Les utilisateurs JEA ne doivent pas pouvoir le lire ni le modifier. Restreignez ses ACL et collectez les fichiers vers un serveur central.

**Pare-feu sur le profil Public.** Sur un serveur dont la carte est en profil Public, la règle WinRM n'accepte que le sous-réseau local. Corrigez le profil réseau plutôt que d'ouvrir la règle à toutes les adresses.

## Choix Architecturaux & Alternatives

### Quand choisir PowerShell Remoting et JEA

PowerShell Remoting est le choix par défaut pour administrer des serveurs Windows à distance, en particulier Server Core. HTTP avec Kerberos suffit dans un domaine. HTTPS est préférable pour des machines hors domaine, des segments réseau non maîtrisés, ou lorsqu'une politique impose TLS sur tous les flux d'administration.

JEA convient lorsqu'une équipe (support, exploitation, prestataire) doit réaliser des tâches répétitives et bien définies sur des serveurs : redémarrer un service, consulter des journaux, vider une file d'impression, réinitialiser un pool d'applications. Il est moins adapté à une administration exploratoire, où la liste des commandes n'est pas connue à l'avance.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **JEA** | Délégation de tâches précises sur des serveurs | Moindre privilège au niveau de la commande et du paramètre | Conception et maintenance des rôles | Gratuit |
| **Groupe Administrateurs local** | Administration complète d'un serveur | Simple, aucun développement | Droits excessifs, risque de vol d'identifiants | Gratuit |
| **Groupe Remote Management Users** | Accès distant au point de terminaison par défaut | Accès sans être administrateur | Les droits restent ceux de l'utilisateur, sans contrôle des commandes | Gratuit |
| **RBAC de Windows Admin Center** | Délégation en lecture ou administration via une interface web | Interface graphique, repose sur JEA | Rôles fixes, pas de rôle personnalisé | Gratuit |
| **Solution de gestion des accès à privilèges (PAM)** | Élévation temporaire et enregistrement des sessions | Approbation, enregistrement vidéo, coffre d'identifiants | Licence et infrastructure dédiées | Élevé |

### Impact des choix

- **Sécurité.** JEA supprime le besoin d'administrateurs permanents pour les tâches courantes et limite l'impact d'un compte compromis. HTTPS protège contre l'usurpation de serveur hors domaine. RBCD ou un gMSA dans JEA évitent CredSSP.
- **Disponibilité.** Un point de terminaison JEA mal configuré n'empêche pas les administrateurs d'utiliser `Microsoft.PowerShell`. Prévoyez néanmoins de déployer les fichiers de manière identique sur tous les serveurs concernés.
- **Performance.** L'impact est négligeable. La transcription produit un fichier par session, à purger ou à collecter régulièrement.
- **Exploitation.** Les fichiers `.psrc` et `.pssc` se versionnent dans un dépôt Git et se déploient par script ou par PowerShell DSC. Chaque nouveau besoin du support se traduit par un ajout dans un rôle, après revue.
- **Coût.** Aucune licence. Le coût réel est le temps de conception, de test et de revue des rôles.

## Méthode 1 : Configuration via les Fichiers de Configuration de Session

Cette méthode configure WinRM par stratégie de groupe, puis construit le point de terminaison JEA en éditant ses fichiers dans un éditeur (Visual Studio Code ou PowerShell ISE), avant de l'enregistrer.

### Configuration de WinRM par GPO

1. Sur SRV-ADM-01, ouvrez `gpmc.msc` et créez une GPO `GPO-SRV-WinRM` liée à l'unité d'organisation des serveurs.
2. Modifiez la GPO et allez dans **Computer Configuration** > **Policies** > **Administrative Templates** > **Windows Components** > **Windows Remote Management (WinRM)** > **WinRM Service**.
3. Activez **Allow remote server management through WinRM** et renseignez le filtre IPv4 `192.168.10.0/24`. Laissez le filtre IPv6 vide si IPv6 n'est pas utilisé.
4. Dans le même dossier, vérifiez que **Allow Basic authentication** et **Allow unencrypted traffic** sont à **Not Configured** ou **Disabled**.
5. Allez dans **Computer Configuration** > **Policies** > **Windows Settings** > **Security Settings** > **System Services**, ouvrez **Windows Remote Management (WS-Management)** et choisissez le mode de démarrage **Automatic**.
6. Allez dans **Computer Configuration** > **Policies** > **Windows Settings** > **Security Settings** > **Windows Defender Firewall with Advanced Security** > **Inbound Rules**, créez une règle prédéfinie **Windows Remote Management** et conservez la règle du profil **Domain**.
7. Allez dans **Computer Configuration** > **Policies** > **Administrative Templates** > **Windows Components** > **Windows PowerShell**, activez **Turn on PowerShell Script Block Logging** et **Turn on Module Logging** (module `*`).
8. Fermez l'éditeur et exécutez `gpupdate /force` sur SRV-FIC-01.

### Création du Module de Rôles

1. Sur SRV-FIC-01, créez le dossier `C:\Program Files\WindowsPowerShell\Modules\LabJEA\RoleCapabilities`.
2. Dans `C:\Program Files\WindowsPowerShell\Modules\LabJEA`, créez un manifeste vide pour que PowerShell reconnaisse le module :

```powershell
New-ModuleManifest -Path 'C:\Program Files\WindowsPowerShell\Modules\LabJEA\LabJEA.psd1'
```

3. Générez un fichier de capacité de rôle commenté, qui sert de modèle :

```powershell
New-PSRoleCapabilityFile -Path 'C:\Program Files\WindowsPowerShell\Modules\LabJEA\RoleCapabilities\HelpdeskSrv.psrc'
```

4. Restreignez les ACL du dossier `LabJEA` : lecture pour tous, modification réservée aux Administrateurs et à SYSTEM.

### Édition du Fichier de Capacité de Rôle

Ouvrez `HelpdeskSrv.psrc` dans l'éditeur. Le fichier est une table de hachage PowerShell. Renseignez les clés suivantes et laissez les autres en commentaire :

```powershell
@{
    GUID = '<conservez la valeur générée>'
    Author = 'Nathan LALLIER'
    Description = 'Support niveau 1 sur les serveurs de fichiers'

    VisibleCmdlets = @(
        'Get-Service',
        @{ Name = 'Restart-Service'; Parameters = @{ Name = 'Name'; ValidateSet = 'Spooler' } },
        @{ Name = 'Get-WinEvent';    Parameters = @{ Name = 'LogName'; ValidateSet = 'System', 'Application' },
                                                  @{ Name = 'MaxEvents' } }
    )

    # Commandes CDXML, exposées comme des fonctions
    VisibleFunctions = 'Get-PrintJob', 'Get-SmbShare', 'Get-Volume'
}
```

<div class="callout callout-note">

Une cmdlet listée sans restriction de paramètres est utilisable avec tous ses paramètres. Pour une cmdlet qui modifie le système, listez toujours les paramètres autorisés et leurs valeurs. Les commandes des modules CDXML (`Get-SmbShare`, `Get-Volume`, `Get-PrintJob`) sont des fonctions et se déclarent dans `VisibleFunctions`, sinon elles n'apparaissent pas dans la session. Le nom du fichier (`HelpdeskSrv`) devient le nom du rôle. Utilisez un nom unique sur le serveur, car deux fichiers de même nom dans deux modules créent une ambiguïté.

</div>

### Création du Fichier de Configuration de Session

1. Générez le fichier de configuration de session :

```powershell
New-PSSessionConfigurationFile -Path 'C:\JEA\HelpdeskSrv.pssc' -SessionType RestrictedRemoteServer
```

2. Ouvrez `C:\JEA\HelpdeskSrv.pssc` dans l'éditeur et renseignez les clés suivantes :

```powershell
@{
    SchemaVersion = '2.0.0.0'
    GUID = '<conservez la valeur générée>'
    Author = 'Nathan LALLIER'
    Description = 'Point de terminaison JEA du support sur SRV-FIC-01'
    SessionType = 'RestrictedRemoteServer'
    TranscriptDirectory = 'C:\ProgramData\JEATranscripts'
    RunAsVirtualAccount = $true
    RoleDefinitions = @{
        'LAB\GG-JEA-Helpdesk' = @{ RoleCapabilities = 'HelpdeskSrv' }
    }
}
```

3. Créez le dossier `C:\ProgramData\JEATranscripts` et retirez-y l'accès des utilisateurs : contrôle total pour SYSTEM et Administrateurs uniquement.
4. Validez la syntaxe du fichier :

```powershell
Test-PSSessionConfigurationFile -Path 'C:\JEA\HelpdeskSrv.pssc'
```

La commande doit renvoyer `True`.

### Enregistrement du Point de Terminaison

```powershell
Register-PSSessionConfiguration -Name 'JEA-Helpdesk' -Path 'C:\JEA\HelpdeskSrv.pssc'
```

WinRM redémarre. Le point de terminaison est disponible dès la fin de la commande.

<div class="callout callout-note">

Pour une session qui doit accéder à un partage réseau sur un autre serveur, remplacez `RunAsVirtualAccount = $true` par `GroupManagedServiceAccount = 'LAB\gmsa-JEA-FS'` et accordez au gMSA les droits nécessaires sur la ressource distante. Cette option résout aussi le double saut sans CredSSP.

</div>

### Test depuis le Poste d'Administration

Avec un compte membre de `LAB\GG-JEA-Helpdesk`, sur SRV-ADM-01 :

```powershell
Enter-PSSession -ComputerName SRV-FIC-01.lab.local -ConfigurationName 'JEA-Helpdesk'
Get-Command
Restart-Service -Name Spooler
Restart-Service -Name WinRM      # doit être refusé
Exit-PSSession
```

## Méthode 2 : Configuration via PowerShell

### Activation et Contrôle de WinRM

Sur un serveur où le remoting a été désactivé, ou sur un poste Windows 11 :

```powershell
# Active WinRM, crée l'écouteur HTTP et les règles de pare-feu
Enable-PSRemoting -Force

# Contrôles
Get-Service WinRM
Get-PSSessionConfiguration | Select-Object Name, Permission
winrm enumerate winrm/config/listener
Test-WSMan -ComputerName SRV-FIC-01.lab.local
```

<div class="callout callout-note">

Sur un poste client dont une carte est en profil Public, `Enable-PSRemoting` échoue sauf avec `-SkipNetworkProfileCheck`, qui limite alors la règle au sous-réseau local. Exécutée depuis PowerShell 7, la commande crée les points de terminaison `PowerShell.7` et ne modifie pas ceux de Windows PowerShell.

</div>

### Machines Hors Domaine et TrustedHosts

Pour administrer depuis SRV-ADM-01 un serveur en groupe de travail joint par adresse IP, par exemple 192.168.10.80 :

```powershell
# Consultation de la liste actuelle
Get-Item -Path WSMan:\localhost\Client\TrustedHosts

# Ajout d'une entrée sans écraser les existantes
Set-Item -Path WSMan:\localhost\Client\TrustedHosts -Value '192.168.10.80' -Concatenate -Force

# Connexion avec un compte local du serveur cible
Enter-PSSession -ComputerName 192.168.10.80 -Credential (Get-Credential '192.168.10.80\Administrateur')
```

### Écouteur HTTPS

Sur SRV-FIC-01, avec le certificat émis pour `SRV-FIC-01.lab.local` :

```powershell
$cert = Get-ChildItem -Path Cert:\LocalMachine\My |
    Where-Object { $_.Subject -eq 'CN=SRV-FIC-01.lab.local' -and $_.NotAfter -gt (Get-Date) } |
    Sort-Object NotAfter -Descending | Select-Object -First 1

New-Item -Path WSMan:\localhost\Listener -Transport HTTPS -Address * `
    -CertificateThumbprint $cert.Thumbprint -Force

# La règle de pare-feu du port 5986 n'est pas créée automatiquement
New-NetFirewallRule -DisplayName 'Windows Remote Management (HTTPS-In)' `
    -Direction Inbound -Protocol TCP -LocalPort 5986 -Action Allow `
    -Profile Domain -RemoteAddress 192.168.10.0/24

winrm enumerate winrm/config/listener
```

Depuis SRV-ADM-01 :

```powershell
Test-WSMan -ComputerName SRV-FIC-01.lab.local -UseSSL
Enter-PSSession -ComputerName SRV-FIC-01.lab.local -UseSSL
```

<div class="callout callout-note">

Le nom utilisé à la connexion doit correspondre au nom du certificat. Une connexion par adresse IP échoue en HTTPS, sauf si l'adresse figure dans le SAN. N'utilisez pas `-SkipCACheck` ni `-SkipCNCheck` en production.

</div>

### Double Saut avec RBCD

Scénario : depuis SRV-ADM-01, une session sur SRV-FIC-01 doit lire un partage sur SRV-FIC-02. On autorise SRV-FIC-01 à déléguer vers SRV-FIC-02 en configurant l'objet de la ressource cible :

```powershell
# Sur SRV-ADM-01, avec le module ActiveDirectory
$premierSaut = Get-ADComputer -Identity 'SRV-FIC-01'
Set-ADComputer -Identity 'SRV-FIC-02' -PrincipalsAllowedToDelegateToAccount $premierSaut

# Vérification
Get-ADComputer -Identity 'SRV-FIC-02' -Properties PrincipalsAllowedToDelegateToAccount |
    Select-Object Name, PrincipalsAllowedToDelegateToAccount

# Purge du cache Kerberos du compte ordinateur de SRV-FIC-01, pour éviter d'attendre environ 15 minutes
Invoke-Command -ComputerName SRV-FIC-01.lab.local -ScriptBlock { klist purge -li 0x3e7 }

# Test du second saut SMB
Invoke-Command -ComputerName SRV-FIC-01.lab.local -ScriptBlock {
    Get-ChildItem -Path '\\SRV-FIC-02.lab.local\Partage'
}
```

<div class="callout callout-note">

RBCD fonctionne pour un second saut SMB, mais pas pour un second saut WinRM (une session PowerShell ouverte depuis SRV-FIC-01 vers SRV-FIC-02). Les comptes marqués **Account is sensitive and cannot be delegated** et les membres du groupe **Protected Users** ne sont jamais délégués.

</div>

### Création et Enregistrement du Point de Terminaison JEA

Le script suivant, exécuté sur SRV-FIC-01, produit le même résultat que la Méthode 1 sans édition manuelle :

```powershell
$moduleRoot = 'C:\Program Files\WindowsPowerShell\Modules\LabJEA'
New-Item -Path "$moduleRoot\RoleCapabilities" -ItemType Directory -Force | Out-Null
New-ModuleManifest -Path "$moduleRoot\LabJEA.psd1"

# Fichier de capacité de rôle
$roleParams = @{
    Path             = "$moduleRoot\RoleCapabilities\HelpdeskSrv.psrc"
    Author           = 'Nathan LALLIER'
    Description      = 'Support niveau 1 sur les serveurs de fichiers'
    VisibleCmdlets   = @(
        'Get-Service',
        @{ Name = 'Restart-Service'; Parameters = @{ Name = 'Name'; ValidateSet = 'Spooler' } },
        @{ Name = 'Get-WinEvent';    Parameters = @{ Name = 'LogName'; ValidateSet = 'System', 'Application' },
                                                  @{ Name = 'MaxEvents' } }
    )
    VisibleFunctions = 'Get-PrintJob', 'Get-SmbShare', 'Get-Volume'
}
New-PSRoleCapabilityFile @roleParams

# Dossier de transcription réservé à SYSTEM et aux Administrateurs
New-Item -Path 'C:\ProgramData\JEATranscripts' -ItemType Directory -Force | Out-Null
# SID de SYSTEM et du groupe Administrateurs, indépendants de la langue du système
icacls 'C:\ProgramData\JEATranscripts' /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'

# Fichier de configuration de session
New-Item -Path 'C:\JEA' -ItemType Directory -Force | Out-Null
$sessionParams = @{
    Path                = 'C:\JEA\HelpdeskSrv.pssc'
    SessionType         = 'RestrictedRemoteServer'
    Author              = 'Nathan LALLIER'
    Description         = 'Point de terminaison JEA du support sur SRV-FIC-01'
    TranscriptDirectory = 'C:\ProgramData\JEATranscripts'
    RunAsVirtualAccount = $true
    RoleDefinitions     = @{ 'LAB\GG-JEA-Helpdesk' = @{ RoleCapabilities = 'HelpdeskSrv' } }
}
New-PSSessionConfigurationFile @sessionParams

Test-PSSessionConfigurationFile -Path 'C:\JEA\HelpdeskSrv.pssc'
Register-PSSessionConfiguration -Name 'JEA-Helpdesk' -Path 'C:\JEA\HelpdeskSrv.pssc' -Force
```

<div class="callout callout-note">

Pour limiter les droits du compte virtuel au lieu de l'ajouter aux Administrateurs locaux, ajoutez `RunAsVirtualAccountGroups = 'JEA-Helpdesk-Operators'` (groupe local de SRV-FIC-01 auquel vous accordez les seuls droits nécessaires). Pour exiger une condition supplémentaire à la connexion, le paramètre `RequiredGroups` (par exemple l'appartenance à un groupe lié à une authentification par carte à puce) s'ajoute à `$sessionParams`.

</div>

### Déploiement sur Plusieurs Serveurs

Copiez le module et le fichier `.pssc` puis enregistrez le point de terminaison à distance :

```powershell
$serveurs = 'SRV-FIC-01.lab.local', 'SRV-FIC-02.lab.local'
foreach ($s in $serveurs) {
    $session = New-PSSession -ComputerName $s
    Copy-Item -Path 'C:\Sources\JEA\LabJEA' -Destination 'C:\Program Files\WindowsPowerShell\Modules\' -Recurse -Force -ToSession $session
    Copy-Item -Path 'C:\Sources\JEA\HelpdeskSrv.pssc' -Destination 'C:\JEA\' -Force -ToSession $session
    Invoke-Command -Session $session -ScriptBlock {
        if (Get-PSSessionConfiguration -Name 'JEA-Helpdesk' -ErrorAction SilentlyContinue) {
            Unregister-PSSessionConfiguration -Name 'JEA-Helpdesk' -Force
        }
        Register-PSSessionConfiguration -Name 'JEA-Helpdesk' -Path 'C:\JEA\HelpdeskSrv.pssc' -Force
    }
    Remove-PSSession $session
}
```

<div class="callout callout-note">

Le dossier `C:\JEA` doit exister sur chaque serveur avant la copie. L'enregistrement redémarre WinRM, ce qui peut couper la session en cours : la commande `Remove-PSSession` peut alors renvoyer une erreur sans conséquence. Pour un parc important, le module DSC **JeaDsc** est une alternative déclarative.

</div>

### Mise à Jour et Suppression

```powershell
# Après modification du .pssc
Unregister-PSSessionConfiguration -Name 'JEA-Helpdesk' -Force
Register-PSSessionConfiguration -Name 'JEA-Helpdesk' -Path 'C:\JEA\HelpdeskSrv.pssc' -Force

# Suppression définitive
Unregister-PSSessionConfiguration -Name 'JEA-Helpdesk' -Force
```

## Vérifications

**WinRM :** `Test-WSMan -ComputerName SRV-FIC-01.lab.local` répond depuis SRV-ADM-01, et `Test-WSMan -ComputerName SRV-FIC-01.lab.local -UseSSL` répond si l'écouteur HTTPS est configuré. `winrm enumerate winrm/config/listener` sur SRV-FIC-01 affiche les écouteurs HTTP et HTTPS attendus.

**Points de terminaison JEA :**

```powershell
Get-PSSessionConfiguration | Where-Object SessionType -eq 'RestrictedRemoteServer' |
    Select-Object Name, RunAsVirtualAccount, TranscriptDirectory

(Get-PSSessionConfiguration -Name 'JEA-Helpdesk').RoleDefinitions
```

**Capacités effectives d'un utilisateur :** sur SRV-FIC-01, en administrateur, la commande suivante liste exactement les commandes disponibles pour un membre du support :

```powershell
Get-PSSessionCapability -ConfigurationName 'JEA-Helpdesk' -Username 'LAB\jdupont'
```

**Fonctionnement :** un membre de `LAB\GG-JEA-Helpdesk` ouvre la session JEA, redémarre le service Spooler, mais reçoit une erreur s'il tente de redémarrer un autre service ou d'utiliser une commande non autorisée. Le même compte est refusé sur le point de terminaison par défaut `Microsoft.PowerShell`.

**Transcription :** un fichier de transcription horodaté apparaît dans `C:\ProgramData\JEATranscripts` pour chaque session, avec l'identité de l'utilisateur connecté et le compte d'exécution.

**Journalisation :** les événements 4104 (journalisation des blocs de script) apparaissent dans **Microsoft-Windows-PowerShell/Operational** sur SRV-FIC-01.

## Dépannage

**Test-WSMan échoue avec une erreur de connexion :** WinRM est arrêté, le pare-feu bloque le port, ou le filtre IPv4 de la GPO exclut l'adresse du client. Vérifiez `Get-Service WinRM`, `Test-NetConnection SRV-FIC-01.lab.local -Port 5985` et `winrm get winrm/config/service` sur le serveur.

**Erreur d'authentification vers une adresse IP ou une machine hors domaine :** Kerberos ne fonctionne pas avec une adresse IP. Ajoutez l'adresse à TrustedHosts et fournissez des identifiants explicites, ou utilisez HTTPS avec un certificat portant le bon nom.

**La connexion HTTPS échoue :** le nom saisi ne correspond pas au certificat, la chaîne n'est pas approuvée par le client, le certificat a expiré, ou le port 5986 est fermé. Vérifiez le listener avec `winrm enumerate winrm/config/listener` et le certificat avec `certlm.msc`.

**Accès refusé lors de l'ouverture de la session JEA :** l'utilisateur n'est pas membre d'un groupe listé dans `RoleDefinitions`, son jeton n'a pas été rafraîchi après l'ajout au groupe (nouvelle ouverture de session nécessaire), ou une condition `RequiredGroups` n'est pas remplie. Contrôlez avec `Get-PSSessionCapability`.

**Le rôle n'est pas trouvé ou une commande attendue manque :** le fichier `.psrc` n'est pas dans un dossier `RoleCapabilities` d'un module présent dans `$env:PSModulePath`, le nom du rôle ne correspond pas au nom du fichier, ou une faute de frappe affecte le nom d'une cmdlet. JEA n'affiche pas d'erreur pour une cmdlet inexistante dans le rôle. Comparez le résultat de `Get-PSSessionCapability` au contenu du fichier.

**Une modification du .pssc n'est pas prise en compte :** le point de terminaison n'a pas été réenregistré. Exécutez `Unregister-PSSessionConfiguration` puis `Register-PSSessionConfiguration`.

**Accès refusé lors du second saut :** sans délégation, c'est le comportement normal de Kerberos. Mettez en place RBCD pour un accès SMB, un gMSA dans JEA, ou passez des identifiants dans le bloc de script. Après la configuration de RBCD, purgez le cache avec `klist purge -li 0x3e7` sur le premier serveur ou attendez environ 15 minutes.

## Conseils et Bonnes Pratiques

**Concevoir les rôles à partir des tâches.** Recensez avec le support les opérations réellement effectuées, puis traduisez chacune en commandes et paramètres. Ne partez pas d'une liste de cmdlets générique.

**Restreindre systématiquement les paramètres.** Utilisez `ValidateSet` pour une liste fermée de valeurs, `ValidatePattern` pour un format, et n'exposez jamais une cmdlet de modification sans restriction.

**Préférer des fonctions encapsulées.** Pour une tâche composée, écrivez une fonction dans le module `LabJEA` et exposez-la avec `VisibleFunctions`. L'utilisateur appelle une seule commande dont vous contrôlez entièrement le comportement.

**Versionner et relire les fichiers.** Stockez les `.psrc` et `.pssc` dans un dépôt Git, faites relire chaque modification par un second administrateur et déployez-les par script ou par DSC.

**Centraliser les transcriptions et les journaux.** Collectez `C:\ProgramData\JEATranscripts` et le journal **Microsoft-Windows-PowerShell/Operational** vers un serveur central ou un SIEM, par exemple avec le transfert d'événements Windows.

**Garder HTTP avec Kerberos dans le domaine, HTTPS ailleurs.** Dans `lab.local`, Kerberos chiffre déjà les messages WinRM. Réservez l'effort de gestion des certificats aux machines hors domaine et aux réseaux non maîtrisés.

**Bannir CredSSP.** Résolvez le double saut par RBCD, par un gMSA dans JEA ou par des identifiants explicites dans le bloc de script, et vérifiez périodiquement que CredSSP n'est pas activé avec `Get-WSManCredSSP`.

**Protéger les comptes privilégiés.** Placez les comptes administrateurs dans **Protected Users** et appliquez le modèle d'administration en tiers : JEA est l'outil privilégié pour les tâches courantes du niveau 1, sans exposer d'identifiants d'administrateur sur les serveurs.

## Procédures Liées

- [Déploiement des Comptes de Service Managés de Groupe (gMSA)](/procedures/windows/deploiement-des-comptes-de-service-manages-de-groupe-gmsa) *(Compte d'exécution JEA avec accès réseau)*
- [Délégation de l'Administration Active Directory](/procedures/windows/delegation-de-ladministration-active-directory) *(Délégation équivalente côté annuaire)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Place de JEA dans le modèle de niveaux)*
- [Déploiement de Windows Admin Center](/procedures/windows/deploiement-de-windows-admin-center) *(RBAC de WAC basé sur JEA)*
- [Configuration du Pare-feu Windows et des Règles de Sécurité de Connexion](/procedures/windows/configuration-du-pare-feu-windows-et-des-regles-de-securite-de-connexion) *(Ouverture des ports 5985 et 5986)*
- [Supervision avec l'Analyseur de Performances et le Transfert d'Événements](/procedures/windows/supervision-avec-lanalyseur-de-performances-et-le-transfert-devenements) *(Collecte centralisée des journaux PowerShell)*
