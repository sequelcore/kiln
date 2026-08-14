FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

LABEL org.opencontainers.image.title="Kiln frontend benchmark verifier" \
      org.opencontainers.image.version="1" \
      io.kiln.verifier-source="sha256:cd5af36b07b603762a5b910d58cd9db6906e2659045c0a3d4896cf423809ed30"

WORKDIR /opt/kiln-verifier
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY verify.mjs ./verify.mjs

ENV NODE_ENV=production
USER pwuser
ENTRYPOINT ["node", "/opt/kiln-verifier/verify.mjs"]
