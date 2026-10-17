---
modele: "procedure"
titre: "Configuration Réseau avec Netplan"
type: "PROCEDURE"
class: "03. Serveur"
reference: "LNX-NET-CFG"
creation: "16/10/2026"
revision: "16/10/2026"
version: "1.0"
auteur: "Nathan LALLIER"
---

## Introduction

Cette procédure décrit la configuration réseau d'un serveur Ubuntu Server 24.04 LTS avec Netplan : adresse IP fixe, serveurs DNS et domaine de recherche, routes statiques, interface VLAN et agrégat de liens (bond), application sécurisée avec `netplan try`, puis contrôle de la résolution de noms par `systemd-resolved`.

Debian 13 utilise par défaut `ifupdown` et le fichier `/etc/network/interfaces`. Chaque étape donne donc l'équivalent Debian. L'exemple porte sur srv-lnx-01, qui reçoit l'adresse 192.168.10.21/24, la passerelle 192.168.10.254 et les contrôleurs de domaine DC01 (192.168.10.10) et DC02 (192.168.10.11) comme serveurs DNS du domaine `lab.local`.

## Contexte et Justification

Un serveur doit avoir une adresse stable : il est joint par son nom DNS, référencé dans des règles de pare-feu et utilisé comme cible de supervision. Une configuration réseau manuelle par la commande `ip` est perdue au redémarrage, et une configuration persistante mal écrite peut couper l'accès distant au serveur.

Netplan apporte une description unique et déclarative du réseau :

- **Lisibilité :** un fichier YAML décrit les interfaces, les adresses, les routes et le DNS.
- **Indépendance du moteur :** la même description est traduite pour `systemd-networkd` (serveurs) ou NetworkManager (postes de travail).
- **Sécurité des changements :** `netplan try` annule automatiquement une configuration non confirmée, ce qui évite de perdre la main sur un serveur distant.
- **Fonctions avancées :** VLAN, bonds, ponts et routage par politique se déclarent dans le même fichier.

## Concepts Clés

**Netplan.** Outil de configuration réseau par défaut d'Ubuntu depuis la version 17.10. Il lit les fichiers `/etc/netplan/*.yaml` par ordre alphabétique, fusionne leur contenu et génère la configuration du moteur choisi. Ubuntu 24.04 embarque Netplan 1.0, Ubuntu 26.04 LTS la version 1.2.

**Renderer.** Moteur qui applique la configuration : `networkd` pour `systemd-networkd`, utilisé sur Ubuntu Server, ou `NetworkManager`.

**systemd-resolved.** Service de résolution de noms local d'Ubuntu. Il écoute sur 127.0.0.53, et `/etc/resolv.conf` est un lien vers son fichier `stub-resolv.conf`. Les serveurs DNS déclarés dans Netplan lui sont transmis par interface.

**VLAN.** Interface virtuelle qui étiquette le trafic 802.1Q avec un identifiant, construite au dessus d'une interface physique (le lien parent). Le port du commutateur doit être configuré en trunk pour ce VLAN.

**Bond.** Agrégat de plusieurs interfaces physiques en une interface logique, pour la redondance (`active-backup`) ou la redondance et le débit (`802.3ad`, LACP). Le mode LACP exige une configuration correspondante sur le commutateur.

**cloud-init.** Sur les images cloud et souvent après une installation Ubuntu Server, cloud-init génère `/etc/netplan/50-cloud-init.yaml` et peut le réécrire. Il faut alors le désactiver pour la partie réseau avant de gérer Netplan à la main.

**ifupdown.** Outil historique de Debian, configuré par `/etc/network/interfaces` et piloté par `ifup`, `ifdown` et le service `networking`. C'est la configuration installée par défaut sur un serveur Debian 13 sans interface graphique.

## Prérequis

- Un serveur Ubuntu Server 24.04 LTS (ou Debian 13 pour la partie ifupdown), ici srv-lnx-01.
- Un compte membre du groupe `sudo`.
- Un accès console hors bande (console d'hyperviseur, iDRAC, iLO) en cas de perte de connectivité.
- Le nom des interfaces, relevé avec `ip -br link` (ici `ens33` pour l'interface principale de srv-lnx-01, `ens19` et `ens20` pour le bond de srv-lnx-02).
- Les paramètres IP validés : adresse 192.168.10.21/24, passerelle 192.168.10.254, DNS 192.168.10.10 et 192.168.10.11, domaine `lab.local`.
- Pour le VLAN et le bond, les ports du commutateur configurés en conséquence (trunk avec VLAN 20, agrégat LACP).

## Points de Vigilance

**YAML est sensible à l'indentation.** Utilisez uniquement des espaces, jamais de tabulations, avec une indentation constante. Une erreur d'indentation rend tout le fichier invalide.

**gateway4 et gateway6 sont dépréciés.** Netplan affiche un avertissement pour ces clés. Déclarez la passerelle par défaut dans `routes` avec `to: default`.

**Les fichiers doivent être protégés.** Netplan avertit quand un fichier de `/etc/netplan` est lisible par d'autres que root. Appliquez `chmod 600` à chaque fichier.

**cloud-init peut écraser la configuration.** Si `/etc/netplan/50-cloud-init.yaml` existe, désactivez la gestion réseau de cloud-init avant toute modification, sinon vos changements peuvent être perdus au redémarrage.

**netplan apply ne supprime pas les interfaces virtuelles.** Un bond ou un pont retiré du YAML subsiste jusqu'au redémarrage ou à sa suppression avec `ip link delete`.

**Debian 13 et le nommage des interfaces.** systemd 257 introduit un nouveau schéma de nommage des interfaces. Lors d'une mise à niveau depuis Debian 12, un nom peut changer et rendre `/etc/network/interfaces` invalide. Les notes de version Debian recommandent de vérifier ce point avant la mise à niveau.

**Debian 13 remplace isc-dhcp-client.** Le client DHCP historique est déprécié. Pour une interface en DHCP sous ifupdown, `dhcpcd-base` le remplace.

## Choix Architecturaux & Alternatives

### Quand choisir Netplan

Netplan est le choix naturel sur Ubuntu Server, où il est installé et utilisé par défaut. Il convient aussi aux images cloud Debian, qui l'utilisent, et à toute équipe qui veut une même syntaxe sur ses serveurs Ubuntu et Debian. Sur un serveur Debian 13 installé de façon classique, conserver ifupdown reste légitime : c'est la configuration par défaut, documentée et connue des équipes Debian.

### Alternatives et comparatif

| Option | Cas d'usage typique | Force principale | Faiblesse principale | Coût relatif |
|--------|---------------------|------------------|----------------------|--------------|
| **Netplan avec systemd-networkd** | Ubuntu Server, images cloud | Déclaratif, `netplan try`, VLAN et bonds simples | Couche supplémentaire au dessus de networkd | Gratuit |
| **ifupdown (/etc/network/interfaces)** | Debian 13 installation standard | Défaut de Debian, simple, très documenté | Pas de retour arrière automatique, outil vieillissant | Gratuit |
| **systemd-networkd natif** | Configurations avancées ou minimales | Contrôle complet, aucune dépendance supplémentaire | Plusieurs fichiers `.network` et `.netdev` par interface | Gratuit |
| **NetworkManager (nmcli)** | Postes de travail, serveurs avec Wi-Fi ou VPN | Gestion dynamique, nombreux types de connexions | Plus lourd pour un serveur | Gratuit |
| **ifupdown2** | Hôtes Proxmox VE, configurations réseau complexes | Compatible interfaces, rechargement à chaud (`ifreload`) | Peu utilisé hors Proxmox et Cumulus | Gratuit |

### Impact des choix

- **Disponibilité.** Un bond `active-backup` ou `802.3ad` supprime le point de défaillance unique de la carte ou du câble. `netplan try` limite le risque de coupure lors d'un changement distant.
- **Sécurité.** Un VLAN dédié à l'administration ou aux sauvegardes isole ces flux du trafic applicatif. Les fichiers Netplan peuvent contenir des secrets (Wi-Fi, 802.1X) et doivent rester lisibles par root seul.
- **Exploitation.** Netplan uniformise la configuration sur les serveurs Ubuntu. Un parc mixte Debian et Ubuntu doit choisir entre deux syntaxes ou installer Netplan sur Debian.
- **Coût.** Aucun coût logiciel. Le mode LACP impose des commutateurs compatibles.

## Configuration

### Identifier les interfaces et la configuration existante

```bash
ip -br link
ip -br addr
ls -l /etc/netplan/
sudo netplan get
```

### Désactiver la gestion réseau par cloud-init (Ubuntu)

Si `/etc/netplan/50-cloud-init.yaml` existe :

```bash
echo 'network: {config: disabled}' | sudo tee /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
sudo mv /etc/netplan/50-cloud-init.yaml /root/50-cloud-init.yaml.bak
```

### Configurer une adresse IP fixe, le DNS et une route

```bash
sudo nano /etc/netplan/01-srv-lnx-01.yaml
```

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    ens33:
      dhcp4: false
      dhcp6: false
      addresses:
        - 192.168.10.21/24
      routes:
        - to: default
          via: 192.168.10.254
        - to: 10.50.0.0/16
          via: 192.168.10.253
      nameservers:
        addresses: [192.168.10.10, 192.168.10.11]
        search: [lab.local]
```

La seconde route envoie le réseau 10.50.0.0/16 vers un routeur interne 192.168.10.253.

```bash
sudo chmod 600 /etc/netplan/01-srv-lnx-01.yaml
sudo netplan generate
```

`netplan generate` valide la syntaxe et génère la configuration sans l'appliquer.

### Appliquer avec netplan try

```bash
sudo netplan try --timeout 120
```

Si l'accès est conservé, validez avec la touche Entrée avant la fin du délai. Sans confirmation, l'ancienne configuration est restaurée. Pour une application définitive sans délai, une fois la configuration validée :

```bash
sudo netplan apply
```

<div class="callout callout-note">

Les notes de Netplan signalent des bogues connus de `netplan try` : en cas d'expiration ou d'annulation, vérifiez que la configuration a bien été restaurée. Un redémarrage remet le réseau dans l'état décrit sur disque.

</div>

### Ajouter une interface VLAN

Ajoutez une interface sur le VLAN 20 (réseau de sauvegarde 192.168.20.0/24), portée par `ens33` :

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    ens33:
      dhcp4: false
      addresses: [192.168.10.21/24]
      routes:
        - to: default
          via: 192.168.10.254
      nameservers:
        addresses: [192.168.10.10, 192.168.10.11]
        search: [lab.local]
  vlans:
    vlan20:
      id: 20
      link: ens33
      addresses: [192.168.20.21/24]
```

<div class="callout callout-note">

Ne déclarez pas de route par défaut sur le VLAN : une seule passerelle par défaut évite un routage asymétrique.

</div>

### Configurer un bond LACP

Sur srv-lnx-02 (192.168.10.22), serveur physique dont les deux interfaces `ens19` et `ens20` sont reliées à un agrégat LACP du commutateur, le bond porte l'adresse du serveur :

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    ens19: {}
    ens20: {}
  bonds:
    bond0:
      interfaces: [ens19, ens20]
      addresses: [192.168.10.22/24]
      routes:
        - to: default
          via: 192.168.10.254
      nameservers:
        addresses: [192.168.10.10, 192.168.10.11]
        search: [lab.local]
      parameters:
        mode: 802.3ad
        lacp-rate: fast
        mii-monitor-interval: 100
        transmit-hash-policy: layer3+4
```

Pour une redondance sans configuration du commutateur, utilisez `mode: active-backup` et ajoutez `primary: ens19`.

### Contrôler systemd-resolved

```bash
resolvectl status ens33
resolvectl query dc01.lab.local
sudo resolvectl flush-caches
ls -l /etc/resolv.conf
```

`/etc/resolv.conf` doit pointer vers `/run/systemd/resolve/stub-resolv.conf`, qui renvoie vers 127.0.0.53.

### Équivalent sur Debian 13 avec ifupdown

Sauvegardez le fichier puis éditez-le :

```bash
sudo cp /etc/network/interfaces /root/interfaces.$(date +%F).bak
sudo nano /etc/network/interfaces
```

```text
source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

# Interface principale
auto ens33
iface ens33 inet static
    address 192.168.10.21/24
    gateway 192.168.10.254
    up ip route add 10.50.0.0/16 via 192.168.10.253
    down ip route del 10.50.0.0/16 via 192.168.10.253

# VLAN 20 (paquet vlan si l'interface n'est pas créée)
auto ens33.20
iface ens33.20 inet static
    address 192.168.20.21/24
```

Le DNS se règle dans `/etc/resolv.conf` :

```text
search lab.local
nameserver 192.168.10.10
nameserver 192.168.10.11
```

<div class="callout callout-note">

Les options `dns-nameservers` et `dns-search` dans `/etc/network/interfaces` ne sont prises en compte que si le paquet `resolvconf` est installé. Sans lui, `/etc/resolv.conf` est écrit directement.

</div>

Pour le bond de srv-lnx-02, installez `ifenslave` puis déclarez, à la place de l'interface principale :

```text
auto bond0
iface bond0 inet static
    address 192.168.10.22/24
    gateway 192.168.10.254
    bond-slaves ens19 ens20
    bond-mode 802.3ad
    bond-miimon 100
    bond-lacp-rate fast
    bond-xmit-hash-policy layer3+4
```

Appliquez interface par interface, depuis la console de préférence, car ifupdown n'a pas de retour arrière automatique :

```bash
sudo ifdown ens33 && sudo ifup ens33
sudo ifup ens33.20
```

Pour utiliser Netplan sur Debian 13, installez `netplan.io` et `systemd-resolved`, activez `systemd-networkd`, décrivez la configuration en YAML comme ci-dessus, puis désactivez les interfaces correspondantes dans `/etc/network/interfaces` pour éviter un double pilotage.

## Vérifications

**Adresses :** `ip -br addr` affiche 192.168.10.21/24 sur `ens33`, 192.168.20.21/24 sur `vlan20` et l'état `UP`.

![Résultat de la commande.](../banque-images/LNX-NET/Configuration%20Réseau%20avec%20Netplan/resultatip.png)

<p class="figure-caption"><b>Figure 1</b> · Résultat de la commande.</p>

**Routes :** `ip route` affiche `default via 192.168.10.254 dev ens33` et `10.50.0.0/16 via 192.168.10.253`.

**État Netplan :** `sudo netplan status` résume interfaces, adresses, routes et DNS appliqués.

**Bond (srv-lnx-02) :** `cat /proc/net/bonding/bond0` affiche `Bonding Mode: IEEE 802.3ad Dynamic link aggregation` et deux interfaces esclaves en état `up`.

**DNS :** `resolvectl status ens33` liste 192.168.10.10 et 192.168.10.11 avec le domaine `lab.local`, et `getent hosts dc01.lab.local` renvoie 192.168.10.10.

**Connectivité :** `ping -c 3 192.168.10.254` répond, ainsi que la connexion SSH depuis le poste d'administration.

![Résultat de la commande.](../banque-images/LNX-NET//Configuration%20Réseau%20avec%20Netplan/resultatping.png)

<p class="figure-caption"><b>Figure 2</b> · Résultat de la commande.</p>

**Persistance :** après `sudo reboot`, la configuration est identique.

## Dépannage

**« Invalid YAML » ou « Error in network definition » :** l'indentation ou une clé est incorrecte. Le message indique la ligne et la colonne ; `sudo netplan generate --debug` donne le détail.

**« Permissions for /etc/netplan/... are too open » :** appliquez `sudo chmod 600 /etc/netplan/*.yaml`.

**La configuration revient à l'ancienne après redémarrage :** cloud-init a régénéré `50-cloud-init.yaml`. Vérifiez la présence de `99-disable-network-config.cfg` et supprimez le fichier régénéré.

**Le DNS ne répond pas alors que le réseau fonctionne :** `systemd-resolved` est arrêté ou `/etc/resolv.conf` n'est plus un lien. Vérifiez `systemctl status systemd-resolved` et recréez le lien avec `sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf`.

**Le bond reste avec une seule interface active en 802.3ad :** le commutateur n'est pas configuré en LACP sur les deux ports. Vérifiez `Partner Mac Address` dans `/proc/net/bonding/bond0`, qui doit être différent de `00:00:00:00:00:00`.

**Debian, « ifup: unknown interface » :** l'interface n'est pas déclarée dans `/etc/network/interfaces` ou le nom a changé. Comparez avec `ip -br link`.

## Conseils et Bonnes Pratiques

**Un fichier par serveur ou par fonction.** Préfixez les fichiers (`01-`, `10-`) et gardez une configuration par fichier lisible. Netplan fusionne les fichiers par ordre alphabétique.

**Toujours netplan try à distance.** Le délai de restauration protège contre une coupure. Gardez en parallèle un accès console.

**Versionnez /etc/netplan.** Une copie dans un dépôt Git ou un outil de gestion de configuration documente chaque changement et facilite le retour arrière.

**Réservez les adresses dans l'IPAM et le DNS.** Déclarez l'adresse fixe dans l'outil de gestion d'adresses et créez les enregistrements A et PTR sur DC01 avant la mise en service.

**Préférez LACP quand le commutateur le permet.** Il détecte les erreurs de câblage et répartit la charge. `active-backup` reste le choix par défaut sur des commutateurs non empilés.

**Une seule passerelle par défaut.** Les réseaux supplémentaires se joignent par des routes spécifiques, ou par routage par politique si le flux retour doit sortir par l'interface d'entrée.

## Procédures Liées

- [Configuration du Pare-feu avec UFW et nftables](/procedures/linux/configuration-du-pare-feu-avec-ufw-et-nftables) *(Filtrage des interfaces configurées)*
- [Configuration d'un Serveur DNS Dédié](/procedures/windows/configuration-dun-serveur-dns-dedie) *(Résolution des noms du lab)*
- [Installation d'un Serveur Ubuntu en Ligne de Commande (CLI)](/procedures/linux/installation-dun-serveur-ubuntu-en-ligne-de-commande-cli) *(Configuration réseau initiale)*
- [Installation d'un Serveur Debian en Ligne de Commande (CLI)](/procedures/linux/installation-dun-serveur-debian-en-ligne-de-commande-cli) *(Configuration ifupdown initiale)*
- [Agrégation de Liens avec EtherChannel (LACP)](/procedures/cisco/agregation-de-liens-avec-etherchannel-lacp) *(Configuration du commutateur pour le bond)*
- [Segmentation Réseau (VLANs) sur pfSense](/procedures/pare-feu/segmentation-reseau-vlans-sur-pfsense) *(Passerelle des VLAN)*
