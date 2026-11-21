---
title: Requeriments PoC
labels:
  - Model
  - Casos d'ús
  - PoC
---

## Glossary
DJ: Director de Joc
PJ: Personatge
PnJ: Personatge No Jugador

## Model

*User*
*Character*
*Campaign*: 1 campanya - N usuaris.
*Message*: de grup o privat.
*NarrativeBlock*: Bloc de narració que el DJ envia i que obra un periode en el que els Usuaris envien les seves accions i interactuen amb el món. Té una **relació N:N amb User** (`narrative_block_users`): la història pot separar els PJs (per exemple, si el grup es divideix durant una tempesta o investigació), fent necessaris blocs narratius diferenciats per a sub-grups d'usuaris. Un NarrativeBlock pot anar adreçat a un subconjunt de PJs o a tota la campanya.
*ChatMessage*: A diferència dels Blocs Narratius, els xats son informals (de grup públic o privat 1 a 1). Prescindim de relació N:N a `chat_messages`: si el grup està separat, el DJ duplicarà el missatge als elements del sub-grup.
*PrivateChatWindow*: finestra de xat privada.
*GroupChatWindow*: finestra de xat 
*ActionSelector* el director pot obtar per enviar accions durant una interacció amb el o els jugadors.

## Casos d ús

usecase.identity.Register
Usuari es registra, dos inputs: email i contrassenya. Si el correu no existeix a user_invites, retornar 400.

usecase.identity.Login
Usuari es loga, es recupera amb taula users (SpringBoot best practices).

usecase.history.RenderLastNarrativeBlock
Es mostra una pàgina amb el darrer PuntDeControl / NarrativeBlock assignat a l'Usuari autenticat (filtrat per la relació N:N amb usuaris o global de campanya).

usecase.history.NarrativeBlockList
Es mostra un històric de blocks narratius visibles per a l'Usuari autenticat.

usecase.history.RenderNewNarrativeBlock
El DJ publica el darrer NarrativeBlock de la Campanya actual, podent seleccionar a quins Usuaris va adreçat el bloc (relació N:N).

usecase.chat.UserSendsPrivateMessage

usecase.chat.DirectorSendsPrivateMessage

usecase.chat.SendsPublicMessage

usecase.chat.DirectorSendsPublicMessage

usecase.chat.UserSelectsOption
