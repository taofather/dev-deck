---
title: Plà d infrastructura PoC
labels:
  - Web
  - Infraestructura
  - PoC
---

# Plà de d'infraestructura per la web

## Overview
Front-end senzill amb react, ens inspirem en https://www.flagonforge.com/.
Hosting a Supabase, front-end a Cloudflare pages.

## Sessions i límits

### Registre
El PoC serà accessible via registre amb email, però els emails estaran a una llista blanca a la bbdd.
Es retornarà un error si, a la transacció del registre, el correu no està a la taula `user_invites`.

### Inici de sessió
Via login, JWT i cookie amb 1 setmana de vida.

### Límit de peticions
Intentar posar un límit de 4 peticions al dia/IP pel registre i pel login.
Els altres endpoints son privats (Supabase sessions)

## Xat
Xat a temps real però amb web pooling.

