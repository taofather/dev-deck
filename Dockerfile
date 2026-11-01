FROM node:22-alpine

# Hugo Extended, Go (per als mòduls de Hugo com Hextra) i Git
RUN apk add --no-cache hugo go git libc6-compat gcompat

WORKDIR /app

# Ports del servei:
# 5180: Servidor de documentació Hugo
# 5182: Bridge SSE per a l'agent Claude
# 5179: Servidor Vite independent de diagrames (dev:diagrams)
EXPOSE 5180 5182 5179

CMD ["sh", "-c", "npm install && npm run dev"]
