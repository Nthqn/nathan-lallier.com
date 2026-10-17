---
titre: "Orion"
titreAccent: "Consulting Group"
resume: "Infrastructure d'entreprise sur deux sites, avec segmentation réseau, identité centralisée, supervision, gestion de parc et réplication entre les deux sites."
statut: "termine"
categorie: "Infrastructure multisite"
annee: 2026
ordre: 1
depot: "Nthqn/orion-consulting-group"
technologies: ["pfSense", "VPN IPsec", "VLAN 802.1Q", "AD DS", "DNS / DHCP", "DFS-R", "Nginx", "Zabbix", "GLPI + LDAPS", "GPO"]
faits:
  - { label: "Périmètre", valeur: "9 machines virtuelles" }
  - { label: "Type", valeur: "Infrastructure SI complète" }
  - { label: "Livrable", valeur: "DRT de 50 pages" }
  - { label: "Objectif", valeur: "Segmentation et continuité" }
besoin: "Relier deux sites, cloisonner le réseau par métier et continuer à travailler si le site principal tombe."
realisation: "Architecture et plan d'adressage, déploiement des 9 VM, sécurisation (segmentation, droits, politiques) et rédaction du DRT."
resultat: "Infrastructure fonctionnelle, testée et reproductible, livrée avec un DRT de 50 pages (version 2.0)."
documents:
  - { titre: "DRT complet", url: "/assets/docs/DRT-ORION-Consulting-Group.pdf", detail: "PDF · 7 Mo" }
  - { titre: "Tunnel IPsec", url: "/assets/docs/DRT-ORION-Consulting-Group.pdf#page=16", detail: "p. 16" }
  - { titre: "Règles pare-feu ORION", url: "/assets/docs/DRT-ORION-Consulting-Group.pdf#page=32", detail: "p. 32" }
traduction:
  titre: "Orion"
  titreAccent: "Consulting Group"
  resume: "Two-site corporate infrastructure with network segmentation, centralised identity, monitoring, asset management and replication between the two sites."
  categorie: "Multi-site infrastructure"
  faits:
    - { label: "Scope", valeur: "9 virtual machines" }
    - { label: "Type", valeur: "Complete IT infrastructure" }
    - { label: "Deliverable", valeur: "50-page technical report" }
    - { label: "Goal", valeur: "Segmentation and continuity" }
  besoin: "Connect two sites, segment the network by department and keep working if the main site goes down."
  realisation: "Architecture and IP addressing plan, deployment of the 9 VMs, hardening (segmentation, permissions, policies) and writing the technical report."
  resultat: "A working, tested and reproducible infrastructure, delivered with a 50-page technical report (version 2.0)."
proceduresLiees:
  - "pare-feu/segmentation-reseau-vlans-sur-pfsense"
  - "linux/deploiement-de-zabbix-conteneurise"
  - "windows/installation-dun-controleur-de-domaine-active-directory"
  - "linux/installation-de-glpi"
---

## Architecture

L'infrastructure s'organise en étoile autour de deux pare-feu pfSense. **ORION** protège le site principal (DMZ et LAN), **LYRA** le site secondaire. Les deux sites sont reliés par un tunnel VPN IPsec site à site.

<div class="archi">
  <div class="archi-zone">
    <p class="archi-label">Site 1 · DMZ + LAN</p>
    <p class="archi-fw">ORION</p>
    <p class="archi-vm">MEISSA · Nginx en DMZ</p>
    <p class="archi-vm">RIGEL · AD DS, DNS, DHCP</p>
    <p class="archi-vm">BELLATRIX · GLPI, portail</p>
    <p class="archi-vm">PC-CLIENT-01</p>
  </div>
  <p class="archi-link">VPN IPsec</p>
  <div class="archi-zone">
    <p class="archi-label">Site 2 · LAN</p>
    <p class="archi-fw">LYRA</p>
    <p class="archi-vm">VEGA · AD DS, DFS-R</p>
    <p class="archi-vm">SULAFAT · Zabbix</p>
    <p class="archi-vm">PC-CLIENT-02</p>
  </div>
</div>

## Décisions techniques

- Architecture en étoile autour de deux pare-feu pfSense (ORION et LYRA).
- Interconnexion sécurisée par tunnel VPN IPsec site à site.
- Segmentation VLAN 802.1Q avec filtrage inter-VLAN au pare-feu.
- Réplication AD et fichiers (DFS-R) pour la résilience inter-sites.
