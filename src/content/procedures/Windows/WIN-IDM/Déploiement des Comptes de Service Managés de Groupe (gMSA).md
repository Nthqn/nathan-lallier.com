---
modele: "procedure"
titre: "Déploiement des Comptes de Service Managés de Groupe (gMSA)"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-IDM-SEC"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit le déploiement des comptes de service managés de groupe (gMSA) dans le domaine `lab.local`, dont les contrôleurs SRV-DC-01 et SRV-DC-02 sont sous Windows Server 2025. Elle couvre la création de la clé racine KDS, la création du gMSA, l'autorisation des serveurs hôtes, l'installation du compte sur ces serveurs et son utilisation par un service Windows, un pool d'applications IIS et une tâche planifiée.

Elle présente aussi les comptes de service managés délégués (dMSA), introduits par Windows Server 2025, et indique quand les préférer. Les comptes de service managés autonomes (sMSA) et les comptes virtuels sont seulement évoqués dans le comparatif.

## Contexte et Justification

Les applications métier tournent encore très souvent sous un compte utilisateur de domaine classique, par exemple `svc-web`. Ce modèle pose plusieurs problèmes en production.

- Le mot de passe est saisi par un administrateur, rarement changé, et souvent configuré pour ne jamais expirer.
- Il est connu de plusieurs personnes et finit dans des scripts, des fichiers de configuration ou un gestionnaire de mots de passe partagé.
- Le compte porte un SPN, ce qui l'expose au Kerberoasting : n'importe quel utilisateur du domaine peut demander un ticket de service et tenter de casser le mot de passe hors ligne.
- Changer le mot de passe impose une intervention coordonnée sur chaque serveur qui l'utilise, avec un risque d'interruption de service.

Le gMSA règle ces points. Le mot de passe est calculé par les contrôleurs de domaine à partir de la clé racine KDS, il est long et aléatoire, il change automatiquement (30 jours par défaut) et seuls les ordinateurs explicitement autorisés peuvent le récupérer. Aucun humain ne le connaît, et le même compte peut servir sur plusieurs serveurs d'une ferme, ce qui le rend compatible avec l'équilibrage de charge et l'authentification Kerberos mutuelle.

## Concepts Clés

**Clé racine KDS (Key Distribution Service).** Secret stocké dans la partition de configuration de la forêt (`CN=Master Root Keys,CN=Group Key Distribution Service,CN=Services,CN=Configuration,DC=lab,DC=local`). Les contrôleurs de domaine s'en servent pour dériver les mots de passe des gMSA. Une seule clé suffit pour toute la forêt.

**Délai de 10 heures.** Après la création de la clé, les contrôleurs de domaine attendent jusqu'à 10 heures avant de l'utiliser, le temps que la réplication la diffuse à tous les DC. Un gMSA utilisé trop tôt peut échouer à récupérer son mot de passe sur un DC qui n'a pas encore reçu la clé.

**gMSA (objet `msDS-GroupManagedServiceAccount`).** Compte de domaine dont le nom se termine par `$`, créé par défaut dans le conteneur `CN=Managed Service Accounts`. Il porte un attribut `DNSHostName` obligatoire et un intervalle de changement de mot de passe défini à la création.

**PrincipalsAllowedToRetrieveManagedPassword.** Liste des principaux (en pratique un groupe de sécurité contenant des comptes ordinateurs) autorisés à lire le mot de passe managé. Elle est stockée dans l'attribut `msDS-GroupMSAMembership`.

**Install-ADServiceAccount et Test-ADServiceAccount.** Cmdlets exécutées sur le serveur hôte. La première installe le gMSA localement pour qu'il puisse être utilisé par les services. La seconde vérifie que le serveur peut récupérer le mot de passe et renvoie `True` ou `False`.

**dMSA (delegated Managed Service Account).** Nouveau type de compte introduit par Windows Server 2025. Il permet de migrer un compte de service classique vers un compte managé dont les clés sont aléatoires, puis de désactiver le mot de passe de l'ancien compte. Son secret est dérivé du compte ordinateur, conservé par le contrôleur de domaine et lié à l'identité de la machine, ce qui limite le vol d'identifiants. Il se crée avec `New-ADServiceAccount -CreateDelegatedServiceAccount`.

| Type de compte | Portée | Gestion du mot de passe | Cas d'usage |
|----------------|--------|-------------------------|-------------|
| Compte virtuel (`NT SERVICE\...`) | Un seul serveur | Ordinateur | Service local accédant au réseau avec le compte machine |
| sMSA | Un seul serveur | Ordinateur | Service sur un serveur unique (historique) |
| gMSA | Plusieurs serveurs | Contrôleurs de domaine, récupéré par les hôtes | Fermes web, tâches planifiées, services multi-serveurs |
| dMSA | Machines autorisées | Secret détenu par le DC, lié à la machine | Remplacement d'un compte de service existant sous Windows Server 2025 |

: Types de comptes de service

## Prérequis

- Une forêt et un domaine `lab.local` au niveau fonctionnel Windows Server 2012 ou supérieur (le niveau Windows Server 2025 du lab convient).
- Un compte membre de Domain Admins ou Enterprise Admins pour créer la clé racine KDS. La création des gMSA peut ensuite être déléguée.
- Le module PowerShell ActiveDirectory sur SRV-DC-01 ou sur un poste d'administration avec RSAT, en PowerShell 64 bits.
- Deux serveurs membres hôtes pour l'exemple, `SRV-APP-01` et `SRV-APP-02`, joints au domaine et disposant du module ActiveDirectory (fonctionnalité RSAT-AD-PowerShell) pour exécuter `Install-ADServiceAccount`.
- Une réplication saine entre SRV-DC-01 et SRV-DC-02 (`repadmin /replsummary` sans erreur).
- Une synchronisation horaire correcte dans le domaine, Kerberos tolérant par défaut un écart de 5 minutes.
- Une application qui prend en charge les comptes de service managés (service Windows, pool IIS, tâche planifiée ou produit documenté comme compatible, par exemple SQL Server).

## Points de Vigilance

**Le délai de 10 heures n'est pas un défaut.** En production, créez la clé avec `Add-KdsRootKey -EffectiveImmediately` et attendez la réplication complète avant de créer le premier gMSA. Le contournement par une date antérieure de 10 heures (`-EffectiveTime ((Get-Date).AddHours(-10))`) est documenté par Microsoft pour les environnements de test à un seul DC. Ne l'utilisez que dans le lab.

**Ne supprimez pas et ne recréez pas la clé racine KDS sans raison.** La clé est mise en cache par le service KDC. Microsoft indique qu'après une recréation, l'ancienne clé peut continuer à être utilisée et qu'il faut redémarrer le KDC sur tous les DC.

**La clé racine KDS est un secret de Tier 0.** Un attaquant qui lit la clé et les attributs d'un gMSA peut calculer ses mots de passe hors ligne (attaque dite Golden gMSA). Protégez la partition de configuration et les sauvegardes des contrôleurs de domaine en conséquence.

**L'intervalle de changement du mot de passe est figé à la création.** Le paramètre `-ManagedPasswordIntervalInDays` ne peut être défini qu'avec `New-ADServiceAccount`. Pour le modifier, il faut créer un nouveau gMSA.

**Le nom d'un gMSA doit être unique dans la forêt.** La création échoue si un gMSA du même nom existe déjà dans un autre domaine de la forêt. Limitez aussi le nom à 15 caractères, la partie NetBIOS (`sAMAccountName`) étant tronquée au-delà.

**L'appartenance au groupe n'est prise en compte qu'au prochain ticket.** Un serveur ajouté au groupe autorisé ne peut pas récupérer le mot de passe tant que son ticket Kerberos de compte ordinateur n'est pas renouvelé. Purgez les tickets du compte système (`klist -li 0x3e7 purge`) ou redémarrez le serveur.

**Les clusters de basculement ne prennent pas en charge les gMSA comme compte du service de cluster.** Les services Windows hébergés sur un cluster peuvent en revanche les utiliser.

**Ne placez pas un gMSA dans un groupe privilégié.** Un gMSA membre de Domain Admins reste un compte Tier 0 dont le mot de passe est lisible par chaque serveur hôte. Accordez uniquement les droits requis par l'application.

**RC4 est déprécié pour Kerberos sous Windows Server 2025.** Les systèmes qui utilisent un gMSA doivent prendre en charge AES. Positionnez `-KerberosEncryptionType AES128,AES256` à la création.

**Les dMSA sont récents.** Ils ne fonctionnent qu'avec des contrôleurs de domaine Windows Server 2025, exigent une configuration de registre côté client et leur processus de migration modifie l'ancien compte. Le droit de créer des objets dMSA dans une OU doit être considéré comme sensible. Maintenez les DC à jour et contrôlez qui peut créer des objets dans les OU.

## Choix Architecturaux & Alternatives

### Quand choisir un gMSA

Le gMSA est le bon choix dès qu'un service Windows doit s'authentifier sur le réseau avec une identité de domaine et que l'application accepte un compte sans mot de passe saisi. Il est particulièrement adapté :

- aux fermes de serveurs (IIS en équilibrage de charge, nœuds d'une application) qui doivent partager la même identité Kerberos et le même SPN ;
- aux tâches planifiées qui accèdent à des partages ou à des bases de données ;
- au remplacement progressif des comptes `svc-*` à mot de passe permanent, exposés au Kerberoasting.

Préférez un dMSA lorsque tous les DC sont sous Windows Server 2025 et que l'objectif est de remplacer un compte de service existant sans reconfigurer chaque application. Gardez un compte de service classique uniquement pour les applications qui exigent la saisie d'un mot de passe, en compensant par un mot de passe long, une rotation outillée et une politique d'authentification restrictive.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **gMSA** | Services et tâches sur un ou plusieurs serveurs | Mot de passe aléatoire et rotation automatique, partage multi-serveurs | Mot de passe lisible par chaque hôte autorisé, non lié à la machine | Gratuit |
| **dMSA (Windows Server 2025)** | Migration d'un compte de service existant | Secret lié à la machine, ancien mot de passe désactivé | Fonction récente, DC Windows Server 2025 obligatoires | Gratuit |
| **sMSA** | Service sur un serveur unique | Simple, sans clé partagée | Un seul serveur, remplacé en pratique par le gMSA | Gratuit |
| **Compte virtuel ou compte machine** | Service local qui accède au réseau | Aucune gestion de compte | Droits accordés à l'ordinateur entier | Gratuit |
| **Compte utilisateur de service** | Application incompatible avec les comptes managés | Compatibilité universelle | Mot de passe manuel, Kerberoasting | Faible, charge d'exploitation élevée |
| **Coffre de secrets avec rotation (PAM tiers)** | Comptes de service hors Windows | Rotation outillée, traçabilité | Licence et intégration à maintenir | Élevé |

### Impact des choix

- **Sécurité.** Le gMSA supprime le mot de passe humain et rend le Kerberoasting inopérant en pratique. Le risque se déplace vers les hôtes autorisés et vers la clé racine KDS. Le dMSA réduit encore ce risque en liant le secret à la machine.
- **Disponibilité.** Le mot de passe est obtenu auprès d'un DC. Avec SRV-DC-01 et SRV-DC-02, la perte d'un DC n'empêche pas la récupération. Une réplication cassée peut en revanche empêcher un hôte de trouver la clé KDS sur le DC qu'il interroge.
- **Exploitation.** Plus de changement de mot de passe planifié ni de fenêtre de maintenance associée. L'ajout d'un serveur à la ferme se résume à l'ajout de son compte ordinateur au groupe autorisé.
- **Coût.** Fonctionnalité native d'Active Directory, sans licence supplémentaire.

## Méthode 1 : Configuration via la Console Utilisateurs et ordinateurs Active Directory (dsa.msc) et les Consoles des Services

La clé racine KDS et l'objet gMSA ne se créent pas depuis une console graphique. Ces deux étapes restent en PowerShell. Le reste de la mise en œuvre (groupe d'hôtes, affectation du compte aux services) se fait dans les consoles.

### Créer la Clé Racine KDS

Sur SRV-DC-01, dans une session PowerShell en administrateur :

```powershell
# Production : la clé devient utilisable après réplication (jusqu'à 10 h)
Add-KdsRootKey -EffectiveImmediately

# Lab à DC unique uniquement : clé utilisable immédiatement
# Add-KdsRootKey -EffectiveTime ((Get-Date).AddHours(-10))
```

<div class="callout callout-note">

Vérifiez d'abord qu'aucune clé n'existe avec `Get-KdsRootKey`. Une seule clé suffit pour toute la forêt.

</div>

### Créer le Groupe des Serveurs Hôtes

1. Ouvrez `dsa.msc` sur SRV-DC-01.
2. Dans l'OU des groupes, par exemple `OU=Groupes,OU=LAB,DC=lab,DC=local`, faites un clic droit > **Nouveau > Groupe**.
3. **Nom :** `GG-gMSA-Web-Hosts`. **Étendue :** Globale. **Type :** Sécurité.
4. Ouvrez les propriétés du groupe > onglet **Membres** > **Ajouter**.
5. Cliquez sur **Types d'objets**, cochez **Ordinateurs**, puis ajoutez `SRV-APP-01` et `SRV-APP-02`.

### Créer le gMSA

Sur SRV-DC-01, en PowerShell :

```powershell
New-ADServiceAccount -Name "gmsa-web" `
    -DNSHostName "gmsa-web.lab.local" `
    -PrincipalsAllowedToRetrieveManagedPassword "GG-gMSA-Web-Hosts" `
    -KerberosEncryptionType AES128,AES256
```

Le compte apparaît dans `dsa.msc` sous **Managed Service Accounts** (activez **Affichage > Fonctionnalités avancées** si le conteneur n'est pas visible).

### Installer le gMSA sur les Serveurs Hôtes

Sur `SRV-APP-01` puis `SRV-APP-02` :

1. Purgez les tickets du compte ordinateur pour prendre en compte la nouvelle appartenance au groupe, ou redémarrez le serveur :

   ```cmd
   klist -li 0x3e7 purge
   ```

2. En PowerShell administrateur :

   ```powershell
   Install-ADServiceAccount -Identity "gmsa-web"
   Test-ADServiceAccount -Identity "gmsa-web"
   ```

`Test-ADServiceAccount` doit renvoyer `True`.

### Affecter le gMSA à un Service Windows

1. Ouvrez `services.msc` sur le serveur hôte.
2. Ouvrez les propriétés du service > onglet **Connexion**.
3. Sélectionnez **Ce compte**, saisissez `LAB\gmsa-web$`.
4. Laissez les champs **Mot de passe** et **Confirmer le mot de passe** vides.
5. Validez. Windows accorde automatiquement le droit **Ouvrir une session en tant que service** au compte.
6. Redémarrez le service.

<div class="callout callout-note">

Le `$` final est obligatoire. Sans lui, Windows cherche un compte utilisateur et demande un mot de passe.

</div>

### Affecter le gMSA à un Pool d'Applications IIS

1. Ouvrez le Gestionnaire IIS (`inetmgr`) > **Pools d'applications**.
2. Sélectionnez le pool > **Paramètres avancés** > **Identité** > bouton **...**.
3. Choisissez **Compte personnalisé** > **Définir**, saisissez `LAB\gmsa-web$` et laissez le mot de passe vide.
4. Validez puis recyclez le pool.

### Affecter le gMSA à une Tâche Planifiée

Le Planificateur de tâches graphique (`taskschd.msc`) ne permet pas de saisir un gMSA sans mot de passe. Utilisez PowerShell, comme décrit dans la Méthode 2.

## Méthode 2 : Configuration via PowerShell

### Variables

```powershell
$gmsaName  = "gmsa-web"
$domain    = "lab.local"
$hostGroup = "GG-gMSA-Web-Hosts"
$groupOU   = "OU=Groupes,OU=LAB,DC=lab,DC=local"
$hosts     = "SRV-APP-01","SRV-APP-02"
```

### Créer la Clé Racine KDS

```powershell
if (-not (Get-KdsRootKey)) {
    Add-KdsRootKey -EffectiveImmediately
}
Get-KdsRootKey | Select-Object KeyId, EffectiveTime, CreationTime
```

### Créer le Groupe et y Ajouter les Hôtes

```powershell
New-ADGroup -Name $hostGroup -GroupScope Global -GroupCategory Security -Path $groupOU `
    -Description "Serveurs autorisés à récupérer le mot de passe de $gmsaName"

foreach ($h in $hosts) {
    Add-ADGroupMember -Identity $hostGroup -Members (Get-ADComputer $h)
}
```

### Créer le gMSA

```powershell
New-ADServiceAccount -Name $gmsaName `
    -DNSHostName "$gmsaName.$domain" `
    -PrincipalsAllowedToRetrieveManagedPassword $hostGroup `
    -KerberosEncryptionType AES128,AES256 `
    -ServicePrincipalNames "HTTP/web.lab.local","HTTP/web"

Get-ADServiceAccount -Identity $gmsaName -Properties PrincipalsAllowedToRetrieveManagedPassword, msDS-ManagedPasswordInterval
```

<div class="callout callout-note">

N'ajoutez `-ServicePrincipalNames` que si l'application est accédée en Kerberos par un nom de service (ici le nom d'équilibrage `web.lab.local`). Pour un gMSA réservé aux connexions sortantes, utilisez `-RestrictToOutboundAuthenticationOnly`.

</div>

### Installer et Tester sur les Hôtes

```powershell
Invoke-Command -ComputerName $hosts -ScriptBlock {
    klist.exe -li 0x3e7 purge | Out-Null
    Install-ADServiceAccount -Identity $using:gmsaName
    [pscustomobject]@{
        Serveur = $env:COMPUTERNAME
        Test    = Test-ADServiceAccount -Identity $using:gmsaName
    }
}
```

### Utiliser le gMSA

**Service Windows** (depuis une invite `cmd.exe` en administrateur, Windows PowerShell 5.1 ne transmettant pas les chaînes vides aux exécutables) :

```cmd
sc.exe config "MonService" obj= "LAB\gmsa-web$" password= ""
sc.exe stop "MonService"
sc.exe start "MonService"
```

**Tâche planifiée :**

```powershell
$action    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-File C:\Scripts\Export.ps1"
$trigger   = New-ScheduledTaskTrigger -Daily -At 02:00
$principal = New-ScheduledTaskPrincipal -UserId "LAB\gmsa-web$" -LogonType Password
Register-ScheduledTask -TaskName "Export-Nocturne" -Action $action -Trigger $trigger -Principal $principal
```

Le `-LogonType Password` indique au Planificateur de récupérer le mot de passe managé. Le gMSA doit disposer du droit **Ouvrir une session en tant que tâche** sur le serveur. Accordez-le par une GPO d'attribution des droits utilisateur ciblant les hôtes, plutôt que par l'ajout à un groupe local privilégié.

### Ajouter un Nouvel Hôte à la Ferme

```powershell
Add-ADGroupMember -Identity $hostGroup -Members (Get-ADComputer "SRV-APP-03")
# Puis sur SRV-APP-03 : klist -li 0x3e7 purge ; Install-ADServiceAccount gmsa-web
```

### Créer un dMSA (Windows Server 2025)

Le dMSA demande une préparation côté client et un état explicite. Les commandes ci-dessous reprennent la procédure Microsoft pour un dMSA autonome.

```powershell
# Sur SRV-DC-01
New-ADServiceAccount -Name "dmsa-app" -DNSHostName "dmsa-app.lab.local" `
    -CreateDelegatedServiceAccount -KerberosEncryptionType AES256

Set-ADServiceAccount -Identity "dmsa-app" -PrincipalsAllowedToRetrieveManagedPassword "SRV-APP-01$"

# L'état msDS-DelegatedMSAState doit valoir 3 pour un dMSA autonome
Set-ADServiceAccount -Identity "dmsa-app" -Replace @{"msDS-DelegatedMSAState" = 3}

# Sur SRV-APP-01 : activer la prise en charge des dMSA
New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Kerberos\Parameters" `
    -Name "DelegatedMSAEnabled" -Value 1 -PropertyType DWORD -Force
```

Pour remplacer un compte existant, Microsoft fournit `Start-ADServiceAccountMigration` puis `Complete-ADServiceAccountMigration` avec le paramètre `-SupersededAccount`. Ne supprimez jamais l'ancien compte à l'issue de la migration, il sert au retour arrière (`Undo-ADServiceAccountMigration`).

## Vérifications

**Clé racine KDS :** `Get-KdsRootKey` renvoie une clé dont l'`EffectiveTime` est dépassé. Le journal **Applications and Services Logs > Microsoft > Windows > KdsSvc > Operational** contient l'événement 4004.

**Objet gMSA :** `Get-ADServiceAccount gmsa-web -Properties *` affiche `Enabled = True`, le bon `DNSHostName` et le groupe attendu dans `PrincipalsAllowedToRetrieveManagedPassword`.

**Hôtes :** `Test-ADServiceAccount gmsa-web` renvoie `True` sur chaque serveur autorisé et `False` sur un serveur non autorisé.

**Service :** `Get-CimInstance Win32_Service -Filter "Name='MonService'" | Select-Object Name, StartName, State` affiche `LAB\gmsa-web$` et l'état `Running`.

**SPN :** `setspn -L LAB\gmsa-web$` liste les SPN déclarés et `setspn -X` ne signale aucun doublon.

**Rotation :** `Get-ADServiceAccount gmsa-web -Properties PasswordLastSet` montre une date récente après chaque intervalle.

## Dépannage

**« Key does not exist » ou échec de `New-ADServiceAccount` juste après la création de la clé :** la clé KDS n'est pas encore effective. Attendez la fin du délai et la réplication vers SRV-DC-02. Vérifiez avec `Get-KdsRootKey` et `repadmin /showrepl`.

**`Test-ADServiceAccount` renvoie `False` :** le serveur ne fait pas partie du groupe autorisé, ou son ticket Kerberos date d'avant l'ajout. Vérifiez l'appartenance avec `Get-ADComputer SRV-APP-01 | Get-ADPrincipalGroupMembership`, comparez avec `PrincipalsAllowedToRetrieveManagedPassword`, puis exécutez `klist -li 0x3e7 purge` ou redémarrez le serveur.

**Le service refuse de démarrer avec une erreur d'ouverture de session :** le compte a été saisi sans `$`, ou une GPO d'attribution de droits redéfinit **Ouvrir une session en tant que service** sans inclure le gMSA. Contrôlez avec `gpresult /h rapport.html` et ajoutez le gMSA à la GPO concernée.

**Échec d'authentification Kerberos vers l'application (repli NTLM) :** le SPN est absent, porté par un autre compte ou dupliqué. Recherchez-le avec `setspn -Q HTTP/web.lab.local`, supprimez le doublon avec `setspn -D`, puis ajoutez-le au gMSA avec `setspn -S HTTP/web.lab.local LAB\gmsa-web$`.

**La tâche planifiée ne s'exécute pas :** le gMSA n'a pas le droit **Ouvrir une session en tant que tâche** sur le serveur. Accordez-le par une GPO d'attribution des droits utilisateur.

**Un ancien hôte peut toujours utiliser le gMSA après son retrait du groupe :** le mot de passe en cache reste valide jusqu'au prochain changement. Désinstallez le compte avec `Uninstall-ADServiceAccount gmsa-web` sur cet hôte et, si l'hôte est considéré compromis, recréez le gMSA.

## Conseils et Bonnes Pratiques

**Un gMSA par application.** Ne mutualisez pas un même gMSA entre applications sans lien. Le périmètre d'un compte compromis reste ainsi limité à une seule application.

**Toujours passer par un groupe.** Autorisez un groupe `GG-gMSA-<App>-Hosts` plutôt que des comptes ordinateurs individuels. L'ajout ou le retrait d'un hôte devient une simple modification d'appartenance, traçable dans les journaux.

**Convention de nommage.** Préfixez les comptes (`gmsa-`, `dmsa-`) et restez sous 15 caractères. Renseignez la description avec l'application, le propriétaire et le ticket de création.

**Imposer AES.** Définissez `-KerberosEncryptionType AES128,AES256` sur chaque gMSA et suivez l'usage résiduel de RC4, déprécié pour Kerberos.

**Restreindre où le gMSA peut s'authentifier.** Une politique d'authentification peut limiter l'usage du gMSA aux hôtes autorisés, ce qui protège même si le mot de passe était extrait d'un serveur. Cette mesure s'intègre au modèle d'administration en tiers.

**Protéger la clé racine KDS comme un actif de Tier 0.** Limitez l'accès aux DC et à leurs sauvegardes, et surveillez les lectures de l'attribut `msDS-ManagedPassword` via l'audit d'accès à l'annuaire.

**Inventorier et migrer les comptes `svc-*`.** Listez les comptes utilisateurs portant un SPN (`Get-ADUser -Filter 'ServicePrincipalName -like "*"'`) et planifiez leur remplacement par des gMSA ou des dMSA.

## Procédures Liées

- [Gestion des Objets dans Active Directory](/procedures/windows/gestion-des-objets-dans-active-directory) *(Création des OU, groupes et comptes ordinateurs hôtes)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Classement des gMSA et des hôtes par tier)*
- [Stratégies de Mots de Passe Affinées et Groupe Protected Users](/procedures/windows/strategies-de-mots-de-passe-affinees-et-groupe-protected-users) *(Comptes de service non managés restants)*
- [Configuration d'un Serveur de Temps (NTP) pour un Domaine AD](/procedures/windows/configuration-dun-serveur-de-temps-ntp-pour-un-domaine-ad) *(Synchronisation horaire requise par Kerberos)*
- [Dépannage de la Réplication AD et de Kerberos](/procedures/windows/depannage-de-la-replication-ad-et-de-kerberos) *(Clé KDS non répliquée, SPN dupliqués)*
