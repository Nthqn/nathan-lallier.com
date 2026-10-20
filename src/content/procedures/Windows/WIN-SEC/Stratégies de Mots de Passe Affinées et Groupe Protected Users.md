---
modele: "procedure"
titre: "Stratégies de Mots de Passe Affinées et Groupe Protected Users"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-SEC-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit deux mécanismes complémentaires de protection des comptes dans le domaine `lab.local`. Les **stratégies de mots de passe affinées** (Fine-Grained Password Policies, objets PSO) appliquent des règles de mot de passe et de verrouillage différentes selon les populations. Le groupe **Protected Users** impose aux comptes à privilèges des protections non configurables contre le vol d'identifiants.

Le périmètre couvre la création des PSO avec le Centre d'administration Active Directory (`dsac.exe`) et avec PowerShell, la gestion de la précédence, l'ajout de comptes à Protected Users, ses effets sur l'authentification et les précautions à prendre pour les comptes de service. Les silos et stratégies d'authentification sortent du périmètre.

## Contexte et Justification

Un domaine Active Directory ne dispose que d'une seule stratégie de mot de passe définie par GPO au niveau du domaine (généralement Default Domain Policy). Cette stratégie unique pose deux problèmes :

- Elle est soit trop faible pour les administrateurs, soit trop contraignante pour les utilisateurs.
- Elle ne permet pas de traiter différemment les comptes de service, dont le mot de passe doit être long mais ne peut pas être changé au même rythme.

Les PSO lèvent cette limite sans créer de domaine supplémentaire.

Les comptes à privilèges restent par ailleurs exposés au vol d'identifiants en mémoire. Un administrateur qui ouvre une session laisse dans LSASS des secrets réutilisables (empreinte NTLM, clés Kerberos à long terme, identifiants délégués). Le groupe Protected Users empêche la mise en cache de ces secrets, interdit NTLM, DES et RC4, et réduit la durée de vie du TGT à quatre heures. Il rend les attaques pass-the-hash et la délégation abusive nettement plus difficiles.

## Concepts Clés

**PSO (Password Settings Object).** Objet de classe `msDS-PasswordSettings` stocké dans le conteneur `CN=Password Settings Container,CN=System,DC=lab,DC=local`. Il porte les paramètres de mot de passe (longueur, complexité, historique, âge minimal et maximal, chiffrement réversible) et de verrouillage (seuil, durée, fenêtre d'observation).

**Cible d'un PSO.** Un PSO s'applique uniquement à des **utilisateurs** ou à des **groupes de sécurité globaux**. Il ne s'applique ni à une OU, ni à un groupe de domaine local, ni à un groupe de distribution. Pour cibler une OU, on utilise un groupe fantôme (shadow group) dont les membres reflètent l'OU.

**Précédence.** Attribut `msDS-PasswordSettingsPrecedence`, entier supérieur à zéro. La valeur la plus **faible** l'emporte. La politique résultante d'un utilisateur se détermine ainsi :

1. Un PSO lié directement à l'utilisateur prime sur tout PSO hérité d'un groupe.
2. Si plusieurs PSO sont liés directement, celui de plus faible précédence s'applique.
3. Sinon, on compare les PSO des groupes globaux dont l'utilisateur est membre, et le plus faible l'emporte.
4. À précédence égale, le PSO de plus petit GUID est retenu.
5. Sans PSO applicable, la stratégie de mot de passe du domaine s'applique.

Le PSO effectif est exposé dans l'attribut calculé `msDS-ResultantPSO` de l'utilisateur.

**Protected Users.** Groupe global de sécurité intégré (RID 525), situé dans `CN=Users`. Il exige un niveau fonctionnel de domaine Windows Server 2012 R2 ou supérieur. Ses protections ne sont pas configurables.

| Côté | Protection appliquée aux membres |
|------|----------------------------------|
| Poste ou serveur | CredSSP et WDigest ne mettent pas en cache le mot de passe en clair |
| Poste ou serveur | NTLM ne met plus en cache l'empreinte NTOWF |
| Poste ou serveur | Kerberos ne crée plus de clés DES ni RC4 et ne garde pas les clés à long terme après le TGT |
| Poste ou serveur | Aucun vérificateur mis en cache, donc pas d'ouverture de session hors ligne |
| Contrôleur de domaine | Authentification NTLM refusée |
| Contrôleur de domaine | DES et RC4 refusés en pré-authentification Kerberos, AES obligatoire |
| Contrôleur de domaine | Délégation Kerberos, contrainte ou non, refusée |
| Contrôleur de domaine | TGT non renouvelable au-delà de 240 minutes |

: Effets du groupe Protected Users

## Prérequis

- Un compte membre de **Domain Admins**.
- Des contrôleurs de domaine SRV-DC-01 et SRV-DC-02 sous Windows Server 2025 et un niveau fonctionnel de domaine Windows Server 2012 R2 au minimum (2016 ou supérieur recommandé).
- Le Centre d'administration Active Directory (`dsac.exe`) et le module PowerShell ActiveDirectory, installés avec les outils RSAT AD DS.
- Les groupes globaux de ciblage créés dans `OU=Groupes,DC=lab,DC=local` :
  - `GG-PSO-Admins` pour les comptes d'administration ;
  - `GG-PSO-Comptes-Service` pour les comptes de service classiques qui ne peuvent pas encore passer en gMSA.
- Des comptes d'administration dont le mot de passe a été changé depuis le passage du domaine à un niveau fonctionnel Windows Server 2008 ou supérieur, afin qu'ils disposent de clés AES.
- Un compte d'urgence (break-glass) documenté, qui restera hors de Protected Users.

## Points de Vigilance

**Un PSO ne s'applique pas à une OU.** Lier un PSO à une OU est impossible. Déplacer un utilisateur dans une OU ne modifie donc pas sa stratégie de mot de passe. Utilisez des groupes globaux ou des groupes fantômes alimentés par script.

**Le PSO ne s'applique pas aux comptes locaux.** Les stratégies affinées ne concernent que les comptes du domaine. Les comptes locaux des serveurs restent soumis à la stratégie locale ou à Windows LAPS.

**Une précédence dupliquée crée une ambiguïté.** Deux PSO de même précédence applicables au même utilisateur sont départagés par GUID, ce qui est imprévisible pour un administrateur. Attribuez des valeurs uniques et espacées (10, 20, 30).

**NTLMv1 est retiré et RC4 est déprécié dans Windows Server 2025.** NTLMv1 est supprimé de Windows Server 2025, NTLMv2 et RC4 pour Kerberos sont dépréciés. Microsoft fait évoluer le comportement par défaut du KDC vers AES en 2026 (CVE-2026-20833). Protected Users anticipe ces changements pour ses membres. Un compte qui échoue dans Protected Users échouera probablement aussi après le durcissement global du domaine.

**Ne jamais ajouter de comptes de service ni de comptes ordinateurs à Protected Users.** Microsoft le déconseille explicitement. Les protections n'apportent rien sur l'hôte, car le secret y est toujours disponible, et la durée de vie de quatre heures du TGT, l'interdiction de NTLM et l'interdiction de délégation cassent la plupart des services (IIS avec délégation, SQL Server, tâches planifiées, connecteurs applicatifs).

**Risque de verrouillage des administrateurs.** Un compte sans clé AES, un serveur qui n'accepte que NTLM (accès par adresse IP, équipement tiers) ou une application qui délègue les identifiants rendront l'administrateur incapable de travailler. Ajoutez les comptes progressivement et conservez un compte d'urgence hors du groupe.

**L'administrateur intégré est un cas particulier.** Le compte Administrator (RID 500) est toujours exempté des stratégies d'authentification. Ne vous appuyez pas sur lui pour valider le comportement de Protected Users.

**Pas d'ouverture de session hors ligne.** Un membre de Protected Users ne peut pas ouvrir de session sur une machine qui ne joint pas de contrôleur de domaine. C'est voulu, mais à anticiper pour les interventions sur un serveur isolé du réseau.

## Choix Architecturaux & Alternatives

### Quand choisir les PSO et Protected Users

Les PSO conviennent dès que plusieurs populations de comptes coexistent dans un même domaine : administrateurs, utilisateurs standard, comptes de service hérités. Ils évitent de durcir toute l'organisation pour protéger quelques comptes sensibles, et inversement.

Protected Users convient aux comptes d'administration humains (Tier 0 et Tier 1) qui ouvrent des sessions interactives ou RDP et n'ont besoin ni de NTLM, ni de délégation, ni d'ouverture de session hors ligne. Il ne convient ni aux comptes de service, ni aux comptes ordinateurs, ni aux comptes utilisés depuis des systèmes non Windows qui ne parlent que NTLM.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **PSO (stratégies affinées)** | Règles différentes pour administrateurs et comptes hérités | Natif, granularité par groupe global | Pas de ciblage par OU, gestion de la précédence | Gratuit |
| **Stratégie unique de domaine (GPO)** | Petit domaine homogène | Simple, connue | Une seule règle pour tous | Gratuit |
| **Protected Users** | Comptes d'administration humains | Protections fortes sans configuration | Non configurable, casse NTLM et délégation | Gratuit |
| **Option « Account is sensitive and cannot be delegated »** | Comptes à privilèges qui ont encore besoin de NTLM | Bloque la délégation sans autres effets | Ne protège pas les secrets en mémoire | Gratuit |
| **Silos et stratégies d'authentification** | Restreindre où un compte Tier 0 peut s'authentifier | Contrôle fin des hôtes autorisés, TGT configurable | Mise en œuvre plus complexe, Kerberos armoring requis | Gratuit |
| **gMSA pour les comptes de service** | Remplacer les comptes de service à mot de passe fixe | Mot de passe de 240 octets géré par AD | Application compatible requise | Gratuit |
| **Microsoft Entra Password Protection** | Bannir les mots de passe faibles ou proches du nom de l'entreprise | Liste de mots interdits globale et personnalisée | Agent sur les DC, licence Entra ID P1 pour la liste personnalisée | Moyen |

### Impact des choix

- **Sécurité.** Un PSO strict sur les administrateurs (longueur 16 ou plus, historique, verrouillage) et Protected Users sur les mêmes comptes réduisent à la fois le risque de mot de passe deviné et le risque de réutilisation d'un secret volé.
- **Disponibilité.** Un seuil de verrouillage sur les comptes de service expose à un déni de service : un attaquant qui multiplie les échecs peut arrêter une application. Préférez un seuil nul compensé par un mot de passe très long, ou mieux, une migration en gMSA.
- **Exploitation.** Le TGT de quatre heures oblige les administrateurs Protected Users à se réauthentifier en cours de journée. Les outils qui utilisent NTLM (connexion RDP par adresse IP, montage de partage par IP) cessent de fonctionner et doivent utiliser des noms DNS.
- **Coût.** Aucun coût de licence. Le coût réel est la phase de test et l'inventaire des dépendances NTLM et de délégation.

## Méthode 1 : Configuration via le Centre d'administration Active Directory (dsac.exe)

### Création d'un PSO pour les Administrateurs

1. Ouvrez `dsac.exe` sur SRV-DC-01 ou depuis un poste d'administration.
2. Dans le volet de navigation, passez en **Tree View**, développez `lab (local)` puis **System**, et sélectionnez **Password Settings Container**.
3. Dans le volet **Tasks**, cliquez sur **New > Password Settings**.
4. Renseignez les champs :
   - **Name :** `PSO-Admins`
   - **Precedence :** `10`
   - **Enforce minimum password length :** `16`
   - **Enforce password history :** `24`
   - **Password must meet complexity requirements :** coché
   - **Store password using reversible encryption :** décoché
   - **Protect from accidental deletion :** coché
   - **Enforce minimum password age :** `1` jour
   - **Enforce maximum password age :** `180` jours
   - **Enforce account lockout policy :** coché, **Number of failed logon attempts allowed** `5`, **Reset failed logon attempts count after** `30` minutes, **Account will be locked out** pour `30` minutes
5. Dans **Directly Applies To**, cliquez sur **Add** et ajoutez `GG-PSO-Admins`.
6. Cliquez sur **OK**.

### Création d'un PSO pour les Comptes de Service Hérités

1. Dans **Password Settings Container**, cliquez sur **New > Password Settings**.
2. Renseignez **Name** `PSO-Comptes-Service`, **Precedence** `20`, longueur minimale `24`, historique `24`, complexité activée, âge maximal `365` jours.
3. Laissez **Enforce account lockout policy** décoché pour éviter un déni de service sur les applications.
4. Dans **Directly Applies To**, ajoutez `GG-PSO-Comptes-Service`, puis cliquez sur **OK**.

<div class="callout callout-note">

Un PSO accepte une longueur minimale supérieure à 14 caractères, contrairement à l'ancienne limite de la stratégie de domaine par GPO. C'est l'un des principaux intérêts des PSO pour les comptes sensibles.

</div>

### Contrôle de la Politique Résultante

1. Recherchez un compte d'administration, par exemple `adm.nlallier`, dans `dsac.exe`.
2. Dans le volet **Tasks**, cliquez sur **View resultant password settings**.
3. La fenêtre ouverte doit afficher `PSO-Admins`.

<div class="callout callout-note">

La section **Password Settings** des propriétés d'un utilisateur ou d'un groupe ne montre que les PSO **directement** liés. Un PSO hérité d'un groupe n'apparaît que via **View resultant password settings**.

</div>

### Ajout de Comptes au Groupe Protected Users

1. Dans `dsac.exe`, ouvrez le conteneur `lab (local) > Users` et double-cliquez sur **Protected Users**.
2. Dans la section **Members**, cliquez sur **Add** et ajoutez un premier compte d'administration de test, par exemple `adm.test`.
3. Cliquez sur **OK**.
4. Demandez à l'utilisateur de fermer puis rouvrir sa session pour que les protections s'appliquent.

<div class="callout callout-note">

N'ajoutez jamais le groupe Domain Admins entier ni un compte de service. Procédez compte par compte après validation de chaque usage.

</div>

### Activation des Journaux de Diagnostic

1. Sur SRV-DC-01 et SRV-DC-02, ouvrez l'Observateur d'événements (`eventvwr.msc`).
2. Naviguez jusqu'à **Applications and Services Logs > Microsoft > Windows > Authentication**.
3. Faites un clic droit sur **ProtectedUserFailures-DomainController** puis **Enable Log**, et faites de même pour **ProtectedUserSuccesses-DomainController**.
4. Sur un serveur membre de test, activez de la même façon **ProtectedUser-Client**.

## Méthode 2 : Configuration via PowerShell

### Création des PSO

```powershell
$psoAdmins = @{
    Name                            = "PSO-Admins"
    Precedence                      = 10
    MinPasswordLength               = 16
    PasswordHistoryCount            = 24
    ComplexityEnabled               = $true
    ReversibleEncryptionEnabled     = $false
    MinPasswordAge                  = "1.00:00:00"
    MaxPasswordAge                  = "180.00:00:00"
    LockoutThreshold                = 5
    LockoutDuration                 = "00:30:00"
    LockoutObservationWindow        = "00:30:00"
    ProtectedFromAccidentalDeletion = $true
    Description                     = "Comptes d'administration"
}
New-ADFineGrainedPasswordPolicy @psoAdmins

$psoSvc = @{
    Name                            = "PSO-Comptes-Service"
    Precedence                      = 20
    MinPasswordLength               = 24
    PasswordHistoryCount            = 24
    ComplexityEnabled               = $true
    ReversibleEncryptionEnabled     = $false
    MinPasswordAge                  = "1.00:00:00"
    MaxPasswordAge                  = "365.00:00:00"
    LockoutThreshold                = 0
    LockoutDuration                 = "00:30:00"
    LockoutObservationWindow        = "00:30:00"
    ProtectedFromAccidentalDeletion = $true
    Description                     = "Comptes de service hérités, en attente de migration gMSA"
}
New-ADFineGrainedPasswordPolicy @psoSvc
```

### Liaison aux Groupes

```powershell
Add-ADFineGrainedPasswordPolicySubject -Identity "PSO-Admins"          -Subjects "GG-PSO-Admins"
Add-ADFineGrainedPasswordPolicySubject -Identity "PSO-Comptes-Service" -Subjects "GG-PSO-Comptes-Service"

Get-ADFineGrainedPasswordPolicySubject -Identity "PSO-Admins" | Select-Object Name, ObjectClass
```

### Contrôle de la Politique Résultante

```powershell
Get-ADUserResultantPasswordPolicy -Identity "adm.nlallier"

# Inventaire de tous les PSO triés par précédence
Get-ADFineGrainedPasswordPolicy -Filter * |
    Sort-Object Precedence |
    Select-Object Name, Precedence, MinPasswordLength, LockoutThreshold, AppliesTo
```

### Vérification des Prérequis AES avant Protected Users

```powershell
# Comptes dont le mot de passe n'a pas changé depuis longtemps : risque d'absence de clé AES
Get-ADGroupMember -Identity "Domain Admins" -Recursive |
    Get-ADUser -Properties PasswordLastSet, "msDS-SupportedEncryptionTypes" |
    Select-Object SamAccountName, PasswordLastSet, "msDS-SupportedEncryptionTypes"

# Aucun compte de service ni ordinateur ne doit apparaître dans Protected Users
Get-ADGroupMember -Identity "Protected Users" |
    Select-Object Name, ObjectClass
```

### Ajout au Groupe Protected Users

```powershell
Add-ADGroupMember -Identity "Protected Users" -Members "adm.test"
Get-ADGroupMember -Identity "Protected Users"
```

### Activation des Journaux sur les Contrôleurs de Domaine

```powershell
Invoke-Command -ComputerName SRV-DC-01, SRV-DC-02 -ScriptBlock {
    wevtutil sl "Microsoft-Windows-Authentication/ProtectedUserFailures-DomainController" /e:true
    wevtutil sl "Microsoft-Windows-Authentication/ProtectedUserSuccesses-DomainController" /e:true
}
```

## Vérifications

**PSO effectif :** `Get-ADUserResultantPasswordPolicy -Identity adm.nlallier` retourne `PSO-Admins`. Le même cmdlet sur un utilisateur standard ne retourne rien, ce qui signifie que la stratégie du domaine s'applique.

**Application de la règle :** une tentative de changement de mot de passe de 12 caractères pour `adm.nlallier` est refusée.

**Verrouillage :** cinq échecs consécutifs sur `adm.test` verrouillent le compte. `Get-ADUser adm.test -Properties LockedOut` affiche `LockedOut : True`.

**TGT de quatre heures :** après ouverture de session de `adm.test` sur SRV-APP-01, `klist tgt` affiche une heure de fin et une limite de renouvellement à quatre heures du début.

**Refus de NTLM :** une connexion `net use \\192.168.10.30\c$` par adresse IP avec `adm.test` échoue, tandis que `net use \\SRV-APP-01.lab.local\c$` réussit en Kerberos. L'événement 100 apparaît dans **ProtectedUserFailures-DomainController**.

**Succès Kerberos :** l'événement 303 apparaît dans **ProtectedUserSuccesses-DomainController** à chaque TGT délivré à un membre.

## Dépannage

**« Le PSO ne s'applique pas à l'utilisateur » :** l'utilisateur est membre d'un groupe de domaine local ou universel lié au PSO. Seuls les groupes globaux de sécurité sont pris en compte. Contrôlez l'étendue du groupe avec `Get-ADGroup GG-PSO-Admins | Select GroupScope, GroupCategory`.

**« Un autre PSO que prévu s'applique » :** un PSO lié directement à l'utilisateur, ou un PSO de précédence plus faible hérité d'un autre groupe, prend le dessus. Listez les PSO avec leur précédence et consultez `msDS-ResultantPSO` avec `Get-ADUser adm.nlallier -Properties msDS-ResultantPSO`.

**« Un membre de Protected Users ne peut plus ouvrir de session » :** le compte n'a pas de clé AES. Réinitialisez son mot de passe depuis un contrôleur de domaine Windows Server 2025, puis réessayez. L'événement 104 de **ProtectedUserFailures-DomainController** confirme un refus DES ou RC4.

**« Accès refusé à un partage ou à une console distante » :** l'application cible utilise NTLM, par exemple via une adresse IP ou un alias DNS sans SPN. Utilisez le nom DNS complet, ou enregistrez le SPN manquant avec `setspn -S`.

**« Une application web ne fonctionne plus avec le compte » :** l'application repose sur une délégation Kerberos. Les membres de Protected Users ne peuvent pas être délégués. Retirez le compte du groupe et utilisez un compte non privilégié pour cet usage.

**« La session RDP demande à nouveau le mot de passe toutes les quatre heures » :** comportement attendu, lié à la durée de vie du TGT. Ce n'est pas un incident.

## Conseils et Bonnes Pratiques

**Espacer les valeurs de précédence.** Utilisez des pas de 10 (10, 20, 30) pour pouvoir insérer un PSO intermédiaire sans tout renuméroter.

**Nommer les PSO selon leur cible.** Le format `PSO-<Population>` facilite la lecture de `msDS-ResultantPSO` et des rapports.

**Migrer les comptes de service vers gMSA.** Le PSO pour comptes de service est une mesure transitoire. Un gMSA supprime la gestion manuelle du mot de passe et ne nécessite aucun PSO.

**Commencer Protected Users par un compte de test.** Validez les usages réels pendant quelques jours (RDP, consoles MMC, PowerShell à distance, partages) avant d'ajouter les autres administrateurs.

**Séparer comptes d'usage et comptes d'administration.** Les membres de Protected Users doivent être des comptes dédiés à l'administration, jamais des comptes de messagerie ou de bureautique.

**Garder un compte d'urgence hors du groupe.** Ce compte, stocké dans un coffre physique ou numérique, permet de corriger une erreur de configuration qui bloquerait tous les administrateurs.

**Superviser les échecs.** Transférez les journaux **ProtectedUserFailures-DomainController** vers le SIEM. Un pic d'échecs NTLM révèle une dépendance non identifiée ou une tentative d'attaque.

## Procédures Liées

- [Gestion des Objets dans Active Directory](/procedures/windows/gestion-des-objets-dans-active-directory) *(Création des groupes globaux de ciblage)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Comptes d'administration dédiés à placer dans Protected Users)*
- [Déploiement des Comptes de Service Managés de Groupe (gMSA)](/procedures/windows/deploiement-des-comptes-de-service-manages-de-groupe-gmsa) *(Alternative aux comptes de service à mot de passe fixe)*
- [Dépannage de la Réplication AD et de Kerberos](/procedures/windows/depannage-de-la-replication-ad-et-de-kerberos) *(Analyse des échecs Kerberos et des SPN)*
- [Délégation de l'Administration Active Directory](/procedures/windows/delegation-de-ladministration-active-directory) *(Gestion déléguée des groupes de ciblage)*
- [Durcissement de Windows Server avec OSConfig et Credential Guard](/procedures/windows/durcissement-de-windows-server-avec-osconfig-et-credential-guard) *(Protection complémentaire des secrets en mémoire)*
