---
modele: "procedure"
titre: "Dépannage de la Réplication AD et de Kerberos"
type: "PROCEDURE"
class: "07. Identité"
reference: "WIN-IDM-TRB"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit une démarche de diagnostic et de résolution des incidents de réplication Active Directory et d'authentification Kerberos dans le domaine `lab.local`, composé de SRV-DC-01 (192.168.10.10) et SRV-DC-02 (192.168.10.11) sous Windows Server 2025.

Elle couvre les outils de diagnostic (`dcdiag`, `repadmin`, cmdlets PowerShell de réplication, journaux d'événements), le contrôle de SYSVOL répliqué par DFSR, puis les causes Kerberos les plus fréquentes : écart d'horloge, SPN dupliqués ou absents, canal sécurisé rompu entre un membre et le domaine, tickets obsolètes. Elle donne pour chaque symptôme les codes d'erreur et ID d'événements documentés par Microsoft. Le dépannage des approbations entre forêts et de l'authentification Entra ID sort du périmètre.

## Contexte et Justification

Une réplication AD en échec reste longtemps invisible. Les utilisateurs continuent à ouvrir une session sur le DC qu'ils joignent, mais les deux DC divergent : un mot de passe changé sur SRV-DC-01 n'est pas connu de SRV-DC-02, une GPO modifiée n'est pas appliquée partout, un compte désactivé reste utilisable sur l'autre DC. Au-delà de la durée de vie des tombstones (180 jours par défaut), le DC en échec est mis en quarantaine et doit souvent être reconstruit.

Kerberos est de son côté le protocole d'authentification par défaut du domaine. Une dérive d'horloge de quelques minutes, un SPN dupliqué ou un compte ordinateur désynchronisé suffit à provoquer des refus d'accès ou un repli silencieux vers NTLM, protocole déprécié par Microsoft et moins sûr.

Disposer d'une méthode systématique permet de passer du symptôme (« la GPO ne s'applique pas », « accès refusé au partage ») à la cause réelle en quelques commandes, au lieu de redémarrer des services au hasard.

## Concepts Clés

**Réplication multimaître.** Chaque DC accepte les écritures et les réplique vers ses partenaires. Dans un même site, la réplication est déclenchée par notification quelques secondes après la modification. Entre sites, elle suit la planification des liens de sites.

**Partenaires entrants et KCC.** Chaque DC tire les modifications de ses partenaires entrants (réplication en mode « pull »). Le vérificateur de cohérence des connaissances (KCC) calcule automatiquement les objets de connexion.

**Partitions (contextes de nommage).** La réplication se fait par partition : domaine, configuration, schéma, et partitions d'application DNS (`DomainDnsZones`, `ForestDnsZones`).

**Résolution DNS des DC.** Un DC localise son partenaire par l'enregistrement CNAME `<GUID de l'objet NTDS Settings>._msdcs.lab.local`. La plupart des échecs de réplication ont une origine DNS.

**Durée de vie des tombstones et objets persistants.** Un DC qui n'a pas répliqué depuis plus longtemps que `tombstoneLifetime` peut contenir des objets supprimés ailleurs (objets persistants, ou lingering objects). Windows bloque alors la réplication avec ce partenaire.

**SYSVOL et DFSR.** SYSVOL est répliqué par DFSR, indépendamment de la réplication AD, mais DFSR lit sa configuration dans AD. Une réplication AD cassée finit donc par affecter SYSVOL.

**Kerberos et horloge.** Un ticket Kerberos est horodaté. Par défaut, l'écart toléré entre le client, le KDC et le serveur est de 5 minutes. Au-delà, l'authentification échoue avec l'erreur `KRB_AP_ERR_SKEW`.

**SPN (Service Principal Name).** Identifiant d'un service (`HTTP/web.lab.local`, `MSSQLSvc/srv-sql-01.lab.local:1433`) associé à un compte. Le KDC chiffre le ticket de service avec la clé de ce compte. Un SPN doit être unique dans la forêt.

**Canal sécurisé.** Lien authentifié entre un ordinateur membre et un DC, fondé sur le mot de passe du compte ordinateur, changé automatiquement tous les 30 jours par défaut. S'il est désynchronisé, l'ordinateur ne peut plus authentifier les utilisateurs du domaine.

## Prérequis

- Un compte membre de Domain Admins pour les diagnostics de réplication, et Enterprise Admins pour certains tests DNS de `dcdiag` et la recherche de SPN dans la forêt.
- Un accès à SRV-DC-01 et SRV-DC-02, ou un poste d'administration avec RSAT (outils AD DS incluant `dcdiag`, `repadmin`, `setspn`, `nltest`, `netdom`, module ActiveDirectory).
- Les ports nécessaires ouverts entre DC et entre membres et DC : TCP/UDP 53, TCP/UDP 88, TCP 135, TCP/UDP 389, TCP 445, TCP/UDP 464, TCP 636, TCP 3268, TCP 3269 et la plage RPC dynamique TCP 49152 à 65535.
- La connaissance de la topologie : sites, DC, émulateur PDC (source de temps du domaine).
- Un dossier de travail pour conserver les sorties de diagnostic avant et après correction.

## Points de Vigilance

**Ne forcez pas la réplication avant d'avoir identifié la cause.** Une réplication forcée avec `/syncall` peut propager une suppression ou une modification erronée. Analysez d'abord, corrigez ensuite.

**Ne modifiez pas `tombstoneLifetime` ni la clé « Allow Replication With Divergent and Corrupt Partner » pour contourner une erreur 8614.** Ces réglages servent à la remédiation encadrée des objets persistants, pas à masquer le problème. Un DC resté hors ligne au-delà de la durée de vie des tombstones se reconstruit en général par démotion forcée, nettoyage des métadonnées et nouvelle promotion.

**Ne lancez pas une restauration autoritaire de SYSVOL pour un seul DC en erreur.** Microsoft recommande une resynchronisation non autoritaire du DC concerné. La restauration autoritaire ne se justifie que si tous les DC sont en erreur.

**Ne corrigez pas une dérive d'horloge en changeant manuellement l'heure d'un DC.** Corrigez la hiérarchie de temps : l'émulateur PDC de la racine de forêt synchronisé sur une source fiable, les autres DC en hiérarchie de domaine. Sur un DC virtualisé, désactivez la synchronisation horaire de l'hyperviseur pour le fournisseur de temps du DC, comme le recommande Microsoft.

**`Test-ComputerSecureChannel` ne doit pas être utilisé sur un DC.** Microsoft indique qu'il renvoie de faux positifs sur un contrôleur de domaine. Utilisez `nltest` ou `netdom` pour un DC. Cette cmdlet n'existe par ailleurs que dans Windows PowerShell 5.1.

**NTLM est déprécié et NTLMv1 est retiré de Windows Server 2025.** Un problème Kerberos masqué par un repli NTLM peut devenir bloquant à mesure que NTLM est restreint. RC4 pour Kerberos est également déprécié : un compte ou un système qui n'accepte que RC4 échouera.

**Les journaux par défaut ne disent pas tout.** La journalisation détaillée de Kerberos (`LogLevel`) ou du diagnostic NTDS génère beaucoup d'événements, y compris de faux positifs. Activez-la pour la durée du diagnostic uniquement.

## Choix Architecturaux & Alternatives

### Quand choisir cette démarche

La démarche décrite ici, fondée sur les outils natifs, convient au diagnostic ponctuel d'un incident et au contrôle de santé régulier d'un domaine de quelques DC à quelques dizaines de DC. Elle ne demande aucun logiciel supplémentaire et produit des sorties exploitables par le support Microsoft.

Pour une détection proactive (alerte dès le premier échec de réplication, suivi de la dérive horaire, détection des SPN dupliqués), complétez-la par une supervision. Pour un parc important, un outil de supervision AD dédié ou un service cloud d'analyse de santé réduit le délai de détection.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Outils natifs (dcdiag, repadmin, setspn, klist, w32tm)** | Diagnostic d'incident, contrôle de santé manuel | Exhaustifs, gratuits, référence du support Microsoft | Lecture experte, pas d'alerte automatique | Gratuit |
| **Cmdlets PowerShell de réplication et script planifié** | Contrôle quotidien automatisé, rapport par courriel | Sorties objets, faciles à filtrer et historiser | Script à maintenir, pas d'historique centralisé | Faible |
| **Transfert d'événements (WEF) vers un SIEM** | Corrélation des événements de réplication et Kerberos | Historique centralisé, alertes | Infrastructure et règles à construire | Moyen |
| **Supervision (Zabbix, SCOM, agent de supervision)** | Alertes sur l'état de réplication et l'heure | Détection proactive, tableaux de bord | Modèles à adapter, agent à déployer sur les DC | Moyen |
| **Microsoft Defender for Identity** | Détection d'attaques et posture de sécurité AD | Analyse comportementale, alertes de sécurité AD | Licence, orienté sécurité plutôt que santé | Élevé |

### Impact des choix

- **Disponibilité.** Un échec de réplication détecté en quelques heures se corrige simplement. Détecté après plusieurs semaines, il peut imposer la reconstruction d'un DC et le nettoyage d'objets persistants.
- **Sécurité.** Une réplication cassée retarde la propagation des désactivations de comptes et des changements de mot de passe. Un SPN mal placé ou un repli NTLM affaiblit l'authentification.
- **Exploitation.** Un contrôle quotidien automatisé (`repadmin /replsummary`, `Get-ADReplicationFailure`) coûte quelques minutes à mettre en place et évite la plupart des incidents longs.
- **Coût.** Les outils natifs suffisent pour un lab ou une PME. Les solutions de supervision et de sécurité se justifient à mesure que le nombre de DC et le niveau d'exposition augmentent.

## Méthode 1 : Configuration via l'Observateur d'Événements (eventvwr.msc) et la Console Sites et services Active Directory (dssite.msc)

### Lire les Journaux Pertinents

1. Ouvrez `eventvwr.msc` sur SRV-DC-01, puis **Action > Se connecter à un autre ordinateur** pour SRV-DC-02.
2. Consultez les journaux suivants :
   - **Journaux des applications et des services > Directory Service** pour la réplication AD ;
   - **Journaux des applications et des services > DFS Replication** pour SYSVOL ;
   - **Journaux Windows > Système** pour Kerberos, Netlogon et le service de temps ;
   - **Journaux Windows > Sécurité** sur les DC pour les échecs d'authentification.
3. Créez une vue personnalisée filtrée sur les niveaux **Critique**, **Erreur** et **Avertissement** des journaux Directory Service et DFS Replication sur les dernières 24 heures.

### Interpréter les Événements Clés

| Journal | ID | Signification |
|---------|----|---------------|
| Directory Service | 1311 | Le KCC ne peut pas construire une topologie de réplication complète |
| Directory Service | 1388, 1988 | Objet persistant détecté depuis un partenaire |
| Directory Service | 1925 | Échec d'établissement d'un lien de réplication |
| Directory Service | 2042 | Pas de réplication avec ce partenaire depuis plus que la durée de vie des tombstones |
| Directory Service | 2087 | Échec de résolution DNS du DC source, la réplication a échoué |
| Directory Service | 2088 | Échec de résolution DNS du DC source, la réplication a réussi par repli NetBIOS |
| DFS Replication | 2213 | Arrêt incorrect détecté, réplication SYSVOL en pause |
| DFS Replication | 4012 | Réplication SYSVOL arrêtée, hors ligne au-delà de `MaxOfflineTimeInDays` |
| DFS Replication | 4614, 4604 | SYSVOL en attente de synchronisation initiale, puis initialisé |
| Système (Kerberos-Key-Distribution-Center) | 11 | Le KDC a trouvé un SPN dupliqué |
| Système (Kerberos) | 4 | Le client a reçu `KRB_AP_ERR_MODIFIED` ou `KRB_AP_ERR_SKEW` |
| Système (NETLOGON) | 5719 | Aucun DC disponible pour établir le canal sécurisé |
| KdsSvc Operational | 4004 | Clé racine KDS créée (utile pour les gMSA) |

: Événements de référence

### Contrôler et Déclencher la Réplication

1. Ouvrez `dssite.msc` > **Sites > Default-First-Site-Name > Servers > SRV-DC-02 > NTDS Settings**.
2. Les objets de connexion listés dans le volet de droite représentent les partenaires entrants de SRV-DC-02 (ici SRV-DC-01).
3. Faites un clic droit sur la connexion depuis SRV-DC-01 > **Répliquer maintenant**.
4. Un message d'erreur s'affiche si la réplication échoue. Notez le texte exact, il correspond au code d'erreur que `repadmin` affiche.
5. Faites un clic droit sur **NTDS Settings** > **Toutes les tâches > Vérifier la topologie de réplication** pour relancer le KCC.

### Corriger la Résolution DNS d'un DC

1. Ouvrez `dnsmgmt.msc` sur SRV-DC-01, zone `_msdcs.lab.local`.
2. Vérifiez la présence d'un enregistrement CNAME par DC, dont le nom est le GUID de son objet NTDS Settings, pointant vers `SRV-DC-01.lab.local` ou `SRV-DC-02.lab.local`.
3. Dans la zone `lab.local`, vérifiez les enregistrements A de SRV-DC-01 (192.168.10.10) et SRV-DC-02 (192.168.10.11).
4. Dans la configuration IP de chaque DC, vérifiez que les serveurs DNS sont des DC du domaine (par exemple SRV-DC-02 puis SRV-DC-01 sur SRV-DC-01, en terminant par l'adresse de bouclage) et jamais un résolveur public.

## Méthode 2 : Configuration via PowerShell

### État Global de la Réplication

```powershell
# Synthèse de tous les DC (plus grand delta et nombre d'échecs par partenaire)
repadmin /replsummary

# Détail des partenaires entrants de chaque DC
repadmin /showrepl * /csv | ConvertFrom-Csv |
    Where-Object { $_.'Number of Failures' -gt 0 } |
    Select-Object 'Destination DSA', 'Source DSA', 'Naming Context', 'Number of Failures', 'Last Failure Status'

# Équivalent PowerShell
Get-ADReplicationFailure -Target "lab.local" -Scope Domain |
    Select-Object Server, Partner, FailureCount, FirstFailureTime, LastError

Get-ADReplicationPartnerMetadata -Target SRV-DC-01,SRV-DC-02 |
    Select-Object Server, Partner, Partition, LastReplicationSuccess, LastReplicationResult
```

`LastReplicationResult` à 0 indique un succès. Toute autre valeur est un code d'erreur Win32 à rechercher dans le tableau du Dépannage.

### Diagnostic Complet avec dcdiag

```powershell
# Tous les tests sur tous les DC du domaine, sortie complète
dcdiag /e /c /v /f:C:\Diag\dcdiag-complet.txt

# Tests ciblés
dcdiag /s:SRV-DC-02 /test:replications /test:netlogons /test:advertising /test:sysvolcheck
dcdiag /test:dns /e /v /f:C:\Diag\dcdiag-dns.txt
dcdiag /test:CheckSecurityError /s:SRV-DC-02
```

Repérez dans le résumé final chaque test marqué **failed test**, puis lisez sa section détaillée.

### File d'Attente et Réplication Ciblée

```powershell
repadmin /queue SRV-DC-02

# Après correction : répliquer la partition domaine de SRV-DC-01 vers SRV-DC-02
repadmin /replicate SRV-DC-02 SRV-DC-01 "DC=lab,DC=local"

# Puis synchroniser toutes les partitions depuis SRV-DC-01 vers ses partenaires
repadmin /syncall SRV-DC-01 /AdeP
```

### Contrôle de SYSVOL (DFSR)

```powershell
# Etat de migration : "Eliminated" attendu (SYSVOL répliqué par DFSR)
dfsrmig /getmigrationstate

# Partages publiés
Invoke-Command -ComputerName SRV-DC-01,SRV-DC-02 { Get-SmbShare -Name SYSVOL,NETLOGON | Select-Object PSComputerName, Name, Path }

# Etat du dossier répliqué SYSVOL (4 = Normal, 5 = En erreur)
Invoke-Command -ComputerName SRV-DC-01,SRV-DC-02 {
    Get-CimInstance -Namespace root\microsoftdfs -ClassName DfsrReplicatedFolderInfo -Filter "ReplicatedFolderName='SYSVOL Share'" |
        Select-Object PSComputerName, ReplicatedFolderName, State
}

# Evénements DFSR récents
Get-WinEvent -ComputerName SRV-DC-02 -FilterHashtable @{LogName='DFS Replication'; Level=2,3; StartTime=(Get-Date).AddDays(-1)}
```

### Synchronisation Horaire

```powershell
# Source de temps et état sur chaque DC
Invoke-Command -ComputerName SRV-DC-01,SRV-DC-02 { w32tm /query /source; w32tm /query /status }

# Écart mesuré entre DC
w32tm /monitor /domain:lab.local
w32tm /stripchart /computer:SRV-DC-01.lab.local /samples:5 /dataonly

# Emulateur PDC : source externe (exemple)
w32tm /config /manualpeerlist:"0.fr.pool.ntp.org,0x8 1.fr.pool.ntp.org,0x8" /syncfromflags:manual /reliable:yes /update
Restart-Service w32time
w32tm /resync /rediscover

# Autres DC et membres : hiérarchie du domaine
w32tm /config /syncfromflags:domhier /update
w32tm /resync
```

### Tickets Kerberos

```powershell
# Tickets de l'utilisateur courant
klist

# Tickets du compte ordinateur (session SYSTEM)
klist -li 0x3e7

# Demander un ticket pour un SPN précis
klist get HTTP/web.lab.local

# Purger après correction d'un SPN ou d'une appartenance à un groupe
klist purge
klist -li 0x3e7 purge
```

### SPN Dupliqués ou Mal Placés

```powershell
# Doublons dans la forêt
setspn -X -F

# Quel compte porte ce SPN ?
setspn -Q HTTP/web.lab.local

# SPN d'un compte
setspn -L LAB\gmsa-web$

# Corriger : retirer du mauvais compte, ajouter au bon avec contrôle de doublon
setspn -D HTTP/web.lab.local LAB\svc-web
setspn -S HTTP/web.lab.local LAB\gmsa-web$
```

### Canal Sécurisé

```powershell
# Sur un serveur ou poste membre (Windows PowerShell 5.1)
Test-ComputerSecureChannel -Verbose
Test-ComputerSecureChannel -Repair -Credential (Get-Credential LAB\adm-t1-nlallier)

# Sur tout ordinateur, DC compris
nltest /sc_query:lab.local
nltest /dsgetdc:lab.local

# Sur un DC dont le compte machine est désynchronisé (KDC arrêté au préalable)
netdom resetpwd /server:SRV-DC-01 /userd:LAB\adm-t0-nlallier /passwordd:*
```

## Vérifications

**Réplication :** `repadmin /replsummary` affiche 0 échec pour SRV-DC-01 et SRV-DC-02 et un plus grand delta de quelques minutes au plus dans un même site. `Get-ADReplicationFailure -Target lab.local -Scope Domain` ne renvoie rien.

**Test fonctionnel :** créez un objet de test sur SRV-DC-01 (`New-ADUser -Name "repl-test" -Server SRV-DC-01`), puis vérifiez sa présence sur SRV-DC-02 après quelques secondes (`Get-ADUser repl-test -Server SRV-DC-02`). Supprimez-le ensuite.

**dcdiag :** `dcdiag /e /q` ne renvoie aucune ligne. En mode `/q`, seules les erreurs s'affichent.

**SYSVOL :** les partages SYSVOL et NETLOGON sont publiés sur les deux DC, l'état DFSR vaut 4 et aucun événement 2213 ou 4012 récent n'est présent.

**Heure :** `w32tm /monitor` montre un écart inférieur à une seconde entre DC. L'émulateur PDC a une source externe, les autres DC indiquent un DC du domaine comme source.

**Kerberos :** `klist get HTTP/web.lab.local` renvoie un ticket, `setspn -X -F` ne trouve aucun doublon et aucun événement KDC 11 ni Kerberos 4 n'apparaît dans les journaux Système.

**Canal sécurisé :** `nltest /sc_query:lab.local` affiche `NERR_Success` et `Test-ComputerSecureChannel` renvoie `True` sur les membres.

## Dépannage

Le tableau suivant reprend les codes d'erreur de réplication les plus fréquents, tels que documentés par Microsoft, avec la première piste à suivre.

| Code (repadmin, dcdiag) | Message | Cause probable | Action |
|-------------------------|---------|----------------|--------|
| 5 | Access is denied | Écart d'horloge, compte machine du DC désynchronisé, droits insuffisants | `dcdiag /test:CheckSecurityError`, `w32tm /monitor` |
| 1398 | There is a time and/or date difference between the client and server | Écart d'horloge au-delà de la tolérance Kerberos | Corriger la hiérarchie de temps |
| 1722 | The RPC server is unavailable | Ports RPC filtrés, DC arrêté, résolution de nom erronée | `Test-NetConnection SRV-DC-01 -Port 135`, plage RPC dynamique |
| 8453 | Replication access was denied | Permissions de réplication manquantes sur la partition | `dcdiag /test:NCSecDesc`, `dcdiag /test:MachineAccount` |
| 8524 | The DSA operation is unable to proceed because of a DNS lookup failure | CNAME `_msdcs` absent, DNS client mal configuré, métadonnées d'un DC disparu | `dcdiag /test:dns`, enregistrements `_msdcs` |
| 8614 | The time since last replication with this server has exceeded the tombstone lifetime | DC hors ligne trop longtemps | Supprimer les objets persistants ou reconstruire le DC |
| -2146893022 (0x80090322) | The target principal name is incorrect | Le KDC utilisé possède un ancien mot de passe du DC source | Procédure Microsoft : désactiver le KDC sur le DC de destination, redémarrer, répliquer, puis réactiver le KDC, ou `netdom resetpwd` |

: Codes d'erreur de réplication AD

**Échec 8524 ou événement 2087 :** vérifiez sur chaque DC que les serveurs DNS configurés sont des DC du domaine, forcez l'enregistrement des enregistrements du DC avec `ipconfig /registerdns` puis le redémarrage du service Netlogon, et contrôlez la présence du CNAME dans `_msdcs.lab.local`. Si le DC source n'existe plus, nettoyez ses métadonnées (`ntdsutil` > **metadata cleanup**, ou suppression de l'objet serveur dans `dssite.msc`).

**Échec 1722 :** testez depuis le DC de destination `Test-NetConnection SRV-DC-01 -Port 135` puis un port de la plage dynamique. Vérifiez le pare-feu Windows (groupe de règles **Active Directory Domain Services**) et tout pare-feu intermédiaire. Contrôlez aussi que le nom résolu correspond à la bonne adresse IP.

**Échec 8614 ou événement 2042 :** identifiez les objets persistants avec `repadmin /removelingeringobjects <DC_destination> <GUID_DC_source> "DC=lab,DC=local" /advisory_mode`. Si le DC est resté hors ligne longtemps, il est généralement plus sûr de le rétrograder de force, de nettoyer ses métadonnées et de le promouvoir de nouveau.

**SYSVOL non partagé, événement 2213 ou 4012 :** pour un seul DC en erreur, appliquez une resynchronisation non autoritaire de SYSVOL (passage de `msDFSR-Enabled` à FALSE puis TRUE sur son objet d'abonnement, avec `dfsrdiag pollad`). Pour l'événement 2213, suivez l'action indiquée dans le texte de l'événement (méthode WMI `ResumeReplication`).

**Événement KDC 11 (SPN dupliqué) :** identifiez les comptes avec `setspn -X -F`, retirez le SPN du compte incorrect avec `setspn -D`, puis purgez les tickets des clients concernés.

**Événement Kerberos 4 avec `KRB_AP_ERR_MODIFIED` :** le serveur ne peut pas déchiffrer le ticket. Causes typiques : SPN porté par le mauvais compte, enregistrement DNS pointant vers une autre machine, deux comptes ordinateurs de même nom. Vérifiez `setspn -Q` et la résolution DNS du nom utilisé par le client.

**Événement Kerberos 4 avec `KRB_AP_ERR_SKEW` ou erreur 1398 :** comparez l'heure du client, du DC et du serveur cible avec `w32tm /stripchart`. Corrigez la source de temps de l'émulateur PDC, puis forcez `w32tm /resync` sur les machines en écart.

**« La relation d'approbation entre cette station de travail et le domaine principal a échoué » sur un membre :** le canal sécurisé est rompu. Ouvrez une session locale et exécutez `Test-ComputerSecureChannel -Repair -Credential LAB\<compte_autorisé>`. Si la réparation échoue, retirez puis rejoignez le domaine.

**Événement NETLOGON 5719 au démarrage d'un membre :** le membre n'a pas trouvé de DC au moment du démarrage. Vérifiez la configuration DNS du membre, la disponibilité de SRV-DC-01 et SRV-DC-02, et la présence des enregistrements SRV (`nltest /dsgetdc:lab.local`).

**Accès refusé après l'ajout d'un utilisateur ou d'un ordinateur à un groupe :** le ticket en cache ne contient pas encore la nouvelle appartenance. Purgez avec `klist purge` (utilisateur) ou `klist -li 0x3e7 purge` (ordinateur), ou fermez la session.

## Conseils et Bonnes Pratiques

**Automatiser un contrôle quotidien.** Planifiez sur un serveur d'administration un script qui exécute `repadmin /replsummary`, `Get-ADReplicationFailure` et `dcdiag /e /q`, et envoie le résultat uniquement en cas d'erreur.

**Garder une référence saine.** Conservez la sortie de `dcdiag /e /c /v` d'un domaine en bonne santé. La comparaison avec une sortie d'incident fait gagner beaucoup de temps.

**Soigner le DNS des DC.** Chaque DC pointe vers un autre DC en premier serveur DNS et vers lui-même ensuite, par l'adresse de bouclage en dernière position. Aucun DC ne doit utiliser un résolveur public.

**Superviser l'heure.** Alertez dès qu'un DC dépasse une seconde d'écart avec l'émulateur PDC. Documentez la source de temps externe de l'émulateur PDC et reconfigurez-la si le rôle est transféré.

**Gérer les SPN avec `setspn -S`.** N'utilisez jamais `setspn -A`, qui ne vérifie pas les doublons. Préférez les gMSA, dont les SPN sont associés à un compte unique et maîtrisé.

**Centraliser les journaux.** Transférez les journaux Directory Service, DFS Replication et Système des DC vers un collecteur WEF ou un SIEM, avec des alertes sur les ID listés dans ce document.

**Nettoyer les DC disparus.** Un DC retiré sans rétrogradation laisse des métadonnées qui génèrent des erreurs 8524 et 1722 sur tous ses anciens partenaires. Nettoyez-les dès que la perte est confirmée.

**Préparer la fin de NTLM.** Activez l'audit NTLM sur les DC, identifiez les applications qui y recourent et corrigez leurs SPN pour qu'elles utilisent Kerberos.

## Procédures Liées

- [Configuration des Sites et de la Réplication AD](/procedures/windows/configuration-des-sites-et-de-la-replication-ad) *(Topologie, liens de sites et objets de connexion)*
- [Configuration d'un Serveur de Temps (NTP) pour un Domaine AD](/procedures/windows/configuration-dun-serveur-de-temps-ntp-pour-un-domaine-ad) *(Hiérarchie de temps et émulateur PDC)*
- [Configuration d'un Serveur DNS Dédié](/procedures/windows/configuration-dun-serveur-dns-dedie) *(Résolution DNS indispensable à la réplication)*
- [Restauration d'Objets et Récupération d'Active Directory](/procedures/windows/restauration-dobjets-et-recuperation-dactive-directory) *(Resynchronisation de SYSVOL et reconstruction d'un DC)*
- [Déploiement des Comptes de Service Managés de Groupe (gMSA)](/procedures/windows/deploiement-des-comptes-de-service-manages-de-groupe-gmsa) *(SPN portés par des comptes managés)*
- [Supervision avec l'Analyseur de Performances et le Transfert d'Événements](/procedures/windows/supervision-avec-lanalyseur-de-performances-et-le-transfert-devenements) *(Centralisation des journaux des DC)*
