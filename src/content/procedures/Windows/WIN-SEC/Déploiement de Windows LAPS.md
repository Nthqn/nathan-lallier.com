---
modele: "procedure"
titre: "Déploiement de Windows LAPS"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-SEC-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit le déploiement de **Windows LAPS** (Windows Local Administrator Password Solution) dans le domaine `lab.local`. Windows LAPS fait tourner automatiquement le mot de passe du compte administrateur local de chaque serveur membre, le sauvegarde de façon chiffrée dans Active Directory et permet aux seuls administrateurs autorisés de le consulter.

Le périmètre couvre l'extension du schéma, la délégation des permissions sur l'OU des serveurs, la stratégie de groupe Windows LAPS, le chiffrement du mot de passe, la récupération et la rotation forcée. La sauvegarde vers Microsoft Entra ID est présentée comme alternative. La migration détaillée depuis l'ancien Microsoft LAPS (MSI) sort du périmètre.

## Contexte et Justification

Dans un parc installé à partir d'une même image ou d'un même script, le compte administrateur local porte souvent le même mot de passe sur tous les serveurs. Un attaquant qui récupère ce mot de passe, ou son empreinte NTLM, sur une seule machine peut alors se connecter à toutes les autres. C'est le scénario classique de mouvement latéral par pass-the-hash.

Windows LAPS supprime ce risque :

- **Mot de passe unique par machine :** chaque serveur génère son propre mot de passe aléatoire.
- **Rotation automatique :** le mot de passe change selon l'âge défini par la stratégie, et après chaque utilisation si l'action post-authentification est activée.
- **Stockage protégé :** le mot de passe est chiffré dans l'attribut AD de l'objet ordinateur et seul un groupe autorisé peut le déchiffrer.
- **Fonction native :** aucune installation n'est requise sur Windows Server 2019 à jour, Windows Server 2022 et Windows Server 2025.

## Concepts Clés

**Windows LAPS et ancien Microsoft LAPS.** Windows LAPS est une fonctionnalité intégrée à Windows depuis les mises à jour du 11 avril 2023. Il remplace l'ancien produit Microsoft LAPS distribué en MSI (extension côté client `AdmPwd.dll`). Les deux produits utilisent des attributs de schéma, des stratégies et des cmdlets différents.

**Annuaire de sauvegarde (BackupDirectory).** Paramètre central de la stratégie. Valeur 0 (désactivé), 1 (Microsoft Entra ID) ou 2 (Active Directory). Une machine sauvegarde dans un seul annuaire à la fois. Tant que ce paramètre est désactivé, tous les autres paramètres sont ignorés.

**Attributs de schéma.** `Update-LapsADSchema` ajoute à la classe ordinateur les attributs `msLAPS-PasswordExpirationTime`, `msLAPS-Password`, `msLAPS-EncryptedPassword`, `msLAPS-EncryptedPasswordHistory` et les attributs équivalents pour le compte DSRM. Les attributs de mot de passe sont marqués confidentiels.

**Chiffrement du mot de passe.** Activé par défaut (`ADPasswordEncryptionEnabled`). Il exige un niveau fonctionnel de domaine Windows Server 2016 ou supérieur. Le principal autorisé à déchiffrer (`ADPasswordEncryptionPrincipal`) est **Domain Admins** par défaut et peut être remplacé par un groupe dédié.

**Permissions distinctes.** Trois droits sont à distinguer :

| Droit | Cmdlet de délégation | Rôle |
|-------|----------------------|------|
| Écriture par la machine | `Set-LapsADComputerSelfPermission` | Le compte ordinateur met à jour son propre mot de passe |
| Lecture | `Set-LapsADReadPasswordPermission` | Lire les attributs du mot de passe |
| Expiration | `Set-LapsADResetPasswordPermission` | Forcer l'expiration du mot de passe |

: Permissions Windows LAPS

Le droit de lecture ne suffit pas pour un mot de passe chiffré. Le lecteur doit aussi être membre du principal de déchiffrement configuré dans la stratégie.

**Cycle de traitement.** Windows LAPS traite sa stratégie toutes les heures et à chaque notification de changement de stratégie de groupe. `Invoke-LapsPolicyProcessing` force un traitement immédiat.

**Actions post-authentification.** Après une connexion avec le compte géré, Windows LAPS attend un délai de grâce (`PostAuthenticationResetDelay`, 24 heures par défaut) puis réinitialise le mot de passe et, selon la valeur choisie, déconnecte le compte ou redémarre la machine.

## Prérequis

- Un compte membre de **Schema Admins** pour l'extension du schéma (opération unique pour la forêt), et de **Domain Admins** pour la délégation et la stratégie.
- Des contrôleurs de domaine SRV-DC-01 et SRV-DC-02 sous Windows Server 2025, et un niveau fonctionnel de domaine Windows Server 2016 ou supérieur pour le chiffrement.
- Des serveurs membres (SRV-APP-01, SRV-APP-02, etc.) sous Windows Server 2019 ou 2022 à jour, ou Windows Server 2025, placés dans l'OU `OU=Serveurs,DC=lab,DC=local`.
- Un groupe global `GG-LAPS-Lecteurs` destiné aux administrateurs autorisés à lire et déchiffrer les mots de passe.
- La console GPMC (`gpmc.msc`), la console Utilisateurs et ordinateurs Active Directory (`dsa.msc`) et le module PowerShell **LAPS** (natif sur les versions prises en charge).
- Si un magasin central de stratégies est utilisé, une copie de `LAPS.admx` et de `LAPS.adml` dans `\\lab.local\SYSVOL\lab.local\Policies\PolicyDefinitions`.

## Points de Vigilance

**L'ancien Microsoft LAPS (MSI) est déprécié.** Microsoft l'a déprécié à partir de Windows 11 23H2, et les versions récentes de Windows bloquent l'installation de son MSI. Il ne reçoit plus d'évolution. Tout nouveau déploiement doit utiliser Windows LAPS. Sur un parc existant, Windows LAPS propose un mode d'émulation de l'ancien LAPS, qui stocke toutefois le mot de passe en clair et ne doit servir que de transition.

**L'extension côté client de l'ancien LAPS bloque l'émulation.** Si `AdmPwd.dll` est toujours enregistrée sur une machine, Windows LAPS s'efface devant elle en mode émulation. Désinstallez l'ancien client lors de la migration (`msiexec.exe /q /uninstall {97E2CA7B-B657-4FF7-A6DB-30ECC73E1E28}` pour la version 64 bits).

**Le magasin central n'est pas mis à jour automatiquement.** Les fichiers `LAPS.admx` et `LAPS.adml` sont installés dans `%windir%\PolicyDefinitions` par Windows Update, mais ne sont jamais copiés dans le magasin central. Sans copie manuelle, le nœud **LAPS** n'apparaît pas dans l'éditeur de GPO.

**Un mauvais principal de déchiffrement bloque la sauvegarde.** Si le paramètre **Configure authorized password decryptors** pointe vers un groupe inexistant ou mal orthographié, le traitement de la stratégie échoue et le mot de passe n'est pas sauvegardé. Ce paramètre est la seule exception à la règle « valeur invalide égale valeur par défaut ».

**Le droit Extended Rights expose les mots de passe.** Les attributs Windows LAPS sont confidentiels. Un compte disposant du droit « All extended rights » sur l'OU peut les lire. Auditez l'OU avec `Find-LapsADExtendedRights` avant le déploiement.

**Le compte personnalisé n'est pas créé par LAPS.** Si **Name of administrator account to manage** désigne un compte autre que l'administrateur intégré, ce compte doit déjà exister. Sur Windows Server 2025, la gestion automatique de compte (**Configure automatic account management**) peut le créer, mais ce paramètre est ignoré par les versions antérieures.

**La politique de mot de passe locale doit être compatible.** Si la longueur ou la complexité LAPS est inférieure aux exigences de la stratégie de mot de passe du domaine ou locale, la rotation échoue (événement 10027).

**Les stratégies CSP l'emportent sur les GPO.** Dès qu'un paramètre Windows LAPS est appliqué par Intune (CSP), tous les paramètres fournis par GPO sont ignorés sur la machine.

## Choix Architecturaux & Alternatives

### Quand choisir Windows LAPS avec sauvegarde Active Directory

La sauvegarde dans Active Directory est le choix naturel pour des serveurs joints à un domaine on-premise et gérés par GPO, comme les serveurs SRV-xxx-0x de `lab.local`. Elle ne demande aucune licence, fonctionne sans connexion Internet, chiffre le mot de passe et permet de conserver un historique. Elle gère aussi le mot de passe DSRM des contrôleurs de domaine, ce que la sauvegarde Entra ID ne fait pas.

La sauvegarde vers Microsoft Entra ID convient aux postes joints ou hybrides gérés par Intune, ou à une organisation qui veut centraliser la récupération dans le portail Entra et l'auditer avec les journaux Entra.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Windows LAPS, sauvegarde AD** | Serveurs et postes joints au domaine, pilotage GPO | Chiffrement, historique, DSRM, aucune dépendance cloud | Récupération dépendante d'un DC joignable | Gratuit |
| **Windows LAPS, sauvegarde Entra ID** | Appareils joints ou hybrides gérés par Intune | Récupération et audit dans le portail Entra, rotation à distance par Intune | Pas de DSRM, pas d'historique ni de chiffrement AD | Gratuit à Faible (Entra ID Free suffit, Intune facturé) |
| **Ancien Microsoft LAPS (MSI)** | Machines antérieures à Windows Server 2019 encore en service | Connu des équipes | Déprécié, mot de passe en clair dans AD, installation bloquée sur les versions récentes | Gratuit, à abandonner |
| **Coffre PAM tiers (CyberArk, Delinea)** | Grands comptes avec gestion centralisée des comptes à privilèges | Enregistrement de session, workflow d'approbation | Coût, intégration, agent ou connecteur à maintenir | Élevé |
| **Désactivation du compte administrateur local** | Parc entièrement administré par comptes de domaine | Supprime la cible | Aucun accès de secours en cas de perte de la relation d'approbation | Gratuit |

### Impact des choix

- **Sécurité.** Avec un mot de passe unique et chiffré par machine, la compromission d'un serveur ne donne plus accès aux autres. Restreindre le déchiffrement à `GG-LAPS-Lecteurs` plutôt qu'à Domain Admins s'inscrit dans le modèle d'administration en tiers.
- **Disponibilité.** En sauvegarde AD, la récupération nécessite un contrôleur de domaine. En cas de perte totale des DC, `Get-LapsADPassword` peut interroger une sauvegarde AD montée avec `dsamain.exe` (paramètres `-Port` et `-RecoveryMode`).
- **Exploitation.** Les actions post-authentification imposent une nouvelle consultation du mot de passe après chaque utilisation. C'est voulu, mais les équipes de support doivent en être informées.
- **Coût.** Aucun coût de licence pour la sauvegarde AD. La sauvegarde Entra ID nécessite au minimum Entra ID Free, et Intune si la stratégie est déployée par CSP.

## Méthode 1 : Configuration via la Console de Gestion des Stratégies de Groupe (gpmc.msc)

### Préparation de l'Annuaire

L'extension du schéma et la délégation n'ont pas d'équivalent graphique. Exécutez une fois, depuis SRV-DC-01, une session PowerShell élevée avec un compte membre de Schema Admins et Domain Admins :

```powershell
Update-LapsADSchema -Verbose
Set-LapsADComputerSelfPermission -Identity "OU=Serveurs,DC=lab,DC=local"
Set-LapsADReadPasswordPermission -Identity "OU=Serveurs,DC=lab,DC=local" -AllowedPrincipals "LAB\GG-LAPS-Lecteurs"
Set-LapsADResetPasswordPermission -Identity "OU=Serveurs,DC=lab,DC=local" -AllowedPrincipals "LAB\GG-LAPS-Lecteurs"
Find-LapsADExtendedRights -Identity "OU=Serveurs,DC=lab,DC=local"
```

<div class="callout callout-note">

Le résultat de `Find-LapsADExtendedRights` ne doit lister que `NT AUTHORITY\SYSTEM` et `LAB\Domain Admins`. Toute autre entrée doit être justifiée ou supprimée.

</div>

### Copie des Modèles dans le Magasin Central

1. Sur SRV-DC-01, copiez `C:\Windows\PolicyDefinitions\LAPS.admx` vers `\\lab.local\SYSVOL\lab.local\Policies\PolicyDefinitions\`.
2. Copiez `C:\Windows\PolicyDefinitions\fr-FR\LAPS.adml` (ou `en-US` selon la langue des consoles) vers le sous-dossier de langue correspondant du magasin central.

### Création de la GPO

1. Ouvrez `gpmc.msc` et créez dans **Group Policy Objects** une GPO nommée `GPO-SEC-LAPS-Serveurs-V1`.
2. Faites un clic droit sur la GPO > **Edit**, puis naviguez jusqu'à **Computer Configuration > Policies > Administrative Templates > System > LAPS**.
3. Configurez les paramètres suivants :

| Paramètre | Valeur |
|-----------|--------|
| **Configure password backup directory** | Enabled, **Active Directory** |
| **Password Settings** | Enabled, complexité **Large letters + small letters + numbers + special characters**, longueur 20, âge 30 jours |
| **Do not allow password expiration time longer than required by policy** | Enabled |
| **Enable password encryption** | Enabled |
| **Configure authorized password decryptors** | Enabled, `LAB\GG-LAPS-Lecteurs` |
| **Configure size of encrypted password history** | Enabled, 6 |
| **Post-authentication actions** | Enabled, délai 8 heures, action **Reset the password and logoff the managed account** |

: Paramètres de la GPO Windows LAPS

<div class="callout callout-note">

Ne configurez **Name of administrator account to manage** que si un compte local personnalisé existe déjà sur les serveurs. Laissé vide, Windows LAPS gère l'administrateur intégré, identifié par son RID 500 quel que soit son nom.

</div>

4. Pour les contrôleurs de domaine, créez une GPO distincte `GPO-SEC-LAPS-DSRM-V1` liée à l'OU **Domain Controllers**, avec **Configure password backup directory** sur Active Directory et **Enable password backup for DSRM accounts** sur Enabled.

### Liaison et Application

1. Dans GPMC, faites un clic droit sur `OU=Serveurs` > **Link an Existing GPO** et sélectionnez `GPO-SEC-LAPS-Serveurs-V1`.
2. Sur un serveur de test (SRV-APP-01), exécutez `gpupdate /force`.

### Consultation du Mot de Passe

1. Ouvrez `dsa.msc` avec un compte membre de `GG-LAPS-Lecteurs`.
2. Ouvrez les propriétés de l'ordinateur SRV-APP-01 et sélectionnez l'onglet **LAPS**.
3. Cliquez sur **Show password** pour afficher le mot de passe, ou sur **Expire now** pour forcer sa rotation au prochain cycle.

## Méthode 2 : Configuration via PowerShell

### Préparation de l'Annuaire

```powershell
$ou = "OU=Serveurs,DC=lab,DC=local"

Update-LapsADSchema -Verbose
Set-LapsADComputerSelfPermission  -Identity $ou
Set-LapsADReadPasswordPermission  -Identity $ou -AllowedPrincipals "LAB\GG-LAPS-Lecteurs"
Set-LapsADResetPasswordPermission -Identity $ou -AllowedPrincipals "LAB\GG-LAPS-Lecteurs"
Find-LapsADExtendedRights -Identity $ou
```

### Création de la GPO par Valeurs de Registre

Les paramètres de la GPO Windows LAPS sont écrits sous `HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\LAPS`. Le module GroupPolicy permet de les définir sans passer par l'éditeur :

```powershell
$gpo = New-GPO -Name "GPO-SEC-LAPS-Serveurs-V1"
$key = "HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\LAPS"

Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "BackupDirectory"                  -Type DWord  -Value 2
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "PasswordComplexity"               -Type DWord  -Value 4
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "PasswordLength"                   -Type DWord  -Value 20
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "PasswordAgeDays"                  -Type DWord  -Value 30
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "PasswordExpirationProtectionEnabled" -Type DWord -Value 1
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "ADPasswordEncryptionEnabled"      -Type DWord  -Value 1
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "ADPasswordEncryptionPrincipal"    -Type String -Value "LAB\GG-LAPS-Lecteurs"
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "ADEncryptedPasswordHistorySize"   -Type DWord  -Value 6
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "PostAuthenticationResetDelay"     -Type DWord  -Value 8
Set-GPRegistryValue -Name $gpo.DisplayName -Key $key -ValueName "PostAuthenticationActions"        -Type DWord  -Value 3

New-GPLink -Name $gpo.DisplayName -Target "OU=Serveurs,DC=lab,DC=local"
```

<div class="callout callout-note">

La méthode graphique reste la référence pour la lisibilité de la GPO. Vérifiez le résultat dans l'éditeur après exécution du script : chaque paramètre doit apparaître comme configuré sous **System > LAPS**.

</div>

### Application Immédiate sur un Serveur

```powershell
Invoke-Command -ComputerName SRV-APP-01 -ScriptBlock {
    gpupdate /target:computer /force
    Invoke-LapsPolicyProcessing
}
```

### Récupération du Mot de Passe

```powershell
# Mot de passe courant
Get-LapsADPassword -Identity SRV-APP-01 -AsPlainText

# Historique des mots de passe chiffrés
Get-LapsADPassword -Identity SRV-APP-01 -IncludeHistory -AsPlainText
```

### Rotation Forcée

```powershell
# Côté annuaire : expiration immédiate, rotation au prochain cycle
Set-LapsADPasswordExpirationTime -Identity SRV-APP-01

# Côté machine : rotation immédiate
Invoke-Command -ComputerName SRV-APP-01 -ScriptBlock { Reset-LapsPassword }
```

### Alternative : Sauvegarde dans Microsoft Entra ID

1. Dans le centre d'administration Microsoft Entra, ouvrez **Entra ID > Devices > Overview > Device settings** et passez **Enable Microsoft Entra Local Administrator Password Solution (LAPS)** sur **Yes**.
2. Dans la stratégie (GPO pour un appareil hybride, Intune sinon), réglez **Configure password backup directory** sur **Azure Active Directory** (valeur 1).
3. Les paramètres propres à AD (chiffrement, historique, DSRM, protection de l'expiration) sont alors ignorés.

## Vérifications

**Schéma étendu :** `Get-ADObject "CN=ms-LAPS-Password,CN=Schema,CN=Configuration,DC=lab,DC=local"` retourne l'objet.

**Journal de la machine :** sur SRV-APP-01, le journal **Applications and Services Logs > Microsoft > Windows > LAPS > Operational** contient l'événement 10018, qui confirme la mise à jour du mot de passe dans Active Directory.

**Lecture autorisée :** `Get-LapsADPassword -Identity SRV-APP-01 -AsPlainText` exécuté par un membre de `GG-LAPS-Lecteurs` affiche `Source : EncryptedPassword` et `DecryptionStatus : Success`.

**Lecture refusée :** le même cmdlet exécuté par un utilisateur non autorisé ne renvoie pas de mot de passe exploitable.

**Connexion :** une ouverture de session `.\Administrateur` sur SRV-APP-01 avec le mot de passe récupéré réussit, puis le mot de passe change après le délai post-authentification.

**Diagnostic complet :** `Get-LapsDiagnostics` sur SRV-APP-01 produit une archive de traces et de journaux exploitable en cas de doute.

## Dépannage

**Événement 10012, schéma non étendu :** le schéma n'a pas été étendu ou la modification n'a pas encore été répliquée vers le DC contacté. Exécutez `Update-LapsADSchema`, puis forcez la réplication de la partition de schéma avec `repadmin /syncall /AdeP` et vérifiez l'absence d'erreur avec `repadmin /showrepl`.

**Événement 10027, mot de passe non conforme :** la longueur ou la complexité configurée dans LAPS est inférieure à la stratégie de mot de passe du domaine ou à une stratégie de mot de passe affinée. Alignez les paramètres **Password Settings** sur la stratégie la plus exigeante. Contrôlez la politique effective avec `net accounts`.

**Événement 10056, aucun DC accessible en écriture :** le serveur ne trouve pas de contrôleur de domaine inscriptible. Testez avec `nltest /dsgetdc:lab.local /force /writable` et vérifiez les flux réseau vers SRV-DC-01 et SRV-DC-02.

**Événement 10057, échec de liaison LDAP :** le canal sécurisé de la machine est rompu. Testez avec `nltest /sc_query:lab.local` et réparez avec `Test-ComputerSecureChannel -Repair`.

**L'onglet LAPS est vide ou absent dans dsa.msc :** la console utilisée provient d'une version de RSAT antérieure à Windows LAPS, ou le compte n'a pas le droit de lecture. Utilisez la console d'un serveur Windows Server 2025 ou `Get-LapsADPassword`.

**DecryptionStatus Unauthorized :** le compte a le droit de lecture mais n'est pas membre du principal de déchiffrement. Ajoutez-le à `GG-LAPS-Lecteurs`, ouvrez une nouvelle session pour rafraîchir le jeton, puis réessayez. Un mot de passe déjà chiffré pour un autre principal ne devient lisible qu'après la rotation suivante.

**Aucun traitement LAPS sur la machine :** la GPO n'est pas appliquée. Vérifiez avec `gpresult /scope computer /r` que `GPO-SEC-LAPS-Serveurs-V1` figure dans les objets appliqués, et que l'ancien client `AdmPwd.dll` n'est pas installé.

## Conseils et Bonnes Pratiques

**Déléguer à un groupe dédié, pas à Domain Admins.** Créez un groupe de lecteurs par niveau d'administration (serveurs, postes) et utilisez-le comme principal de déchiffrement. Les administrateurs de domaine ne doivent pas ouvrir de session sur des serveurs membres.

**Activer les actions post-authentification.** Un mot de passe consulté doit être considéré comme exposé. La réinitialisation automatique après usage réduit sa durée de vie utile.

**Conserver un historique chiffré.** Un historique de quelques mots de passe permet de restaurer une machine depuis une sauvegarde ou un instantané antérieur à la dernière rotation.

**Protéger le mot de passe DSRM des contrôleurs de domaine.** Activez la sauvegarde DSRM sur SRV-DC-01 et SRV-DC-02. Le mot de passe DSRM est rarement changé manuellement et constitue une porte de secours sensible.

**Auditer les consultations.** Activez l'audit d'accès au service d'annuaire sur l'OU des serveurs pour tracer les lectures des attributs `msLAPS-*`, et transférez les événements vers le SIEM.

**Utiliser une OU de pré-production.** Joignez les nouveaux serveurs dans une OU sans stratégie LAPS, puis déplacez-les dans `OU=Serveurs` une fois le déploiement terminé. Cela évite qu'une rotation casse un script de déploiement qui utilise le compte local.

## Procédures Liées

- [Délégation de l'Administration Active Directory](/procedures/windows/delegation-de-ladministration-active-directory) *(Délégation des droits de lecture et d'expiration sur l'OU)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Séparation des groupes de lecteurs par niveau)*
- [Gestion des Objets dans Active Directory](/procedures/windows/gestion-des-objets-dans-active-directory) *(Création des OU et du groupe GG-LAPS-Lecteurs)*
- [Configuration de Entra ID Connect (Hybrid Identity)](/procedures/azure/configuration-de-entra-id-connect-hybrid-identity) *(Prérequis à la sauvegarde Entra ID pour les appareils hybrides)*
- [Restauration d'Objets et Récupération d'Active Directory](/procedures/windows/restauration-dobjets-et-recuperation-dactive-directory) *(Récupération des mots de passe depuis une sauvegarde AD)*
- [Durcissement de Windows Server avec OSConfig et Credential Guard](/procedures/windows/durcissement-de-windows-server-avec-osconfig-et-credential-guard) *(Scénario OSConfig dédié à Windows LAPS)*
