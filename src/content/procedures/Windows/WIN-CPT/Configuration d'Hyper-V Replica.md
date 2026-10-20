---
modele: "procedure"
titre: "Configuration d'Hyper-V Replica"
type: "PROCEDURE"
class: "04. Virtualisation"
reference: "WIN-CPT-BCK"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la mise en place d'Hyper-V Replica entre deux hôtes Windows Server 2025 du domaine `lab.local` : SRV-HV-01 (hôte principal) et SRV-HVDR-01 (hôte de réplica). Elle couvre la configuration du serveur de réplica, l'authentification Kerberos (HTTP) ou par certificat (HTTPS), la fréquence de réplication, les points de récupération, les trois types de basculement (test, planifié, non planifié) et la configuration du rôle Hyper-V Replica Broker lorsque la cible est un cluster de basculement.

La réplication vers Azure avec Azure Site Recovery et la réplication étendue vers un troisième hôte sont seulement évoquées.

## Contexte et Justification

Un hôte Hyper-V isolé est un point de défaillance unique. Une panne matérielle, un sinistre dans la salle serveur ou un ransomware sur l'hôte rendent indisponibles toutes les VM qu'il héberge, et leur restauration depuis une sauvegarde peut prendre des heures.

Hyper-V Replica maintient une copie hors ligne de chaque VM protégée sur un second hôte, éventuellement sur un autre site :

- **Reprise rapide :** la VM répliquée démarre en quelques minutes sur l'hôte de secours.
- **Perte de données bornée :** l'objectif de point de récupération (RPO) est fixé par la fréquence de réplication (30 secondes, 5 minutes ou 15 minutes).
- **Sans stockage partagé :** la réplication est indépendante du type de stockage et fonctionne entre matériels différents.
- **Sans coût de licence :** la fonctionnalité est incluse dans Windows Server.
- **Tests sans impact :** le basculement de test valide le plan de reprise sans interrompre la production.

## Concepts Clés

**VM principale et VM de réplica.** La VM principale est la VM en production. La VM de réplica est une copie hors ligne sur l'hôte de réplica. Elle reste éteinte tant qu'aucun basculement n'est déclenché.

**Serveur de réplica.** Hôte (ou cluster, via le Broker) autorisé à recevoir la réplication. La configuration se fait sur l'hôte **récepteur**, pas sur l'hôte principal. Pour permettre le retour arrière après un basculement, configurez les deux hôtes comme serveurs de réplica.

**Suivi des modifications.** Hyper-V suit les écritures sur les disques virtuels au niveau bloc et les stocke dans des fichiers `.hrl` à côté des VHDX. À chaque intervalle, seules les modifications sont envoyées, compressées par défaut.

**Authentification et transport.**

| Méthode | Port par défaut | Prérequis | Chiffrement du flux |
|---------|-----------------|-----------|---------------------|
| Kerberos (HTTP) | TCP 80 | Hôtes dans le même domaine ou des domaines approuvés | Non |
| Certificat (HTTPS) | TCP 443 | Certificat avec EKU Authentification client et serveur sur chaque hôte | Oui (TLS) |

: Méthodes d'authentification d'Hyper-V Replica

**Fréquence de réplication.** 30 secondes, 5 minutes (valeur par défaut) ou 15 minutes, réglée par VM.

**Points de récupération.** Par défaut, seul le dernier point est conservé. Vous pouvez conserver jusqu'à 24 points horaires supplémentaires, et produire des points cohérents avec les applications grâce à VSS à un intervalle choisi.

**Réplication initiale.** Première copie complète de la VM, envoyée immédiatement par le réseau, planifiée sur une fenêtre de faible charge, exportée sur un support externe, ou basée sur une VM restaurée existant déjà sur l'hôte de réplica.

**Types de basculement.**

- **Basculement de test :** crée sur l'hôte de réplica une VM nommée `<VM> - Test`, non connectée au réseau par défaut. La production et la réplication continuent.
- **Basculement planifié :** déclenché depuis l'hôte principal, VM principale éteinte. Les dernières modifications sont envoyées avant la bascule, sans perte de données.
- **Basculement non planifié :** déclenché depuis l'hôte de réplica quand le principal est indisponible. Les modifications non encore répliquées sont perdues.

**Hyper-V Replica Broker.** Rôle de cluster qui sert de point d'entrée unique pour la réplication vers un cluster. Il redirige les flux vers le nœud qui héberge la VM de réplica, même si celle-ci se déplace dans le cluster.

## Prérequis

- Deux hôtes Hyper-V sous **Windows Server 2025**, joints au domaine `lab.local` :
  - SRV-HV-01 (192.168.10.40), hôte principal, hébergeant la VM `SRV-APP-01` ;
  - SRV-HVDR-01 (192.168.10.42), hôte de réplica, avec un volume `D:\Hyper-V\Replica` dimensionné pour toutes les VM protégées et leurs points de récupération.
- Des commutateurs virtuels portant les mêmes noms sur les deux hôtes (par exemple `vSwitch-SET`), pour que la VM de réplica se connecte sans retouche.
- Une résolution DNS fonctionnelle des noms complets `SRV-HV-01.lab.local` et `SRV-HVDR-01.lab.local` via SRV-DC-01 et SRV-DC-02.
- Un compte membre du groupe **Administrateurs** local sur les deux hôtes.
- Pour l'authentification par certificat : un certificat sur chaque hôte, émis par une autorité de certification approuvée, non expiré, avec les EKU **Client Authentication** et **Server Authentication**, une clé privée, et un nom (CN ou SAN) égal au FQDN de l'hôte. Les listes de révocation doivent être joignables depuis les deux hôtes.
- Pour une cible en cluster : le cluster de réplica opérationnel, un volume partagé (CSV) pour stocker les réplicas, une adresse IP libre pour le Broker, et le droit de créer un objet ordinateur dans AD (ou un objet préparé).
- Une bande passante suffisante entre les sites, estimée à partir du taux de modification des VM.

## Points de Vigilance

**Kerberos (HTTP) ne chiffre pas le flux de réplication.** Les données des disques transitent en clair sur le réseau. Réservez ce mode à un lien interne de confiance. Entre deux sites ou sur un lien partagé, utilisez l'authentification par certificat (HTTPS) ou un tunnel chiffré.

**Les règles de pare-feu ne sont pas activées par défaut.** L'installation du rôle Hyper-V crée les règles **Hyper-V Replica HTTP Listener (TCP-In)** et **Hyper-V Replica HTTPS Listener (TCP-In)**, mais les laisse désactivées. Activez la règle correspondant à votre méthode sur chaque hôte récepteur, y compris sur l'hôte principal pour la réplication inverse.

**Hyper-V Replica est un outil de reprise, pas de haute disponibilité.** La bascule est manuelle ou scriptée, et la perte de données peut atteindre l'intervalle de réplication. Pour la haute disponibilité dans un site, utilisez un cluster de basculement. Les deux se combinent.

**La réplication n'est pas une sauvegarde.** Une corruption ou un chiffrement par ransomware dans l'invité est répliqué fidèlement. Les points de récupération limitent l'exposition à quelques heures, mais une sauvegarde externalisée et immuable reste indispensable.

**Les points de récupération consomment de l'espace et des IOPS.** Conserver 24 points horaires multiplie l'espace occupé sur l'hôte de réplica. Dimensionnez le volume en conséquence et surveillez son taux d'occupation.

**Un basculement non planifié doit être finalisé.** Tant que l'opération **Remove Recovery Points** (ou `Complete-VMFailover`) n'a pas été exécutée, la VM de réplica tourne sur un point de contrôle. Ne laissez pas une VM basculée dans cet état durablement.

**Le Broker est obligatoire pour une cible en cluster.** Pointer la réplication vers le nom d'un nœud de cluster casse la réplication dès que la VM change de nœud. Utilisez toujours le FQDN du Broker.

**Hyper-V Replica n'existe pas sur Windows client.** La fonctionnalité est réservée à Windows Server.

## Choix Architecturaux & Alternatives

### Quand choisir Hyper-V Replica

Hyper-V Replica convient à une PME ou à un site distant qui veut un plan de reprise d'activité simple pour ses VM, sans stockage partagé ni licence supplémentaire. Il est adapté lorsqu'un RPO de quelques minutes et un RTO de l'ordre de la demi-heure sont acceptables, et qu'un second site (ou une seconde salle) dispose d'un hôte Hyper-V.

Il est moins adapté lorsqu'une orchestration complète du plan de reprise est requise (ordre de démarrage de dizaines de VM, scripts, rapports de conformité), ou lorsqu'aucun second site physique n'existe. Azure Site Recovery répond mieux à ces cas.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Hyper-V Replica** | Reprise entre deux hôtes ou deux sites | Inclus dans Windows Server, simple, sans stockage partagé | Bascule manuelle, pas d'orchestration avancée | Gratuit |
| **Azure Site Recovery** | Reprise vers Azure sans second site | Orchestration par plans de reprise, pas de matériel de secours | Coût par VM protégée, dépendance au lien Internet | Moyen |
| **Cluster de basculement Hyper-V** | Haute disponibilité dans un site | Redémarrage automatique, migration dynamique | Stockage partagé requis, ne protège pas d'un sinistre de site | Moyen |
| **Storage Replica** | Réplication de volumes entre sites, cluster étendu | Réplication synchrone possible, RPO nul | Édition Datacenter pour un usage complet, latence réseau exigeante | Moyen |
| **Solution de sauvegarde avec réplication (Veeam, Commvault)** | Parc mixte, sauvegarde et reprise unifiées | Orchestration, rétention longue, rapports | Licence par VM ou par socket | Élevé |

### Impact des choix

- **Sécurité.** Le mode certificat chiffre le flux et ne dépend pas d'AD, ce qui permet de répliquer vers un hôte hors domaine ou dans une forêt séparée. C'est un atout contre un ransomware qui compromettrait le domaine principal.
- **Disponibilité.** Le RPO dépend de la fréquence : 30 secondes pour les VM critiques, 5 minutes en standard, 15 minutes pour les VM peu critiques ou un lien lent. Le RTO dépend de la rapidité de décision et des tests réguliers.
- **Performance.** Une fréquence de 30 secondes augmente la charge réseau et disque. Exclure les disques sans valeur (fichier d'échange, données temporaires) réduit le volume répliqué.
- **Exploitation.** La réplication étendue (principal vers réplica, puis réplica vers un troisième hôte) ajoute un niveau de protection sans charger l'hôte principal.
- **Coût.** Aucune licence supplémentaire. Le coût réel tient à l'hôte de secours, à son stockage et à la bande passante intersite. Avec Software Assurance, les licences Windows Server de l'hôte de reprise peuvent bénéficier de droits spécifiques, à valider avec votre revendeur.

## Méthode 1 : Configuration via le Gestionnaire Hyper-V (virtmgmt.msc)

### Activation du Serveur de Réplica sur SRV-HVDR-01

1. Ouvrez `virtmgmt.msc` et connectez-vous à SRV-HVDR-01.
2. Volet **Actions** > **Hyper-V Settings** > **Replication Configuration**.
3. Cochez **Enable this computer as a Replica server**.
4. **Authentication and ports :**
   - **Use Kerberos (HTTP)**, port 80, pour un lien interne ;
   - ou **Use certificate-based Authentication (HTTPS)**, port 443, puis **Select Certificate** et choisissez le certificat de SRV-HVDR-01.
5. **Authorization and storage :** sélectionnez **Allow replication from the specified servers**, puis **Add** :
   - **Specify the primary server :** `SRV-HV-01.lab.local` ;
   - **Specify the default location to store Replica files :** `D:\Hyper-V\Replica` ;
   - **Specify the trust group :** `SITE-PRINCIPAL`.
6. **OK**.
7. Répétez l'opération sur SRV-HV-01 en autorisant `SRV-HVDR-01.lab.local`, pour permettre la réplication inverse après basculement.

<div class="callout callout-note">

L'option **Allow replication from any authenticated server** est plus simple, mais tout hôte authentifié du domaine peut alors pousser des VM vers SRV-HVDR-01. Préférez la liste explicite de serveurs principaux.

</div>

### Ouverture du Pare-feu

1. Sur SRV-HVDR-01 puis sur SRV-HV-01, ouvrez `wf.msc` > **Inbound Rules**.
2. Activez **Hyper-V Replica HTTP Listener (TCP-In)** pour Kerberos, ou **Hyper-V Replica HTTPS Listener (TCP-In)** pour le certificat.

### Activation de la Réplication de la VM

1. Dans le Gestionnaire Hyper-V connecté à SRV-HV-01, clic droit sur `SRV-APP-01` > **Enable Replication**.
2. **Specify Replica Server :** `SRV-HVDR-01.lab.local`.
3. **Specify Connection Parameters :** vérifiez le port et le type d'authentification. Laissez cochée **Compress the data that is transmitted over the network**.
4. **Choose Replication VHDs :** décochez les disques sans valeur de reprise (disque d'échange dédié, cache temporaire).
5. **Configure Replication Frequency :** **5 minutes** (30 secondes pour une VM critique).
6. **Configure Additional Recovery Points :** **Create additional hourly recovery points**, **Coverage provided by additional recovery points** à 4 heures. Cochez **Volume Shadow Copy Service (VSS) snapshot frequency** à 4 heures pour obtenir des points cohérents avec les applications.
7. **Choose Initial Replication Method :** **Send initial copy over the network**, et **Start replication immediately** ou une heure planifiée de faible charge.
8. **Finish**. La colonne **Replication Health** passe à **Normal** une fois la copie initiale terminée.

### Configuration du Réseau de la VM de Réplica

1. Connectez le Gestionnaire Hyper-V à SRV-HVDR-01, clic droit sur la VM de réplica `SRV-APP-01` > **Settings**.
2. **Network Adapter** > **Test Failover** : sélectionnez `vSwitch-Prive` pour isoler la VM de test du réseau de production.
3. **Network Adapter** > **Failover TCP/IP** : si la VM utilise une adresse statique et que le site de secours a un autre plan d'adressage, renseignez l'adresse à injecter lors du basculement.

### Basculement de Test

1. Sur SRV-HVDR-01, clic droit sur la VM de réplica > **Replication** > **Test Failover**.
2. Choisissez le point de récupération, puis **Test Failover**. Une VM `SRV-APP-01 - Test` est créée.
3. Démarrez la VM de test et validez le service (ouverture de session, application, journaux).
4. Clic droit sur la VM de réplica (pas sur la VM de test) > **Replication** > **Stop Test Failover**. La VM de test et ses données sont supprimées.

### Basculement Planifié

1. Sur SRV-HV-01, arrêtez `SRV-APP-01` proprement.
2. Clic droit > **Replication** > **Planned Failover**.
3. Cochez **Reverse the replication direction after failover** et **Start the Replica virtual machine after failover**.
4. **Fail Over**. Les modifications restantes sont envoyées, la VM démarre sur SRV-HVDR-01 et la réplication repart de SRV-HVDR-01 vers SRV-HV-01.
5. Pour revenir à la situation initiale, refaites un basculement planifié depuis SRV-HVDR-01.

### Basculement Non Planifié

1. SRV-HV-01 est indisponible. Sur SRV-HVDR-01, clic droit sur la VM de réplica > **Replication** > **Failover**.
2. Choisissez le point de récupération (le plus récent par défaut), puis **Fail Over**. La VM démarre.
3. Validez le service. Si le point choisi ne convient pas, **Replication** > **Cancel Failover**, puis choisissez un autre point.
4. Une fois le point validé, **Replication** > **Remove Recovery Points** pour finaliser. L'état de santé passe à **Warning** car aucune réplication sortante n'est configurée.
5. Quand SRV-HV-01 revient, marquez l'ancienne VM principale comme réplica avec `Set-VMReplication -VMName 'SRV-APP-01' -AsReplica` sur SRV-HV-01 (cette action n'existe pas dans la console), puis sur SRV-HVDR-01 **Replication** > **Reverse Replication**.

### Configuration du Hyper-V Replica Broker (cible en cluster)

Si la cible est un cluster (par exemple SRV-HVDRCLU-01, nœuds SRV-HVDR-01 et SRV-HVDR-02) :

1. Ouvrez `cluadmin.msc`, sélectionnez SRV-HVDRCLU-01 > **Roles** > **Configure Role**.
2. **Select Role :** **Hyper-V Replica Broker**.
3. **Client Access Point :** nom `SRV-HVBRK-01` (15 caractères maximum, unique dans AD), adresse IP 192.168.10.47.
4. **Next** jusqu'à **Finish**.
5. Clic droit sur le rôle `SRV-HVBRK-01` > **Replication Settings**. Cochez **Enable this cluster as a Replica server**, choisissez l'authentification, autorisez `SRV-HV-01.lab.local` et indiquez un emplacement sur le CSV, par exemple `C:\ClusterStorage\Volume1\Replica`.
6. Activez la règle de pare-feu correspondante sur **tous** les nœuds.
7. Sur SRV-HV-01, activez la réplication en indiquant `SRV-HVBRK-01.lab.local` comme serveur de réplica.

## Méthode 2 : Configuration via PowerShell

### Activation du Serveur de Réplica

Sur SRV-HVDR-01, en Kerberos :

```powershell
Set-VMReplicationServer -ReplicationEnabled $true `
                        -AllowedAuthenticationType Kerberos `
                        -ReplicationAllowedFromAnyServer $false

New-VMReplicationAuthorizationEntry -AllowedPrimaryServer 'SRV-HV-01.lab.local' `
                                    -ReplicaStorageLocation 'D:\Hyper-V\Replica' `
                                    -TrustGroup 'SITE-PRINCIPAL'

Enable-NetFirewallRule -DisplayName 'Hyper-V Replica HTTP Listener (TCP-In)'
```

Variante par certificat :

```powershell
$thumb = (Get-ChildItem Cert:\LocalMachine\My |
          Where-Object Subject -eq 'CN=SRV-HVDR-01.lab.local').Thumbprint

Set-VMReplicationServer -ReplicationEnabled $true `
                        -AllowedAuthenticationType Certificate `
                        -CertificateAuthenticationPort 443 `
                        -CertificateThumbprint $thumb `
                        -ReplicationAllowedFromAnyServer $false

Enable-NetFirewallRule -DisplayName 'Hyper-V Replica HTTPS Listener (TCP-In)'
```

Répétez la configuration sur SRV-HV-01 en autorisant `SRV-HVDR-01.lab.local`.

### Test de la Connexion

Depuis SRV-HV-01 :

```powershell
Test-VMReplicationConnection -ReplicaServerName 'SRV-HVDR-01.lab.local' `
                             -ReplicaServerPort 80 `
                             -AuthenticationType Kerberos
```

### Activation de la Réplication de la VM

```powershell
$params = @{
    VMName                   = 'SRV-APP-01'
    ReplicaServerName        = 'SRV-HVDR-01.lab.local'
    ReplicaServerPort        = 80
    AuthenticationType       = 'Kerberos'
    ReplicationFrequencySec  = 300
    RecoveryHistory          = 4
    VSSSnapshotFrequencyHour = 4
    CompressionEnabled       = $true
}
Enable-VMReplication @params

# Copie initiale par le réseau, immédiatement
Start-VMInitialReplication -VMName 'SRV-APP-01'

# Ou planifiée à 22 h
# Start-VMInitialReplication -VMName 'SRV-APP-01' -InitialReplicationStartTime (Get-Date '22:00')
```

Pour le mode certificat, remplacez `ReplicaServerPort` par `443`, `AuthenticationType` par `Certificate`, et ajoutez `CertificateThumbprint` avec l'empreinte du certificat de SRV-HV-01.

### Réseau de la VM de Réplica

Sur SRV-HVDR-01 :

```powershell
Get-VMNetworkAdapter -VMName 'SRV-APP-01' |
    Set-VMNetworkAdapter -TestReplicaSwitchName 'vSwitch-Prive'
```

### Basculement de Test

Sur SRV-HVDR-01 :

```powershell
Start-VMFailover -VMName 'SRV-APP-01' -AsTest
Start-VM -Name 'SRV-APP-01 - Test'
# ... validation ...
Stop-VMFailover -VMName 'SRV-APP-01'
```

### Basculement Planifié

```powershell
# Sur SRV-HV-01 (principal)
Stop-VM -Name 'SRV-APP-01'
Start-VMFailover -VMName 'SRV-APP-01' -Prepare

# Sur SRV-HVDR-01 (réplica)
Start-VMFailover -VMName 'SRV-APP-01'
Set-VMReplication -VMName 'SRV-APP-01' -Reverse
Start-VM -Name 'SRV-APP-01'
```

### Basculement Non Planifié

```powershell
# Sur SRV-HVDR-01, SRV-HV-01 étant indisponible
Start-VMFailover -VMName 'SRV-APP-01'
Start-VM -Name 'SRV-APP-01'
# Après validation du point de récupération
Complete-VMFailover -VMName 'SRV-APP-01'

# Au retour de SRV-HV-01, sur SRV-HV-01
Set-VMReplication -VMName 'SRV-APP-01' -AsReplica

# Puis sur SRV-HVDR-01
Set-VMReplication -VMName 'SRV-APP-01' -Reverse -ReplicaServerName 'SRV-HV-01.lab.local'
Start-VMInitialReplication -VMName 'SRV-APP-01'
```

### Configuration du Hyper-V Replica Broker

Sur un nœud du cluster de réplica SRV-HVDRCLU-01 :

```powershell
Import-Module FailoverClusters

$broker  = 'SRV-HVBRK-01'
$network = Get-ClusterNetwork -Name 'Cluster Network 1'   # réseau de gestion 192.168.10.0/24
$ipRes   = "IP Address $($network.Address)"

Add-ClusterGroup -Name $broker -GroupType VMReplicaBroker
Add-ClusterResource -Name "Hyper-V Replica Broker $broker" -Group $broker `
                    -ResourceType 'Virtual Machine Replication Broker'
Add-ClusterResource -Name $broker -Group $broker -ResourceType 'Network Name'
Add-ClusterResource -Name $ipRes  -Group $broker -ResourceType 'IP Address'

Get-ClusterResource -Name $ipRes | Set-ClusterParameter -Multiple @{
    Network    = $network.Name
    Address    = '192.168.10.47'
    SubnetMask = $network.AddressMask
    EnableDhcp = 0
} -Create

Get-ClusterResource -Name $broker | Set-ClusterParameter -Name DnsName -Value $broker

Add-ClusterResourceDependency -Resource $broker -Provider $ipRes
Add-ClusterResourceDependency -Resource "Hyper-V Replica Broker $broker" -Provider $broker

Start-ClusterGroup -Name $broker
```

Configurez ensuite les paramètres de réplica du cluster avec le Gestionnaire du cluster de basculement (étape 5 de la Méthode 1), puis activez la règle de pare-feu sur chaque nœud :

```powershell
Invoke-Command -ComputerName SRV-HVDR-01, SRV-HVDR-02 -ScriptBlock {
    Enable-NetFirewallRule -DisplayName 'Hyper-V Replica HTTP Listener (TCP-In)'
}
```

## Vérifications

**Serveur de réplica :** `Get-VMReplicationServer` sur SRV-HVDR-01 affiche `RepEnabled : True`, le type d'authentification et le port attendus. `Get-VMReplicationAuthorizationEntry` liste `SRV-HV-01.lab.local`.

**État de la réplication :**

```powershell
Get-VMReplication -VMName 'SRV-APP-01' |
    Select-Object VMName, State, Health, Mode, FrequencySec, ReplicaServer, AuthType
```

`State` vaut `Replicating` et `Health` vaut `Normal`.

**Statistiques :** `Measure-VMReplication -VMName 'SRV-APP-01'` donne la date de la dernière réplication réussie et les volumes transférés. Dans le Gestionnaire Hyper-V, clic droit sur la VM > **Replication** > **View Replication Health**.

**Broker :** `Get-ClusterGroup | Where-Object GroupType -eq VMReplicaBroker` affiche le rôle `Online`.

**Plan de reprise :** un basculement de test démarre, la VM de test répond sur le réseau isolé, puis `Stop-VMFailover` la supprime sans erreur.

## Dépannage

**Le test de connexion échoue avec un délai d'attente :** la règle de pare-feu n'est pas activée sur l'hôte récepteur, un pare-feu intermédiaire bloque le port 80 ou 443, ou le nom ne se résout pas. Vérifiez avec `Test-NetConnection SRV-HVDR-01.lab.local -Port 80` depuis SRV-HV-01 et `Resolve-DnsName SRV-HVDR-01.lab.local`.

**Refus d'autorisation lors de l'activation de la réplication :** SRV-HV-01 n'est pas dans la liste des serveurs autorisés de SRV-HVDR-01, ou le nom saisi n'est pas le FQDN exact. Contrôlez `Get-VMReplicationAuthorizationEntry` sur SRV-HVDR-01.

**Échec d'authentification par certificat :** le certificat n'a pas les deux EKU, le nom ne correspond pas au FQDN, la chaîne n'est pas approuvée par l'autre hôte, ou la liste de révocation est injoignable. Vérifiez le certificat avec `certlm.msc` et testez la révocation avec `certutil -verify -urlfetch <fichier.cer>`.

**Santé en Warning ou Critical, réplication en pause :** le volume de réplica est plein, le lien réseau a été coupé trop longtemps, ou une resynchronisation est nécessaire. Libérez de l'espace, puis `Resume-VMReplication -VMName 'SRV-APP-01'`. Si Hyper-V demande une resynchronisation, exécutez `Resume-VMReplication -VMName 'SRV-APP-01' -Resynchronize`.

**La VM de réplica démarre sans réseau après basculement :** les noms de commutateurs diffèrent entre les hôtes. Reconnectez la carte au bon commutateur et harmonisez les noms sur tous les hôtes.

**La réplication vers le cluster casse après une migration de la VM de réplica :** la réplication pointe vers un nœud au lieu du Broker. Modifiez la cible avec `Set-VMReplication -VMName 'SRV-APP-01' -ReplicaServerName 'SRV-HVBRK-01.lab.local'`.

## Conseils et Bonnes Pratiques

**Tester le plan de reprise chaque trimestre.** Un basculement de test ne coûte rien et ne touche pas la production. Documentez le temps de démarrage, les dépendances (DNS, AD, base de données) et les anomalies rencontrées.

**Classer les VM par criticité.** Fréquence de 30 secondes et points VSS horaires pour les VM critiques, 5 minutes pour le standard, 15 minutes pour les VM secondaires. Cette hiérarchie protège la bande passante.

**Exclure les disques sans valeur.** Placez le fichier d'échange et les données temporaires sur un VHDX dédié, exclu de la réplication.

**Prévoir l'infrastructure de reprise.** Un contrôleur de domaine et un serveur DNS doivent exister sur le site de secours (SRV-DC-02 par exemple), sinon les VM basculées ne pourront pas authentifier les utilisateurs. Ne répliquez pas un contrôleur de domaine avec Hyper-V Replica : déployez un contrôleur supplémentaire sur le site de secours.

**Utiliser le certificat entre sites.** Le chiffrement TLS et l'indépendance vis-à-vis d'AD valent l'effort de gestion des certificats dès que le flux sort de la salle serveur.

**Superviser la santé de la réplication.** Planifiez une tâche quotidienne qui exécute `Get-VMReplication | Where-Object Health -ne 'Normal'` et alerte l'équipe, ou collectez les événements du journal **Microsoft-Windows-Hyper-V-VMMS-Admin**.

**Conserver une sauvegarde indépendante.** Hyper-V Replica réduit le RTO, la sauvegarde protège contre la corruption logique. Les deux sont complémentaires.

## Procédures Liées

- [Déploiement de Hyper-V et Gestion des VM](/procedures/windows/deploiement-de-hyper-v-et-gestion-des-vm) *(Préparation des hôtes SRV-HV-01 et SRV-HVDR-01)*
- [Mise en Place d'un Cluster de Basculement Hyper-V](/procedures/windows/mise-en-place-dun-cluster-de-basculement-hyper-v) *(Cluster cible et rôle Broker)*
- Réplication de VM avec Azure Site Recovery *(Alternative de reprise vers Azure)*
- [Configuration du Pare-feu Windows et des Règles de Sécurité de Connexion](/procedures/windows/configuration-du-pare-feu-windows-et-des-regles-de-securite-de-connexion) *(Ouverture des ports 80 et 443)*
- [Ajout d'un Contrôleur de Domaine Secondaire](/procedures/windows/ajout-dun-controleur-de-domaine-secondaire) *(Contrôleur de domaine sur le site de secours)*
- Sauvegarde des VM avec Azure Backup *(Sauvegarde complémentaire des VM)*
