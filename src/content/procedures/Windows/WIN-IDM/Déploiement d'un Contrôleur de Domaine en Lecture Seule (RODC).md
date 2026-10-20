---
modele: "procedure"
titre: "Déploiement d'un Contrôleur de Domaine en Lecture Seule (RODC)"
type: "PROCEDURE"
class: "07. Identité"
reference: "WIN-IDM-DEP"
creation: "20/10/2026"
revision: "20/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit le déploiement d'un contrôleur de domaine en lecture seule (RODC) sous Windows Server 2025 dans le domaine `lab.local`, pour un site distant dont la sécurité physique est limitée.

Le périmètre couvre la pré-création du compte RODC en deux étapes (staging puis attachement), la politique de réplication des mots de passe (PRP), l'usage des groupes Allowed RODC Password Replication Group et Denied RODC Password Replication Group, ainsi que la séparation du rôle administrateur. La création des sites et des sous-réseaux est traitée dans la procédure dédiée aux sites et à la réplication AD.

Le lab utilisé est le suivant.

| Élément | Valeur |
|---------|--------|
| Domaine | `lab.local` |
| Contrôleurs inscriptibles | SRV-DC-01 (192.168.10.10) et SRV-DC-02 (192.168.10.11), site `Site-Siege` |
| RODC | SRV-RODC-01 (192.168.20.20), site `Site-Agence` |
| Sous-réseaux | 192.168.10.0/24 (siège), 192.168.20.0/24 (agence) |
| Groupe de délégation | `LAB\GRP-SRV-RODC-01-Admins` |
| Groupe autorisé à la mise en cache | `LAB\GRP-SRV-RODC-01-Cache` |

## Contexte et Justification

Une agence ou un site industriel a souvent besoin d'un contrôleur de domaine local pour authentifier les utilisateurs et appliquer les GPO quand le lien WAN est lent ou coupé. Placer un contrôleur inscriptible dans un local technique peu protégé expose cependant toute la forêt.

- Le vol du serveur ou de son disque donne accès à la base `ntds.dit`, donc aux hachages de tous les comptes du domaine, y compris les administrateurs.
- Une modification malveillante faite localement est répliquée vers tous les autres contrôleurs.
- L'administrateur local du site doit souvent recevoir des droits Domain Admins pour intervenir sur le serveur.

Le RODC répond à ces trois risques. Il détient une copie en lecture seule de l'annuaire, ne stocke par défaut aucun mot de passe, ne réplique jamais vers les autres contrôleurs, et permet de déléguer son administration locale sans aucun droit sur le domaine.

Le bénéfice opérationnel se mesure sur trois axes.

- **Surface d'exposition réduite.** En cas de compromission, seuls les comptes mis en cache sur le RODC sont à réinitialiser.
- **Continuité de service.** Les comptes autorisés par la PRP s'authentifient localement même lorsque le lien vers le siège est coupé.
- **Séparation des rôles.** Le technicien de l'agence administre le serveur sans être membre d'un groupe privilégié du domaine.

## Concepts Clés

**Réplication unidirectionnelle.** Le RODC reçoit les modifications depuis un contrôleur inscriptible mais n'en émet aucune. Une tentative d'écriture LDAP sur le RODC est redirigée (referral) vers un contrôleur inscriptible.

**Filtered Attribute Set (FAS).** Ensemble d'attributs marqués comme confidentiels pour les applications, qui ne sont jamais répliqués vers un RODC. Les secrets (mots de passe) sont gérés à part, par la PRP.

**Politique de réplication des mots de passe (PRP).** Liste d'autorisation et liste de refus propres à chaque RODC. Un compte dont le mot de passe n'est ni autorisé ni refusé n'est pas mis en cache. Le refus l'emporte toujours sur l'autorisation.

**Allowed RODC Password Replication Group.** Groupe de domaine local créé par défaut, présent dans la liste d'autorisation de tous les RODC. Il est vide à l'installation.

**Denied RODC Password Replication Group.** Groupe de domaine local présent dans la liste de refus de tous les RODC. Il contient par défaut, entre autres, Domain Admins, Enterprise Admins, Schema Admins, Cert Publishers, Group Policy Creator Owners, Domain Controllers, Read-only Domain Controllers et le compte `krbtgt`.

**Valeurs par défaut de la PRP.** Sans personnalisation, chaque RODC refuse Administrators, Server Operators, Backup Operators, Account Operators et Denied RODC Password Replication Group, et autorise Allowed RODC Password Replication Group.

**Liste Revealed et liste Authenticated.** La première contient les comptes dont le mot de passe est réellement stocké sur le RODC. La seconde contient les comptes qui se sont authentifiés via le RODC, mis en cache ou non. Comparer les deux permet d'ajuster la PRP.

**Compte krbtgt dédié.** Chaque RODC possède son propre compte `krbtgt_<numéro>`. Un ticket émis par un RODC compromis n'est donc pas accepté comme ticket de domaine par les contrôleurs inscriptibles.

**Installation en deux étapes (staging).** Un membre de Domain Admins pré-crée le compte ordinateur du RODC et fixe ses options (site, DNS, catalogue global, PRP, délégation). Le serveur est ensuite attaché à ce compte par le délégataire, sans droit d'administration du domaine. Tant qu'aucun serveur n'est attaché, la console affiche le type **Unoccupied DC account**.

**Séparation du rôle administrateur.** Le compte ou groupe délégué devient administrateur local du RODC, avec des privilèges équivalents au groupe Administrators de la machine, sans être membre de Domain Admins ni du groupe Administrators intégré du domaine.

## Prérequis

- Un compte membre de Domain Admins pour l'étape de pré-création.
- Au moins un contrôleur inscriptible joignable par le RODC (SRV-DC-01 ou SRV-DC-02), situé de préférence dans le site relié par le lien de sites de moindre coût.
- Le site `Site-Agence` et le sous-réseau 192.168.20.0/24 déjà créés dans `dssite.msc` (voir « Configuration des Sites et de la Réplication AD »). `Install-ADDSDomainController` ne crée pas de site.
- Un serveur Windows Server 2025 installé, nommé `SRV-RODC-01`, **non joint au domaine**, avec une adresse IP fixe (192.168.20.20) et SRV-DC-01 et SRV-DC-02 comme serveurs DNS.
- Les flux réseau AD ouverts entre l'agence et le siège (DNS 53, Kerberos 88, RPC 135 et plage dynamique, LDAP 389, SMB 445, kpasswd 464, GC 3268).
- La réplication SYSVOL en DFSR. Un domaine encore en FRS doit être migré avant tout ajout de contrôleur récent.
- Les groupes `LAB\GRP-SRV-RODC-01-Admins` (délégation) et `LAB\GRP-SRV-RODC-01-Cache` (comptes de l'agence à mettre en cache) créés dans une OU d'administration.
- Les outils RSAT AD DS sur le poste d'administration (`dsa.msc`, module ActiveDirectory et module ADDSDeployment).

## Points de Vigilance

**Le nom du serveur doit correspondre exactement au compte pré-créé.** L'assistant de promotion recherche un compte inoccupé portant le nom de la machine. Un écart de nom provoque une installation classique au lieu d'un attachement, avec les options par défaut.

**Le serveur à attacher ne doit pas être joint au domaine.** L'attachement se fait depuis un serveur en groupe de travail. Un serveur déjà joint doit être retiré du domaine et son compte ordinateur supprimé avant l'opération, sinon le compte pré-créé entre en conflit.

**Ne jamais placer de compte privilégié dans la liste d'autorisation.** Ajouter Domain Admins ou un groupe d'administration Tier 0 à la PRP annule le bénéfice du RODC. Le groupe Denied RODC Password Replication Group doit être complété avec les comptes de service sensibles et les comptes d'administration du modèle en tiers.

**Ne pas accorder de droits de réplication étendus au RODC.** Si le groupe Enterprise Read-only Domain Controllers ou le compte du RODC reçoit le droit **Replicating Directory Changes All** sur la partition de domaine, le RODC réplique tous les mots de passe comme un contrôleur inscriptible. Cette erreur de délégation est documentée par Microsoft et reste silencieuse.

**L'étape de pré-création peut exiger adprep /rodcprep.** Microsoft indique que le mécanisme de staging ne lance pas automatiquement la préparation RODC. Dans une forêt créée directement sous une version récente de Windows Server, cette préparation n'est en principe pas nécessaire. Si l'assistant signale que `adprep /rodcprep` n'a pas été exécuté, lancez-le depuis le support d'installation avant de recommencer.

**Le délégataire n'est pas un administrateur de domaine.** Il ne doit pas ouvrir de session sur SRV-DC-01 ou SRV-DC-02, ni gérer les comptes. Toute opération d'annuaire (création d'utilisateurs, GPO) se fait depuis le siège sur un contrôleur inscriptible.

**Le DNS du RODC est en lecture seule.** Les zones intégrées AD sont hébergées en lecture seule. Les mises à jour dynamiques des clients de l'agence sont transmises à un contrôleur inscriptible, puis répliquées. Un délai d'apparition des enregistrements est normal.

**En cas de vol, réinitialisez les mots de passe mis en cache.** Supprimer le compte du RODC dans `dsa.msc` propose de réinitialiser les mots de passe des utilisateurs et ordinateurs mis en cache et d'exporter leur liste. Cette option est la réponse attendue à une compromission physique.

## Choix Architecturaux & Alternatives

### Quand choisir un RODC

Le RODC est le bon choix pour un site distant de quelques dizaines à quelques centaines d'utilisateurs, sans salle serveur sécurisée ni administrateur de domaine sur place, mais où l'authentification locale reste nécessaire en cas de coupure WAN. C'est le cas typique d'une agence commerciale, d'un magasin, d'un site de production ou d'une zone exposée (DMZ applicative ayant besoin d'une authentification Kerberos).

Ne choisissez pas un RODC si le site héberge des applications qui écrivent fréquemment dans l'annuaire sans gérer les referrals, ou si le lien WAN est fiable et rapide. Dans ce dernier cas, l'absence de contrôleur local suffit et réduit la surface d'attaque. Ne le choisissez pas non plus pour un site disposant d'une salle serveur sécurisée et d'une équipe d'administration qualifiée, où un contrôleur inscriptible apporte plus de résilience.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **RODC** | Agence sans sécurité physique ni administrateur de domaine | Exposition limitée aux comptes mis en cache, délégation locale | Applications à écriture LDAP à valider, PRP à maintenir | Faible (une licence Windows Server) |
| **Contrôleur inscriptible distant** | Site important avec salle serveur sécurisée | Résilience complète, écriture locale | Vol du serveur égal à compromission de la forêt | Faible à moyen |
| **Aucun contrôleur local** | Petit site avec WAN fiable et redondé | Aucune surface d'attaque locale | Plus d'ouverture de session si le WAN tombe (hors identifiants mis en cache sur les postes) | Gratuit |
| **Contrôleur dans le cloud (VM Azure) et VPN** | Sites nombreux déjà connectés à Azure | Sécurité physique déléguée au fournisseur | Dépendance au lien Internet, coût récurrent | Moyen |
| **Microsoft Entra ID seul (postes Entra joined)** | Parc moderne sans dépendance à l'AD local | Plus d'infrastructure locale à protéger | Inadapté aux applications Kerberos et NTLM locales | Moyen (licences) |

### Impact des choix

- **Sécurité.** Le RODC limite la fuite de secrets aux seuls comptes autorisés par la PRP. Une PRP trop large (par exemple Domain Users autorisé) ramène le niveau de risque à celui d'un contrôleur inscriptible.
- **Disponibilité.** Un utilisateur non mis en cache ne peut s'authentifier que si un contrôleur inscriptible est joignable. Pré-remplir le cache pour les comptes de l'agence est indispensable avant une coupure.
- **Exploitation.** La PRP doit suivre les mouvements de personnel. Gérer la liste d'autorisation par un groupe (`GRP-SRV-RODC-01-Cache`) plutôt que par comptes individuels simplifie la maintenance.
- **Coût.** Le RODC consomme une licence Windows Server et un matériel modeste. Il évite surtout le coût d'une salle serveur sécurisée sur chaque site.

## Méthode 1 : Configuration via la Console Utilisateurs et ordinateurs Active Directory (dsa.msc)

### Étape 1 : Pré-création du Compte RODC

1. Sur SRV-DC-01, ouvrez `dsa.msc` avec un compte membre de Domain Admins.
2. Faites un clic droit sur l'OU **Domain Controllers** > **Pre-create Read-only Domain Controller account**.
3. Sur la page d'accueil, cochez **Use advanced mode installation** pour accéder aux options de PRP, puis cliquez sur **Next**.
4. **Network Credentials** : conservez le compte courant, puis **Next**.
5. **Specify the Computer Name** : saisissez `SRV-RODC-01`. Ce nom doit être identique à celui du serveur qui sera attaché.
6. **Select a Site** : choisissez `Site-Agence`.
7. **Additional Domain Controller Options** : cochez **DNS server** et **Global catalog**. L'option **Read-only domain controller (RODC)** est imposée.

<div class="callout callout-note">

Le catalogue global sur le RODC permet aux ouvertures de session de l'agence de résoudre l'appartenance aux groupes universels sans solliciter le siège.

</div>

8. **Specify the Password Replication Policy** : conservez les entrées par défaut, puis cliquez sur **Add** et ajoutez `LAB\GRP-SRV-RODC-01-Cache` avec l'option **Allow passwords for the account to replicate to this RODC**.
9. **Delegation of RODC Installation and Administration** : cliquez sur **Set** et sélectionnez `LAB\GRP-SRV-RODC-01-Admins`. Un seul principal de sécurité est accepté, d'où l'usage d'un groupe.
10. **Summary** : cliquez sur **Export settings** pour conserver un fichier de réponses, puis **Next** et **Finish**.

Le compte `SRV-RODC-01` apparaît dans l'OU Domain Controllers avec le type **Unoccupied DC account**.

### Étape 2 : Attachement du Serveur au Compte

Cette étape est réalisée sur SRV-RODC-01 par un membre de `GRP-SRV-RODC-01-Admins`.

1. Ouvrez une session avec le compte Administrateur local de SRV-RODC-01.
2. Dans le **Gestionnaire de serveur**, cliquez sur **Gérer** > **Ajouter des rôles et fonctionnalités**, sélectionnez **Services AD DS** et installez le rôle avec ses outils.
3. Sur la page **Résultats**, cliquez sur **Promouvoir ce serveur en contrôleur de domaine**.
4. **Configuration de déploiement** : choisissez **Ajouter un contrôleur de domaine à un domaine existant**, saisissez `lab.local`, puis indiquez les identifiants d'un membre de `GRP-SRV-RODC-01-Admins`.
5. **Options du contrôleur de domaine** : l'assistant détecte le compte pré-créé et sélectionne **Utiliser le compte RODC existant**. Saisissez le mot de passe DSRM.

<div class="callout callout-note">

Les options (site, DNS, GC, PRP) ne sont pas modifiables à ce stade. Elles proviennent du compte pré-créé.

</div>

6. **Options supplémentaires** : laissez le choix du contrôleur source automatique, ou imposez SRV-DC-01.
7. **Chemins** : conservez les chemins par défaut de la base, des journaux et de SYSVOL.
8. **Vérification de la configuration requise** : vérifiez l'absence d'erreur bloquante, puis cliquez sur **Installer**. Le serveur redémarre automatiquement.

### Étape 3 : Ajustement de la PRP

1. Sur SRV-DC-01, dans `dsa.msc`, ouvrez **Domain Controllers** > **SRV-RODC-01** > **Propriétés** > onglet **Password Replication Policy**.
2. Vérifiez la présence de `GRP-SRV-RODC-01-Cache` en **Allow** et des groupes privilégiés en **Deny**.
3. Cliquez sur **Advanced** pour afficher les comptes dont le mot de passe est stocké (**Accounts whose passwords are stored on this Read-only Domain Controller**) et ceux qui se sont authentifiés via le RODC.
4. Pour pré-remplir le cache avant une mise en service, cliquez sur **Prepopulate Passwords** dans la fenêtre avancée et sélectionnez les utilisateurs et postes de l'agence.

### Étape 4 : Renforcement du Groupe Denied

1. Ouvrez **Users** > **Denied RODC Password Replication Group** > **Membres**.
2. Ajoutez les groupes d'administration Tier 0 et Tier 1, les comptes de service sensibles et les gMSA à privilèges.

<div class="callout callout-note">

Ce groupe s'applique à tous les RODC du domaine. Le renseigner une fois protège les déploiements futurs.

</div>

## Méthode 2 : Configuration via PowerShell

### Tester puis Pré-créer le Compte RODC

À exécuter sur SRV-DC-01 en tant que membre de Domain Admins.

```powershell
Import-Module ADDSDeployment

$params = @{
    DomainControllerAccountName          = "SRV-RODC-01"
    DomainName                           = "lab.local"
    SiteName                             = "Site-Agence"
    InstallDns                           = $true
    DelegatedAdministratorAccountName    = "LAB\GRP-SRV-RODC-01-Admins"
    AllowPasswordReplicationAccountName  = @("LAB\Allowed RODC Password Replication Group","LAB\GRP-SRV-RODC-01-Cache")
    DenyPasswordReplicationAccountName   = @("BUILTIN\Administrators","BUILTIN\Server Operators","BUILTIN\Backup Operators","BUILTIN\Account Operators","LAB\Denied RODC Password Replication Group")
}

Test-ADDSReadOnlyDomainControllerAccountCreation @params
Add-ADDSReadOnlyDomainControllerAccount @params
```

<div class="callout callout-note">

Les paramètres `-AllowPasswordReplicationAccountName` et `-DenyPasswordReplicationAccountName` remplacent les listes par défaut. Reprenez donc explicitement les entrées par défaut, comme ci-dessus, pour ne pas les perdre.

</div>

### Attacher le Serveur au Compte

À exécuter sur SRV-RODC-01, serveur en groupe de travail, en tant qu'administrateur local.

```powershell
Install-WindowsFeature -Name AD-Domain-Services -IncludeManagementTools

Install-ADDSDomainController `
    -DomainName "lab.local" `
    -Credential (Get-Credential "LAB\adm-agence") `
    -UseExistingAccount `
    -SafeModeAdministratorPassword (Read-Host -Prompt "Mot de passe DSRM" -AsSecureString)
```

Le compte `LAB\adm-agence` est membre de `GRP-SRV-RODC-01-Admins`. Le serveur redémarre à la fin de la promotion.

### Gérer la PRP

À exécuter depuis SRV-DC-01 ou un poste RSAT.

```powershell
# Ajouter un groupe à la liste d'autorisation du RODC
Add-ADDomainControllerPasswordReplicationPolicy -Identity "SRV-RODC-01" -AllowedList "GRP-SRV-RODC-01-Cache"

# Ajouter un groupe sensible à la liste de refus du RODC
Add-ADDomainControllerPasswordReplicationPolicy -Identity "SRV-RODC-01" -DeniedList "GRP-Tier0-Admins"

# Afficher les listes
Get-ADDomainControllerPasswordReplicationPolicy -Identity "SRV-RODC-01" -Allowed
Get-ADDomainControllerPasswordReplicationPolicy -Identity "SRV-RODC-01" -Denied

# Comptes réellement stockés et comptes authentifiés via le RODC
Get-ADDomainControllerPasswordReplicationPolicyUsage -Identity "SRV-RODC-01" -RevealedAccounts | Format-Table Name,ObjectClass -AutoSize
Get-ADDomainControllerPasswordReplicationPolicyUsage -Identity "SRV-RODC-01" -AuthenticatedAccounts | Format-Table Name,ObjectClass -AutoSize
```

### Pré-remplir le Cache des Mots de Passe

```powershell
Get-ADGroupMember -Identity "GRP-SRV-RODC-01-Cache" -Recursive | ForEach-Object {
    repadmin /rodcpwdrepl SRV-RODC-01 SRV-DC-01 $_.distinguishedName
}
```

<div class="callout callout-note">

`repadmin /rodcpwdrepl` déclenche la réplication du mot de passe d'un compte vers le RODC. Le compte doit être autorisé par la PRP, sinon l'opération échoue.

</div>

### Modifier la Délégation après Installation

Si le groupe délégué doit changer après l'attachement, utilisez `dsmgmt` sur SRV-RODC-01.

```powershell
dsmgmt "local roles" "add LAB\GRP-SRV-RODC-01-Admins administrators" quit quit
dsmgmt "local roles" "show role administrators" quit quit
```

## Vérifications

**Type de contrôleur :** `Get-ADDomainController -Identity SRV-RODC-01 | Select-Object Name,Site,IsReadOnly,IsGlobalCatalog` retourne `IsReadOnly` à `True` et le site `Site-Agence`.

**Réplication entrante :** `repadmin /showrepl SRV-RODC-01` affiche des réplications réussies depuis SRV-DC-01 ou SRV-DC-02 pour chaque partition. Aucune connexion sortante n'existe depuis SRV-RODC-01.

**Compte krbtgt dédié :** `Get-ADUser -Filter 'Name -like "krbtgt_*"'` liste un compte `krbtgt_<numéro>` associé au RODC.

**PRP :** `repadmin /prp view SRV-RODC-01 allow` et `repadmin /prp view SRV-RODC-01 reveal` affichent les entrées attendues. Aucun compte privilégié n'apparaît dans la liste reveal.

**Authentification hors ligne :** lien WAN coupé, un utilisateur membre de `GRP-SRV-RODC-01-Cache` dont le mot de passe a été pré-rempli ouvre une session sur un poste de l'agence. Un utilisateur non autorisé échoue, ce qui confirme le comportement attendu.

**Délégation :** un membre de `GRP-SRV-RODC-01-Admins` ouvre une session sur SRV-RODC-01 et redémarre un service, mais ne peut pas ouvrir de session sur SRV-DC-01.

## Dépannage

**« L'assistant propose une nouvelle installation au lieu du compte existant » :** le nom de la machine ne correspond pas au compte pré-créé, ou le compte n'est plus à l'état Unoccupied. Vérifiez le nom avec `hostname`, renommez le serveur si nécessaire, puis relancez la promotion.

**« Accès refusé lors de l'attachement » :** le compte utilisé n'est pas membre du groupe délégué défini à la pré-création. Vérifiez l'attribut `managedBy` du compte SRV-RODC-01 dans `dsa.msc` (onglet **Managed By**) et la composition de `GRP-SRV-RODC-01-Admins`.

**« Les utilisateurs de l'agence ne s'authentifient plus lors d'une coupure WAN » :** leurs mots de passe ne sont pas en cache. Contrôlez la liste reveal, vérifiez que les utilisateurs et leurs postes sont membres de `GRP-SRV-RODC-01-Cache`, puis pré-remplissez le cache. Pensez aux comptes ordinateurs, sans lesquels le canal sécurisé du poste échoue.

**« Une application de l'agence échoue en écriture » :** l'application tente d'écrire sur le RODC sans suivre le referral vers un contrôleur inscriptible. Configurez-la pour cibler explicitement SRV-DC-01 ou SRV-DC-02, ou validez auprès de l'éditeur sa compatibilité RODC.

**« La liste reveal contient des comptes non autorisés » :** vérifiez qu'aucun droit **Replicating Directory Changes All** n'a été accordé au groupe Enterprise Read-only Domain Controllers ou au compte SRV-RODC-01 sur la racine du domaine. Retirez ce droit, puis réinitialisez les mots de passe des comptes concernés.

## Conseils et Bonnes Pratiques

**Gérer la PRP uniquement par groupes.** Un groupe par RODC (`GRP-SRV-RODC-01-Cache`) contenant les utilisateurs et les ordinateurs du site rend la politique lisible et auditable. Évitez d'ajouter des comptes individuels dans l'onglet PRP.

**Compléter systématiquement le groupe Denied.** Placez-y tous les comptes d'administration et de service privilégiés dès la création du domaine. C'est la protection commune à tous les RODC présents et futurs.

**Utiliser des comptes d'administration distincts pour l'agence.** Le délégataire utilise un compte dédié (`adm-agence`) qui n'est pas son compte bureautique et qui n'appartient à aucun groupe privilégié du domaine.

**Chiffrer le volume système du RODC.** BitLocker avec TPM complète la protection logique du RODC contre l'extraction hors ligne de la base et du cache.

**Auditer régulièrement la liste reveal.** Une revue trimestrielle de `Get-ADDomainControllerPasswordReplicationPolicyUsage -RevealedAccounts` détecte les dérives de PRP et les comptes partis de l'agence.

**Préparer la procédure de compromission.** Documentez à l'avance la suppression du compte RODC avec réinitialisation des mots de passe mis en cache, et testez-la dans le lab.

## Procédures Liées

- [Configuration des Sites et de la Réplication AD](/procedures/windows/configuration-des-sites-et-de-la-replication-ad) *(Création du site agence et du lien de sites)*
- [Ajout d'un Contrôleur de Domaine Secondaire](/procedures/windows/ajout-dun-controleur-de-domaine-secondaire) *(Promotion d'un contrôleur inscriptible, prérequis communs)*
- [Délégation de l'Administration Active Directory](/procedures/windows/delegation-de-ladministration-active-directory) *(Groupes d'administration délégués)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Comptes à placer dans le groupe Denied)*
- [Chiffrement des Volumes avec BitLocker](/procedures/windows/chiffrement-des-volumes-avec-bitlocker) *(Protection physique du RODC)*
- [Dépannage de la Réplication AD et de Kerberos](/procedures/windows/depannage-de-la-replication-ad-et-de-kerberos) *(Diagnostic de la réplication entrante)*
