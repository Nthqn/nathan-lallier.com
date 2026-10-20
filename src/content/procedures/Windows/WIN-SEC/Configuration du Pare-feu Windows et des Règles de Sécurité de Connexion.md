---
modele: "procedure"
titre: "Configuration du Pare-feu Windows et des Règles de Sécurité de Connexion"
type: "PROCEDURE"
class: "09. Sécurité"
reference: "WIN-SEC-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la configuration du **Pare-feu Windows Defender avec fonctions avancées de sécurité** sur les serveurs du domaine `lab.local`. Elle couvre les profils réseau, les règles entrantes et sortantes, la journalisation, les **règles de sécurité de connexion** IPsec qui authentifient les échanges entre machines du domaine, et le déploiement centralisé par GPO.

Les règles sont créées à la fois avec la console `wf.msc` (pour un serveur isolé ou une GPO éditée graphiquement) et avec les cmdlets du module **NetSecurity**. La configuration d'un pare-feu périmétrique et le chiffrement IPsec en mode tunnel vers un site distant sortent du périmètre.

## Contexte et Justification

Un réseau interne plat, où chaque serveur peut joindre tous les autres sur tous les ports, facilite la propagation d'une compromission. Un attaquant qui contrôle un poste peut alors scanner le réseau 192.168.10.0/24, atteindre les partages administratifs, WinRM ou RDP de chaque serveur et se déplacer latéralement.

Le pare-feu Windows est présent sur chaque serveur et ne coûte rien. Correctement configuré, il apporte :

- **Une segmentation au plus près de la charge :** chaque serveur n'expose que les ports de son rôle, et seulement aux sources légitimes.
- **Un filtrage des flux d'administration :** RDP, WinRM et SMB administratif ne sont accessibles qu'aux postes d'administration.
- **Une authentification réseau :** les règles de sécurité de connexion exigent que l'émetteur soit une machine du domaine authentifiée par Kerberos, ce qu'une adresse IP usurpée ne peut pas satisfaire.
- **Une traçabilité :** le journal des paquets rejetés aide au diagnostic et à la détection.

## Concepts Clés

**Profils réseau.** Le pare-feu applique l'un de trois profils à chaque interface :

| Profil | Attribution | Usage attendu |
|--------|-------------|---------------|
| **Domain** | L'ordinateur détecte et authentifie un contrôleur de son domaine via cette interface | Profil normal des serveurs de `lab.local` |
| **Private** | Réseau déclaré privé par un administrateur | Réseau de confiance hors domaine |
| **Public** | Valeur par défaut de tout réseau non identifié | Réseau non maîtrisé, profil le plus restrictif |

: Profils du pare-feu Windows

La détection du profil Domain repose sur le service Network Location Awareness (NlaSvc).

**Action par défaut.** Chaque profil définit une action par défaut pour le trafic entrant (Block par défaut) et sortant (Allow par défaut). Une règle explicite l'emporte sur l'action par défaut.

**Règles de pare-feu.** Une règle associe des conditions (programme, service, protocole, ports, adresses locales et distantes, profils, interfaces) à une action **Allow**, **Block** ou **Allow if secure**. Ordre d'évaluation simplifié :

1. Les règles de blocage explicites l'emportent sur les règles d'autorisation.
2. Une règle **Allow if secure** avec l'option de substitution (override) peut passer outre un blocage.
3. Sans règle correspondante, l'action par défaut du profil s'applique.

**Fusion des règles locales.** Par GPO, les options **Apply local firewall rules** et **Apply local connection security rules** déterminent si les règles créées localement par un administrateur sont prises en compte en plus des règles de la GPO.

**Règle de sécurité de connexion.** Règle IPsec qui définit **comment** deux machines s'authentifient et protègent leurs échanges, sans décider seule si le trafic est autorisé. Les types proposés sont **Isolation**, **Authentication exemption**, **Server-to-server**, **Tunnel** et **Custom**. Les exigences d'authentification sont :

| Exigence | Effet |
|----------|-------|
| **Request authentication for inbound and outbound connections** | Tente IPsec, accepte le trafic en clair en cas d'échec |
| **Require authentication for inbound connections and request authentication for outbound connections** | Exige IPsec en entrée, tente IPsec en sortie |
| **Require authentication for inbound and outbound connections** | Exige IPsec dans les deux sens |

: Exigences d'authentification IPsec

**Isolation de domaine.** Architecture où les membres du domaine exigent une authentification IPsec Kerberos pour les connexions entrantes. Seules les machines du domaine peuvent alors les joindre. Les contrôleurs de domaine sont exemptés, car une machine doit pouvoir les contacter pour obtenir son ticket Kerberos.

**Magasin de stratégie (PolicyStore).** Emplacement où une cmdlet NetSecurity lit ou écrit. `PersistentStore` désigne la configuration locale, `ActiveStore` la stratégie effective, et `lab.local\<NomGPO>` une GPO du domaine.

## Prérequis

- Un compte membre de **Domain Admins**, ou disposant des droits de création et de liaison de GPO sur l'OU des serveurs.
- Des contrôleurs SRV-DC-01 (192.168.10.10) et SRV-DC-02 (192.168.10.11) sous Windows Server 2025, et des serveurs membres SRV-xxx-0x dans `OU=Serveurs,DC=lab,DC=local`.
- Un poste d'administration SRV-ADM-01 (192.168.10.50) depuis lequel les flux d'administration sont autorisés.
- La console `wf.msc`, la console GPMC (`gpmc.msc`) et les modules PowerShell **NetSecurity** et **GroupPolicy**.
- Un inventaire des flux applicatifs de chaque serveur (ports, protocoles, sources), validé avec les équipes concernées.
- Un accès console ou hyperviseur à chaque serveur de test, en cas de règle trop restrictive.

## Points de Vigilance

**Ne désactivez jamais le pare-feu pour diagnostiquer.** Désactiver un profil laisse le serveur exposé et masque la règle réellement en cause. Utilisez la journalisation et `Get-NetFirewallRule` pour identifier le blocage.

**Un blocage explicite l'emporte sur une autorisation.** Une règle **Block** déployée par une GPO ne peut pas être contournée par une règle **Allow** locale ou d'une autre GPO, sauf règle **Allow if secure** avec substitution. Évitez les règles de blocage larges et préférez l'action par défaut Block avec des autorisations ciblées.

**Le blocage du trafic sortant exige un inventaire complet.** Passer l'action sortante par défaut à Block sans règles pour DNS, Kerberos, LDAP, NTP, Windows Update et la supervision rend le serveur inutilisable et peut le sortir du domaine.

**Les contrôleurs de domaine doivent être exemptés de l'isolation IPsec.** Une règle qui exige IPsec vers SRV-DC-01 et SRV-DC-02 crée une dépendance circulaire : la machine a besoin d'un ticket Kerberos pour négocier IPsec, et a besoin d'IPsec pour obtenir ce ticket. Créez une règle **Authentication exemption** pour 192.168.10.10 et 192.168.10.11.

**Passer directement en « Require » coupe les machines non conformes.** Les équipements hors domaine (imprimantes, NAS, sondes, serveurs Linux) ne savent pas négocier IPsec Kerberos. Commencez en mode **Request** et analysez les associations de sécurité avant de passer en **Require**.

**Le profil Public peut s'appliquer par erreur à un serveur du domaine.** Si NlaSvc ne détecte pas le domaine au démarrage (DNS indisponible, DC injoignable, ordre de démarrage), l'interface passe en profil Public et les règles limitées au profil Domain ne s'appliquent plus. Ce comportement a fait l'objet de problèmes connus sur des contrôleurs de domaine Windows Server 2025, corrigés par des mises à jour cumulatives. Maintenez les serveurs à jour et contrôlez le profil après chaque redémarrage.

**Algorithmes faibles.** DES est retiré de Windows Server 2025. N'utilisez ni DES ni MD5 dans des ensembles de chiffrement IPsec personnalisés, et préférez AES-GCM et SHA-256 ou supérieur. Les valeurs par défaut de Windows conviennent dans la plupart des cas.

**La commande `netsh firewall` est obsolète.** Utilisez les cmdlets NetSecurity ou `netsh advfirewall`, qui reste prise en charge.

## Choix Architecturaux & Alternatives

### Quand choisir le pare-feu Windows et les règles de sécurité de connexion

Le pare-feu Windows piloté par GPO convient à tout parc Windows joint à Active Directory. Il assure une micro-segmentation par serveur sans équipement supplémentaire, et suit le serveur quel que soit son emplacement réseau (VLAN, site distant, VM déplacée).

Les règles de sécurité de connexion conviennent lorsque l'on veut que seules les machines du domaine puissent joindre les serveurs sensibles, ou qu'un serveur n'accepte un flux que d'un groupe de machines authentifiées. Elles ne remplacent pas le filtrage périmétrique et ne conviennent pas aux échanges avec des systèmes hors domaine sans infrastructure de certificats.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Pare-feu Windows par GPO** | Segmentation par serveur dans un domaine AD | Natif, centralisé, suit la machine | Gestion des règles à l'échelle, pas de vue réseau globale | Gratuit |
| **Isolation de domaine IPsec** | N'accepter que des machines authentifiées du domaine | Authentification forte des flux, indépendante de l'adresse IP | Complexité, équipements hors domaine à exempter | Gratuit |
| **Pare-feu réseau et VLAN (pfSense, OPNsense)** | Segmentation entre zones (serveurs, postes, DMZ) | Vue centralisée, filtrage avant l'hôte | Ne filtre pas les flux au sein d'un même VLAN | Faible à Moyen |
| **Pare-feu configuré par Intune** | Postes et serveurs gérés par Intune | Pilotage cloud, rapports | Licences, couverture serveur limitée | Moyen |
| **Micro-segmentation tierce (agents EDR ou SDN)** | Grands environnements, cartographie des flux | Visualisation des flux, politiques par étiquette | Coût, agent supplémentaire | Élevé |

### Impact des choix

- **Sécurité.** La combinaison d'une action entrante Block, de règles ciblées par source et de l'isolation IPsec réduit fortement la surface de mouvement latéral. Le filtrage sortant limite aussi l'exfiltration et les communications de commande et contrôle.
- **Disponibilité.** Une erreur de règle par GPO touche tous les serveurs de l'OU. Testez chaque GPO sur une OU de pilote, et conservez un accès console.
- **Exploitation.** Les règles par GPO se documentent et se versionnent. Les règles locales doivent être interdites en production (fusion désactivée) pour éviter une configuration divergente.
- **Coût.** Le pare-feu Windows et IPsec sont gratuits. Le coût réel est l'inventaire des flux et la maintenance des règles.

## Méthode 1 : Configuration via la Console Pare-feu Windows Defender avec fonctions avancées de sécurité (wf.msc)

Les étapes suivantes s'effectuent dans une GPO, ce qui ouvre la même interface que `wf.msc` sous la forme d'un nœud de l'éditeur de stratégie. Sur un serveur isolé, les mêmes écrans s'utilisent directement dans `wf.msc`.

### Création de la GPO

1. Ouvrez `gpmc.msc` et créez une GPO `GPO-SEC-Firewall-Serveurs-V1`.
2. Faites un clic droit > **Edit**, puis naviguez jusqu'à **Computer Configuration > Policies > Windows Settings > Security Settings > Windows Defender Firewall with Advanced Security > Windows Defender Firewall with Advanced Security - LDAP://...**.

### Configuration des Profils

1. Faites un clic droit sur le nœud **Windows Defender Firewall with Advanced Security** > **Properties**.
2. Dans chacun des onglets **Domain Profile**, **Private Profile** et **Public Profile** :
   - **Firewall state :** On ;
   - **Inbound connections :** Block (default) ;
   - **Outbound connections :** Allow (default).
3. Dans chaque onglet, sous **Settings**, cliquez sur **Customize** et réglez **Apply local firewall rules** et **Apply local connection security rules** sur **No**.
4. Sous **Logging**, cliquez sur **Customize** :
   - **Name :** `%systemroot%\system32\LogFiles\Firewall\pfirewall.log` ;
   - **Size limit (KB) :** `16384` ;
   - **Log dropped packets :** Yes ;
   - **Log successful connections :** No en production, Yes pendant la phase de diagnostic.
5. Validez avec **OK**.

<div class="callout callout-note">

Désactiver la fusion des règles locales est recommandé en production. Pendant la phase de pilote, laissez-la sur **Yes** pour pouvoir corriger localement un oubli sans attendre la GPO.

</div>

### Création d'une Règle Entrante

Exemple : autoriser RDP uniquement depuis le poste d'administration SRV-ADM-01.

1. Faites un clic droit sur **Inbound Rules** > **New Rule**.
2. **Rule Type :** Custom.
3. **Program :** All programs.
4. **Protocol and Ports :** TCP, **Local port** Specific Ports `3389`.
5. **Scope :** sous **Which remote IP addresses does this rule apply to?**, choisissez **These IP addresses** et ajoutez `192.168.10.50`.
6. **Action :** Allow the connection.
7. **Profile :** Domain uniquement.
8. **Name :** `Allow - RDP - SRV-ADM-01`.

Répétez pour WinRM (TCP 5985 et 5986) depuis SRV-ADM-01, et pour les ports métiers de chaque rôle.

### Création d'une Règle Sortante

Exemple : bloquer l'accès SMB sortant vers Internet tout en le laissant possible vers le réseau interne.

1. Faites un clic droit sur **Outbound Rules** > **New Rule** > **Custom**.
2. **Protocol and Ports :** TCP, **Remote port** `445`.
3. **Scope :** **Remote IP address** > **These IP addresses** > **Predefined set of computers** > **Internet**.
4. **Action :** Block the connection.
5. **Profile :** Domain, Private, Public.
6. **Name :** `Block - SMB sortant - Internet`.

### Création des Règles de Sécurité de Connexion

**Exemption des contrôleurs de domaine :**

1. Faites un clic droit sur **Connection Security Rules** > **New Rule**.
2. **Rule Type :** Authentication exemption.
3. **Exempt Computers :** ajoutez `192.168.10.10` et `192.168.10.11`.
4. **Profile :** Domain, Private, Public.
5. **Name :** `Exemption IPsec - SRV-DC-01 SRV-DC-02`.

**Isolation de domaine :**

1. Faites un clic droit sur **Connection Security Rules** > **New Rule**.
2. **Rule Type :** Isolation.
3. **Requirements :** Request authentication for inbound and outbound connections (phase de pilote).
4. **Authentication Method :** Computer (Kerberos V5).
5. **Profile :** Domain.
6. **Name :** `Isolation domaine - lab.local`.

Après validation des journaux, modifiez la règle et passez l'exigence sur **Require authentication for inbound connections and request authentication for outbound connections**.

### Règle Autorisant Uniquement les Connexions Sécurisées

1. Ouvrez la règle `Allow - RDP - SRV-ADM-01` > **Properties** > onglet **General**.
2. Sous **Action**, sélectionnez **Allow the connection if it is secure**, puis **Customize** > **Require the connections to be encrypted**.
3. Validez. Le flux RDP n'est alors accepté que s'il est authentifié et chiffré par IPsec.

### Liaison de la GPO

1. Liez `GPO-SEC-Firewall-Serveurs-V1` à une OU de pilote, puis à `OU=Serveurs,DC=lab,DC=local` après validation.
2. Sur un serveur cible, exécutez `gpupdate /force`.

## Méthode 2 : Configuration via PowerShell

### Ouverture d'une Session de GPO

Les cmdlets NetSecurity écrivent directement dans une GPO via `-PolicyStore`. Pour plusieurs modifications, une session mise en cache limite les allers-retours vers le contrôleur de domaine.

```powershell
New-GPO -Name "GPO-SEC-Firewall-Serveurs-V1" | Out-Null
$gpo = Open-NetGPO -PolicyStore "lab.local\GPO-SEC-Firewall-Serveurs-V1"
```

### Configuration des Profils et de la Journalisation

```powershell
Set-NetFirewallProfile -GPOSession $gpo -Profile Domain,Private,Public `
    -Enabled True `
    -DefaultInboundAction Block `
    -DefaultOutboundAction Allow `
    -AllowLocalFirewallRules False `
    -AllowLocalIPsecRules False `
    -LogFileName "%systemroot%\system32\LogFiles\Firewall\pfirewall.log" `
    -LogMaxSizeKilobytes 16384 `
    -LogBlocked True `
    -LogAllowed False
```

### Création des Règles Entrantes et Sortantes

```powershell
New-NetFirewallRule -GPOSession $gpo -DisplayName "Allow - RDP - SRV-ADM-01" `
    -Direction Inbound -Protocol TCP -LocalPort 3389 `
    -RemoteAddress 192.168.10.50 -Action Allow -Profile Domain -Group "Administration"

New-NetFirewallRule -GPOSession $gpo -DisplayName "Allow - WinRM - SRV-ADM-01" `
    -Direction Inbound -Protocol TCP -LocalPort 5985,5986 `
    -RemoteAddress 192.168.10.50 -Action Allow -Profile Domain -Group "Administration"

New-NetFirewallRule -GPOSession $gpo -DisplayName "Block - SMB sortant - Internet" `
    -Direction Outbound -Protocol TCP -RemotePort 445 `
    -RemoteAddress Internet -Action Block -Profile Any
```

### Création des Règles de Sécurité de Connexion

```powershell
# Exemption des contrôleurs de domaine
New-NetIPsecRule -GPOSession $gpo -DisplayName "Exemption IPsec - SRV-DC-01 SRV-DC-02" `
    -RemoteAddress 192.168.10.10,192.168.10.11 `
    -InboundSecurity None -OutboundSecurity None -Profile Any

# Ensemble d'authentification Kerberos ordinateur
$kerb = New-NetIPsecAuthProposal -Machine -Kerberos
$p1   = New-NetIPsecPhase1AuthSet -GPOSession $gpo -DisplayName "Auth ordinateur Kerberos" -Proposal $kerb

# Isolation de domaine, mode Request pendant le pilote
New-NetIPsecRule -GPOSession $gpo -DisplayName "Isolation domaine - lab.local" `
    -Profile Domain -Phase1AuthSet $p1.Name `
    -InboundSecurity Request -OutboundSecurity Request
```

### Enregistrement et Liaison de la GPO

```powershell
Save-NetGPO -GPOSession $gpo
New-GPLink -Name "GPO-SEC-Firewall-Serveurs-V1" -Target "OU=Serveurs,DC=lab,DC=local"
```

<div class="callout callout-note">

`Save-NetGPO` réécrit l'intégralité de la GPO. Si un autre administrateur l'a modifiée entre `Open-NetGPO` et `Save-NetGPO`, ses changements sont écrasés.

</div>

### Passage de l'Isolation en Mode Require

```powershell
Set-NetIPsecRule -PolicyStore "lab.local\GPO-SEC-Firewall-Serveurs-V1" `
    -DisplayName "Isolation domaine - lab.local" `
    -InboundSecurity Require -OutboundSecurity Request
```

### Configuration Locale d'un Serveur Isolé

Sur un serveur hors GPO, les mêmes cmdlets s'utilisent sans `-GPOSession` ni `-PolicyStore` et écrivent dans le magasin local :

```powershell
New-NetFirewallRule -DisplayName "Allow - HTTPS - Réseau interne" `
    -Direction Inbound -Protocol TCP -LocalPort 443 `
    -RemoteAddress 192.168.10.0/24 -Action Allow -Profile Domain,Private
```

## Vérifications

**Profil actif :** `Get-NetConnectionProfile` sur SRV-APP-01 affiche `NetworkCategory : DomainAuthenticated`.

**Paramètres effectifs :** `Get-NetFirewallProfile -PolicyStore ActiveStore | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction, LogBlocked` reflète les valeurs de la GPO.

**Règles reçues :** `Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName "Allow - RDP - SRV-ADM-01" | Get-NetFirewallAddressFilter` affiche `RemoteAddress : 192.168.10.50`.

**Filtrage effectif :** depuis SRV-ADM-01, `Test-NetConnection SRV-APP-01 -Port 3389` réussit. Depuis un autre poste, le même test échoue et une ligne `DROP TCP` apparaît dans `pfirewall.log` sur SRV-APP-01.

**Associations IPsec :** après un échange entre SRV-APP-01 et SRV-APP-02, `Get-NetIPsecMainModeSA` et `Get-NetIPsecQuickModeSA` sur SRV-APP-01 listent des associations avec SRV-APP-02. Dans `wf.msc`, le nœud **Monitoring > Security Associations** affiche les mêmes informations.

**Exemption des DC :** `Get-NetIPsecMainModeSA` ne montre aucune association avec 192.168.10.10 ou 192.168.10.11, et l'authentification au domaine fonctionne.

## Dépannage

**« Un service ne répond plus après application de la GPO » :** une règle d'autorisation manque. Activez temporairement **Log successful connections** et consultez `pfirewall.log` pour identifier le port bloqué. Ajoutez une règle ciblée plutôt que d'élargir une règle existante.

**« Les règles limitées au profil Domain ne s'appliquent pas » :** l'interface est en profil Public ou Private. Vérifiez la résolution DNS vers SRV-DC-01 et SRV-DC-02 et la joignabilité d'un DC, puis redémarrez le service NlaSvc ou désactivez puis réactivez la carte réseau. Contrôlez que le serveur dispose des dernières mises à jour cumulatives.

**« Une règle Allow est ignorée » :** une règle Block correspondante existe dans une autre GPO ou localement. Recherchez-la avec `Get-NetFirewallRule -PolicyStore ActiveStore -Action Block | Where-Object Enabled -eq True`.

**« Les machines ne joignent plus le domaine après l'isolation IPsec » :** l'exemption des contrôleurs de domaine est absente ou incomplète. Ajoutez SRV-DC-01 et SRV-DC-02 à la règle d'exemption, et ajoutez tout nouveau DC immédiatement après sa promotion.

**« Aucune association de sécurité n'est créée » :** l'une des deux machines ne reçoit pas la GPO, ou l'exigence est en mode Request et l'autre machine n'a pas de règle. Contrôlez `gpresult /scope computer /r` des deux côtés et consultez le journal de sécurité (audit IPsec Main Mode et Quick Mode).

**« Un serveur Linux ou un NAS ne joint plus un serveur Windows » :** l'isolation est passée en Require. Ajoutez l'équipement à une règle d'exemption, ou déployez une authentification IPsec par certificat compatible.

## Conseils et Bonnes Pratiques

**Une GPO de socle et des GPO par rôle.** Créez une GPO de base pour tous les serveurs (profils, journalisation, administration depuis SRV-ADM-01) et une GPO par rôle (`GPO-SEC-Firewall-Web`, `GPO-SEC-Firewall-SQL`) ciblée par OU ou par groupe de sécurité.

**Nommer et grouper les règles.** Le format `<Action> - <Service> - <Source>` et l'utilisation de `-Group` permettent de filtrer et d'activer ou désactiver un ensemble cohérent de règles.

**Restreindre l'administration à des sources identifiées.** RDP, WinRM, SMB administratif et WMI ne doivent être ouverts qu'aux postes d'administration, jamais à tout le sous-réseau.

**Exploiter les règles prédéfinies avec prudence.** Les groupes intégrés (Remote Desktop, Windows Remote Management, File and Printer Sharing) sont pratiques, mais autorisent souvent toute adresse distante. Restreignez leur étendue après activation.

**Activer l'audit de la plateforme de filtrage.** Les sous-catégories d'audit **Filtering Platform Packet Drop** et **Filtering Platform Connection** produisent des événements dans le journal de sécurité, plus faciles à centraliser que le fichier texte.

**Déployer IPsec par étapes.** Request sur une OU pilote, analyse des associations, Request sur tout le parc, puis Require serveur par serveur, en commençant par les plus sensibles.

**Versionner les GPO.** Exportez régulièrement les règles avec `Get-NetFirewallRule -PolicyStore "lab.local\GPO-SEC-Firewall-Serveurs-V1"` ou une sauvegarde GPMC, pour pouvoir comparer deux versions et revenir en arrière.

## Procédures Liées

- [Configuration de PowerShell Remoting et de JEA](/procedures/windows/configuration-de-powershell-remoting-et-de-jea) *(Flux WinRM à autoriser depuis les postes d'administration)*
- [Durcissement de Windows Server avec OSConfig et Credential Guard](/procedures/windows/durcissement-de-windows-server-avec-osconfig-et-credential-guard) *(La ligne de base active le pare-feu et sa journalisation)*
- [Supervision avec l'Analyseur de Performances et le Transfert d'Événements](/procedures/windows/supervision-avec-lanalyseur-de-performances-et-le-transfert-devenements) *(Centralisation des événements de filtrage)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Restriction des flux d'administration par niveau)*
- [Configuration d'AppLocker par GPO](/procedures/windows/configuration-dapplocker-par-gpo) *(Défense en profondeur sur les mêmes serveurs)*
- [Segmentation Réseau (VLANs) sur pfSense](/procedures/pare-feu/segmentation-reseau-vlans-sur-pfsense) *(Filtrage périmétrique complémentaire entre zones)*
