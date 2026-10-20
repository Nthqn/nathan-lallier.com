---
modele: "procedure"
titre: "Mise en Place du Modèle d'Administration en Tiers (Tiering)"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-IDM-SEC"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la mise en place du modèle d'administration en tiers (tiering) dans le domaine `lab.local`, dont les contrôleurs SRV-DC-01 et SRV-DC-02 sont sous Windows Server 2025 sur le réseau 192.168.10.0/24. Elle couvre :

- la classification des actifs en Tier 0, Tier 1 et Tier 2 ;
- la création de comptes d'administration séparés par tier ;
- une structure d'OU dédiée à l'administration ;
- les GPO de restriction de connexion (refus d'ouverture de session locale, via Bureau à distance, en tant que tâche et en tant que service) ;
- les stations d'administration privilégiées (PAW) ;
- les politiques d'authentification et les silos de politiques d'authentification pour le Tier 0.

Elle situe enfin ce modèle par rapport à l'Enterprise Access Model, qui lui a succédé dans les recommandations de Microsoft. L'administration d'Entra ID et de Privileged Identity Management sort du périmètre.

## Contexte et Justification

La plupart des compromissions d'Active Directory suivent le même scénario. Un poste utilisateur est infecté. L'attaquant y récupère en mémoire les identifiants d'un administrateur qui s'y est connecté pour un dépannage. Il réutilise ces identifiants pour se déplacer vers un serveur, puis vers un contrôleur de domaine. Quelques heures suffisent lorsque les mêmes comptes administrent indifféremment les postes, les serveurs et les DC.

Le modèle en tiers casse ce chemin. Il repose sur une règle simple : un compte d'un niveau donné ne s'authentifie jamais sur un système d'un niveau moins sûr. Un administrateur du domaine n'ouvre jamais de session sur un poste de travail ou un serveur applicatif, il n'expose donc jamais ses identifiants là où l'attaquant a le plus de chances d'être présent. Les GPO de refus de connexion et les silos d'authentification transforment cette règle organisationnelle en contrôle technique.

Le bénéfice se mesure sur trois axes :

- **Confinement :** la compromission d'un poste ou d'un serveur ne mène plus directement aux contrôleurs de domaine.
- **Lisibilité :** chaque compte privilégié a un périmètre explicite, ce qui facilite les revues et l'audit.
- **Conformité :** les guides ANSSI pour l'administration sécurisée des SI reposant sur AD, ainsi que les recommandations Microsoft, attendent ce cloisonnement.

## Concepts Clés

**Tier 0.** Tout ce qui contrôle l'identité de l'entreprise, directement ou indirectement : contrôleurs de domaine, comptes et groupes d'administration du domaine, autorité de certification d'entreprise (AD CS), Entra Connect, AD FS, serveurs et consoles qui gèrent les DC (hyperviseurs hébergeant SRV-DC-01 et SRV-DC-02, solution de sauvegarde des DC, outils de déploiement agissant sur les DC). La compromission d'un seul de ces éléments équivaut à celle du domaine.

**Tier 1.** Les serveurs et applications de l'entreprise : serveurs de fichiers, serveurs applicatifs, bases de données, serveurs web, ainsi que les comptes qui les administrent.

**Tier 2.** Les postes de travail, les périphériques des utilisateurs et les comptes du support qui les administrent.

**Règle de contrôle.** Un niveau supérieur peut contrôler un niveau inférieur, mais il ne doit pas y exposer ses identifiants. Un niveau inférieur ne doit jamais pouvoir contrôler un niveau supérieur (aucun droit d'un compte Tier 1 sur un DC, aucun agent Tier 1 installé sur un DC).

**Compte d'administration séparé.** Chaque administrateur dispose d'un compte bureautique sans privilège et d'un compte par tier administré, par exemple `nlallier` (bureautique), `adm-t1-nlallier` (serveurs) et `adm-t0-nlallier` (domaine).

**PAW (Privileged Access Workstation).** Poste dédié et durci, utilisé uniquement pour l'administration, sans messagerie ni navigation Internet. Une PAW de Tier 0 est elle-même un actif de Tier 0.

**Droits utilisateur de refus.** Paramètres de GPO dans **Configuration ordinateur > Stratégies > Paramètres Windows > Paramètres de sécurité > Stratégies locales > Attribution des droits utilisateur**. Un droit de refus l'emporte sur un droit d'autorisation.

| Droit (libellé anglais) | Libellé français | Effet |
|-------------------------|------------------|-------|
| Deny log on locally | Interdire l'ouverture d'une session locale | Bloque l'ouverture de session console |
| Deny log on through Remote Desktop Services | Interdire l'ouverture de session par les services Bureau à distance | Bloque RDP |
| Deny log on as a batch job | Interdire l'ouverture de session en tant que tâche | Bloque les tâches planifiées sous ce compte |
| Deny log on as a service | Interdire l'ouverture de session en tant que service | Bloque les services sous ce compte |
| Deny access to this computer from the network | Interdire l'accès à cet ordinateur à partir du réseau | Bloque SMB, WinRM, RPC avec ce compte |

: Droits de refus utilisés par le tiering

**Politique d'authentification et silo.** Objets AD (Windows Server 2012 R2 et ultérieur) appliqués par le KDC. Une politique peut limiter la durée de vie du TGT d'un compte et restreindre les ordinateurs depuis lesquels il peut s'authentifier. Un silo regroupe des comptes utilisateurs, ordinateurs et de service et leur applique une politique. Un compte Tier 0 placé dans un silo ne peut obtenir de TGT que depuis les DC et les PAW du silo.

**Enterprise Access Model.** Modèle qui a succédé au modèle en tiers AD dans les recommandations Microsoft. Il conserve la logique de hiérarchie et l'étend aux environnements hybrides et cloud. Le Tier 0 devient le **plan de contrôle** (control plane), étendu à tout ce qui gère l'accès. Le Tier 1 se scinde en **plan de gestion** (management plane, fonctions d'administration IT transverses) et **plan des données et charges de travail** (data/workload plane, administration propre à chaque application). Le Tier 2 se scinde en **accès utilisateur** (user access, y compris partenaires et clients) et **accès applicatif** (app access, API). Les **chemins d'accès privilégié** traversent l'ensemble et doivent être protégés en priorité.

## Prérequis

- Un compte membre de Domain Admins pour créer la structure d'OU, les groupes, les GPO et les silos.
- Le niveau fonctionnel de domaine Windows Server 2012 R2 ou supérieur pour les politiques d'authentification et les silos (le lab est au niveau Windows Server 2025).
- La console GPMC (`gpmc.msc`), le Centre d'administration Active Directory (`dsac.exe`) et le module PowerShell ActiveDirectory.
- Un inventaire des actifs classés par tier, y compris les serveurs qui ont des droits sur les DC (hyperviseurs, sauvegarde, supervision, déploiement).
- Un inventaire des comptes privilégiés actuels et des comptes de service, avec les machines sur lesquelles ils ouvrent des sessions.
- Au moins une station d'administration dédiée au Tier 0 (`SRV-PAW-01` dans le lab), jointe au domaine et durcie.
- Un compte d'urgence (break glass) membre de Domain Admins, exclu des silos, dont le mot de passe est conservé sous enveloppe ou dans un coffre, et dont l'utilisation déclenche une alerte.

## Points de Vigilance

**Le modèle en tiers AD est un modèle hérité.** Microsoft le présente désormais comme la base dont est issu l'Enterprise Access Model. Il reste la référence pour cloisonner un domaine AD sur site, mais il ne couvre ni les rôles d'administration cloud ni l'accès applicatif. Planifiez son évolution vers l'Enterprise Access Model si l'organisation est hybride.

**L'ESAE (forêt d'administration dite « Red Forest ») n'est plus recommandée.** Microsoft la réserve à des cas d'exception, par exemple des environnements isolés sans accès cloud. Ses bonnes pratiques unitaires (PAW, MFA des administrateurs, moindre privilège) restent valables.

**Les GPO de refus peuvent couper l'accès des administrateurs.** Une erreur de ciblage (refus du groupe Tier 0 lié à l'OU des DC) empêche toute ouverture de session sur les DC. Testez sur une OU pilote, conservez un accès console et le compte d'urgence, et liez les GPO par vagues.

**Ne refusez pas des groupes qui contiennent des comptes de service légitimes.** Refuser l'ouverture de session en tant que service ou tâche à un groupe qui contient un compte de service arrête ce service. Identifiez les comptes de service avant d'activer ces droits, et remplacez-les par des gMSA classés dans le bon tier.

**Le refus de l'accès réseau doit être appliqué avec discernement.** Refuser « l'accès à cet ordinateur à partir du réseau » aux comptes Tier 0 sur les serveurs Tier 1 empêche aussi les outils d'administration à distance légitimes de ce tier. Microsoft l'applique aux comptes Administrator et aux groupes privilégiés du domaine sur les serveurs membres et postes. Validez l'impact avant de l'étendre.

**Les silos exigent le blindage Kerberos (armoring).** La restriction « autorisé à s'authentifier depuis » ne fonctionne que si les DC ont le paramètre **Prise en charge du contrôleur de domaine Kerberos pour les revendications, l'authentification composée et le blindage Kerberos** activé et si les clients ont **Prise en charge des revendications, de l'authentification composée et du blindage Kerberos par le client Kerberos** activé. Commencez toujours par une politique en mode audit.

**Un silo appliqué sans le bon périmètre bloque les administrateurs.** Placez dans le silo les DC et les PAW avant les comptes utilisateurs, vérifiez les événements d'audit, puis seulement appliquez la politique.

**Le tiering est contournable par les chemins indirects.** Une GPO liée à l'OU des DC mais modifiable par un groupe Tier 1, un agent de supervision Tier 1 installé sur les DC, ou un hyperviseur administré par le Tier 1 qui héberge SRV-DC-01 annulent le cloisonnement. Ces éléments doivent être reclassés en Tier 0 ou retirés.

## Choix Architecturaux & Alternatives

### Quand choisir le modèle en tiers AD

Le modèle en tiers est le socle à mettre en place pour tout domaine Active Directory sur site, quelle que soit sa taille. Il ne requiert aucune licence et s'appuie uniquement sur des fonctions natives (OU, groupes, GPO, politiques d'authentification). Il est prioritaire après une compromission, lors d'un audit révélant des administrateurs du domaine ouvrant des sessions sur des postes, ou avant d'exposer le domaine à des environnements hybrides.

Dans une organisation hybride, il forme la partie « sur site » du plan de contrôle de l'Enterprise Access Model. Il se complète alors par la protection des rôles d'administration Entra ID (comptes cloud dédiés, accès conditionnel, PIM) et par l'usage de PAW gérées pour l'ensemble des plans.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Modèle en tiers AD (GPO, comptes séparés, silos)** | Domaine AD sur site, PME à grand compte | Natif, efficace contre le mouvement latéral | Limité à AD, charge d'exploitation (comptes multiples) | Faible |
| **Enterprise Access Model** | Organisation hybride ou cloud | Couvre identités cloud, API, accès utilisateurs et partenaires | Démarche globale, nécessite Entra ID et outillage moderne | Moyen à élevé |
| **ESAE (forêt d'administration)** | Environnements isolés, cas d'exception | Isolation forte des identités d'administration | Complexe, coûteuse, plus recommandée par Microsoft | Élevé |
| **Bastion d'administration ou solution PAM tierce** | Traçabilité des sessions, prestataires | Enregistrement des sessions, coffre de mots de passe | Licence, le bastion devient un actif Tier 0 | Élevé |
| **Aucun cloisonnement** | Situation de départ fréquente | Aucun effort | Chemin direct du poste utilisateur au DC | Gratuit, risque maximal |

### Impact des choix

- **Sécurité.** Les GPO de refus empêchent l'exposition des identifiants privilégiés sur les systèmes moins sûrs. Les silos ajoutent un contrôle côté KDC : même un mot de passe volé ne permet pas d'obtenir un TGT hors des machines autorisées.
- **Exploitation.** Chaque administrateur gère plusieurs comptes et utilise une PAW pour le Tier 0. Les procédures de dépannage doivent prévoir quel compte utiliser sur quel système. Le support de niveau 1 n'a plus besoin de droits de domaine.
- **Disponibilité.** Une erreur de configuration peut bloquer les administrateurs. Le compte d'urgence, l'accès console aux DC et le déploiement progressif limitent ce risque.
- **Coût.** Pas de licence pour le modèle AD. Le coût porte sur les PAW (matériel ou machines virtuelles dédiées sur un hôte de Tier 0), la conception et l'accompagnement des équipes.

## Méthode 1 : Configuration via la Console de Gestion des Stratégies de Groupe (gpmc.msc) et le Centre d'administration Active Directory (dsac.exe)

### Créer la Structure d'OU

1. Ouvrez `dsac.exe` sur SRV-DC-01.
2. À la racine `lab (local)`, créez l'OU `Admin` et cochez **Protéger contre la suppression accidentelle**.
3. Sous `Admin`, créez les OU `Tier0`, `Tier1` et `Tier2`.
4. Sous chaque OU de tier, créez les OU `Comptes`, `Groupes`, `Serveurs` (ou `Postes` pour le Tier 2) et `PAW`.
5. Hors de l'OU `Admin`, conservez les OU de production : `OU=Serveurs,OU=LAB` (Tier 1) et `OU=Postes,OU=LAB` (Tier 2). Les DC restent dans l'OU **Domain Controllers**.

Structure obtenue :

```text
lab.local
├── Domain Controllers                 (Tier 0)
├── Admin
│   ├── Tier0  ── Comptes, Groupes, Serveurs, PAW
│   ├── Tier1  ── Comptes, Groupes, PAW
│   └── Tier2  ── Comptes, Groupes, PAW
└── LAB
    ├── Serveurs                       (Tier 1)
    ├── Postes                         (Tier 2)
    └── Utilisateurs
```

<div class="callout callout-note">

Seuls les administrateurs du Tier 0 doivent avoir des droits sur l'OU `Admin` et ses sous-OU. Retirez toute délégation existante qui la couvrirait.

</div>

### Créer les Groupes et les Comptes d'Administration

1. Dans `OU=Groupes,OU=Tier0,OU=Admin`, créez le groupe global de sécurité `GG-T0-Admins`.
2. Dans `OU=Groupes,OU=Tier1,OU=Admin`, créez `GG-T1-Admins-Serveurs`.
3. Dans `OU=Groupes,OU=Tier2,OU=Admin`, créez `GG-T2-Admins-Postes`.
4. Créez les comptes dans l'OU `Comptes` du tier correspondant, par exemple `adm-t0-nlallier`, `adm-t1-nlallier` et `adm-t2-nlallier`.
5. Ajoutez `adm-t0-nlallier` à `GG-T0-Admins` et à **Domain Admins**, puis ajoutez les comptes Tier 1 et Tier 2 à leurs groupes respectifs.
6. Sur chaque compte d'administration, cochez **Le compte est sensible et ne peut pas être délégué** dans l'onglet **Compte**, et ajoutez les comptes Tier 0 au groupe **Protected Users**.
7. Accordez les droits d'administration locale par GPO ou par Windows LAPS : `GG-T1-Admins-Serveurs` dans le groupe Administrateurs local des serveurs de `OU=Serveurs,OU=LAB`, `GG-T2-Admins-Postes` dans celui des postes de `OU=Postes,OU=LAB`.

### Créer les GPO de Restriction de Connexion

Créez trois GPO dans **Objets de stratégie de groupe**, puis éditez **Configuration ordinateur > Stratégies > Paramètres Windows > Paramètres de sécurité > Stratégies locales > Attribution des droits utilisateur**.

**GPO-SEC-Tier0-Restrictions** (liée à **Domain Controllers** et à `OU=Serveurs,OU=Tier0,OU=Admin`) :

- **Interdire l'ouverture d'une session locale :** `GG-T1-Admins-Serveurs`, `GG-T2-Admins-Postes` ;
- **Interdire l'ouverture de session par les services Bureau à distance :** `GG-T1-Admins-Serveurs`, `GG-T2-Admins-Postes` ;
- **Interdire l'ouverture de session en tant que tâche :** `GG-T1-Admins-Serveurs`, `GG-T2-Admins-Postes` ;
- **Interdire l'ouverture de session en tant que service :** `GG-T1-Admins-Serveurs`, `GG-T2-Admins-Postes`.

**GPO-SEC-Tier1-Restrictions** (liée à `OU=Serveurs,OU=LAB`) :

- les quatre droits de refus ci-dessus pour `Domain Admins`, `Enterprise Admins`, `GG-T0-Admins` et `GG-T2-Admins-Postes` ;
- **Interdire l'accès à cet ordinateur à partir du réseau :** `Domain Admins`, `Enterprise Admins`, `GG-T0-Admins`.

**GPO-SEC-Tier2-Restrictions** (liée à `OU=Postes,OU=LAB`) :

- les quatre droits de refus pour `Domain Admins`, `Enterprise Admins`, `GG-T0-Admins` et `GG-T1-Admins-Serveurs` ;
- **Interdire l'accès à cet ordinateur à partir du réseau :** `Domain Admins`, `Enterprise Admins`, `GG-T0-Admins`, `GG-T1-Admins-Serveurs`.

<div class="callout callout-note">

N'ajoutez jamais `GG-T0-Admins` ni `Domain Admins` dans une GPO liée à l'OU **Domain Controllers**. Liez d'abord chaque GPO à une OU pilote contenant un seul serveur ou poste, validez, puis étendez.

</div>

### Configurer les PAW

1. Placez `SRV-PAW-01` dans `OU=PAW,OU=Tier0,OU=Admin`.
2. Créez la GPO `GPO-SEC-PAW-T0` liée à cette OU :
   - **Autoriser l'ouverture d'une session locale** et **Autoriser l'ouverture de session par les services Bureau à distance** limités à `GG-T0-Admins` et au groupe Administrateurs local ;
   - restriction de l'accès Internet par proxy ou pare-feu, AppLocker ou App Control for Business, Credential Guard activé.
3. N'installez sur la PAW que les outils d'administration (RSAT, PowerShell) et aucune messagerie.
4. Procédez de même pour les PAW Tier 1 et Tier 2, avec leurs groupes respectifs.

### Activer le Blindage Kerberos

1. Éditez **Default Domain Controllers Policy** : **Configuration ordinateur > Stratégies > Modèles d'administration > Système > KDC** > **Prise en charge du contrôleur de domaine Kerberos pour les revendications, l'authentification composée et le blindage Kerberos** : **Activé**, option **Pris en charge**.
2. Dans une GPO liée au domaine, ou au minimum aux PAW et aux serveurs Tier 0 : **Système > Kerberos** > **Prise en charge des revendications, de l'authentification composée et du blindage Kerberos par le client Kerberos** : **Activé**.

### Créer la Politique d'Authentification et le Silo Tier 0

1. Dans `dsac.exe`, ouvrez **Authentification > Stratégies d'authentification** > **Nouveau**.
2. **Nom :** `AuthPol-T0`. Cochez **Auditer uniquement les restrictions de stratégie** pour la phase de test.
3. Section **Comptes d'utilisateur** : cochez **Spécifier une durée de vie de ticket TGT** et saisissez 240 minutes.
4. Dans **Contrôler l'authentification de l'utilisateur**, ajoutez une condition **Utilisateur > Silo de stratégies d'authentification > Égal à > Silo-T0**. Cette condition n'est valable qu'une fois le silo créé : enregistrez d'abord la politique, créez le silo, puis revenez ajouter la condition.
5. Ouvrez **Silos de stratégies d'authentification** > **Nouveau** :
   - **Nom :** `Silo-T0` ;
   - **Auditer uniquement** dans un premier temps ;
   - **Stratégie d'authentification :** utilisez `AuthPol-T0` pour tous les principaux ;
   - **Comptes autorisés :** ajoutez SRV-DC-01, SRV-DC-02, `SRV-PAW-01` et `adm-t0-nlallier`.
6. Ouvrez chaque compte membre (DC, PAW, administrateur) > section **Silo** et affectez `Silo-T0`.
7. Après validation des journaux d'audit, décochez le mode audit sur la politique puis sur le silo.

## Méthode 2 : Configuration via PowerShell

### Structure d'OU, Groupes et Comptes

```powershell
Import-Module ActiveDirectory
$domainDN = (Get-ADDomain).DistinguishedName   # DC=lab,DC=local

New-ADOrganizationalUnit -Name "Admin" -Path $domainDN -ProtectedFromAccidentalDeletion $true
foreach ($t in "Tier0","Tier1","Tier2") {
    New-ADOrganizationalUnit -Name $t -Path "OU=Admin,$domainDN" -ProtectedFromAccidentalDeletion $true
    foreach ($sub in "Comptes","Groupes","PAW") {
        New-ADOrganizationalUnit -Name $sub -Path "OU=$t,OU=Admin,$domainDN" -ProtectedFromAccidentalDeletion $true
    }
}
New-ADOrganizationalUnit -Name "Serveurs" -Path "OU=Tier0,OU=Admin,$domainDN" -ProtectedFromAccidentalDeletion $true

$groups = @{
    "GG-T0-Admins"          = "OU=Groupes,OU=Tier0,OU=Admin,$domainDN"
    "GG-T1-Admins-Serveurs" = "OU=Groupes,OU=Tier1,OU=Admin,$domainDN"
    "GG-T2-Admins-Postes"   = "OU=Groupes,OU=Tier2,OU=Admin,$domainDN"
}
foreach ($g in $groups.Keys) {
    New-ADGroup -Name $g -GroupScope Global -GroupCategory Security -Path $groups[$g]
}

function New-AdminAccount($sam, $tier, $group) {
    New-ADUser -Name $sam -SamAccountName $sam -UserPrincipalName "$sam@lab.local" `
        -Path "OU=Comptes,OU=$tier,OU=Admin,$domainDN" `
        -AccountPassword (Read-Host "Mot de passe pour $sam" -AsSecureString) `
        -Enabled $true -AccountNotDelegated $true
    Add-ADGroupMember -Identity $group -Members $sam
}
New-AdminAccount "adm-t0-nlallier" "Tier0" "GG-T0-Admins"
New-AdminAccount "adm-t1-nlallier" "Tier1" "GG-T1-Admins-Serveurs"
New-AdminAccount "adm-t2-nlallier" "Tier2" "GG-T2-Admins-Postes"

Add-ADGroupMember -Identity "Domain Admins"   -Members "adm-t0-nlallier"
Add-ADGroupMember -Identity "Protected Users" -Members "adm-t0-nlallier"
```

### Créer et Lier les GPO

Le module GroupPolicy crée et lie les GPO, mais ne fournit pas de cmdlet pour éditer l'attribution des droits utilisateur. Ces droits se renseignent dans l'éditeur de GPO (Méthode 1) ou par import d'une sauvegarde de GPO préparée en lab.

```powershell
Import-Module GroupPolicy

$gpos = @{
    "GPO-SEC-Tier0-Restrictions" = @("OU=Domain Controllers,$domainDN", "OU=Serveurs,OU=Tier0,OU=Admin,$domainDN")
    "GPO-SEC-Tier1-Restrictions" = @("OU=Serveurs,OU=LAB,$domainDN")
    "GPO-SEC-Tier2-Restrictions" = @("OU=Postes,OU=LAB,$domainDN")
}
foreach ($name in $gpos.Keys) {
    $gpo = New-GPO -Name $name -Comment "Restriction de connexion - modèle en tiers"
    foreach ($target in $gpos[$name]) {
        # Lien créé désactivé : activation après test sur OU pilote
        New-GPLink -Guid $gpo.Id -Target $target -LinkEnabled No | Out-Null
    }
}

# Réplication d'une GPO validée en lab vers un autre domaine ou après reconstruction
# Backup-GPO -Name "GPO-SEC-Tier1-Restrictions" -Path C:\GPO-Backup
# Import-GPO -BackupGpoName "GPO-SEC-Tier1-Restrictions" -TargetName "GPO-SEC-Tier1-Restrictions" -Path C:\GPO-Backup

# Activation du lien après validation
Set-GPLink -Name "GPO-SEC-Tier1-Restrictions" -Target "OU=Serveurs,OU=LAB,$domainDN" -LinkEnabled Yes
```

### Politique d'Authentification et Silo Tier 0

```powershell
# Politique en mode audit (sans -Enforce), TGT de 4 heures
New-ADAuthenticationPolicy -Name "AuthPol-T0" -UserTGTLifetimeMins 240 `
    -Description "Comptes Tier 0 : TGT 4 h, authentification depuis Silo-T0 uniquement" `
    -ProtectedFromAccidentalDeletion $true

# Silo en mode audit, même politique pour utilisateurs, ordinateurs et services
New-ADAuthenticationPolicySilo -Name "Silo-T0" `
    -UserAuthenticationPolicy "AuthPol-T0" `
    -ComputerAuthenticationPolicy "AuthPol-T0" `
    -ServiceAuthenticationPolicy "AuthPol-T0" `
    -ProtectedFromAccidentalDeletion $true

# Autoriser puis affecter les membres (ordinateurs d'abord)
$members = @(
    (Get-ADComputer "SRV-DC-01"), (Get-ADComputer "SRV-DC-02"), (Get-ADComputer "SRV-PAW-01"),
    (Get-ADUser "adm-t0-nlallier")
)
foreach ($m in $members) {
    Grant-ADAuthenticationPolicySiloAccess -Identity "Silo-T0" -Account $m
    Set-ADAccountAuthenticationPolicySilo -Identity $m -AuthenticationPolicySilo "Silo-T0"
}

# Condition "authentification depuis un membre du silo" pour les comptes utilisateurs
$sddl = 'O:SYG:SYD:(XA;OICI;CR;;;WD;(@USER.ad://ext/AuthenticationSilo == "Silo-T0"))'
Set-ADAuthenticationPolicy -Identity "AuthPol-T0" -UserAllowedToAuthenticateFrom $sddl
```

<div class="callout callout-note">

La chaîne SDDL de la condition est la forme générée par le Centre d'administration Active Directory pour une condition « Silo de stratégies d'authentification égal à Silo-T0 ». En cas de doute, créez la condition dans `dsac.exe` puis lisez-la avec `Get-ADAuthenticationPolicy AuthPol-T0 -Properties UserAllowedToAuthenticateFrom`.

</div>

### Passer en Mode Appliqué

Après au moins une à deux semaines d'audit sans échec inattendu :

```powershell
Set-ADAuthenticationPolicy -Identity "AuthPol-T0" -Enforce $true
Set-ADAuthenticationPolicySilo -Identity "Silo-T0" -Enforce $true
```

## Vérifications

**Structure :** `Get-ADOrganizationalUnit -SearchBase "OU=Admin,DC=lab,DC=local" -Filter * | Select-Object DistinguishedName` liste les OU de chaque tier.

**GPO appliquées :** sur un serveur de `OU=Serveurs,OU=LAB`, `gpresult /scope computer /h C:\Temp\gp.html` montre `GPO-SEC-Tier1-Restrictions` parmi les GPO appliquées, et la section **Attribution des droits utilisateur** contient les groupes Tier 0 et Tier 2 en refus.

**Refus effectif :** une ouverture de session RDP de `adm-t0-nlallier` sur `SRV-APP-01` échoue avec un message indiquant que la méthode d'ouverture de session n'est pas autorisée. Une ouverture de session de `adm-t1-nlallier` sur SRV-DC-01 échoue de la même façon. Les événements de sécurité 4625 correspondants sont journalisés.

**Silo en audit :** le journal **Journaux des applications et des services > Microsoft > Windows > Authentication > AuthenticationPolicyFailures-DomainController** sur SRV-DC-01 et SRV-DC-02 ne contient des avertissements que pour les tentatives hors périmètre attendues.

**Silo appliqué :** `adm-t0-nlallier` s'authentifie depuis `SRV-PAW-01` et sur SRV-DC-01, mais une tentative depuis un poste de `OU=Postes,OU=LAB` échoue. `klist` sur la PAW montre un TGT d'une durée de 4 heures.

**Comptes privilégiés :** `Get-ADGroupMember "Domain Admins"` ne contient que des comptes `adm-t0-*` et le compte d'urgence. `Get-ADUser -Filter 'AccountNotDelegated -eq $false' -SearchBase "OU=Admin,DC=lab,DC=local"` ne renvoie rien.

## Dépannage

**Plus aucun administrateur ne peut ouvrir de session sur un DC :** une GPO de refus contenant un groupe Tier 0 est liée à l'OU **Domain Controllers**. Ouvrez une session console avec le compte d'urgence, désactivez le lien de la GPO dans GPMC, puis exécutez `gpupdate /force` sur les DC. En dernier recours, démarrez un DC en DSRM.

**Un service ou une tâche planifiée s'arrête après l'application des GPO :** il s'exécute sous un compte membre d'un groupe refusé. Identifiez-le dans le journal Système (échec d'ouverture de session du service), sortez le compte du groupe ou remplacez-le par un gMSA du tier concerné.

**Les restrictions ne s'appliquent pas sur un serveur :** le serveur n'est pas dans l'OU ciblée, le lien de GPO est désactivé ou un blocage d'héritage existe. Vérifiez avec `gpresult /r /scope computer` et l'emplacement de l'objet ordinateur.

**Le silo bloque l'administrateur Tier 0 depuis sa PAW :** la PAW n'est pas membre du silo, n'a pas reçu la GPO de prise en charge du blindage Kerberos, ou n'a pas redémarré depuis. Vérifiez l'appartenance avec `Get-ADComputer SRV-PAW-01 -Properties AuthenticationPolicySilo`, puis redémarrez la PAW. Repassez la politique en audit le temps de corriger.

**Aucun événement d'audit n'apparaît pour le silo :** le blindage Kerberos n'est pas activé côté KDC, ou la condition « autorisé à s'authentifier depuis » n'est pas définie. Contrôlez la GPO KDC sur les DC et la propriété `UserAllowedToAuthenticateFrom` de la politique.

**Un compte Tier 0 membre de Protected Users ne peut plus accéder à un ancien système :** Protected Users interdit NTLM, la délégation et les chiffrements DES et RC4. Ce comportement est attendu. Corrigez le système concerné (SPN, prise en charge d'AES) plutôt que de retirer le compte du groupe.

## Conseils et Bonnes Pratiques

**Commencer par le Tier 0.** Le gain de sécurité est maximal sur les comptes du domaine. Créez les comptes `adm-t0-*`, la PAW Tier 0, la GPO sur les postes et serveurs refusant Domain Admins, puis traitez les Tier 1 et Tier 2.

**Réduire Domain Admins au strict minimum.** Visez quelques comptes nominatifs et le compte d'urgence. Les tâches courantes passent par des délégations sur les OU et non par l'appartenance à des groupes privilégiés.

**Classer les dépendances des DC en Tier 0.** Hyperviseurs hébergeant SRV-DC-01 et SRV-DC-02, console de sauvegarde, PKI, Entra Connect et outils de déploiement agissant sur les DC sont des actifs Tier 0, administrés depuis une PAW Tier 0.

**Utiliser Windows LAPS sur tous les tiers.** Chaque serveur et poste dispose d'un mot de passe administrateur local unique, lisible uniquement par le groupe d'administration du tier.

**Préférer des sessions sans dépôt d'identifiants.** Pour l'administration à distance, utilisez PowerShell Remoting, le mode Restricted Admin ou Remote Credential Guard pour RDP, afin de ne pas laisser d'identifiants réutilisables sur le système cible.

**Superviser les groupes et les échecs de connexion.** Alertez sur toute modification des groupes Tier 0, sur les événements 4625 liés aux droits de refus et sur les événements du journal AuthenticationPolicyFailures.

**Préparer l'évolution vers l'Enterprise Access Model.** Cartographiez les rôles d'administration cloud, les comptes de service applicatifs et les accès partenaires. Appliquez la même logique de plans hiérarchisés à Entra ID, avec des comptes d'administration cloud dédiés, l'accès conditionnel et l'élévation temporaire.

## Procédures Liées

- [Délégation de l'Administration Active Directory](/procedures/windows/delegation-de-ladministration-active-directory) *(Délégations sur les OU de chaque tier)*
- [Stratégies de Mots de Passe Affinées et Groupe Protected Users](/procedures/windows/strategies-de-mots-de-passe-affinees-et-groupe-protected-users) *(Protection des comptes Tier 0)*
- [Déploiement de Windows LAPS](/procedures/windows/deploiement-de-windows-laps) *(Mots de passe administrateur locaux uniques par tier)*
- [Durcissement de Windows Server avec OSConfig et Credential Guard](/procedures/windows/durcissement-de-windows-server-avec-osconfig-et-credential-guard) *(Durcissement des PAW et des serveurs Tier 0)*
- [Déploiement des Comptes de Service Managés de Groupe (gMSA)](/procedures/windows/deploiement-des-comptes-de-service-manages-de-groupe-gmsa) *(Comptes de service compatibles avec les GPO de refus)*
- Configuration de Privileged Identity Management (PIM) *(Prolongement du modèle au plan de contrôle cloud)*
