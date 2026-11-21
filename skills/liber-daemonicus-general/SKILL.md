---
name: liber-daemonicus-general
description: Skill to understand this project, a react-flow JSON-based diagram to generate Aquelarre roleplaying adventures following graph and structured rules for LLM agents, providing human-AI story and argument generation helper.
---

## 1) Sobre el joc
### Argumental
Els personatges han de lluitar contra les seves pulsions, determinades inicialment a la fitxa, altrament acabaran en un destí terrible.

La inspiració poden ser els pecats capitals.

Els atributs deixen de ser tant rellevants per la història. Les decisions dels jugadors, les tirades i el context alimenten una sèrie d’atributs globals, similars als pecats capitals, una mena de monstre kàrmic multi-tentacular. Li direm l’Estadística Còsmica.

## 2) Motor amb entitats

### Elements del Motor
A banda d’una trama general, que hauria de poder mutar, es tenen en compte:

- **Intenció** (Element intern): intencions de PJs i NPCs (`intention.<rol>.<Nom>`).
- **Event** (Element extern): esdeveniments que succeeixen al món (`event.<categoria>.<Nom>`).
- **Punt de Control**: moments clau d'acció, tirada o bifurcació (`controlPoint.<NomAccio>`).
- **El global: Estadística Còsmica**: estat kàrmic global (`cosmicStatistic.<Nom>`) que serveix perquè el narrador o l’LLM inventin els següents trams de la història.

*(Nota: S'han eliminat les entitats turn, demiurg i costum per simplificació del model).*

## 3) Seqüència

Els jugadors actuen de manera individual. La història els ha de fer confluir en certs punts.

### Punts de control
Un punt de control és el moment en què l’aplicatiu recull les accions de l’usuari, del PJ. Això vol dir:
- Esperar que l’usuari faci una tirada, amb daus reals o virtuals.
- Esperar que múltiples usuaris facin tirades, en una acció conjunta.
- Similar, però en una votació.

En el cas més rutinari (Seguretat) un PJ potser ha d’escollir si viatjar sobre un carro o anar a peu. En el cas més extrem, típicament un combat, un PJ pot perdre una mà, un braç o patir una ferida greu. Això fa que el Punt de Control forci un recàlcul de tot per seguir la trama, ja que pot suposar un canvi radical en la Intenció del PJ.

### 4) Nomenclatura de Nodes per a dev-deck (Estil Java Packages)

Als diagrames JSON de dev-deck, els identificadors dels nodes (`id` a `entities`) s'han d'estructurar fent servir **prefixos jeràrquics separats per punts**, de manera similar als **paquets de Java** (`package.subpackage.NomEntitat`).

Aquesta convenció aporta modularitat, evita col·lisions i permet filtrar o agrupar ràpidament els elements als diagrames de React Flow i vistes de dev-deck.

#### Taula de Paquets i Prefixos

| Categoria | Paquet / Prefix | Patró de Nom | Exemple |
|---|---|---|---|
| **Punt de Control** | `controlPoint` | `controlPoint.<NomAccio>` | `controlPoint.ProfeciaXimun`, `controlPoint.DefensaGossos` |
| **Intenció (Intern)** | `intention` | `intention.<rol>.<Nom>` | `intention.pj.DePas`, `intention.npc.XimunAvisar`, `intention.npc.ElixeVenjanca` |
| **Event (Extern)** | `event` | `event.<categoria>.<Nom>` | `event.dia1.CadenesBlanques`, `event.dia2.EsclauFidel`, `event.bosc.Veus` |
| **Estadística Còsmica** | `cosmicStatistic` | `cosmicStatistic.<Nom>` | `cosmicStatistic.KarmicMatrix`, `cosmicStatistic.Pulsions` |
| **Personatge / Actor** | `character` | `character.<pj\|npc\|creature>.<Nom>` | `character.pj.Viatgers`, `character.npc.Ximun`, `character.creature.Satirs` |
| **Ubicació / Escenari** | `location` | `location.<NomLloc>` | `location.Burgui`, `location.BoscElixe`, `location.CabanaBruixa` |
| **Objecte / Ítem** | `item` | `item.<NomItem>` | `item.EscapulariSagrat`, `item.PocioDominacio`, `item.TalismaRiquesa` |

#### Exemple d'Estructura JSON per a dev-deck

```json
{
  "id": "el-regreso",
  "title": "El Regreso",
  "subtitle": "Aquelarre · Motor Liber Daemonum",
  "entities": {
    "controlPoint.ProfeciaXimun": {
      "text": "Tirada d'Elocució o Mando davant la cantinela de Ximún.",
      "why": "Descobreix la tragèdia d'Elixe i l'escapulari sagrat."
    },
    "controlPoint.HostalatgeBurgui": {
      "text": "PC1: Arribada a Burgui el vespre del 28 d'octubre.",
      "why": "Fixa les condicions inicials dels PJs."
    },
    "intention.pj.DePas": {
      "text": "Els personatges estan de pas cap a Yesa.",
      "why": "Intenció inicial trencada pel temporal."
    },
    "item.EscapulariSagrat": {
      "text": "Escapulari sagrat sobre el cos de la bruixa.",
      "why": "Objecte clau per enviar Elixe a l'Infern."
    }
  },
  "relations": [
    ["controlPoint.HostalatgeBurgui", "controlPoint.ProfeciaXimun", "condueix a"],
    ["character.npc.Ximun", "controlPoint.ProfeciaXimun", "protagonitza"],
    ["event.dia1.CadenesBlanques", "controlPoint.ProfeciaXimun", "emmarca"]
  ],
  "pages": [
    {
      "id": "overview",
      "section": "Home",
      "title": "Visió General",
      "entities": "*"
    },
    {
      "id": "sequence",
      "section": "Seqüència",
      "title": "Punts de Control",
      "entities": ["controlPoint.*", "event.*"]
    }
  ]
}
```

## 5) Exemple d'aplicació: El Regreso

Aplicar a *El Regreso* de Ricard Ibáñez (https://rolmasters.com/aventures/partides/01ElRegreso.pdf):

- **Intenció**: `intention.pj.DePas` («estan de pas» cap a Yesa), `intention.npc.XimunAvisar` (versos en èuscar).
- **Punts de Control**: `controlPoint.HostalatgeBurgui`, `controlPoint.ProfeciaXimun`, `controlPoint.DefensaGossos`, `controlPoint.DilemaSalvatierra`, `controlPoint.DeslliurarEscapulari`.


Projectes similars

https://www.flagonforge.com/
