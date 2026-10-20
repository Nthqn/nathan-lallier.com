---
modele: "procedure"
titre: "Supervision avec l'Analyseur de Performances et le Transfert d'Événements"
type: "PROCEDURE"
class: "08. Supervision"
reference: "WIN-MON-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la supervision native de serveurs Windows Server 2025 du domaine `lab.local` avec deux outils intégrés : l'Analyseur de performances, pour collecter les compteurs et lever des alertes, et le transfert d'événements Windows (Windows Event Forwarding, WEF), pour centraliser les journaux sur un collecteur.

Le périmètre couvre le choix des compteurs clés (processeur, mémoire, disque, réseau), la création d'ensembles de collecteurs de données et d'alertes par la console et par `logman`, la configuration du serveur collecteur, les abonnements initiés par la source et par le collecteur, la GPO de déploiement et les droits de lecture du journal Sécurité. L'agent Azure Monitor est présenté comme alternative, sans configuration détaillée.

## Contexte et Justification

Sans supervision centralisée, l'exploitation d'un parc Windows repose sur des constats a posteriori :

- Un ralentissement est signalé par les utilisateurs, mais aucun historique de performances ne permet d'en identifier la cause.
- Les événements critiques (échecs d'authentification, arrêt de service, erreur de réplication DFS) restent dispersés dans les journaux locaux de chaque serveur, souvent écrasés avant d'être lus.
- Un attaquant qui compromet un serveur peut effacer son journal Sécurité local, supprimant la trace de son passage.

L'Analyseur de performances et WEF répondent à ces besoins sans licence ni agent tiers :

- **Historique de performances :** les ensembles de collecteurs enregistrent des compteurs en continu, avec une rotation maîtrisée.
- **Alerte précoce :** une alerte de compteur journalise un événement ou lance une tâche dès qu'un seuil est franchi.
- **Centralisation et intégrité :** WEF copie les événements sélectionnés sur un collecteur, où ils survivent à l'effacement du journal source et peuvent être relus par un SIEM.

## Concepts Clés

**Compteur de performance.** Mesure exposée par un objet (Processeur, Mémoire, Disque logique, Interface réseau) et, le cas échéant, une instance (`_Total`, `C:`, une carte réseau). Sa notation complète est `\Objet(Instance)\Compteur`.

**Ensemble de collecteurs de données (Data Collector Set).** Regroupement de collecteurs (compteurs de performance, traces d'événements, configuration) planifiable, avec un répertoire de sortie, une condition d'arrêt et une gestion de la rétention. Les journaux de compteurs sont produits par défaut au format binaire `.blg`.

**Alerte de compteur de performance.** Collecteur particulier qui compare un compteur à un seuil à chaque intervalle et, en cas de franchissement, journalise un événement, démarre un autre ensemble de collecteurs ou exécute une tâche planifiée.

**Logman.** Outil en ligne de commande qui crée, démarre, arrête, interroge, exporte et importe les ensembles de collecteurs, localement ou à distance (`-s`).

**Collecteur d'événements.** Serveur qui exécute le service **Collecteur d'événements de Windows** (`Wecsvc`) et reçoit les événements dans le journal **Événements transférés** (`ForwardedEvents`) ou dans un journal désigné.

**Source d'événements.** Ordinateur qui envoie ses événements au collecteur par WS-Management (WinRM), sur HTTP 5985 avec chiffrement Kerberos dans un domaine, ou sur HTTPS 5986 avec certificats.

**Abonnement initié par le collecteur.** Le collecteur liste explicitement les sources et va chercher les événements. Adapté à un petit nombre de serveurs connus.

**Abonnement initié par la source.** Les sources reçoivent par GPO l'adresse du gestionnaire d'abonnements et se connectent d'elles-mêmes au collecteur. Adapté à un grand parc et aux machines qui changent souvent.

**Groupe Lecteurs des journaux d'événements (Event Log Readers).** Groupe intégré (SID `S-1-5-32-573`) dont les membres peuvent lire les journaux locaux, y compris le journal Sécurité. Le transfert depuis une source s'exécute sous le compte **SERVICE RÉSEAU** (`NETWORK SERVICE`), qui doit donc y être ajouté pour transférer le journal Sécurité.

**Modes de remise.** **Normal** (mode pull, lots de 5 éléments, délai de lot de 15 minutes), **Réduire la bande passante** (mode push, délai de lot et pulsation de 6 heures) et **Réduire la latence** (mode push, délai de lot de 30 secondes).

## Prérequis

- Un compte membre de **Admins du domaine**, ou disposant des droits de création et de liaison de GPO et d'administrateur local sur les serveurs concernés.
- Un serveur collecteur **SRV-SUP-01** (192.168.10.35) sous Windows Server 2025, joint à `lab.local`, avec un volume dédié aux journaux (par exemple `L:`) dimensionné pour la rétention visée.
- Les sources : **SRV-DC-01** et **SRV-DC-02** (contrôleurs de domaine Windows Server 2025) et **SRV-FIC-01** (192.168.10.30), regroupées dans une OU ou un groupe de sécurité de ciblage.
- Le service **Gestion à distance de Windows** (`WinRM`) démarré sur toutes les machines, ce qui est le cas par défaut sur Windows Server.
- Le flux TCP 5985 autorisé des sources vers SRV-SUP-01 (et du collecteur vers les sources pour un abonnement initié par le collecteur).
- Une résolution DNS fonctionnelle de `SRV-SUP-01.lab.local` depuis toutes les sources.
- Les consoles **Analyseur de performances** (`perfmon.msc`), **Observateur d'événements** (`eventvwr.msc`) et **Gestion des stratégies de groupe** (`gpmc.msc`).

## Points de Vigilance

**Les noms de compteurs sont localisés.** Sur un système installé en français, la console affiche `\Processeur(_Total)\% temps processeur`. Les scripts écrits avec les noms anglais peuvent échouer sur un système localisé. Vérifiez les noms exacts avec `typeperf -q` ou `Get-Counter -ListSet *` sur la machine cible avant d'industrialiser.

**Un intervalle d'échantillonnage trop court sature le disque.** Un intervalle d'une seconde sur des dizaines de compteurs produit des fichiers volumineux. Pour un historique de fond, 15 à 60 secondes suffisent, avec un format circulaire (`bincirc`) et une taille maximale.

**Les alertes de l'Analyseur de performances sont locales.** Elles ne notifient personne par elles-mêmes : elles écrivent un événement ou lancent une tâche. Sans transfert de cet événement ou sans script de notification, l'alerte passe inaperçue.

**Le journal Sécurité n'est pas transféré sans droit de lecture.** Tant que **SERVICE RÉSEAU** ne peut pas lire le journal Sécurité de la source, l'abonnement est actif mais aucun événement de sécurité n'arrive.

**Le journal ForwardedEvents est petit par défaut.** Sa taille par défaut (de l'ordre de 20 Mo) est très insuffisante pour plusieurs serveurs. Augmentez-la et déplacez-la sur un volume dédié avant la mise en production.

**Le mode Normal convient mal à un grand parc.** Microsoft indique qu'avec les paramètres Normal, un collecteur peut consommer beaucoup de mémoire au-delà de quelques milliers de clients. Regroupez les requêtes dans un nombre réduit d'abonnements et dimensionnez plusieurs collecteurs si nécessaire.

**HTTP 5985 n'implique pas un trafic en clair dans un domaine.** WinRM chiffre le contenu avec Kerberos entre machines du domaine. Pour des sources hors domaine, HTTPS 5986 et des certificats sont obligatoires.

**WMIC n'est plus disponible par défaut.** Sous Windows Server 2025, WMIC est une fonctionnalité à la demande en voie de retrait. Les scripts de supervision qui l'utilisent doivent passer à `Get-CimInstance`.

**L'agent Log Analytics (MMA) est retiré.** Il a été retiré le 31 août 2024 et n'est plus pris en charge. Toute supervision Azure doit utiliser l'agent Azure Monitor (AMA).

## Choix Architecturaux & Alternatives

### Quand choisir l'Analyseur de performances et WEF

Cette combinaison convient à un parc Windows on-premise de petite à moyenne taille, sans budget de supervision, ou comme socle de collecte en amont d'un SIEM. WEF est particulièrement pertinent pour centraliser les événements de sécurité des contrôleurs de domaine et des serveurs sensibles, car il ne requiert aucun agent et repose sur les mécanismes natifs de Windows.

L'Analyseur de performances est l'outil de référence pour un diagnostic de performances ponctuel ou un historique de base (baseline). Il n'offre en revanche ni tableau de bord multi-serveurs, ni notification avancée, ni corrélation.

Ne choisissez pas cette seule combinaison pour un parc hétérogène Windows et Linux, ni lorsqu'une équipe d'exploitation a besoin de tableaux de bord, d'escalade d'alertes et de rapports de disponibilité. Un outil de supervision dédié ou Azure Monitor est alors plus adapté.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Analyseur de performances et WEF** | Parc Windows on-premise, socle de collecte pour SIEM | Natif, sans agent, collecte robuste | Pas de tableau de bord ni d'alerte avancée, Windows uniquement | Gratuit |
| **Agent Azure Monitor (via Azure Arc)** | Hybride, supervision centralisée dans Azure | Règles de collecte (DCR), requêtes KQL, alertes Azure, Sentinel | Coût d'ingestion, dépendance à Azure et à Arc | Moyen |
| **Zabbix ou solution open source équivalente** | Supervision multi-OS on-premise | Tableaux de bord, escalade, multi-plateforme | Agent à déployer, serveur à maintenir | Faible |
| **System Center Operations Manager** | Grands comptes déjà équipés de System Center | Packs de supervision Microsoft détaillés | Licence, infrastructure lourde | Élevé |
| **Windows Admin Center** | Consultation ponctuelle des performances et journaux | Interface web moderne, sans configuration | Pas d'historique long ni d'alerte centralisée | Gratuit |

**Pistes Azure Monitor Agent.** Pour des serveurs on-premise, l'agent Azure Monitor s'installe après l'intégration des serveurs dans **Azure Arc**. Une règle de collecte de données (DCR) définit les compteurs de performance et les événements Windows à collecter, filtrés par requêtes XPath similaires à celles des abonnements WEF, et les envoie vers un espace de travail Log Analytics. Les alertes se construisent ensuite sur des requêtes KQL ou des métriques. WEF et AMA peuvent coexister : un collecteur WEF peut lui-même être équipé de l'agent pour remonter le journal **ForwardedEvents**, ce qui limite le nombre d'agents à déployer.

### Impact des choix

- **Sécurité.** Centraliser les journaux de sécurité sur un collecteur protège la traçabilité contre l'effacement local. Le collecteur devient un actif sensible : accès d'administration restreint, durcissement et sauvegarde de ses journaux.
- **Disponibilité.** Un collecteur unique est un point de défaillance pour la collecte. Les sources mettent en cache les événements et les renvoient après reconnexion, dans la limite de leurs journaux locaux. Deux collecteurs peuvent être déclarés dans la GPO pour une redondance.
- **Exploitation.** Le choix initié par la source simplifie l'intégration des nouveaux serveurs (simple appartenance à l'OU ciblée). L'abonnement initié par le collecteur exige une mise à jour de la liste des sources à chaque changement.
- **Coût.** Les outils natifs sont gratuits. Le coût réel est le stockage du collecteur et le temps d'analyse. Azure Monitor déplace ce coût vers l'ingestion et la rétention facturées au volume.

## Méthode 1 : Configuration via l'Analyseur de Performances (perfmon.msc), l'Observateur d'Événements (eventvwr.msc) et la GPMC (gpmc.msc)

### Choix des Compteurs Clés

Les seuils suivants sont des repères usuels à ajuster après mesure d'une période de référence (baseline) propre à chaque serveur.

| Domaine | Compteur (nom anglais) | Repère d'alerte indicatif |
|---------|------------------------|---------------------------|
| Processeur | `\Processor(_Total)\% Processor Time` | Supérieur à 85 % de façon soutenue |
| Processeur | `\System\Processor Queue Length` | Supérieur à 2 par cœur de façon soutenue |
| Mémoire | `\Memory\Available MBytes` | Inférieur à 10 % de la mémoire physique |
| Mémoire | `\Memory\% Committed Bytes In Use` | Supérieur à 80 % |
| Mémoire | `\Memory\Pages/sec` | Pics prolongés, à corréler avec la mémoire disponible |
| Disque | `\LogicalDisk(*)\% Free Space` | Inférieur à 15 % |
| Disque | `\LogicalDisk(*)\Avg. Disk sec/Read` et `Avg. Disk sec/Write` | Supérieur à 20 ms de façon soutenue |
| Disque | `\PhysicalDisk(*)\Current Disk Queue Length` | Élevé et durable, à corréler avec la latence |
| Réseau | `\Network Interface(*)\Bytes Total/sec` | Supérieur à 70 % du débit de la carte |
| Réseau | `\Network Interface(*)\Output Queue Length` | Supérieur à 2 de façon soutenue |

: Compteurs clés et repères indicatifs

### Création d'un Ensemble de Collecteurs de Données

1. Sur SRV-FIC-01, ouvrez `perfmon.msc` > **Ensembles de collecteurs de données** > **Défini par l'utilisateur**.
2. Faites un clic droit > **Nouveau** > **Ensemble de collecteurs de données**.
3. **Nom :** `DCS-Base-SRV-FIC-01`, puis sélectionnez **Créer manuellement (avancé)**.
4. Cochez **Compteur de performance**.
5. Cliquez sur **Ajouter** et sélectionnez les compteurs du tableau précédent. **Intervalle d'échantillonnage :** 15 secondes.
6. **Répertoire racine :** `C:\PerfLogs\Admin\DCS-Base-SRV-FIC-01`.
7. **Exécuter en tant que :** laissez **Par défaut** (SYSTEM).
8. Terminez, puis ouvrez les **Propriétés** de l'ensemble :
   - onglet **Planification** : ajoutez un démarrage quotidien à 00:00 ;
   - onglet **Condition d'arrêt** : **Durée globale** 24 heures, cochez **Redémarrer l'ensemble de collecteurs de données à la limite**.
9. Faites un clic droit sur l'ensemble > **Gestionnaire de données** : cochez **Activer la gestion des données et les règles de rapport**, avec par exemple **Âge maximal** 30 jours et **Taille maximale du dossier racine** 2 048 Mo.
10. Démarrez l'ensemble par clic droit > **Démarrer**.

<div class="callout callout-note">

Pour un diagnostic ponctuel, l'ensemble système **System Performance** (sous **Système**) collecte 60 secondes de données et produit un rapport synthétique dans **Rapports** > **Système**. La commande `perfmon /report` lance un diagnostic équivalent.

</div>

### Création d'une Alerte de Compteur

1. Dans **Défini par l'utilisateur**, créez un nouvel ensemble **Créer manuellement (avancé)** nommé `ALR-Disque-SRV-FIC-01`.
2. Sélectionnez **Alerte de compteur de performance**.
3. Ajoutez `\LogicalDisk(D:)\% Free Space`, avec **Alerter quand** **Inférieur à** `15`.
4. Ajoutez `\Processor(_Total)\% Processor Time`, avec **Supérieur à** `90`.
5. Terminez, puis ouvrez les **Propriétés** du collecteur d'alerte (volet de droite) :
   - onglet **Alertes** : **Intervalle d'échantillonnage** 60 secondes ;
   - onglet **Action d'alerte** : cochez **Consigner une entrée dans le journal des événements des applications** ;
   - onglet **Tâche d'alerte** (facultatif) : nom d'une tâche planifiée qui envoie une notification.
6. Démarrez l'ensemble.

<div class="callout callout-note">

L'entrée d'alerte est écrite dans le journal **Microsoft-Windows-Diagnosis-PLA/Operational**. Ce journal est désactivé ou peu consulté sur de nombreux serveurs : vérifiez son activation et incluez-le dans un abonnement WEF pour centraliser les alertes.

</div>

### Préparation du Collecteur

1. Sur SRV-SUP-01, ouvrez une invite de commandes en administrateur et exécutez :

```cmd
winrm qc -q
wecutil qc /q
```

2. Ouvrez `eventvwr.msc` > **Journaux Windows** > **Événements transférés** > **Propriétés** :
   - **Chemin d'accès au journal :** `L:\Logs\ForwardedEvents.evtx` ;
   - **Taille maximale du journal :** par exemple 4 Go ;
   - **Archiver le journal lorsqu'il est plein, ne pas remplacer les événements**, si la rétention réglementaire l'exige et que l'espace est surveillé.

### Création d'un Abonnement Initié par la Source

1. Dans `eventvwr.msc` sur SRV-SUP-01, faites un clic droit sur **Abonnements** > **Créer un abonnement**.
2. **Nom :** `SUB-Securite-Serveurs`.
3. **Journal de destination :** **Événements transférés**.
4. Sélectionnez **Initié par l'ordinateur source**, puis **Sélectionner des groupes d'ordinateurs** > **Ajouter des ordinateurs du domaine** : ajoutez le groupe `GS-WEF-Sources` contenant SRV-DC-01, SRV-DC-02 et SRV-FIC-01.
5. **Sélectionner des événements** > **Par journal** :
   - **Journaux d'événements :** **Sécurité** et **Système** ;
   - **Niveau :** Critique, Erreur, Avertissement, et pour la Sécurité ajoutez les identifiants ciblés, par exemple `4624,4625,4720,4728,4732,4740,1102`.
6. **Avancé** : **Optimisation de la remise des événements** sur **Réduire la latence** pour les événements de sécurité, protocole **HTTP** port **5985**.
7. Validez avec **OK**.

### Création d'un Abonnement Initié par le Collecteur

1. Sur chaque source, vérifiez que WinRM écoute (`winrm qc -q` si nécessaire) et ajoutez le compte ordinateur `LAB\SRV-SUP-01$` au groupe **Lecteurs des journaux d'événements** local (sur les contrôleurs de domaine, au groupe de domaine intégré du même nom).
2. Dans `eventvwr.msc` sur SRV-SUP-01, **Créer un abonnement** :
   - **Nom :** `SUB-Systeme-FIC` ;
   - **Initié par le collecteur** > **Sélectionner des ordinateurs** > **Ajouter des ordinateurs du domaine** : `SRV-FIC-01`, puis **Tester** ;
   - **Sélectionner des événements :** journaux **Système**, **Application** et **DFS Replication**, niveaux Critique, Erreur et Avertissement ;
   - **Avancé** : **Compte d'ordinateur**, remise **Normal**.
3. Validez avec **OK**.

### Déploiement de la GPO pour les Sources

1. Ouvrez `gpmc.msc`, créez la GPO `GPO-SUP-WEF-Sources` et liez-la aux OU des contrôleurs de domaine et des serveurs.
2. Filtrez sa portée de sécurité sur le groupe `GS-WEF-Sources` (avec la lecture conservée pour **Utilisateurs authentifiés**).
3. Dans l'éditeur, naviguez jusqu'à **Configuration ordinateur** > **Stratégies** > **Modèles d'administration** > **Composants Windows** > **Transfert d'événements**.
4. Ouvrez **Configurer le gestionnaire d'abonnements cible**, activez-le, cliquez sur **Afficher** et saisissez :

```text
Server=http://SRV-SUP-01.lab.local:5985/wsman/SubscriptionManager/WEC,Refresh=60
```

5. Pour le journal Sécurité des serveurs membres, ajoutez **SERVICE RÉSEAU** au groupe local **Lecteurs des journaux d'événements** par **Configuration ordinateur** > **Préférences** > **Paramètres du Panneau de configuration** > **Utilisateurs et groupes locaux** (action **Mettre à jour**, groupe intégré **Lecteurs des journaux d'événements**, membre `NT AUTHORITY\NETWORK SERVICE`).
6. Pour les contrôleurs de domaine, qui n'ont pas de groupes locaux, ajoutez **SERVICE RÉSEAU** au groupe de domaine intégré **Lecteurs des journaux d'événements** dans **Utilisateurs et ordinateurs Active Directory** (conteneur **Builtin**).
7. Sur une source, exécutez `gpupdate /force`.

<div class="callout callout-note">

Une alternative à l'ajout dans le groupe consiste à étendre le descripteur de sécurité du journal Sécurité par la stratégie **Configurer l'accès au journal**, sous **Composants Windows** > **Service Journal des événements** > **Sécurité**, en ajoutant l'entrée `(A;;0x1;;;S-1-5-20)` à la chaîne SDDL. Cette méthode est plus ciblée mais exige de reprendre exactement le SDDL par défaut du journal.

</div>

## Méthode 2 : Configuration via PowerShell

### Contrôle Ponctuel des Compteurs

```powershell
# Noms exacts disponibles sur la machine (utile sur un système localisé)
Get-Counter -ListSet "Processor","Memory","LogicalDisk","Network Interface" |
    Select-Object CounterSetName, Paths

# Lecture instantanée de quelques compteurs, 6 échantillons à 5 secondes
Get-Counter -Counter "\Processor(_Total)\% Processor Time","\Memory\Available MBytes","\LogicalDisk(_Total)\% Free Space" `
    -SampleInterval 5 -MaxSamples 6
```

### Création de l'Ensemble de Collecteurs avec Logman

```powershell
# Fichier de compteurs (un par ligne)
@"
\Processor(_Total)\% Processor Time
\System\Processor Queue Length
\Memory\Available MBytes
\Memory\% Committed Bytes In Use
\Memory\Pages/sec
\LogicalDisk(*)\% Free Space
\LogicalDisk(*)\Avg. Disk sec/Read
\LogicalDisk(*)\Avg. Disk sec/Write
\PhysicalDisk(*)\Current Disk Queue Length
\Network Interface(*)\Bytes Total/sec
\Network Interface(*)\Output Queue Length
"@ | Set-Content -Path "C:\PerfLogs\compteurs-base.txt" -Encoding Ascii

# Collecteur circulaire de 512 Mo, échantillon toutes les 15 secondes
logman create counter DCS-Base-SRV-FIC-01 -cf "C:\PerfLogs\compteurs-base.txt" `
    -si 00:00:15 -f bincirc -max 512 -o "C:\PerfLogs\Admin\DCS-Base-SRV-FIC-01"

logman start DCS-Base-SRV-FIC-01
logman query DCS-Base-SRV-FIC-01
```

<div class="callout callout-note">

Sur un système installé en français, remplacez les noms du fichier par leurs équivalents localisés, relevés avec `typeperf -q`, si `logman` les refuse ou si le journal reste vide.

</div>

### Création d'une Alerte avec Logman

```powershell
logman create alert ALR-Disque-SRV-FIC-01 `
    -th "\LogicalDisk(D:)\% Free Space<15" "\Processor(_Total)\% Processor Time>90" `
    -si 00:01:00 -el

logman start ALR-Disque-SRV-FIC-01
```

L'option `-el` active l'écriture dans le journal des événements. Les options `-tn` et `-targ` permettent d'exécuter une tâche planifiée au déclenchement, et `-rdcs` de démarrer un autre ensemble de collecteurs.

### Déploiement à Distance et Exploitation des Journaux

```powershell
# Export du modèle depuis SRV-FIC-01 et import sur SRV-DC-01
logman export DCS-Base-SRV-FIC-01 -xml "C:\PerfLogs\DCS-Base.xml"
logman import DCS-Base-SRV-DC-01 -xml "C:\PerfLogs\DCS-Base.xml" -s SRV-DC-01
logman start DCS-Base-SRV-DC-01 -s SRV-DC-01

# Conversion d'un journal binaire en CSV pour analyse
relog "C:\PerfLogs\Admin\DCS-Base-SRV-FIC-01\<fichier>.blg" -f csv -o "C:\PerfLogs\analyse.csv"
```

<div class="callout callout-note">

Le chemin de sortie contenu dans le modèle XML doit exister sur la machine cible. Ajustez-le si les serveurs n'ont pas la même arborescence.

</div>

### Configuration du Collecteur et de l'Abonnement Initié par la Source

```powershell
# Sur SRV-SUP-01
winrm qc -q
wecutil qc /q

# Journal ForwardedEvents : 4 Go sur un volume dédié
New-Item -Path "L:\Logs" -ItemType Directory -Force
wevtutil sl ForwardedEvents /lfn:"L:\Logs\ForwardedEvents.evtx" /ms:4294967296
```

```powershell
# Fichier de définition de l'abonnement
@"
<Subscription xmlns="http://schemas.microsoft.com/2006/03/windows/events/subscription">
    <SubscriptionId>SUB-Securite-Serveurs</SubscriptionId>
    <SubscriptionType>SourceInitiated</SubscriptionType>
    <Description>Événements de sécurité et système des serveurs lab.local</Description>
    <Enabled>true</Enabled>
    <Uri>http://schemas.microsoft.com/wbem/wsman/1/windows/EventLog</Uri>
    <ConfigurationMode>MinLatency</ConfigurationMode>
    <Query>
        <![CDATA[
            <QueryList>
                <Query Id="0">
                    <Select Path="Security">*[System[(EventID=4624 or EventID=4625 or EventID=4720 or EventID=4728 or EventID=4732 or EventID=4740 or EventID=1102)]]</Select>
                    <Select Path="System">*[System[(Level=1 or Level=2 or Level=3)]]</Select>
                    <Select Path="Microsoft-Windows-Diagnosis-PLA/Operational">*</Select>
                </Query>
            </QueryList>
        ]]>
    </Query>
    <ReadExistingEvents>false</ReadExistingEvents>
    <TransportName>http</TransportName>
    <ContentFormat>RenderedText</ContentFormat>
    <Locale Language="fr-FR"/>
    <LogFile>ForwardedEvents</LogFile>
    <AllowedSourceNonDomainComputers></AllowedSourceNonDomainComputers>
    <AllowedSourceDomainComputers>O:NSG:NSD:(A;;GA;;;DC)(A;;GA;;;NS)</AllowedSourceDomainComputers>
</Subscription>
"@ | Set-Content -Path "C:\WEF\SUB-Securite-Serveurs.xml" -Encoding UTF8

wecutil cs "C:\WEF\SUB-Securite-Serveurs.xml"
wecutil es
```

<div class="callout callout-note">

Le descripteur `O:NSG:NSD:(A;;GA;;;DC)(A;;GA;;;NS)` autorise tous les **Ordinateurs du domaine**. Pour restreindre l'abonnement à `GS-WEF-Sources`, créez l'abonnement dans la console avec **Sélectionner des groupes d'ordinateurs**, ou remplacez le SID `DC` par celui du groupe dans le SDDL. L'événement 4624 est très volumineux sur un contrôleur de domaine : filtrez-le davantage (type d'ouverture de session, comptes à privilèges) avant la mise en production.

</div>

### Ajout de SERVICE RÉSEAU au Groupe Lecteurs des Journaux d'Événements

```powershell
# Sur un serveur membre, par SID pour éviter les noms localisés
Add-LocalGroupMember -SID "S-1-5-32-573" -Member "S-1-5-20"
Get-LocalGroupMember -SID "S-1-5-32-573"
```

### Abonnement Initié par le Collecteur

```powershell
# Sur SRV-FIC-01 : autoriser le compte ordinateur du collecteur à lire les journaux
Add-LocalGroupMember -SID "S-1-5-32-573" -Member "LAB\SRV-SUP-01$"
winrm qc -q
```

Créez ensuite l'abonnement sur SRV-SUP-01 avec un fichier XML de type `CollectorInitiated` passé à `wecutil cs`, ou par la console comme décrit dans la Méthode 1. Pour ajouter une source à un abonnement existant initié par le collecteur :

```cmd
wecutil ss SUB-Systeme-FIC /esa:SRV-FIC-01.lab.local /aes /ese
```

## Vérifications

**Ensembles de collecteurs :** `logman query` affiche `DCS-Base-SRV-FIC-01` et `ALR-Disque-SRV-FIC-01` à l'état **En cours d'exécution**. Des fichiers `.blg` apparaissent sous `C:\PerfLogs\Admin`. Ouvrez-en un dans `perfmon.msc` > **Analyseur de performances** > **Afficher les données du journal** pour contrôler les courbes.

**Alerte :** créez temporairement un fichier volumineux pour faire passer `D:` sous 15 % d'espace libre. Un événement apparaît dans **Microsoft-Windows-Diagnosis-PLA/Operational** sur SRV-FIC-01, puis dans **Événements transférés** sur SRV-SUP-01.

**Sources :** sur SRV-DC-01, le journal **Applications et services** > **Microsoft** > **Windows** > **Eventlog-ForwardingPlugin** > **Operational** contient l'événement **104** (connexion au gestionnaire d'abonnements réussie) suivi de l'événement **100** (abonnement créé).

**Collecteur :** `wecutil gr SUB-Securite-Serveurs` liste SRV-DC-01, SRV-DC-02 et SRV-FIC-01 à l'état **Active**. Dans la console, **Abonnements** > clic droit > **État d'exécution** affiche les mêmes sources.

**Contenu :** une ouverture de session en échec volontaire sur SRV-FIC-01 (mot de passe erroné) produit un événement 4625 visible dans **Événements transférés** sur SRV-SUP-01 en moins d'une minute avec le mode **Réduire la latence**.

```powershell
Get-WinEvent -LogName ForwardedEvents -MaxEvents 20 |
    Select-Object TimeCreated, MachineName, Id, LevelDisplayName
```

## Dépannage

**« Aucune source n'apparaît dans l'abonnement initié par la source » :** vérifiez sur la source que la GPO est appliquée (`gpresult /r`), que la valeur de **Configurer le gestionnaire d'abonnements cible** est exacte (FQDN, port, chemin `/wsman/SubscriptionManager/WEC`) et que le flux TCP 5985 vers SRV-SUP-01 est ouvert (`Test-NetConnection SRV-SUP-01.lab.local -Port 5985`). Consultez le journal **Eventlog-ForwardingPlugin/Operational** de la source pour le message d'erreur exact.

**« La source est active mais aucun événement de sécurité n'arrive » :** **SERVICE RÉSEAU** n'a pas le droit de lire le journal Sécurité. Vérifiez l'appartenance au groupe **Lecteurs des journaux d'événements**, puis redémarrez le service **WinRM** de la source, ou la machine, pour que le jeton du service prenne en compte la nouvelle appartenance.

**« L'abonnement initié par le collecteur échoue au test » :** WinRM n'écoute pas sur la source, le pare-feu de la source bloque le TCP 5985 entrant, ou le compte ordinateur du collecteur n'est pas membre de **Lecteurs des journaux d'événements**. Testez avec `winrm id -r:SRV-FIC-01.lab.local` depuis le collecteur.

**« wecutil renvoie que le serveur RPC n'est pas disponible » :** le service **Collecteur d'événements de Windows** est arrêté. Exécutez `wecutil qc /q` ou `Start-Service Wecsvc`.

**« L'ensemble de collecteurs démarre puis s'arrête aussitôt » :** le répertoire de sortie n'existe pas ou n'est pas accessible, ou un compteur est invalide pour la langue du système. Consultez `logman query <nom>` et le journal **Diagnosis-PLA/Operational**, puis corrigez le fichier de compteurs.

**« Le collecteur consomme beaucoup de mémoire » :** trop d'abonnements ou trop de sources en mode Normal. Regroupez les requêtes XPath dans un nombre réduit d'abonnements, passez en **Réduire la bande passante** pour les journaux non critiques, et répartissez les sources sur plusieurs collecteurs par GPO filtrées.

## Conseils et Bonnes Pratiques

**Établir une référence avant de fixer les seuils.** Collectez au moins une à deux semaines de compteurs en fonctionnement normal. Les seuils d'alerte se déduisent de cette référence, pas de valeurs génériques.

**Limiter la volumétrie collectée.** Sélectionnez des identifiants d'événements précis plutôt que des journaux entiers, notamment pour le journal Sécurité des contrôleurs de domaine. Les listes publiées par l'ANSSI et par Microsoft pour la détection d'intrusion sont de bons points de départ.

**Isoler et protéger le collecteur.** Placez SRV-SUP-01 dans le niveau d'administration adapté (tier 0 s'il reçoit les journaux des contrôleurs de domaine), restreignez les comptes administrateurs et sauvegardez ses journaux.

**Industrialiser avec des modèles.** Exportez les ensembles de collecteurs avec `logman export` et les abonnements avec `wecutil gs <id> /f:xml`, versionnez ces fichiers et réimportez-les lors de la reconstruction d'un serveur.

**Préparer la redondance.** La stratégie **Configurer le gestionnaire d'abonnements cible** accepte plusieurs entrées. Déclarez un second collecteur pour les sources critiques afin de ne pas perdre la collecte pendant une maintenance.

**Raccorder un SIEM ou Azure Monitor.** WEF collecte mais n'analyse pas. Faites lire le journal **ForwardedEvents** par un SIEM (Wazuh, Sentinel, Splunk) ou par l'agent Azure Monitor installé sur le collecteur via Azure Arc, et construisez les alertes dans cet outil.

**Activer la stratégie d'audit avant de transférer.** Un événement de sécurité qui n'est pas audité ne peut pas être transféré. Alignez la stratégie d'audit avancée des serveurs et des contrôleurs de domaine sur les événements attendus par les abonnements.

## Procédures Liées

- Configuration de VM Insights et de l'Agent Azure Monitor *(Alternative cloud de collecte des performances et des événements)*
- Intégration de Serveurs avec Azure Arc *(Prérequis de l'agent Azure Monitor pour les serveurs on-premise)*
- Configuration d'un Log Analytics Workspace et des Diagnostic Settings *(Destination des journaux dans Azure)*
- [Configuration du Pare-feu Windows et des Règles de Sécurité de Connexion](/procedures/windows/configuration-du-pare-feu-windows-et-des-regles-de-securite-de-connexion) *(Ouverture du TCP 5985 vers le collecteur)*
- [Mise en Place du Modèle d'Administration en Tiers (Tiering)](/procedures/windows/mise-en-place-du-modele-dadministration-en-tiers-tiering) *(Positionnement du collecteur des journaux des contrôleurs de domaine)*
- [Installation de Zabbix](/procedures/linux/installation-de-zabbix) *(Alternative de supervision multi-plateforme)*
