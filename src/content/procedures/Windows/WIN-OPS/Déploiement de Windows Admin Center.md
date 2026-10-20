---
modele: "procedure"
titre: "Déploiement de Windows Admin Center"
type: "PROCEDURE"
class: "03. Serveur"
reference: "WIN-OPS-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit le déploiement de Windows Admin Center (WAC) en mode passerelle sur un serveur membre Windows Server 2025 du domaine `lab.local`. Elle couvre l'installation de la version moderne basée sur .NET 8, le remplacement du certificat TLS, la gestion des connexions, le contrôle d'accès à la passerelle, le contrôle d'accès basé sur les rôles (RBAC) sur les serveurs gérés, la délégation Kerberos pour l'authentification unique et la gestion des extensions.

Windows Admin Center dans Azure, pour les serveurs activés par Azure Arc, est présenté comme alternative sans passerelle locale. Le déploiement en haute disponibilité sur un cluster de basculement est seulement évoqué.

## Contexte et Justification

Les consoles MMC (Gestionnaire de serveur, Gestionnaire Hyper-V, Gestion de l'ordinateur) imposent une session RDP sur chaque serveur ou l'installation des outils RSAT sur chaque poste d'administration. Elles ne fonctionnent pas sur Server Core sans poste distant et ne centralisent pas l'accès.

Windows Admin Center répond à ces limites :

- **Console web centralisée :** un navigateur suffit pour administrer serveurs, clusters, hôtes Hyper-V et postes Windows, sans RDP ni RSAT.
- **Adapté à Server Core :** WAC remplace avantageusement les consoles graphiques sur les serveurs sans interface.
- **Sans agent :** la passerelle communique avec les serveurs gérés par PowerShell Remoting (WinRM) et WMI, déjà présents dans Windows Server.
- **Contrôle d'accès :** l'accès à la passerelle est limité à des groupes AD, et le RBAC s'appuie sur Just Enough Administration (JEA) sur chaque serveur géré.
- **Sans coût de licence :** WAC est inclus dans la licence Windows Server.

## Concepts Clés

**Passerelle (gateway).** Service Windows `WindowsAdminCenter` qui héberge l'interface web et relaie les commandes vers les serveurs gérés. Les administrateurs s'y connectent en HTTPS depuis leur navigateur, et la passerelle ouvre ensuite des sessions WinRM vers les nœuds.

**Version moderne (v2).** Depuis la version 2410, la passerelle repose sur .NET 8 et le serveur web Kestrel, avec prise en charge de HTTP/2 et une architecture en microservices. La version 2311 et les versions antérieures sont dites « legacy ». Les versions suivent la nomenclature AAMM.

| Version | Date | Apport principal |
|---------|------|------------------|
| 2410 | Décembre 2024 | Passerelle modernisée .NET 8, nouvel installeur (Express ou Custom) |
| 2511 | Novembre 2025 | Retour de la haute disponibilité (scripts `Deploy-GatewayV2Ha`) |
| 2606 | Juin 2026 | Dernière version en disponibilité générale à la date de rédaction |

: Versions modernes de Windows Admin Center

**Cycle de vie moderne.** Seule la dernière version publiée est prise en charge. Une nouvelle version doit être installée dans les 30 jours suivant sa publication pour rester dans le support. La mise à jour automatique est proposée à l'installation.

**Modes d'installation.**

| Système hôte | Mode | Port par défaut | Accès |
|--------------|------|-----------------|-------|
| Windows Server | Passerelle (service) | 443 | Navigateurs distants |
| Windows 10 ou 11 | Local | 6600 | Navigateur local uniquement |

: Modes d'installation de Windows Admin Center

**Rôles de la passerelle.** Deux rôles contrôlent l'accès à l'interface. Les **Gateway users** peuvent se connecter et gérer les serveurs pour lesquels ils ont des droits. Les **Gateway administrators** gèrent en plus les paramètres de la passerelle, l'accès et les extensions. Les administrateurs locaux de la passerelle sont toujours Gateway administrators.

**Authentification sur les nœuds.** Les droits sur un serveur géré sont ceux du compte qui exécute l'action. Par défaut, la passerelle s'authentifie avec le compte de l'utilisateur connecté, ce qui exige une délégation Kerberos de la passerelle vers les nœuds (RBCD) pour éviter une nouvelle saisie des identifiants. L'option **Manage as** permet de saisir un autre compte pour une connexion donnée.

**RBAC sur les nœuds.** Lorsqu'il est activé sur un serveur, WAC y crée un point de terminaison JEA nommé `Microsoft.Sme.PowerShell` et trois groupes locaux : **Windows Admin Center Administrators**, **Windows Admin Center Hyper-V Administrators** et **Windows Admin Center Readers**. Les utilisateurs non administrateurs du serveur obtiennent alors des droits limités selon leur groupe.

**Extensions.** Les outils de WAC (Hyper-V, Certificats, Mises à jour, Azure Arc, extensions des constructeurs matériels) sont des extensions publiées dans un flux NuGet. Seuls les Gateway administrators peuvent les installer ou les mettre à jour.

**Windows Admin Center dans Azure.** Variante hébergée par Microsoft, intégrée au portail Azure, qui administre les serveurs activés par Azure Arc et les VM Azure sans passerelle locale, sans VPN ni port entrant. Elle est déployée comme l'extension de VM `AdminCenter`.

## Prérequis

- Un serveur membre dédié à la passerelle, **SRV-WAC-01** (192.168.10.36), sous **Windows Server 2025**, joint au domaine `lab.local`. L'installation sur un contrôleur de domaine n'est pas prise en charge, n'utilisez donc ni SRV-DC-01 ni SRV-DC-02.
- Un enregistrement DNS `wac.lab.local` (CNAME vers `SRV-WAC-01.lab.local` ou enregistrement A vers 192.168.10.36) sur SRV-DC-01 et SRV-DC-02.
- Un certificat TLS émis par l'autorité de certification interne, installé dans le magasin `Cert:\LocalMachine\My` de SRV-WAC-01, avec une clé privée, l'EKU **Server Authentication** (1.3.6.1.5.5.7.3.1) et les noms `wac.lab.local` et `SRV-WAC-01.lab.local` dans l'extension SAN.
- Deux groupes de sécurité globaux dans AD : `LAB\GG-WAC-Users` (utilisateurs de la passerelle) et `LAB\GG-WAC-Admins` (administrateurs de la passerelle).
- Le service WinRM démarré sur les serveurs à gérer (comportement par défaut sur Windows Server) et le port TCP 5985 ouvert depuis SRV-WAC-01. Le port TCP 445 (règle **File Server Remote Management (SMB-In)**) est nécessaire pour certaines copies de fichiers.
- Le port TCP 443 de SRV-WAC-01 joignable depuis les postes d'administration.
- Un navigateur récent (Microsoft Edge ou Google Chrome) sur les postes d'administration.
- Le module **RSAT-AD-PowerShell** sur le poste qui configure la délégation Kerberos.
- L'accès Internet sortant de SRV-WAC-01 vers le flux d'extensions et le service de mise à jour, ou un flux d'extensions interne.

## Points de Vigilance

**Ne pas installer WAC sur un contrôleur de domaine.** Ce scénario n'est pas pris en charge. Un serveur membre dédié limite aussi l'impact d'une compromission de la passerelle.

**La passerelle est un actif de niveau 0 ou 1.** Quiconque contrôle SRV-WAC-01 peut agir sur tous les serveurs gérés avec les droits des administrateurs qui s'y connectent. Gérez SRV-DC-01 et SRV-DC-02 depuis une passerelle dédiée au niveau 0, ou excluez-les de la passerelle des serveurs membres, conformément au modèle d'administration en tiers.

**Le certificat auto-signé expire après 60 jours.** Il est réservé aux tests. En production, utilisez un certificat de l'autorité interne. Le compte **NETWORK SERVICE** doit avoir accès à la clé privée, sinon le service ne démarre pas en HTTPS.

**Version legacy en fin de support.** Les versions 2311 et antérieures ne reçoivent plus de correctifs. La version moderne peut être installée à côté d'une passerelle legacy à condition d'utiliser des ports différents. Exportez les connexions de l'ancienne passerelle et réimportez-les dans la nouvelle. Les extensions tierces doivent exister en version compatible avec la passerelle .NET 8.

**Extensions à réinstaller après une mise à jour.** La page des problèmes connus indique que les extensions doivent être réinstallées après une mise à jour de WAC. Tenez à jour la liste des extensions installées pour les réinstaller rapidement.

**Mises à jour obligatoires.** Le cycle de vie moderne n'accorde que 30 jours pour passer à la nouvelle version. Activez la mise à jour automatique ou planifiez une revue mensuelle.

**Pas de RBAC pour la gestion des clusters.** Le RBAC de WAC s'applique aux serveurs, pas aux connexions de type cluster. Il n'est pas possible de créer des rôles personnalisés depuis WAC. Pour un besoin précis, créez un point de terminaison JEA dédié.

**L'activation du RBAC redémarre WinRM.** L'application du RBAC sur un serveur crée le point de terminaison JEA et redémarre WinRM, ce qui coupe les sessions PowerShell distantes en cours. L'opération peut prendre jusqu'à 10 minutes.

**CredSSP élargit l'exposition des identifiants.** Certains outils (gestion des clusters hyperconvergés, mises à jour adaptées aux clusters) utilisent CredSSP. Limitez son usage et préférez la délégation Kerberos contrainte basée sur les ressources pour l'authentification unique.

**Ports inférieurs à 1024.** La page des problèmes connus indique que WAC ne prend pas en charge les ports inférieurs à 1024, alors que l'installeur moderne utilise 443 par défaut sur Windows Server. Conservez 443 ou un port supérieur à 1024, et évitez tout autre port réservé.

## Choix Architecturaux & Alternatives

### Quand choisir Windows Admin Center

Une passerelle WAC sur site convient à une infrastructure Windows Server de quelques dizaines à quelques centaines de serveurs, en particulier avec Server Core, des hôtes Hyper-V ou des clusters, lorsque les administrateurs doivent travailler depuis un navigateur sans RDP. Elle s'intègre bien à un modèle d'administration en tiers grâce à des passerelles séparées par niveau.

Elle est moins adaptée à une gestion de configuration à grande échelle (déploiement de paramètres sur des centaines de serveurs, conformité continue). Les GPO, PowerShell DSC, Azure Arc ou System Center répondent mieux à ces besoins. Pour des serveurs déjà connectés à Azure Arc, Windows Admin Center dans Azure supprime la passerelle locale à maintenir.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Passerelle WAC sur site** | Administration web de serveurs et clusters locaux | Inclus dans Windows Server, sans agent, adapté à Server Core | Passerelle à durcir, mettre à jour et sauvegarder | Gratuit |
| **WAC en mode local sur Windows 11** | Administrateur isolé, petit parc | Installation immédiate, aucun serveur dédié | Accès limité au poste local, pas de partage des connexions | Gratuit |
| **Windows Admin Center dans Azure** | Serveurs activés par Azure Arc, sites distants | Aucune passerelle locale, aucun port entrant, Microsoft Entra ID et MFA | Dépend d'Azure Arc et de la connectivité Internet | Faible |
| **Consoles MMC et RSAT** | Administration ponctuelle depuis un poste d'administration | Couverture fonctionnelle complète, outils connus | Pas de console web, un outil par rôle | Gratuit |
| **System Center Virtual Machine Manager et Operations Manager** | Grands parcs, supervision et virtualisation à l'échelle | Automatisation, supervision et rapports avancés | Licence System Center, infrastructure SQL lourde | Élevé |

### Impact des choix

- **Sécurité.** Un certificat de l'autorité interne, l'accès limité à des groupes AD et la délégation Kerberos contrainte évitent l'usage de CredSSP. Le RBAC limite les droits des opérateurs non administrateurs. Une passerelle par niveau évite qu'une passerelle de niveau 1 ne serve à atteindre les contrôleurs de domaine.
- **Disponibilité.** Une passerelle unique est un point de défaillance pour l'outil d'administration, pas pour les serveurs gérés : en cas de panne, les consoles MMC et PowerShell restent utilisables. La haute disponibilité sur un cluster de basculement est possible depuis la version 2511 pour les grandes équipes.
- **Performance.** La passerelle moderne supporte HTTP/2 et un usage simultané plus important que la version legacy. Prévoyez au moins 4 vCPU et 8 Go de mémoire pour une équipe de plusieurs administrateurs.
- **Exploitation.** Les connexions partagées et les étiquettes (tags) organisent la liste des serveurs pour toute l'équipe. L'import par CSV et PowerShell facilite l'intégration de nouveaux serveurs.
- **Coût.** WAC est gratuit. Le coût réel tient à la VM de passerelle, au certificat interne et au temps de mise à jour mensuelle. Windows Admin Center dans Azure est sans surcoût propre, mais s'appuie sur Azure Arc dont certains services sont payants.

## Méthode 1 : Configuration via l'Assistant d'Installation et l'Interface Web de Windows Admin Center

### Préparation du Certificat

1. Sur SRV-WAC-01, ouvrez `certlm.msc`.
2. Faites un clic droit sur **Personal** > **Certificates** > **All Tasks** > **Request New Certificate**.
3. Choisissez le modèle de certificat serveur web publié par l'autorité interne, et renseignez le nom commun `wac.lab.local` ainsi que les noms DNS `wac.lab.local` et `SRV-WAC-01.lab.local`.
4. Cliquez sur **Enroll**.
5. Double-cliquez sur le certificat obtenu, onglet **Details**, et notez la valeur du champ **Thumbprint**.

<div class="callout callout-note">

La valeur copiée depuis la console MMC peut contenir un caractère invisible au début. Saisissez le premier caractère à la main, puis collez le reste, ou récupérez l'empreinte avec `Get-ChildItem Cert:\LocalMachine\My` en PowerShell.

</div>

### Installation de la Passerelle

1. Téléchargez l'installeur depuis `https://aka.ms/WACdownload` et copiez-le sur SRV-WAC-01.
2. Lancez `WindowsAdminCenter.exe` en tant qu'administrateur.
3. Sur la page **Welcome to the Windows Admin Center setup wizard**, cliquez sur **Next**.
4. Sur la page **License Terms and Privacy Statement**, cochez **I accept these terms and understand the privacy statement**, puis cliquez sur **Next**.
5. Sur la page **Select installation mode**, choisissez **Custom setup** pour pouvoir fixer le port, le certificat et le nom d'accès. Cliquez sur **Next**.
6. Conservez l'accès réseau distant et le port **443**.
7. Sur la page **Select TLS certificate**, choisissez **Use the pre-installed TLS certificate**, puis collez l'empreinte du certificat.
8. Renseignez le nom complet du point d'accès `wac.lab.local`.
9. Sur la page **Automatic updates**, conservez l'option recommandée d'installation automatique des mises à jour.
10. Choisissez votre préférence sur la page **Send diagnostic data to Microsoft**.
11. Vérifiez la page **Ready to install**, puis cliquez sur **Install**.
12. À la fin de l'installation, cochez **Start Windows Admin Center** et cliquez sur **Finish**.

### Premier Accès

1. Depuis un poste d'administration, ouvrez `https://wac.lab.local` dans Edge ou Chrome.
2. Connectez-vous avec un compte membre du groupe Administrateurs local de SRV-WAC-01.
3. Le navigateur ne doit afficher aucun avertissement de certificat. Dans le cas contraire, reportez-vous à la section Dépannage.

### Contrôle d'Accès à la Passerelle

1. Cliquez sur l'icône d'engrenage (**Settings**) en haut à droite.
2. Dans la section **Gateway**, sélectionnez **Access**.
3. Dans l'onglet **Users**, cliquez sur **Add**, saisissez `LAB\GG-WAC-Users` et validez.
4. Dans l'onglet **Administrators**, cliquez sur **Add**, saisissez `LAB\GG-WAC-Admins` et validez.

<div class="callout callout-note">

Dès qu'un groupe est ajouté dans **Users**, seuls ses membres et les administrateurs de la passerelle peuvent se connecter. La même page permet de choisir Microsoft Entra ID comme fournisseur d'identité, pour bénéficier de l'accès conditionnel et de la MFA.

</div>

### Ajout des Connexions

1. Revenez sur la page **All connections**.
2. Cliquez sur **+ Add**, puis sur **Add** dans la vignette **Servers**.
3. Dans l'onglet **Add one**, saisissez `SRV-HV-01.lab.local` et cliquez sur **Add**.
4. Pour ajouter plusieurs serveurs, utilisez l'onglet **Search Active Directory** (recherche par nom, par exemple `SRV*`) ou l'onglet **Import a list** avec un fichier texte d'un nom par ligne.
5. Pour un cluster, utilisez la vignette **Server clusters** et saisissez `SRV-HVCLU-01.lab.local`.
6. Sélectionnez une connexion, cliquez sur **Edit Tags** et ajoutez des étiquettes (par exemple `Hyper-V`, `Production`) pour filtrer la liste.

<div class="callout callout-note">

Les connexions ajoutées par un utilisateur lui sont propres. Les connexions ajoutées par un administrateur de la passerelle peuvent être partagées avec tous les utilisateurs via l'import PowerShell (voir Méthode 2).

</div>

### Activation du RBAC sur un Serveur Géré

1. Dans **All connections**, ouvrez la connexion `SRV-FIC-01.lab.local` avec un compte administrateur de ce serveur.
2. Dans le menu de gauche, sélectionnez **Settings** (en bas de la liste des outils).
3. Sélectionnez **Role-based access control**.
4. Cliquez sur **Apply**. WAC installe le point de terminaison JEA et redémarre WinRM.
5. Une fois l'opération terminée, ajoutez les groupes AD voulus dans les groupes locaux de SRV-FIC-01 créés par WAC, par exemple `LAB\GG-WAC-Users` dans **Windows Admin Center Readers**.

### Gestion des Extensions

1. Ouvrez **Settings** > **Extensions**.
2. L'onglet **Available extensions** liste les extensions du flux. Sélectionnez une extension et cliquez sur **Install**.
3. L'onglet **Installed extensions** permet de mettre à jour ou de désinstaller une extension.
4. L'onglet **Feeds** permet d'ajouter un flux interne (partage réseau ou serveur NuGet) pour les environnements sans Internet.

### Délégation Kerberos pour l'Authentification Unique

La délégation se configure dans AD, pas dans l'interface de WAC. Elle est décrite dans la Méthode 2, car la console **Active Directory Users and Computers** ne permet pas de définir la délégation basée sur les ressources.

## Méthode 2 : Configuration via PowerShell

### Installation Silencieuse

Sur SRV-WAC-01, dans une session PowerShell en tant qu'administrateur :

```powershell
# Téléchargement de l'installeur
Start-BitsTransfer -Source 'https://aka.ms/WACdownload' -Destination 'C:\Temp\WindowsAdminCenter.exe'

# Empreinte du certificat émis pour wac.lab.local
$cert = Get-ChildItem -Path Cert:\LocalMachine\My |
    Where-Object { $_.Subject -eq 'CN=wac.lab.local' } |
    Sort-Object NotAfter -Descending | Select-Object -First 1
$cert.Thumbprint

# Installation silencieuse sur le port 443 avec le certificat
Start-Process -FilePath 'C:\Temp\WindowsAdminCenter.exe' `
    -ArgumentList '/VERYSILENT', '/HTTPSPortNumber=443', "/CertificateThumbprint=$($cert.Thumbprint)" `
    -Wait

# Démarrage du service si nécessaire
Start-Service -Name WindowsAdminCenter
Get-Service -Name WindowsAdminCenter
```

### Remplacement du Certificat

Lors du renouvellement du certificat, ou pour remplacer un certificat auto-signé :

```powershell
Import-Module "$env:ProgramFiles\WindowsAdminCenter\PowerShellModules\Microsoft.WindowsAdminCenter.Configuration"

# Association du nouveau certificat par son nom de sujet
Set-WACCertificateSubjectName -SubjectName 'CN=wac.lab.local'
# Ou par son empreinte
# Set-WACCertificateSubjectName -Thumbprint '<empreinte>'

# Accès de NETWORK SERVICE à la clé privée
Set-WACCertificateAcl -SubjectName 'CN=wac.lab.local'

Restart-Service -Name WindowsAdminCenter
```

<div class="callout callout-note">

Le nom de sujet doit être unique dans le magasin `LocalMachine\My`. Supprimez l'ancien certificat après le renouvellement, ou utilisez le paramètre `-Thumbprint`.

</div>

### Changement du Port d'Écoute

Le même module permet de modifier le port HTTPS et la plage de ports interne des microservices :

```powershell
Import-Module "$env:ProgramFiles\WindowsAdminCenter\PowerShellModules\Microsoft.WindowsAdminCenter.Configuration"
# Syntaxe documentée : port HTTPS et plage de ports interne des microservices
Set-WACHttpsPort -Wacport <port> -ServicePortRangeStart <port> -ServicePortRangeEnd <port>
Restart-Service -Name WindowsAdminCenter
```

### Pare-feu de la Passerelle

L'installeur crée la règle d'entrée du port choisi. Vérifiez-la et restreignez-la au sous-réseau d'administration :

```powershell
Get-NetFirewallPortFilter -Protocol TCP |
    Where-Object LocalPort -eq 443 |
    Get-NetFirewallRule |
    Select-Object DisplayName, Enabled, Direction, Action

# Exemple de restriction de la règle trouvée au sous-réseau du lab
# Set-NetFirewallRule -DisplayName '<nom de la règle>' -RemoteAddress 192.168.10.0/24
```

### Import et Export des Connexions

Le module ConnectionTools importe une liste de connexions partagée par tous les utilisateurs. La clé d'accès se trouve dans **Settings** > **Advanced** de l'interface web.

Fichier `C:\Temp\connexions.csv` :

```text
"name","type","tags","groupId"
"SRV-HV-01.lab.local","msft.sme.connection-type.server","Hyper-V|Production","global"
"SRV-HV-02.lab.local","msft.sme.connection-type.server","Hyper-V|Production","global"
"SRV-FIC-01.lab.local","msft.sme.connection-type.server","Fichiers","global"
"SRV-HVCLU-01.lab.local","msft.sme.connection-type.cluster","Hyper-V|Cluster","global"
```

```powershell
Import-Module "$env:ProgramFiles\WindowsAdminCenter\PowerShellModules\Microsoft.WindowsAdminCenter.ConnectionTools"

$gw  = 'https://wac.lab.local'
$key = '<clé d''accès copiée depuis Settings > Advanced>'

# Sauvegarde de la liste actuelle
Export-WACConnection $gw -FileName 'C:\Temp\connexions-avant.csv' -AccessKey $key

# Import de la liste partagée (groupId "global")
Import-WACConnection $gw -FileName 'C:\Temp\connexions.csv' -AccessKey $key
```

<div class="callout callout-note">

Le paramètre `-prune` supprime de la passerelle les connexions absentes du fichier. Utilisez-le seulement si le fichier CSV est la référence complète.

</div>

### Délégation Kerberos pour l'Authentification Unique

Sans délégation, la passerelle ne peut pas réutiliser le jeton Kerberos de l'utilisateur vers les nœuds et WAC redemande les identifiants. La délégation contrainte basée sur les ressources (RBCD) s'applique sur chaque serveur géré :

```powershell
# Sur un poste disposant du module ActiveDirectory
$gateway = Get-ADComputer -Identity 'SRV-WAC-01'

foreach ($node in 'SRV-HV-01', 'SRV-HV-02', 'SRV-FIC-01') {
    Set-ADComputer -Identity $node -PrincipalsAllowedToDelegateToAccount $gateway
}

# Vérification
Get-ADComputer -Identity 'SRV-HV-01' -Properties PrincipalsAllowedToDelegateToAccount |
    Select-Object Name, PrincipalsAllowedToDelegateToAccount
```

<div class="callout callout-note">

`Set-ADComputer -PrincipalsAllowedToDelegateToAccount` remplace la valeur existante. Si un autre compte est déjà autorisé sur le nœud, fournissez la liste complète des comptes. Les comptes marqués **Account is sensitive and cannot be delegated** ou membres de **Protected Users** ne bénéficient pas de la délégation : ils doivent saisir leurs identifiants dans **Manage as**.

</div>

### Déploiement du RBAC à Grande Échelle

La passerelle produit un paquet contenant la configuration JEA du RBAC, que vous pouvez déployer par script ou par DSC sur tous les nœuds :

```powershell
$gw = 'https://wac.lab.local'
Invoke-RestMethod -Uri "$gw/api/nodes/all/features/jea/endpoint/export" `
    -Method POST -UseDefaultCredentials -OutFile 'C:\Temp\WindowsAdminCenter_RBAC.zip'
```

Le fichier ZIP contient les modules, les fichiers de capacité de rôle et le script de configuration à appliquer sur chaque serveur. Après déploiement, peuplez les groupes locaux **Windows Admin Center Administrators**, **Windows Admin Center Hyper-V Administrators** et **Windows Admin Center Readers** par GPO (groupes restreints ou préférences de groupes locaux).

### Gestion des Extensions

Le module ExtensionTools gère les flux et les extensions de la passerelle :

```powershell
# Repérage du module dans le dossier d'installation
Get-ChildItem "$env:ProgramFiles\WindowsAdminCenter\PowerShellModules"
Import-Module '<chemin du module ExtensionTools trouvé ci-dessus>'

$gw = 'https://wac.lab.local'
Get-Feed $gw
Get-Extension $gw | Select-Object id, version, status

# Ajout d'un flux interne
Add-Feed -GatewayEndpoint $gw -Feed '\\SRV-FIC-01.lab.local\WAC-Feed'

# Installation et mise à jour d'une extension
Install-Extension -GatewayEndpoint $gw -ExtensionId '<id de l''extension>'
Update-Extension  -GatewayEndpoint $gw -ExtensionId '<id de l''extension>'
```

<div class="callout callout-note">

La documentation Microsoft cite encore le chemin de module de la version legacy (`Windows Admin Center\PowerShell\Modules\ExtensionTools`). Vérifiez le chemin réel sur votre passerelle avant d'automatiser. Seuls les administrateurs de la passerelle peuvent modifier les extensions.

</div>

### Haute Disponibilité (aperçu)

Depuis la version 2511, le script `Deploy-GatewayV2Ha.Deploy.ps1`, fourni dans l'archive `Deploy-GatewayV2Ha.zip`, installe WAC comme service générique sur un cluster de basculement. Il attend notamment `-ClusterStorage` (chemin d'un CSV d'au moins 10 Go), `-ClientAccessPoint` (nom d'accès), `-InstallerPath`, `-CertificateThumbprint` (certificat présent sur chaque nœud) et, en option, `-HttpsPort`. Le script prend en charge `-WhatIf` et `-Verbose`.

### Windows Admin Center dans Azure (Azure Arc)

Pour un serveur déjà activé par Azure Arc, WAC s'utilise directement depuis le portail Azure :

1. Dans le portail Azure, ouvrez la ressource **Machine - Azure Arc** du serveur.
2. Dans le menu **Settings**, sélectionnez **Windows Admin Center**, puis cliquez sur **Set up** pour installer l'extension `AdminCenter`.
3. Attribuez aux administrateurs le rôle Azure **Windows Admin Center Administrator Login** sur la ressource.
4. Cliquez sur **Connect** pour ouvrir WAC dans le portail.

Aucun port entrant n'est nécessaire. Le serveur doit pouvoir joindre les points de terminaison du service, identifiés par la balise de service `WindowsAdminCenter`.

## Vérifications

**Service :** `Get-Service WindowsAdminCenter` sur SRV-WAC-01 affiche `Running` et un type de démarrage automatique.

**Écoute réseau :**

```powershell
Get-NetTCPConnection -LocalPort 443 -State Listen
Test-NetConnection -ComputerName wac.lab.local -Port 443   # depuis un poste d'administration
```

**Certificat :** l'accès à `https://wac.lab.local` n'affiche aucun avertissement, et le certificat présenté par le navigateur est celui de l'autorité interne avec la bonne date d'expiration.

**Contrôle d'accès :** un compte hors des groupes `LAB\GG-WAC-Users` et `LAB\GG-WAC-Admins` est refusé à la connexion. Un membre de `LAB\GG-WAC-Users` n'a pas accès à **Settings** > **Gateway**.

**Connexions et authentification unique :** l'ouverture de SRV-HV-01 depuis WAC ne demande pas d'identifiants à un administrateur de SRV-HV-01. Depuis SRV-WAC-01, la commande `Enter-PSSession -ComputerName SRV-HV-01.lab.local` aboutit.

**RBAC :** sur SRV-FIC-01, `Get-PSSessionConfiguration -Name 'Microsoft.Sme.PowerShell'` renvoie le point de terminaison, et `Get-LocalGroup -Name 'Windows Admin Center*'` liste les trois groupes.

**Extensions :** **Settings** > **Extensions** > **Installed extensions** ne signale aucune mise à jour en attente.

## Dépannage

**Le service ne démarre pas après un changement de certificat :** NETWORK SERVICE n'a pas accès à la clé privée, ou l'empreinte est incorrecte. Exécutez `Set-WACCertificateAcl`, ou dans `certlm.msc`, clic droit sur le certificat > **All Tasks** > **Manage Private Keys** et accordez la lecture à **NETWORK SERVICE**. Consultez le journal **WindowsAdminCenter** dans l'Observateur d'événements.

**Avertissement de certificat dans le navigateur :** le nom saisi dans la barre d'adresse ne figure pas dans le SAN, le certificat a expiré, ou la chaîne de l'autorité interne n'est pas approuvée par le poste. Vérifiez les noms DNS du certificat et le déploiement de la racine par GPO.

**La page ne s'affiche pas depuis un poste distant :** le port 443 est bloqué ou le DNS ne résout pas `wac.lab.local`. Testez avec `Test-NetConnection wac.lab.local -Port 443` et `Resolve-DnsName wac.lab.local`.

**Erreur de connexion TLS liée à HTTP/2 :** certains environnements (inspection TLS, proxy) gèrent mal HTTP/2. La documentation des problèmes connus propose de désactiver HTTP/2 côté navigateur par les valeurs de registre `EnableHttp2Tls` et `EnableHttp2Cleartext` à 0. Appliquez ce contournement sur le poste qui exécute le navigateur, après validation.

**Erreur « WinRM » ou « Can't connect » sur un serveur géré :** WinRM est arrêté, le port 5985 est filtré, ou le nom n'est pas résolu. Depuis SRV-WAC-01, testez `Test-NetConnection SRV-HV-01.lab.local -Port 5985` puis `Enter-PSSession -ComputerName SRV-HV-01.lab.local`. Sur le nœud, vérifiez `Get-Service WinRM` et réactivez si besoin avec `Enable-PSRemoting`.

**Les identifiants sont redemandés à chaque connexion :** la délégation RBCD n'est pas en place ou le cache Kerberos de SRV-WAC-01 contient encore un ticket refusé. Vérifiez `PrincipalsAllowedToDelegateToAccount` sur le nœud, puis videz le cache du compte ordinateur sur SRV-WAC-01 avec `klist purge -li 0x3e7`, ou attendez environ 15 minutes.

**Les outils Remote Desktop, PowerShell ou Events ne s'ouvrent pas :** un proxy ou un pare-feu applicatif bloque les WebSockets entre le navigateur et la passerelle. Autorisez les WebSockets pour `wac.lab.local`.

**L'activation du RBAC échoue ou reste en cours :** WinRM a été redémarré et la session a été perdue. Patientez jusqu'à 10 minutes, puis rafraîchissez. Vérifiez la présence du point de terminaison avec `Get-PSSessionConfiguration`.

## Conseils et Bonnes Pratiques

**Dédier la passerelle.** SRV-WAC-01 n'héberge aucun autre rôle. Appliquez-lui le durcissement des serveurs d'administration, Windows LAPS pour son compte administrateur local, et limitez les ouvertures de session interactive aux administrateurs de la passerelle.

**Une passerelle par niveau d'administration.** Les contrôleurs de domaine SRV-DC-01 et SRV-DC-02 sont gérés depuis une passerelle de niveau 0 distincte, ou depuis les outils RSAT d'un poste d'administration privilégié, jamais depuis la passerelle des serveurs membres.

**Utiliser des groupes, jamais des comptes nominatifs.** L'accès à la passerelle et l'appartenance aux groupes RBAC passent par des groupes AD, ce qui facilite les revues d'accès.

**Préférer RBCD à CredSSP.** La délégation contrainte basée sur les ressources n'expose pas les identifiants sur la passerelle. Réservez CredSSP aux outils qui l'exigent.

**Activer les mises à jour automatiques.** Le cycle de vie moderne impose de suivre les versions. Testez la nouvelle version sur une passerelle de préproduction si votre équipe en dispose.

**Sauvegarder la configuration.** Exportez régulièrement les connexions avec `Export-WACConnection` et sauvegardez la VM de passerelle. Notez la liste des extensions installées.

**Superviser la passerelle.** Collectez le journal **WindowsAdminCenter** et surveillez la date d'expiration du certificat TLS pour anticiper son renouvellement.

**Envisager Windows Admin Center dans Azure.** Pour les serveurs déjà activés par Azure Arc, en particulier sur des sites distants, la version Azure supprime la passerelle locale et apporte la MFA via Microsoft Entra ID.

## Procédures Liées

- [Installation de Windows Server 2025](/procedures/windows/installation-de-windows-server-2025) *(Préparation du serveur de passerelle SRV-WAC-01)*
- [Configuration de PowerShell Remoting et de JEA](/procedures/windows/configuration-de-powershell-remoting-et-de-jea) *(WinRM sur les nœuds et fonctionnement du RBAC)*
- Intégration de Serveurs avec Azure Arc *(Prérequis de Windows Admin Center dans Azure)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Séparation des passerelles par niveau)*
- [Configuration du Pare-feu Windows et des Règles de Sécurité de Connexion](/procedures/windows/configuration-du-pare-feu-windows-et-des-regles-de-securite-de-connexion) *(Ouverture des ports 443, 5985 et 445)*
- [Déploiement de Windows LAPS](/procedures/windows/deploiement-de-windows-laps) *(Protection du compte administrateur local de la passerelle)*
