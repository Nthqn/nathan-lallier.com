---
modele: "procedure"
titre: "Traitement par Lots avec Azure Batch"
type: "PROCEDURE"
class: "06. Cloud"
reference: "AZR-CPT-DEP"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la mise en place d'un traitement par lots à grande échelle avec **Azure Batch**. Elle couvre la création du **compte Batch** et du choix du mode d'allocation de pool, l'association d'un **compte de stockage**, la création d'un **pool** de nœuds **dédiés** et **Spot**, l'**identité managée** du pool, la mise à l'échelle automatique par **formule**, puis la soumission d'un **job** et de ses **tâches**.

## Contexte et Justification

De nombreux traitements consistent à exécuter le même programme sur un grand nombre d'entrées indépendantes : rendu d'images, simulations financières, traitement de fichiers, analyses génomiques, conversions de médias. Ils demandent beaucoup de puissance de calcul pendant un temps limité.

Azure Batch répond à ce besoin :

- **Orchestration gérée :** Batch provisionne les VM, distribue les tâches, relance les échecs et collecte les sorties.
- **Échelle massive :** Des milliers de cœurs mobilisés pour un job, puis libérés.
- **Coût optimisé :** Mise à l'échelle automatique et nœuds Spot à prix réduit.
- **Aucun surcoût de service :** Seules les ressources consommées (VM, stockage, réseau) sont facturées.

## Concepts Clés

**Compte Batch :** Ressource de niveau supérieur qui porte les pools, les jobs et les quotas. Son nom compte de 3 à 24 caractères, en minuscules et chiffres.

**Mode d'allocation de pool :** En mode **Service Batch** (par défaut, recommandé), les VM des pools sont créées dans des abonnements gérés par Batch et les quotas sont ceux du compte. En mode **Abonnement utilisateur**, les VM sont créées dans votre abonnement et consomment ses quotas de vCPU. Ce mode exige un Key Vault et l'authentification Entra ID.

**Compte de stockage associé (autostorage) :** Compte de stockage lié au compte Batch, utilisé pour les packages d'applications et les fichiers de ressources des tâches. Un compte **StorageV2 (usage général v2)** est recommandé.

**Pool :** Ensemble de nœuds de calcul de même taille et même image. Le pool définit l'image de marketplace, la taille de VM, le nombre de nœuds, la tâche de démarrage, le réseau et le nombre d'emplacements de tâches par nœud.

**Nœuds dédiés :** VM réservées au pool, jamais préemptées. Elles conviennent aux traitements à échéance stricte.

**Nœuds Spot :** VM sur la capacité excédentaire d'Azure, à prix fortement réduit, qui peuvent être préemptées par manque de capacité. Batch a consolidé les anciens nœuds **low-priority** dans cette infrastructure Spot. Les API et cmdlets conservent les noms historiques (`TargetLowPriorityComputeNodes`, `$TargetLowPriorityNodes`).

**Job :** Conteneur logique de tâches, associé à un pool. Il porte la priorité, les contraintes et les tâches de préparation et de libération.

**Tâche :** Ligne de commande exécutée sur un nœud, avec ses fichiers d'entrée et de sortie. Une tâche peut être relancée automatiquement en cas d'échec ou de préemption.

**Formule de mise à l'échelle automatique :** Script évalué périodiquement (toutes les 15 minutes par défaut, 5 minutes au minimum) qui fixe le nombre cible de nœuds dédiés et Spot selon des métriques comme les tâches en attente.

**Mode de communication des nœuds :** Le mode **Simplifié** est le seul mode disponible. Les nœuds n'ont besoin que d'un accès sortant en 443 vers l'étiquette de service `BatchNodeManagement.<région>`, sans règle entrante.

**Identité managée de pool :** Identité managée affectée par l'utilisateur, attachée aux nœuds, qui leur permet d'accéder au stockage, à Key Vault ou au registre de conteneurs sans secret.

## Prérequis

- Un Abonnement Azure actif avec le fournisseur de ressources **Microsoft.Batch** inscrit.
- Le rôle **Contributor** sur le groupe de ressources rg-batch-lab, ou **Azure Batch Account Contributor** sur le compte.
- Un compte de stockage stbatchlabfrc01 (StorageV2) dans rg-batch-lab.
- Une identité managée affectée par l'utilisateur id-batch-pool-lab, avec le rôle **Storage Blob Data Contributor** sur stbatchlabfrc01.
- Optionnel, un VNet vnet-spoke-batch-frc-01 avec un sous-réseau snet-batch-nodes autorisant le trafic sortant en 443.
- Un quota de cœurs dédiés et Spot suffisant sur le compte Batch.
- Le module PowerShell **Az.Batch**.

## Points de Vigilance

**Le mode d'allocation de pool est définitif.** Il se choisit à la création du compte et ne se modifie plus. Le mode Abonnement utilisateur exige un Key Vault et l'attribution au service **Microsoft Azure Batch** du rôle Contributor sur l'abonnement.

**Low-priority a été consolidé dans Spot.** Les nœuds Spot ne prennent pas en charge de prix maximal, sont préemptés uniquement pour des raisons de capacité, n'acceptent pas les disques de système d'exploitation éphémères et ne sont pas disponibles pour certains types d'abonnements.

**Plusieurs fonctionnalités ont été retirées.** Le mode de communication **Classique** est retiré depuis le 31 mars 2026 au profit du mode Simplifié. Les images personnalisées basées sur des VHD ou des Managed Images sont retirées depuis la même date au profit d'Azure Compute Gallery. La fonctionnalité de certificats Batch est retirée au profit de Key Vault, et les pools Cloud Services Configuration sont retirés depuis le 29 février 2024.

**L'accès sortant par défaut n'est plus garanti.** Un pool déployé dans un sous-réseau doit disposer d'un accès sortant explicite (NAT Gateway, pare-feu ou adresse IP publique) pour joindre le service Batch.

**L'identité de pool ne se crée pas par l'API de service Batch.** Un pool avec identité managée se crée par le portail ou par l'API de gestion (ARM, Bicep, SDK de gestion). La cmdlet `New-AzBatchPool` utilise l'API de service et ne permet pas de l'attacher.

**Les quotas sont souvent bas.** Les quotas par défaut de cœurs, de pools et de jobs du compte Batch peuvent bloquer la montée en charge. Demandez une augmentation avant la production.

**Les tâches doivent être idempotentes.** Une préemption Spot ou une défaillance de nœud relance la tâche. Une tâche qui écrit partiellement ses sorties doit pouvoir repartir sans corruption.

## Choix Architecturaux & Alternatives

### Quand choisir Azure Batch

Azure Batch convient au calcul haute performance et aux traitements massivement parallèles, intrinsèquement parallèles ou à base de MPI, qui exécutent des binaires existants sur des VM complètes, avec un besoin de planification de tâches, de dépendances et de relance. Il s'impose lorsque le volume justifie des centaines de nœuds et que le coût doit être optimisé avec Spot. Pour des traitements conteneurisés courts déclenchés par événements, Container Apps Jobs ou Functions sont plus simples.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|----------------|--------------|----------------|---------------|------------|
| **Azure Batch** | Calcul massivement parallèle, HPC | Planification de tâches et Spot intégrés | Modèle propre à apprendre | Faible à moyen (VM seules) |
| **Virtual Machine Scale Set** | Ferme de calcul sur mesure | Contrôle total des VM | Planification des tâches à construire | Moyen |
| **Jobs Kubernetes sur AKS** | Traitements conteneurisés sur un cluster existant | Écosystème Kubernetes, portabilité | Cluster à exploiter en continu | Moyen à élevé |
| **Container Apps Jobs** | Tâches conteneurisées planifiées ou événementielles | Serverless, aucune infrastructure | Ressources par conteneur limitées | Faible |
| **Azure Functions** | Traitements courts déclenchés par événements | Paiement à l'exécution | Durée d'exécution limitée | Faible |

### Impact des choix

- **Disponibilité.** Les nœuds dédiés garantissent l'achèvement dans les délais. Les nœuds Spot peuvent disparaître, les tâches sont alors remises en file. Un pool mixte combine socle dédié et capacité Spot.
- **Performance.** La taille de VM, le nombre d'emplacements de tâches par nœud et la proximité des données dans la même région déterminent le débit. Les tailles HPC avec InfiniBand servent les charges MPI.
- **Sécurité.** L'authentification Entra ID seule, l'identité managée de pool, un pool sans adresse IP publique dans un VNet et des points de terminaison privés limitent l'exposition.
- **Exploitation.** Le mode Service Batch évite de gérer les quotas de l'abonnement. La formule d'autoscale ramène le pool à zéro hors traitement.
- **Coût.** Batch ne facture pas le service. Le coût se compose des VM (Spot nettement moins chères), des disques, du stockage et du trafic. La mise à l'échelle à zéro supprime le coût au repos.

## Méthode 1 : Configuration via Portail Azure

### Créer le Compte Batch

1. Recherchez **« Comptes Batch »** \> **+ Créer**.
2. Onglet **De base** :
   - **Groupe de ressources :** rg-batch-lab. **Nom du compte :** batchlabfrc01. **Emplacement :** France Central.
   - **Compte de stockage :** Sélectionnez stbatchlabfrc01. **Mode d'authentification du stockage :** Identité managée du compte Batch.
3. Onglet **Avancé** :
   - **Type d'identité :** Affecté par le système.
   - **Mode d'allocation de pool :** Service Batch.
   - **Mode d'authentification :** Microsoft Entra ID uniquement, si les applications le permettent.
4. Onglet **Réseau** : **Accès réseau public** sur Tous les réseaux pour un lab, Désactivé avec point de terminaison privé en production.
5. Cliquez sur **Vérifier + créer** puis **Créer**.

### Créer le Pool

1. Ouvrez batchlabfrc01 \> **Fonctionnalités \> Pools** \> **+ Ajouter**.
2. **ID du pool :** pool-render-lab.
3. **Identité :** Affectée par l'utilisateur, sélectionnez id-batch-pool-lab.
4. **Système d'exploitation :** Marketplace. **Éditeur :** canonical. **Offre :** ubuntu-24_04-lts. **Référence :** server. **Type de sécurité :** Lancement fiable.
5. **Taille de nœud :** Standard_D4ds_v5.
6. **Mise à l'échelle :** Fixe. **Nœuds dédiés cibles :** 1. **Nœuds Spot ou basse priorité cibles :** 4.
7. **Emplacements de tâches par nœud :** 4.
8. **Tâche de démarrage :** Activée, ligne de commande `/bin/bash -c "apt-get update && apt-get install -y ffmpeg"`, **Élévation :** Administrateur de pool. **Attendre la réussite :** Oui.
9. **Réseau virtuel :** vnet-spoke-batch-frc-01, sous-réseau snet-batch-nodes. **Mode de communication des nœuds :** Simplifié.
10. Cliquez sur **OK**.

### Configurer la Mise à l'Échelle Automatique

1. Ouvrez pool-render-lab \> **Paramètres \> Mettre à l'échelle**.
2. **Mode :** Mise à l'échelle automatique. **Intervalle d'évaluation :** 5 minutes.
3. Saisissez la formule de la section suivante, cliquez sur **Évaluer** pour la tester, puis sur **Enregistrer**.

### Créer un Job et des Tâches

1. Ouvrez batchlabfrc01 \> **Fonctionnalités \> Jobs** \> **+ Ajouter**.
2. **ID du job :** job-render-001. **Pool :** pool-render-lab.
3. Ouvrez job-render-001 \> **Tâches** \> **+ Ajouter**.
4. **ID de la tâche :** task-001. **Ligne de commande :** `/bin/bash -c "echo Traitement sur $AZ_BATCH_NODE_ID; sleep 30"`.
5. Ajoutez au besoin des **fichiers de ressources** depuis un conteneur de stbatchlabfrc01 et des **paramètres de sortie** vers un conteneur de résultats.
6. Cliquez sur **Envoyer**.

## Méthode 2 : Configuration via PowerShell

### Variables

```powershell
$rg       = "rg-batch-lab"
$location = "francecentral"
$account  = "batchlabfrc01"
$storId   = (Get-AzStorageAccount -Name "stbatchlabfrc01" -ResourceGroupName $rg).Id
```

### Créer le Compte Batch

```powershell
Register-AzResourceProvider -ProviderNamespace Microsoft.Batch

New-AzBatchAccount `
    -AccountName $account `
    -ResourceGroupName $rg `
    -Location $location `
    -AutoStorageAccountId $storId `
    -PoolAllocationMode BatchService `
    -IdentityType SystemAssigned `
    -Tag @{ env = "lab" }

# Contexte avec authentification Entra ID
$context = Get-AzBatchAccount -AccountName $account
```

### Créer le Pool

```powershell
$imageRef = New-Object -TypeName "Microsoft.Azure.Commands.Batch.Models.PSImageReference" `
    -ArgumentList @("ubuntu-24_04-lts", "canonical", "server", "latest")

$vmConfig = New-Object -TypeName "Microsoft.Azure.Commands.Batch.Models.PSVirtualMachineConfiguration" `
    -ArgumentList @($imageRef, "batch.node.ubuntu 24.04")

$netConfig = New-Object -TypeName "Microsoft.Azure.Commands.Batch.Models.PSNetworkConfiguration"
$netConfig.SubnetId = (Get-AzVirtualNetwork -Name "vnet-spoke-batch-frc-01" -ResourceGroupName $rg).Subnets |
    Where-Object Name -eq "snet-batch-nodes" | Select-Object -ExpandProperty Id

New-AzBatchPool `
    -Id "pool-render-lab" `
    -VirtualMachineSize "Standard_D4ds_v5" `
    -VirtualMachineConfiguration $vmConfig `
    -TargetDedicatedComputeNodes 1 `
    -TargetLowPriorityComputeNodes 4 `
    -TaskSlotsPerNode 4 `
    -NetworkConfiguration $netConfig `
    -BatchContext $context
```

<div class="callout callout-note">

`New-AzBatchPool` s'appuie sur l'API de service Batch, qui ne permet pas d'attacher une identité managée au pool. Pour un pool avec id-batch-pool-lab, utilisez le portail ou un modèle Bicep (`Microsoft.Batch/batchAccounts/pools` avec la propriété `identity`). `TargetLowPriorityComputeNodes` désigne les nœuds Spot. Le mode de communication Simplifié s'applique sans paramètre puisque le mode Classique est retiré.

</div>

### Activer la Mise à l'Échelle Automatique

```powershell
$formula = @'
startingNumberOfVMs = 0;
maxNumberofVMs = 25;
pendingTaskSamplePercent = $PendingTasks.GetSamplePercent(180 * TimeInterval_Second);
pendingTaskSamples = pendingTaskSamplePercent < 70 ? startingNumberOfVMs : avg($PendingTasks.GetSample(180 * TimeInterval_Second));
$TargetDedicatedNodes = min(2, pendingTaskSamples);
$TargetLowPriorityNodes = min(maxNumberofVMs, max(0, pendingTaskSamples - $TargetDedicatedNodes));
$NodeDeallocationOption = taskcompletion;
'@

Enable-AzBatchAutoScale `
    -Id "pool-render-lab" `
    -AutoScaleFormula $formula `
    -AutoScaleEvaluationInterval (New-TimeSpan -Minutes 5) `
    -BatchContext $context
```

Cette formule observe les tâches en attente sur trois minutes, place au plus deux nœuds dédiés, complète avec des nœuds Spot jusqu'à 25, et ne retire un nœud qu'après la fin de ses tâches.

### Créer un Job et des Tâches

```powershell
$poolInfo = New-Object -TypeName "Microsoft.Azure.Commands.Batch.Models.PSPoolInformation"
$poolInfo.PoolId = "pool-render-lab"

New-AzBatchJob -Id "job-render-001" -PoolInformation $poolInfo -BatchContext $context

1..10 | ForEach-Object {
    New-AzBatchTask `
        -JobId "job-render-001" `
        -Id ("task-{0:D3}" -f $_) `
        -CommandLine "/bin/bash -c 'echo Tache $_ sur `$AZ_BATCH_NODE_ID dediee=`$AZ_BATCH_NODE_IS_DEDICATED; sleep 30'" `
        -BatchContext $context
}
```

### Suivre l'Exécution

```powershell
Get-AzBatchPool -Id "pool-render-lab" -BatchContext $context |
    Select-Object Id, AllocationState, CurrentDedicatedComputeNodes, CurrentLowPriorityComputeNodes

Get-AzBatchComputeNode -PoolId "pool-render-lab" -BatchContext $context |
    Select-Object Id, State, IsDedicated

Get-AzBatchTask -JobId "job-render-001" -BatchContext $context |
    Select-Object Id, State, @{ n = "ExitCode"; e = { $_.ExecutionInformation.ExitCode } }
```

## Vérifications

**Compte Batch :** batchlabfrc01 affiche le compte de stockage associé et le mode d'allocation **BatchService** dans sa vue d'ensemble.

**Pool :** pool-render-lab passe à l'état d'allocation **Steady** et ses nœuds à l'état **Idle** ou **Running**, avec une répartition dédiés et Spot conforme à la cible.

**Tâche de démarrage :** Aucun nœud n'est à l'état **StartTaskFailed**.

**Tâches :** Les tâches de job-render-001 atteignent l'état **Completed** avec un code de sortie 0. Les fichiers `stdout.txt` et `stderr.txt` sont consultables depuis le portail.

**Mise à l'échelle :** **Paramètres \> Mettre à l'échelle** affiche le résultat de la dernière évaluation, sans erreur.

**Métriques :** **Surveillance \> Métriques** du compte affiche **Dedicated Node Count**, **Low-Priority Node Count** et **Preempted Node Count**.

## Dépannage

**Nœuds bloqués à l'état Unusable :** Le sous-réseau n'autorise pas la sortie en 443 vers `BatchNodeManagement.<région>`, ou aucun accès sortant n'est configuré. Vérifiez le NSG, les UDR et la NAT Gateway.

**Nœuds à l'état StartTaskFailed :** La tâche de démarrage échoue. Consultez ses fichiers `stderr.txt` sur le nœud, et vérifiez l'élévation et l'accès réseau aux dépôts de paquets.

**Le pool ne grossit pas :** Le quota de cœurs dédiés ou Spot du compte est atteint, la formule renvoie zéro, ou la capacité Spot est indisponible dans la région. Consultez les erreurs de redimensionnement du pool.

**Nœuds Spot préemptés :** Ils passent à l'état **Preempted** et leurs tâches sont remises en file. Batch tente de restaurer la capacité. Augmentez la part de nœuds dédiés si les délais sont stricts.

**Tâches en échec d'accès au stockage :** L'identité du pool n'a pas le rôle de données sur le conteneur, ou les fichiers de ressources pointent vers une URL sans autorisation.

**Erreur d'autorisation avec le contexte PowerShell :** L'utilisateur n'a pas de rôle de plan de données comme **Azure Batch Data Contributor** ou **Azure Batch Job Submitter**, ou le compte n'accepte que l'authentification Entra ID alors que le script utilise la clé partagée.

## Conseils et Bonnes Pratiques

**Restez en mode Service Batch.** Sauf besoin de réservations, de stratégies d'abonnement ou de quotas spécifiques, il simplifie l'exploitation.

**Combinez dédiés et Spot.** Un petit socle dédié garantit la progression, les nœuds Spot absorbent le volume à moindre coût.

**Désactivez l'authentification par clé partagée.** Limitez le compte à Entra ID et attribuez les rôles Batch de plan de données.

**Utilisez une identité managée de pool.** Elle évite les jetons SAS et les clés de stockage dans les tâches.

**Ramenez le pool à zéro.** Une formule d'autoscale avec `taskcompletion` libère les nœuds dès que la file est vide.

**Préparez vos images.** Une image d'Azure Compute Gallery ou des conteneurs préchargés réduisent la durée de la tâche de démarrage.

**Supervisez le compte.** Envoyez les journaux de diagnostic vers Log Analytics et créez des alertes sur les nœuds préemptés et les tâches en échec.

## Procédures Liées

- Déploiement d'un Compte de Stockage *(Compte de stockage associé au compte Batch)*
- [Gestion des Managed Identities (System & User Assigned)](/procedures/azure/gestion-des-managed-identities-system-user-assigned) *(Identité managée du pool)*
- Déploiement d'un Réseau Virtuel *(Sous-réseau des nœuds de calcul)*
- Configuration d'une NAT Gateway *(Accès sortant explicite des nœuds)*
- Déploiement d'un Virtual Machine Scale Set *(Alternative de calcul sur mesure)*
- Déploiement d'Azure Container Apps *(Jobs conteneurisés serverless)*
- [Configuration des Budgets et Alertes de Coûts](/procedures/azure/configuration-des-budgets-et-alertes-de-couts) *(Maîtrise du coût des pools)*
