---
modele: "procedure"
titre: "Délégation de l'Administration Active Directory"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-IDM-SEC"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit comment déléguer des tâches d'administration Active Directory à des équipes non administratrices du domaine `lab.local`, sans les ajouter à Domain Admins ni aux groupes intégrés à privilèges. Elle couvre la conception des groupes de délégation, l'Assistant Délégation de contrôle sur une unité d'organisation (OU), l'outil en ligne de commande `dsacls`, la délégation par ACL en PowerShell, ainsi que la vérification et le retrait des délégations.

L'exemple traité délègue au support de niveau 1 la réinitialisation des mots de passe et le déverrouillage des comptes utilisateurs de l'OU `OU=Utilisateurs,OU=LAB,DC=lab,DC=local`, et délègue à l'équipe poste de travail la gestion des comptes ordinateurs de l'OU `OU=Postes,OU=LAB,DC=lab,DC=local`. La délégation des GPO et la délégation Just Enough Administration (JEA) sur les serveurs sortent du périmètre.

## Contexte et Justification

Dans beaucoup de domaines, le support réinitialise des mots de passe avec un compte membre de Domain Admins, ou de groupes intégrés comme Account Operators, parce que c'est la solution la plus rapide à mettre en place. Les conséquences sont lourdes.

- Chaque technicien du support devient de fait un administrateur du domaine, avec un compte qui ouvre des sessions sur des postes de travail exposés.
- Le vol d'un seul de ces comptes donne le contrôle de toute la forêt.
- Aucune séparation n'existe entre les tâches courantes à faible risque et les opérations critiques.
- Les audits de conformité (ANSSI, CIS, ISO 27001) relèvent systématiquement des groupes privilégiés surpeuplés.

La délégation par OU répond au principe du moindre privilège. Elle accorde des permissions précises (réinitialiser un mot de passe, écrire un attribut, créer un type d'objet) sur un sous-ensemble de l'annuaire, à un groupe dédié. Le support peut travailler sans détenir aucun droit sur les contrôleurs de domaine, les comptes privilégiés ou la configuration de la forêt.

## Concepts Clés

**Unité d'organisation (OU).** Conteneur qui sert de périmètre de délégation et de cible de GPO. La structure d'OU se conçoit d'abord pour la délégation : on regroupe les objets administrés par une même équipe.

**ACE et ACL.** Chaque objet AD porte une liste de contrôle d'accès (ACL) composée d'entrées (ACE). Une ACE accorde ou refuse une permission à un principal, éventuellement limitée à une classe d'objets enfants ou à un attribut, et peut être héritée par les objets enfants.

**Types de permissions déléguables.**

| Type | Exemple | Usage |
|------|---------|-------|
| Permission générique | Contrôle total, Lecture, Écriture | À éviter en délégation, trop large |
| Création ou suppression d'objets enfants | Créer des objets Ordinateur | Équipe poste de travail |
| Lecture ou écriture d'un attribut | Écrire `lockoutTime`, `pwdLastSet` | Déverrouillage, forcer le changement de mot de passe |
| Droit étendu (control access) | Réinitialiser le mot de passe | Support de niveau 1 |
| Écriture validée | Écriture validée du nom d'hôte DNS, du SPN | Jonction de postes au domaine |

: Types de permissions Active Directory

**Assistant Délégation de contrôle.** Assistant de la console Utilisateurs et ordinateurs Active Directory qui ajoute des ACE héritables sur un conteneur. Il propose des tâches courantes (créer et gérer des comptes, réinitialiser des mots de passe, modifier l'appartenance aux groupes, joindre un ordinateur au domaine, gérer les liens de GPO) et des tâches personnalisées. Il ajoute des permissions mais ne sait pas les retirer.

**dsacls.** Outil en ligne de commande, équivalent de l'onglet **Sécurité**, qui affiche et modifie les ACL d'objets AD. Il est installé avec le rôle AD DS ou les outils RSAT.

**AdminSDHolder et SDProp.** Les comptes et groupes protégés (Domain Admins, Administrators, Account Operators, Backup Operators, etc.) reçoivent périodiquement l'ACL de l'objet `CN=AdminSDHolder,CN=System`. Une délégation posée sur une OU ne s'applique donc pas aux comptes privilégiés qu'elle contient, ce qui est voulu.

**Groupes intégrés à privilèges.** Account Operators, Server Operators, Backup Operators et Print Operators existent dans tout domaine. Leurs membres peuvent ouvrir une session localement sur les contrôleurs de domaine, et selon le groupe, gérer la plupart des comptes, arrêter des services, remplacer des fichiers système ou charger des pilotes sur les DC. Microsoft recommande de les laisser vides.

## Prérequis

- Un compte membre de Domain Admins ou disposant déjà du droit de modifier les permissions sur les OU cibles.
- SRV-DC-01 ou un poste d'administration avec RSAT (console `dsa.msc`, module PowerShell ActiveDirectory, `dsacls.exe`).
- Une structure d'OU existante, par exemple :
  - `OU=Utilisateurs,OU=LAB,DC=lab,DC=local` pour les comptes standards ;
  - `OU=Postes,OU=LAB,DC=lab,DC=local` pour les postes de travail ;
  - `OU=Groupes,OU=LAB,DC=lab,DC=local` pour les groupes.
- Les comptes du support dans une OU distincte de celle qu'ils administrent, idéalement des comptes d'administration séparés de leurs comptes bureautiques.
- La liste écrite des tâches à déléguer, par équipe, validée par le responsable sécurité.

## Points de Vigilance

**N'utilisez pas les groupes intégrés pour déléguer.** Account Operators peut créer et modifier la plupart des comptes et groupes du domaine et ouvrir une session sur les DC. Backup Operators et Server Operators peuvent remplacer des fichiers sur les DC. Print Operators peut charger des pilotes sur les DC. Chacun de ces groupes offre un chemin d'élévation vers le contrôle du domaine. Vérifiez qu'ils sont vides et surveillez toute modification de leur appartenance.

**Ne déléguez jamais à la racine du domaine sans nécessité.** Une ACE posée sur `DC=lab,DC=local` s'hérite sur tous les objets, y compris les OU de serveurs et d'administration. Ciblez l'OU la plus basse possible.

**Le droit de créer un objet donne le contrôle de cet objet.** Le créateur devient propriétaire de l'objet et peut en modifier tous les attributs et les permissions. Déléguer la création d'objets dans une OU revient donc à déléguer leur contrôle total.

**Évitez les permissions génériques.** « Contrôle total » ou « Écrire toutes les propriétés » sur les objets utilisateur permettent par exemple de modifier `servicePrincipalName`, `msDS-AllowedToActOnBehalfOfOtherIdentity` ou l'appartenance à des groupes, autant de chemins d'attaque. Préférez des droits étendus et des attributs nommés.

**Ne mélangez pas comptes standards et comptes privilégiés dans une OU déléguée.** Même si AdminSDHolder protège les membres actuels des groupes privilégiés, un compte retiré d'un groupe privilégié conserve `adminCount=1` et une ACL figée. À l'inverse, un compte ajouté plus tard à un groupe sensible non protégé resterait administrable par le support.

**L'Assistant ne retire rien.** Pour supprimer une délégation, passez par **Propriétés > Sécurité > Avancé** ou par `dsacls /R`. Documentez donc chaque délégation au moment où vous la créez.

**Déléguez à des groupes, jamais à des utilisateurs.** Une ACE nominative survit au départ de la personne et devient invisible lors des revues.

## Choix Architecturaux & Alternatives

### Quand choisir la délégation par OU

La délégation par OU est la méthode native pour toute organisation qui administre son annuaire avec plusieurs équipes : support, poste de travail, serveurs, RH ou exploitants applicatifs. Elle convient dès que les tâches répétitives (mots de passe, déverrouillage, jonction de postes, appartenance à certains groupes) sont effectuées par des personnes qui n'ont pas à administrer le domaine lui-même.

Elle constitue aussi le socle du modèle d'administration en tiers : chaque tier reçoit des délégations limitées aux OU qui le concernent. Pour des besoins plus dynamiques (élévation temporaire, approbation, journalisation fine), on la complète par un outil de gestion des accès privilégiés.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Délégation par OU (Assistant, dsacls, ACL)** | Support, équipes poste et serveur | Native, granulaire, sans infrastructure supplémentaire | ACL difficiles à auditer sans outillage, pas d'élévation temporaire | Gratuit |
| **Groupes intégrés (Account Operators, etc.)** | Héritage d'anciens domaines | Aucune configuration | Droits excessifs, accès local aux DC, chemin vers Domain Admins | Gratuit, à proscrire |
| **Domain Admins pour tous** | Petites structures non structurées | Simplicité immédiate | Surface d'attaque maximale, aucune séparation | Gratuit, à proscrire |
| **JEA sur des serveurs de gestion** | Tâches AD scriptées exposées via PowerShell Remoting | Commandes limitées, compte virtuel, transcription | Développement et maintenance des rôles | Faible |
| **Outil de gestion AD tiers (proxy d'administration)** | Grands comptes, workflows d'approbation | Rôles métiers, approbation, audit centralisé | Licence, composant à protéger comme du Tier 0 | Élevé |
| **Appartenance temporaire (fonction PAM d'AD, TTL de groupe)** | Élévation ponctuelle à un groupe privilégié | Droits expirant automatiquement | Requiert le niveau fonctionnel adéquat et une gouvernance des demandes | Faible |

### Impact des choix

- **Sécurité.** La délégation granulaire réduit le nombre de comptes capables de compromettre le domaine. Une délégation trop large (contrôle total sur les utilisateurs) recrée en revanche des chemins d'attaque exploitables par des outils d'analyse de graphes d'ACL.
- **Exploitation.** Le support devient autonome sur ses tâches courantes, sans escalade vers les administrateurs du domaine. En contrepartie, les ACL s'accumulent et doivent être revues régulièrement.
- **Auditabilité.** Une délégation à des groupes nommés selon une convention claire (`DL-Deleg-...`) se lit facilement. Des ACE nominatives ou des permissions génériques rendent l'audit impraticable.
- **Coût.** Aucun coût de licence. Le coût réel est la conception de la structure d'OU et la revue périodique des délégations.

## Méthode 1 : Configuration via la Console Utilisateurs et ordinateurs Active Directory (dsa.msc)

### Créer les Groupes de Délégation

On applique le modèle AGDLP : les comptes vont dans un groupe global métier, le groupe global va dans un groupe local de domaine qui porte la permission.

1. Ouvrez `dsa.msc` et placez-vous dans `OU=Groupes,OU=LAB,DC=lab,DC=local`.
2. Créez les groupes globaux de sécurité `GG-Support-N1` et `GG-Equipe-Postes`.
3. Créez les groupes locaux de domaine de sécurité :
   - `DL-Deleg-Utilisateurs-ResetPwd` ;
   - `DL-Deleg-Postes-GestionOrdinateurs`.
4. Ajoutez `GG-Support-N1` comme membre de `DL-Deleg-Utilisateurs-ResetPwd`, et `GG-Equipe-Postes` comme membre de `DL-Deleg-Postes-GestionOrdinateurs`.
5. Ajoutez les comptes des techniciens dans les groupes globaux.

### Déléguer la Réinitialisation des Mots de Passe

1. Faites un clic droit sur `OU=Utilisateurs` > **Délégation de contrôle**.
2. Page **Utilisateurs ou groupes** : ajoutez `DL-Deleg-Utilisateurs-ResetPwd`.
3. Page **Tâches à déléguer** : choisissez **Créer une tâche personnalisée à déléguer**.
4. Page **Type d'objet Active Directory** : sélectionnez **Seulement des objets suivants dans le dossier**, puis cochez **Objets Utilisateur**. Ne cochez pas la création ni la suppression.
5. Page **Autorisations** : cochez **Spécifiques aux propriétés**, puis :
   - **Lire pwdLastSet** et **Écrire pwdLastSet** (forcer le changement au prochain logon) ;
   - **Lire lockoutTime** et **Écrire lockoutTime** (déverrouiller le compte).
6. Cochez ensuite **Générales** et sélectionnez **Réinitialiser le mot de passe**.
7. Terminez l'assistant.

<div class="callout callout-note">

La tâche courante « Réinitialiser les mots de passe utilisateur et forcer le changement de mot de passe à la prochaine ouverture de session » couvre la réinitialisation et `pwdLastSet`, mais pas le déverrouillage. La tâche personnalisée ci-dessus regroupe les trois besoins du support.

</div>

### Déléguer la Gestion des Comptes Ordinateurs

1. Faites un clic droit sur `OU=Postes` > **Délégation de contrôle**.
2. Ajoutez `DL-Deleg-Postes-GestionOrdinateurs`.
3. Choisissez **Créer une tâche personnalisée à déléguer**.
4. Sélectionnez **Seulement des objets suivants dans le dossier** > **Objets Ordinateur**, puis cochez **Créer les objets sélectionnés dans ce dossier** et **Supprimer les objets sélectionnés dans ce dossier**.
5. Page **Autorisations** : cochez **Générales** et **Spécifiques aux propriétés**, puis sélectionnez :
   - **Réinitialiser le mot de passe** ;
   - **Lire et écrire les restrictions de compte** ;
   - **Écriture validée du nom d'hôte DNS** ;
   - **Écriture validée du nom principal de service**.
6. Terminez l'assistant.

Ces quatre permissions sont celles que Microsoft indique pour qu'un groupe délégué puisse joindre au domaine un poste dont le compte existe déjà.

### Vider les Groupes Intégrés à Privilèges

1. Dans `dsa.msc`, ouvrez le conteneur **Builtin**.
2. Ouvrez successivement **Account Operators**, **Server Operators**, **Backup Operators** et **Print Operators**.
3. Onglet **Membres** : notez les membres présents, identifiez le besoin réel de chacun, créez la délégation équivalente, puis retirez-les du groupe.

### Vérifier et Retirer une Délégation

1. Activez **Affichage > Fonctionnalités avancées**.
2. Clic droit sur l'OU > **Propriétés** > onglet **Sécurité** > **Avancé**.
3. Les entrées créées par l'assistant apparaissent avec le groupe délégué et la colonne **S'applique à** (par exemple « Objets Utilisateur descendants »).
4. Pour retirer une délégation, sélectionnez les entrées du groupe et cliquez sur **Supprimer**.

## Méthode 2 : Configuration via PowerShell

### Variables et Groupes

```powershell
Import-Module ActiveDirectory

$domainDN = (Get-ADDomain).DistinguishedName      # DC=lab,DC=local
$ouUsers  = "OU=Utilisateurs,OU=LAB,$domainDN"
$ouPostes = "OU=Postes,OU=LAB,$domainDN"
$ouGroups = "OU=Groupes,OU=LAB,$domainDN"

New-ADGroup -Name "GG-Support-N1" -GroupScope Global -GroupCategory Security -Path $ouGroups
New-ADGroup -Name "GG-Equipe-Postes" -GroupScope Global -GroupCategory Security -Path $ouGroups
New-ADGroup -Name "DL-Deleg-Utilisateurs-ResetPwd" -GroupScope DomainLocal -GroupCategory Security -Path $ouGroups `
    -Description "Délégation : reset mot de passe et déverrouillage sur $ouUsers"
New-ADGroup -Name "DL-Deleg-Postes-GestionOrdinateurs" -GroupScope DomainLocal -GroupCategory Security -Path $ouGroups `
    -Description "Délégation : création et gestion des ordinateurs sur $ouPostes"

Add-ADGroupMember -Identity "DL-Deleg-Utilisateurs-ResetPwd" -Members "GG-Support-N1"
Add-ADGroupMember -Identity "DL-Deleg-Postes-GestionOrdinateurs" -Members "GG-Equipe-Postes"
```

### Déléguer avec dsacls

`dsacls` accepte les noms d'affichage des droits étendus et des attributs. Le paramètre `/I:S` applique l'ACE aux objets enfants uniquement.

```powershell
# Support N1 : réinitialiser le mot de passe, forcer le changement, déverrouiller
dsacls $ouUsers /I:S /G "LAB\DL-Deleg-Utilisateurs-ResetPwd:CA;Reset Password;user"
dsacls $ouUsers /I:S /G "LAB\DL-Deleg-Utilisateurs-ResetPwd:RPWP;pwdLastSet;user"
dsacls $ouUsers /I:S /G "LAB\DL-Deleg-Utilisateurs-ResetPwd:RPWP;lockoutTime;user"

# Equipe postes : créer et supprimer des objets ordinateur dans l'OU
dsacls $ouPostes /I:T /G "LAB\DL-Deleg-Postes-GestionOrdinateurs:CCDC;computer"
```

<div class="callout callout-note">

Avec `/I:T`, l'ACE s'applique à l'OU et à ses descendants. La création d'ordinateurs se pose sur l'OU elle-même, d'où `/I:T`. Les droits sur les attributs se posent sur les objets enfants, d'où `/I:S`.

</div>

### Déléguer avec les ACL PowerShell

Cette approche n'appelle aucun exécutable et lit les GUID dans le schéma, ce qui évite de les recopier à la main.

```powershell
Set-Location AD:

$rootDSE   = Get-ADRootDSE
$schemaNC  = $rootDSE.schemaNamingContext
$configNC  = $rootDSE.configurationNamingContext

function Get-SchemaGuid($ldapName) {
    [guid](Get-ADObject -SearchBase $schemaNC -Filter "lDAPDisplayName -eq '$ldapName'" -Properties schemaIDGUID).schemaIDGUID
}
function Get-RightGuid($displayName) {
    [guid](Get-ADObject -SearchBase "CN=Extended-Rights,$configNC" -Filter "displayName -eq '$displayName'" -Properties rightsGuid).rightsGuid
}

$guidUser      = Get-SchemaGuid "user"
$guidPwdLast   = Get-SchemaGuid "pwdLastSet"
$guidLockout   = Get-SchemaGuid "lockoutTime"
$guidResetPwd  = Get-RightGuid  "Reset Password"

$sid = New-Object System.Security.Principal.SecurityIdentifier (Get-ADGroup "DL-Deleg-Utilisateurs-ResetPwd").SID
$inh = [System.DirectoryServices.ActiveDirectorySecurityInheritance]::Descendents

$acl = Get-Acl -Path "AD:$ouUsers"
$acl.AddAccessRule((New-Object System.DirectoryServices.ActiveDirectoryAccessRule($sid, "ExtendedRight", "Allow", $guidResetPwd, $inh, $guidUser)))
$acl.AddAccessRule((New-Object System.DirectoryServices.ActiveDirectoryAccessRule($sid, "ReadProperty,WriteProperty", "Allow", $guidPwdLast, $inh, $guidUser)))
$acl.AddAccessRule((New-Object System.DirectoryServices.ActiveDirectoryAccessRule($sid, "ReadProperty,WriteProperty", "Allow", $guidLockout, $inh, $guidUser)))
Set-Acl -Path "AD:$ouUsers" -AclObject $acl
```

### Auditer les Délégations Existantes

```powershell
# ACE explicites (non héritées) sur les OU du domaine, hors principaux système
Get-ADOrganizationalUnit -Filter * | ForEach-Object {
    $ou = $_.DistinguishedName
    (Get-Acl "AD:$ou").Access |
        Where-Object { -not $_.IsInherited -and $_.IdentityReference -notmatch 'NT AUTHORITY|BUILTIN|Domain Admins|Enterprise Admins|SYSTEM' } |
        Select-Object @{n='OU';e={$ou}}, IdentityReference, ActiveDirectoryRights, ObjectType, InheritedObjectType
} | Format-Table -AutoSize

# Membres des groupes intégrés à privilèges (doivent être vides)
"Account Operators","Server Operators","Backup Operators","Print Operators" | ForEach-Object {
    [pscustomobject]@{ Groupe = $_; Membres = (Get-ADGroupMember $_ | Select-Object -ExpandProperty SamAccountName) -join ", " }
}
```

### Retirer une Délégation

```powershell
# Supprime toutes les ACE du groupe sur l'OU
dsacls $ouUsers /R "LAB\DL-Deleg-Utilisateurs-ResetPwd"
```

## Vérifications

**Lecture de l'ACL :** `dsacls "OU=Utilisateurs,OU=LAB,DC=lab,DC=local"` affiche les entrées « Allow LAB\DL-Deleg-Utilisateurs-ResetPwd » pour **Reset Password**, **pwdLastSet** et **lockoutTime**, héritées par les objets utilisateur.

**Test fonctionnel du support :** avec un compte membre de `GG-Support-N1`, ouvert sur un poste d'administration avec RSAT (après une nouvelle ouverture de session pour obtenir le nouveau jeton) :

- `Set-ADAccountPassword -Identity user.test -Reset` réussit sur un compte de `OU=Utilisateurs` ;
- `Unlock-ADAccount -Identity user.test` réussit ;
- `Set-ADUser -Identity user.test -Title "Test"` échoue avec un accès refusé ;
- la même réinitialisation sur un compte d'une autre OU ou sur un membre de Domain Admins échoue.

**Test fonctionnel de l'équipe poste :** un membre de `GG-Equipe-Postes` crée un compte ordinateur dans `OU=Postes` et joint un poste avec `Add-Computer -DomainName lab.local -OUPath "OU=Postes,OU=LAB,DC=lab,DC=local"`. La même opération vers une autre OU échoue.

**Groupes intégrés :** Account Operators, Server Operators, Backup Operators et Print Operators n'ont aucun membre.

## Dépannage

**« Accès refusé » alors que le technicien vient d'être ajouté au groupe :** le jeton d'accès est calculé à l'ouverture de session. Le technicien doit fermer puis rouvrir sa session.

**La réinitialisation fonctionne sur certains comptes mais pas sur d'autres de la même OU :** les comptes en échec sont protégés par AdminSDHolder (`adminCount = 1`) ou ont l'héritage désactivé. Vérifiez avec `Get-ADUser user.x -Properties adminCount, nTSecurityDescriptor | Select-Object adminCount, @{n='Protégé';e={$_.nTSecurityDescriptor.AreAccessRulesProtected}}`. Pour un ancien compte privilégié, remettez `adminCount` à vide et réactivez l'héritage après validation.

**« Accès refusé » à la jonction d'un poste dont le compte existe déjà :** la permission **Réinitialiser le mot de passe** sur les objets ordinateur manque. Ajoutez-la, ainsi que les écritures validées sur le nom d'hôte DNS et le SPN.

**Le technicien peut déverrouiller mais pas cocher « L'utilisateur doit changer le mot de passe » :** l'écriture de `pwdLastSet` n'a pas été déléguée. Ajoutez `RPWP;pwdLastSet;user`.

**`dsacls` renvoie « The parameter is incorrect » :** le nom d'affichage d'un droit ou d'un attribut est mal orthographié, ou le DN n'est pas entre guillemets. Les noms attendus sont ceux du schéma en anglais (`Reset Password`, `pwdLastSet`), même sur un système en français.

**Une délégation semble encore active après son retrait :** une ACE subsiste sur une OU parente ou a été posée directement sur des objets. Recherchez le groupe avec le script d'audit sur toutes les OU et utilisez `dsacls /R` sur chaque emplacement.

## Conseils et Bonnes Pratiques

**Concevoir les OU pour la délégation.** Séparez les comptes standards, les comptes d'administration, les comptes de service, les postes, les serveurs et les groupes. Une OU doit correspondre à une population administrée par une même équipe.

**Nommer les groupes de délégation explicitement.** Le format `DL-Deleg-<Périmètre>-<Tâche>` permet de savoir, à la lecture d'une ACL, qui peut faire quoi et où. Renseignez la description du groupe avec l'OU cible et le ticket de création.

**Tenir un registre des délégations.** Chaque délégation doit être documentée (groupe, OU, permissions, demandeur, date de revue). Exportez régulièrement les ACL des OU avec le script d'audit et comparez-les à la version précédente.

**Revoir les délégations au moins une fois par an.** Supprimez les délégations orphelines et les ACE nominatives. Un outil d'analyse des chemins d'attaque AD (graphes d'ACL) aide à repérer les délégations qui mènent à un compte privilégié.

**Utiliser des comptes d'administration dédiés.** Les techniciens utilisent un compte séparé de leur compte bureautique pour les tâches déléguées, et ce compte n'ouvre pas de session sur les serveurs.

**Garder les groupes intégrés vides et surveillés.** Activez l'audit des modifications de groupes et alertez sur tout ajout dans Account Operators, Server Operators, Backup Operators, Print Operators, Domain Admins, Enterprise Admins et Schema Admins.

**Tester en lab avant la production.** Validez chaque délégation avec un compte de test, en vérifiant ce qui est autorisé et surtout ce qui doit rester refusé.

## Procédures Liées

- [Gestion des Objets dans Active Directory](/procedures/windows/gestion-des-objets-dans-active-directory) *(Structure d'OU et groupes servant de base à la délégation)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Délégations par tier et comptes d'administration séparés)*
- [Déploiement de Windows LAPS](/procedures/windows/deploiement-de-windows-laps) *(Délégation de la lecture des mots de passe administrateur locaux)*
- [Configuration de PowerShell Remoting et de JEA](/procedures/windows/configuration-de-powershell-remoting-et-de-jea) *(Alternative pour exposer des tâches AD limitées)*
- [Stratégies de Mots de Passe Affinées et Groupe Protected Users](/procedures/windows/strategies-de-mots-de-passe-affinees-et-groupe-protected-users) *(Protection complémentaire des comptes privilégiés)*
