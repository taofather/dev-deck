---
title: Proteccions d'Identitat i Rate Limiting a Supabase
labels:
  - Seguretat
  - Autenticació
  - Rate Limiting
  - Supabase
  - PoC
---

# Proteccions d'Identitat i Força Bruta a Supabase

Supabase Auth disposa d'un conjunt natiu de mecanismes dissenyats específicament per mitigar atacs de força bruta, intents d'enumeració d'usuaris i trànsit automatitzat (bots), sense necessitat de desenvolupar lògica addicional a un backend propi.

---

## 1. Rate Limiting natiu per IP (Algorisme *Token Bucket*)

Supabase Auth aplica restriccions de flux de peticions per adreça IP de forma nativa a la seva API d'autenticació:

* **Inici de sessió i registre (`/auth/v1/signup`, `/auth/v1/token`):** Per defecte admet un màxim de **30 peticions cada 5 minuts per IP** (amb capacitat per a ràfegues curtes). Si se supera, el servei retorna un codi `HTTP 429 Too Many Requests`.
* **Configurable des del panell:** Des de la secció *Authentication → Rate Limits* del Dashboard es poden personalitzar els llindars per endpoint o mitjançant la Management API.
* **Finestres de refredament per usuari:** Peticions com la recuperació de contrasenya (`/recover`) o confirmació de registre tenen un bloqueig automàtic de 60 segons abans de permetre un nou intent per al mateix compte.

---

## 2. Protecció Antibot i CAPTCHA Natiu (Cloudflare Turnstile / hCaptcha)

Per contrarestar atacs de força bruta distribuïts (xarxes de bots amb IPs rotatòries que esquiven els límits per IP):

* Supabase té integració directa amb **Cloudflare Turnstile** i **hCaptcha**.
* **Cloudflare Turnstile** és completament **invisible** per a la majoria d'usuaris legítims (no requereix resoldre imatges ni puzles).
* **Mecanisme:** S'habilita a *Authentication → Bot and Abuse Protection*. Supabase Auth valida el token del CAPTCHA abans d'executar qualsevol comprovació de credencials o accés a la base de dades. Si el token no és vàlid, la petició es descarta immediatament.

---

## 3. Protecció contra l'Enumeració d'Usuaris (*Prevent User Enumeration*)

Un pas habitual en atacs de força bruta és sondejar la llista de correus vàlids:

* Supabase ofereix la funció de **protecció contra enumeració**: tant si un correu existeix a la base de dades com si no, retorna el mateix missatge d'error genèric.
* Els temps de resposta estan homogeneïtzats per evitar atacs basats en anàlisi de temps (*timing attacks*).

---

## 4. Autenticació Multifactor (MFA / 2FA TOTP)

Supabase Auth permet activar de sèrie l'autenticació en dos passos mitjançant estàndards TOTP (Google Authenticator, 1Password, Authy):

* Fins i tot en cas de descobriment de la contrasenya, l'accés queda bloquejat sense el codi temporal del dispositiu físic.
* Els endpoints de validació de desafiaments MFA disposen d'un rate limit estricte independent (15 intents per minut per IP).

---

## 5. Implementació del requisit "4 peticions al dia / IP pel registre i login"

Al pla de requeriments inicial (`pla-infraestructura.md`) es proposava:
> *"Intentar posar un límit de 4 peticions al dia/IP pel registre i pel login."*

Hi ha tres maneres d'aplicar o substituir aquest requisit a l'ecosistema Supabase:

1. **Via Cloudflare WAF (Davant del Frontend, Recomanat):**
   Si el client React s'allotja a Cloudflare Pages o darrere d'un proxy Cloudflare (gratuït), es pot configurar una regla de tallafocs WAF que bloquegi qualsevol IP que executi més de 4 peticions POST diàries als endpoints d'autenticació.
2. **Via Cloudflare Turnstile (Substitució intel·ligent):**
   En frenar els scripts automatitzats mitjançant Turnstile, no cal fixar un llindar tan rígid com 4 intents/dia, evitant bloquejar usuaris legítims que s'equivoquin de contrasenya puntualment.
3. **Via Trigger i Taula de registre a PostgreSQL:**
   Es pot mantenir una taula `auth_attempts (ip_address INET, created_at TIMESTAMPTZ)` i validar mitjançant un trigger SQL abans d'acceptar la transacció si la IP supera els 4 registres en les darreres 24 hores.
