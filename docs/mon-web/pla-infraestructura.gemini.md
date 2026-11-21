---
title: Anàlisi d'Infraestructura i Costos amb Supabase (PoC)
labels:
  - Web
  - Infraestructura
  - Supabase
  - PoC
  - Arquitectura
---

# Anàlisi d'Infraestructura i Costos amb Supabase (PoC)

Aquest document recull l'anàlisi de viabilitat tècnica, estimació de costos i selecció d'arquitectura per al PoC especificat a `requeriments.md` i `pla-infraestructura.md`.

---

## 1. Estimació de Costos (Supabase)

Per a la fase de PoC, el cost directe a **Supabase és de 0 € / mes (Pla Gratuït)**.

### Comparativa de plans Supabase

| Concepte | Pla Free (0 € / mes) | Pla Pro (25 $ / mes ≈ 23 €) | Adequació al PoC |
| :--- | :--- | :--- | :--- |
| **Base de dades PostgreSQL** | 500 MB | 8 GB inclosos | Més que suficient per milers de missatges, personatges i blocs narratius. |
| **Autenticació (Auth / JWT)** | 50.000 MAU (usuaris actius/mes) | 100.000 MAU | Cobreix de sobres el registre per invitació (`user_invites`). |
| **Realtime (Xat)** | 200 connexions concurrents / 2M missatges/mes | 500 concurrents / 5M missatges/mes | Substitueix amb avantatge el *web polling*. |
| **Transferència (Egress)** | 5 GB / mes | 250 GB / mes | El trànsit JSON/text del PoC és mínim. |
| **Pausa per inactivitat** | **Sí** (es pausa si passa 7 dies sense trànsit) | **No** (sempre actiu) | Al pla Free, si s'adorm, es reactiva en 1 clic al panell. |

---

## 2. Comparativa d'Arquitectura: Cal un Backend Programàtic (Java)?

A `pla-infraestructura.md` es proposava un *backend Java*. Després de revisar els casos d'ús de `requeriments.md`, s'identifiquen dues alternatives:

### Opció A: Arquitectura Serverless / Nadiua Supabase (Recomanada) — **0 €/mes**

* **Frontend:** React hostat a **Vercel** o **Cloudflare Pages** (Pla Free: 0 €).
* **Backend:** Supabase com a *Backend-as-a-Service* (BaaS) directe (Pla Free: 0 €).
* **Motius:**
  * No cal aixecar, mantenir ni pagar contenidors o servidors dedicats per a Spring Boot.
  * Tota la lògica de dades, seguretat i xat es gestiona directament amb PostgreSQL, Row Level Security (RLS) i Supabase Auth/Realtime.

### Opció B: Arquitectura Híbrida (Backend Java + Supabase com a BD) — **0 € a 7 €/mes**

* **Frontend:** React a Vercel / Cloudflare Pages (0 €).
* **Base de dades:** Supabase PostgreSQL (0 €).
* **Servidor Java (Spring Boot):** Cal allotjament extern:
  * **Render / Fly.io / Railway:** 0 € al pla gratuït (amb suspensió als 15 minuts d'inactivitat) o ~5 $ - 7 $ / mes per a una instància persistent (512 MB - 1 GB RAM).
  * **VPS (ex. Hetzner Cloud CX22):** ~4 € / mes (permet córrer el JAR/Docker).

---

## 3. Mapeig de Casos d'Ús directament a Supabase

Tots els casos d'ús actuals es poden resoldre sense necessitat d'una capa intermèdia en Spring Boot:

| Cas d'ús (`requeriments.md`) | Resolució nativa a Supabase |
| :--- | :--- |
| **`usecase.identity.Register`**<br>(Email + contrasenya, whitelist `user_invites`) | **PostgreSQL Trigger** `BEFORE INSERT ON auth.users` o **Supabase Auth Hook**.<br>Comprova si el correu existeix a la taula `user_invites`. Si no hi és, llança una excepció SQL que Supabase tradueix en un error 400. |
| **`usecase.identity.Login`** | **Supabase Auth natiu**.<br>Gestiona registre, hashing segur, emissió de JWT i renovació de sessions. |
| **`usecase.history.RenderLastNarrativeBlock`** | Query directa des del client React:<br>`supabase.from('narrative_blocks').select('*').eq('campaign_id', id).order('created_at', {ascending: false}).limit(1)` |
| **`usecase.history.NarrativeBlockList`** | Query paginada protegida per RLS (només visible per als jugadors de la campanya). |
| **`usecase.history.RenderNewNarrativeBlock`** | `INSERT INTO narrative_blocks`. Amb una política **RLS** es valida que `auth.uid()` correspongui al DJ de la campanya. |
| **`usecase.chat.UserSendsPrivateMessage` / `DirectorSendsPrivateMessage`** | `INSERT INTO messages` amb `is_private = true`. Amb **RLS**, només el remitent, el destinatari o el DJ tenen permís de `SELECT`. |
| **`usecase.chat.SendsPublicMessage` / `DirectorSendsPublicMessage`** | `INSERT INTO messages` amb `is_private = false`. RLS valida la pertinença a la campanya. |
| **`usecase.chat.UserSelectsOption`** | `INSERT INTO player_actions` vinculat a l'`ActionSelector` del bloc narratiu vigent. |
| **Xat en temps real** | **Supabase Realtime (WebSockets)** substitueix el *web pooling*, reduint latència i trànsit innecessari a la base de dades. |

---

## 4. Quan es justificaria afegir lògica de servidor (Backend o Edge Functions)?

Un backend programàtic tradicional o l'ús de **Supabase Edge Functions** (TypeScript serverless) només seria necessari si s'afegeixen:

1. **Integracions amb IA / LLMs:** Trucades a models (OpenAI, Anthropic) per generar narratives, PnJs o diàlegs protegint les claus d'API privades.
2. **Lògica de regles i daus inviolable:** Validació estricta de tirades de daus o càlculs complexos de sistema de joc al costat del servidor per evitar trampes des del client.
3. **Tasques programades (Crons):** Tancament automàtic de torns o períodes d'acció al cap de X hores (tot i que també es pot resoldre amb `pg_cron` o Edge Functions schedulers).
4. **Rate limiting estricte per IP:** Si es vol aplicar un límit rígid de peticions/dia/IP al registre (més enllà del rate limit d'Auth natiu de Supabase), mitjançant Cloudflare o una Edge Function.

---

## 5. Conclusions i Recomanació per al PoC

1. **Adoptar Supabase com a BaaS complet** (React + Supabase) per minimitzar temps de desenvolupament, complexitat d'infraestructura i costos (**0 € / mes**).
2. **Substituir el *web polling* per Supabase Realtime** per aprofitar els WebSockets natius inclosos sense cost.
3. Si en el futur cal lògica privada (IA, mecàniques de joc), afegir **Supabase Edge Functions** puntuals abans de considerar un monòlit en Spring Boot.
