---
modele: "procedure"
titre: "Mise en Place d'une Approbation entre Forêts"
type: "PROCEDURE"
class: "07. Identité"
reference: "WIN-IDM-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la mise en place d'une approbation de forêt (forest trust) entre la forêt `lab.local` et une forêt partenaire fictive `partner.local`, sous Windows Server 2025.

Le périmètre couvre les prérequis DNS (redirecteurs conditionnels), la création de l'approbation, le choix du sens, l'authentification sélective et le filtrage SID. Les approbations externes, de raccourci et de domaine Kerberos (realm) sont seulement comparées. La migration de comptes avec SID History sort du périmètre.

| Élément | Forêt `lab.local` | Forêt `partner.local` |
|---------|-------------------|-----------------------|
| Contrôleurs | SRV-DC-01 (192.168.10.10), SRV-DC-02 (192.168.10.11) | SRV-DCP-01 (192.168.30.10) |
| Réseau | 192.168.10.0/24 | 192.168.30.0/24 |
| Rôle dans le scénario | Forêt de ressources (approbatrice) | Forêt de comptes (approuvée) |
| Ressource partagée | Serveur de fichiers SRV-FIC-01.lab.local | Groupe global `PARTNER\GG-Projet-Alpha` |

Le scénario retenu est une approbation **unidirectionnelle sortante** depuis `lab.local` : `lab.local` approuve `partner.local`. Les utilisateurs de `partner.local` peuvent accéder à des ressources choisies de `lab.local`, l'inverse est impossible.

## Contexte et Justification

Deux organisations qui collaborent, ou deux entités d'un même groupe dont les annuaires sont séparés, doivent souvent partager des ressources sans fusionner leurs forêts. Sans approbation, les solutions de contournement dégradent la sécurité.

- La création de comptes en double dans la forêt de ressources multiplie les identités et les mots de passe à gérer.
- Le partage de comptes génériques supprime toute traçabilité nominative.
- L'exposition de ressources sans authentification intégrée oblige à des mécanismes d'accès moins sûrs.

L'approbation de forêt permet aux comptes d'une forêt d'être authentifiés par Kerberos ou NTLM dans l'autre forêt, puis autorisés par les ACL habituelles. Elle est transitive entre tous les domaines des deux forêts. Combinée à l'authentification sélective et au filtrage SID, elle limite l'accès aux seules ressources explicitement ouvertes.

## Concepts Clés

**Approbation de forêt.** Lien de confiance transitif entre les domaines racines de deux forêts. Il s'étend automatiquement à tous les domaines de chaque forêt, mais n'est pas transitif vers une troisième forêt.

**Sens de l'approbation.** Le domaine approbateur (trusting) héberge les ressources. Le domaine approuvé (trusted) héberge les comptes. L'accès circule dans le sens inverse de l'approbation. Vu depuis `lab.local`, une approbation **sortante** (outgoing) signifie que `lab.local` approuve `partner.local`. Une approbation **entrante** (incoming) signifie l'inverse. Une approbation **bidirectionnelle** cumule les deux.

**Redirecteur conditionnel.** Configuration DNS qui envoie les requêtes d'une zone donnée vers des serveurs précis. Chaque forêt doit résoudre les enregistrements SRV de l'autre (`_ldap._tcp.dc._msdcs.partner.local`), sans quoi l'approbation ne peut être créée ni utilisée.

**Authentification à l'échelle de la forêt.** Tout compte de la forêt approuvée est considéré comme authentifié dans la forêt approbatrice et reçoit le SID Authenticated Users. L'accès dépend alors uniquement des ACL des ressources.

**Authentification sélective.** Un compte de la forêt approuvée ne peut s'authentifier auprès d'un ordinateur de la forêt approbatrice que s'il dispose de l'autorisation **Allowed to Authenticate** sur l'objet ordinateur de cette machine. Un SID Other Organization est ajouté au jeton. Ce mode inverse la logique par défaut : rien n'est accessible tant que ce n'est pas explicitement accordé.

**Filtrage SID.** Mécanisme qui rejette, à la frontière de l'approbation, les SID n'appartenant pas à la forêt approuvée, notamment ceux injectés via l'attribut SID History. Il est actif par défaut sur les nouvelles approbations de forêt et empêche un administrateur de la forêt partenaire de s'attribuer des SID privilégiés de `lab.local`.

**Routage des suffixes de noms.** Liste des suffixes DNS et UPN revendiqués par la forêt approuvée, utilisés pour router les authentifications Kerberos. Un suffixe en conflit ou désactivé empêche l'authentification des comptes concernés.

**Délégation de TGT.** La délégation Kerberos non contrainte à travers une approbation de forêt est désactivée par défaut depuis les mises à jour de 2019. Une application qui en dépend doit être revue plutôt que de réactiver cette option.

## Prérequis

- Un compte membre de **Enterprise Admins** ou **Domain Admins** du domaine racine dans chaque forêt, ou un compte délégué pour la création d'approbations.
- Un niveau fonctionnel de forêt Windows Server 2003 ou supérieur dans les deux forêts. `lab.local` est au niveau Windows Server 2025.
- Une connectivité routée entre 192.168.10.0/24 et 192.168.30.0/24, avec les flux ouverts entre contrôleurs : DNS 53 (TCP et UDP), Kerberos 88 (TCP et UDP), RPC 135 et plage dynamique 49152 à 65535, LDAP 389 (TCP et UDP), SMB 445, kpasswd 464, GC 3268.
- Une synchronisation horaire correcte des deux forêts (écart inférieur à 5 minutes pour Kerberos).
- Des espaces de noms DNS et des noms NetBIOS distincts (`LAB` et `PARTNER`).
- Le rôle DNS sur les contrôleurs des deux forêts, avec les consoles `dnsmgmt.msc` et `domain.msc`.
- Un mot de passe d'approbation fort, transmis de façon sécurisée à l'administrateur de l'autre forêt si l'approbation est créée côté par côté.

## Points de Vigilance

**Sans résolution DNS croisée, rien ne fonctionne.** L'assistant échoue avec un message indiquant que le domaine est introuvable. Le redirecteur conditionnel doit exister dans les deux forêts avant toute création, et être répliqué sur tous les contrôleurs DNS.

**Le sens est contre-intuitif.** Pour que les utilisateurs de `partner.local` accèdent à `lab.local`, l'approbation est sortante côté `lab.local` et entrante côté `partner.local`. Une erreur de sens produit une approbation valide mais inutile.

**L'authentification à l'échelle de la forêt ouvre largement.** Toutes les ressources dont l'ACL contient Authenticated Users, Domain Users via des imbrications ou Everyone deviennent accessibles aux comptes partenaires. Pour un partenaire externe, l'authentification sélective est le choix par défaut.

**L'authentification sélective exige aussi des droits sur les contrôleurs.** Microsoft indique, depuis les protections liées à la CVE-2022-21857, que le PDC de la forêt approuvée doit disposer de **Allowed to Authenticate** sur les comptes ordinateurs des contrôleurs de la forêt approbatrice. Les flux LDAP 389 depuis ce PDC doivent également être autorisés.

**Ne désactivez pas le filtrage SID.** L'option `/enablesidhistory:yes` de `netdom` assouplit le filtrage pour une migration. Microsoft précise de ne l'activer que si les administrateurs de la forêt approuvée sont dignes de confiance. En dehors d'une migration encadrée, laissez-la désactivée.

**`netdom trust` ne crée pas d'approbation de forêt.** Microsoft indique que la création d'une approbation de forêt se fait avec la console **Active Directory Domains and Trusts** ou par script. `netdom` reste utile pour vérifier et modifier les attributs d'une approbation existante.

**Le chiffrement Kerberos de l'approbation doit être AES.** Microsoft a engagé le retrait progressif de RC4 dans Kerberos. Vérifiez que l'option **The other domain supports Kerberos AES Encryption** est cochée sur l'approbation et que les deux forêts prennent en charge AES, afin d'éviter des échecs d'authentification lors du durcissement.

## Choix Architecturaux & Alternatives

### Quand choisir une approbation de forêt

L'approbation de forêt convient quand deux forêts Active Directory distinctes doivent partager des ressources durablement, avec authentification Kerberos et transitivité vers tous leurs domaines : partenariat long, filiale autonome, forêt de ressources dédiée, phase transitoire d'une fusion. Avec l'authentification sélective, elle reste adaptée à un partenaire externe dont on ne contrôle pas l'administration.

Ne choisissez pas une approbation de forêt pour un accès ponctuel à une application web : une fédération d'identité (SAML, OpenID Connect) ou un invité Entra B2B est plus simple et ne crée pas de lien entre annuaires. Ne la choisissez pas non plus si une seule paire de domaines est concernée et que la transitivité est indésirable : une approbation externe est plus restreinte.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Approbation de forêt avec authentification sélective** | Partenaire externe ou filiale, ressources ciblées | Kerberos, transitivité, accès explicitement accordé | Gestion des droits Allowed to Authenticate | Faible (exploitation) |
| **Approbation de forêt à l'échelle de la forêt** | Deux forêts d'une même organisation | Simplicité, accès homogène | Ouverture large via Authenticated Users | Gratuit |
| **Approbation externe** | Accès entre deux domaines précis, forêt ancienne | Non transitive, filtrage SID quarantaine strict | NTLM pour une partie des scénarios, pas de routage de suffixes | Gratuit |
| **Fédération (AD FS, Entra ID B2B)** | Applications web et SaaS partagées | Aucun lien entre annuaires, standard ouvert | Inadapté aux partages SMB et applications Kerberos | Moyen |
| **Consolidation de forêts (migration)** | Fusion définitive | Un seul annuaire à administrer | Projet long et coûteux | Élevé |

### Impact des choix

- **Sécurité.** L'authentification sélective et le filtrage SID sont les deux protections majeures. Une approbation bidirectionnelle à l'échelle de la forêt expose chaque forêt à la compromission de l'autre.
- **Disponibilité.** L'authentification croisée dépend du DNS et des contrôleurs des deux forêts. Des redirecteurs pointant vers au moins deux contrôleurs par forêt évitent un point de défaillance unique.
- **Exploitation.** L'authentification sélective impose de maintenir les autorisations sur chaque serveur ouvert. Un groupe de domaine local dédié par ressource simplifie cette maintenance.
- **Coût.** L'approbation ne requiert aucune licence. Le coût réel est celui de l'exploitation des droits et de la coordination entre les équipes des deux forêts.

## Méthode 1 : Configuration via la Console Domaines et approbations Active Directory (domain.msc)

### Étape 1 : Redirecteurs Conditionnels

Sur SRV-DC-01 (`lab.local`).

1. Ouvrez `dnsmgmt.msc`, faites un clic droit sur **Conditional Forwarders** > **New Conditional Forwarder**.
2. **DNS Domain** : `partner.local`.
3. **IP addresses of the master servers** : `192.168.30.10`.
4. Cochez **Store this conditional forwarder in Active Directory, and replicate it as follows**, puis choisissez **All DNS servers in this forest**.
5. Cliquez sur **OK**.

Sur SRV-DCP-01 (`partner.local`), répétez l'opération pour `lab.local` avec les adresses 192.168.10.10 et 192.168.10.11.

<div class="callout callout-note">

Contrôlez la résolution avant de poursuivre avec `nslookup -type=SRV _ldap._tcp.dc._msdcs.partner.local` depuis SRV-DC-01, et l'inverse depuis SRV-DCP-01.

</div>

### Étape 2 : Création de l'Approbation

Sur SRV-DC-01, avec un compte Enterprise Admins de `lab.local`.

1. Ouvrez `domain.msc`, faites un clic droit sur `lab.local` > **Properties** > onglet **Trusts** > **New Trust**.
2. **Trust Name** : `partner.local`.
3. **Trust Type** : **Forest trust**.
4. **Direction of Trust** : **One-way: outgoing**. Les utilisateurs de `partner.local` pourront accéder aux ressources de `lab.local`.
5. **Sides of Trust** : **Both this domain and the specified domain**, puis saisissez les identifiants d'un administrateur de `partner.local`. Si l'administrateur partenaire crée lui-même son côté, choisissez **This domain only** et convenez d'un mot de passe d'approbation commun.
6. **Outgoing Trust Authentication Level** : **Selective authentication**.
7. Vérifiez le résumé, puis cliquez sur **Next**.
8. **Confirm Outgoing Trust** : **Yes, confirm the outgoing trust**.
9. Cliquez sur **Finish**.

### Étape 3 : Contrôle des Propriétés de l'Approbation

1. Dans l'onglet **Trusts**, sous **Domains trusted by this domain (outgoing trusts)**, sélectionnez `partner.local` > **Properties**.
2. Onglet **General** : vérifiez **Forest trust**, **Transitive**, et cochez **The other domain supports Kerberos AES Encryption** si `partner.local` prend en charge AES.
3. Onglet **Name Suffix Routing** : vérifiez que `*.partner.local` est à l'état **Enabled**.
4. Onglet **Authentication** : vérifiez **Selective authentication**.
5. Onglet **General** > **Validate** pour tester l'approbation.

### Étape 4 : Ouverture d'une Ressource avec l'Authentification Sélective

1. Dans `dsa.msc` de `lab.local`, créez un groupe de domaine local `DL-SRV-FIC-01-Auth-Partner` et ajoutez-y `PARTNER\GG-Projet-Alpha`.
2. Activez **Affichage** > **Fonctionnalités avancées**.
3. Ouvrez l'objet ordinateur **SRV-FIC-01** > **Properties** > onglet **Security** > **Add**, puis sélectionnez `DL-SRV-FIC-01-Auth-Partner`.
4. Cochez **Allow** sur **Allowed to authenticate**, puis **OK**.
5. Sur SRV-FIC-01, accordez au même groupe les droits de partage et NTFS nécessaires sur le dossier partagé.
6. Répétez l'attribution de **Allowed to authenticate** sur les objets ordinateurs de SRV-DC-01 et SRV-DC-02 au profit du compte ordinateur du PDC de `partner.local` (SRV-DCP-01).

<div class="callout callout-note">

L'autorisation sur l'objet ordinateur ouvre seulement l'authentification. Les permissions de partage et NTFS restent nécessaires pour accéder aux données.

</div>

## Méthode 2 : Configuration via PowerShell

### Redirecteurs Conditionnels

Sur SRV-DC-01.

```powershell
Add-DnsServerConditionalForwarderZone -Name "partner.local" -MasterServers 192.168.30.10 -ReplicationScope "Forest"
Resolve-DnsName -Name "_ldap._tcp.dc._msdcs.partner.local" -Type SRV
```

Sur SRV-DCP-01.

```powershell
Add-DnsServerConditionalForwarderZone -Name "lab.local" -MasterServers 192.168.10.10,192.168.10.11 -ReplicationScope "Forest"
Resolve-DnsName -Name "_ldap._tcp.dc._msdcs.lab.local" -Type SRV
```

### Création de l'Approbation

Le module ActiveDirectory ne propose pas de cmdlet de création d'approbation. La création passe par la classe .NET `System.DirectoryServices.ActiveDirectory.Forest`, qui crée les deux côtés en un appel.

```powershell
$cred = Get-Credential -Message "Administrateur de partner.local" -UserName "PARTNER\Administrator"

$ctxDistant = New-Object System.DirectoryServices.ActiveDirectory.DirectoryContext(
    "Forest", "partner.local", $cred.UserName, $cred.GetNetworkCredential().Password)

$foretLocale  = [System.DirectoryServices.ActiveDirectory.Forest]::GetCurrentForest()
$foretDistante = [System.DirectoryServices.ActiveDirectory.Forest]::GetForest($ctxDistant)

# Outbound : lab.local approuve partner.local
$foretLocale.CreateTrustRelationship($foretDistante, "Outbound")
```

<div class="callout callout-note">

Les valeurs possibles du sens sont `Inbound`, `Outbound` et `Bidirectional`, toujours exprimées du point de vue de la forêt locale.

</div>

### Authentification Sélective et Filtrage SID

`netdom trust` modifie et affiche les attributs d'une approbation existante. Le premier argument est le domaine approbateur, `/domain` désigne le domaine approuvé.

```cmd
REM Activer l'authentification sélective (valide sur une approbation sortante)
netdom trust lab.local /domain:partner.local /selectiveauth:yes

REM Afficher l'état sans le modifier
netdom trust lab.local /domain:partner.local /selectiveauth
netdom trust lab.local /domain:partner.local /enablesidhistory
```

<div class="callout callout-note">

Sans valeur, `/selectiveauth` et `/enablesidhistory` affichent l'état courant. `/enablesidhistory` doit rester à `No`, ce qui maintient le filtrage SID de l'approbation de forêt. L'option `/quarantine` concerne les approbations externes.

</div>

### Autorisation Allowed to Authenticate

```powershell
Import-Module ActiveDirectory

New-ADGroup -Name "DL-SRV-FIC-01-Auth-Partner" -GroupScope DomainLocal -GroupCategory Security -Path "OU=Groupes,DC=lab,DC=local"
Add-ADGroupMember -Identity "DL-SRV-FIC-01-Auth-Partner" -Members (Get-ADGroup -Identity "GG-Projet-Alpha" -Server "partner.local")

$ordinateur = Get-ADComputer -Identity "SRV-FIC-01"
$groupe     = Get-ADGroup -Identity "DL-SRV-FIC-01-Auth-Partner"
$droitGuid  = [Guid]"68b1d179-0d15-4d4f-ab71-46152e79a7bc"   # Allowed-To-Authenticate

$acl = Get-Acl -Path "AD:\$($ordinateur.DistinguishedName)"
$ace = New-Object System.DirectoryServices.ActiveDirectoryAccessRule(
    $groupe.SID, "ExtendedRight", "Allow", $droitGuid)
$acl.AddAccessRule($ace)
Set-Acl -Path "AD:\$($ordinateur.DistinguishedName)" -AclObject $acl
```

<div class="callout callout-note">

Le GUID `68b1d179-0d15-4d4f-ab71-46152e79a7bc` est le Rights-GUID du droit étendu Allowed-To-Authenticate. Le lecteur `AD:` est fourni par le module ActiveDirectory.

</div>

## Vérifications

**Résolution DNS croisée :** `Resolve-DnsName -Type SRV _ldap._tcp.dc._msdcs.partner.local` depuis SRV-DC-01 retourne SRV-DCP-01, et l'inverse depuis SRV-DCP-01.

**Propriétés de l'approbation :** `Get-ADTrust -Identity "partner.local" | Select-Object Name,Direction,TrustType,ForestTransitive,SelectiveAuthentication` retourne une direction `Outbound`, `ForestTransitive` à `True` et `SelectiveAuthentication` à `True`.

**Validation :** `netdom trust lab.local /domain:partner.local /verify` réussit, de même que **Validate** dans `domain.msc`.

**Liste des approbations :** `nltest /domain_trusts` affiche `partner.local` avec les attributs de forêt.

**Filtrage SID :** `netdom trust lab.local /domain:partner.local /enablesidhistory` indique que SID History n'est pas autorisé.

**Accès effectif :** un membre de `PARTNER\GG-Projet-Alpha` ouvre `\\SRV-FIC-01.lab.local\Projet` avec succès. Un autre utilisateur de `partner.local` reçoit un refus, et un utilisateur de `lab.local` ne peut accéder à aucune ressource de `partner.local`.

## Dépannage

**« The specified domain either does not exist or could not be contacted » dans l'assistant :** la résolution DNS de `partner.local` échoue. Vérifiez le redirecteur conditionnel, sa réplication sur SRV-DC-01 et SRV-DC-02, et l'ouverture du port 53 vers SRV-DCP-01.

**« Échec de la validation de l'approbation » :** le mot de passe d'approbation diffère entre les deux côtés, un flux RPC ou Kerberos est bloqué, ou l'écart horaire dépasse 5 minutes. Contrôlez avec `Test-NetConnection 192.168.30.10 -Port 88` et `w32tm /stripchart /computer:192.168.30.10 /samples:3`.

**« Un utilisateur partenaire est refusé malgré ses droits NTFS » :** l'authentification sélective est active et le groupe ne dispose pas de **Allowed to authenticate** sur l'objet ordinateur du serveur. Un échec de ce type peut apparaître dans les traces réseau sous la forme `STATUS_AUTHENTICATION_FIREWALL_FAILED`. Ajoutez l'autorisation, puis demandez à l'utilisateur de purger ses tickets avec `klist purge`.

**« L'authentification Kerberos échoue, NTLM fonctionne » :** le suffixe de noms est désactivé ou en conflit dans l'onglet **Name Suffix Routing**, ou les types de chiffrement diffèrent. Activez le suffixe, vérifiez l'option AES de l'approbation et utilisez des noms DNS complets pour les ressources.

**« L'approbation est créée mais aucun accès ne fonctionne » :** le sens est inversé. Vérifiez avec `Get-ADTrust` : pour donner accès aux utilisateurs de `partner.local`, la direction doit être `Outbound` côté `lab.local`.

## Conseils et Bonnes Pratiques

**Choisir l'approbation la plus restreinte.** Préférez une approbation unidirectionnelle avec authentification sélective. Une approbation bidirectionnelle à l'échelle de la forêt se justifie uniquement entre deux forêts d'une même organisation au même niveau de sécurité.

**Gérer les accès par groupes de domaine local.** Un groupe par ressource, contenant les groupes globaux de la forêt partenaire, sert à la fois pour **Allowed to authenticate** et pour les permissions NTFS. La revue des accès se limite alors à la composition de ces groupes.

**Ne jamais activer SID History hors migration.** Si une migration l'exige, limitez la durée, documentez la décision et réactivez le filtrage à la fin.

**Formaliser l'approbation avec le partenaire.** Consignez le sens, le mode d'authentification, les ressources ouvertes, les contacts d'administration et une date de revue. Une approbation qui n'a plus d'usage doit être supprimée des deux côtés.

**Surveiller les authentifications croisées.** Collectez les événements d'ouverture de session des serveurs ouverts au partenaire et les événements Kerberos des contrôleurs vers la supervision centrale.

**Pointer les redirecteurs vers plusieurs contrôleurs.** Chaque redirecteur conditionnel doit contenir au moins deux contrôleurs DNS de la forêt cible quand ils existent, afin que l'approbation survive à la perte d'un contrôleur.

## Procédures Liées

- [Configuration d'un Serveur DNS Dédié](/procedures/windows/configuration-dun-serveur-dns-dedie) *(Redirecteurs conditionnels et résolution inter-forêts)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Protection des comptes privilégiés face à une forêt externe)*
- [Délégation de l'Administration Active Directory](/procedures/windows/delegation-de-ladministration-active-directory) *(Groupes et droits délégués pour les ressources ouvertes)*
- [Configuration du Pare-feu Windows et des Règles de Sécurité de Connexion](/procedures/windows/configuration-du-pare-feu-windows-et-des-regles-de-securite-de-connexion) *(Ouverture des flux entre contrôleurs des deux forêts)*
- [Dépannage de la Réplication AD et de Kerberos](/procedures/windows/depannage-de-la-replication-ad-et-de-kerberos) *(Diagnostic des échecs Kerberos à travers l'approbation)*
- [Configuration d'un Serveur de Temps (NTP) pour un Domaine AD](/procedures/windows/configuration-dun-serveur-de-temps-ntp-pour-un-domaine-ad) *(Synchronisation horaire indispensable à Kerberos)*
