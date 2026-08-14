FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

LABEL org.opencontainers.image.title="Kiln frontend benchmark verifier" \
      org.opencontainers.image.version="2" \
      io.kiln.verifier-source="sha256:9cd6d6e0bb0b711e9e37aa3eb7e0fa263ed0758f0b4d50232725fed0f1a9a18f"

WORKDIR /opt/kiln-verifier
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY verify.mjs ./verify.mjs

ENV NODE_ENV=production
USER pwuser
ENTRYPOINT ["node", "/opt/kiln-verifier/verify.mjs"]
