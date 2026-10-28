# Features

HealthTrack-X is a full-stack platform for product data management, digital product passports (DPP), and supply chain traceability.

## Edition Overview

HealthTrack-X is available in three editions:

|  | 🌱 Community | 🏢 Professional | 🏭 Enterprise |
|---|:---:|:---:|:---:|
| **Target** | Open Source | SMEs | Large Enterprises |
| **License** | MIT | Commercial | Commercial |

### Digital Product Passport & AAS

| Capability | Community | Professional | Enterprise |
|---|:---:|:---:|:---:|
| Product data management (ROH/HALB/FERT) | ✅ | ✅ | ✅ |
| BOM visualization & search | ✅ | ✅ | ✅ |
| JSON-LD Digital Product Passport (DPP) | ✅ | ✅ | ✅ |
| AAS export (IEC 63278 / IDTA) | — | ✅ | ✅ |
| AAS Submodel: Digital Nameplate | — | ✅ | ✅ |
| AAS Submodel: Technical Data | — | ✅ | ✅ |
| AAS Submodel: Bill of Material | — | ✅ | ✅ |
| AAS Submodel: Carbon Footprint (PCF) | — | — | ✅ |
| AAS Submodel: Material Composition | — | — | ✅ |
| AAS Submodel: Traceability | — | — | ✅ |
| EU ESPR compliance reports | — | — | ✅ |
| Multi-format export (PDF, XML, AASX) | — | ✅ | ✅ |

### Data & Integration

| Capability | Community | Professional | Enterprise |
|---|:---:|:---:|:---:|
| GitHub repository integration | 1 repo | 5 repos | Unlimited |
| NATS async processing | ✅ | ✅ | ✅ |
| YAML schema validation | ✅ | ✅ | ✅ |
| Bulk import wizard (CSV/JSON) | — | ✅ | ✅ |
| Webhooks for repository updates | — | ✅ | ✅ |
| Custom data schemas | — | ✅ | ✅ |

### Dataspace Connectivity

| Capability | Community | Professional | Enterprise |
|---|:---:|:---:|:---:|
| JSON / CSV import & export | ✅ | ✅ | ✅ |
| REST API data exchange | ✅ | ✅ | ✅ |
| EDC connector (Eclipse Dataspace) | — | ✅ | ✅ |
| IDS protocol (IDSA) | — | ✅ | ✅ |
| B2B data sharing (contract negotiation) | — | ✅ | ✅ |
| Catena-X / Tractus-X dataspace | — | — | ✅ |
| Manufacturing-X dataspace | — | — | ✅ |
| Gaia-X federation services | — | — | ✅ |
| Custom dataspace connectors | — | — | ✅ |
| Multi-dataspace routing | — | — | ✅ |

> **Standards:** EDC (Eclipse Dataspace Components), IDSA (International Data Spaces Association), DSP (Dataspace Protocol), AAS (IEC 63278), DPP (EU ESPR).

> **Dataspace philosophy:** Community enables basic data exchange via standard formats. Professional adds B2B dataspace connectivity with EDC for secure, contract-based data sharing between companies. Enterprise connects to multiple industry dataspaces simultaneously — Catena-X for automotive, Manufacturing-X for industrial production, and Gaia-X for cross-domain federation — with HealthTrack-X acting as a Tractus-X-compatible participant.

### AI & Classification

| Capability | Community | Professional | Enterprise |
|---|:---:|:---:|:---:|
| AI material classification (CRMA) | ✅ | ✅ | ✅ |
| Context-aware chat agent | ✅ | ✅ | ✅ |
| AI field suggestions | — | ✅ | ✅ |
| MCP server integration | — | ✅ | ✅ |
| Custom AI model fine-tuning | — | — | ✅ |

### Collaboration & Security

| Capability | Community | Professional | Enterprise |
|---|:---:|:---:|:---:|
| Single user | ✅ | — | — |
| Team workspace (up to 10 users) | — | ✅ | — |
| Unlimited users | — | — | ✅ |
| Role-based access (Keycloak/OIDC) | — | ✅ | ✅ |
| Audit logging | — | ✅ | ✅ |
| SSO / SAML federation | — | — | ✅ |
| On-premise deployment | — | — | ✅ |

### Storage & Infrastructure

| Capability | Community | Professional | Enterprise |
|---|:---:|:---:|:---:|
| GitHub repository (JSON files) | ✅ | ✅ | ✅ |
| Storage volume | < 500 MB | < 5 GB | Unlimited |
| Relational database (PostgreSQL) | — | ✅ | ✅ |
| Graph database (Neo4j / ArangoDB) | — | — | ✅ |
| Full-text search (Elasticsearch) | — | — | ✅ |
| Object storage (S3 / MinIO) | — | ✅ | ✅ |
| Automated backups | — | Daily | Real-time |
| Multi-region replication | — | — | ✅ |

> **Storage philosophy:** The Community edition uses GitHub as the single source of truth — simple, version-controlled, and sufficient for small product catalogs (< 1000 items). Professional adds a relational database for faster queries and larger datasets. Enterprise introduces a graph database for supply chain traversal, BOM dependency analysis, and multi-hop traceability queries.

### Supply Chain & Compliance

| Capability | Community | Professional | Enterprise |
|---|:---:|:---:|:---:|
| Supply chain visualization | ✅ | ✅ | ✅ |
| SBOM generation (CycloneDX) | ✅ | ✅ | ✅ |
| Critical Raw Materials Act dataset | ✅ | ✅ | ✅ |
| Multi-tier supply chain mapping | — | — | ✅ |
| Compliance dashboard | — | ✅ | ✅ |
| Product Carbon Footprint aggregation | — | — | ✅ |

> **Note:** Features marked with ✅ in *Community* are available today in the open-source version. *Professional* and *Enterprise* columns indicate the product roadmap and planned licensing tiers.

## Trademarks

"Asset Administration Shell" (AAS) and the AAS logo are trademarks of the
Industrial Digital Twin Association (IDTA). They are referenced in this project
for identification and interoperability purposes only.
